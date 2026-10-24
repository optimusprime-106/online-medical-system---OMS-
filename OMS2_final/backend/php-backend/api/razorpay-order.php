<?php
// api/razorpay-order.php
// Creates a Razorpay order for either an appointment or a pharmacy cart
// checkout. The amount is ALWAYS calculated here from the database —
// never taken from the request body — so a tampered client can't pay
// less than the real price.
//
// POST /api/razorpay-order.php
// body (appointment): { "type": "appointment", "refId": 3 }            // refId = doctor id
// body (pharmacy):    { "type": "pharmacy", "userId": "U-XXXX" }       // totals that user's cart
//
// Response: { "id": "order_xxx", "amount": 60000, "currency": "INR" }
// "amount" is in paise (₹1 = 100 paise), which is what Razorpay
// Checkout.js expects directly.

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$type = $body['type'] ?? '';

if (!in_array($type, ['appointment', 'pharmacy'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'type must be "appointment" or "pharmacy"']);
    exit;
}

// ---- 1. Work out the real amount server-side ----
$amountRupees = 0;
$refId = null;

if ($type === 'appointment') {
    $doctorId = $body['refId'] ?? null;
    if (!$doctorId) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing refId (doctorId)']);
        exit;
    }
    $stmt = $pdo->prepare("SELECT consultation_fee FROM doctors WHERE id = ?");
    $stmt->execute([$doctorId]);
    $doctor = $stmt->fetch();
    if (!$doctor) {
        http_response_code(404);
        echo json_encode(['error' => 'Doctor not found']);
        exit;
    }
    $amountRupees = (float) $doctor['consultation_fee'];
    $refId = (string) $doctorId;
}

if ($type === 'pharmacy') {
    $userId = $body['userId'] ?? null;
    if (!$userId) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing userId — cart checkout requires a logged-in user']);
        exit;
    }
    $stmt = $pdo->prepare(
        "SELECT SUM(ci.qty * m.price) AS total
         FROM cart_items ci JOIN medicines m ON m.id = ci.medicine_id
         WHERE ci.user_id = ?"
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    $amountRupees = (float) ($row['total'] ?? 0);
    $refId = (string) $userId;

    if ($amountRupees <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Cart is empty']);
        exit;
    }
}

$amountPaise = (int) round($amountRupees * 100);

// ---- 2. Ask Razorpay to create the order ----
$receipt = strtoupper($type) . '-' . bin2hex(random_bytes(6));

$ch = curl_init('https://api.razorpay.com/v1/orders');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_USERPWD => RAZORPAY_KEY_ID . ':' . RAZORPAY_KEY_SECRET,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'amount'   => $amountPaise,
        'currency' => 'INR',
        'receipt'  => $receipt,
        'notes'    => ['type' => $type, 'refId' => $refId],
    ]),
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Could not reach Razorpay', 'detail' => $curlErr]);
    exit;
}

$rp = json_decode($response, true);
if ($httpCode >= 300 || !isset($rp['id'])) {
    http_response_code(502);
    echo json_encode(['error' => 'Razorpay order creation failed', 'detail' => $rp['error']['description'] ?? $response]);
    exit;
}

// ---- 3. Log the order locally so razorpay-verify.php / appointments.php /
//      orders.php can confirm a claimed payment actually happened and
//      for how much, instead of trusting the frontend.
$stmt = $pdo->prepare(
    "INSERT INTO payments (razorpay_order_id, purpose, ref_id, amount, status)
     VALUES (?, ?, ?, ?, 'created')"
);
$stmt->execute([$rp['id'], $type, $refId, $amountRupees]);

echo json_encode([
    'id'       => $rp['id'],
    'amount'   => $rp['amount'],
    'currency' => $rp['currency'],
]);
