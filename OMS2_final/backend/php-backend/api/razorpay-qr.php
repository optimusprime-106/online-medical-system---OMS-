<?php
// api/razorpay-qr.php
// Creates a single-use Razorpay UPI QR code for either an appointment or
// a pharmacy cart checkout. Mirrors razorpay-order.php: the amount is
// ALWAYS calculated here from the database, never taken from the client.
//
// POST /api/razorpay-qr.php
// body (appointment): { "type": "appointment", "refId": 3 }            // refId = doctor id
// body (pharmacy):    { "type": "pharmacy", "userId": "U-XXXX" }
//
// Response: { "qrId": "qr_xxx", "imageUrl": "https://rzp.io/...", "amount": 600 }
// The frontend renders imageUrl as an <img> and polls
// razorpay-qr-status.php?qrId=... until it's paid.

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

// ---- 1. Work out the real amount server-side (same logic as razorpay-order.php) ----
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

// ---- 2. Ask Razorpay to create a single-use, fixed-amount QR code ----
// close_by must be at least 15 min out per Razorpay's docs — give it 30.
$closeBy = time() + 1800;

$ch = curl_init('https://api.razorpay.com/v1/payments/qr_codes');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_USERPWD => RAZORPAY_KEY_ID . ':' . RAZORPAY_KEY_SECRET,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'type'           => 'upi_qr',
        'name'           => 'Meridian Health',
        'usage'          => 'single_use',
        'fixed_amount'   => true,
        'payment_amount' => $amountPaise,
        'description'    => $type === 'appointment' ? 'Consultation fee' : 'Pharmacy order',
        'close_by'       => $closeBy,
        'notes'          => ['type' => $type, 'refId' => $refId],
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
    // Surface Razorpay's ACTUAL reason instead of a generic message.
    // The most common cause here: the QR Codes API is an on-demand
    // feature Razorpay must switch on per-account (Dashboard > Settings
    // > raise a request with Support, or ask your account manager to
    // enable "UPI QR Codes"). Checkout ("Pay online") can work fine
    // while QR codes are still disabled, since they're separate features.
    $detail = $rp['error']['description'] ?? $response;
    error_log('[razorpay-qr] creation failed (' . $httpCode . '): ' . $detail);
    http_response_code(502);
    echo json_encode([
        'error'  => 'QR code creation failed: ' . $detail,
        'detail' => $detail,
    ]);
    exit;
}

// ---- 3. Log it locally so razorpay-qr-status.php / appointments.php /
//      orders.php can confirm a claimed payment actually happened. ----
$stmt = $pdo->prepare(
    "INSERT INTO payments (qr_code_id, purpose, method, ref_id, amount, status)
     VALUES (?, ?, 'qr', ?, ?, 'created')"
);
$stmt->execute([$rp['id'], $type, $refId, $amountRupees]);

echo json_encode([
    'qrId'     => $rp['id'],
    'imageUrl' => $rp['image_url'],
    'amount'   => $amountRupees,
]);
