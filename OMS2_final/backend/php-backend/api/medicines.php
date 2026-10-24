<?php
// api/medicines.php
// Replaces the hardcoded MEDICINES / MEDICINE_CATEGORIES arrays in data.js.
//
// GET /api/medicines.php                 -> full catalog, shaped like the old MEDICINES array
// GET /api/medicines.php?category=Allergy -> filter by category name ("All" or omitted = no filter)
// GET /api/medicines.php?search=cet       -> filter by name/category substring
// GET /api/medicines.php?categories=1     -> just the category name list (for the filter chips)

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Just the category chip labels ("All" + every category name), mirrors MEDICINE_CATEGORIES
if (isset($_GET['categories'])) {
    $stmt = $pdo->query("SELECT name FROM medicine_categories ORDER BY name");
    $names = array_map(fn($r) => $r['name'], $stmt->fetchAll());
    echo json_encode(array_merge(['All'], $names));
    exit;
}

function toFrontendMedicine(array $row): array {
    return [
        'id'       => (int) $row['id'],
        'name'     => $row['name'],
        'category' => $row['category_name'],
        'price'    => (float) $row['price'],
        'pack'     => $row['pack_info'],
        'rx'       => (bool) $row['requires_prescription'],
        'img'      => $row['image_code'],
    ];
}

$sql = "SELECT m.*, c.name AS category_name
        FROM medicines m JOIN medicine_categories c ON c.id = m.category_id
        WHERE 1=1";
$params = [];

if (!empty($_GET['category']) && $_GET['category'] !== 'All') {
    $sql .= " AND c.name = ?";
    $params[] = $_GET['category'];
}
if (!empty($_GET['search'])) {
    $sql .= " AND (m.name LIKE ? OR c.name LIKE ?)";
    $like = '%' . $_GET['search'] . '%';
    $params[] = $like;
    $params[] = $like;
}
$sql .= " ORDER BY m.name";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$medicines = array_map('toFrontendMedicine', $stmt->fetchAll());

echo json_encode($medicines);
?>


