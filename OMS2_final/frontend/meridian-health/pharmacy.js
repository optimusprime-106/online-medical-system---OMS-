// =========================================================
// pharmacy.js — powers pharmacy.html.
//
// Medicines/categories come from medicines.php. The cart is
// backed by cart.php (MySQL) ONLY when a patient is logged in,
// since cart_items.user_id is NOT NULL in the schema — a guest
// browsing the store keeps an in-memory-only cart for this page
// visit (same UX limitation the old localStorage version had for
// a fresh browser, just without the persistence across reloads).
// =========================================================

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.querySelector("[data-pharmacy-page]");
  if (!page) return;

  const grid = document.querySelector("[data-med-grid]");
  const catWrap = document.querySelector("[data-med-cats]");
  const searchInput = document.querySelector("[data-med-search]");
  const countEl = document.querySelector("[data-med-results-count]");
  const cartLinesEl = document.querySelector("[data-cart-lines]");
  const cartTotalEl = document.querySelector("[data-cart-total]");
  const checkoutBtn = document.querySelector("[data-cart-checkout-btn]");
  const deliveryForm = document.querySelector("[data-delivery-form]");
  const orderConfirm = document.querySelector("[data-order-confirm]");

  let activeCat = "All";
  let query = "";
  let medicines = [];
  let categories = ["All"];
  let cart = []; // [{id, qty}]
  let checkoutStage = "review"; // review -> details -> placed
  let paymentMethod = null; // "razorpay" | "cod"
  let razorpayPayment = null; // set after a verified Razorpay payment

  // Who's shopping? A logged-in patient's cart is saved server-side;
  // a guest's cart lives only in this page's memory.
  const user = typeof MH_AUTH !== "undefined" ? await MH_AUTH.session() : null;
  const userId = user && user.role === "patient" ? user.id : null;

  // ---- initial data load (medicines, categories, cart) ----
  try {
    const [medsRes, catsRes] = await Promise.all([
      MH_STORE.getMedicines(),
      MH_STORE.getMedicineCategories(),
    ]);
    medicines = medsRes;
    categories = catsRes;
  } catch (err) {
    mhToast("Couldn't load the medicine catalog. Please refresh.", "error");
    console.error(err);
  }

  if (userId) {
    try {
      cart = await MH_STORE.getCart(userId);
    } catch (err) {
      console.error(err);
    }
  }

  // ---- category chips ----
  catWrap.innerHTML = categories
    .map((c) => `<button type="button" class="filter-chip${c === "All" ? " active" : ""}" data-cat-chip="${c}">${c}</button>`)
    .join("");
  catWrap.querySelectorAll("[data-cat-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      catWrap.querySelectorAll("[data-cat-chip]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeCat = chip.dataset.catChip;
      renderGrid();
    });
  });

  searchInput.addEventListener("input", (e) => {
    query = e.target.value.toLowerCase();
    renderGrid();
  });

  function qtyInCart(id) {
    const line = cart.find((l) => l.id === id);
    return line ? line.qty : 0;
  }

  async function setQty(id, qty) {
    const wasInCart = cart.some((l) => l.id === id);

    // optimistic local update so the UI feels instant
    cart = cart.filter((l) => l.id !== id);
    if (qty > 0) cart.push({ id, qty });
    renderGrid();
    renderCart();

    if (userId) {
      try {
        cart = await MH_STORE.saveCartLine(userId, id, qty);
        renderGrid();
        renderCart();
      } catch (err) {
        mhToast("Couldn't update your cart. Please try again.", "error");
        console.error(err);
        return;
      }
    }

    if (!wasInCart && qty > 0) {
      const med = medicines.find((m) => m.id === id);
      if (med && med.rx) {
        mhToast(`${med.name} added — this item requires a valid prescription.`, "warning", 4500);
      } else {
        mhToast(`${med ? med.name : "Item"} added to cart`, "success", 2500);
      }
    }
  }

  function renderGrid() {
    const filtered = medicines.filter((m) => {
      const matchesCat = activeCat === "All" || m.category === activeCat;
      const matchesQuery = m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query);
      return matchesCat && matchesQuery;
    });
    countEl.textContent = `${filtered.length} medicine${filtered.length !== 1 ? "s" : ""} found`;

    if (!filtered.length) {
      grid.innerHTML = `<div class="col-12">${mhEmptyState({
        icon: MH_ICONS.search,
        title: "No medicines match your search",
        subtitle: "Try a different name, or browse by category instead.",
        actionHtml: `<button type="button" class="btn btn-ghost btn-sm" data-clear-med-search>Clear search</button>`,
      })}</div>`;
      const clearBtn = grid.querySelector("[data-clear-med-search]");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          query = "";
          activeCat = "All";
          if (searchInput) searchInput.value = "";
          catWrap.querySelectorAll("[data-cat-chip]").forEach((c) => c.classList.toggle("active", c.dataset.catChip === "All"));
          renderGrid();
        });
      }
      return;
    }

    grid.innerHTML = filtered
      .map((m) => {
        const qty = qtyInCart(m.id);
        return `
      <div class="col-6 col-md-4 col-lg-3">
      <div class="card med-card">
        <div class="med-icon">${m.img}</div>
        <h4>${m.name}</h4>
        <span class="pack">${m.pack}</span>
        <span class="cat">${m.category}</span>
        ${m.rx ? `<span class="rx-flag">Rx required</span>` : ""}
        <div class="price-row">
          <strong>₹${m.price.toFixed(2)}</strong>
          <div class="qty-controls">
            <button type="button" data-qty-minus="${m.id}" aria-label="Decrease quantity of ${m.name}">−</button>
            <span data-qty-display="${m.id}" aria-live="polite" aria-atomic="true">${qty}</span>
            <button type="button" data-qty-plus="${m.id}" aria-label="Increase quantity of ${m.name}">+</button>
          </div>
        </div>
      </div>
      </div>`;
      })
      .join("");

    grid.querySelectorAll("[data-qty-plus]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.qtyPlus);
        setQty(id, qtyInCart(id) + 1);
      })
    );
    grid.querySelectorAll("[data-qty-minus]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.qtyMinus);
        setQty(id, Math.max(0, qtyInCart(id) - 1));
      })
    );
  }

  function cartItemsDetailed() {
    return cart
      .map((l) => {
        const med = medicines.find((m) => m.id === l.id);
        return med ? { ...med, qty: l.qty } : null;
      })
      .filter(Boolean);
  }

  function cartTotal() {
    return cartItemsDetailed().reduce((sum, it) => sum + it.price * it.qty, 0);
  }

  function renderCart() {
    const items = cartItemsDetailed();
    if (!items.length) {
      cartLinesEl.innerHTML = mhEmptyState({
        icon: MH_ICONS.cart,
        title: "Your cart is empty",
        subtitle: "Add medicines from the list to get started.",
      });
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Add items to checkout";
      deliveryForm.style.display = "none";
      checkoutStage = "review";
      paymentMethod = null;
      razorpayPayment = null;
      stopPharmQRPolling();
      if (pharmQRPanel) pharmQRPanel.style.display = "none";
      document.querySelectorAll("[data-pharm-pay-method]").forEach((c) => c.classList.remove("selected"));
    } else {
      cartLinesEl.innerHTML = items
        .map(
          (it) => `
        <div class="cart-row">
          <div>
            <span class="name">${it.name}</span>
            <span class="meta">${it.qty} × ₹${it.price.toFixed(2)}</span>
          </div>
          <div style="text-align:right;">
            <div>₹${(it.qty * it.price).toFixed(2)}</div>
            <button type="button" class="remove-line" data-remove-line="${it.id}">Remove</button>
          </div>
        </div>`
        )
        .join("");
      cartLinesEl.querySelectorAll("[data-remove-line]").forEach((btn) =>
        btn.addEventListener("click", () => setQty(Number(btn.dataset.removeLine), 0))
      );
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = checkoutStage === "details" ? "Place order" : "Proceed to checkout";
    }
    cartTotalEl.textContent = `₹${cartTotal().toFixed(2)}`;
  }

  const delivNameInput = document.getElementById("deliv-name");
  const delivAddressInput = document.getElementById("deliv-address");
  const delivPhoneInput = document.getElementById("deliv-phone");

  // pre-fill delivery details for a logged-in patient
  if (user) {
    if (delivNameInput && !delivNameInput.value) delivNameInput.value = user.name || "";
  }

  const delivRules = [
    { input: delivNameInput, rules: [MH_VALIDATORS.required("Please enter your full name."), MH_VALIDATORS.minLength(2, "Name must be at least 2 characters.")] },
    { input: delivAddressInput, rules: [MH_VALIDATORS.required("Please enter a delivery address."), MH_VALIDATORS.minLength(6, "Please enter a complete address.")] },
    { input: delivPhoneInput, rules: [MH_VALIDATORS.required("Please enter a phone number."), MH_VALIDATORS.phone()] },
  ];
  delivRules.forEach(({ input, rules }) => mhWireLiveValidation(input, rules));

  // ---- payment method choice (shown inside the delivery form) ----
  const paymentCards = document.querySelectorAll("[data-pharm-pay-method]");
  const pharmQRPanel = document.querySelector('[data-pharm-pay-detail="qr"]');
  let activePharmQRPoll = null;
  function stopPharmQRPolling() {
    if (activePharmQRPoll) {
      activePharmQRPoll.cancel();
      activePharmQRPoll = null;
    }
  }
  function resetPharmQRPanel() {
    const box = document.querySelector("[data-pharm-qr-box]");
    const status = document.querySelector("[data-pharm-qr-status]");
    if (box) box.style.display = "none";
    if (status) status.textContent = "Waiting for payment…";
  }

  paymentCards.forEach((card) => {
    card.addEventListener("click", () => {
      paymentCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      paymentMethod = card.dataset.pharmPayMethod;

      if (pharmQRPanel) pharmQRPanel.style.display = paymentMethod === "qr" ? "block" : "none";
      if (paymentMethod === "qr") {
        const amt = document.querySelector("[data-pharm-qr-amount]");
        if (amt) amt.textContent = `₹${cartTotal().toFixed(2)}`;
        resetPharmQRPanel();
      } else {
        stopPharmQRPolling();
      }
    });
  });

  let placedOrderId = null;

  async function placeOrder() {
    const name = delivNameInput.value.trim();
    const address = delivAddressInput.value.trim();
    const phone = delivPhoneInput.value.trim();
    const items = cartItemsDetailed();

    const order = await MH_STORE.addOrder({
      userId: userId || undefined,
      name,
      address,
      phone,
      items: items.map((i) => ({ medicineId: i.id, name: i.name, qty: i.qty, price: i.price })),
      total: cartTotal(),
      paymentMethod,
      razorpayOrderId: razorpayPayment ? razorpayPayment.razorpay_order_id : undefined,
      razorpayPaymentId: razorpayPayment ? razorpayPayment.razorpay_payment_id : undefined,
    });

    cart = [];
    renderCart();

    placedOrderId = order.id;
    document.querySelector("[data-cart-panel]").style.display = "none";
    orderConfirm.style.display = "block";
    orderConfirm.querySelector("[data-order-id]").textContent = order.id;
    orderConfirm.dataset.currentOrderId = order.id;
    orderConfirm.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  checkoutBtn.addEventListener("click", async () => {
    if (!cartItemsDetailed().length) return;

    if (checkoutStage === "review") {
      checkoutStage = "details";
      deliveryForm.style.display = "block";
      checkoutBtn.textContent = "Place order";
      delivNameInput.focus();
      return;
    }

    // stage === details -> validate delivery + payment choice, then place order
    if (!mhValidateGroup(delivRules)) return;
    if (!paymentMethod) {
      mhToast("Please choose a payment method.", "error");
      return;
    }

    const originalText = checkoutBtn.textContent;
    checkoutBtn.disabled = true;

    try {
      if (paymentMethod === "razorpay") {
        checkoutBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Opening payment…`;

        // Backend totals the logged-in user's cart itself server-side —
        // it does not trust cartTotal() from the client.
        const order = await MH_STORE.createRazorpayOrder({ type: "pharmacy", userId });

        const payment = await MH_RAZORPAY.open({
          order,
          description: "Meridian Pharmacy order",
          prefill: {
            name: delivNameInput.value.trim(),
            contact: delivPhoneInput.value.trim(),
            email: user ? user.email : undefined,
          },
        });

        checkoutBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Verifying payment…`;
        await MH_STORE.verifyRazorpayPayment(payment);
        razorpayPayment = payment;
      } else if (paymentMethod === "qr") {
        checkoutBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Generating QR code…`;

        const box = document.querySelector("[data-pharm-qr-box]");
        const img = document.querySelector("[data-pharm-qr-image]");
        const status = document.querySelector("[data-pharm-qr-status]");

        const qr = await MH_STORE.createRazorpayQR({ type: "pharmacy", userId });
        if (img) img.src = qr.imageUrl;
        if (box) box.style.display = "block";
        if (status) status.textContent = "Waiting for payment…";
        checkoutBtn.textContent = "Waiting for payment…";

        stopPharmQRPolling();
        activePharmQRPoll = MH_RAZORPAY.pollQR(qr.qrId);
        const payment = await activePharmQRPoll.promise;
        activePharmQRPoll = null;
        if (status) status.textContent = "Payment received ✓";

        razorpayPayment = { razorpay_payment_id: payment.razorpay_payment_id };
      } else {
        checkoutBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> Placing order…`;
      }

      await placeOrder();
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = originalText;
    } catch (err) {
      stopPharmQRPolling();
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = originalText;
      mhToast(err.message || "Couldn't place your order. Please try again.", "error");
      console.error(err);
    }
  });

  document.querySelector("[data-download-order-invoice]").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const id = orderConfirm.dataset.currentOrderId || placedOrderId;
    mhWithButtonLoading(btn, "Preparing…", async () => {
      const order = await MH_STORE.getOrder(id);
      MH_PDF.downloadPharmacyOrderInvoice(order);
    });
  });

  renderGrid();
  renderCart();
});
