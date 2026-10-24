// =========================================================================
// RIDER CONTROLLER MODULE (AVAILABLE PICKUPS, ACTIVE DELIVERY, TELEMETRY, EARNINGS)
// =========================================================================
// =========================================================================
// RIDER: AVAILABLE, ACTIVE & EARNINGS
// =========================================================================
async function fetchAvailableRiderOrders() {
  const container = document.getElementById('rider-available-list');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('orders');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/rider/orders/available');
    const orders = data.orders || [];

    if (!orders.length) {
      container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No pickup orders currently available. As soon as restaurants accept and prepare orders, they will appear here!</p>';
      return;
    }

    container.innerHTML = orders.map((o) => {
      const isShop = Boolean(o.shopName || (o.orderNumber && o.orderNumber.startsWith('SHOP')));
      const storeName = o.shopName || o.restaurantName || (isShop ? 'Tomato Grocery Shop' : 'Tomato Kitchen');
      const storeAddress = o.shopAddress || o.restaurantAddress || '';
      const restMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeAddress || storeName)}`;
      const custMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}`;

      return `
        <div style="border:1px solid var(--line); border-radius:10px; padding:1.2rem; margin-bottom:1.2rem; background:#fff;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem;">
            <div>
              <h3 style="font-size:1.15rem; margin-bottom:0.2rem;">Order #${o.orderNumber}</h3>
              <span class="badge badge-${o.status}">${isShop ? 'Shop' : 'Restaurant'} Status: ${(o.status || '').replace(/_/g, ' ')}</span>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <button class="btn btn-danger btn-sm" onclick="rejectDeliveryOrder('${o._id}')">✕ Reject Offer</button>
              <button class="btn btn-success btn-sm" onclick="acceptDeliveryOrder('${o._id}')">🚴 Accept Delivery</button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1.2rem; margin:1rem 0; padding:0.9rem; background:#f9f6ee; border-radius:8px;">
            <div>
              <strong style="font-size:0.85rem; color:var(--tomato); text-transform:uppercase;">📍 ${isShop ? 'Shop' : 'Restaurant'} Pickup Location:</strong>
              <div style="font-weight:700; margin-top:0.2rem;">${escapeHtml(storeName)}</div>
              <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(storeAddress || 'Local Partner Quarter')}</div>
              <a href="${restMapUrl}" target="_blank" style="font-size:0.8rem; color:var(--blue); font-weight:600; display:inline-block; margin-top:0.3rem;">🗺️ Open ${isShop ? 'Shop' : 'Restaurant'} on Map</a>
            </div>

            <div>
              <strong style="font-size:0.85rem; color:var(--green); text-transform:uppercase;">🏁 Customer Delivery Location:</strong>
              <div style="font-weight:700; margin-top:0.2rem;">${escapeHtml(o.customerName || 'Customer')} (${escapeHtml(o.deliveryAddress?.phone || o.customerPhone || 'N/A')})</div>
              <div style="font-size:0.84rem; color:var(--ink); margin:0.2rem 0;">
                ${o.deliveryAddress?.label ? `<span class="badge badge-accepted" style="font-size:0.72rem; padding:1px 6px;">${escapeHtml(o.deliveryAddress.label)}</span> ` : ''}
                ${escapeHtml(o.deliveryAddress?.line1 || '')}${o.deliveryAddress?.line2 ? ', ' + escapeHtml(o.deliveryAddress.line2) : ''}, ${escapeHtml(o.deliveryAddress?.city || '')} ${escapeHtml(o.deliveryAddress?.postalCode || '')}
              </div>
              <a href="${custMapUrl}" target="_blank" style="font-size:0.8rem; color:var(--blue); font-weight:600; display:inline-block; margin-top:0.3rem;">🗺️ Open Customer on Map</a>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; border-top:1px dashed var(--line); padding-top:0.8rem;">
            <div>Dishes: ${(o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', ')}</div>
            <div>Payment: <strong>${o.paymentMethod === 'cod' ? '💵 COLLECT ₹' + o.totalAmount + ' COD' : '✓ PREPAID ONLINE'}</strong></div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch available rider orders error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

async function acceptDeliveryOrder(orderId) {
  try {
    await apiFetch(`/api/rider/orders/${orderId}/accept`, { method: 'POST' });
    alert('Delivery order claimed! Proceed to pick up the meal.');
    if (typeof updateRiderOverviewStatsLive === 'function') updateRiderOverviewStatsLive();
    if (typeof loadRoleOverview === 'function') loadRoleOverview();
    switchView('rider-active');
  } catch (e) {
    if (typeof showServiceableAreaPopup === 'function' && e.message && e.message.toLowerCase().includes('servicable range')) {
      showServiceableAreaPopup();
    } else {
      alert(`Accept Delivery Error: ${e.message}`);
    }
  }
}

let cachedActiveRiderOrders = [];
let currentCodDeliverOrder = null;

async function fetchActiveRiderOrders() {
  const container = document.getElementById('rider-active-list');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('deliveries');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/rider/orders/active');
    const orders = data.orders || [];
    cachedActiveRiderOrders = orders;
    window.cachedActiveRiderOrders = orders;

    if (!orders.length) {
      container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No deliveries currently assigned to you. Go to "Available Pickups" to accept a new delivery order!</p>';
      return;
    }

    container.innerHTML = orders.map((o) => {
      const isShop = Boolean(o.shopName || (o.orderNumber && o.orderNumber.startsWith('SHOP')));
      const storeName = o.shopName || o.restaurantName || (isShop ? 'Shop' : 'Restaurant');
      const storeAddress = o.shopAddress || o.restaurantAddress || '';
      const custMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}`;
      const isPickedUp = Boolean(o.isPickedUp || o.pickupStatus === 'picked_up');
      const dist = typeof o.distanceToStoreKm === 'number' ? o.distanceToStoreKm : 2.5;
      const expectedMins = typeof o.expectedDeliveryTimingMinutes === 'number' ? o.expectedDeliveryTimingMinutes : Math.max(1, Math.round(5 + 2 * dist));

      return `
        <div style="border:2px solid ${isPickedUp ? 'var(--green)' : '#3b82f6'}; border-radius:12px; padding:1.4rem; background:#fff; box-shadow:var(--shadow);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem;">
            <div>
              <span class="badge" style="font-size:0.85rem; ${isPickedUp ? 'background:#dcfce7; color:#15803d;' : 'background:#eff6ff; color:#1d4ed8; font-weight:700;'}">
                ${isPickedUp ? '🚀 OUT FOR DELIVERY IN PROGRESS' : '🚴 WAY TO PICKUP ORDER'}
              </span>
              <h2 style="font-size:1.35rem; margin:0.4rem 0 0.2rem;">Order #${o.orderNumber}</h2>
              ${isPickedUp ? `
                <div style="font-size:0.82rem; color:#15803d; font-weight:700;">
                  ⏱️ expected delivery timing(natural weither): ${expectedMins} mins (${dist.toFixed(1)} km)
                </div>
              ` : `
                <div style="font-size:0.82rem; color:#1d4ed8; font-weight:700;">
                  📍 On the way to store for pickup
                </div>
              `}
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
              <button class="btn btn-outline" style="font-size:0.88rem; padding:0.6rem 1rem;" onclick="openOrderLiveTrackingModal('${o._id}', 'rider')">
                📡 Live Route Radar
              </button>
              ${!isPickedUp ? `
                <button class="btn btn-primary" style="font-size:0.95rem; padding:0.7rem 1.3rem; font-weight:700;" onclick="confirmOrderPickup('${o._id}')">
                  📦 Confirm Order Picked Up
                </button>
              ` : `
                <button class="btn btn-success" style="font-size:0.95rem; padding:0.7rem 1.3rem; font-weight:700;" onclick="initiateDeliverOrder('${o._id}')">
                  ✓ Deliver Product
                </button>
              `}
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem; margin:1.2rem 0; padding:1.2rem; background:#f4f9f5; border-radius:8px;">
            <div>
              <strong style="color:var(--tomato); font-size:0.82rem; text-transform:uppercase;">Pickup ${isShop ? 'Shop' : 'Restaurant'}:</strong>
              <div style="font-size:1.05rem; font-weight:700; margin:0.2rem 0;">${escapeHtml(storeName)}</div>
              ${o.digipin ? `<div style="font-size:0.82rem; margin:0.2rem 0;"><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">📍 DIGIPIN: ${escapeHtml(o.digipin)}</span></div>` : ''}
              <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(storeAddress || 'Local Partner Quarter')}</div>
            </div>
            <div>
              <strong style="color:var(--muted); font-size:0.82rem; text-transform:uppercase;">Customer & Contact:</strong>
              <div style="font-size:1.05rem; font-weight:700; margin:0.2rem 0;">${escapeHtml(o.customerName || 'Customer')}</div>
              <div style="margin:0.4rem 0;">
                <a href="tel:${o.deliveryAddress?.phone || o.customerPhone}" class="btn btn-outline btn-sm">📞 Call Customer: ${escapeHtml(o.deliveryAddress?.phone || o.customerPhone || 'N/A')}</a>
              </div>
            </div>
            <div>
              <strong style="color:var(--muted); font-size:0.82rem; text-transform:uppercase;">Destination Address:</strong>
              <div style="font-weight:600; margin:0.2rem 0; font-size:0.92rem; color:var(--ink);">
                ${o.deliveryAddress?.label ? `<span class="badge badge-accepted" style="font-size:0.72rem; padding:1px 6px;">${escapeHtml(o.deliveryAddress.label)}</span> ` : ''}
                ${escapeHtml(o.deliveryAddress?.line1 || '')}${o.deliveryAddress?.line2 ? ', ' + escapeHtml(o.deliveryAddress.line2) : ''}, ${escapeHtml(o.deliveryAddress?.city || '')} ${escapeHtml(o.deliveryAddress?.postalCode || '')}
              </div>
              <a href="${custMapUrl}" target="_blank" class="btn btn-outline btn-sm" style="color:var(--blue);">🗺️ Open GPS Navigation</a>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed var(--line); padding-top:0.8rem;">
            <div>Dishes: ${(o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', ')}</div>
            <div style="font-weight:700; font-size:1.05rem;">
              ${o.paymentMethod === 'cod' ? '<span style="color:var(--tomato-dark);">💵 Collect Cash on Delivery: ₹' + o.totalAmount + '</span>' : '<span style="color:var(--green);">✓ Paid Online via Gateway</span>'}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch active rider orders error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

