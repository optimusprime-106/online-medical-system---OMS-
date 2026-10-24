<?php
// api/orders.php
// Replaces MH_STORE.addOrder()/getOrders(). Powers the pharmacy checkout
// step and the "download invoice" lookup in pharmacy.js.
//
// POST /api/orders.php  body: { userId?, name, address, phone, items: [{medicineId?, name, qty, price}], total }
//      -> creates the order + order_items, clears that user's cart (if userId given), returns the order
// GET  /api/orders.php?id=PH-XXXX      -> single order with items (for invoice download)
// GET  /api/orders.php?userId=U-XXXX   -> that user's past orders, newest first

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

function fetchOrder(PDO $pdo, string $id): ?array {
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ?");
    $stmt->execute([$id]);
    $order = $stmt->fetch();
    if (!$order) return null;

    $stmt = $pdo->prepare("SELECT medicine_name AS name, qty, price FROM order_items WHERE order_id = ?");
    $stmt->execute([$id]);
    $items = array_map(fn($r) => ['name' => $r['name'], 'qty' => (int) $r['qty'], 'price' => (float) $r['price']], $stmt->fetchAll());

    return [
        'id'            => $order['id'],
        'name'          => $order['name'],
        'address'       => $order['address'],
        'phone'         => $order['phone'],
        'items'         => $items,
        'total'         => (float) $order['total'],
        'paymentMethod' => $order['payment_method'],
        'paymentStatus' => $order['payment_status'],
        'createdAt'     => strtotime($order['created_at']) * 1000, // ms, to match Date.now() used by the old localStorage version
    ];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    $required = ['name', 'address', 'phone', 'items', 'total'];
    foreach ($required as $field) {
        if (!isset($body[$field]) || $body[$field] === '') {
            http_response_code(400);
            echo json_encode(['error' => "Missing field: $field"]);
            exit;
        }
    }
    if (!is_array($body['items']) || count($body['items']) === 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Order must include at least one item']);
        exit;
    }

    $id = 'PH-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
    $userId = $body['userId'] ?? null;
    $paymentMethod = $body['paymentMethod'] ?? 'cod';

    // Never trust the client for online payments — confirm the payments
    // row was actually verified by razorpay-verify.php, for this user,
    // for (at least) this total.
    $paymentStatus = 'pending';
    $razorpayOrderId = null;
    $razorpayPaymentId = null;

    if ($paymentMethod === 'razorpay') {
        $orderId = $body['razorpayOrderId'] ?? null;
        if (!$orderId || !$userId) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing razorpayOrderId or userId for an online payment']);
            exit;
        }
        $stmt = $pdo->prepare(
            "SELECT * FROM payments
             WHERE razorpay_order_id = ? AND status = 'verified' AND purpose = 'pharmacy' AND ref_id = ?"
        );
        $stmt->execute([$orderId, (string) $userId]);
        $payment = $stmt->fetch();

        if (!$payment || abs((float) $payment['amount'] - (float) $body['total']) > 0.01) {
            http_response_code(402);
            echo json_encode(['error' => 'Payment not verified for this order']);
            exit;
        }

        $paymentStatus = 'paid';
        $razorpayOrderId = $payment['razorpay_order_id'];
        $razorpayPaymentId = $payment['razorpay_payment_id'];
    } elseif ($paymentMethod !== 'cod') {
        http_response_code(400);
        echo json_encode(['error' => 'paymentMethod must be "razorpay" or "cod"']);
        exit;
    }

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare(
            "INSERT INTO orders (id, user_id, name, address, phone, total, payment_method, payment_status, razorpay_order_id, razorpay_payment_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([$id, $userId, $body['name'], $body['address'], $body['phone'], $body['total'], $paymentMethod, $paymentStatus, $razorpayOrderId, $razorpayPaymentId]);

        $itemStmt = $pdo->prepare(
            "INSERT INTO order_items (order_id, medicine_id, medicine_name, qty, price) VALUES (?, ?, ?, ?, ?)"
        );
        foreach ($body['items'] as $it) {
            $itemStmt->execute([$id, $it['medicineId'] ?? $it['id'] ?? null, $it['name'], $it['qty'], $it['price']]);
        }

        // checkout clears the cart, same as MH_STORE did client-side
        if ($userId) {
            $pdo->prepare("DELETE FROM cart_items WHERE user_id = ?")->execute([$userId]);
        }

        $pdo->commit();
        http_response_code(201);
        echo json_encode(fetchOrder($pdo, $id));
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'Failed to place order']);
    }
    exit;
}

if ($method === 'GET') {
    if (!empty($_GET['id'])) {
        $order = fetchOrder($pdo, $_GET['id']);
        if (!$order) {
            http_response_code(404);
            echo json_encode(['error' => 'Order not found']);
            exit;
        }
        echo json_encode($order);
        exit;
    }

    if (!empty($_GET['userId'])) {
        $stmt = $pdo->prepare("SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC");
        $stmt->execute([$_GET['userId']]);
        $orders = array_map(fn($r) => fetchOrder($pdo, $r['id']), $stmt->fetchAll());
        echo json_encode($orders);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Provide id or userId']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>