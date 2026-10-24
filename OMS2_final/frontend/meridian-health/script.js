// =========================================================
// Meridian Health — shared frontend behavior (no backend)
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initNavAuthState();
  initHeroWidget();
  initDoctorsPage();
  initAppointmentFlow();
  initAuthPage();
  initDashboard();
  initProfileForms();
});

/* =========================================================
   SHARED FORM VALIDATION ENGINE
   Used across every form in the app (auth, booking, checkout,
   profile, prescriptions) so validation behaves identically
   everywhere: same states, same messages, same a11y wiring.
   ========================================================= */
const MH_VALIDATORS = {
  required: (msg = "This field is required.") => ({
    test: (v) => v.trim().length > 0,
    message: msg,
  }),
  email: (msg = "Enter a valid email address.") => ({
    test: (v) => /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v.trim()),
    message: msg,
  }),
  minLength: (n, msg) => ({
    test: (v) => v.trim().length >= n,
    message: msg || `Must be at least ${n} characters.`,
  }),
  maxLength: (n, msg) => ({
    test: (v) => v.trim().length <= n,
    message: msg || `Must be ${n} characters or fewer.`,
  }),
  phone: (msg = "Enter a valid phone number (at least 7 digits).") => ({
    test: (v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15 && /^[\d\s()+-]+$/.test(v.trim());
    },
    message: msg,
  }),
  number: (msg = "Enter a valid number.") => ({
    test: (v) => v.trim() !== "" && !isNaN(Number(v)),
    message: msg,
  }),
  min: (n, msg) => ({
    test: (v) => Number(v) >= n,
    message: msg || `Must be at least ${n}.`,
  }),
  cardNumber: (msg = "Enter a valid 13–19 digit card number.") => ({
    test: (v) => {
      const digits = v.replace(/\s/g, "");
      return /^\d{13,19}$/.test(digits);
    },
    message: msg,
  }),
  cardExpiry: (msg = "Enter a valid future expiry date (MM / YY).") => ({
    test: (v) => {
      const m = v.trim().match(/^(\d{2})\s*\/\s*(\d{2})$/);
      if (!m) return false;
      const month = Number(m[1]);
      const year = 2000 + Number(m[2]);
      if (month < 1 || month > 12) return false;
      const expiry = new Date(year, month, 0, 23, 59, 59);
      return expiry >= new Date();
    },
    message: msg,
  }),
  cvc: (msg = "Enter a valid 3 or 4 digit CVC.") => ({
    test: (v) => /^\d{3,4}$/.test(v.trim()),
    message: msg,
  }),
  dateNotPast: (msg = "Date can't be in the past.") => ({
    test: (v) => {
      if (!v) return false;
      const chosen = new Date(v + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return chosen >= today;
    },
    message: msg,
  }),
  pattern: (regex, msg = "This value isn't valid.") => ({
    test: (v) => regex.test(v.trim()),
    message: msg,
  }),
};

/** Applies an error/success/idle visual state to a single input + its .field wrapper. */
function mhSetFieldState(input, state, message) {
  const field = input.closest(".field");
  input.classList.remove("error", "success");
  if (field) field.classList.remove("has-error", "has-success");
  const errEl = field ? field.querySelector(".error-msg") : null;
  const okEl = field ? field.querySelector(".field-success-msg") : null;

  if (state === "error") {
    input.classList.add("error");
    input.setAttribute("aria-invalid", "true");
    if (field) field.classList.add("has-error");
    if (errEl) {
      if (message) errEl.textContent = message;
      errEl.classList.add("show");
      if (!errEl.id) errEl.id = `err-${input.id || Math.random().toString(36).slice(2, 8)}`;
      input.setAttribute("aria-describedby", errEl.id);
    }
    if (okEl) okEl.classList.remove("show");
  } else if (state === "success") {
    input.classList.add("success");
    input.setAttribute("aria-invalid", "false");
    if (field) field.classList.add("has-success");
    if (errEl) errEl.classList.remove("show");
    if (okEl) okEl.classList.add("show");
  } else {
    input.setAttribute("aria-invalid", "false");
    if (errEl) errEl.classList.remove("show");
    if (okEl) okEl.classList.remove("show");
  }
}

/** Runs a list of validator rules against one field, in order, stopping at the first failure. */
function mhValidateField(input, rules, { showSuccess = true } = {}) {
  const value = input.value || "";
  for (const rule of rules) {
    if (!rule.test(value)) {
      mhSetFieldState(input, "error", rule.message);
      return false;
    }
  }
  if (value.trim() !== "" && showSuccess) mhSetFieldState(input, "success");
  else mhSetFieldState(input, "idle");
  return true;
}

/**
 * Wires "live" validation to a field: validates on blur, then re-validates on every
 * keystroke once the user has interacted with it once. This avoids nagging people with
 * red borders before they've had a chance to type anything.
 */
function mhWireLiveValidation(input, rules, opts) {
  if (!input) return () => true;
  let touched = false;
  input.addEventListener("blur", () => {
    touched = true;
    mhValidateField(input, rules, opts);
  });
  input.addEventListener("input", () => {
    if (touched) mhValidateField(input, rules, opts);
  });
  return () => mhValidateField(input, rules, opts);
}

/** Validates a set of {input, rules} pairs together (e.g. on submit); focuses the first invalid field. */
function mhValidateGroup(pairs) {
  let firstInvalid = null;
  let allValid = true;
  pairs.forEach(({ input, rules, opts }) => {
    if (!input) return;
    const ok = mhValidateField(input, rules, opts);
    if (!ok) {
      allValid = false;
      if (!firstInvalid) firstInvalid = input;
    }
  });
  if (firstInvalid) firstInvalid.focus();
  return allValid;
}

/** Simple password strength meter: renders 3 bars + label into a target element. */
function mhUpdatePasswordStrength(value, meterEl, labelEl) {
  if (!meterEl) return;
  let score = 0;
  if (value.length >= 8) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  meterEl.classList.remove("weak", "fair", "good");
  if (!value) {
    if (labelEl) labelEl.textContent = "";
    return;
  }
  if (score <= 1) {
    meterEl.classList.add("weak");
    if (labelEl) labelEl.textContent = "Weak password";
  } else if (score === 2) {
    meterEl.classList.add("fair");
    if (labelEl) labelEl.textContent = "Fair password";
  } else {
    meterEl.classList.add("good");
    if (labelEl) labelEl.textContent = "Strong password";
  }
}

/* ---------------- NAV ---------------- */
function initNav() {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (!toggle || !links) return;

  function closeMenu() {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    const nowOpen = !links.classList.contains("open");
    links.classList.toggle("open", nowOpen);
    toggle.setAttribute("aria-expanded", String(nowOpen));
  });

  // Close after choosing a destination, so the menu doesn't stay open after navigating
  links.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

  // Close on Escape, returning focus to the toggle button
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && links.classList.contains("open")) {
      closeMenu();
      toggle.focus();
    }
  });

  // Close on outside click/tap
  document.addEventListener("click", (e) => {
    if (links.classList.contains("open") && !links.contains(e.target) && !toggle.contains(e.target)) {
      closeMenu();
    }
  });
}

