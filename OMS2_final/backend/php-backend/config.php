<?php
// config.php — single shared PDO connection. Every api/*.php file
// requires this, so the whole backend talks to ONE database.

$DB_HOST = getenv('DB_HOST') ?: 'localhost';
$DB_NAME = getenv('DB_NAME') ?: 'meridian_health';
$DB_USER = getenv('DB_USER') ?: 'root';
$DB_PASS = getenv('DB_PASS') ?: '';

// ---------------------------------------------------------------------
// Razorpay test keys. RAZORPAY_KEY_SECRET must NEVER be sent to the
// frontend — only razorpay-order.php and razorpay-verify.php touch it.
// Set these as real environment variables in production; the literal
// fallback strings below are placeholders for local dev only.
// ---------------------------------------------------------------------
define('RAZORPAY_KEY_ID', getenv('RAZORPAY_KEY_ID') ?: 'rzp_test_Trp41wpeN4MlDz');
define('RAZORPAY_KEY_SECRET', getenv('RAZORPAY_KEY_SECRET') ?: 'rGnS0ebCqRhZiMadURBvr03i');

try {
    $pdo = new PDO(
        "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}
?>
