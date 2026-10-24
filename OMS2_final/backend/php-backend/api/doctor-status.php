<?php
// api/doctor-status.php
// Replaces MH_STORE.getDoctorStatus()/setDoctorStatus() used on doctor-dashboard.html.
// Just updates the `status` column already sitting on the doctors table.
//
// GET  /api/doctor-status.php?doctorId=1        -> { status: "available" }
// POST /api/doctor-status.php  body: { doctorId, status }   status: available | busy | offline

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

$validStatuses = ['available', 'busy', 'offline'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $doctorId = $_GET['doctorId'] ?? null;
    if (!$doctorId) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing doctorId']);
        exit;
    }
    $stmt = $pdo->prepare("SELECT status FROM doctors WHERE id = ?");
    $stmt->execute([$doctorId]);
    $row = $stmt->fetch();
    if (!$row) {
        http_response_code(404);
        echo json_encode(['error' => 'Doctor not found']);
        exit;
    }
    echo json_encode(['status' => $row['status']]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $doctorId = $body['doctorId'] ?? null;
    $status = $body['status'] ?? null;

    if (!$doctorId || !in_array($status, $validStatuses, true)) {
        http_response_code(400);
        echo json_encode(['error' => 'doctorId and a valid status (available|busy|offline) are required']);
        exit;
    }

    $stmt = $pdo->prepare("UPDATE doctors SET status = ? WHERE id = ?");
    $stmt->execute([$status, $doctorId]);

    echo json_encode(['ok' => true, 'status' => $status]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>