/* ---------------- HOME: HERO BOOKING WIDGET ---------------- */
function initHeroWidget() {
  const widget = document.querySelector("[data-hero-widget]");
  if (!widget) return;

  const docChips = widget.querySelectorAll(".doc-chip");
  const dateChips = widget.querySelectorAll(".date-chip");
  const timeChips = widget.querySelectorAll(".time-chip:not(:disabled)");
  const summary = widget.querySelector("[data-summary]");

  let state = { doc: null, date: null, time: null };

  function pick(group, el, key, textFn) {
    group.forEach((c) => c.classList.remove("selected"));
    el.classList.add("selected");
    state[key] = textFn(el);
    updateSummary();
  }

  docChips.forEach((el) =>
    el.addEventListener("click", () => pick(docChips, el, "doc", (e) => e.querySelector("span").textContent))
  );
  dateChips.forEach((el) =>
    el.addEventListener("click", () => pick(dateChips, el, "date", (e) => e.querySelector(".d").textContent + " " + e.querySelector(".n").textContent))
  );
  timeChips.forEach((el) =>
    el.addEventListener("click", () => pick(timeChips, el, "time", (e) => e.textContent.trim()))
  );

  function updateSummary() {
    if (!summary) return;
    if (state.doc && state.date && state.time) {
      summary.innerHTML = `You're booking <strong>${state.doc}</strong> on <strong>${state.date}</strong> at <strong>${state.time}</strong>.`;
    } else {
      summary.innerHTML = `Pick a doctor, day, and time to see your booking summary here.`;
    }
  }
  updateSummary();

  const bookBtn = widget.querySelector("[data-hero-book]");
  if (bookBtn) {
    bookBtn.addEventListener("click", () => {
      window.location.href = "appointment.html";
    });
  }
}

