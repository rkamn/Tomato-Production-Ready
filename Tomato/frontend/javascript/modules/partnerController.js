// =========================================================================
// PARTNER CONTROLLER MODULE (RESTAURANT & SHOP ORDERS, MENU, INVENTORY, REPORTS)
// =========================================================================
// =========================================================================
// RESTAURANT: KITCHEN ORDERS & BILL GENERATION
// =========================================================================
// RESTAURANT: KITCHEN ORDERS & BILL GENERATION
// =========================================================================
let currentRestaurantOrderFilter = 'all'; // 'all' | 'cooking' | 'incoming'
let cachedRestaurantOrders = [];
let restaurantOrdersStartDate = '';
let restaurantOrdersEndDate = '';

function applyRestaurantOrdersDateFilter() {
  const startInput = document.getElementById('rest-orders-start-date');
  const endInput = document.getElementById('rest-orders-end-date');
  const startVal = String(startInput?.value || '').trim();
  const endVal = String(endInput?.value || '').trim();

  if (startVal && endVal && startVal > endVal) {
    alert('From date cannot be later than To date.');
    return;
  }

  restaurantOrdersStartDate = startVal;
  restaurantOrdersEndDate = endVal;

  if (cachedRestaurantOrders && cachedRestaurantOrders.length) {
    renderRestaurantOrdersTable(cachedRestaurantOrders);
  } else {
    fetchRestaurantOrders();
  }
}
window.applyRestaurantOrdersDateFilter = applyRestaurantOrdersDateFilter;

function clearRestaurantOrdersDateFilter() {
  restaurantOrdersStartDate = '';
  restaurantOrdersEndDate = '';
  const startInput = document.getElementById('rest-orders-start-date');
  const endInput = document.getElementById('rest-orders-end-date');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  if (cachedRestaurantOrders && cachedRestaurantOrders.length) {
    renderRestaurantOrdersTable(cachedRestaurantOrders);
  } else {
    fetchRestaurantOrders();
  }
}
window.clearRestaurantOrdersDateFilter = clearRestaurantOrdersDateFilter;

function setRestaurantOrdersFilter(filter) {
  currentRestaurantOrderFilter = filter;
  updateRestaurantFilterButtons();
  if (cachedRestaurantOrders && cachedRestaurantOrders.length) {
    renderRestaurantOrdersTable(cachedRestaurantOrders);
  } else {
    fetchRestaurantOrders();
  }
}
window.setRestaurantOrdersFilter = setRestaurantOrdersFilter;

function updateRestaurantFilterButtons() {
  const allBtn = document.getElementById('rest-filter-all');
  const cookingBtn = document.getElementById('rest-filter-cooking');
  const incomingBtn = document.getElementById('rest-filter-incoming');
  const indicator = document.getElementById('rest-filter-indicator');
  const dateIndicator = document.getElementById('rest-date-filter-indicator');

  if (allBtn) allBtn.classList.toggle('active', currentRestaurantOrderFilter === 'all');
  if (cookingBtn) cookingBtn.classList.toggle('active', currentRestaurantOrderFilter === 'cooking');
  if (incomingBtn) incomingBtn.classList.toggle('active', currentRestaurantOrderFilter === 'incoming');

  if (dateIndicator) {
    if (restaurantOrdersStartDate || restaurantOrdersEndDate) {
      const rangeText = restaurantOrdersStartDate && restaurantOrdersEndDate
        ? `${restaurantOrdersStartDate} to ${restaurantOrdersEndDate}`
        : restaurantOrdersStartDate
        ? `From ${restaurantOrdersStartDate}`
        : `Up to ${restaurantOrdersEndDate}`;
      dateIndicator.style.display = 'inline-flex';
      dateIndicator.style.alignItems = 'center';
      dateIndicator.style.gap = '0.35rem';
      dateIndicator.innerHTML = `📅 Date Range: <strong>${escapeHtml(rangeText)}</strong> <button type="button" onclick="clearRestaurantOrdersDateFilter()" style="border:none; background:transparent; color:#1e3a8a; font-weight:800; cursor:pointer; padding:0 0.15rem;">✕</button>`;
    } else {
      dateIndicator.style.display = 'none';
      dateIndicator.innerHTML = '';
    }
  }

  if (indicator) {
    if (currentRestaurantOrderFilter === 'cooking') {
      indicator.style.display = 'inline-block';
      indicator.innerHTML = 'Filtered by: <strong>Accepted, Preparing, Out for Delivery</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setRestaurantOrdersFilter(\'all\')">Clear</button>';
    } else if (currentRestaurantOrderFilter === 'incoming') {
      indicator.style.display = 'inline-block';
      indicator.innerHTML = 'Filtered by: <strong>Placed</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setRestaurantOrdersFilter(\'all\')">Clear</button>';
    } else {
      indicator.style.display = 'none';
    }
  }
}
window.updateRestaurantFilterButtons = updateRestaurantFilterButtons;

