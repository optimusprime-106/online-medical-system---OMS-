
<?php
// api/cart.php
// Replaces MH_STORE.getCart()/saveCart(). Cart rows are tied to a logged-in
// user (cart_items.user_id), so the frontend must have a session/userId
// from auth.php before using this — matching the DB's NOT NULL constraint.
//
// GET  /api/cart.php?userId=U-XXXX               -> [{id, qty}, ...] (same shape MH_STORE used)
// POST /api/cart.php  body: { userId, medicineId, qty }
//      qty > 0  -> add/update that line
//      qty <= 0 -> remove that line
//      returns the full updated cart, same shape as GET

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

function currentCart(PDO $pdo, string $userId): array {
    $stmt = $pdo->prepare("SELECT medicine_id AS id, qty FROM cart_items WHERE user_id = ?");
    $stmt->execute([$userId]);
    return array_map(fn($r) => ['id' => (int) $r['id'], 'qty' => (int) $r['qty']], $stmt->fetchAll());
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = $_GET['userId'] ?? '';
    if ($userId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing userId']);
        exit;
    }
    echo json_encode(currentCart($pdo, $userId));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $userId = $body['userId'] ?? '';
    $medicineId = $body['medicineId'] ?? null;
    $qty = (int) ($body['qty'] ?? 0);

    if ($userId === '' || !$medicineId) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing userId or medicineId']);
        exit;
    }

    if ($qty > 0) {
        $stmt = $pdo->prepare(
            "INSERT INTO cart_items (user_id, medicine_id, qty) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE qty = VALUES(qty)"
        );
        $stmt->execute([$userId, $medicineId, $qty]);
    } else {
        $stmt = $pdo->prepare("DELETE FROM cart_items WHERE user_id = ? AND medicine_id = ?");
        $stmt->execute([$userId, $medicineId]);
    }

    echo json_encode(currentCart($pdo, $userId));
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>