/* ---------------- DOCTORS PAGE ---------------- */
function initDoctorsPage() {
  const grid = document.querySelector("[data-doctors-grid]");
  if (!grid) return;

  const searchInput = document.querySelector("[data-doc-search]");
  const chipWrap = document.querySelector("[data-spec-chip]")?.parentElement;
  const countEl = document.querySelector("[data-results-count]");
  const sortSelect = document.querySelector("[data-doc-sort]");

  let activeSpec = "All";
  let query = "";
  let sortBy = "recommended";
  let allDoctors = [];

  const SORTERS = {
    recommended: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    rating: (a, b) => b.rating - a.rating,
    experience: (a, b) => parseInt(b.exp, 10) - parseInt(a.exp, 10),
    "fee-low": (a, b) => a.fee - b.fee,
    "fee-high": (a, b) => b.fee - a.fee,
  };

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      sortBy = e.target.value;
      render();
    });
  }

  // Build the specialty filter chips from whatever specialties are actually
  // present in the fetched doctors, so a newly-seeded specialty (e.g. one not
  // among the original 9) still gets a working filter chip.
  function renderSpecChips() {
    if (!chipWrap) return;
    const specs = Array.from(new Set(allDoctors.map((d) => d.spec))).sort();
    chipWrap.innerHTML = ["All", ...specs]
      .map((s) => `<button type="button" class="filter-chip${s === activeSpec ? " active" : ""}" data-spec-chip="${s}">${s}</button>`)
      .join("");
    chipWrap.querySelectorAll("[data-spec-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        chipWrap.querySelectorAll("[data-spec-chip]").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        activeSpec = chip.dataset.specChip;
        render();
      });
    });
  }

  function render() {
    const filtered = allDoctors.filter((d) => {
      const matchesSpec = activeSpec === "All" || d.spec === activeSpec;
      const matchesQuery = d.name.toLowerCase().includes(query.toLowerCase()) || d.spec.toLowerCase().includes(query.toLowerCase());
      return matchesSpec && matchesQuery;
    }).sort(SORTERS[sortBy] || SORTERS.recommended);

    countEl.textContent = `${filtered.length} doctor${filtered.length !== 1 ? "s" : ""} found`;

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="col-12">${mhEmptyState({
        icon: MH_ICONS.search,
        title: "No doctors match your search",
        subtitle: "Try a different specialty or search a doctor's name.",
        actionHtml: `<button type="button" class="btn btn-ghost btn-sm" data-clear-doctor-filters>Clear filters</button>`,
      })}</div>`;
      const clearBtn = grid.querySelector("[data-clear-doctor-filters]");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          activeSpec = "All";
          query = "";
          if (searchInput) searchInput.value = "";
          document.querySelectorAll("[data-spec-chip]").forEach((b) => b.classList.toggle("active", b.dataset.specChip === "All"));
          render();
        });
      }
      return;
    }

    grid.innerHTML = filtered
      .map(
        (d) => `
      <div class="col-12 col-sm-6 col-lg-4">
      <div class="doc-card-full card">
        <div class="doc-photo">${d.initials}</div>
        <div class="doc-info">
          <h3>${d.name}</h3>
          <div class="spec">${d.spec}</div>
          <div class="tags">
            <span class="tag">${d.exp} exp.</span>
            <span class="tag amber">★ ${d.rating.toFixed(1)} (${d.reviews})</span>
          </div>
          <div class="avail">
            <span>Next available</span>
            <span class="next">${d.next}</span>
          </div>
          <div class="actions">
            <a class="btn btn-primary btn-sm btn-block" href="appointment.html?doctor=${encodeURIComponent(d.name)}">Book visit</a>
          </div>
        </div>
      </div>
      </div>`
      )
      .join("");
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      query = e.target.value;
      render();
    });
  }

  // Fetch the real doctor list from the backend; subsequent filtering/searching
  // re-renders instantly from the cached `allDoctors` (no re-fetch per keystroke).
  MH_STORE.getDoctors()
    .then((doctors) => {
      allDoctors = doctors;
      renderSpecChips();
      render();
    })
    .catch((err) => {
      countEl.textContent = "0 doctors found";
      grid.innerHTML = `<div class="col-12">${mhEmptyState({
        icon: MH_ICONS.search,
        title: "Couldn't load doctors",
        subtitle: "Please refresh the page to try again.",
      })}</div>`;
      console.error(err);
    });
}

/* ---------------- APPOINTMENT BOOKING FLOW ---------------- */
function initAppointmentFlow() {
  const shell = document.querySelector("[data-booking-flow]");
  if (!shell) return;

  const steps = Array.from(shell.querySelectorAll(".form-step"));
  const progressSteps = Array.from(document.querySelectorAll(".progress-step"));
  const progressLines = Array.from(document.querySelectorAll(".progress-line"));
  let current = 0;

  const state = { specialty: null, doctor: null, date: null, time: null, name: "", email: "", phone: "", reason: "", paymentMethod: null, paid: false, apptId: null };

  // populate doctor list (step 2) — filtered by specialty if chosen
  const docListEl = document.querySelector("[data-doc-select-list]");
  let allDoctors = [];

  function renderDocList() {
    const list = state.specialty ? allDoctors.filter((d) => d.spec === state.specialty) : allDoctors;
    docListEl.innerHTML = list
      .map(
        (d) => `
      <div class="doc-select-row" data-doc-id="${d.id}">
        <div class="avatar">${d.initials}</div>
        <div class="info">
          <h4>${d.name}</h4>
          <span>${d.spec} · ★ ${d.rating.toFixed(1)} · ₹${d.fee}/visit</span>
        </div>
        <div class="radio-dot"></div>
      </div>`
      )
      .join("");
    attachDocListeners();
  }
  function attachDocListeners() {
    docListEl.querySelectorAll(".doc-select-row").forEach((row) => {
      row.addEventListener("click", () => {
        docListEl.querySelectorAll(".doc-select-row").forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
        const doc = allDoctors.find((d) => d.id == row.dataset.docId);
        state.doctor = doc;
        updateSummary();
      });
    });
  }

  // specialty selection (step 1) — wired once per card, including any
  // extra cards appended below for specialties the static markup doesn't cover
  function wireSpecCard(card) {
    card.addEventListener("click", () => {
      document.querySelectorAll("[data-spec-card]").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.specialty = card.dataset.spec;
      renderDocList();
      updateSummary();
    });
  }
  document.querySelectorAll("[data-spec-card]").forEach(wireSpecCard);

  const specGrid = document.querySelector(".spec-grid");
  const genericSpecIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>`;

  // Fetch the real doctor list, then finish wiring everything that depends on it:
  // the doctor picker, any specialty not already covered by a static card, and
  // preselecting a doctor coming in via ?doctor= from doctors.html.
  const doctorsLoaded = MH_STORE.getDoctors()
    .then((doctors) => {
      allDoctors = doctors;

      // Add a card for any specialty present in the real data that the static
      // markup doesn't already have (e.g. a newly-seeded specialty).
      if (specGrid) {
        const existingSpecs = new Set(Array.from(document.querySelectorAll("[data-spec-card]")).map((c) => c.dataset.spec));
        const extraSpecs = Array.from(new Set(allDoctors.map((d) => d.spec))).filter((s) => !existingSpecs.has(s));
        extraSpecs.forEach((spec) => {
          const col = document.createElement("div");
          col.className = "col-6 col-md-4";
          col.innerHTML = `<div class="spec-card" data-spec-card data-spec="${spec}"><div class="ic">${genericSpecIcon}</div><span>${spec}</span></div>`;
          specGrid.appendChild(col);
          wireSpecCard(col.querySelector("[data-spec-card]"));
        });
      }

      if (docListEl) {
        renderDocList();
        const preselect = new URLSearchParams(window.location.search).get("doctor");
        if (preselect) {
          const match = allDoctors.find((d) => d.name === preselect);
          if (match) {
            state.doctor = match;
            state.specialty = match.spec;
            const specCard = document.querySelector(`.spec-card[data-spec="${match.spec}"]`);
            if (specCard) specCard.classList.add("selected");
            renderDocList();
            updateSummary();
          }
        }
      }
    })
    .catch((err) => {
      if (docListEl) {
        docListEl.innerHTML = mhEmptyState({
          icon: MH_ICONS.search,
          title: "Couldn't load doctors",
          subtitle: "Please refresh the page to try again.",
        });
      }
      console.error(err);
    });

  // date chips (step 3)
  document.querySelectorAll("[data-appt-date]").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll("[data-appt-date]").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      state.date = el.querySelector(".d").textContent + " " + el.querySelector(".n").textContent;
      updateSummary();
    });
  });
  document.querySelectorAll("[data-appt-time]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.disabled) return;
      document.querySelectorAll("[data-appt-time]").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      state.time = el.textContent.trim();
      updateSummary();
    });
  });

  // step 4 form fields
  ["name", "email", "phone", "reason"].forEach((field) => {
    const input = document.querySelector(`[name="${field}"]`);
    if (input) {
      input.addEventListener("input", (e) => {
        state[field] = e.target.value;
        updateSummary();
      });
    }
  });

  // step 4 — live validation (name/email required, phone optional-but-valid-if-filled, reason char counter)
  const nameInput = document.querySelector('[name="name"]');
  const emailInput = document.querySelector('[name="email"]');
  const phoneInput = document.querySelector('[name="phone"]');
  const reasonInput = document.querySelector('[name="reason"]');
  mhWireLiveValidation(nameInput, [MH_VALIDATORS.required("Please enter your full name."), MH_VALIDATORS.minLength(2, "Name must be at least 2 characters.")]);
  mhWireLiveValidation(emailInput, [MH_VALIDATORS.required("Please enter your email address."), MH_VALIDATORS.email("Please enter a valid email address.")]);
  if (phoneInput) {
    phoneInput.addEventListener("blur", () => {
      if (phoneInput.value.trim()) mhValidateField(phoneInput, [MH_VALIDATORS.phone()]);
      else mhSetFieldState(phoneInput, "idle");
    });
    phoneInput.addEventListener("input", () => {
      if (phoneInput.classList.contains("error") || phoneInput.classList.contains("success")) {
        phoneInput.value.trim() ? mhValidateField(phoneInput, [MH_VALIDATORS.phone()]) : mhSetFieldState(phoneInput, "idle");
      }
    });
  }
  if (reasonInput) {
    const counter = document.querySelector('[data-char-count="reason-count"]');
    const updateCount = () => {
      if (!counter) return;
      const len = reasonInput.value.length;
      counter.textContent = `${len}/300`;
      counter.classList.toggle("near-limit", len >= 260 && len < 300);
      counter.classList.toggle("at-limit", len >= 300);
    };
    reasonInput.addEventListener("input", updateCount);
    updateCount();
  }

  function updateSummary() {
    const s = document.querySelector("[data-booking-summary]");
    if (!s) return;
    s.querySelector("[data-sum-doctor]").textContent = state.doctor ? state.doctor.name : "—";
    s.querySelector("[data-sum-spec]").textContent = state.specialty || "—";
    s.querySelector("[data-sum-date]").textContent = state.date || "—";
    s.querySelector("[data-sum-time]").textContent = state.time || "—";
    s.querySelector("[data-sum-fee]").textContent = state.doctor ? `₹${state.doctor.fee}` : "₹—";
  }
  updateSummary();

  function goToStep(index) {
    steps.forEach((s, i) => s.classList.toggle("active", i === index));
    progressSteps.forEach((s, i) => {
      s.classList.toggle("done", i < index);
      s.classList.toggle("active", i === index);
    });
    progressLines.forEach((l, i) => l.classList.toggle("done", i < index));
    current = index;
    window.scrollTo({ top: shell.offsetTop - 100, behavior: "smooth" });
  }

  function stepNotice(message) {
    const panel = steps[current].querySelector(".step-panel");
    let notice = panel.querySelector(".step-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "step-notice";
      notice.setAttribute("role", "alert");
      const nav = panel.querySelector(".form-nav");
      panel.insertBefore(notice, nav);
    }
    notice.textContent = message;
    notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function clearStepNotice() {
    const notice = steps[current].querySelector(".step-notice");
    if (notice) notice.remove();
  }

  function validateStep(index) {
    if (index === 0 && !state.specialty) {
      stepNotice("Please choose a specialty to continue.");
      return false;
    }
    if (index === 1 && !state.doctor) {
      stepNotice("Please select a doctor to continue.");
      return false;
    }
    if (index === 2 && (!state.date || !state.time)) {
      stepNotice("Please select both a date and a time slot.");
      return false;
    }
    if (index === 3) {
      const nameInput = document.querySelector('[name="name"]');
      const emailInput = document.querySelector('[name="email"]');
      const phoneInput = document.querySelector('[name="phone"]');
      const pairs = [
        { input: nameInput, rules: [MH_VALIDATORS.required("Please enter your full name."), MH_VALIDATORS.minLength(2, "Name must be at least 2 characters.")] },
        { input: emailInput, rules: [MH_VALIDATORS.required("Please enter your email address."), MH_VALIDATORS.email("Please enter a valid email address.")] },
      ];
      if (phoneInput && phoneInput.value.trim()) pairs.push({ input: phoneInput, rules: [MH_VALIDATORS.phone()] });
      if (!mhValidateGroup(pairs)) {
        stepNotice("Please fix the highlighted fields before continuing.");
        return false;
      }
    }
    if (index === 4 && !state.paymentMethod) {
      stepNotice("Please choose a payment method to continue.");
      return false;
    }
    clearStepNotice();
    return true;
  }

  // ---- Payment step (feature: payment method + QR code) ----
  const payCards = document.querySelectorAll("[data-pay-method]");
  const payDetailPanels = document.querySelectorAll("[data-pay-detail]");
  const payConfirmBtn = document.querySelector("[data-pay-confirm-btn]");

  function currentFee() {
    return state.doctor ? state.doctor.fee : 0;
  }

  function updatePayConfirmLabel() {
    if (!payConfirmBtn) return;
    if (!state.paymentMethod) {
      payConfirmBtn.textContent = "Select a payment method";
      payConfirmBtn.disabled = true;
      return;
    }
    payConfirmBtn.disabled = false;
    if (state.paymentMethod === "razorpay") payConfirmBtn.textContent = `Pay ₹${currentFee()} & confirm`;
    else if (state.paymentMethod === "qr") payConfirmBtn.textContent = `Generate QR for ₹${currentFee()}`;
    else payConfirmBtn.textContent = "Confirm booking (pay at visit)";
  }

  payCards.forEach((card) => {
    card.addEventListener("click", () => {
      payCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.paymentMethod = card.dataset.payMethod;

      payDetailPanels.forEach((panel) => {
        panel.style.display = panel.dataset.payDetail === state.paymentMethod ? "block" : "none";
      });

      if (state.paymentMethod === "razorpay") {
        const amtEl = document.querySelector("[data-razorpay-amount]");
        if (amtEl) amtEl.textContent = `₹${currentFee()}`;
      }
      if (state.paymentMethod === "qr") {
        const qrAmt = document.querySelector("[data-qr-amount]");
        if (qrAmt) qrAmt.textContent = `₹${currentFee()}`;
        resetQRPanel();
      }
      if (state.paymentMethod === "cash") {
        const cashAmt = document.querySelector("[data-cash-amount]");
        if (cashAmt) cashAmt.textContent = `₹${currentFee()}`;
      }
      if (state.paymentMethod !== "qr") stopQRPolling();

      updatePayConfirmLabel();
    });
  });

  // ---- QR payment panel state ----
  let activeQRPoll = null;
  function resetQRPanel() {
    const box = document.querySelector("[data-qr-box]");
    const status = document.querySelector("[data-qr-status]");
    if (box) box.style.display = "none";
    if (status) status.textContent = "Waiting for payment…";
  }
  function stopQRPolling() {
    if (activeQRPoll) {
      activeQRPoll.cancel();
      activeQRPoll = null;
    }
  }

  if (payConfirmBtn) {
    payConfirmBtn.addEventListener("click", async () => {
      if (!state.paymentMethod) return;

      if (state.paymentMethod === "cash") {
        state.paid = false;
        goToStep(current + 1);
        fillConfirmation();
        return;
      }

      if (state.paymentMethod === "qr") {
        const originalText = payConfirmBtn.textContent;
        payConfirmBtn.disabled = true;
        payConfirmBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Generating QR code…`;

        const box = document.querySelector("[data-qr-box]");
        const img = document.querySelector("[data-qr-image]");
        const status = document.querySelector("[data-qr-status]");

        try {
          const qr = await MH_STORE.createRazorpayQR({
            type: "appointment",
            refId: state.doctor ? state.doctor.id : null,
          });

          if (img) img.src = qr.imageUrl;
          if (box) box.style.display = "block";
          if (status) status.textContent = "Waiting for payment…";
          payConfirmBtn.textContent = "Waiting for payment…";

          stopQRPolling();
          activeQRPoll = MH_RAZORPAY.pollQR(qr.qrId);
          const payment = await activeQRPoll.promise;
          activeQRPoll = null;

          if (status) status.textContent = "Payment received ✓";
          state.razorpayPayment = { razorpay_payment_id: payment.razorpay_payment_id };
          state.paid = true;

          payConfirmBtn.disabled = false;
          payConfirmBtn.textContent = originalText;
          goToStep(current + 1);
          fillConfirmation();
        } catch (err) {
          payConfirmBtn.disabled = false;
          payConfirmBtn.textContent = originalText;
          if (status) status.textContent = "";
          stepNotice(err.message || "Payment couldn't be completed. Please try again.");
          console.error(err);
        }
        return;
      }

      // state.paymentMethod === "razorpay"
      const originalText = payConfirmBtn.textContent;
      payConfirmBtn.disabled = true;
      payConfirmBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Opening payment…`;

      try {
        // 1. Ask the backend for a Razorpay order. The backend looks up
        //    the doctor's fee itself — it does NOT trust currentFee() from
        //    the client — so this amount can't be tampered with.
        const order = await MH_STORE.createRazorpayOrder({
          type: "appointment",
          refId: state.doctor ? state.doctor.id : null,
        });

        // 2. Open the Razorpay popup and wait for the user to pay.
        const payment = await MH_RAZORPAY.open({
          order,
          description: `Consultation with ${state.doctor ? state.doctor.name : "doctor"}`,
          prefill: { name: state.name, email: state.email, contact: state.phone },
        });

        // 3. Have the backend verify the signature before trusting it.
        payConfirmBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Verifying payment…`;
        await MH_STORE.verifyRazorpayPayment(payment);
        state.razorpayPayment = payment;
        state.paid = true;

        payConfirmBtn.disabled = false;
        payConfirmBtn.textContent = originalText;
        goToStep(current + 1);
        fillConfirmation();
      } catch (err) {
        payConfirmBtn.disabled = false;
        payConfirmBtn.textContent = originalText;
        stepNotice(err.message || "Payment couldn't be completed. Please try again.");
        console.error(err);
      }
    });
  }

  document.querySelectorAll("[data-next-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!validateStep(current)) return;
      if (current < steps.length - 1) {
        goToStep(current + 1);
        if (current === steps.length - 1) fillConfirmation();
      }
    });
  });
  document.querySelectorAll("[data-prev-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopQRPolling();
      if (current > 0) goToStep(current - 1);
    });
  });

  async function fillConfirmation() {
    const box = document.querySelector("[data-confirm-box]");
    if (!box) return;
    box.querySelector("[data-confirm-doctor]").textContent = state.doctor ? state.doctor.name : "";
    box.querySelector("[data-confirm-datetime]").textContent = `${state.date || ""} · ${state.time || ""}`;
    box.querySelector("[data-confirm-code]").textContent = "Booking…";

    // avoid re-saving if the user navigates back and forth onto this step
    if (!state.apptId) {
      try {
        const appt = await MH_STORE.addAppointment({
          doctorId: state.doctor ? state.doctor.id : null,
          patientName: state.name,
          patientEmail: state.email,
          patientPhone: state.phone,
          date: state.date,
          time: state.time,
          reason: state.reason,
          fee: currentFee(),
          paid: state.paid,
          paymentMethod: state.paymentMethod,
          razorpayOrderId: state.razorpayPayment ? state.razorpayPayment.razorpay_order_id : undefined,
          razorpayPaymentId: state.razorpayPayment ? state.razorpayPayment.razorpay_payment_id : undefined,
        });
        state.apptId = appt.id; // real, server-assigned id — not a client-side guess
      } catch (err) {
        box.querySelector("[data-confirm-code]").textContent = "—";
        mhToast("We couldn't confirm your booking with the server. Please try again.", "error");
        console.error(err);
        return;
      }
    }
    box.querySelector("[data-confirm-code]").textContent = state.apptId;

    const banner = document.querySelector("[data-confirm-pay-banner]");
    if (banner) {
      if (state.paid) {
        banner.textContent = `Payment received via Razorpay — ₹${currentFee()} paid.`;
        banner.classList.remove("unpaid");
      } else {
        banner.textContent = `No payment collected — please pay ₹${currentFee()} at your visit.`;
        banner.classList.add("unpaid");
      }
    }

    const invoiceBtn = document.querySelector("[data-download-invoice-btn]");
    if (invoiceBtn) {
      invoiceBtn.onclick = () => {
        if (typeof MH_STORE === "undefined" || typeof MH_PDF === "undefined") {
          mhToast("Couldn't generate the invoice. Please try again.", "error");
          return;
        }
        mhWithButtonLoading(invoiceBtn, "Preparing…", async () => {
          const appt = await MH_STORE.getAppointments({ id: state.apptId });
          MH_PDF.downloadInvoice(appt);
        });
      };
    }
  }
}

/* ---------------- NAV AUTH STATE ---------------- */
// Keeps the top-right nav honest on every page, based on whether there's an
// active MH_AUTH session — not hardcoded markup. Logged-out visitors keep
// seeing "Doctor login / Log in / Get started"; logged-in visitors get a
// small profile icon (initials avatar) with a dropdown for Dashboard/Log out.
function mhEscapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mhInitials(nameOrEmail) {
  const source = (nameOrEmail || "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function initNavAuthState() {
  const ctaBox = document.querySelector(".nav-cta");
  if (!ctaBox || typeof MH_AUTH === "undefined") return;
  // The dashboard pages already gate the whole page on being logged in and
  // wire their own logout confirmation + redirect, so leave those alone.
  if (ctaBox.querySelector("[data-logout-link]")) return;

  const session = await MH_AUTH.session();
  if (!session) return; // logged out: keep the default Doctor login / Log in / Get started markup

  const isProvider = session.role === "provider";
  const dashboardUrl = isProvider ? "doctor-dashboard.html" : "dashboard.html";
  const loginUrl = isProvider ? "login.html?role=doctor" : "login.html";
  const displayName = session.name || session.email || "Account";

  ctaBox.innerHTML = `
    <div class="nav-profile" data-nav-profile>
      <button type="button" class="nav-profile-btn" data-nav-profile-btn aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
        <span class="nav-profile-avatar">${mhEscapeHtml(mhInitials(displayName))}</span>
      </button>
      <div class="nav-profile-menu" data-nav-profile-menu>
        <div class="nav-profile-name">${mhEscapeHtml(displayName)}</div>
        <a href="${dashboardUrl}">${isProvider ? "Doctor dashboard" : "Dashboard"}</a>
        <button type="button" data-nav-logout>Log out</button>
      </div>
    </div>
  `;

  const btn = ctaBox.querySelector("[data-nav-profile-btn]");
  const menu = ctaBox.querySelector("[data-nav-profile-menu]");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
  document.addEventListener("click", (e) => {
    if (!ctaBox.contains(e.target)) {
      menu.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  ctaBox.querySelector("[data-nav-logout]").addEventListener("click", () => {
    menu.classList.remove("open");
    mhConfirm({
      title: "Log out of Meridian?",
      message: "You'll need to sign back in to view your appointments and records.",
      confirmLabel: "Log out",
      cancelLabel: "Stay logged in",
      tone: "default",
      onConfirm: async () => {
        await MH_AUTH.logout();
        window.location.href = loginUrl;
      },
    });
  });
}

/* ---------------- AUTH PAGE ---------------- */
async function initAuthPage() {
  const tabs = document.querySelectorAll("[data-auth-tab]");
  if (!tabs.length) return;

  const existingSession = typeof MH_AUTH !== "undefined" ? await MH_AUTH.session() : null;
  if (existingSession) {
    window.location.href = existingSession.role === "provider" ? "doctor-dashboard.html" : "dashboard.html";
    return;
  }

  // preselect "I'm a provider" when arriving via login.html?role=doctor
  const wantsDoctor = new URLSearchParams(window.location.search).get("role") === "doctor";
  if (wantsDoctor) {
    document.querySelectorAll(".role-toggle").forEach((group) => {
      const opts = group.querySelectorAll("[data-role-opt]");
      if (opts[1]) {
        opts.forEach((o) => o.classList.remove("selected"));
        opts[1].classList.add("selected");
      }
    });
  }

  function activateTab(tab) {
    tabs.forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
      t.tabIndex = -1;
    });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    tab.tabIndex = 0;
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    const panel = document.querySelector(`[data-auth-form="${tab.dataset.authTab}"]`);
    if (panel) panel.classList.add("active");
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => activateTab(tab));

    // WAI-ARIA tabs pattern: arrow keys move focus + selection between tabs
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      activateTab(next);
    });
  });

  // preselect the "Create account" tab when arriving via login.html?tab=register
  // (used by "Get started" links elsewhere on the site)
  const wantsTab = new URLSearchParams(window.location.search).get("tab");
  if (wantsTab) {
    const targetTab = document.querySelector(`[data-auth-tab="${wantsTab}"]`);
    if (targetTab) activateTab(targetTab);
  }

  // Role toggle ("I'm a patient" / "I'm a provider"): click + keyboard (radio pattern)
  document.querySelectorAll(".role-toggle").forEach((group) => {
    const opts = Array.from(group.querySelectorAll("[data-role-opt]"));

    function select(opt) {
      opts.forEach((o) => {
        o.classList.remove("selected");
        o.setAttribute("aria-checked", "false");
        o.tabIndex = -1;
      });
      opt.classList.add("selected");
      opt.setAttribute("aria-checked", "true");
      opt.tabIndex = 0;
    }

    opts.forEach((opt, i) => {
      opt.addEventListener("click", () => select(opt));
      opt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(opt);
        } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const next = opts[(i + (e.key === "ArrowRight" ? 1 : opts.length - 1)) % opts.length];
          next.focus();
          select(next);
        }
      });
    });
  });

  // Password show/hide toggles
  document.querySelectorAll("[data-pw-toggle]").forEach((btn) => {
    const input = document.getElementById(btn.dataset.pwToggle);
    if (!input) return;
    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.setAttribute("aria-pressed", String(!showing));
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });

  // Forgot password modal
  const forgotLink = document.querySelector("[data-forgot-password]");
  const forgotModalEl = document.querySelector("#forgotPasswordModal");
  if (forgotLink && forgotModalEl && window.bootstrap) {
    const forgotModal = new bootstrap.Modal(forgotModalEl);
    const forgotEmail = forgotModalEl.querySelector("#forgot-email");
    const forgotSuccess = forgotModalEl.querySelector("#forgot-success");
    const sendBtn = forgotModalEl.querySelector("#forgot-send-btn");
    const rule = [MH_VALIDATORS.required("Enter your email address."), MH_VALIDATORS.email()];
    mhWireLiveValidation(forgotEmail, rule, { showSuccess: false });

    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      forgotSuccess.classList.remove("show");
      forgotEmail.value = "";
      mhSetFieldState(forgotEmail, "idle");
      forgotModal.show();
    });

    sendBtn.addEventListener("click", () => {
      if (!mhValidateField(forgotEmail, rule, { showSuccess: false })) return;
      mhWithButtonLoading(sendBtn, "Sending…", () => {
        forgotSuccess.classList.add("show");
      });
    });
  }

  document.querySelectorAll(".auth-form").forEach((form) => {
    const isRegister = form.dataset.authForm === "register";
    const nameInput = form.querySelector('input[type="text"]');
    const emailInput = form.querySelector('input[type="email"]');
    const passwordInput = form.querySelector('input[type="password"]');
    const submitBtn = form.querySelector('button[type="submit"]');

    const fieldRules = [];
    if (isRegister && nameInput) {
      fieldRules.push({ input: nameInput, rules: [MH_VALIDATORS.required("Please enter your name."), MH_VALIDATORS.minLength(2, "Name must be at least 2 characters.")] });
    }
    if (emailInput) {
      fieldRules.push({ input: emailInput, rules: [MH_VALIDATORS.required("Email address is required."), MH_VALIDATORS.email()] });
    }
    if (passwordInput) {
      fieldRules.push({
        input: passwordInput,
        rules: isRegister
          ? [MH_VALIDATORS.required("Password is required."), MH_VALIDATORS.minLength(8, "Password must be at least 8 characters.")]
          : [MH_VALIDATORS.required("Password is required.")],
      });
    }

    fieldRules.forEach(({ input, rules }) => mhWireLiveValidation(input, rules));

    // live password-strength meter on registration
    if (isRegister && passwordInput) {
      const strengthWrap = document.createElement("div");
      strengthWrap.className = "pw-strength";
      strengthWrap.innerHTML = "<span></span><span></span><span></span>";
      const strengthLabel = document.createElement("div");
      strengthLabel.className = "pw-strength-label";
      strengthLabel.setAttribute("aria-live", "polite");
      passwordInput.closest(".field").insertAdjacentElement("afterend", strengthLabel);
      passwordInput.closest(".field").insertAdjacentElement("afterend", strengthWrap);
      passwordInput.addEventListener("input", () => mhUpdatePasswordStrength(passwordInput.value, strengthWrap, strengthLabel));
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mhValidateGroup(fieldRules)) return;

      const roleGroup = form.querySelector(".role-toggle");
      const isProvider = roleGroup
        ? roleGroup.querySelector("[data-role-opt]:nth-child(2)").classList.contains("selected")
        : false;
      const role = isProvider ? "provider" : "patient";

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> ${isRegister ? "Creating account…" : "Logging in…"}`;
      }

      (async () => {
        let result;
        try {
          result = isRegister
            ? await MH_AUTH.register({ name: nameInput ? nameInput.value : "", email: emailInput.value, password: passwordInput.value, role })
            : await MH_AUTH.login({ email: emailInput.value, password: passwordInput.value, role });
        } catch (err) {
          result = { ok: false, error: "Something went wrong. Please try again." };
        }

        if (!result.ok) {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset.originalText;
          }
          mhToast(result.error, "error");
          return;
        }

        window.location.href = role === "provider" ? "doctor-dashboard.html" : "dashboard.html";
      })();
    });
  });
}

