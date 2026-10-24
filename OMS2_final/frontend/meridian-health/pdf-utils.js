// =========================================================
// ADDED FILE: pdf-utils.js
// Shared, self-contained PDF generation helpers built on jsPDF
// (loaded via CDN in each page that needs it). Nothing in the
// original files depends on this — it is only called by the
// new payment / invoice / prescription / pharmacy features.
// =========================================================

const MH_PDF = {
  _brandHeader(doc, title) {
    doc.setFillColor(31, 92, 78); // --primary
    doc.rect(0, 0, 210, 26, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Meridian Health", 14, 16);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(title, 14, 22);
    doc.setTextColor(20, 36, 32);
  },

  _footer(doc) {
    doc.setFontSize(8.5);
    doc.setTextColor(140, 150, 145);
    doc.text(
      "Meridian Health — demo document, generated locally in your browser. No real payment or medical data.",
      14,
      287
    );
  },

  downloadInvoice(appt) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    this._brandHeader(doc, "Appointment Invoice");

    let y = 42;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Invoice — ${appt.id}`, 14, y);
    y += 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const rows = [
      ["Patient", appt.patientName || "-"],
      ["Email", appt.patientEmail || "-"],
      ["Doctor", appt.doctorName || "-"],
      ["Specialty", appt.specialty || "-"],
      ["Date & time", `${appt.date || ""} · ${appt.time || ""}`],
      ["Payment method", (appt.paymentMethod || "-").toUpperCase()],
      ["Payment status", appt.paid ? "Paid" : "Pending"],
    ];
    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(value), 60, y);
      y += 8;
    });

    y += 4;
    doc.setDrawColor(210, 218, 214);
    doc.line(14, y, 196, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.text("Description", 14, y);
    doc.text("Amount", 170, y);
    y += 6;
    doc.setDrawColor(230, 235, 232);
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.text(`Consultation fee — ${appt.specialty || "General"} visit`, 14, y);
    doc.text(`Rs. ${Number(appt.fee || 0).toFixed(2)}`, 170, y);
    y += 14;

    doc.setDrawColor(210, 218, 214);
    doc.line(120, y, 196, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.text("Total paid", 120, y);
    doc.text(`Rs. ${Number(appt.fee || 0).toFixed(2)}`, 170, y);

    this._footer(doc);
    doc.save(`Invoice-${appt.id}.pdf`);
  },

  downloadPrescription(appt) {
    if (!appt.prescription) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    this._brandHeader(doc, "Prescription");

    let y = 42;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Prescription for ${appt.patientName || "Patient"}`, 14, y);
    y += 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const rows = [
      ["Prescribing doctor", appt.doctorName || "-"],
      ["Specialty", appt.specialty || "-"],
      ["Visit date", `${appt.date || ""} · ${appt.time || ""}`],
      ["Issued", appt.prescription.date || "-"],
    ];
    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(value), 60, y);
      y += 8;
    });

    y += 4;
    doc.setDrawColor(210, 218, 214);
    doc.line(14, y, 196, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.text("Medicine", 14, y);
    doc.text("Dosage", 90, y);
    doc.text("Frequency / duration", 130, y);
    y += 6;
    doc.setDrawColor(230, 235, 232);
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    (appt.prescription.meds || []).forEach((m) => {
      doc.text(String(m.name || "-"), 14, y);
      doc.text(String(m.dosage || "-"), 90, y);
      doc.text(String(m.freq || "-"), 130, y);
      y += 8;
    });

    if (appt.prescription.notes) {
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.text("Doctor's notes:", 14, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      const split = doc.splitTextToSize(appt.prescription.notes, 180);
      doc.text(split, 14, y);
    }

    this._footer(doc);
    doc.save(`Prescription-${appt.id}.pdf`);
  },

  downloadPharmacyOrderInvoice(order) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    this._brandHeader(doc, "Pharmacy Order Invoice");

    let y = 42;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Order ${order.id}`, 14, y);
    y += 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    doc.text("Deliver to:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(order.name || "-"), 60, y);
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.text("Address:", 14, y);
    doc.setFont("helvetica", "normal");
    const addrLines = doc.splitTextToSize(order.address || "-", 130);
    doc.text(addrLines, 60, y);
    y += 7 * addrLines.length + 3;

    doc.setDrawColor(210, 218, 214);
    doc.line(14, y, 196, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.text("Medicine", 14, y);
    doc.text("Qty", 140, y);
    doc.text("Amount", 170, y);
    y += 6;
    doc.setDrawColor(230, 235, 232);
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    (order.items || []).forEach((it) => {
      doc.text(String(it.name), 14, y);
      doc.text(String(it.qty), 140, y);
      doc.text(`Rs. ${(it.price * it.qty).toFixed(2)}`, 170, y);
      y += 8;
    });

    y += 6;
    doc.setDrawColor(210, 218, 214);
    doc.line(120, y, 196, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.text("Total paid", 120, y);
    doc.text(`Rs. ${Number(order.total || 0).toFixed(2)}`, 170, y);

    this._footer(doc);
    doc.save(`PharmacyInvoice-${order.id}.pdf`);
  },
};
