// =========================================================
// doctor-dashboard.js — powers doctor-dashboard.html.
//
// Demo note: there's still no real "which doctor is logged in"
// link between a provider account and a row in the `doctors`
// table (the DB schema has doctors.user_id for that, but nothing
// wires it up yet on registration), so this portal still acts as
// a single fixed demo doctor (CURRENT_DOCTOR_ID = 1).
//
// The fix vs. the old version: id 1 used to be hardcoded here as
// "Dr. Amara Osei" / Cardiology, made up independently of the
// database. Now the dashboard fetches doctor id 1 from the real
// backend and renders whatever is actually seeded there (currently
// "Dr. Amar Patil", Orthopedics) — so the name/specialty/fee shown
// always match what the rest of the site (and appointments.doctor_id)
// actually points to.
// =========================================================

document.addEventListener("DOMContentLoaded", async () => {
  const shell = document.querySelector("[data-doctor-dashboard]");
  if (!shell) return;

  // Require a logged-in provider session — bounce to login instead of
  // silently showing demo data to a signed-out visitor.
  const session = typeof MH_AUTH !== "undefined" ? await MH_AUTH.requireAuth("provider") : null;
  if (!session) return;

  const logoutLink = document.querySelector("[data-logout-link]");
  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      const proceed = async () => {
        await MH_AUTH.logout();
        window.location.href = logoutLink.href;
      };
      if (typeof mhConfirm === "function") {
        mhConfirm({
          title: "Log out of Meridian?",
          message: "You'll need to sign back in to view your appointment requests and patients.",
          confirmLabel: "Log out",
          cancelLabel: "Stay logged in",
          tone: "default",
          onConfirm: proceed,
        });
      } else {
        proceed();
      }
    });
  }

  const CURRENT_DOCTOR_ID = 1; // demo logged-in doctor — see file header

  let doctorInfo = { id: CURRENT_DOCTOR_ID, name: "Doctor", spec: "", fee: 0, initials: "DR" };
  try {
    doctorInfo = await MH_STORE.getDoctor(CURRENT_DOCTOR_ID);
  } catch (err) {
    mhToast("Couldn't load your doctor profile. Showing limited info.", "error");
    console.error(err);
  }

  // Render the real, database-backed doctor identity into the sidebar +
  // profile form (previously these were hardcoded HTML strings).
  const profileCard = document.querySelector(".dash-profile");
  if (profileCard) {
    const avatarEl = profileCard.querySelector(".avatar");
    const nameEl = profileCard.querySelector("strong");
    const specEl = profileCard.querySelector("span");
    if (avatarEl) avatarEl.textContent = doctorInfo.initials || "DR";
    if (nameEl) nameEl.textContent = doctorInfo.name || "Doctor";
    if (specEl) specEl.textContent = doctorInfo.spec ? `${doctorInfo.spec}` : "";
  }
  const dNameInput = document.getElementById("d-name");
  const dSpecInput = document.getElementById("d-spec");
  const dFeeInput = document.getElementById("d-fee");
  if (dNameInput) dNameInput.value = doctorInfo.name || "";
  if (dSpecInput) dSpecInput.value = doctorInfo.spec || "";
  if (dFeeInput) dFeeInput.value = doctorInfo.fee != null ? doctorInfo.fee : "";

  /* ---------------- side nav switching ---------------- */
  const navButtons = document.querySelectorAll("[data-dash-nav]");
  const panels = document.querySelectorAll(".dash-panel");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      navButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      panels.forEach((p) => p.classList.remove("active"));
      document.querySelector(`[data-dash-panel="${btn.dataset.dashNav}"]`).classList.add("active");
    });
  });

  /* ---------------- availability toggle ---------------- */
  const availToggle = document.querySelector("[data-availability-toggle]");
  const availLabel = document.querySelector("[data-availability-label]");
  const availSelect = document.querySelector("[data-availability-select]");

  function applyAvailability(status) {
    if (availLabel) {
      availLabel.textContent = status === "available" ? "Available" : "Not available";
      availLabel.classList.toggle("available", status === "available");
      availLabel.classList.toggle("unavailable", status === "unavailable");
    }
    if (availToggle) availToggle.checked = status === "available";
    if (availSelect) availSelect.value = status;
  }

  try {
    const savedStatus = typeof MH_STORE !== "undefined" ? await MH_STORE.getDoctorStatus(CURRENT_DOCTOR_ID) : "available";
    applyAvailability(savedStatus);
  } catch (err) {
    applyAvailability("available");
    console.error(err);
  }

  if (availToggle) {
    availToggle.addEventListener("change", async () => {
      const status = availToggle.checked ? "available" : "unavailable";
      applyAvailability(status); // optimistic
      try {
        await MH_STORE.setDoctorStatus(CURRENT_DOCTOR_ID, status);
      } catch (err) {
        mhToast("Couldn't update your availability. Please try again.", "error");
        console.error(err);
      }
    });
  }
  if (availSelect) {
    availSelect.addEventListener("change", async () => {
      const status = availSelect.value;
      applyAvailability(status); // optimistic
      try {
        await MH_STORE.setDoctorStatus(CURRENT_DOCTOR_ID, status);
      } catch (err) {
        mhToast("Couldn't update your availability. Please try again.", "error");
        console.error(err);
      }
    });
  }

  /* ---------------- appointment requests ---------------- */
  async function myAppointments() {
    try {
      return await MH_STORE.getAppointments({ doctorId: CURRENT_DOCTOR_ID });
    } catch (err) {
      mhToast("Couldn't load your appointments. Please refresh.", "error");
      console.error(err);
      return [];
    }
  }

  function statusPill(status) {
    const cls = status === "rejected" ? "rejected" : status === "completed" ? "completed" : status === "accepted" ? "confirmed" : "pending";
    return `<span class="status ${cls}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
  }

  async function renderRequests() {
    const list = await myAppointments();
    const pending = list.filter((a) => a.status === "pending");
    const history = list.filter((a) => a.status !== "pending");

    document.querySelector("[data-pending-count]").textContent = pending.length;

    const pendingWrap = document.querySelector("[data-requests-pending]");
    pendingWrap.innerHTML = pending.length
      ? pending
          .map(
            (a) => `
      <div class="appt-request-row">
        <div class="info">
          <h4>${a.patientName || "Patient"} · ${a.specialty}</h4>
          <span>${a.date || ""} · ${a.time || ""} · ₹${a.fee} · ${a.paid ? "Paid" : "Pay at visit"}</span>
          ${a.reason ? `<span class="reason">"${a.reason}"</span>` : ""}
        </div>
        <div class="request-actions">
          <button type="button" class="btn btn-primary btn-sm" data-accept-appt="${a.id}">Accept</button>
          <button type="button" class="btn btn-ghost btn-sm" data-reject-appt="${a.id}">Reject</button>
        </div>
      </div>`
          )
          .join("")
      : mhEmptyState({ icon: MH_ICONS.inbox, title: "No pending requests", subtitle: "New booking requests from patients will show up here." });

    pendingWrap.querySelectorAll("[data-accept-appt]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const patient = list.find((a) => a.id === btn.dataset.acceptAppt)?.patientName || "Patient";
        mhWithButtonLoading(btn, "Accepting…", async () => {
          await MH_STORE.updateAppointment(btn.dataset.acceptAppt, { status: "accepted" });
          await renderRequests();
          await renderAccepted();
          mhToast(`Accepted appointment for ${patient}.`, "success");
        });
      })
    );
    pendingWrap.querySelectorAll("[data-reject-appt]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const patient = list.find((a) => a.id === btn.dataset.rejectAppt)?.patientName || "this patient";
        mhConfirm({
          title: "Reject this request?",
          message: `${patient} will be notified that their appointment request was declined. This can't be undone.`,
          confirmLabel: "Reject request",
          tone: "danger",
          onConfirm: () => {
            mhWithButtonLoading(btn, "Rejecting…", async () => {
              await MH_STORE.updateAppointment(btn.dataset.rejectAppt, { status: "rejected" });
              await renderRequests();
              mhToast(`Rejected appointment for ${patient}.`, "warning");
            });
          },
        });
      })
    );

    const historyWrap = document.querySelector("[data-requests-history]");
    historyWrap.innerHTML = history.length
      ? history
          .map(
            (a) => `
      <div class="appt-request-row">
        <div class="info">
          <h4>${a.patientName || "Patient"} · ${a.specialty}</h4>
          <span>${a.date || ""} · ${a.time || ""}</span>
        </div>
        ${statusPill(a.status)}
      </div>`
          )
          .join("")
      : mhEmptyState({ icon: MH_ICONS.clipboard, title: "Nothing here yet", subtitle: "Requests you've accepted, rejected, or completed will appear here." });
  }

  /* ---------------- accepted visits + prescriptions ---------------- */
  async function renderAccepted() {
    const list = await myAppointments();
    const accepted = list.filter((a) => a.status === "accepted" || a.status === "completed");
    const wrap = document.querySelector("[data-accepted-list]");
    wrap.innerHTML = accepted.length
      ? accepted
          .map((a) => {
            const rxSummary = a.prescription
              ? `<div class="rx-existing"><h5>Prescription sent</h5><ul>${(a.prescription.meds || [])
                  .map((m) => `<li>${m.name} — ${m.dosage}, ${m.freq}</li>`)
                  .join("")}</ul></div>`
              : "";
            return `
        <div class="appt-request-row">
          <div class="info">
            <h4>${a.patientName || "Patient"} · ${a.specialty}</h4>
            <span>${a.date || ""} · ${a.time || ""} · ₹${a.fee}</span>
            ${a.reason ? `<span class="reason">"${a.reason}"</span>` : ""}
            ${rxSummary}
          </div>
          <div class="request-actions">
            ${statusPill(a.status)}
            <button type="button" class="btn btn-primary btn-sm" data-write-rx="${a.id}">
              ${a.prescription ? "Edit prescription" : "Write prescription"}
            </button>
          </div>
        </div>`;
          })
          .join("")
      : mhEmptyState({ icon: MH_ICONS.calendar, title: "No accepted visits yet", subtitle: "Accept a pending request to start writing prescriptions." });

    wrap.querySelectorAll("[data-write-rx]").forEach((btn) =>
      btn.addEventListener("click", () => openRxModal(btn.dataset.writeRx, list))
    );
  }

  /* ---------------- prescription modal ---------------- */
  const modalEl = document.getElementById("rxModal");
  const rxModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const rowsWrap = document.querySelector("[data-rx-med-rows]");
  let activeApptId = null;
  let rowCount = 0;

  // Whatever closes the modal (Cancel, the × button, backdrop click, or Escape —
  // all handled automatically by Bootstrap) should clear the active appointment.
  modalEl.addEventListener("hidden.bs.modal", () => {
    activeApptId = null;
  });

  function medRowHtml(idx, med = {}) {
    return `
    <div class="rx-med-row" data-rx-row="${idx}">
      <div class="field" style="margin:0;"><label>Medicine</label><input type="text" data-rx-name value="${med.name || ""}" placeholder="e.g. Amoxicillin 500mg"><span class="error-msg">Medicine name is required.</span></div>
      <div class="field" style="margin:0;"><label>Dosage</label><input type="text" data-rx-dosage value="${med.dosage || ""}" placeholder="1 tablet"><span class="error-msg">Dosage is required.</span></div>
      <div class="field" style="margin:0;"><label>Frequency</label><input type="text" data-rx-freq value="${med.freq || ""}" placeholder="Twice daily, 5 days"><span class="error-msg">Frequency is required.</span></div>
      <button type="button" class="remove-row" data-rx-remove-row="${idx}" title="Remove" aria-label="Remove this medicine row">×</button>
    </div>`;
  }

  function addRxRow(med) {
    rowCount += 1;
    rowsWrap.insertAdjacentHTML("beforeend", medRowHtml(rowCount, med));
    rowsWrap.querySelector(`[data-rx-remove-row="${rowCount}"]`).addEventListener("click", (e) => {
      e.target.closest("[data-rx-row]").remove();
    });
  }

  function openRxModal(apptId, list) {
    activeApptId = apptId;
    const appt = list.find((a) => a.id === apptId);
    if (!appt) return;
    document.querySelector("[data-rx-modal-sub]").textContent = `${appt.patientName || "Patient"} — ${appt.specialty} — ${appt.date || ""} ${appt.time || ""}`;
    rowsWrap.innerHTML = "";
    rowCount = 0;
    if (appt.prescription && appt.prescription.meds && appt.prescription.meds.length) {
      appt.prescription.meds.forEach((m) => addRxRow(m));
    } else {
      addRxRow();
    }
    document.getElementById("rx-notes").value = appt.prescription ? appt.prescription.notes || "" : "";
    const notice = document.querySelector("[data-rx-notice]");
    if (notice) notice.style.display = "none";
    rxModal.show();
  }

  function closeRxModal() {
    rxModal.hide();
  }

  document.querySelector("[data-rx-add-row]").addEventListener("click", () => addRxRow());

  const rxNotice = document.querySelector("[data-rx-notice]");
  function showRxNotice(message) {
    if (!rxNotice) return;
    rxNotice.textContent = message;
    rxNotice.style.display = "block";
  }
  function clearRxNotice() {
    if (!rxNotice) return;
    rxNotice.style.display = "none";
  }

  document.querySelector("[data-rx-send]").addEventListener("click", () => {
    if (!activeApptId) return;
    const rows = Array.from(rowsWrap.querySelectorAll("[data-rx-row]"));

    // rows the doctor has started filling in — every field is required once any field has content
    const activeRows = rows.filter((row) => {
      const name = row.querySelector("[data-rx-name]").value.trim();
      const dosage = row.querySelector("[data-rx-dosage]").value.trim();
      const freq = row.querySelector("[data-rx-freq]").value.trim();
      return name || dosage || freq;
    });

    if (!activeRows.length) {
      showRxNotice("Add at least one medicine before sending the prescription.");
      return;
    }

    let allValid = true;
    activeRows.forEach((row) => {
      const pairs = [
        { input: row.querySelector("[data-rx-name]"), rules: [MH_VALIDATORS.required("Medicine name is required.")] },
        { input: row.querySelector("[data-rx-dosage]"), rules: [MH_VALIDATORS.required("Dosage is required.")] },
        { input: row.querySelector("[data-rx-freq]"), rules: [MH_VALIDATORS.required("Frequency is required.")] },
      ];
      if (!mhValidateGroup(pairs)) allValid = false;
    });

    if (!allValid) {
      showRxNotice("Please complete every field for each medicine, or remove the incomplete row.");
      return;
    }
    clearRxNotice();

    const meds = activeRows.map((row) => ({
      name: row.querySelector("[data-rx-name]").value.trim(),
      dosage: row.querySelector("[data-rx-dosage]").value.trim(),
      freq: row.querySelector("[data-rx-freq]").value.trim(),
    }));

    const notes = document.getElementById("rx-notes").value.trim();
    const sendBtn = document.querySelector("[data-rx-send]");
    const originalText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Sending…`;

    const apptIdToSend = activeApptId;
    MH_STORE.updateAppointment(apptIdToSend, {
      status: "completed",
      prescription: { meds, notes },
    })
      .then(async () => {
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
        closeRxModal();
        await renderRequests();
        await renderAccepted();
        mhToast("Prescription sent to patient.", "success");
      })
      .catch((err) => {
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
        mhToast("Couldn't send the prescription. Please try again.", "error");
        console.error(err);
      });
  });

  await renderRequests();
  await renderAccepted();
});