/* ---------------- PROFILE FORMS (patient dashboard + doctor dashboard) ---------------- */
function initProfileForms() {
  document.querySelectorAll("[data-save-profile]").forEach((btn) => {
    const card = btn.closest(".panel-card") || document;
    const statusEl = card.querySelector("[data-save-status]");

    const pairs = [];
    const nameInput = card.querySelector("#p-name, #d-name");
    const emailInput = card.querySelector("#p-email");
    const phoneInput = card.querySelector("#p-phone");
    const dobInput = card.querySelector("#p-dob");
    const specInput = card.querySelector("#d-spec");
    const feeInput = card.querySelector("#d-fee");

    if (nameInput) pairs.push({ input: nameInput, rules: [MH_VALIDATORS.required("Please enter your full name."), MH_VALIDATORS.minLength(2, "Name must be at least 2 characters.")] });
    if (emailInput) pairs.push({ input: emailInput, rules: [MH_VALIDATORS.required("Email address is required."), MH_VALIDATORS.email()] });
    if (phoneInput) pairs.push({ input: phoneInput, rules: [MH_VALIDATORS.required("Phone number is required."), MH_VALIDATORS.phone()] });
    if (dobInput) pairs.push({ input: dobInput, rules: [MH_VALIDATORS.required("Please enter your date of birth.")] });
    if (specInput) pairs.push({ input: specInput, rules: [MH_VALIDATORS.required("Please enter your specialty.")] });
    if (feeInput) pairs.push({ input: feeInput, rules: [MH_VALIDATORS.required("Please enter a consultation fee."), MH_VALIDATORS.number(), MH_VALIDATORS.min(0, "Fee can't be negative.")] });

    pairs.forEach(({ input, rules }) => mhWireLiveValidation(input, rules));

    btn.addEventListener("click", () => {
      if (!mhValidateGroup(pairs)) {
        if (statusEl) {
          statusEl.textContent = "Please fix the highlighted fields.";
          statusEl.style.color = "var(--pulse)";
          statusEl.classList.add("show");
        }
        return;
      }

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Saving…`;
      if (statusEl) statusEl.classList.remove("show");

      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
        if (statusEl) {
          statusEl.textContent = "Saved";
          statusEl.style.color = "var(--success)";
          statusEl.classList.add("show");
          window.setTimeout(() => statusEl.classList.remove("show"), 3000);
        }
      }, 500);
    });
  });
}

/* ---------------- EMPTY STATE + TOAST HELPERS (shared across all pages) ---------------- */
const MH_ICONS = {
  search: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  cart: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.6 12.6a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6"/></svg>`,
  inbox: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>`,
  clipboard: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/></svg>`,
  calendar: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
};

/** Renders a standardized empty-state block (icon + heading + subtext + optional action). */
function mhEmptyState({ icon = MH_ICONS.inbox, title, subtitle = "", actionHtml = "" } = {}) {
  return `
    <div class="empty-state">
      <div class="ic">${icon}</div>
      <h4>${title}</h4>
      ${subtitle ? `<p>${subtitle}</p>` : ""}
      ${actionHtml}
    </div>`;
}

/**
 * Lightweight toast notification system used for action feedback that doesn't already
 * have a dedicated confirmation screen (e.g. accept/reject, prescription sent, cart adds).
 * Types: "success" | "error" | "warning" | "info"
 */
function mhToast(message, type = "success", duration = 4000) {
  let container = document.querySelector(".toast-stack");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-stack";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    document.body.appendChild(container);
  }
  const icons = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M4 12l5 5L20 6"/></svg>`,
    error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>`,
    info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>`,
  };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-ic">${icons[type] || icons.info}</span>
    <span class="toast-msg">${message}</span>
    <button type="button" class="toast-close" aria-label="Dismiss notification">×</button>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  const remove = () => {
    toast.classList.remove("show");
    toast.classList.add("hide");
    window.setTimeout(() => toast.remove(), 250);
  };
  const timer = window.setTimeout(remove, duration);
  toast.querySelector(".toast-close").addEventListener("click", () => {
    window.clearTimeout(timer);
    remove();
  });
  return toast;
}

/**
 * Wraps a button in a consistent loading state (spinner + disabled) while `fn` runs.
 * Guarantees a minimum visible duration so fast/instant actions (like local PDF
 * generation) don't just flicker — the loading state should always be perceptible.
 */
function mhWithButtonLoading(btn, loadingText, fn, minDuration = 350) {
  if (!btn) return fn();
  const originalHTML = btn.innerHTML;
  const originalWidth = btn.getBoundingClientRect().width;
  btn.style.minWidth = `${originalWidth}px`;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> ${loadingText}`;
  const started = Date.now();
  const restore = () => {
    const elapsed = Date.now() - started;
    const wait = Math.max(0, minDuration - elapsed);
    window.setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
      btn.style.minWidth = "";
    }, wait);
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      result.then(restore).catch((err) => {
        restore();
        mhToast("Something went wrong. Please try again.", "error");
        console.error(err);
      });
    } else {
      restore();
    }
  } catch (e) {
    restore();
    mhToast("Something went wrong. Please try again.", "error");
    console.error(e);
  }
}

/**
 * Shared confirmation dialog — replaces native confirm()/window.confirm popups
 * everywhere in the app (reject requests, cancellations, deletions, etc.) with a
 * proper on-brand, animated, accessible modal. Built once and reused, same lazy-
 * creation pattern as mhToast's container above.
 *
 * Usage:
 *   mhConfirm({
 *     title: "Reject this request?",
 *     message: "The patient will be notified. This can't be undone.",
 *     confirmLabel: "Reject request",
 *     tone: "danger", // "danger" | "default"
 *     onConfirm: () => { ... }
 *   });
 */
function mhConfirm({
  title = "Are you sure?",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
} = {}) {
  const icons = {
    default: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>`,
    danger: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>`,
  };

  let el = document.getElementById("mhConfirmModal");
  if (!el) {
    el = document.createElement("div");
    el.className = "modal fade";
    el.id = "mhConfirmModal";
    el.tabIndex = -1;
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("aria-labelledby", "mhConfirmModalTitle");
    el.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="position:absolute; top:18px; right:18px; z-index:2;"></button>
          <div class="modal-body confirm-modal-body">
            <div class="confirm-modal-icon" data-confirm-icon></div>
            <h2 id="mhConfirmModalTitle" data-confirm-title></h2>
            <p class="sub" data-confirm-message></p>
            <div class="confirm-modal-actions">
              <button type="button" class="btn btn-ghost" data-bs-dismiss="modal" data-confirm-cancel></button>
              <button type="button" class="btn" data-confirm-ok></button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  el.querySelector("[data-confirm-title]").textContent = title;
  el.querySelector("[data-confirm-message]").textContent = message;
  el.querySelector("[data-confirm-cancel]").textContent = cancelLabel;

  const iconWrap = el.querySelector("[data-confirm-icon]");
  iconWrap.className = `confirm-modal-icon${tone === "danger" ? " danger" : ""}`;
  iconWrap.innerHTML = icons[tone] || icons.default;

  // Swap the OK button for a fresh clone so previous calls' click listeners don't stack up.
  const oldOkBtn = el.querySelector("[data-confirm-ok]");
  const okBtn = oldOkBtn.cloneNode(true);
  oldOkBtn.parentNode.replaceChild(okBtn, oldOkBtn);
  okBtn.textContent = confirmLabel;
  okBtn.className = `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`;
  okBtn.addEventListener("click", () => {
    modalInstance.hide();
    if (typeof onConfirm === "function") onConfirm();
  });

  const modalInstance = bootstrap.Modal.getOrCreateInstance(el);
  modalInstance.show();
}

/* ---------------- DASHBOARD ---------------- */
async function initDashboard() {
  const dash = document.querySelector("[data-dashboard]");
  if (!dash) return;

  // Require a logged-in patient session — bounce to login instead of
  // silently showing demo data to a signed-out visitor.
  const session = await MH_AUTH.requireAuth("patient");
  if (!session) return;

  const firstName = (session.name || "").trim().split(/\s+/)[0] || "there";
  const initials = (session.name || "")
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const nameEl = document.querySelector("[data-user-name]");
  if (nameEl) nameEl.textContent = session.name || session.email;
  const idEl = document.querySelector("[data-user-id]");
  if (idEl) idEl.textContent = `Patient ID #${session.id}`;
  const avatarEl = document.querySelector("[data-user-avatar]");
  if (avatarEl) avatarEl.textContent = initials;
  const welcomeEl = document.querySelector("[data-user-welcome]");
  if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}.`;
  const nameInputEl = document.querySelector("[data-user-name-input]");
  if (nameInputEl) nameInputEl.value = session.name || "";
  const emailInputEl = document.querySelector("[data-user-email-input]");
  if (emailInputEl) emailInputEl.value = session.email || "";

  const navButtons = Array.from(document.querySelectorAll("[data-dash-nav]"));
  const panels = document.querySelectorAll(".dash-panel");

  function activatePanel(btn) {
    navButtons.forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
      b.tabIndex = -1;
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    btn.tabIndex = 0;
    panels.forEach((p) => p.classList.remove("active"));
    const panel = document.querySelector(`[data-dash-panel="${btn.dataset.dashNav}"]`);
    if (panel) panel.classList.add("active");
  }

  navButtons.forEach((btn, i) => {
    btn.addEventListener("click", () => activatePanel(btn));
    // Vertical tablist: Up/Down moves focus + selection between sections
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const next = navButtons[(i + (e.key === "ArrowDown" ? 1 : navButtons.length - 1)) % navButtons.length];
      next.focus();
      activatePanel(next);
    });
  });

  const cancelButtons = document.querySelectorAll("[data-cancel-appt]");
  cancelButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".appt-row");
      if (!row) return;
      const doctorName = row.querySelector("h4")?.textContent || "";
      mhConfirm({
        title: "Cancel this appointment?",
        message: doctorName ? `Your appointment with ${doctorName} will be cancelled. This can't be undone.` : "This appointment will be cancelled. This can't be undone.",
        confirmLabel: "Cancel appointment",
        cancelLabel: "Keep appointment",
        tone: "danger",
        onConfirm: () => {
          row.style.opacity = "0.4";
          btn.textContent = "Cancelled";
          btn.disabled = true;
          mhToast(`Appointment${doctorName ? ` with ${doctorName}` : ""} cancelled.`, "warning");
        },
      });
    });
  });

  // Document preview modal (Records tab)
  const docModalEl = document.querySelector("#docPreviewModal");
  if (docModalEl && window.bootstrap) {
    const docModal = bootstrap.Modal.getOrCreateInstance(docModalEl);
    document.querySelectorAll("[data-view-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        docModalEl.querySelector("[data-doc-preview-title]").textContent = btn.dataset.docTitle || "Document";
        docModalEl.querySelector("[data-doc-preview-from]").textContent = btn.dataset.docFrom || "";
        docModalEl.querySelector("[data-doc-preview-date]").textContent = btn.dataset.docDate || "";
        docModal.show();
      });
    });
  }

  // Log out: confirm before ending the session
  document.querySelectorAll("[data-logout-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      mhConfirm({
        title: "Log out of Meridian?",
        message: "You'll need to sign back in to view your appointments and records.",
        confirmLabel: "Log out",
        cancelLabel: "Stay logged in",
        tone: "default",
        onConfirm: async () => {
          await MH_AUTH.logout();
          window.location.href = link.href;
        },
      });
    });
  });

  document.querySelectorAll("[data-sortable]").forEach(mhMakeSortable);

  renderDynamicAppointmentsAndPrescriptions(session.email);
}