async function initiateDeliverOrder(orderId) {
  let order = (cachedActiveRiderOrders || []).find((o) => String(o._id) === String(orderId));
  if (!order) {
    try {
      const data = await apiFetch('/api/rider/orders/active');
      cachedActiveRiderOrders = data.orders || [];
      window.cachedActiveRiderOrders = cachedActiveRiderOrders;
      order = cachedActiveRiderOrders.find((o) => String(o._id) === String(orderId));
    } catch (_) {}
  }

  // If order is Cash on Delivery, prompt rider for payment collection confirmation
  const isCod = order ? (order.paymentMethod === 'cod') : true;

  if (isCod) {
    openRiderCodCollectModal(order || { _id: orderId, orderNumber: '---', totalAmount: 0 });
  } else {
    executeDeliverOrder(orderId);
  }
}

// Alias for backwards compatibility
async function markOrderDelivered(orderId) {
  return initiateDeliverOrder(orderId);
}

async function confirmOrderPickup(orderId) {
  try {
    await apiFetch(`/api/rider/orders/${orderId}/pickup`, { method: 'POST' });
    alert('Order marked as picked up from store! Proceed to customer delivery address.');
    if (typeof updateRiderOverviewStatsLive === 'function') updateRiderOverviewStatsLive();
    if (typeof loadRoleOverview === 'function') loadRoleOverview();
    await fetchActiveRiderOrders();
  } catch (e) {
    alert(`Pickup confirmation failed: ${e.message}`);
  }
}
window.confirmOrderPickup = confirmOrderPickup;

