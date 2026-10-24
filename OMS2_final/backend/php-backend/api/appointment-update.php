<?php
// api/appointment-update.php
// PATCH-style update, called via POST with an "action" field (simplest for
// plain PHP hosting that may not route PATCH through easily).
//
// POST /api/appointment-update.php
// body: { "id": "MH-XXXX", "status": "accepted" }
//   or: { "id": "MH-XXXX", "prescription": { "meds": [...], "notes": "..." } }

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$id = $body['id'] ?? null;
if (!$id) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing appointment id']);
    exit;
}

try {
    $pdo->beginTransaction();

    if (!empty($body['status'])) {
        $stmt = $pdo->prepare("UPDATE appointments SET status = ? WHERE id = ?");
        $stmt->execute([$body['status'], $id]);
    }

    if (!empty($body['prescription'])) {
        $rx = $body['prescription'];

        $stmt = $pdo->prepare("SELECT id FROM prescriptions WHERE appointment_id = ?");
        $stmt->execute([$id]);
        $existing = $stmt->fetch();

        if ($existing) {
            $prescriptionId = $existing['id'];
            $stmt = $pdo->prepare(
                "UPDATE prescriptions SET notes = ?, prescribed_on = CURDATE() WHERE id = ?"
            );
            $stmt->execute([$rx['notes'] ?? null, $prescriptionId]);

            $stmt = $pdo->prepare("DELETE FROM prescription_items WHERE prescription_id = ?");
            $stmt->execute([$prescriptionId]);
        } else {
            $stmt = $pdo->prepare(
                "INSERT INTO prescriptions (appointment_id, notes, prescribed_on) VALUES (?, ?, CURDATE())"
            );
            $stmt->execute([$id, $rx['notes'] ?? null]);
            $prescriptionId = $pdo->lastInsertId();
        }

        $itemStmt = $pdo->prepare(
            "INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency)
             VALUES (?, ?, ?, ?)"
        );
        foreach ($rx['meds'] ?? [] as $med) {
            $itemStmt->execute([
                $prescriptionId,
                $med['name'] ?? '',
                $med['dosage'] ?? null,
                $med['freq'] ?? null,
            ]);
        }
    }

    $pdo->commit();
    echo json_encode(['ok' => true]);
} catch (Exception $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Failed to update appointment']);
}
?>