/**
 * Makes a plain HTML table sortable by clicking its column headers.
 * Headers opt in with data-sort-key="text" | "date" | "number".
 * Reusable across any .dash-table (or other table) in the app.
 */
function mhMakeSortable(table) {
  const headers = Array.from(table.querySelectorAll("th[data-sort-key]"));
  if (!headers.length) return;

  headers.forEach((th) => {
    if (!th.querySelector(".sort-ic")) {
      th.insertAdjacentHTML("beforeend", ` <span class="sort-ic" aria-hidden="true">▲</span>`);
    }
    th.setAttribute("role", "button");
    th.setAttribute("tabindex", "0");
    th.setAttribute("aria-sort", "none");

    function sort() {
      const type = th.dataset.sortKey;
      const colIndex = Array.from(th.parentElement.children).indexOf(th);
      const tbody = table.querySelector("tbody");
      const rows = Array.from(tbody.querySelectorAll("tr"));
      const ascending = th.getAttribute("aria-sort") !== "ascending";

      const getValue = (row) => row.children[colIndex]?.textContent.trim() || "";
      rows.sort((a, b) => {
        let va = getValue(a), vb = getValue(b);
        if (type === "date") {
          va = new Date(va).getTime() || 0;
          vb = new Date(vb).getTime() || 0;
        } else if (type === "number") {
          va = parseFloat(va) || 0;
          vb = parseFloat(vb) || 0;
        }
        if (va < vb) return ascending ? -1 : 1;
        if (va > vb) return ascending ? 1 : -1;
        return 0;
      });

      headers.forEach((h) => h.setAttribute("aria-sort", "none"));
      th.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      rows.forEach((r) => tbody.appendChild(r));
    }

    th.addEventListener("click", sort);
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        sort();
      }
    });
  });
}