function openRiderCodCollectModal(order) {
  currentCodDeliverOrder = order;
  const numEl = document.getElementById('rider-cod-order-number');
  if (numEl) numEl.textContent = `#${order.orderNumber || ''}`;
  const amtEl = document.getElementById('rider-cod-order-amount');
  const amountStr = Number(order.totalAmount || 0).toLocaleString('en-IN');
  if (amtEl) amtEl.textContent = `₹${amountStr}`;

  showRiderCodPromptStep();
  const modal = document.getElementById('rider-cod-collect-modal');
  if (modal) {
    modal.classList.add('visible');
    modal.style.display = 'grid';
  }
}

function closeRiderCodModal() {
  const modal = document.getElementById('rider-cod-collect-modal');
  if (modal) {
    modal.classList.remove('visible');
    modal.style.display = 'none';
  }
  currentCodDeliverOrder = null;
}

function showRiderCodPromptStep() {
  const stepPrompt = document.getElementById('rider-cod-step-prompt');
  const stepUpi = document.getElementById('rider-cod-step-upi');
  const stepCash = document.getElementById('rider-cod-step-cash');
  const title = document.getElementById('rider-cod-modal-title');
  if (title) title.textContent = 'Have you received the Money?';

  if (stepPrompt) stepPrompt.style.display = 'block';
  if (stepUpi) stepUpi.style.display = 'none';
  if (stepCash) stepCash.style.display = 'none';
}

function renderBarcodeLines(orderNumber) {
  const heights = [28, 38, 32, 38, 25, 38, 35, 38, 30, 38, 26, 38, 34, 38, 29, 38, 36, 38, 24, 38, 33, 38, 27, 38];
  const widths = [2, 4, 1, 3, 2, 5, 2, 3, 4, 2, 1, 3, 5, 2, 3, 1, 4, 2, 3, 1, 2, 4, 3, 2];
  let bars = '';
  for (let i = 0; i < 24; i++) {
    const h = heights[i % heights.length];
    const w = widths[i % widths.length];
    bars += `<span style="display:inline-block; width:${w}px; height:${h}px; background:#0f172a; border-radius:1px;"></span>`;
    bars += `<span style="display:inline-block; width:2px; height:${h}px; background:transparent;"></span>`;
  }
  return bars;
}

