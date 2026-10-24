-- =====================================================================
-- MERIDIAN HEALTH — MySQL Database
-- One database backing the whole site (auth, doctors, appointments,
-- prescriptions, pharmacy cart/orders). Field names mirror the objects
-- already used in data.js / script.js / doctor-dashboard.js / pharmacy.js
-- so the backend can map rows straight to what the frontend expects.
-- =====================================================================

DROP DATABASE IF EXISTS meridian_health;
CREATE DATABASE meridian_health CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE meridian_health;

-- ---------------------------------------------------------------------
-- 1. USERS  (mirrors MH_AUTH: patients + provider/doctor logins)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            VARCHAR(20)  PRIMARY KEY,           -- e.g. "U-LX3F9A2"
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,               -- store a bcrypt hash, never plain text
  role          ENUM('patient','provider') NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_role (email, role)              -- same email can hold one patient + one provider account
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. SPECIALTIES  (mirrors SPECIALTIES array)
-- ---------------------------------------------------------------------
CREATE TABLE specialties (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. DOCTORS  (mirrors DOCTORS array + doctor_status)
-- ---------------------------------------------------------------------
CREATE TABLE doctors (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          VARCHAR(20) NULL,                 -- links to users.id if the doctor also logs in (provider role)
  name             VARCHAR(120) NOT NULL,
  initials         VARCHAR(4)  NOT NULL,
  specialty_id     INT NOT NULL,
  clinic_name      VARCHAR(160),
  area             VARCHAR(80)  NOT NULL,             -- e.g. "Parel", "Dadar West"
  address          VARCHAR(255),
  rating           DECIMAL(2,1) DEFAULT 4.5,
  reviews          INT DEFAULT 0,
  experience_years INT NOT NULL,
  consultation_fee DECIMAL(8,2) NOT NULL,             -- in ₹
  status           ENUM('available','busy','offline') DEFAULT 'available',
  next_slot_label  VARCHAR(40),                       -- e.g. "Today, 4:30 PM" (display cache; real slots -> doctor_slots)
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (specialty_id) REFERENCES specialties(id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_area (area),
  INDEX idx_specialty (specialty_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. APPOINTMENTS  (mirrors MH_STORE appointment objects)
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  id               VARCHAR(20) PRIMARY KEY,           -- e.g. "MH-SEED01"
  doctor_id        INT NOT NULL,
  patient_id       VARCHAR(20) NULL,                  -- nullable: guest bookings keep only name/email below
  patient_name     VARCHAR(120) NOT NULL,
  patient_email    VARCHAR(150) NOT NULL,
  patient_phone    VARCHAR(20),
  appt_date        VARCHAR(20)  NOT NULL,             -- kept as display string to match "Fri 18" style used in frontend
  appt_time        VARCHAR(20)  NOT NULL,
  reason           VARCHAR(500),
  fee              DECIMAL(8,2) NOT NULL,
  status           ENUM('pending','accepted','rejected') DEFAULT 'pending',
  paid             BOOLEAN DEFAULT FALSE,
  payment_method   ENUM('razorpay','cash') NULL,
  razorpay_order_id   VARCHAR(64) NULL,
  razorpay_payment_id VARCHAR(64) NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_doctor (doctor_id),
  INDEX idx_patient (patient_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. PRESCRIPTIONS + ITEMS  (mirrors appt.prescription = { meds, notes, date })
-- ---------------------------------------------------------------------
CREATE TABLE prescriptions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  appointment_id VARCHAR(20) NOT NULL UNIQUE,          -- one prescription per appointment
  notes          TEXT,
  prescribed_on  DATE,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE prescription_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  prescription_id INT NOT NULL,
  medicine_name   VARCHAR(160) NOT NULL,
  dosage          VARCHAR(80),
  frequency       VARCHAR(80),
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. MEDICINES + CATEGORIES  (mirrors MEDICINES / MEDICINE_CATEGORIES)
-- ---------------------------------------------------------------------
CREATE TABLE medicine_categories (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE medicines (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(160) NOT NULL,
  category_id         INT NOT NULL,
  price               DECIMAL(8,2) NOT NULL,
  pack_info           VARCHAR(120),
  requires_prescription BOOLEAN DEFAULT FALSE,
  image_code          VARCHAR(4),                      -- 2-letter badge used in the UI, e.g. "AT"
  FOREIGN KEY (category_id) REFERENCES medicine_categories(id),
  INDEX idx_category (category_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. CART  (mirrors MH_STORE cart: [{id, qty}] per logged-in user)
-- ---------------------------------------------------------------------
CREATE TABLE cart_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(20) NOT NULL,
  medicine_id INT NOT NULL,
  qty         INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  UNIQUE KEY uq_user_medicine (user_id, medicine_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. ORDERS + ORDER ITEMS  (mirrors MH_STORE order objects)
-- ---------------------------------------------------------------------
CREATE TABLE orders (
  id             VARCHAR(20) PRIMARY KEY,                  -- e.g. "PH-9F3K2A"
  user_id        VARCHAR(20) NULL,
  name           VARCHAR(120) NOT NULL,
  address        VARCHAR(255) NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  total          DECIMAL(10,2) NOT NULL,
  payment_method ENUM('razorpay','cod') NOT NULL DEFAULT 'cod',
  payment_status ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
  razorpay_order_id   VARCHAR(64) NULL,
  razorpay_payment_id VARCHAR(64) NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      VARCHAR(20) NOT NULL,
  medicine_id   INT NULL,
  medicine_name VARCHAR(160) NOT NULL,                 -- snapshot of name/price at purchase time
  qty           INT NOT NULL,
  price         DECIMAL(8,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- 9. PAYMENTS  (Razorpay order log — created by razorpay-order.php,
--    marked 'verified' by razorpay-verify.php. appointments.php and
--    orders.php check this table before trusting any "paid" claim.)
-- ---------------------------------------------------------------------
CREATE TABLE payments (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  razorpay_order_id   VARCHAR(64)  NULL UNIQUE,        -- set for Checkout ("pay online") flow
  qr_code_id          VARCHAR(64)  NULL UNIQUE,        -- set for QR-code flow (payments/qr_codes/{id})
  razorpay_payment_id VARCHAR(64)  NULL,
  razorpay_signature  VARCHAR(128) NULL,
  purpose             ENUM('appointment','pharmacy') NOT NULL,
  method              ENUM('checkout','qr') NOT NULL DEFAULT 'checkout',
  ref_id              VARCHAR(64)  NULL,   -- doctor id for appointments, user id for pharmacy
  amount              DECIMAL(10,2) NOT NULL,  -- rupees, computed server-side, never trusted from client
  status              ENUM('created','verified','failed') DEFAULT 'created',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =====================================================================
-- SEED DATA
-- =====================================================================

-- ---- Specialties -------------------------------------------------
INSERT INTO specialties (name) VALUES
('Cardiology'),('Dermatology'),('Pediatrics'),('Orthopedics'),('Neurology'),
('Dentistry'),('Gynecology'),('General Medicine'),('Psychiatry'),
('Ophthalmology'),('ENT');

-- ---- Doctors: Parel -> Dadar corridor, Mumbai ---------------------
-- Areas covered along that stretch: Parel, Lower Parel, Dadar East,
-- Dadar West, Prabhadevi, Matunga.
INSERT INTO doctors (name, initials, specialty_id, clinic_name, area, address, rating, reviews, experience_years, consultation_fee, status, next_slot_label) VALUES
('Dr. Amar Patil',        'AP', (SELECT id FROM specialties WHERE name='Orthopedics'),      'Desai Memorial Hospital',      'Parel',        'Parmar Guruji Marg, Opp. KEM Hospital, Parel, Mumbai',        4.7, 156, 22, 600.00, 'available', 'Today, 4:30 PM'),
('Dr. Archana Patil',     'AP', (SELECT id FROM specialties WHERE name='Gynecology'),        'Dr Patil''s Parel Clinic',     'Parel',        'Desai Memorial Hospital, Parel, Mumbai',                       4.8, 214, 18, 700.00, 'available', 'Tomorrow, 10:00 AM'),
('Dr. Shailesh Shrikhande','SS', (SELECT id FROM specialties WHERE name='General Medicine'), 'Global Hospitals', 'Parel', 'D.E. Borges Road, Hospital Avenue, Parel, Mumbai', 4.9, 302, 23, 2000.00, 'available', 'Fri, 9:15 AM'),
('Dr. Raees Tonse',       'RT', (SELECT id FROM specialties WHERE name='General Medicine'), 'Tata Memorial Hospital',       'Parel',        'Dr. E Borges Road, Parel, Mumbai',                             4.8, 189, 12, 500.00, 'available', 'Today, 2:00 PM'),
('Dr. Jyoti Poddar',      'JP', (SELECT id FROM specialties WHERE name='Pediatrics'),        'Tata Memorial Hospital',       'Parel',        'Dr. E Borges Road, Parel, Mumbai',                             4.9, 241, 15, 550.00, 'available', 'Today, 5:45 PM'),
('Dr. Tushar Thorat',     'TT', (SELECT id FROM specialties WHERE name='Dermatology'),       'Parel Skin & Aesthetic Clinic','Lower Parel',  'Senapati Bapat Marg, Lower Parel, Mumbai',                     4.6, 132, 10, 800.00, 'available', 'Mon, 11:00 AM'),
('Dr. Sunita Deshmukh',   'SD', (SELECT id FROM specialties WHERE name='Ophthalmology'),     'Krishna Eye Centre',           'Dadar East',   'Ranade Road, Dadar East, Mumbai',                              4.8, 869, 35, 1500.00,'available', 'Today, 3:00 PM'),
('Dr. Vikram Save',       'VS', (SELECT id FROM specialties WHERE name='Ophthalmology'),     'Krishna Eye Centre',           'Dadar East',   'Ranade Road, Dadar East, Mumbai',                              4.9, 11,  28, 1500.00,'available', 'Wed, 4:00 PM'),
('Dr. Meera Kulkarni',    'MK', (SELECT id FROM specialties WHERE name='Dentistry'),         'Smile Again Dental Clinic',    'Dadar East',   'Gokhale Road, Dadar East, Mumbai',                             4.9, 589, 14, 500.00, 'available', 'Today, 4:30 PM'),
('Dr. Nikhil Bhagwat',    'NB', (SELECT id FROM specialties WHERE name='Neurology'),         'Shyamlata Clinic',             'Dadar West',   'Shivaji Park, Dadar West, Mumbai',                             4.7, 178, 30, 800.00, 'available', 'Tomorrow, 1:30 PM'),
('Dr. Priyanka Rao',      'PR', (SELECT id FROM specialties WHERE name='Psychiatry'),        'Wellmind Clinic',              'Prabhadevi',   'Veer Savarkar Marg, Prabhadevi, Mumbai',                       5.0, 98,  10, 900.00, 'available', 'Today, 3:00 PM'),
('Dr. Rohan Kamath',      'RK', (SELECT id FROM specialties WHERE name='ENT'),               'Insight ENT & Eye Clinic',     'Matunga',      'Kings Circle, Matunga, Mumbai',                                4.8, 283, 36, 2000.00,'available', 'Fri, 9:15 AM');

-- ---- Medicine categories ------------------------------------------
INSERT INTO medicine_categories (name) VALUES
('Pain Relief'),('Allergy'),('Antibiotic'),('Heart & Cholesterol'),
('Digestive Health'),('Diabetes Care'),('Respiratory'),('Wellness & Supplements');

-- ---- Medicines (same catalog as data.js, now relational) ----------
INSERT INTO medicines (name, category_id, price, pack_info, requires_prescription, image_code) VALUES
('Atorvastatin 10mg',    (SELECT id FROM medicine_categories WHERE name='Heart & Cholesterol'),   8.50, 'Strip of 10 tablets',   TRUE,  'AT'),
('Cetirizine 10mg',      (SELECT id FROM medicine_categories WHERE name='Allergy'),                3.25, 'Strip of 10 tablets',   FALSE, 'CT'),
('Amoxicillin 500mg',    (SELECT id FROM medicine_categories WHERE name='Antibiotic'),             6.75, 'Strip of 10 capsules',  TRUE,  'AM'),
('Paracetamol 500mg',    (SELECT id FROM medicine_categories WHERE name='Pain Relief'),            2.10, 'Strip of 15 tablets',   FALSE, 'PC'),
('Ibuprofen 400mg',      (SELECT id FROM medicine_categories WHERE name='Pain Relief'),            3.40, 'Strip of 10 tablets',   FALSE, 'IB'),
('Omeprazole 20mg',      (SELECT id FROM medicine_categories WHERE name='Digestive Health'),       5.90, 'Strip of 14 capsules',  TRUE,  'OM'),
('Metformin 500mg',      (SELECT id FROM medicine_categories WHERE name='Diabetes Care'),          4.60, 'Strip of 15 tablets',   TRUE,  'MT'),
('Vitamin D3 1000IU',    (SELECT id FROM medicine_categories WHERE name='Wellness & Supplements'), 7.20, 'Bottle of 60 softgels', FALSE, 'VD'),
('Multivitamin Daily',   (SELECT id FROM medicine_categories WHERE name='Wellness & Supplements'), 9.00, 'Bottle of 30 tablets',  FALSE, 'MV'),
('Salbutamol Inhaler',   (SELECT id FROM medicine_categories WHERE name='Respiratory'),           12.50, '1 inhaler, 200 doses',  TRUE,  'SB'),
('Loratadine 10mg',      (SELECT id FROM medicine_categories WHERE name='Allergy'),                3.10, 'Strip of 10 tablets',   FALSE, 'LR'),
('ORS Electrolyte Sachets',(SELECT id FROM medicine_categories WHERE name='Wellness & Supplements'),2.80,'Box of 10 sachets',    FALSE, 'OR');
