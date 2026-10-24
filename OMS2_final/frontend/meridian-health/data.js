// =========================================================
// Meridian Health frontend — API client
// Talks to the PHP + MySQL backend in ../php-backend/api/.
// Replaces the old mock DOCTORS/MEDICINES arrays and the
// localStorage-backed MH_STORE / MH_AUTH objects. Every method
// here returns a Promise — callers must await it.
//
// NOTE ON THE "doctor-1" MISMATCH (see doctor-dashboard.js):
// the old MH_STORE/DOCTORS were pure client-side mock data, so
// doctor-dashboard.js could invent "doctor id 1 = Dr. Amara Osei"
// out of thin air. Now that doctors come from the real database
// (meridian_health.sql), id 1 is whoever the DB says it is — the
// dashboard fetches that record instead of hardcoding a name.
// =========================================================

const MH_API_BASE = "../../backend/php-backend/api";

// Razorpay's public Key ID — safe to expose in frontend code, it's not a
// secret (the secret stays server-side in the PHP backend). Replace with
// your own rzp_test_/rzp_live_ key.
const RAZORPAY_KEY_ID = "rzp_test_Trp41wpeN4MlDz";

/** Shared fetch wrapper: JSON body in, JSON out, session cookie always sent. */
async function mhFetch(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    credentials: "include", // required so auth.php's PHP session cookie attaches
    headers: {},
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${MH_API_BASE}/${path}`, opts);
  } catch (networkErr) {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch (parseErr) {
    // non-JSON response (e.g. a raw PHP fatal error) — fall through with data = null
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function mhQueryString(params = {}) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

// =========================================================
// MH_STORE — doctors, appointments, doctor availability,
// pharmacy medicines/cart/orders. All backed by MySQL now.
// =========================================================
const MH_STORE = {
  // ---- doctors ----
  getDoctors(params = {}) {
    return mhFetch(`doctors.php${mhQueryString(params)}`);
  },
  getDoctor(id) {
    return mhFetch(`doctors.php${mhQueryString({ id })}`);
  },

  // ---- doctor availability ----
  getDoctorStatus(doctorId) {
    return mhFetch(`doctor-status.php${mhQueryString({ doctorId })}`).then((r) => r.status);
  },
  setDoctorStatus(doctorId, status) {
    return mhFetch("doctor-status.php", { method: "POST", body: { doctorId, status } });
  },

  // ---- appointments ----
  getAppointments(filter = {}) {
    return mhFetch(`appointments.php${mhQueryString(filter)}`);
  },
  addAppointment(appt) {
    return mhFetch("appointments.php", { method: "POST", body: appt });
  },
  updateAppointment(id, patch) {
    return mhFetch("appointment-update.php", { method: "POST", body: { id, ...patch } });
  },

  // ---- pharmacy: medicines ----
  getMedicines(params = {}) {
    return mhFetch(`medicines.php${mhQueryString(params)}`);
  },
  getMedicineCategories() {
    return mhFetch(`medicines.php${mhQueryString({ categories: 1 })}`);
  },

  // ---- pharmacy: cart (requires a logged-in userId) ----
  getCart(userId) {
    return mhFetch(`cart.php${mhQueryString({ userId })}`);
  },
  saveCartLine(userId, medicineId, qty) {
    return mhFetch("cart.php", { method: "POST", body: { userId, medicineId, qty } });
  },

  // ---- pharmacy: orders ----
  addOrder(order) {
    return mhFetch("orders.php", { method: "POST", body: order });
  },
  getOrder(id) {
    return mhFetch(`orders.php${mhQueryString({ id })}`);
  },
  getOrdersByUser(userId) {
    return mhFetch(`orders.php${mhQueryString({ userId })}`);
  },

  // ---- razorpay ----
  // type: "appointment" | "pharmacy". refId: doctorId for appointments,
  // left out for pharmacy (server totals the logged-in cart itself).
  // The backend recalculates the amount server-side either way — the
  // frontend never gets to say how much to charge.
  createRazorpayOrder({ type, refId, userId } = {}) {
    return mhFetch("razorpay-order.php", { method: "POST", body: { type, refId, userId } });
  },
  verifyRazorpayPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
    return mhFetch("razorpay-verify.php", {
      method: "POST",
      body: { razorpay_order_id, razorpay_payment_id, razorpay_signature },
    });
  },

  // ---- razorpay: QR code ("scan to pay") ----
  // Same server-side amount calculation as createRazorpayOrder — just
  // returns a scannable UPI QR image instead of opening the Checkout popup.
  createRazorpayQR({ type, refId, userId } = {}) {
    return mhFetch("razorpay-qr.php", { method: "POST", body: { type, refId, userId } });
  },
  // Poll this until it resolves { paid: true, razorpay_payment_id }.
  checkRazorpayQR(qrId) {
    return mhFetch(`razorpay-qr-status.php${mhQueryString({ qrId })}`);
  },
};

// =========================================================
// MH_RAZORPAY — thin wrapper around the Razorpay Checkout.js
// widget (loaded via <script src="https://checkout.razorpay.com/v1/checkout.js">
// on appointment.html / pharmacy.html). Handles opening the
// popup and resolving/rejecting based on success or dismissal.
// =========================================================
const MH_RAZORPAY = {
  /**
   * Opens Razorpay checkout for a given server-created order.
   * @param {Object} opts
   * @param {{id: string, amount: number, currency: string}} opts.order - result of MH_STORE.createRazorpayOrder()
   * @param {{name: string, email: string, contact?: string}} opts.prefill
   * @param {string} opts.description - shown in the Razorpay popup
   * @returns {Promise<{razorpay_order_id, razorpay_payment_id, razorpay_signature}>}
   *          Resolves with the raw payment response ONLY after Razorpay's
   *          client-side success callback fires. This is NOT proof of a
   *          real payment on its own — the caller must still send these
   *          three fields to MH_STORE.verifyRazorpayPayment() and only
   *          treat the payment as real once that call succeeds.
   */
  open({ order, prefill = {}, description = "" }) {
    return new Promise((resolve, reject) => {
      if (typeof Razorpay === "undefined") {
        reject(new Error("Payment gateway failed to load. Please refresh and try again."));
        return;
      }
      const rzp = new Razorpay({
        key: RAZORPAY_KEY_ID,
        amount: order.amount, // in paise, as returned by the backend
        currency: order.currency || "INR",
        name: "Meridian Health",
        description,
        order_id: order.id,
        prefill,
        theme: { color: "#1F5C4E" },
        handler: (response) => resolve(response),
        modal: {
          ondismiss: () => reject(new Error("Payment was cancelled.")),
        },
      });
      rzp.on("payment.failed", (response) => {
        reject(new Error(response?.error?.description || "Payment failed. Please try again."));
      });
      rzp.open();
    });
  },

  /**
   * Polls checkRazorpayQR(qrId) every `intervalMs` until it reports paid,
   * `timeoutMs` elapses, or the returned `cancel()` is called (e.g. the
   * user picks a different payment method mid-scan).
   * @returns {{ promise: Promise<{razorpay_payment_id:string}>, cancel: Function }}
   */
  pollQR(qrId, { intervalMs = 3000, timeoutMs = 1000 * 60 * 15 } = {}) {
    let stopped = false;
    let timer = null;
    let elapsed = 0;

    const promise = new Promise((resolve, reject) => {
      const tick = async () => {
        if (stopped) return;
        try {
          const result = await MH_STORE.checkRazorpayQR(qrId);
          if (stopped) return;
          if (result.paid) {
            resolve(result);
            return;
          }
        } catch (err) {
          if (stopped) return;
          reject(err);
          return;
        }
        elapsed += intervalMs;
        if (elapsed >= timeoutMs) {
          reject(new Error("QR code expired before payment was received. Please try again."));
          return;
        }
        timer = setTimeout(tick, intervalMs);
      };
      timer = setTimeout(tick, intervalMs);
    });

    return {
      promise,
      cancel() {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  },
};

// =========================================================
// MH_AUTH — real accounts + PHP session, replaces the old
// localStorage-backed register()/login()/getSession().
// =========================================================
const MH_AUTH = {
  register({ name, email, password, role }) {
    return mhFetch("auth.php?action=register", { method: "POST", body: { name, email, password, role } })
      .then((r) => ({ ok: true, user: r.user }))
      .catch((err) => ({ ok: false, error: err.message }));
  },
  login({ email, password, role }) {
    return mhFetch("auth.php?action=login", { method: "POST", body: { email, password, role } })
      .then((r) => ({ ok: true, user: r.user }))
      .catch((err) => ({ ok: false, error: err.message }));
  },
  logout() {
    return mhFetch("auth.php?action=logout", { method: "POST" }).catch(() => {});
  },
  // Returns the logged-in user ({id,name,email,role}) or null. Never throws.
  async session() {
    try {
      const r = await mhFetch("auth.php?action=session", { method: "POST" });
      return r.user || null;
    } catch (err) {
      return null;
    }
  },

  // Gate a page to a given role ("patient" | "provider"). Redirects to
  // login (preserving intent) if there's no matching active session.
  // Async because the session now lives server-side, not in localStorage.
  async requireAuth(role, loginUrl) {
    const user = await this.session();
    if (!user || user.role !== role) {
      const dest = loginUrl || (role === "provider" ? "login.html?role=doctor" : "login.html");
      window.location.href = dest;
      return null;
    }
    return user;
  },
};