function renderRestaurantOrdersTable(orders) {
  const container = document.getElementById('restaurant-orders-table');
  if (!container) return;

  updateRestaurantFilterButtons();

  if (!orders.length) {
    container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No orders currently placed for your restaurant.</p>';
    return;
  }

  let displayOrders = orders;
  if (currentRestaurantOrderFilter === 'cooking') {
    displayOrders = displayOrders.filter((o) => {
      const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
      return st === 'accepted' || st === 'preparing' || st === 'out for delivery';
    });
  } else if (currentRestaurantOrderFilter === 'incoming') {
    displayOrders = displayOrders.filter((o) => {
      const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
      return st === 'placed';
    });
  }

  if (restaurantOrdersStartDate || restaurantOrdersEndDate) {
    displayOrders = displayOrders.filter((o) => {
      const orderDate = new Date(o.createdAt || o.date || 0);
      if (Number.isNaN(orderDate.getTime())) return false;
      if (restaurantOrdersStartDate) {
        const start = new Date(`${restaurantOrdersStartDate}T00:00:00`);
        if (!Number.isNaN(start.getTime()) && orderDate < start) return false;
      }
      if (restaurantOrdersEndDate) {
        const end = new Date(`${restaurantOrdersEndDate}T23:59:59.999`);
        if (!Number.isNaN(end.getTime()) && orderDate > end) return false;
      }
      return true;
    });
  }

  if (!displayOrders.length) {
    const hasDateFilter = Boolean(restaurantOrdersStartDate || restaurantOrdersEndDate);
    const emptyMsg = hasDateFilter
      ? 'No kitchen orders found within the selected date range.'
      : currentRestaurantOrderFilter === 'incoming'
      ? 'No incoming orders with status "placed" found.'
      : currentRestaurantOrderFilter === 'cooking'
      ? 'No orders with status "accepted, preparing or out for delivery" found.'
      : 'No orders found for the selected filter.';
    const emptyIcon = hasDateFilter ? '📅' : currentRestaurantOrderFilter === 'incoming' ? '🔔' : '🍳';
    container.innerHTML = `
      <div style="padding:2rem 1rem; text-align:center; color:var(--muted); background:#fcfcfc; border-radius:8px; border:1px dashed var(--line); margin-top:0.5rem;">
        <div style="font-size:2rem; margin-bottom:0.5rem;">${emptyIcon}</div>
        <p style="margin:0 0 0.75rem 0; font-weight:600; color:var(--ink);">${emptyMsg}</p>
        <div style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap;">
          ${hasDateFilter ? `<button class="btn btn-outline btn-sm" onclick="clearRestaurantOrdersDateFilter()">Clear Date Range</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="clearRestaurantOrdersDateFilter(); setRestaurantOrdersFilter('all');">View All Kitchen Orders (${orders.length})</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Order #</th>
            <th>Customer</th>
            <th>Dishes</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${displayOrders.map((o) => `
            <tr>
              <td><strong>#${o.orderNumber}</strong><br><small style="color:var(--muted);">${new Date(o.createdAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })} • ${new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td>
              <td>
                <strong>${escapeHtml(o.customerName || 'Customer')}</strong><br>
                <small style="color:var(--muted);">${escapeHtml(o.deliveryAddress?.line1 || '')}, ${escapeHtml(o.deliveryAddress?.city || '')}</small>
                ${o.riderName ? `<br><small style="color:#0369a1; font-weight:600;">🚴 Rider: ${escapeHtml(o.riderName)}</small>` : ''}
              </td>
              <td>
                ${(o.items || []).map((i) => `<div>${escapeHtml(i.name)} <span style="color:var(--muted); font-size:0.75rem;">x${i.quantity}</span></div>`).join('')}
              </td>
              <td><strong style="color:var(--green);">₹${Number(o.totalAmount).toFixed(2)}</strong></td>
              <td><span class="badge ${o.paymentStatus === 'paid' ? 'badge-delivered' : 'badge-placed'}">${o.paymentMethod?.toUpperCase()} (${o.paymentStatus})</span></td>
              <td><span class="badge badge-${o.status}">${o.status.replace(/_/g, ' ')}</span></td>
              <td>
                <div style="display:flex; flex-direction:column; gap:0.35rem;">
                  ${o.status === 'placed' ? `
                    <button class="btn btn-success btn-sm" onclick="updateOrderStatus('${o._id}', 'accepted')">✓ Accept Order</button>
                    <button class="btn btn-danger btn-sm" onclick="updateOrderStatus('${o._id}', 'cancelled')">✕ Decline</button>
                  ` : ''}
                  ${o.status === 'accepted' ? `
                    <button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${o._id}', 'preparing')">🍳 Mark Preparing</button>
                  ` : ''}
                  ${o.status === 'preparing' ? `
                    <button class="btn btn-success btn-sm" onclick="updateOrderStatus('${o._id}', 'ready_for_pickup')">📦 Ready for Pickup</button>
                  ` : ''}
                  ${o.riderName && !['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase()) ? `
                    <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'restaurant')">📍 Track Rider</button>
                  ` : ''}
                  <button class="btn btn-outline btn-sm" onclick="viewOrderBill('${o._id}')">🧾 Generate Bill</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function fetchRestaurantOrders() {
  const container = document.getElementById('restaurant-orders-table');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('orders');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/restaurant/orders');
    cachedRestaurantOrders = data.orders || [];
    renderRestaurantOrdersTable(cachedRestaurantOrders);
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch restaurant orders error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

async function updateOrderStatus(orderId, nextStatus) {
  try {
    await apiFetch(`/api/restaurant/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    fetchRestaurantOrders();
  } catch (e) {
    if (typeof showServiceableAreaPopup === 'function' && e.message && e.message.toLowerCase().includes('servicable range')) {
      showServiceableAreaPopup();
    } else {
      alert(`Status Update Failed: ${e.message}`);
    }
  }
}

// =========================================================================
// SHOP: ORDERS, PACKING & BILL GENERATION
// =========================================================================
let currentShopOrderFilter = 'all'; // 'all' | 'cooking' | 'incoming'
let cachedShopOrders = [];
let shopOrdersStartDate = '';
let shopOrdersEndDate = '';

function applyShopOrdersDateFilter() {
  const startInput = document.getElementById('shop-orders-start-date');
  const endInput = document.getElementById('shop-orders-end-date');
  const startVal = String(startInput?.value || '').trim();
  const endVal = String(endInput?.value || '').trim();

  if (startVal && endVal && startVal > endVal) {
    alert('From date cannot be later than To date.');
    return;
  }

  shopOrdersStartDate = startVal;
  shopOrdersEndDate = endVal;

  if (cachedShopOrders && cachedShopOrders.length) {
    renderShopOrdersTable(cachedShopOrders);
  } else {
    fetchShopOrders();
  }
}
window.applyShopOrdersDateFilter = applyShopOrdersDateFilter;

function clearShopOrdersDateFilter() {
  shopOrdersStartDate = '';
  shopOrdersEndDate = '';
  const startInput = document.getElementById('shop-orders-start-date');
  const endInput = document.getElementById('shop-orders-end-date');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  if (cachedShopOrders && cachedShopOrders.length) {
    renderShopOrdersTable(cachedShopOrders);
  } else {
    fetchShopOrders();
  }
}
window.clearShopOrdersDateFilter = clearShopOrdersDateFilter;

function setShopOrdersFilter(filter) {
  currentShopOrderFilter = filter;
  updateShopFilterButtons();
  if (cachedShopOrders && cachedShopOrders.length) {
    renderShopOrdersTable(cachedShopOrders);
  } else {
    fetchShopOrders();
  }
}
window.setShopOrdersFilter = setShopOrdersFilter;

function updateShopFilterButtons() {
  const allBtn = document.getElementById('shop-filter-all');
  const cookingBtn = document.getElementById('shop-filter-cooking');
  const incomingBtn = document.getElementById('shop-filter-incoming');
  const indicator = document.getElementById('shop-filter-indicator');
  const dateIndicator = document.getElementById('shop-date-filter-indicator');

  if (allBtn) allBtn.classList.toggle('active', currentShopOrderFilter === 'all');
  if (cookingBtn) cookingBtn.classList.toggle('active', currentShopOrderFilter === 'cooking');
  if (incomingBtn) incomingBtn.classList.toggle('active', currentShopOrderFilter === 'incoming');

  if (dateIndicator) {
    if (shopOrdersStartDate || shopOrdersEndDate) {
      const rangeText = shopOrdersStartDate && shopOrdersEndDate
        ? `${shopOrdersStartDate} to ${shopOrdersEndDate}`
        : shopOrdersStartDate
        ? `From ${shopOrdersStartDate}`
        : `Up to ${shopOrdersEndDate}`;
      dateIndicator.style.display = 'inline-flex';
      dateIndicator.style.alignItems = 'center';
      dateIndicator.style.gap = '0.35rem';
      dateIndicator.innerHTML = `📅 Date Range: <strong>${escapeHtml(rangeText)}</strong> <button type="button" onclick="clearShopOrdersDateFilter()" style="border:none; background:transparent; color:#1e3a8a; font-weight:800; cursor:pointer; padding:0 0.15rem;">✕</button>`;
    } else {
      dateIndicator.style.display = 'none';
      dateIndicator.innerHTML = '';
    }
  }

  if (indicator) {
    if (currentShopOrderFilter === 'cooking') {
      indicator.style.display = 'inline-block';
      indicator.innerHTML = 'Filtered by: <strong>Accepted, Preparing / Packing, Out for Delivery</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setShopOrdersFilter(\'all\')">Clear</button>';
    } else if (currentShopOrderFilter === 'incoming') {
      indicator.style.display = 'inline-block';
      indicator.innerHTML = 'Filtered by: <strong>Placed</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setShopOrdersFilter(\'all\')">Clear</button>';
    } else {
      indicator.style.display = 'none';
    }
  }
}
window.updateShopFilterButtons = updateShopFilterButtons;

function renderShopOrdersTable(orders) {
  const container = document.getElementById('shop-orders-table');
  if (!container) return;

  updateShopFilterButtons();

  if (!orders.length) {
    container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No shop orders currently placed for your shop.</p>';
    return;
  }

  let displayOrders = orders;
  if (currentShopOrderFilter === 'cooking') {
    displayOrders = displayOrders.filter((o) => {
      const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
      return st === 'accepted' || st === 'preparing' || st === 'out for delivery';
    });
  } else if (currentShopOrderFilter === 'incoming') {
    displayOrders = displayOrders.filter((o) => {
      const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
      return st === 'placed';
    });
  }

  if (shopOrdersStartDate || shopOrdersEndDate) {
    displayOrders = displayOrders.filter((o) => {
      const orderDate = new Date(o.createdAt || o.date || 0);
      if (Number.isNaN(orderDate.getTime())) return false;
      if (shopOrdersStartDate) {
        const start = new Date(`${shopOrdersStartDate}T00:00:00`);
        if (!Number.isNaN(start.getTime()) && orderDate < start) return false;
      }
      if (shopOrdersEndDate) {
        const end = new Date(`${shopOrdersEndDate}T23:59:59.999`);
        if (!Number.isNaN(end.getTime()) && orderDate > end) return false;
      }
      return true;
    });
  }

  if (!displayOrders.length) {
    const hasDateFilter = Boolean(shopOrdersStartDate || shopOrdersEndDate);
    const emptyMsg = hasDateFilter
      ? 'No shop orders found within the selected date range.'
      : currentShopOrderFilter === 'incoming'
      ? 'No incoming shop orders with status "placed" found.'
      : currentShopOrderFilter === 'cooking'
      ? 'No shop orders with status "accepted, preparing or out for delivery" found.'
      : 'No shop orders found for the selected filter.';
    const emptyIcon = hasDateFilter ? '📅' : currentShopOrderFilter === 'incoming' ? '🔔' : '📦';
    container.innerHTML = `
      <div style="padding:2rem 1rem; text-align:center; color:var(--muted); background:#fcfcfc; border-radius:8px; border:1px dashed var(--line); margin-top:0.5rem;">
        <div style="font-size:2rem; margin-bottom:0.5rem;">${emptyIcon}</div>
        <p style="margin:0 0 0.75rem 0; font-weight:600; color:var(--ink);">${emptyMsg}</p>
        <div style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap;">
          ${hasDateFilter ? `<button class="btn btn-outline btn-sm" onclick="clearShopOrdersDateFilter()">Clear Date Range</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="clearShopOrdersDateFilter(); setShopOrdersFilter('all');">View All Shop Orders (${orders.length})</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Order #</th>
            <th>Customer</th>
            <th>Products / Items</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${displayOrders.map((o) => `
            <tr>
              <td><strong>#${o.orderNumber}</strong><br><small style="color:var(--muted);">${new Date(o.createdAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })} • ${new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td>
              <td>
                <strong>${escapeHtml(o.customerName || 'Customer')}</strong><br>
                <small style="color:var(--muted);">${escapeHtml(o.deliveryAddress?.line1 || '')}, ${escapeHtml(o.deliveryAddress?.city || '')}</small>
                ${o.riderName ? `<br><small style="color:#0369a1; font-weight:600;">🚴 Rider: ${escapeHtml(o.riderName)}</small>` : ''}
              </td>
              <td>
                ${(o.items || []).map((i) => `<div>${escapeHtml(i.name)} <span style="color:var(--muted); font-size:0.75rem;">x${i.quantity}</span></div>`).join('')}
              </td>
              <td><strong style="color:var(--green);">₹${Number(o.totalAmount).toFixed(2)}</strong></td>
              <td><span class="badge ${o.paymentStatus === 'paid' ? 'badge-delivered' : 'badge-placed'}">${o.paymentMethod?.toUpperCase()} (${o.paymentStatus})</span></td>
              <td><span class="badge badge-${o.status}">${o.status.replace(/_/g, ' ')}</span></td>
              <td>
                <div style="display:flex; flex-direction:column; gap:0.35rem;">
                  ${o.status === 'placed' ? `
                    <button class="btn btn-success btn-sm" onclick="updateShopOrderStatus('${o._id}', 'accepted')">✓ Accept Order</button>
                    <button class="btn btn-danger btn-sm" onclick="updateShopOrderStatus('${o._id}', 'cancelled')">✕ Decline</button>
                  ` : ''}
                  ${o.status === 'accepted' ? `
                    <button class="btn btn-primary btn-sm" onclick="updateShopOrderStatus('${o._id}', 'preparing')">📦 Mark Packing</button>
                  ` : ''}
                  ${o.status === 'preparing' ? `
                    <button class="btn btn-success btn-sm" onclick="updateShopOrderStatus('${o._id}', 'ready_for_pickup')">✅ Ready for Pickup</button>
                  ` : ''}
                  ${o.riderName && !['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase()) ? `
                    <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'shop')">📍 Track Rider</button>
                  ` : ''}
                  <button class="btn btn-outline btn-sm" onclick="viewShopOrderBill('${o._id}')">🧾 Generate Bill</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
window.renderShopOrdersTable = renderShopOrdersTable;

async function fetchShopOrders() {
  const container = document.getElementById('shop-orders-table');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('shop orders');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/shop/orders');
    cachedShopOrders = data.orders || [];
    renderShopOrdersTable(cachedShopOrders);
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch shop orders error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}
window.fetchShopOrders = fetchShopOrders;

async function updateShopOrderStatus(orderId, nextStatus) {
  try {
    await apiFetch(`/api/shop/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    fetchShopOrders();
  } catch (e) {
    if (typeof showServiceableAreaPopup === 'function' && e.message && e.message.toLowerCase().includes('servicable range')) {
      showServiceableAreaPopup();
    } else {
      alert(`Shop Status Update Failed: ${e.message}`);
    }
  }
}
window.updateShopOrderStatus = updateShopOrderStatus;

async function viewShopOrderBill(orderId) {
  try {
    const data = await apiFetch(`/api/shop/orders/${orderId}/bill`);
    const bill = data.bill;
    renderBillModalWithCoupons(bill, orderId, true);
    openModal('bill-modal');
  } catch (e) {
    alert(`Shop Bill Generation Failed: ${e.message}`);
  }
}
window.viewShopOrderBill = viewShopOrderBill;

// =========================================================================
// SHOP: INVENTORY & ITEM MANAGEMENT
// =========================================================================
async function fetchShopItems() {
  const container = document.getElementById('shop-items-table');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('shop items');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/shop/items');
    const items = data.items || [];

    if (!items.length) {
      container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No items added to shop inventory yet. Click "+ Add New Shop Item" above.</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Product / Item Name</th>
              <th>Category</th>
              <th>Unit / Pack</th>
              <th>Price</th>
              <th>Stock in Hand</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it) => `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div style="width:38px; height:38px; border-radius:50%; border:2px solid #2563eb; overflow:hidden; display:flex; align-items:center; justify-content:center; background:#eff6ff; flex-shrink:0;">
                      <img src="${it.image && it.image.trim() ? escapeHtml(resolveImageUrl(it.image)) : DEFAULT_TOMATO_SVG_URI}" alt="${escapeHtml(it.name)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.onerror=null; this.src=DEFAULT_TOMATO_SVG_URI;" />
                    </div>
                    <div>
                      <strong>${escapeHtml(it.name)}</strong>
                      ${it.description ? `<br><small style="color:var(--muted);">${escapeHtml(it.description)}</small>` : ''}
                    </div>
                  </div>
                </td>
                <td>${escapeHtml(it.category || 'General')}</td>
                <td>${escapeHtml(it.unit || '1 unit')}</td>
                <td><strong style="color:var(--green);">₹${Number(it.price).toFixed(2)}</strong></td>
                <td>${it.quantity} in stock</td>
                <td><span class="badge ${it.isActive ? 'badge-delivered' : 'badge-cancelled'}">${it.isActive ? 'Active' : 'Hidden'}</span></td>
                <td>
                  <div style="display:flex; gap:0.4rem;">
                    <button class="btn btn-outline btn-sm" onclick="editShopItem('${it._id}', '${escapeHtml(it.name)}', '${escapeHtml(it.category || '')}', '${escapeHtml(it.unit || '')}', '${escapeHtml(it.description || '')}', ${it.price}, ${it.quantity}, ${Boolean(it.isActive)}, '${escapeHtml(it.image || '')}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteShopItem('${it._id}')">Delete</button>
                  </div>
                </td>
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
      console.error('Fetch shop items error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}
window.fetchShopItems = fetchShopItems;

function openAddShopItemModal() {
  document.getElementById('shop-modal-title').textContent = 'Add Shop Item';
  document.getElementById('shop-item-id').value = '';
  document.getElementById('si-name').value = '';
  document.getElementById('si-category').value = 'Groceries';
  document.getElementById('si-unit').value = '1 pack';
  document.getElementById('si-price').value = '';
  document.getElementById('si-quantity').value = '50';
  document.getElementById('si-desc').value = '';
  document.getElementById('si-active').checked = true;

  const siImgUrl = document.getElementById('si-image-url');
  const siImgFile = document.getElementById('si-image-file');
  const siImgPreview = document.getElementById('si-image-preview');
  const siImgPh = document.getElementById('si-image-placeholder');
  const siImgSt = document.getElementById('si-image-status');
  if (siImgUrl) siImgUrl.value = '';
  if (siImgFile) siImgFile.value = '';
  if (siImgPreview) { siImgPreview.src = ''; siImgPreview.style.display = 'none'; }
  if (siImgPh) siImgPh.style.display = 'inline-block';
  if (siImgSt) { siImgSt.textContent = 'Upload product image now or replace anytime.'; siImgSt.style.color = 'var(--muted)'; }

  openModal('shop-item-modal');
}
window.openAddShopItemModal = openAddShopItemModal;

function editShopItem(id, name, category, unit, desc, price, qty, isActive, image) {
  document.getElementById('shop-modal-title').textContent = 'Edit Shop Item';
  document.getElementById('shop-item-id').value = id;
  document.getElementById('si-name').value = name;
  document.getElementById('si-category').value = category;
  document.getElementById('si-unit').value = unit || '1 pack';
  document.getElementById('si-price').value = price;
  document.getElementById('si-quantity').value = qty;
  document.getElementById('si-desc').value = desc;
  document.getElementById('si-active').checked = isActive;

  const siImgUrl = document.getElementById('si-image-url');
  const siImgFile = document.getElementById('si-image-file');
  const siImgPreview = document.getElementById('si-image-preview');
  const siImgPh = document.getElementById('si-image-placeholder');
  const siImgSt = document.getElementById('si-image-status');
  if (siImgUrl) siImgUrl.value = image || '';
  if (siImgFile) siImgFile.value = '';
  if (image) {
    if (siImgPreview) { siImgPreview.src = resolveImageUrl(image); siImgPreview.style.display = 'block'; }
    if (siImgPh) siImgPh.style.display = 'none';
    if (siImgSt) { siImgSt.textContent = 'Current image loaded. Select a new file to replace it.'; siImgSt.style.color = 'var(--muted)'; }
  } else {
    if (siImgPreview) { siImgPreview.src = ''; siImgPreview.style.display = 'none'; }
    if (siImgPh) siImgPh.style.display = 'inline-block';
    if (siImgSt) { siImgSt.textContent = 'No image uploaded yet. You can upload one now.'; siImgSt.style.color = 'var(--muted)'; }
  }

  openModal('shop-item-modal');
}
window.editShopItem = editShopItem;

async function saveShopItem(e) {
  e.preventDefault();
  const id = document.getElementById('shop-item-id').value;
  const payload = {
    name: document.getElementById('si-name').value.trim(),
    category: document.getElementById('si-category').value.trim(),
    unit: document.getElementById('si-unit').value.trim(),
    price: Number(document.getElementById('si-price').value),
    quantity: Number(document.getElementById('si-quantity').value),
    description: document.getElementById('si-desc').value.trim(),
    image: document.getElementById('si-image-url')?.value?.trim() || '',
    isActive: document.getElementById('si-active').checked,
  };

  try {
    if (id) {
      await apiFetch(`/api/shop/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/shop/items', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('shop-item-modal');
    fetchShopItems();
  } catch (err) {
    alert(`Error saving shop item: ${err.message}`);
  }
}
window.saveShopItem = saveShopItem;

async function deleteShopItem(id) {
  if (!confirm('Are you sure you want to delete this shop item?')) return;
  try {
    await apiFetch(`/api/shop/items/${id}`, { method: 'DELETE' });
    fetchShopItems();
  } catch (e) {
    alert(e.message);
  }
}
window.deleteShopItem = deleteShopItem;

// Generate & View Bill (Usable by Restaurant, Shop, Customer, and Admin)
let currentBillModalOrderId = null;
let currentBillModalData = null;

function renderBillModalWithCoupons(bill, orderId, isShopBill = false) {
  currentBillModalOrderId = orderId || bill.orderId || currentBillModalOrderId;
  currentBillModalData = bill;

  const subtotal = Number(bill.subtotal || 0);
  const cgst = Number(bill.cgst || 0);
  const sgst = Number(bill.sgst || 0);
  const deliveryFee = Number(bill.deliveryFee ?? 40);
  const grossAmount = Number(bill.grossAmount ?? (subtotal + cgst + sgst + deliveryFee));
  const discountAmount = Number(bill.discountAmount || 0);
  const appliedCoupons = Array.isArray(bill.appliedCoupons) ? bill.appliedCoupons : [];
  const couponCodes = Array.isArray(bill.couponCodes)
    ? bill.couponCodes
    : appliedCoupons.map((c) => c.code).filter(Boolean);
  const netPayable = discountAmount > 0
    ? Math.max(0, Number((grossAmount - discountAmount).toFixed(2)))
    : Number(bill.totalAmount ?? grossAmount);

  const individualCouponRowsHtml = appliedCoupons.length > 0
    ? appliedCoupons.map((ac) => `
      <div style="display:flex; justify-content:space-between; color:#15803d; font-size:0.82rem;">
        <span>🎟️ Coupon Applied: <strong>${escapeHtml(ac.code)}</strong>${ac.title ? ` (${escapeHtml(ac.title)})` : ''}:</span>
        <strong>-₹${Number(ac.discountAmount || 0).toFixed(2)}</strong>
      </div>
    `).join('')
    : couponCodes.length > 0 && discountAmount > 0
    ? `
      <div style="display:flex; justify-content:space-between; color:#15803d; font-size:0.82rem;">
        <span>🎟️ Coupon Applied (${couponCodes.map((c) => escapeHtml(c)).join(' + ')}):</span>
        <strong>-₹${discountAmount.toFixed(2)}</strong>
      </div>
    `
    : '';

  const storeTitle = isShopBill
    ? (bill.shop?.name || bill.restaurant?.name || 'Shop Partner')
    : (bill.restaurant?.name || bill.shop?.name || 'Restaurant Partner');
  const storeAddress = isShopBill
    ? (bill.shop?.address || bill.restaurant?.address || '')
    : (bill.restaurant?.address || bill.shop?.address || '');
  const storePhone = isShopBill
    ? (bill.shop?.phone || bill.restaurant?.phone || '')
    : (bill.restaurant?.phone || bill.shop?.phone || '');
  const storeGsn = bill.gsnNumber || bill.shop?.gsnNumber || bill.restaurant?.gsnNumber || bill.restaurant?.gstin || 'NA';

  const printArea = document.getElementById('bill-print-area');
  if (!printArea) return;

  printArea.innerHTML = `
    <div class="bill-container">
      <div class="bill-head">
        <h2>${escapeHtml(storeTitle)}</h2>
        <div style="font-size:0.8rem;">${escapeHtml(storeAddress)}</div>
        <div style="font-size:0.75rem;">Phone: ${escapeHtml(storePhone)} | GSN / GSTIN: <strong>${escapeHtml(storeGsn)}</strong></div>
        ${bill.platformGsnNumber && bill.platformGsnNumber !== storeGsn ? `<div style="font-size:0.72rem; color:#555;">Platform GSN: ${escapeHtml(bill.platformGsnNumber)}</div>` : ''}
        <div style="margin-top:0.6rem; font-weight:700; font-size:1.1rem; letter-spacing:0.1em;">${isShopBill ? 'RETAIL SHOP TAX INVOICE' : 'RETAIL TAX INVOICE'}</div>
      </div>

      <div class="bill-details">
        <div>
          <div><strong>Invoice #:</strong> ${escapeHtml(bill.invoiceNumber)}</div>
          <div><strong>Order #:</strong> #${escapeHtml(bill.orderNumber)}</div>
          <div><strong>Date:</strong> ${new Date(bill.date).toLocaleString()}</div>
          ${couponCodes.length ? `<div><strong>Coupon Code:</strong> <span style="font-family:monospace; color:#15803d; font-weight:700;">${couponCodes.map((c) => escapeHtml(c)).join(', ')}</span></div>` : ''}
        </div>
        <div style="text-align:right;">
          <div><strong>Billed To:</strong> ${escapeHtml(bill.customer?.name || 'Customer')}</div>
          <div><strong>Contact:</strong> ${escapeHtml(bill.customer?.phone || 'N/A')}</div>
          <div><strong>Address:</strong> ${escapeHtml(bill.customer?.address?.line1 || '')}, ${escapeHtml(bill.customer?.address?.city || '')}</div>
        </div>
      </div>

      <table class="bill-table">
        <thead>
          <tr>
            <th>Item Description</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Rate</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${(bill.items || []).map((i) => `
            <tr>
              <td>${escapeHtml(i.name)}</td>
              <td style="text-align:center;">${i.quantity}</td>
              <td style="text-align:right;">₹${Number(i.price).toFixed(2)}</td>
              <td style="text-align:right;">₹${Number(i.totalPrice || i.price * i.quantity).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="bill-summary">
        <div style="display:flex; justify-content:space-between;">
          <span>Subtotal:</span>
          <span>₹${subtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>CGST (2.5%):</span>
          <span>₹${cgst.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>SGST (2.5%):</span>
          <span>₹${sgst.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>Packing &amp; Delivery Fee:</span>
          <span>₹${deliveryFee.toFixed(2)}</span>
        </div>
        ${discountAmount > 0 ? `
        <div style="display:flex; justify-content:space-between; border-top:1px dashed #ccc; padding-top:0.25rem; margin-top:0.2rem; color:#555;">
          <span>Gross Bill Total (Before Coupon):</span>
          <span style="text-decoration:line-through;">₹${grossAmount.toFixed(2)}</span>
        </div>
        ${individualCouponRowsHtml}
        <div style="display:flex; justify-content:space-between; color:#15803d; font-weight:700; background:#f0fdf4; padding:0.25rem 0.4rem; border-radius:4px; margin:0.2rem 0;">
          <span>Total Coupon Reduction (${couponCodes.map((c) => escapeHtml(c)).join(' + ') || 'Applied'}):</span>
          <span>-₹${discountAmount.toFixed(2)}</span>
        </div>` : ''}
        <div class="bill-total-row">
          <span>NET PAYABLE${discountAmount > 0 ? ' (After Coupon)' : ''}:</span>
          <span style="color:var(--green);">₹${netPayable.toFixed(2)}</span>
        </div>
      </div>

      <div style="margin-top:0.8rem; font-size:0.75rem; border-top:1px dashed #777; padding-top:0.6rem;">
        <div>Payment Mode: <strong style="text-transform:uppercase;">${escapeHtml(bill.paymentMethod || 'cod')} (${escapeHtml(bill.paymentStatus || 'pending')})</strong></div>
        <div>Transaction ID: ${escapeHtml(bill.paymentTransactionId || 'N/A')}</div>
        ${bill.rider ? `<div>Assigned Rider: ${escapeHtml(typeof bill.rider === 'string' ? bill.rider : (bill.rider.name || ''))}</div>` : ''}
        <div style="text-align:center; margin-top:0.8rem;">Thank you for your order with Tomato! Visit Again.</div>
      </div>
    </div>
  `;
}

function setBillModalCouponFeedback(message, isError = false) {
  const el = document.getElementById('bill-modal-coupon-feedback');
  if (!el) return;
  if (!message) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.style.color = isError ? '#dc2626' : '#15803d';
  el.style.fontWeight = '600';
  el.textContent = message;
}

async function applyCouponCodeInsideBillModal() {
  if (!currentBillModalOrderId) return;
  const input = document.getElementById('bill-modal-coupon-input');
  const rawCode = String(input?.value || '').trim().toUpperCase();
  if (!rawCode) {
    setBillModalCouponFeedback('Please enter a coupon code to apply to this bill.', true);
    return;
  }

  const existingCodes = Array.isArray(currentBillModalData?.couponCodes)
    ? [...currentBillModalData.couponCodes]
    : [];
  if (existingCodes.includes(rawCode)) {
    setBillModalCouponFeedback(`Coupon "${rawCode}" is already applied to this bill.`, true);
    return;
  }
  if (existingCodes.length >= 1) {
    setBillModalCouponFeedback('Only 1 coupon code can be used on a bill. Remove the applied coupon to use another.', true);
    return;
  }

  const nextCodes = [...existingCodes, rawCode];
  try {
    const res = await apiFetch(`/api/customer/orders/${currentBillModalOrderId}/apply-coupon`, {
      method: 'POST',
      body: JSON.stringify({ couponCodes: nextCodes }),
    });
    if (input) input.value = '';
    setBillModalCouponFeedback(res.message || `Applied coupon ${rawCode}!`, false);
    if (res.bill) {
      renderBillModalWithCoupons(res.bill, currentBillModalOrderId, String(res.bill.orderNumber || '').startsWith('SHOP-'));
    }
    if (typeof fetchCustomerOrders === 'function') fetchCustomerOrders();
  } catch (err) {
    setBillModalCouponFeedback(err.message || 'Unable to apply coupon to bill.', true);
  }
}
window.applyCouponCodeInsideBillModal = applyCouponCodeInsideBillModal;

async function removeCouponFromBillModal(codeToRemove) {
  if (!currentBillModalOrderId) return;
  const cleanRemove = String(codeToRemove || '').trim().toUpperCase();
  const existingCodes = Array.isArray(currentBillModalData?.couponCodes)
    ? currentBillModalData.couponCodes.filter((c) => c !== cleanRemove)
    : [];
  try {
    const res = await apiFetch(`/api/customer/orders/${currentBillModalOrderId}/apply-coupon`, {
      method: 'POST',
      body: JSON.stringify({ couponCodes: existingCodes }),
    });
    setBillModalCouponFeedback(res.message || `Removed coupon ${cleanRemove}.`, false);
    if (res.bill) {
      renderBillModalWithCoupons(res.bill, currentBillModalOrderId, String(res.bill.orderNumber || '').startsWith('SHOP-'));
    }
    if (typeof fetchCustomerOrders === 'function') fetchCustomerOrders();
  } catch (err) {
    setBillModalCouponFeedback(err.message || 'Unable to remove coupon.', true);
  }
}
window.removeCouponFromBillModal = removeCouponFromBillModal;

async function viewOrderBill(orderId) {
  try {
    setBillModalCouponFeedback('');
    let endpoint = `/api/customer/orders/${orderId}/bill`;
    if (role === 'restaurant') endpoint = `/api/restaurant/orders/${orderId}/bill`;
    else if (role === 'shop') endpoint = `/api/shop/orders/${orderId}/bill`;
    else if (role === 'admin' || role === 'subadmin') endpoint = `/api/admin/orders/${orderId}/bill`;

    const data = await apiFetch(endpoint);
    const bill = data.bill;
    const isShopBill = role === 'shop' || String(bill?.orderNumber || '').startsWith('SHOP-');

    renderBillModalWithCoupons(bill, orderId, isShopBill);
    openModal('bill-modal');
  } catch (e) {
    alert(`Unable to generate bill: ${e.message}`);
  }
}

// =========================================================================
// RESTAURANT: MENU MANAGEMENT
// =========================================================================
async function fetchRestaurantMenu() {
  const container = document.getElementById('restaurant-menu-table');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('dishes');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/restaurant/menu');
    const menu = data.menu || [];

    if (!menu.length) {
      container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No dishes added yet. Click "+ Add New Food Item" above.</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Dish Name</th>
              <th>Category</th>
              <th>Dietary</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${menu.map((m) => `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div style="width:38px; height:38px; border-radius:50%; border:2px solid #2563eb; overflow:hidden; display:flex; align-items:center; justify-content:center; background:#eff6ff; flex-shrink:0;">
                      <img src="${m.image && m.image.trim() ? escapeHtml(resolveImageUrl(m.image)) : DEFAULT_TOMATO_SVG_URI}" alt="${escapeHtml(m.name)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.onerror=null; this.src=DEFAULT_TOMATO_SVG_URI;" />
                    </div>
                    <div>
                      <strong>${escapeHtml(m.name)}</strong>
                      ${m.description ? `<br><small style="color:var(--muted);">${escapeHtml(m.description)}</small>` : ''}
                    </div>
                  </div>
                </td>
                <td>${escapeHtml(m.category)}</td>
                <td><span class="dietary-tag ${m.dietary === 'non-veg' ? 'dietary-non-veg' : 'dietary-veg'}">${(m.dietary || 'veg').toUpperCase()}</span></td>
                <td><strong style="color:var(--green);">₹${Number(m.price).toFixed(2)}</strong></td>
                <td>${m.quantity} in stock</td>
                <td><span class="badge ${m.isActive ? 'badge-delivered' : 'badge-cancelled'}">${m.isActive ? 'Active' : 'Hidden'}</span></td>
                <td>
                  <div style="display:flex; gap:0.4rem;">
                    <button class="btn btn-outline btn-sm" onclick="editMenuItem('${m._id}', '${escapeHtml(m.name)}', '${escapeHtml(m.category)}', '${escapeHtml(m.description || '')}', ${m.price}, ${m.quantity}, '${m.dietary}', ${Boolean(m.isActive)}, '${escapeHtml(m.image || '')}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteMenuItem('${m._id}')">Delete</button>
                  </div>
                </td>
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
      console.error('Fetch restaurant menu error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

let allMenuCategories = [];
let highlightedCategoryIndex = -1;

async function fetchRestaurantMenuCategories() {
  try {
    const res = await apiFetch('/api/restaurant/menu/categories');
    if (res && Array.isArray(res.categories)) {
      allMenuCategories = res.categories;
    }
  } catch (err) {
    console.error('Failed to load menu categories:', err);
    if (!allMenuCategories.length) {
      allMenuCategories = [
        'Chinese',
        'Main Course',
        'Starters',
        'Snacks',
        'Desserts',
        'Beverages',
        'Fast Food',
        'Breads & Rice',
        'Soups',
        'Salads',
        'Combos',
      ];
    }
  }
}

function highlightCategoryMatch(text, query) {
  const safeText = typeof escapeHtml === 'function' ? escapeHtml(text) : String(text || '');
  if (!query) return safeText;
  try {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return safeText.replace(regex, '<span style="font-weight:800; color:#2563eb; text-decoration:underline;">$1</span>');
  } catch (e) {
    return safeText;
  }
}

function openCategoryDropdown(showAll = false) {
  const dropdown = document.getElementById('mi-category-dropdown');
  if (!dropdown) return;
  dropdown.style.display = 'block';
  highlightedCategoryIndex = -1;

  const input = document.getElementById('mi-category');
  const textToFilter = showAll ? '' : (input ? input.value : '');

  if (!allMenuCategories || allMenuCategories.length === 0) {
    fetchRestaurantMenuCategories().then(() => {
      renderCategoryDropdownOptions(textToFilter);
    });
  } else {
    renderCategoryDropdownOptions(textToFilter);
  }
}

function closeCategoryDropdown() {
  const dropdown = document.getElementById('mi-category-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
  highlightedCategoryIndex = -1;
}

function toggleCategoryDropdown(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dropdown = document.getElementById('mi-category-dropdown');
  if (!dropdown) return;
  if (dropdown.style.display === 'block') {
    closeCategoryDropdown();
  } else {
    const input = document.getElementById('mi-category');
    if (input) {
      input.focus();
      input.select();
    }
    openCategoryDropdown(true);
  }
}

function renderCategoryDropdownOptions(filterText = '') {
  const dropdown = document.getElementById('mi-category-dropdown');
  if (!dropdown) return;

  const rawQuery = String(filterText || '').trim();
  const query = rawQuery.toLowerCase();

  // Case-insensitive filtering across all platform categories
  const matches = (allMenuCategories || []).filter((c) =>
    String(c || '').trim().toLowerCase().includes(query)
  );

  // Case-insensitive exact match check
  const exactMatch = (allMenuCategories || []).some(
    (c) => String(c || '').trim().toLowerCase() === query
  );

  let html = '';

  if (matches.length > 0) {
    matches.forEach((cat, idx) => {
      const isSelected = query && String(cat || '').trim().toLowerCase() === query;
      const isHighlighted = idx === highlightedCategoryIndex;
      const bg = isHighlighted ? '#e2e8f0' : isSelected ? '#eff6ff' : 'transparent';
      const escapedAttr = String(cat).replace(/"/g, '&quot;');
      const escapedArg = String(cat).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const displayLabel = highlightCategoryMatch(cat, rawQuery);

      html += `
        <div
          class="category-option-item ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}"
          data-category="${escapedAttr}"
          data-index="${idx}"
          style="padding: 7px 10px; cursor: pointer; border-radius: 6px; font-size: 0.88rem; color: var(--ink, #1f221e); display: flex; align-items: center; justify-content: space-between; background: ${bg}; transition: background 0.15s ease;"
          onmouseenter="highlightCategoryOption(${idx})"
          onmousedown="selectCategoryItem('${escapedArg}')"
        >
          <span>${displayLabel}</span>
          ${isSelected ? '<span style="color:#2563eb; font-weight:700; font-size:0.8rem;">✓</span>' : ''}
        </div>
      `;
    });
  } else if (!rawQuery) {
    html = `<div style="padding: 8px 12px; font-size: 0.85rem; color: var(--muted, #64748b);">No categories available</div>`;
  }

  // If user typed something and it doesn't match an existing category case-insensitively, offer to add it!
  if (rawQuery && !exactMatch) {
    const escapedArg = rawQuery.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedDisplay = typeof escapeHtml === 'function' ? escapeHtml(rawQuery) : rawQuery;
    html += `
      <div
        class="category-option-add"
        style="padding: 8px 10px; cursor: pointer; border-radius: 6px; font-size: 0.85rem; font-weight: 600; color: #2563eb; background: #eff6ff; border-top: 1px dashed #cbd5e1; margin-top: 4px; display: flex; align-items: center; gap: 6px; transition: background 0.15s ease;"
        onmouseenter="this.style.background='#dbeafe'"
        onmouseleave="this.style.background='#eff6ff'"
        onmousedown="addNewCategoryItem('${escapedArg}')"
      >
        <span style="font-size: 0.95rem;">➕</span>
        <span>Add &ldquo;<strong>${escapedDisplay}</strong>&rdquo; to category list</span>
      </div>
    `;
  }

  dropdown.innerHTML = html;
}

function highlightCategoryOption(index) {
  highlightedCategoryIndex = index;
  const items = document.querySelectorAll('#mi-category-dropdown .category-option-item');
  items.forEach((item, idx) => {
    if (idx === index) {
      item.style.background = '#e2e8f0';
    } else {
      const isSelected = item.classList.contains('selected');
      item.style.background = isSelected ? '#eff6ff' : 'transparent';
    }
  });
}

function selectCategoryItem(category) {
  const input = document.getElementById('mi-category');
  if (input) {
    input.value = category;
  }
  closeCategoryDropdown();
}

async function addNewCategoryItem(newCategory) {
  const trimmed = String(newCategory || '').trim();
  if (!trimmed) return;

  // Case-insensitive check: if it already exists in the list, reuse the existing one
  const existing = (allMenuCategories || []).find(
    (c) => String(c || '').trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) {
    selectCategoryItem(existing);
    return;
  }

  allMenuCategories.push(trimmed);
  allMenuCategories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const input = document.getElementById('mi-category');
  if (input) {
    input.value = trimmed;
  }
  closeCategoryDropdown();

  // Persist category to backend category list
  try {
    await apiFetch('/api/restaurant/menu/categories', {
      method: 'POST',
      body: JSON.stringify({ category: trimmed }),
    });
  } catch (err) {
    console.warn('Failed to persist category to server:', err);
  }
}

function handleCategoryInput(e) {
  openCategoryDropdown(false);
  renderCategoryDropdownOptions(e.target.value);
}

function handleCategoryKeydown(e) {
  const dropdown = document.getElementById('mi-category-dropdown');
  const isDropdownVisible = dropdown && dropdown.style.display === 'block';

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!isDropdownVisible) {
      openCategoryDropdown(false);
      return;
    }
    const items = document.querySelectorAll('#mi-category-dropdown .category-option-item');
    if (items.length > 0) {
      highlightedCategoryIndex = (highlightedCategoryIndex + 1) % items.length;
      highlightCategoryOption(highlightedCategoryIndex);
      items[highlightedCategoryIndex].scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!isDropdownVisible) {
      openCategoryDropdown(false);
      return;
    }
    const items = document.querySelectorAll('#mi-category-dropdown .category-option-item');
    if (items.length > 0) {
      highlightedCategoryIndex =
        (highlightedCategoryIndex - 1 + items.length) % items.length;
      highlightCategoryOption(highlightedCategoryIndex);
      items[highlightedCategoryIndex].scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    if (isDropdownVisible) {
      const items = document.querySelectorAll('#mi-category-dropdown .category-option-item');
      if (highlightedCategoryIndex >= 0 && items[highlightedCategoryIndex]) {
        e.preventDefault();
        const selectedCat = items[highlightedCategoryIndex].getAttribute('data-category');
        selectCategoryItem(selectedCat);
      } else {
        const input = document.getElementById('mi-category');
        const typed = input ? input.value.trim() : '';
        if (typed) {
          e.preventDefault();
          // Case-insensitive exact match check before adding
          const matched = (allMenuCategories || []).find(
            (c) => String(c || '').trim().toLowerCase() === typed.toLowerCase()
          );
          if (matched) {
            selectCategoryItem(matched);
          } else {
            addNewCategoryItem(typed);
          }
        }
      }
    }
  } else if (e.key === 'Escape') {
    closeCategoryDropdown();
  }
}

// Global click listener to close category dropdown when clicked outside
document.addEventListener('click', (e) => {
  const wrapper = document.querySelector('.category-combobox-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    closeCategoryDropdown();
  }
});

function openAddMenuItemModal() {
  document.getElementById('menu-modal-title').textContent = 'Add Menu Item';
  document.getElementById('menu-item-id').value = '';
  document.getElementById('mi-name').value = '';
  document.getElementById('mi-category').value = 'Chinese';
  document.getElementById('mi-dietary').value = 'veg';
  document.getElementById('mi-price').value = '';
  document.getElementById('mi-quantity').value = '20';
  document.getElementById('mi-desc').value = '';
  document.getElementById('mi-active').checked = true;

  const miImgUrl = document.getElementById('mi-image-url');
  const miImgFile = document.getElementById('mi-image-file');
  const miImgPreview = document.getElementById('mi-image-preview');
  const miImgPh = document.getElementById('mi-image-placeholder');
  const miImgSt = document.getElementById('mi-image-status');
  if (miImgUrl) miImgUrl.value = '';
  if (miImgFile) miImgFile.value = '';
  if (miImgPreview) { miImgPreview.src = ''; miImgPreview.style.display = 'none'; }
  if (miImgPh) miImgPh.style.display = 'inline-block';
  if (miImgSt) { miImgSt.textContent = 'Upload dish image now or replace anytime.'; miImgSt.style.color = 'var(--muted)'; }

  closeCategoryDropdown();
  fetchRestaurantMenuCategories();
  openModal('menu-item-modal');
}

function editMenuItem(id, name, category, desc, price, qty, dietary, isActive, image) {
  document.getElementById('menu-modal-title').textContent = 'Edit Menu Item';
  document.getElementById('menu-item-id').value = id;
  document.getElementById('mi-name').value = name;
  document.getElementById('mi-category').value = category;
  document.getElementById('mi-dietary').value = dietary || 'veg';
  document.getElementById('mi-price').value = price;
  document.getElementById('mi-quantity').value = qty;
  document.getElementById('mi-desc').value = desc;
  document.getElementById('mi-active').checked = isActive;

  const miImgUrl = document.getElementById('mi-image-url');
  const miImgFile = document.getElementById('mi-image-file');
  const miImgPreview = document.getElementById('mi-image-preview');
  const miImgPh = document.getElementById('mi-image-placeholder');
  const miImgSt = document.getElementById('mi-image-status');
  if (miImgUrl) miImgUrl.value = image || '';
  if (miImgFile) miImgFile.value = '';
  if (image) {
    if (miImgPreview) { miImgPreview.src = resolveImageUrl(image); miImgPreview.style.display = 'block'; }
    if (miImgPh) miImgPh.style.display = 'none';
    if (miImgSt) { miImgSt.textContent = 'Current image loaded. Select a new file to replace it.'; miImgSt.style.color = 'var(--muted)'; }
  } else {
    if (miImgPreview) { miImgPreview.src = ''; miImgPreview.style.display = 'none'; }
    if (miImgPh) miImgPh.style.display = 'inline-block';
    if (miImgSt) { miImgSt.textContent = 'No image uploaded yet. You can upload one now.'; miImgSt.style.color = 'var(--muted)'; }
  }

  closeCategoryDropdown();
  fetchRestaurantMenuCategories();
  openModal('menu-item-modal');
}

async function saveMenuItem(e) {
  e.preventDefault();
  const id = document.getElementById('menu-item-id').value;
  const inputCategory = document.getElementById('mi-category').value.trim();
  const matchedExisting = (allMenuCategories || []).find(
    (c) => String(c || '').trim().toLowerCase() === inputCategory.toLowerCase()
  );
  const categoryVal = matchedExisting || inputCategory;

  const payload = {
    name: document.getElementById('mi-name').value.trim(),
    category: categoryVal,
    dietary: document.getElementById('mi-dietary').value,
    price: Number(document.getElementById('mi-price').value),
    quantity: Number(document.getElementById('mi-quantity').value),
    description: document.getElementById('mi-desc').value.trim(),
    image: document.getElementById('mi-image-url')?.value?.trim() || '',
    isActive: document.getElementById('mi-active').checked,
  };

  if (categoryVal && !allMenuCategories.some((c) => String(c || '').trim().toLowerCase() === categoryVal.toLowerCase())) {
    allMenuCategories.push(categoryVal);
    allMenuCategories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  try {
    if (id) {
      await apiFetch(`/api/restaurant/menu/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/restaurant/menu', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('menu-item-modal');
    closeCategoryDropdown();
    fetchRestaurantMenu();
  } catch (err) {
    alert(`Error saving food item: ${err.message}`);
  }
}

async function deleteMenuItem(id) {
  if (!confirm('Are you sure you want to delete this menu item?')) return;
  try {
    await apiFetch(`/api/restaurant/menu/${id}`, { method: 'DELETE' });
    fetchRestaurantMenu();
  } catch (e) {
    alert(e.message);
  }
}
window.deleteMenuItem = deleteMenuItem;


// =========================================================================
// PARTNER (RESTAURANT & SHOP) OVERVIEW: NOTIFICATION & REPORT HANDLERS
// =========================================================================
async function handlePartnerOverviewNotifClick() {
  if (role === 'restaurant' || role === 'shop') {
    if (overviewPartnerSubView === 'report') {
      showOverviewNotificationsView();
    } else {
      await loadNotifications(1);
    }
  } else {
    await loadNotifications(1);
  }
  const feed = document.getElementById('activity-feed');
  if (feed) {
    feed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

let partnerReportOrdersCache = [];

async function openPartnerReportModal() {
  if (activeView !== 'overview') {
    switchView('overview');
  }
  showOverviewPartnerReportView();
  const el = document.getElementById('overview-partner-report-container');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function refreshPartnerReportData() {
  try {
    const endpoint = role === 'shop' ? '/api/shop/orders' : '/api/restaurant/orders';
    const res = await apiFetch(endpoint);
    partnerReportOrdersCache = Array.isArray(res.orders) ? res.orders : [];
    renderPartnerReportData();
  } catch (err) {
    console.error('Failed to load partner report orders:', err);
  }
}

function renderPartnerReportData() {
  const period = document.getElementById('partner-report-period')?.value || 'all';
  const dateLabel = document.getElementById('partner-report-date-label');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let filteredOrders = partnerReportOrdersCache;
  let rangeLabel = 'All historic orders';

  if (period === 'today') {
    filteredOrders = partnerReportOrdersCache.filter((o) => new Date(o.createdAt || o.date) >= startOfDay);
    rangeLabel = `Today (${now.toLocaleDateString()})`;
  } else if (period === 'yesterday') {
    const startOfYesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
    filteredOrders = partnerReportOrdersCache.filter((o) => {
      const d = new Date(o.createdAt || o.date);
      return d >= startOfYesterday && d < startOfDay;
    });
    rangeLabel = `Yesterday (${startOfYesterday.toLocaleDateString()})`;
  } else if (period === 'last7') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filteredOrders = partnerReportOrdersCache.filter((o) => new Date(o.createdAt || o.date) >= sevenDaysAgo);
    rangeLabel = 'Past 7 days';
  } else if (period === 'thisMonth') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    filteredOrders = partnerReportOrdersCache.filter((o) => new Date(o.createdAt || o.date) >= startOfMonth);
    rangeLabel = `${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
  }

  if (dateLabel) dateLabel.textContent = `• ${rangeLabel}`;

  const totalOrders = filteredOrders.length;
  let deliveredCount = 0;
  let cancelledCount = 0;
  let inProgressCount = 0;
  let grossSales = 0;
  let platformCommission = 0;
  let storeDiscountsFunded = 0;

  const itemMap = new Map();

  filteredOrders.forEach((o) => {
    const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
    if (st === 'delivered') deliveredCount++;
    else if (st === 'cancelled' || st === 'rejected') cancelledCount++;
    else inProgressCount++;

    const orderTotal = Number(o.totalAmount || o.billDetails?.grandTotal || o.bill?.grandTotal || 0);
    if (st !== 'cancelled' && st !== 'rejected') {
      grossSales += orderTotal;
      const commPct = 15;
      const comm = orderTotal * (commPct / 100);
      platformCommission += comm;

      if (Array.isArray(o.appliedCoupons)) {
        o.appliedCoupons.forEach((ac) => {
          if (ac.sponsorType === 'restaurant' || ac.sponsorType === 'shop') {
            storeDiscountsFunded += Number(ac.partnerShare || ac.discountAmount || 0);
          } else if (ac.sponsorType === 'common') {
            storeDiscountsFunded += Number(ac.partnerShare || 0);
          }
        });
      }
    }

    const items = o.items || [];
    items.forEach((it) => {
      const name = String(it.name || 'Item').trim();
      const qty = Number(it.quantity || 1);
      const price = Number(it.price || 0);
      const curr = itemMap.get(name) || { name, quantity: 0, revenue: 0 };
      curr.quantity += qty;
      curr.revenue += qty * price;
      itemMap.set(name, curr);
    });
  });

  const netPayout = Math.max(0, grossSales - platformCommission - storeDiscountsFunded);
  const completionRate = totalOrders > 0 ? Math.round((deliveredCount / totalOrders) * 100) : 0;

  const kpiEl = document.getElementById('partner-report-kpi-grid');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Total Orders</div>
        <div style="font-size:1.6rem; font-weight:800; color:var(--ink); margin-top:0.2rem;">${totalOrders}</div>
        <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Placed in selected period</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Delivered Orders</div>
        <div style="font-size:1.6rem; font-weight:800; color:var(--green); margin-top:0.2rem;">${deliveredCount}</div>
        <div style="font-size:0.74rem; color:var(--green); font-weight:600; margin-top:0.15rem;">${completionRate}% completion rate</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Gross Sales (₹)</div>
        <div style="font-size:1.6rem; font-weight:800; color:#c2410c; margin-top:0.2rem;">₹${grossSales.toFixed(2)}</div>
        <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Before commissions &amp; discounts</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Est. Net Payout (₹)</div>
        <div style="font-size:1.6rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">₹${netPayout.toFixed(2)}</div>
        <div style="font-size:0.74rem; color:#1d4ed8; font-weight:600; margin-top:0.15rem;">Credited to bank account</div>
      </div>
    `;
  }

  const finEl = document.getElementById('partner-report-financial-breakdown');
  if (finEl) {
    finEl.innerHTML = `
      <div style="background:#f8fafc; padding:0.75rem; border-radius:8px; border:1px solid #e2e8f0;">
        <div style="font-size:0.72rem; color:var(--muted); font-weight:700; text-transform:uppercase;">Gross Revenue</div>
        <div style="font-size:1.15rem; font-weight:800; color:var(--ink); margin-top:0.15rem;">₹${grossSales.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:var(--muted);">Total items billed</div>
      </div>
      <div style="background:#f8fafc; padding:0.75rem; border-radius:8px; border:1px solid #e2e8f0;">
        <div style="font-size:0.72rem; color:var(--muted); font-weight:700; text-transform:uppercase;">Tomato Commission</div>
        <div style="font-size:1.15rem; font-weight:800; color:#dc2626; margin-top:0.15rem;">-₹${platformCommission.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:var(--muted);">Platform commission</div>
      </div>
      <div style="background:#f8fafc; padding:0.75rem; border-radius:8px; border:1px solid #e2e8f0;">
        <div style="font-size:0.72rem; color:var(--muted); font-weight:700; text-transform:uppercase;">Coupon Discount Funded</div>
        <div style="font-size:1.15rem; font-weight:800; color:#b45309; margin-top:0.15rem;">-₹${storeDiscountsFunded.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:var(--muted);">Store-specific offers</div>
      </div>
      <div style="background:#ecfdf5; padding:0.75rem; border-radius:8px; border:1px solid #a7f3d0;">
        <div style="font-size:0.72rem; color:#065f46; font-weight:700; text-transform:uppercase;">Net Payable to Store</div>
        <div style="font-size:1.15rem; font-weight:800; color:#047857; margin-top:0.15rem;">₹${netPayout.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:#065f46; font-weight:600;">Direct bank transfer</div>
      </div>
    `;
  }

  const statusEl = document.getElementById('partner-report-status-breakdown');
  if (statusEl) {
    statusEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.6rem; background:#f0fdf4; border-radius:6px; font-size:0.82rem;">
          <span style="font-weight:700; color:#15803d;">✓ Delivered Orders</span>
          <span style="font-weight:800; color:#15803d;">${deliveredCount}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.6rem; background:#eff6ff; border-radius:6px; font-size:0.82rem;">
          <span style="font-weight:700; color:#1d4ed8;">⚡ In Progress / Active</span>
          <span style="font-weight:800; color:#1d4ed8;">${inProgressCount}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.6rem; background:#fef2f2; border-radius:6px; font-size:0.82rem;">
          <span style="font-weight:700; color:#b91c1c;">✕ Cancelled / Rejected</span>
          <span style="font-weight:800; color:#b91c1c;">${cancelledCount}</span>
        </div>
      </div>
    `;
  }

  const topItemsEl = document.getElementById('partner-report-top-items');
  if (topItemsEl) {
    const sortedItems = Array.from(itemMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    if (!sortedItems.length) {
      topItemsEl.innerHTML = '<p style="color:var(--muted); font-size:0.8rem; margin:0.5rem 0;">No items sold in this period.</p>';
    } else {
      topItemsEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.45rem;">
          ${sortedItems.map((it, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem; padding:0.35rem 0; border-bottom:1px dashed #e2e8f0;">
              <div>
                <span style="font-weight:800; color:#c2410c; margin-right:0.35rem;">#${idx + 1}</span>
                <span style="font-weight:600; color:var(--ink);">${escapeHtml(it.name)}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-weight:700; color:var(--charcoal);">${it.quantity} sold</span>
                <span style="font-size:0.75rem; color:var(--muted); margin-left:0.35rem;">(₹${it.revenue.toFixed(0)})</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }
}

function exportPartnerReportCsv() {
  const period = document.getElementById('partner-report-period')?.value || 'all';
  if (!partnerReportOrdersCache.length) {
    alert('No order data to export.');
    return;
  }
  const headers = ['Order Number', 'Date', 'Status', 'Customer', 'Items Count', 'Gross Total (INR)'];
  const rows = partnerReportOrdersCache.map((o) => [
    o.orderNumber || o.orderId || o._id,
    new Date(o.createdAt || o.date).toLocaleDateString(),
    o.status || 'N/A',
    o.customerName || (o.customerId && o.customerId.name) || 'Customer',
    (o.items || []).length,
    Number(o.totalAmount || o.billDetails?.grandTotal || 0).toFixed(2),
  ]);
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Store_Report_${role}_${period}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function printPartnerReport() {
  window.print();
}

window.handlePartnerOverviewNotifClick = handlePartnerOverviewNotifClick;
window.openPartnerReportModal = openPartnerReportModal;
window.showOverviewPartnerReportView = showOverviewPartnerReportView;
window.refreshPartnerReportData = refreshPartnerReportData;
window.renderPartnerReportData = renderPartnerReportData;
window.exportPartnerReportCsv = exportPartnerReportCsv;
window.printPartnerReport = printPartnerReport;
window.viewOrderBill = viewOrderBill;
window.renderRestaurantOrdersTable = renderRestaurantOrdersTable;
window.fetchRestaurantOrders = fetchRestaurantOrders;
window.updateOrderStatus = updateOrderStatus;
window.fetchRestaurantMenu = fetchRestaurantMenu;
window.openAddMenuItemModal = openAddMenuItemModal;
window.editMenuItem = editMenuItem;
window.saveMenuItem = saveMenuItem;
window.fetchRestaurantMenuCategories = fetchRestaurantMenuCategories;
window.openCategoryDropdown = openCategoryDropdown;
window.closeCategoryDropdown = closeCategoryDropdown;
window.toggleCategoryDropdown = toggleCategoryDropdown;
window.renderCategoryDropdownOptions = renderCategoryDropdownOptions;
window.selectCategoryItem = selectCategoryItem;
window.addNewCategoryItem = addNewCategoryItem;
window.handleCategoryInput = handleCategoryInput;
window.handleCategoryKeydown = handleCategoryKeydown;
window.highlightCategoryOption = highlightCategoryOption;


