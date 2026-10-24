<?php
// api/razorpay-verify.php
// Verifies the signature Razorpay's checkout popup hands back to the
// frontend after a payment. This is the step that actually proves the
// payment happened — never trust razorpay_payment_id alone, since a
// client could just make one up.
//
// POST /api/razorpay-verify.php
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Response: { "ok": true } — or 400 with an error if the signature
// doesn't check out.

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$orderId   = $body['razorpay_order_id'] ?? '';
$paymentId = $body['razorpay_payment_id'] ?? '';
$signature = $body['razorpay_signature'] ?? '';

if (!$orderId || !$paymentId || !$signature) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing razorpay_order_id, razorpay_payment_id, or razorpay_signature']);
    exit;
}

// Razorpay's documented verification formula:
// expected_signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
$expected = hash_hmac('sha256', $orderId . '|' . $paymentId, RAZORPAY_KEY_SECRET);

if (!hash_equals($expected, $signature)) {
    $stmt = $pdo->prepare("UPDATE payments SET status = 'failed' WHERE razorpay_order_id = ?");
    $stmt->execute([$orderId]);

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Payment verification failed']);
    exit;
}

$stmt = $pdo->prepare("SELECT id FROM payments WHERE razorpay_order_id = ?");
$stmt->execute([$orderId]);
if (!$stmt->fetch()) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Unknown order — was it created via razorpay-order.php?']);
    exit;
}

$stmt = $pdo->prepare(
    "UPDATE payments
     SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'verified'
     WHERE razorpay_order_id = ?"
);
$stmt->execute([$paymentId, $signature, $orderId]);

echo json_encode(['ok' => true]);
