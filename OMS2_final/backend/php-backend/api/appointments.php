<?php
// api/appointments.php
// Mirrors what MH_STORE (localStorage) used to do, now backed by MySQL.
// POST /api/appointments.php                  -> create (appointment.html payment step)
// GET  /api/appointments.php?doctorId=1        -> doctor portal "requests" list
// GET  /api/appointments.php?patientEmail=x    -> patient dashboard list

require_once __DIR__ . '/../config.php';
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];

// Looks up the prescription (+ its medicine lines) for one appointment, in
// the shape the frontend expects: { meds: [{name,dosage,freq}], notes, date }.
// Returns null when the doctor hasn't written one yet — pdf-utils.js and
// the dashboard both check for that.
function mh_fetch_prescription($pdo, $appointmentId) {
    $stmt = $pdo->prepare("SELECT * FROM prescriptions WHERE appointment_id = ?");
    $stmt->execute([$appointmentId]);
    $rx = $stmt->fetch();
    if (!$rx) return null;

    $stmt = $pdo->prepare("SELECT medicine_name AS name, dosage, frequency AS freq FROM prescription_items WHERE prescription_id = ?");
    $stmt->execute([$rx['id']]);
    $meds = $stmt->fetchAll();

    return [
        'meds' => $meds,
        'notes' => $rx['notes'],
        'date' => $rx['prescribed_on'],
    ];
}

if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    $required = ['doctorId', 'patientName', 'patientEmail', 'date', 'time', 'fee'];
    foreach ($required as $field) {
        if (!isset($body[$field]) || $body[$field] === '') {
            http_response_code(400);
            echo json_encode(['error' => "Missing field: $field"]);
            exit;
        }
    }

    $id = 'MH-' . strtoupper(base_convert((string) (int)(microtime(true) * 1000), 10, 36));

    // Never trust the client's "paid" flag for online payments — look up
    // the payments row (created by razorpay-order.php, marked 'verified'
    // by razorpay-verify.php) and confirm it actually matches this
    // doctor and this fee before marking the appointment paid.
    $paid = false;
    $paymentMethod = $body['paymentMethod'] ?? null;
    $razorpayOrderId = null;
    $razorpayPaymentId = null;

    if ($paymentMethod === 'razorpay') {
        $orderId = $body['razorpayOrderId'] ?? null;
        if (!$orderId) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing razorpayOrderId for an online payment']);
            exit;
        }
        $stmt = $pdo->prepare(
            "SELECT * FROM payments
             WHERE razorpay_order_id = ? AND status = 'verified' AND purpose = 'appointment' AND ref_id = ?"
        );
        $stmt->execute([$orderId, (string) $body['doctorId']]);
        $payment = $stmt->fetch();

        if (!$payment || abs((float) $payment['amount'] - (float) $body['fee']) > 0.01) {
            http_response_code(402);
            echo json_encode(['error' => 'Payment not verified for this appointment']);
            exit;
        }

        $paid = true;
        $razorpayOrderId = $payment['razorpay_order_id'];
        $razorpayPaymentId = $payment['razorpay_payment_id'];
    } elseif ($paymentMethod === 'cash') {
        $paid = false;
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'paymentMethod must be "razorpay" or "cash"']);
        exit;
    }

    $stmt = $pdo->prepare(
        "INSERT INTO appointments
         (id, doctor_id, patient_id, patient_name, patient_email, patient_phone,
          appt_date, appt_time, reason, fee, status, paid, payment_method,
          razorpay_order_id, razorpay_payment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)"
    );
    $stmt->execute([
        $id,
        $body['doctorId'],
        $body['patientId'] ?? null,
        $body['patientName'],
        $body['patientEmail'],
        $body['patientPhone'] ?? null,
        $body['date'],
        $body['time'],
        $body['reason'] ?? null,
        $body['fee'],
        $paid ? 1 : 0,
        $paymentMethod,
        $razorpayOrderId,
        $razorpayPaymentId,
    ]);

    http_response_code(201);
    echo json_encode(['id' => $id]);
    exit;
}

if ($method === 'GET') {
    // Select with explicit aliases: the frontend (script.js, pdf-utils.js)
    // reads camelCase fields like doctorName/patientName/date/time/paymentMethod,
    // not the raw snake_case MySQL column names.
    $sql = "SELECT
                a.id, a.doctor_id AS doctorId, a.patient_id AS patientId,
                a.patient_name AS patientName, a.patient_email AS patientEmail,
                a.patient_phone AS patientPhone,
                a.appt_date AS date, a.appt_time AS time,
                a.reason, a.fee, a.status, a.paid,
                a.payment_method AS paymentMethod,
                a.razorpay_order_id AS razorpayOrderId,
                a.razorpay_payment_id AS razorpayPaymentId,
                a.created_at AS createdAt,
                d.name AS doctorName, s.name AS specialty
            FROM appointments a
            JOIN doctors d ON d.id = a.doctor_id
            JOIN specialties s ON s.id = d.specialty_id
            WHERE 1=1";
    $params = [];

    // Fetching a single appointment by id (used by the invoice/prescription
    // download buttons) — return one object instead of a list.
    if (!empty($_GET['id'])) {
        $sql .= " AND a.id = ?";
        $params[] = $_GET['id'];

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $appt = $stmt->fetch();

        if (!$appt) {
            http_response_code(404);
            echo json_encode(['error' => 'Appointment not found']);
            exit;
        }

        $appt['paid'] = (bool) $appt['paid'];
        $appt['prescription'] = mh_fetch_prescription($pdo, $appt['id']);
        echo json_encode($appt);
        exit;
    }

    if (!empty($_GET['doctorId'])) {
        $sql .= " AND a.doctor_id = ?";
        $params[] = $_GET['doctorId'];
    }
    if (!empty($_GET['patientEmail'])) {
        $sql .= " AND a.patient_email = ?";
        $params[] = $_GET['patientEmail'];
    }
    $sql .= " ORDER BY a.created_at DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['paid'] = (bool) $row['paid'];
        $row['prescription'] = mh_fetch_prescription($pdo, $row['id']);
    }
    unset($row);

    echo json_encode($rows);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