/* ---------------- DASHBOARD: appointments booked via the payment flow
   and prescriptions written by doctors in the doctor portal (added) ---------------- */
async function renderDynamicAppointmentsAndPrescriptions(patientEmail) {
  if (typeof MH_STORE === "undefined" || !patientEmail) return;

  let appts = [];
  try {
    appts = await MH_STORE.getAppointments({ patientEmail });
  } catch (err) {
    console.error(err);
    return;
  }

  const apptsCard = document.querySelector("[data-dynamic-appts-card]");
  const apptsWrap = document.querySelector("[data-dynamic-appts]");
  if (apptsWrap) {
    if (appts.length) {
      apptsCard.style.display = "block";
      apptsWrap.innerHTML = appts
        .map((a) => {
          const statusClass = a.status === "rejected" ? "rejected" : a.status === "completed" ? "completed" : a.status === "accepted" ? "confirmed" : "pending";
          const statusLabel = a.status.charAt(0).toUpperCase() + a.status.slice(1);
          return `
        <div class="appt-row">
          <div class="date-badge"><span class="m">${(a.date || "").split(" ")[0] || "—"}</span><span class="d">${(a.date || "").split(" ")[1] || ""}</span></div>
          <div class="info"><h4>${a.doctorName} — ${a.specialty}</h4><span>${a.time || ""} · ${a.paid ? "Paid" : "Pay at visit"} · ₹${a.fee}</span></div>
          <span class="status ${statusClass}">${statusLabel}</span>
          <button type="button" class="btn btn-ghost btn-sm" style="margin-left:14px;" data-download-invoice="${a.id}">Invoice</button>
        </div>`;
        })
        .join("");
      apptsWrap.querySelectorAll("[data-download-invoice]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (typeof MH_PDF === "undefined") {
            mhToast("Couldn't generate the invoice. Please try again.", "error");
            return;
          }
          mhWithButtonLoading(btn, "Preparing…", async () => {
            const appt = await MH_STORE.getAppointments({ id: btn.dataset.downloadInvoice });
            MH_PDF.downloadInvoice(appt);
          });
        });
      });
    }
  }

  const rxCard = document.querySelector("[data-dynamic-rx-card]");
  const rxWrap = document.querySelector("[data-dynamic-rx]");
  if (rxWrap) {
    const withRx = appts.filter((a) => a.prescription);
    if (withRx.length) {
      rxCard.style.display = "block";
      rxWrap.innerHTML = withRx
        .map(
          (a) => `
        <div class="rx-existing">
          <h5>${a.doctorName} — ${a.specialty} · ${a.date || ""}</h5>
          <ul>
            ${(a.prescription.meds || []).map((m) => `<li>${m.name} — ${m.dosage}, ${m.freq}</li>`).join("")}
          </ul>
          ${a.prescription.notes ? `<p style="margin-top:8px; color:var(--ink-soft); font-size:13px;">${a.prescription.notes}</p>` : ""}
          <button type="button" class="btn btn-primary btn-sm download-rx-btn" data-download-rx="${a.id}">Download prescription (PDF)</button>
        </div>`
        )
        .join("");
      rxWrap.querySelectorAll("[data-download-rx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (typeof MH_PDF === "undefined") {
            mhToast("Couldn't generate the prescription PDF. Please try again.", "error");
            return;
          }
          mhWithButtonLoading(btn, "Preparing…", async () => {
            const appt = await MH_STORE.getAppointments({ id: btn.dataset.downloadRx });
            MH_PDF.downloadPrescription(appt);
          });
        });
      });
    }
  }
}
