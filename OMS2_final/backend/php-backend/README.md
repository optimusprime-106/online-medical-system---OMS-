# Meridian Health — MySQL Database + PHP Backend (complete)

## What's here
- **`meridian_health.sql`** — the one database for the whole site. Run this first.
- **`api/`** — a minimal PHP (PDO + MySQL) API that reads/writes that database
  and sits right next to your existing `meridian-health/` frontend folder.

Every table in the schema now has a matching endpoint.

## 1. Create the database
```bash
mysql -u root -p < meridian_health.sql
```

## 2. Configure the backend
Open `config.php` — it reads DB credentials from environment variables
(`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`) with local defaults
(`localhost` / `meridian_health` / `root` / empty password). Either set
those env vars, or hardcode them in `config.php` for local dev.

It also reads `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` the same way.
Get your **test** keys from the Razorpay Dashboard → Settings → API Keys
(Test Mode). Set them as env vars, e.g.:
```bash
export RAZORPAY_KEY_ID="rzp_test_XXXXXXXXXXXXXX"
export RAZORPAY_KEY_SECRET="your_test_key_secret"
```
The Key ID also needs to be pasted into `frontend/meridian-health/data.js`
(`RAZORPAY_KEY_ID` constant) — that one's fine to expose publicly. The
Key Secret must **only** ever live here in the backend env, never in any
frontend file.

Test-mode card to use at checkout: `4111 1111 1111 1111`, any future
expiry, any CVC, any name. Test UPI VPA: `success@razorpay`.

## 3. Folder layout
```
htdocs/
├── meridian-health/      <- your existing HTML/CSS/JS frontend
│   ├── index.html
│   ├── data.js
│   └── ...
└── php-backend/
    ├── config.php
    └── api/
        ├── doctors.php
        ├── doctor-status.php
        ├── appointments.php
        ├── appointment-update.php
        ├── auth.php
        ├── medicines.php
        ├── cart.php
        └── orders.php
```
With XAMPP/MAMP/plain Apache+PHP, that's all you need — no build step.

## 4. Endpoints

### Doctors
- `GET /api/doctors.php` — replaces the hardcoded `DOCTORS` array
- `GET /api/doctors.php?area=Dadar East` — filter by locality
- `GET /api/doctors.php?specialty=Cardiology`
- `GET /api/doctors.php?id=3` — single doctor
- `GET /api/doctor-status.php?doctorId=1` — current availability
- `POST /api/doctor-status.php` `{ doctorId, status }` — replaces `MH_STORE.setDoctorStatus` (status: `available`|`busy`|`offline`)

### Appointments
- `POST /api/appointments.php` — replaces `MH_STORE.addAppointment`
- `GET /api/appointments.php?doctorId=1` — doctor portal's request list
- `GET /api/appointments.php?patientEmail=x@x.com` — patient dashboard list
- `POST /api/appointment-update.php` `{ id, status }` or `{ id, prescription: { meds, notes } }` — accept/reject, or attach a prescription

### Payments (Razorpay)
- `POST /api/razorpay-order.php` `{ type: "appointment"|"pharmacy", refId?, userId? }` —
  creates a Razorpay order. The amount is calculated here from the DB
  (doctor's fee, or the logged-in user's cart total) — never from the
  request body — and logged to the new `payments` table with status
  `created`.
- `POST /api/razorpay-verify.php` `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` —
  recomputes the HMAC-SHA256 signature with the key secret and, only if
  it matches, flips that `payments` row to `verified`.
- `appointments.php` and `orders.php` (`POST`) now require a matching
  `verified` row in `payments` before they'll mark anything as paid —
  they no longer trust a client-supplied `paid: true`.

### Auth
- `POST /api/auth.php?action=register` / `?action=login` / `?action=logout` / `?action=session` — replaces `MH_AUTH`, with bcrypt password hashing

### Pharmacy (new — previously missing)
- `GET /api/medicines.php` — replaces the hardcoded `MEDICINES` array
- `GET /api/medicines.php?category=Allergy` — filter by category
- `GET /api/medicines.php?search=cet` — search by name/category
- `GET /api/medicines.php?categories=1` — category chip labels, replaces `MEDICINE_CATEGORIES`
- `GET /api/cart.php?userId=U-XXXX` — replaces `MH_STORE.getCart()`
- `POST /api/cart.php` `{ userId, medicineId, qty }` — add/update/remove a line (qty ≤ 0 removes it), replaces `MH_STORE.saveCart()`
- `POST /api/orders.php` `{ userId?, name, address, phone, items: [{medicineId, name, qty, price}], total }` — places the order, clears that user's cart, replaces `MH_STORE.addOrder()`
- `GET /api/orders.php?id=PH-XXXX` — single order (used for the invoice download)
- `GET /api/orders.php?userId=U-XXXX` — a user's order history

**Note:** `cart_items` requires a logged-in user (`user_id` is `NOT NULL` in
the schema), so the pharmacy cart needs `auth.php` wired up first — a guest
can still browse `medicines.php`, but adding to cart needs a `userId` from
an active session.

## 5. Wire the frontend to it
Replace reads of `DOCTORS`/`MEDICINES`/`MH_STORE`/`MH_AUTH` in `data.js`,
`script.js`, `pharmacy.js`, and `doctor-dashboard.js` with `fetch()` calls to
the endpoints above. JSON shapes match the old in-memory objects field-for-
field, so render code needs little to no change. Example:

```js
async function loadDoctors() {
  const res = await fetch('/php-backend/api/doctors.php');
  return res.json(); // same shape as the old DOCTORS array
}
```

Since `auth.php` uses PHP sessions, include `credentials: 'include'` on every
`fetch()` call so the session cookie is sent/kept.

`razorpay-order.php` uses PHP's `curl` extension (`ext-curl`) to call the
Razorpay REST API directly — no Composer/SDK needed, so this still works
on plain PHP hosting with zero build step. Make sure `curl` is enabled
in `php.ini` (it is by default on most installs, including XAMPP/MAMP).

## Security notes for going to production
- `auth.php` already hashes passwords with `password_hash()` — don't remove that.
- Add CSRF protection and input validation before accepting real user data.
- Use HTTPS and set `session.cookie_secure` / `session.cookie_httponly` in `php.ini`.
- Restrict the MySQL user in `config.php` to only the privileges the app needs,
  rather than using `root`.
- Switch `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` to live keys only once
  you're ready to accept real payments, and keep the secret out of
  version control (use env vars, not a hardcoded fallback, in production).
- Consider also verifying payments via Razorpay's webhooks (Dashboard →
  Webhooks) as a second line of defense in case a user closes the tab
  right after paying but before `razorpay-verify.php` gets called.
