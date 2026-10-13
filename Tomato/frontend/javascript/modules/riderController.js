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
      const restMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.restaurantAddress || o.restaurantName || 'Bengaluru')}`;
      const custMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}`;

      return `
        <div style="border:1px solid var(--line); border-radius:10px; padding:1.2rem; margin-bottom:1.2rem; background:#fff;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem;">
            <div>
              <h3 style="font-size:1.15rem; margin-bottom:0.2rem;">Order #${o.orderNumber}</h3>
              <span class="badge badge-${o.status}">Restaurant Status: ${o.status.replace(/_/g, ' ')}</span>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <button class="btn btn-danger btn-sm" onclick="rejectDeliveryOrder('${o._id}')">✕ Reject Offer</button>
              <button class="btn btn-success btn-sm" onclick="acceptDeliveryOrder('${o._id}')">🚴 Accept Delivery</button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1.2rem; margin:1rem 0; padding:0.9rem; background:#f9f6ee; border-radius:8px;">
            <div>
              <strong style="font-size:0.85rem; color:var(--tomato); text-transform:uppercase;">📍 Restaurant Pickup Location:</strong>
              <div style="font-weight:700; margin-top:0.2rem;">${escapeHtml(o.restaurantName || 'Tomato Kitchen')}</div>
              <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(o.restaurantAddress || 'Bengaluru Quarter')}</div>
              <a href="${restMapUrl}" target="_blank" style="font-size:0.8rem; color:var(--blue); font-weight:600; display:inline-block; margin-top:0.3rem;">🗺️ Open Restaurant on Map</a>
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
    switchView('rider-active');
  } catch (e) {
    alert(`Accept Delivery Error: ${e.message}`);
  }
}

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

    if (!orders.length) {
      container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No deliveries currently assigned to you. Go to "Available Pickups" to accept a new delivery order!</p>';
      return;
    }

    container.innerHTML = orders.map((o) => {
      const custMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}`;

      return `
        <div style="border:2px solid var(--green); border-radius:12px; padding:1.4rem; background:#fff; box-shadow:var(--shadow);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem;">
            <div>
              <span class="badge badge-transit" style="font-size:0.85rem;">🚴 OUT FOR DELIVERY IN PROGRESS</span>
              <h2 style="font-size:1.35rem; margin:0.4rem 0 0.2rem;">Order #${o.orderNumber}</h2>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
              <button class="btn btn-outline" style="font-size:0.88rem; padding:0.6rem 1rem;" onclick="openOrderLiveTrackingModal('${o._id}', 'rider')">
                📡 Live Route Radar
              </button>
              <button class="btn btn-success" style="font-size:0.95rem; padding:0.7rem 1.3rem;" onclick="markOrderDelivered('${o._id}')">
                ✓ Mark as Delivered
              </button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem; margin:1.2rem 0; padding:1.2rem; background:#f4f9f5; border-radius:8px;">
            <div>
              <strong style="color:var(--tomato); font-size:0.82rem; text-transform:uppercase;">Pickup Restaurant:</strong>
              <div style="font-size:1.05rem; font-weight:700; margin:0.2rem 0;">${escapeHtml(o.restaurantName || 'Restaurant')}</div>
              ${o.digipin ? `<div style="font-size:0.82rem; margin:0.2rem 0;"><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">📍 DIGIPIN: ${escapeHtml(o.digipin)}</span></div>` : ''}
              <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(o.restaurantAddress || 'Bengaluru')}</div>
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

async function markOrderDelivered(orderId) {
  if (!confirm('Confirm delivery: Has the order been delivered to the customer?')) return;
  try {
    await apiFetch(`/api/rider/orders/${orderId}/deliver`, { method: 'POST' });
    if (
      typeof activeTrackingOrderId !== 'undefined' &&
      activeTrackingOrderId &&
      String(activeTrackingOrderId) === String(orderId) &&
      typeof closeOrderLiveTrackingModal === 'function'
    ) {
      closeOrderLiveTrackingModal();
    }
    alert('Delivery completed successfully! ₹40 delivery fee has been credited to your earnings.');
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

    container.innerHTML = `
      <div style="background:var(--green-soft); border:1px solid #a3e635; padding:1.2rem; border-radius:10px; margin-bottom:1.4rem; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:0.85rem; color:#365314; font-weight:600;">TOTAL TRIP EARNINGS</span>
          <div style="font-size:2rem; font-weight:700; color:var(--green);">₹${data.totalEarnings || 0}</div>
        </div>
        <div style="text-align:right;">
          <span style="font-size:0.85rem; color:#365314;">COMPLETED DELIVERIES</span>
          <div style="font-size:1.5rem; font-weight:700; color:var(--ink);">${data.totalDeliveries || 0} Trips</div>
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