function selectRiderCodMethod(method) {
  if (!currentCodDeliverOrder) return;
  const stepPrompt = document.getElementById('rider-cod-step-prompt');
  const stepUpi = document.getElementById('rider-cod-step-upi');
  const stepCash = document.getElementById('rider-cod-step-cash');
  const title = document.getElementById('rider-cod-modal-title');
  const amount = Number(currentCodDeliverOrder.totalAmount || 0);
  const amountStr = `₹${amount.toLocaleString('en-IN')}`;

  if (stepPrompt) stepPrompt.style.display = 'none';

  if (method === 'upi') {
    if (title) title.textContent = 'UPI Barcode / QR Code Payment';
    if (stepUpi) stepUpi.style.display = 'block';
    if (stepCash) stepCash.style.display = 'none';

    const amtLabel = document.getElementById('rider-cod-upi-amt-label');
    if (amtLabel) amtLabel.textContent = amountStr;

    // Standard UPI URI format supported by all Indian UPI apps
    const upiUri = `upi://pay?pa=tomato.delivery@icici&pn=Tomato+Delivery&am=${amount}&cu=INR&tn=Order_${encodeURIComponent(currentCodDeliverOrder.orderNumber || '')}`;
    const qrImg = document.getElementById('rider-cod-upi-qr');
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}`;
    }

    // Realistic visual barcode graphic
    const barcodeContainer = document.getElementById('rider-cod-barcode-container');
    if (barcodeContainer) {
      barcodeContainer.innerHTML = renderBarcodeLines(currentCodDeliverOrder.orderNumber);
    }
    const barcodeText = document.getElementById('rider-cod-barcode-text');
    if (barcodeText) {
      barcodeText.textContent = `*COD-${currentCodDeliverOrder.orderNumber || '000000'}*`;
    }
  } else {
    if (title) title.textContent = 'Cash Collection Confirmation';
    if (stepCash) stepCash.style.display = 'block';
    if (stepUpi) stepUpi.style.display = 'none';

    const amtLabel = document.getElementById('rider-cod-cash-amt-label');
    if (amtLabel) amtLabel.textContent = amountStr;
  }
}

async function confirmRiderCodDelivery(method) {
  if (!currentCodDeliverOrder) return;
  const orderId = currentCodDeliverOrder._id;
  const amount = currentCodDeliverOrder.totalAmount;
  await executeDeliverOrder(orderId, method, amount);
  closeRiderCodModal();
}

async function executeDeliverOrder(orderId, codCollectedVia = null, amount = 0) {
  try {
    const payload = codCollectedVia ? { codCollectedVia } : {};
    await apiFetch(`/api/rider/orders/${orderId}/deliver`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (
      typeof activeTrackingOrderId !== 'undefined' &&
      activeTrackingOrderId &&
      String(activeTrackingOrderId) === String(orderId) &&
      typeof closeOrderLiveTrackingModal === 'function'
    ) {
      closeOrderLiveTrackingModal();
    }

    const collectMsg = codCollectedVia
      ? ` ₹${Number(amount || 0).toLocaleString('en-IN')} collected via ${codCollectedVia.toUpperCase()}.`
      : '';
    alert(`Delivery completed successfully!${collectMsg} ₹40 delivery fee has been credited to your earnings.`);

    if (typeof updateRiderOverviewStatsLive === 'function') {
      updateRiderOverviewStatsLive();
    }
    if (typeof loadRoleOverview === 'function') {
      loadRoleOverview();
    }

    switchView('rider-history');
  } catch (e) {
    alert(`Delivery Error: ${e.message}`);
  }
}

async function fetchRiderHistory() {
  const container = document.getElementById('rider-history-list');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('trips');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/rider/orders/history');
    const orders = data.orders || [];

    if (!orders.length) {
      container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No deliveries completed yet.</p>';
      return;
    }

    const codCollections = data.codCollections || {
      cash: (orders || []).filter(o => o.paymentMethod === 'cod' && o.codCollectedVia !== 'upi').reduce((s, o) => s + Number(o.totalAmount || 0), 0),
      upi: (orders || []).filter(o => o.paymentMethod === 'cod' && o.codCollectedVia === 'upi').reduce((s, o) => s + Number(o.totalAmount || 0), 0),
      total: (orders || []).filter(o => o.paymentMethod === 'cod').reduce((s, o) => s + Number(o.totalAmount || 0), 0),
    };

    container.innerHTML = `
      <div style="background:var(--green-soft); border:1px solid #a3e635; padding:1.2rem; border-radius:10px; margin-bottom:1.4rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; align-items:center;">
        <div>
          <span style="font-size:0.85rem; color:#365314; font-weight:600;">TOTAL TRIP EARNINGS</span>
          <div style="font-size:1.85rem; font-weight:700; color:var(--green);">₹${data.totalEarnings || 0}</div>
        </div>
        <div>
          <span style="font-size:0.85rem; color:#365314; font-weight:600;">COMPLETED DELIVERIES</span>
          <div style="font-size:1.5rem; font-weight:700; color:var(--ink);">${data.totalDeliveries || 0} Trips</div>
        </div>
        <div>
          <span style="font-size:0.85rem; color:#1e40af; font-weight:600;">COD COLLECTIONS</span>
          <div style="font-size:1.5rem; font-weight:800; color:#1d4ed8;">₹${Number(codCollections.total || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:0.78rem; font-weight:700; color:#475569; margin-top:0.2rem;">
            UPI: ₹${Number(codCollections.upi || 0).toLocaleString('en-IN')} / Cash: ₹${Number(codCollections.cash || 0).toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Restaurant</th>
              <th>Delivered Date/Time</th>
              <th>Payment / Collection</th>
              <th>Trip Earnings</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map((o) => `
              <tr>
                <td><strong>#${o.orderNumber}</strong></td>
                <td>${escapeHtml(o.customerName)}</td>
                <td>${escapeHtml(o.restaurantName)}</td>
                <td>${new Date(o.updatedAt).toLocaleString()}</td>
                <td>
                  ${o.paymentMethod === 'cod'
                    ? (o.codCollectedVia === 'upi'
                      ? `<span class="badge" style="background:#eff6ff; color:#1d4ed8; font-weight:700; border:1px solid #bfdbfe;">📱 UPI ₹${o.totalAmount}</span>`
                      : `<span class="badge" style="background:#f0fdf4; color:#15803d; font-weight:700; border:1px solid #bbf7d0;">💵 Cash ₹${o.totalAmount}</span>`)
                    : `<span class="badge" style="background:#f1f5f9; color:#475569;">💳 Online Paid</span>`}
                </td>
                <td><span class="badge badge-delivered">+₹40.00</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch rider history error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

// =========================================================================
// RIDER OVERVIEW: DELIVERY & COLLECTIONS REPORT SYSTEM
// =========================================================================
let riderReportOrdersCache = [];

async function refreshRiderReportData() {
  try {
    const res = await apiFetch('/api/rider/orders/history');
    riderReportOrdersCache = Array.isArray(res.orders) ? res.orders : [];
    renderRiderReportData();
  } catch (err) {
    console.error('Failed to load rider report data:', err);
  }
}

function renderRiderReportData() {
  const period = document.getElementById('rider-report-period')?.value || 'all';
  const dateLabel = document.getElementById('rider-report-date-label');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let filteredOrders = riderReportOrdersCache;
  let rangeLabel = 'All historic deliveries';

  if (period === 'today') {
    filteredOrders = riderReportOrdersCache.filter((o) => new Date(o.updatedAt || o.createdAt) >= startOfDay);
    rangeLabel = `Today (${now.toLocaleDateString()})`;
  } else if (period === 'yesterday') {
    const startOfYesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
    filteredOrders = riderReportOrdersCache.filter((o) => {
      const d = new Date(o.updatedAt || o.createdAt);
      return d >= startOfYesterday && d < startOfDay;
    });
    rangeLabel = `Yesterday (${startOfYesterday.toLocaleDateString()})`;
  } else if (period === 'last7') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filteredOrders = riderReportOrdersCache.filter((o) => new Date(o.updatedAt || o.createdAt) >= sevenDaysAgo);
    rangeLabel = 'Past 7 days';
  } else if (period === 'thisMonth') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    filteredOrders = riderReportOrdersCache.filter((o) => new Date(o.updatedAt || o.createdAt) >= startOfMonth);
    rangeLabel = `${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
  }

  if (dateLabel) dateLabel.textContent = `• ${rangeLabel}`;

  const totalTrips = filteredOrders.length;
  const totalEarnings = totalTrips * 40;

  let codCashAmount = 0;
  let codCashCount = 0;
  let codUpiAmount = 0;
  let codUpiCount = 0;
  let prepaidCount = 0;
  let prepaidAmount = 0;
  let totalOrderValue = 0;

  const restMap = new Map();

  filteredOrders.forEach((o) => {
    const amt = Number(o.totalAmount || 0);
    totalOrderValue += amt;

    if (o.paymentMethod === 'cod') {
      if (o.codCollectedVia === 'upi') {
        codUpiAmount += amt;
        codUpiCount++;
      } else {
        codCashAmount += amt;
        codCashCount++;
      }
    } else {
      prepaidCount++;
      prepaidAmount += amt;
    }

    const restName = o.restaurantName || 'Tomato Kitchen';
    const restAddr = o.restaurantAddress || 'Bengaluru';
    const curr = restMap.get(restName) || { name: restName, address: restAddr, trips: 0, earnings: 0, orderValue: 0 };
    curr.trips++;
    curr.earnings += 40;
    curr.orderValue += amt;
    restMap.set(restName, curr);
  });

  const codTotalAmount = codCashAmount + codUpiAmount;
  const codTotalCount = codCashCount + codUpiCount;

  // 1. KPI Grid
  const kpiEl = document.getElementById('rider-report-kpi-grid');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Delivered Trips</div>
        <div style="font-size:1.6rem; font-weight:800; color:var(--ink); margin-top:0.2rem;">${totalTrips}</div>
        <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Completed in period</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Trip Earnings</div>
        <div style="font-size:1.6rem; font-weight:800; color:var(--green); margin-top:0.2rem;">₹${totalEarnings.toLocaleString('en-IN')}</div>
        <div style="font-size:0.74rem; color:var(--green); font-weight:600; margin-top:0.15rem;">₹40 flat fee per trip</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Total COD Collected</div>
        <div style="font-size:1.6rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">₹${codTotalAmount.toLocaleString('en-IN')}</div>
        <div style="font-size:0.74rem; color:#1d4ed8; font-weight:600; margin-top:0.15rem;">${codTotalCount} COD orders</div>
      </div>
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:#1e40af; text-transform:uppercase; font-weight:700;">UPI Collections</div>
        <div style="font-size:1.6rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">₹${codUpiAmount.toLocaleString('en-IN')}</div>
        <div style="font-size:0.74rem; color:#3b82f6; font-weight:600; margin-top:0.15rem;">${codUpiCount} payments via Barcode/QR</div>
      </div>
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:#166534; text-transform:uppercase; font-weight:700;">Cash Collections</div>
        <div style="font-size:1.6rem; font-weight:800; color:#15803d; margin-top:0.2rem;">₹${codCashAmount.toLocaleString('en-IN')}</div>
        <div style="font-size:0.74rem; color:#16a34a; font-weight:600; margin-top:0.15rem;">${codCashCount} payments via physical cash</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Prepaid Deliveries</div>
        <div style="font-size:1.6rem; font-weight:800; color:#475569; margin-top:0.2rem;">${prepaidCount}</div>
        <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">₹${prepaidAmount.toLocaleString('en-IN')} paid online</div>
      </div>
    `;
  }

  // 2. Financial Breakdown Card
  const finEl = document.getElementById('rider-report-financial-breakdown');
  if (finEl) {
    finEl.innerHTML = `
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:0.85rem;">
        <div style="font-size:0.75rem; color:var(--muted); font-weight:600;">Trip Delivery Fees Earned</div>
        <div style="font-size:1.35rem; font-weight:800; color:var(--green); margin-top:0.2rem;">+₹${totalEarnings.toLocaleString('en-IN')}</div>
        <div style="font-size:0.72rem; color:var(--muted); margin-top:0.1rem;">Credited directly to rider account</div>
      </div>
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:0.85rem;">
        <div style="font-size:0.75rem; color:#991b1b; font-weight:600;">Cash In Hand (To Remit)</div>
        <div style="font-size:1.35rem; font-weight:800; color:#dc2626; margin-top:0.2rem;">₹${codCashAmount.toLocaleString('en-IN')}</div>
        <div style="font-size:0.72rem; color:#991b1b; margin-top:0.1rem;">Collected in cash from customers</div>
      </div>
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:0.85rem;">
        <div style="font-size:0.75rem; color:#1e40af; font-weight:600;">UPI Digital Remittance</div>
        <div style="font-size:1.35rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">₹${codUpiAmount.toLocaleString('en-IN')}</div>
        <div style="font-size:0.72rem; color:#3b82f6; margin-top:0.1rem;">Paid digitally to central account</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:0.85rem;">
        <div style="font-size:0.75rem; color:var(--muted); font-weight:600;">Delivered Food Value</div>
        <div style="font-size:1.35rem; font-weight:800; color:var(--ink); margin-top:0.2rem;">₹${totalOrderValue.toLocaleString('en-IN')}</div>
        <div style="font-size:0.72rem; color:var(--muted); margin-top:0.1rem;">Total customer orders delivered</div>
      </div>
    `;
  }

  // 3. Payment Mode Breakdown
  const payEl = document.getElementById('rider-report-payment-breakdown');
  if (payEl) {
    const upiPct = totalTrips > 0 ? Math.round((codUpiCount / totalTrips) * 100) : 0;
    const cashPct = totalTrips > 0 ? Math.round((codCashCount / totalTrips) * 100) : 0;
    const onlinePct = totalTrips > 0 ? Math.round((prepaidCount / totalTrips) * 100) : 0;

    payEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.55rem 0.75rem; background:#eff6ff; border-radius:8px;">
          <div>
            <div style="font-weight:700; font-size:0.88rem; color:#1d4ed8;">📱 UPI Barcode / QR</div>
            <div style="font-size:0.75rem; color:#3b82f6;">${codUpiCount} orders (${upiPct}%)</div>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#1d4ed8;">₹${codUpiAmount.toLocaleString('en-IN')}</div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.55rem 0.75rem; background:#f0fdf4; border-radius:8px;">
          <div>
            <div style="font-weight:700; font-size:0.88rem; color:#15803d;">💵 Cash on Delivery</div>
            <div style="font-size:0.75rem; color:#16a34a;">${codCashCount} orders (${cashPct}%)</div>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#15803d;">₹${codCashAmount.toLocaleString('en-IN')}</div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.55rem 0.75rem; background:#f8fafc; border-radius:8px;">
          <div>
            <div style="font-weight:700; font-size:0.88rem; color:#334155;">💳 Online Prepaid</div>
            <div style="font-size:0.75rem; color:var(--muted);">${prepaidCount} orders (${onlinePct}%)</div>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#334155;">₹${prepaidAmount.toLocaleString('en-IN')}</div>
        </div>
      </div>
    `;
  }

  // 4. Top Hubs / Kitchens Breakdown
  const hubsEl = document.getElementById('rider-report-hubs-breakdown');
  if (hubsEl) {
    const sortedHubs = Array.from(restMap.values()).sort((a, b) => b.trips - a.trips).slice(0, 5);
    if (!sortedHubs.length) {
      hubsEl.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; margin:0;">No pickup hubs recorded in this period.</p>';
    } else {
      hubsEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.6rem;">
          ${sortedHubs.map(h => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.45rem 0.6rem; border-bottom:1px solid #f1f5f9;">
              <div>
                <div style="font-weight:700; font-size:0.86rem; color:var(--ink);">${escapeHtml(h.name)}</div>
                <div style="font-size:0.74rem; color:var(--muted);">${escapeHtml(h.address || 'Bengaluru')}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-weight:700; font-size:0.88rem; color:var(--green);">${h.trips} Trips (+₹${h.earnings})</div>
                <div style="font-size:0.72rem; color:var(--muted);">₹${h.orderValue.toLocaleString('en-IN')} goods</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  // 5. Badge & Detailed Table with Column Totals
  const badgeEl = document.getElementById('rider-report-table-badge');
  if (badgeEl) badgeEl.textContent = `${totalTrips} ${totalTrips === 1 ? 'Delivery' : 'Deliveries'}`;

  const tableContainer = document.getElementById('rider-report-table-container');
  if (tableContainer) {
    if (!filteredOrders.length) {
      tableContainer.innerHTML = '<p style="color:var(--muted); font-size:0.88rem; padding:1.2rem 0; margin:0; text-align:center;">No completed deliveries found for the selected period.</p>';
      return;
    }

    tableContainer.innerHTML = `
      <div class="table-wrapper" style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.86rem;">
          <thead>
            <tr style="border-bottom:2px solid var(--line); text-align:left; background:#f8fafc;">
              <th style="padding:0.65rem 0.6rem;">Order #</th>
              <th style="padding:0.65rem 0.6rem;">Customer</th>
              <th style="padding:0.65rem 0.6rem;">Restaurant Pickup</th>
              <th style="padding:0.65rem 0.6rem;">Delivery Destination</th>
              <th style="padding:0.65rem 0.6rem;">Delivered Time</th>
              <th style="padding:0.65rem 0.6rem; text-align:right;">Order Total</th>
              <th style="padding:0.65rem 0.6rem; text-align:center;">Payment / COD Mode</th>
              <th style="padding:0.65rem 0.6rem; text-align:right;">Trip Earning</th>
            </tr>
          </thead>
          <tbody>
            ${filteredOrders.map(o => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:0.65rem 0.6rem; font-weight:700;">#${o.orderNumber || ''}</td>
                <td style="padding:0.65rem 0.6rem;">
                  <div style="font-weight:600;">${escapeHtml(o.customerName || 'Customer')}</div>
                  <div style="font-size:0.75rem; color:var(--muted);">${escapeHtml(o.deliveryAddress?.phone || o.customerPhone || '')}</div>
                </td>
                <td style="padding:0.65rem 0.6rem;">${escapeHtml(o.restaurantName || 'Restaurant')}</td>
                <td style="padding:0.65rem 0.6rem;">
                  <div style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}">
                    ${escapeHtml(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}
                  </div>
                </td>
                <td style="padding:0.65rem 0.6rem; color:var(--muted); font-size:0.8rem;">
                  ${new Date(o.updatedAt || o.createdAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                </td>
                <td style="padding:0.65rem 0.6rem; text-align:right; font-weight:700;">
                  ₹${Number(o.totalAmount || 0).toLocaleString('en-IN')}
                </td>
                <td style="padding:0.65rem 0.6rem; text-align:center;">
                  ${o.paymentMethod === 'cod'
                    ? (o.codCollectedVia === 'upi'
                      ? `<span class="badge" style="background:#eff6ff; color:#1d4ed8; font-weight:700; border:1px solid #bfdbfe; font-size:0.76rem;">📱 UPI ₹${o.totalAmount}</span>`
                      : `<span class="badge" style="background:#f0fdf4; color:#15803d; font-weight:700; border:1px solid #bbf7d0; font-size:0.76rem;">💵 Cash ₹${o.totalAmount}</span>`)
                    : `<span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.76rem;">💳 Online Paid</span>`}
                </td>
                <td style="padding:0.65rem 0.6rem; text-align:right;">
                  <span class="badge badge-delivered" style="font-weight:700;">+₹40.00</span>
                </td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--line); background:#f8fafc; font-weight:800;">
              <td style="padding:0.8rem 0.6rem; color:var(--tomato); font-size:0.95rem;">TOTAL</td>
              <td style="padding:0.8rem 0.6rem; color:var(--ink);">${totalTrips} Trips</td>
              <td style="padding:0.8rem 0.6rem;">—</td>
              <td style="padding:0.8rem 0.6rem;">—</td>
              <td style="padding:0.8rem 0.6rem; color:var(--muted); font-size:0.8rem;">Period Summary</td>
              <td style="padding:0.8rem 0.6rem; text-align:right; color:var(--ink); font-size:0.95rem;">
                ₹${totalOrderValue.toLocaleString('en-IN')}
              </td>
              <td style="padding:0.8rem 0.6rem; text-align:center; font-size:0.78rem;">
                <span style="color:#1d4ed8; font-weight:700;">UPI: ₹${codUpiAmount.toLocaleString('en-IN')}</span> / <span style="color:#15803d; font-weight:700;">Cash: ₹${codCashAmount.toLocaleString('en-IN')}</span>
              </td>
              <td style="padding:0.8rem 0.6rem; text-align:right; color:var(--green); font-size:1.05rem;">
                +₹${totalEarnings.toLocaleString('en-IN')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }
}

function exportRiderReportCsv() {
  const period = document.getElementById('rider-report-period')?.value || 'all';
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let filteredOrders = riderReportOrdersCache;
  if (period === 'today') {
    filteredOrders = riderReportOrdersCache.filter((o) => new Date(o.updatedAt || o.createdAt) >= startOfDay);
  } else if (period === 'yesterday') {
    const startOfYesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
    filteredOrders = riderReportOrdersCache.filter((o) => {
      const d = new Date(o.updatedAt || o.createdAt);
      return d >= startOfYesterday && d < startOfDay;
    });
  } else if (period === 'last7') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filteredOrders = riderReportOrdersCache.filter((o) => new Date(o.updatedAt || o.createdAt) >= sevenDaysAgo);
  } else if (period === 'thisMonth') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    filteredOrders = riderReportOrdersCache.filter((o) => new Date(o.updatedAt || o.createdAt) >= startOfMonth);
  }

  const rows = [
    ['Order #', 'Customer Name', 'Customer Phone', 'Pickup Restaurant', 'Restaurant Address', 'Delivery Destination', 'Delivered Date Time', 'Order Value (INR)', 'Payment Method', 'Collection Mode', 'Trip Earnings (INR)'],
  ];

  let sumOrderValue = 0;
  let sumEarnings = 0;
  let sumCash = 0;
  let sumUpi = 0;

  filteredOrders.forEach((o) => {
    const amt = Number(o.totalAmount || 0);
    sumOrderValue += amt;
    sumEarnings += 40;
    const isCod = o.paymentMethod === 'cod';
    const collMode = isCod ? (o.codCollectedVia === 'upi' ? 'UPI' : 'Cash') : 'Prepaid Online';
    if (isCod) {
      if (o.codCollectedVia === 'upi') sumUpi += amt;
      else sumCash += amt;
    }

    rows.push([
      `#${o.orderNumber || ''}`,
      `"${(o.customerName || '').replace(/"/g, '""')}"`,
      `"${(o.deliveryAddress?.phone || o.customerPhone || '').replace(/"/g, '""')}"`,
      `"${(o.restaurantName || '').replace(/"/g, '""')}"`,
      `"${(o.restaurantAddress || '').replace(/"/g, '""')}"`,
      `"${(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`).replace(/"/g, '""')}"`,
      `"${new Date(o.updatedAt || o.createdAt).toLocaleString()}"`,
      amt.toFixed(2),
      isCod ? 'Cash on Delivery (COD)' : 'Prepaid Online',
      collMode,
      '40.00',
    ]);
  });

  // Total summary row
  rows.push([
    'Total',
    `${filteredOrders.length} Completed Trips`,
    '',
    '',
    '',
    '',
    `UPI: Rs ${sumUpi.toFixed(2)} | Cash: Rs ${sumCash.toFixed(2)}`,
    sumOrderValue.toFixed(2),
    '',
    '',
    sumEarnings.toFixed(2),
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Rider_Delivery_Report_${period}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function printRiderReport() {
  window.print();
}

// Global exports for dashboard shell
window.fetchAvailableRiderOrders = fetchAvailableRiderOrders;
window.acceptDeliveryOrder = acceptDeliveryOrder;
window.fetchActiveRiderOrders = fetchActiveRiderOrders;
window.initiateDeliverOrder = initiateDeliverOrder;
window.markOrderDelivered = markOrderDelivered;
window.openRiderCodCollectModal = openRiderCodCollectModal;
window.closeRiderCodModal = closeRiderCodModal;
window.showRiderCodPromptStep = showRiderCodPromptStep;
window.selectRiderCodMethod = selectRiderCodMethod;
window.confirmRiderCodDelivery = confirmRiderCodDelivery;
window.executeDeliverOrder = executeDeliverOrder;
window.fetchRiderHistory = fetchRiderHistory;
window.refreshRiderReportData = refreshRiderReportData;
window.renderRiderReportData = renderRiderReportData;
window.exportRiderReportCsv = exportRiderReportCsv;
window.printRiderReport = printRiderReport;

