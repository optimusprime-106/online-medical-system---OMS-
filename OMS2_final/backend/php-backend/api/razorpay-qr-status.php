<?php
// api/razorpay-qr-status.php
// The frontend polls this every few seconds after showing the QR code.
// It asks Razorpay for the QR code's current state directly — never
// trusts the frontend's say-so that a payment happened — and once a
// payment is confirmed, marks it verified in the local `payments` table
// (idempotent: safe to call this repeatedly).
//
// GET /api/razorpay-qr-status.php?qrId=qr_xxx
// Response while waiting: { "paid": false, "status": "active" }
// Response once paid:     { "paid": true, "status": "closed", "razorpay_payment_id": "pay_xxx" }

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

$qrId = $_GET['qrId'] ?? '';
if (!$qrId) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing qrId']);
    exit;
}

// Confirm we actually created this QR code before believing anything about it.
$stmt = $pdo->prepare("SELECT * FROM payments WHERE qr_code_id = ?");
$stmt->execute([$qrId]);
$payment = $stmt->fetch();
if (!$payment) {
    http_response_code(404);
    echo json_encode(['error' => 'Unknown QR code — was it created via razorpay-qr.php?']);
    exit;
}

// Already confirmed earlier — no need to hit Razorpay again.
if ($payment['status'] === 'verified') {
    echo json_encode(['paid' => true, 'status' => 'closed', 'razorpay_payment_id' => $payment['razorpay_payment_id']]);
    exit;
}

// Ask Razorpay how much has been received on this QR code so far.
$ch = curl_init("https://api.razorpay.com/v1/payments/qr_codes/{$qrId}");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_USERPWD => RAZORPAY_KEY_ID . ':' . RAZORPAY_KEY_SECRET,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false || $httpCode >= 300) {
    http_response_code(502);
    echo json_encode(['error' => 'Could not reach Razorpay']);
    exit;
}

$rp = json_decode($response, true);
$received = (float) ($rp['payments_amount_received'] ?? 0) / 100; // paise -> rupees

if ($received <= 0) {
    echo json_encode(['paid' => false, 'status' => $rp['status'] ?? 'active']);
    exit;
}

// A payment has landed. Fetch which payment id it was, then verify amount
// matches what we expect before marking this order paid.
$ch = curl_init("https://api.razorpay.com/v1/payments/qr_codes/{$qrId}/payments");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_USERPWD => RAZORPAY_KEY_ID . ':' . RAZORPAY_KEY_SECRET,
]);
$paymentsResponse = curl_exec($ch);
curl_close($ch);
$paymentsList = json_decode($paymentsResponse, true);
$paymentId = $paymentsList['items'][0]['id'] ?? null;

if ($received + 0.001 < (float) $payment['amount']) {
    // Partial/short payment on a fixed-amount QR shouldn't normally happen,
    // but never mark something paid for less than what was owed.
    echo json_encode(['paid' => false, 'status' => 'underpaid']);
    exit;
}

$stmt = $pdo->prepare(
    "UPDATE payments SET status = 'verified', razorpay_payment_id = ? WHERE qr_code_id = ?"
);
$stmt->execute([$paymentId, $qrId]);

echo json_encode(['paid' => true, 'status' => 'closed', 'razorpay_payment_id' => $paymentId]);
