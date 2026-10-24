<?php
// api/auth.php
// Replaces MH_AUTH's localStorage register()/login().
// Passwords are hashed with PHP's password_hash() — never stored in plain text.
//
// POST /api/auth.php?action=register  body: { name, email, password, role }
// POST /api/auth.php?action=login     body: { email, password, role }

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');
session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$action = $_GET['action'] ?? '';
$body = json_decode(file_get_contents('php://input'), true);
$email = strtolower(trim($body['email'] ?? ''));
$role  = $body['role'] ?? '';

if ($action === 'register') {
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ? AND role = ?");
    $stmt->execute([$email, $role]);
    if ($stmt->fetch()) {
        http_response_code(409);
        echo json_encode(['ok' => false, 'error' => 'An account with this email already exists. Try logging in instead.']);
        exit;
    }

    $id = 'U-' . strtoupper(base_convert((string) (int)(microtime(true) * 1000), 10, 36));
    $hash = password_hash($body['password'] ?? '', PASSWORD_BCRYPT);

    $stmt = $pdo->prepare(
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)"
    );
    $stmt->execute([$id, trim($body['name'] ?? ''), $email, $hash, $role]);

    $_SESSION['user'] = ['id' => $id, 'name' => $body['name'], 'email' => $email, 'role' => $role];
    echo json_encode(['ok' => true, 'user' => $_SESSION['user']]);
    exit;
}

if ($action === 'login') {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? AND role = ?");
    $stmt->execute([$email, $role]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($body['password'] ?? '', $user['password_hash'])) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Incorrect email or password.']);
        exit;
    }

    $session = ['id' => $user['id'], 'name' => $user['name'], 'email' => $user['email'], 'role' => $user['role']];
    $_SESSION['user'] = $session;
    echo json_encode(['ok' => true, 'user' => $session]);
    exit;
}

if ($action === 'logout') {
    session_destroy();
    echo json_encode(['ok' => true]);
    exit;
}

if ($action === 'session') {
    echo json_encode(['user' => $_SESSION['user'] ?? null]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unknown action']);
?>