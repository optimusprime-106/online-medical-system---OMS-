<?php
// api/doctors.php
// GET /api/doctors.php                -> full list, shaped like the old DOCTORS array in data.js
// GET /api/doctors.php?area=Parel     -> filter by locality
// GET /api/doctors.php?specialty=Cardiology
// GET /api/doctors.php?id=3           -> single doctor

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

function toFrontendDoctor(array $row): array {
    return [
        'id'      => (int) $row['id'],
        'name'    => $row['name'],
        'initials'=> $row['initials'],
        'spec'    => $row['specialty_name'],
        'rating'  => (float) $row['rating'],
        'reviews' => (int) $row['reviews'],
        'exp'     => $row['experience_years'] . ' yrs',
        'next'    => $row['next_slot_label'],
        'fee'     => (float) $row['consultation_fee'],
        'area'    => $row['area'],
        'clinic'  => $row['clinic_name'],
        'address' => $row['address'],
        'status'  => $row['status'],
    ];
}

if (isset($_GET['id'])) {
    $stmt = $pdo->prepare(
        "SELECT d.*, s.name AS specialty_name
         FROM doctors d JOIN specialties s ON s.id = d.specialty_id
         WHERE d.id = ?"
    );
    $stmt->execute([$_GET['id']]);
    $row = $stmt->fetch();
    if (!$row) {
        http_response_code(404);
        echo json_encode(['error' => 'Doctor not found']);
        exit;
    }
    echo json_encode(toFrontendDoctor($row));
    exit;
}

$sql = "SELECT d.*, s.name AS specialty_name
        FROM doctors d JOIN specialties s ON s.id = d.specialty_id
        WHERE 1=1";
$params = [];

if (!empty($_GET['area'])) {
    $sql .= " AND d.area = ?";
    $params[] = $_GET['area'];
}
if (!empty($_GET['specialty'])) {
    $sql .= " AND s.name = ?";
    $params[] = $_GET['specialty'];
}
$sql .= " ORDER BY d.name";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$doctors = array_map('toFrontendDoctor', $stmt->fetchAll());

echo json_encode($doctors);
?>