// =========================================================================
// ADMIN PLATFORM ORDERS MODULE (SEARCH, FILTERS, BULK ACTIONS, REPORTS, RADAR)
// =========================================================================
// =========================================================================
// ADMIN: PLATFORM ORDERS (SEARCH, DATE FILTER, SINGLE & BULK ARCHIVE/DELETE)
// =========================================================================
let currentAdminOrdersList = [];
let currentAdminOrdersPage = 1;
let currentAdminOrdersDate = '';
let currentAdminOrdersPagination = null;

function navigateAdminOrderDay(direction) {
  if (!currentAdminOrdersPagination) {
    fetchAdminOrders(Math.max(1, currentAdminOrdersPage + direction));
    return;
  }
  if (direction > 0 && currentAdminOrdersPagination.hasNextPage) {
    fetchAdminOrders(currentAdminOrdersPage + 1);
  } else if (direction < 0 && currentAdminOrdersPagination.hasPrevPage) {
    fetchAdminOrders(currentAdminOrdersPage - 1);
  }
}

function fetchAdminOrdersByDate(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    fetchAdminOrders(null, dateStr.trim());
  }
}

function renderAdminOrdersPaginationUI(pagination) {
  currentAdminOrdersPagination = pagination;
  if (!pagination) return;

  // Update Date Picker input
  const picker = document.getElementById('admin-orders-date-picker');
  if (picker && pagination.currentDate) {
    picker.value = pagination.currentDate;
  }

  // Update Navigation buttons state
  const newerBtn = document.getElementById('admin-orders-newer-day-btn');
  const olderBtn = document.getElementById('admin-orders-older-day-btn');
  if (newerBtn) newerBtn.disabled = !pagination.hasPrevPage;
  if (olderBtn) olderBtn.disabled = !pagination.hasNextPage;

  const metaEl = document.getElementById('admin-orders-meta');
  const periodInfoEl = document.getElementById('admin-orders-period-info');

  if (metaEl) {
    metaEl.textContent = `Live orders for ${pagination.currentDateLabel || pagination.currentDate} • ${pagination.ordersOnThisDate} orders (Each page displays 1 day only)`;
  }
  if (periodInfoEl) {
    periodInfoEl.textContent = `Viewing ${pagination.currentDateLabel || pagination.currentDate} • ${pagination.ordersOnThisDate} orders on this page`;
  }
}

function renderAdminOrdersBottomPaginationHTML(pagination) {
  if (!pagination || pagination.totalPages <= 1) return '';
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem; padding-top:0.85rem; border-top:1px solid var(--line); flex-wrap:wrap; gap:0.6rem;">
      <div style="font-size:0.85rem; color:var(--muted);">
        Page <strong>${pagination.currentPage}</strong> of <strong>${pagination.totalPages}</strong>: <strong>${escapeHtml(pagination.currentDateLabel || pagination.currentDate)}</strong> (${pagination.ordersOnThisDate} orders on this day)
      </div>
      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasPrevPage ? 'disabled' : ''} onclick="navigateAdminOrderDay(-1)">◀ Newer Date</button>
        ${(pagination.dates || []).map((d) => {
          const isActive = d.page === pagination.currentPage;
          const shortLabel = d.isToday ? 'Today' : d.isYesterday ? 'Yesterday' : d.label.replace(/\s\d{4}$/, '');
          return `
            <button
              type="button"
              class="btn ${isActive ? 'btn-primary' : 'btn-outline'} btn-sm"
              style="padding:0.25rem 0.55rem; font-size:0.8rem; font-weight:${isActive ? '700' : '500'};"
              onclick="fetchAdminOrders(${d.page})"
            >
              ${escapeHtml(shortLabel)} (${d.orderCount})
            </button>
          `;
        }).join('')}
        <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasNextPage ? 'disabled' : ''} onclick="navigateAdminOrderDay(1)">Older Date ▶</button>
      </div>
    </div>
  `;
}

async function fetchAdminOrders(page, date, force = false) {
  if (page !== undefined && page !== null) {
    currentAdminOrdersPage = page;
    currentAdminOrdersDate = '';
  }
  if (date) {
    currentAdminOrdersDate = date;
  }

  const container = document.getElementById('admin-orders-table');
  if (!container) return;

  const status = document.getElementById('admin-order-status-filter')?.value || 'all';
  const search = document.getElementById('admin-orders-search')?.value.trim() || '';
  const archived = document.getElementById('admin-order-archive-filter')?.value || 'active';

  const cacheKey = `orders_${currentAdminOrdersPage || 1}_${currentAdminOrdersDate || ''}_${status}_${search}_${archived}`;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  const now = Date.now();

  if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 15000)) {
    return;
  }

  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('platform orders');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  if (archived) params.set('archived', archived);

  if (currentAdminOrdersDate) {
    params.set('date', currentAdminOrdersDate);
  } else {
    params.set('page', String(currentAdminOrdersPage || 1));
  }

  try {
    const data = await apiFetch(`/api/admin/orders?${params.toString()}`);
    viewLastFetched[cacheKey] = now;
    const orders = data.orders || [];
    const pagination = data.pagination || null;
    currentAdminOrdersList = orders;

    if (pagination) {
      currentAdminOrdersPage = pagination.currentPage;
      currentAdminOrdersDate = pagination.currentDate;
      renderAdminOrdersPaginationUI(pagination);
    }

    updateAdminOrdersSelection();

    if (!orders.length) {
      const dateLabel = pagination?.currentDateLabel || pagination?.currentDate || 'this date';
      container.innerHTML = `
        <div style="background:#fcfaf5; border:1px dashed var(--line); border-radius:10px; padding:2.5rem 1.5rem; text-align:center; margin:1rem 0;">
          <p style="font-size:1.1rem; font-weight:700; color:var(--charcoal); margin-bottom:0.4rem;">No orders found for ${escapeHtml(dateLabel)}</p>
          <p style="color:var(--muted); font-size:0.85rem; margin-bottom:1rem;">Each page displays orders of 1 day only. Use the controls to navigate consecutive dates.</p>
          <div style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap;">
            ${pagination?.hasPrevPage ? `<button class="btn btn-outline btn-sm" onclick="navigateAdminOrderDay(-1)">◀ Newer Date</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="fetchAdminOrders(1)">📅 Today</button>
            ${pagination?.hasNextPage ? `<button class="btn btn-primary btn-sm" onclick="navigateAdminOrderDay(1)">Older Date ▶</button>` : ''}
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
              <th style="width:36px; text-align:center;">
                <input type="checkbox" id="admin-orders-select-all" onchange="toggleSelectAllAdminOrders(this.checked)" title="Select all orders" />
              </th>
              <th>Order #</th>
              <th>Customer</th>
              <th>Restaurant</th>
              <th>Rider</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map((o) => {
              const orderDisplayNum = o.orderNumber || String(o._id).slice(-6).toUpperCase();
              const orderDateStr = o.createdAt ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
              const isArchived = Boolean(o.isArchived);

              return `
                <tr id="admin-order-row-${o._id}" style="${isArchived ? 'background:#faf9f6; opacity:0.88;' : ''}">
                  <td style="text-align:center;">
                    <input type="checkbox" class="admin-order-cb" value="${o._id}" onchange="updateAdminOrdersSelection()" />
                  </td>
                  <td>
                    <strong>#${escapeHtml(orderDisplayNum)}</strong>
                    ${isArchived ? '<span class="badge" style="background:#e2e8f0; color:#475569; font-size:0.68rem; margin-left:0.3rem;">Archived</span>' : ''}
                    <br><small style="color:var(--muted);">⏰ ${orderDateStr}</small>
                  </td>
                  <td>
                    <strong>${escapeHtml(formatCleanName(o.customerName || 'Customer'))}</strong>
                    ${o.customerPhone ? `<br><small style="color:var(--muted);">📞 ${escapeHtml(o.customerPhone)}</small>` : ''}
                  </td>
                  <td>${escapeHtml(formatCleanName(o.restaurantName || 'Restaurant'))}</td>
                  <td>${escapeHtml(formatCleanName(o.riderName || 'Unassigned'))}</td>
                  <td><strong>₹${Number(o.totalAmount || 0).toFixed(2)}</strong></td>
                  <td><span class="badge ${o.paymentStatus === 'paid' ? 'badge-delivered' : 'badge-placed'}">${(o.paymentMethod || 'cod').toUpperCase()} (${o.paymentStatus || 'pending'})</span></td>
                  <td><span class="badge badge-${o.status || 'placed'}">${String(o.status || 'placed').replace(/_/g, ' ')}</span></td>
                  <td style="text-align:right; white-space:nowrap;">
                    ${!['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase()) ? `
                      <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'admin')" title="Live GPS Rider Telemetry">📍 Track</button>
                    ` : ''}
                    <button class="btn btn-outline btn-sm" onclick="viewOrderBill('${o._id}')" title="View bill & tax invoice">🧾 Bill</button>
                    ${isArchived ? `
                      <button class="btn btn-outline btn-sm" onclick="archiveAdminOrder('${o._id}', false)" title="Unarchive this order">📂 Unarchive</button>
                    ` : `
                      <button class="btn btn-outline btn-sm" onclick="archiveAdminOrder('${o._id}', true)" title="Archive this order">📦 Archive</button>
                    `}
                    <button class="btn btn-sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:0.25rem 0.5rem;" onclick="deleteAdminOrder('${o._id}', '${escapeHtml(orderDisplayNum)}')" title="Permanently delete order">🗑️</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${renderAdminOrdersBottomPaginationHTML(pagination)}
    `;
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch admin orders error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

function resetAdminOrdersFilter() {
  const searchInput = document.getElementById('admin-orders-search');
  const statusSelect = document.getElementById('admin-order-status-filter');
  const archiveSelect = document.getElementById('admin-order-archive-filter');

  if (searchInput) searchInput.value = '';
  if (statusSelect) statusSelect.value = 'all';
  if (archiveSelect) archiveSelect.value = 'active';

  currentAdminOrdersPage = 1;
  currentAdminOrdersDate = '';
  fetchAdminOrders(1);
}

function getSelectedAdminOrderIds() {
  const checkboxes = document.querySelectorAll('.admin-order-cb:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function toggleSelectAllAdminOrders(checked) {
  const checkboxes = document.querySelectorAll('.admin-order-cb');
  checkboxes.forEach(cb => { cb.checked = checked; });
  updateAdminOrdersSelection();
}

function updateAdminOrdersSelection() {
  const selected = getSelectedAdminOrderIds();
  const count = selected.length;
  const countEl = document.getElementById('admin-orders-selected-count');
  const archiveBtn = document.getElementById('admin-bulk-archive-btn');
  const unarchiveBtn = document.getElementById('admin-bulk-unarchive-btn');
  const deleteBtn = document.getElementById('admin-bulk-delete-btn');
  const archiveFilter = document.getElementById('admin-order-archive-filter')?.value || 'active';

  if (countEl) {
    countEl.textContent = `${count} order${count === 1 ? '' : 's'} selected`;
  }

  if (count > 0) {
    if (deleteBtn) deleteBtn.style.display = 'inline-block';
    if (archiveFilter === 'archived') {
      if (unarchiveBtn) unarchiveBtn.style.display = 'inline-block';
      if (archiveBtn) archiveBtn.style.display = 'none';
    } else if (archiveFilter === 'all') {
      if (archiveBtn) archiveBtn.style.display = 'inline-block';
      if (unarchiveBtn) unarchiveBtn.style.display = 'inline-block';
    } else {
      if (archiveBtn) archiveBtn.style.display = 'inline-block';
      if (unarchiveBtn) unarchiveBtn.style.display = 'none';
    }
  } else {
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (archiveBtn) archiveBtn.style.display = 'none';
    if (unarchiveBtn) unarchiveBtn.style.display = 'none';
  }

  // Update select-all checkbox state
  const allCbs = document.querySelectorAll('.admin-order-cb');
  const selectAllCb = document.getElementById('admin-orders-select-all');
  if (selectAllCb && allCbs.length > 0) {
    selectAllCb.checked = count === allCbs.length;
  }
}

async function archiveAdminOrder(orderId, isArchived) {
  const actionLabel = isArchived ? 'archive' : 'unarchive';
  if (!confirm(`Are you sure you want to ${actionLabel} this order?`)) return;

  try {
    const res = await apiFetch(`/api/admin/orders/${orderId}/archive`, {
      method: 'PUT',
      body: JSON.stringify({ isArchived }),
    });
    alert(res.message || `Order ${actionLabel}d successfully`);
    fetchAdminOrders();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteAdminOrder(orderId, orderNum) {
  if (!confirm(`⚠️ Permanent Delete: Are you sure you want to delete order #${orderNum}? This action cannot be undone.`)) return;

  try {
    const res = await apiFetch(`/api/admin/orders/${orderId}`, {
      method: 'DELETE',
    });
    alert(res.message || 'Order deleted permanently');
    fetchAdminOrders();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function executeAdminBulkArchive(isArchived) {
  const orderIds = getSelectedAdminOrderIds();
  if (!orderIds.length) {
    alert('Please select at least one order to perform this action.');
    return;
  }

  const actionLabel = isArchived ? 'archive' : 'unarchive';
  if (!confirm(`Are you sure you want to ${actionLabel} ${orderIds.length} selected order(s)?`)) return;

  try {
    const res = await apiFetch('/api/admin/orders/bulk-archive', {
      method: 'POST',
      body: JSON.stringify({ orderIds, isArchived }),
    });
    alert(res.message || `Orders ${actionLabel}d successfully`);
    fetchAdminOrders();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function executeAdminBulkDelete() {
  const orderIds = getSelectedAdminOrderIds();
  if (!orderIds.length) {
    alert('Please select at least one order to delete.');
    return;
  }

  if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete ${orderIds.length} selected order(s)? This action CANNOT be undone.`)) return;

  try {
    const res = await apiFetch('/api/admin/orders/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ orderIds }),
    });
    alert(res.message || 'Selected orders deleted successfully');
    fetchAdminOrders();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function executeAdminPeriodArchive() {
  const targetDate = currentAdminOrdersDate || document.getElementById('admin-orders-date-picker')?.value || '';
  const status = document.getElementById('admin-order-status-filter')?.value || 'all';

  if (!targetDate) {
    alert('Please select a date first.');
    return;
  }

  const dateLabel = currentAdminOrdersPagination?.currentDateLabel || targetDate;
  if (!confirm(`📦 Bulk Archive by Date: Are you sure you want to archive ALL orders on ${dateLabel}?`)) return;

  try {
    const res = await apiFetch('/api/admin/orders/bulk-archive', {
      method: 'POST',
      body: JSON.stringify({ startDate: targetDate, endDate: targetDate, status, isArchived: true }),
    });
    alert(res.message || 'Orders archived successfully');
    fetchAdminOrders(currentAdminOrdersPage);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function executeAdminPeriodDelete() {
  const targetDate = currentAdminOrdersDate || document.getElementById('admin-orders-date-picker')?.value || '';
  const status = document.getElementById('admin-order-status-filter')?.value || 'all';

  if (!targetDate) {
    alert('Please select a date first.');
    return;
  }

  const dateLabel = currentAdminOrdersPagination?.currentDateLabel || targetDate;
  if (!confirm(`⚠️ PERMANENT BULK DELETE: Are you sure you want to delete ALL orders on ${dateLabel}? This CANNOT be undone!`)) return;

  try {
    const res = await apiFetch('/api/admin/orders/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ startDate: targetDate, endDate: targetDate, status }),
    });
    alert(res.message || 'Orders on this day deleted permanently');
    fetchAdminOrders(currentAdminOrdersPage);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

const adminUsersData = {
  shop: [],
  restaurant: [],
  deliveryPartner: [],
  customer: [],
};
const adminSearchQueries = {
  shop: '',
  restaurant: '',
  deliveryPartner: '',
  customer: '',
};
const adminUsersPagination = {
  shop: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
  restaurant: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
  deliveryPartner: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
  customer: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
};
let adminSearchDebounceTimer = null;

function getAdminRoleDomPrefix(role) {
  if (role === 'shop') return 'admin-shops';
  if (role === 'restaurant') return 'admin-restaurants';
  if (role === 'deliveryPartner') return 'admin-riders';
  if (role === 'customer') return 'admin-customers';
  return 'admin-' + role;
}

function changeAdminUserPage(role, targetPage) {
  const p = adminUsersPagination[role];
  if (!p) return;
  const next = Math.max(1, Math.min(targetPage, p.totalPages));
  adminUsersPagination[role].currentPage = next;
  fetchAdminUsers(role, adminSearchQueries[role] || '', next, true);
}

async function fetchAdminUsers(role, searchQuery = '', page = 1, force = false) {
  const prefix = getAdminRoleDomPrefix(role);
  const container = document.getElementById(`${prefix}-table`);
  const statusEl = document.getElementById(`${prefix}-search-status`);
  const clearBtn = document.getElementById(`${prefix}-clear-btn`);

  if (!container) return;
  const roleLabel = role === 'deliveryPartner' ? 'delivery partners' : role + 's';
  const cacheKey = `users_${role}_${searchQuery}_${page}`;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  const now = Date.now();

  if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 15000)) {
    return;
  }

  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton(roleLabel);
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const params = new URLSearchParams();
    params.set('role', role);
    if (searchQuery) params.set('search', searchQuery);
    params.set('page', String(page || 1));
    params.set('limit', '10');

    const data = await apiFetch(`/api/admin/users?${params.toString()}`);
    viewLastFetched[cacheKey] = now;
    const users = data.users || [];
    const pagination = data.pagination || {
      currentPage: page || 1,
      totalPages: Math.ceil(users.length / 10) || 1,
      totalItems: users.length,
      pageSize: 10,
      hasNextPage: false,
      hasPrevPage: false,
    };

    adminUsersData[role] = users;
    adminSearchQueries[role] = searchQuery;
    adminUsersPagination[role] = pagination;

    if (clearBtn) {
      clearBtn.style.display = searchQuery ? 'inline-flex' : 'none';
    }

    if (statusEl) {
      if (searchQuery) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = `Showing ${pagination.totalItems} ${roleLabel} matching &ldquo;<strong>${escapeHtml(searchQuery)}</strong>&rdquo; (Page ${pagination.currentPage} of ${pagination.totalPages})`;
      } else {
        statusEl.style.display = 'none';
        statusEl.innerHTML = '';
      }
    }

    container.innerHTML = renderPartnerManagementTable(users, role, searchQuery, pagination);
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
    } else {
      console.error('Fetch admin users error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}

let adminServiceablePincodes = [];

function resolveFrontendPartnerPincode(u) {
  if (!u) return '';
  const direct = String(u.pincode || '').trim();
  const m1 = direct.match(/\b(\d{5,6})\b/);
  if (m1) return m1[1];
  const combined = `${u.shopAddress || ''} ${u.restaurantAddress || ''} ${u.digipin || ''}`;
  const m2 = combined.match(/\b(\d{5,6})\b/);
  return m2 ? m2[1] : '';
}

async function fetchAdminServiceablePincodes() {
  if (role !== 'admin' && role !== 'subadmin') return adminServiceablePincodes;
  try {
    const res = await apiFetch('/api/admin/serviceable-pincodes');
    if (Array.isArray(res.pincodes)) {
      adminServiceablePincodes = res.pincodes;
      cachedServiceablePincodes = res.pincodes;
    }
    renderAdminServiceablePincodesBars();
  } catch (err) {
    console.warn('Could not load serviceable pincodes:', err);
  }
  return adminServiceablePincodes;
}

function renderAdminServiceablePincodesBars() {
  const bars = document.querySelectorAll('.admin-serviceable-pincodes-bar');
  if (!bars.length) return;
  const pillsHtml = adminServiceablePincodes.length
    ? adminServiceablePincodes.map((pin) => `
        <span style="display:inline-flex; align-items:center; gap:0.35rem; background:#dbeafe; color:#1e3a8a; border:1px solid #93c5fd; padding:0.22rem 0.6rem; border-radius:999px; font-size:0.78rem; font-weight:700; font-family:monospace;">
          📍 ${escapeHtml(pin)}
          <button type="button" onclick="removeAdminServiceablePincode('${escapeHtml(pin)}')" title="Remove pincode ${escapeHtml(pin)}" style="border:none; background:rgba(30,58,138,0.12); color:#1e3a8a; border-radius:50%; width:17px; height:17px; font-size:0.7rem; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">✕</button>
        </span>
      `).join('')
    : '<span style="color:#dc2626; font-size:0.8rem; font-weight:600;">⚠️ No serviceable pincodes configured — no restaurants/shops or customer orders will be serviceable!</span>';

  bars.forEach((bar, idx) => {
    const inputId = `admin-new-pincode-input-${idx}`;
    bar.innerHTML = `
      <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
        <div style="flex:1 1 320px;">
          <div style="font-size:0.78rem; font-weight:700; color:#0f172a; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:0.35rem;">
            🗺️ Admin Serviceable Delivery Pincodes (${adminServiceablePincodes.length} Active)
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center;">${pillsHtml}</div>
          <div style="font-size:0.73rem; color:var(--muted); margin-top:0.3rem;">Only restaurants/shops in these pincodes can be approved, and only customers in these pincodes can place orders.</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
          <input id="${inputId}" type="text" placeholder="Add pincode (e.g. 560034)" maxlength="30" style="padding:0.38rem 0.65rem; border:1px solid #94a3b8; border-radius:6px; font-size:0.82rem; width:190px; font-family:monospace; background:#fff;" onkeydown="if(event.key==='Enter'){event.preventDefault(); addAdminServiceablePincode('${inputId}');}" />
          <button type="button" class="btn btn-primary btn-sm" onclick="addAdminServiceablePincode('${inputId}')">+ Add Pincode</button>
        </div>
      </div>
    `;
  });
}

async function addAdminServiceablePincode(inputId) {
  const input = document.getElementById(inputId);
  const raw = input ? input.value.trim() : prompt('Enter 5 or 6 digit serviceable pincode(s):') || '';
  if (!raw) return;
  try {
    const res = await apiFetch('/api/admin/serviceable-pincodes', {
      method: 'POST',
      body: JSON.stringify({ pincode: raw }),
    });
    if (input) input.value = '';
    adminServiceablePincodes = res.pincodes || adminServiceablePincodes;
    cachedServiceablePincodes = adminServiceablePincodes;
    renderAdminServiceablePincodesBars();
    refreshAdminViews();
  } catch (err) {
    alert(err.message || 'Unable to add pincode');
  }
}

async function removeAdminServiceablePincode(pin) {
  if (!confirm(`Remove pincode "${pin}" from the serviceable delivery range?\n\nNote: Any currently approved restaurants or shops in pincode ${pin} will automatically be marked unapproved until this pincode is re-enabled.`)) return;
  try {
    const res = await apiFetch(`/api/admin/serviceable-pincodes/${encodeURIComponent(pin)}`, {
      method: 'DELETE',
    });
    adminServiceablePincodes = res.pincodes || [];
    cachedServiceablePincodes = adminServiceablePincodes;
    renderAdminServiceablePincodesBars();
    if (res.message) alert(res.message);
    refreshAdminViews();
  } catch (err) {
    alert(err.message || 'Unable to remove pincode');
  }
}
window.addAdminServiceablePincode = addAdminServiceablePincode;
window.removeAdminServiceablePincode = removeAdminServiceablePincode;

function fetchAdminShops(page, force = false) {
  fetchAdminServiceablePincodes();
  const query = document.getElementById('admin-shops-search')?.value?.trim() || '';
  const targetPage = page || adminUsersPagination.shop.currentPage || 1;
  return fetchAdminUsers('shop', query, targetPage, force);
}
window.fetchAdminShops = fetchAdminShops;

function fetchAdminRestaurants(page, force = false) {
  fetchAdminServiceablePincodes();
  const query = document.getElementById('admin-restaurants-search')?.value?.trim() || '';
  const targetPage = page || adminUsersPagination.restaurant.currentPage || 1;
  return fetchAdminUsers('restaurant', query, targetPage, force);
}

function fetchAdminRiders(page, force = false) {
  const query = document.getElementById('admin-riders-search')?.value?.trim() || '';
  const targetPage = page || adminUsersPagination.deliveryPartner.currentPage || 1;
  return fetchAdminUsers('deliveryPartner', query, targetPage, force);
}

function fetchAdminCustomers(page, force = false) {
  const query = document.getElementById('admin-customers-search')?.value?.trim() || '';
  const targetPage = page || adminUsersPagination.customer.currentPage || 1;
  return fetchAdminUsers('customer', query, targetPage, force);
}

function searchAdminUsers(role) {
  const prefix = getAdminRoleDomPrefix(role);
  const input = document.getElementById(`${prefix}-search`);
  const query = input?.value?.trim() || '';
  if (adminUsersPagination[role]) adminUsersPagination[role].currentPage = 1;
  fetchAdminUsers(role, query, 1, true);
}

function clearAdminSearch(role) {
  const prefix = getAdminRoleDomPrefix(role);
  const input = document.getElementById(`${prefix}-search`);
  if (input) input.value = '';
  if (adminUsersPagination[role]) adminUsersPagination[role].currentPage = 1;
  fetchAdminUsers(role, '', 1, true);
}

function handleAdminSearchInput(role) {
  const prefix = getAdminRoleDomPrefix(role);
  const input = document.getElementById(`${prefix}-search`);
  const clearBtn = document.getElementById(`${prefix}-clear-btn`);
  const query = input?.value?.trim() || '';
  if (clearBtn) clearBtn.style.display = query ? 'inline-flex' : 'none';
  clearTimeout(adminSearchDebounceTimer);
  adminSearchDebounceTimer = setTimeout(() => {
    if (adminUsersPagination[role]) adminUsersPagination[role].currentPage = 1;
    fetchAdminUsers(role, query, 1, true);
  }, 350);
}

function renderAdminUserPaginationControls(targetRole, pagination) {
  if (!pagination || pagination.totalPages <= 1) {
    if (pagination && pagination.totalItems > 0) {
      const roleLabel = targetRole === 'deliveryPartner' ? 'riders' : targetRole === 'restaurant' ? 'restaurants' : targetRole === 'shop' ? 'shops' : 'customers';
      return `<div style="margin-top:0.75rem; padding-top:0.6rem; border-top:1px solid var(--line); font-size:0.83rem; color:var(--muted); text-align:right;">Total: <strong>${pagination.totalItems}</strong> ${roleLabel} (All on 1 page)</div>`;
    }
    return '';
  }

  const startItem = pagination.totalItems === 0 ? 0 : (pagination.currentPage - 1) * pagination.pageSize + 1;
  const endItem = Math.min(pagination.currentPage * pagination.pageSize, pagination.totalItems);
  const roleLabel = targetRole === 'deliveryPartner' ? 'riders' : targetRole === 'restaurant' ? 'restaurants' : targetRole === 'shop' ? 'shops' : 'customers';
  const totalPages = pagination.totalPages;
  const current = pagination.currentPage;
  const pagesToShow = [];

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= current - 1 && i <= current + 1)) pagesToShow.push(i);
    else if (pagesToShow[pagesToShow.length - 1] !== '...') pagesToShow.push('...');
  }

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem; padding-top:0.85rem; border-top:1px solid var(--line); flex-wrap:wrap; gap:0.6rem;">
      <div style="font-size:0.85rem; color:var(--muted);">Showing <strong>${startItem}–${endItem}</strong> of <strong>${pagination.totalItems}</strong> ${roleLabel} (Page <strong>${current}</strong> of <strong>${totalPages}</strong>)</div>
      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasPrevPage ? 'disabled' : ''} onclick="changeAdminUserPage('${targetRole}', ${current - 1})">◀ Prev</button>
        ${pagesToShow.map((p) => p === '...' ? '<span style="color:var(--muted); padding:0 0.25rem;">…</span>' : `<button type="button" class="btn ${p === current ? 'btn-primary' : 'btn-outline'} btn-sm" style="padding:0.25rem 0.55rem; font-size:0.8rem; font-weight:${p === current ? '700' : '500'};" onclick="changeAdminUserPage('${targetRole}', ${p})">${p}</button>`).join('')}
        <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasNextPage ? 'disabled' : ''} onclick="changeAdminUserPage('${targetRole}', ${current + 1})">Next ▶</button>
      </div>
    </div>
  `;
}

function renderPartnerManagementTable(usersList, targetRole, searchQuery = '', pagination = null) {
  const roleLabel = targetRole === 'deliveryPartner' ? 'delivery partners' : targetRole === 'shop' ? 'shops' : targetRole + 's';
  if (!usersList.length) {
    if (searchQuery) {
      return `<div style="padding:2rem 1rem; text-align:center; color:var(--muted); background:#fdfdfd; border:1px dashed var(--line); border-radius:8px;"><p style="font-size:1rem; margin-bottom:0.6rem;">🔍 No ${roleLabel} found matching "<strong>${escapeHtml(searchQuery)}</strong>"</p><button class="btn btn-outline btn-sm" onclick="clearAdminSearch('${targetRole}')">Clear Search</button></div>`;
    }
    return `<p style="color:var(--muted); padding:1rem 0;">No accounts registered in this category.</p>`;
  }

  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Name / Business</th>
            <th>Contact (Mobile & Email)</th>
            ${targetRole === 'restaurant' ? '<th>Address, Pincode & Cuisine</th>' : ''}
            ${targetRole === 'shop' ? '<th>Address, Pincode & Category</th>' : ''}
            ${targetRole === 'deliveryPartner' ? '<th>Vehicle</th>' : ''}
            <th>Approval</th>
            <th>Account Status</th>
            <th>Admin Actions</th>
          </tr>
        </thead>
        <tbody>
          ${usersList.map((u) => {
            const isPending = u.isApproved === false;
            const isBlocked = Boolean(u.isBlocked);
            const partnerPin = resolveFrontendPartnerPincode(u);
            const pinServiceable = !adminServiceablePincodes.length || (partnerPin && adminServiceablePincodes.includes(partnerPin));
            const pinBadgeHtml = (targetRole === 'restaurant' || targetRole === 'shop')
              ? `<span class="badge ${pinServiceable ? 'badge-approved' : 'badge-blocked'}" style="font-size:0.7rem; font-family:monospace;">📮 Pincode: ${escapeHtml(partnerPin || 'Missing')} ${pinServiceable ? '✓' : '(Not Serviceable)'}</span>`
              : '';

            const cleanName = formatCleanName(u.name || u.displayName);
            let nameCellHtml = `<strong>${escapeHtml(cleanName)}</strong>`;
            if (targetRole === 'restaurant' || targetRole === 'shop') {
              const codeId = targetRole === 'shop' ? (u.shopId || String(u.id || u._id)) : (u.restaurantId || String(u.id || u._id));
              nameCellHtml = `
                <div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div>
                <div style="margin-top:3px; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                  <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.75rem;">📍 DIGIPIN: ${escapeHtml(u.digipin || 'Not Set')}</span>
                  ${pinBadgeHtml}
                  <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(u.id || u._id))}">ID: ${escapeHtml(codeId)}</span>
                </div>
              `;
            } else if (targetRole === 'deliveryPartner') {
              const rdId = u.riderId || String(u.id || u._id);
              nameCellHtml = `
                <div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div>
                <div style="margin-top:3px; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                  <span class="badge" style="background:${u.isOnline ? '#f0fdf4' : '#f1f5f9'}; color:${u.isOnline ? '#15803d' : '#64748b'}; font-weight:600; font-size:0.72rem;">● ${u.isOnline ? 'GPS Live Online' : 'GPS Offline'} ${u.currentLocation?.lat ? `(${u.currentLocation.lat.toFixed(3)}, ${u.currentLocation.lng.toFixed(3)})` : ''}</span>
                  <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(u.id || u._id))}">ID: ${escapeHtml(rdId)}</span>
                </div>
              `;
            } else if (targetRole === 'customer') {
              const cId = u.customerId || String(u.id || u._id);
              nameCellHtml = `<div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div><div style="margin-top:3px;"><span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;">ID: ${escapeHtml(cId)}</span></div>`;
            }

            return `
              <tr>
                <td>
                  ${nameCellHtml}
                  <div style="margin-top:4px; font-size:0.75rem; color:#92400e; font-weight:600;">💳 Credit Points: ${Number(u.creditPoint ?? 0)}</div>
                </td>
                <td>
                  ${u.phone ? `<div>📞 <strong>${escapeHtml(u.phone)}</strong></div>` : '<div style="color:var(--muted); font-size:0.8rem;">No mobile</div>'}
                  ${u.email ? `<div style="margin-top:2px;">✉️ <a href="mailto:${escapeHtml(u.email)}" style="color:var(--ink);">${escapeHtml(u.email)}</a></div>` : '<div style="color:var(--muted); font-size:0.8rem;">No email</div>'}
                </td>
                ${targetRole === 'restaurant' ? `<td><small>${escapeHtml(u.restaurantAddress || 'Bengaluru')}</small><br><span class="badge badge-ready">${escapeHtml(u.cuisine || 'Multi-cuisine')}</span></td>` : ''}
                ${targetRole === 'shop' ? `<td><small>${escapeHtml(u.shopAddress || u.restaurantAddress || 'Bengaluru')}</small><br><span class="badge badge-ready">${escapeHtml(u.category || 'Retail & Groceries')}</span></td>` : ''}
                ${targetRole === 'deliveryPartner' ? `<td><span class="badge badge-accepted">${escapeHtml(u.deliveryVehicle || 'Bike')}</span></td>` : ''}
                <td>
                  <span class="badge ${isPending ? 'badge-pending' : 'badge-approved'}">${isPending ? 'Pending Approval' : 'Approved'}</span>
                  ${targetRole !== 'customer' ? (() => {
                    const bd = u.bankDetails || {};
                    const holder = String(bd.accountHolderName || '').trim().toLowerCase();
                    const panHolder = String(bd.panHolderName || '').trim().toLowerCase();
                    const namesMatch = Boolean(holder && panHolder && holder === panHolder);
                    if (bd.isApproved && bd.isLocked) return '<div style="margin-top:4px;"><span class="badge badge-approved" style="font-size:0.68rem;">🔒 Bank &amp; PAN Verified</span></div>';
                    if (bd.isSubmitted || (bd.accountNumber && bd.ifscCode && bd.panNumber)) return `<div style="margin-top:4px;"><span class="badge ${namesMatch ? 'badge-ready' : 'badge-blocked'}" style="font-size:0.68rem;">${namesMatch ? '🪪 Bank Submitted (Match)' : '⚠️ PAN Name Mismatch'}</span></div>`;
                    return '<div style="margin-top:4px;"><span class="badge badge-pending" style="font-size:0.68rem;">⚠️ Bank KYC Pending</span></div>';
                  })() : ''}
                </td>
                <td><span class="badge ${isBlocked ? 'badge-blocked' : 'badge-delivered'}">${isBlocked ? 'Blocked' : 'Active'}</span></td>
                <td>
                  <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                    ${role === 'admin' ? `<button type="button" class="btn btn-outline btn-sm" style="background:#fef3c7; border-color:#facc15; color:#92400e; font-weight:600;" onclick="openAdminCreditTransferModal('${escapeHtml(targetRole === 'customer' ? u.customerId || String(u.id || u._id) : targetRole === 'deliveryPartner' ? u.riderId || String(u.id || u._id) : targetRole === 'shop' ? u.shopId || String(u.id || u._id) : u.restaurantId || String(u.id || u._id))}')">💳 Add Credits</button>` : ''}
                    ${targetRole !== 'customer' ? `<button type="button" class="btn btn-outline btn-sm" style="background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:600;" onclick="openAdminBankModalByUserId('${u.id || u._id}')">🏦 Bank / KYC</button>` : ''}
                    ${targetRole === 'deliveryPartner' ? `<button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openAdminFleetTrackerModal()">📍 Live Radar</button>` : ''}
                    ${isPending ? `<button class="btn btn-success btn-sm" onclick="approveUser('${u.id || u._id}')">✓ Approve</button><button class="btn btn-danger btn-sm" onclick="rejectUser('${u.id || u._id}')">✕ Reject</button>` : ''}
                    <button class="btn ${isBlocked ? 'btn-success' : 'btn-danger'} btn-sm" onclick="toggleBlockUser('${u.id || u._id}', ${isBlocked})">${isBlocked ? 'Unblock' : 'Block'}</button>
                    <button class="btn btn-outline btn-sm" onclick="editAdminUser('${u.id || u._id}', '${escapeHtml(cleanName)}', '${escapeHtml(u.email || '')}', '${escapeHtml(u.phone || '')}', '${u.role}', '${escapeHtml(u.shopAddress || u.restaurantAddress || '')}', '${escapeHtml(u.category || u.cuisine || '')}', '${escapeHtml(u.deliveryVehicle || '')}', '${escapeHtml(u.digipin || '')}', '${u.shopLocation?.lat || u.restaurantLocation?.lat || ''}', '${u.shopLocation?.lng || u.restaurantLocation?.lng || ''}', '${escapeHtml(partnerPin)}')">Edit</button>
                    <button type="button" class="btn btn-outline btn-sm" style="background:#fff7ed; border-color:#fdba74; color:#c2410c; font-weight:600;" onclick="openAdminResetPasswordModal('${u.id || u._id}', '${escapeHtml(cleanName)}', '${targetRole}', '${escapeHtml(u.dob || '')}', '${escapeHtml(u.email || u.phone || '')}')" title="Reset password to Tomato<DDMMYYYY> or custom">🔑 Reset Password</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteAdminUser('${u.id || u._id}', '${escapeHtml(cleanName)}', '${targetRole}')">🗑 Delete</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${renderAdminUserPaginationControls(targetRole, pagination)}
  `;
}

async function approveUser(userId) {
  try {
    await apiFetch(`/api/admin/users/${userId}/approve`, { method: 'POST' });
    alert('Partner account & bank details approved and locked successfully!');
    refreshAdminViews();
  } catch (e) {
    const msg = e.message || 'Approval failed.';
    if (msg.toLowerCase().includes('pincode') || msg.toLowerCase().includes('serviceable')) {
      alert(`❌ Approval Blocked — Pincode Out of Serviceable Range:\n\n${msg}`);
      return;
    }
    if (confirm(`${msg}\n\nWould you like to open the Bank / PAN KYC verification modal for this partner now?`)) {
      openAdminBankModalByUserId(userId);
    }
  }
}

async function rejectUser(userId) {
  try {
    await apiFetch(`/api/admin/users/${userId}/reject`, { method: 'POST' });
    alert('Partner approval revoked/rejected.');
    refreshAdminViews();
  } catch (e) {
    alert(e.message);
  }
}

async function toggleBlockUser(userId, currentlyBlocked) {
  const action = currentlyBlocked ? 'unblock' : 'block';
  if (!confirm(`Are you sure you want to ${action} this account?`)) return;
  try {
    await apiFetch(`/api/admin/users/${userId}/${action}`, { method: 'POST' });
    alert(`Account ${action}ed successfully.`);
    refreshAdminViews();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteAdminUser(userId, name, targetRole) {
  const roleLabel = targetRole === 'restaurant'
    ? 'restaurant and all its associated menu items'
    : targetRole === 'shop'
    ? 'shop and all its associated items'
    : `${targetRole} account`;
  if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete ${roleLabel} "${name}"? This CANNOT be undone.`)) return;
  try {
    const res = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    alert(res.message || 'Account deleted successfully.');
    refreshAdminViews();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

function openAdminCreditTransferModal(recipientId = '') {
  if (role !== 'admin') return;
  const recipientInput = document.getElementById('admin-credit-recipient-id');
  const pointsInput = document.getElementById('admin-credit-points');
  const purposeInput = document.getElementById('admin-credit-purpose');
  const orderNumberInput = document.getElementById('admin-credit-order-number');
  if (recipientInput) recipientInput.value = recipientId;
  if (pointsInput) pointsInput.value = '';
  if (purposeInput) purposeInput.value = '';
  if (orderNumberInput) orderNumberInput.value = '';
  openModal('admin-credit-transfer-modal');
  if (recipientId) pointsInput?.focus();
  else recipientInput?.focus();
}

function showCurrentAdminWalletTransfer({ recipient, creditPoints, purpose, orderNumber, adminCreditPoint }) {
  const container = document.getElementById('admin-wallet-credit-track');
  if (!container) return;

  if (!container.querySelector('#current-wallet-transfers')) {
    container.innerHTML = `
      <div class="table-wrapper" style="max-height:360px; overflow:auto;">
        <table style="min-width:900px;">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Recipient</th>
              <th>Purpose / Order</th>
              <th>Credit Transferred</th>
              <th>Admin Balance After (₹ / Points)</th>
              <th>Recipient Credit After</th>
            </tr>
          </thead>
          <tbody id="current-wallet-transfers"></tbody>
        </table>
      </div>
    `;
  }

  const timestamp = new Date().toLocaleString();
  const formatBalance = (value) =>
    Number(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const formatPoints = (value) =>
    Number(value ?? 0).toLocaleString();
  const tbody = container.querySelector('#current-wallet-transfers');
  if (!tbody) return;

  tbody.insertAdjacentHTML('afterbegin', `
    <tr>
      <td>${escapeHtml(timestamp)}</td>
      <td><strong>${escapeHtml(recipient.name || 'Recipient')}</strong><br><small>${escapeHtml(recipient.role || '')} · ${escapeHtml(recipient.id || '')}</small></td>
      <td>${escapeHtml(purpose || '—')}${orderNumber ? `<br><small>Order: ${escapeHtml(orderNumber)}</small>` : ''}</td>
      <td>${escapeHtml(formatPoints(creditPoints))} points</td>
      <td>₹${escapeHtml(formatBalance(user.walletBalance))} / ${escapeHtml(formatPoints(adminCreditPoint))}</td>
      <td>${escapeHtml(formatPoints(recipient.creditPoint))} points</td>
    </tr>
  `);
}

async function submitAdminCreditTransfer(event) {
  event.preventDefault();
  if (role !== 'admin') {
    alert('Only an administrator can transfer credit points.');
    return;
  }

  const recipientId = document.getElementById('admin-credit-recipient-id')?.value?.trim() || '';
  const pointsInput = document.getElementById('admin-credit-points');
  const purpose = document.getElementById('admin-credit-purpose')?.value?.trim() || '';
  const orderNumber = document.getElementById('admin-credit-order-number')?.value?.trim() || '';
  const creditPoints = Number(pointsInput?.value);
  if (!recipientId) {
    alert('Enter a recipient account ID.');
    return;
  }
  if (!Number.isSafeInteger(creditPoints) || creditPoints <= 0) {
    alert('Enter a positive whole number of credit points.');
    return;
  }
  if (!purpose) {
    alert('Enter the purpose for this credit-point transfer.');
    return;
  }
  if (!confirm(`Transfer ${creditPoints} credit point(s) from your admin wallet to ${recipientId}?`)) return;

  const submitButton = document.getElementById('admin-credit-transfer-submit');
  if (submitButton) submitButton.disabled = true;
  try {
    const result = await apiFetch(
      `/api/admin/users/${encodeURIComponent(recipientId)}/credit-points`,
      {
        method: 'POST',
        body: JSON.stringify({ creditPoints, purpose, orderNumber }),
      },
    );
    user.creditPoint = result.adminCreditPoint;
    localStorage.setItem('tomatoUser', JSON.stringify(user));

    const walletText = document.getElementById('profile-wallet-text');
    if (walletText) {
      walletText.textContent = `${Number(user.walletBalance ?? 0).toFixed(2)}/${Number(user.creditPoint ?? 0).toFixed(0)}`;
    }

    document.getElementById('admin-credit-transfer-form')?.reset();
    showCurrentAdminWalletTransfer({
      recipient: result.recipient,
      creditPoints,
      purpose,
      orderNumber,
      adminCreditPoint: result.adminCreditPoint,
    });

    showToastNotification({
      title: 'Credit Points Transferred',
      message: `${creditPoints} point(s) added to ${result.recipient.name} (${result.recipient.role}). Admin wallet: ${result.adminCreditPoint} points remaining.`,
      type: 'success',
    });
    refreshAdminViews();
  } catch (error) {
    alert(`Credit-point transfer failed: ${error.message}`);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function refreshAdminViews() {
  if (activeView === 'admin-shops') fetchAdminShops(null, true);
  else if (activeView === 'admin-restaurants') fetchAdminRestaurants(null, true);
  else if (activeView === 'admin-riders') fetchAdminRiders(null, true);
  else if (activeView === 'admin-customers') fetchAdminCustomers(null, true);
  else loadRoleOverview();
}

function detectAdminRestaurantGPS() {
  if (!('geolocation' in navigator)) {
    alert('Geolocation not supported in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(5));
      const lng = Number(pos.coords.longitude.toFixed(5));
      const latEl = document.getElementById('adm-restaurant-lat');
      const lngEl = document.getElementById('adm-restaurant-lng');
      const digipinEl = document.getElementById('adm-restaurant-digipin');
      if (latEl) latEl.value = lat;
      if (lngEl) lngEl.value = lng;
      if (digipinEl && !digipinEl.value) {
        digipinEl.value = `DGP-${Math.round(lat * 100)}-${Math.round(lng * 100)}`;
      }
      alert(`Detected restaurant GPS coordinates: ${lat}, ${lng}`);
    },
    (err) => {
      alert(`GPS Error: ${err.message}. Please enter manually or try again.`);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Admin Add / Edit User Modal
function openAdminCreateUserModal(defaultRole = 'restaurant') {
  const roleLabel = defaultRole === 'shop' ? 'Shop Partner' : defaultRole === 'restaurant' ? 'Restaurant Partner' : defaultRole === 'deliveryPartner' ? 'Delivery Partner' : 'User';
  document.getElementById('admin-user-modal-title').textContent = `Add New ${roleLabel}`;
  document.getElementById('adm-user-id').value = '';
  document.getElementById('adm-role').value = defaultRole;
  document.getElementById('adm-name').value = '';
  document.getElementById('adm-email').value = '';
  document.getElementById('adm-phone').value = '';
  document.getElementById('adm-password').value = '';
  document.getElementById('adm-password-group').style.display = 'block';
  document.getElementById('adm-restaurant-address').value = '';
  const rPin = document.getElementById('adm-restaurant-pincode');
  if (rPin) rPin.value = '';
  document.getElementById('adm-cuisine').value = '';
  document.getElementById('adm-vehicle').value = '';
  const dPin = document.getElementById('adm-restaurant-digipin');
  if (dPin) dPin.value = '';
  const rLat = document.getElementById('adm-restaurant-lat');
  if (rLat) rLat.value = '';
  const rLng = document.getElementById('adm-restaurant-lng');
  if (rLng) rLng.value = '';
  toggleAdminUserFields();
  openModal('admin-user-modal');
}

function editAdminUser(id, name, email, phone, uRole, address, cuisine, vehicle, digipin = '', lat = '', lng = '', pincode = '') {
  document.getElementById('admin-user-modal-title').textContent = 'Edit User / Partner';
  document.getElementById('adm-user-id').value = id;
  document.getElementById('adm-role').value = uRole;
  document.getElementById('adm-name').value = formatCleanName(name);
  document.getElementById('adm-email').value = email;
  document.getElementById('adm-phone').value = phone;
  document.getElementById('adm-password-group').style.display = 'none';
  document.getElementById('adm-restaurant-address').value = address;
  const rPin = document.getElementById('adm-restaurant-pincode');
  if (rPin) rPin.value = pincode || extractPincodeFromStr(address) || '';
  document.getElementById('adm-cuisine').value = cuisine;
  document.getElementById('adm-vehicle').value = vehicle;
  const dPin = document.getElementById('adm-restaurant-digipin');
  if (dPin) dPin.value = digipin;
  const rLat = document.getElementById('adm-restaurant-lat');
  if (rLat) rLat.value = lat;
  const rLng = document.getElementById('adm-restaurant-lng');
  if (rLng) rLng.value = lng;
  toggleAdminUserFields();
  openModal('admin-user-modal');
}

function toggleAdminUserFields() {
  const r = document.getElementById('adm-role')?.value;
  const restFields = document.getElementById('adm-restaurant-fields');
  const riderFields = document.getElementById('adm-rider-fields');
  if (restFields) {
    restFields.style.display = (r === 'restaurant' || r === 'shop') ? 'block' : 'none';
    const addrLabel = document.getElementById('adm-rest-address-label');
    if (addrLabel) addrLabel.innerHTML = (r === 'shop' ? 'Shop Address' : 'Restaurant Address') + ' <span style="color:var(--tomato);">*</span>';
    const pinLabel = document.getElementById('adm-rest-pincode-label');
    if (pinLabel) pinLabel.innerHTML = (r === 'shop' ? 'Shop Pincode (Serviceable Area)' : 'Restaurant Pincode (Serviceable Area)') + ' <span style="color:var(--tomato);">*</span>';
    const digipinLabel = document.getElementById('adm-rest-digipin-label');
    if (digipinLabel) digipinLabel.innerHTML = (r === 'shop' ? 'Shop DIGIPIN' : 'Restaurant DIGIPIN') + ' <span style="color:var(--tomato);">*</span>';
    const catLabel = document.getElementById('adm-cuisine-label');
    if (catLabel) catLabel.textContent = r === 'shop' ? 'Shop Category / Speciality' : 'Cuisine';
  }
  if (riderFields) riderFields.style.display = r === 'deliveryPartner' ? 'block' : 'none';
}

async function saveAdminUser(e) {
  e.preventDefault();
  const id = document.getElementById('adm-user-id').value;
  const targetRole = document.getElementById('adm-role').value;
  const digipinVal = document.getElementById('adm-restaurant-digipin')?.value?.trim();
  const latVal = document.getElementById('adm-restaurant-lat')?.value;
  const lngVal = document.getElementById('adm-restaurant-lng')?.value;
  const pincodeVal = document.getElementById('adm-restaurant-pincode')?.value?.trim();

  if ((targetRole === 'restaurant' || targetRole === 'shop') && !digipinVal && (!latVal || !lngVal)) {
    alert('Location requirement: Please provide either a valid DIGIPIN or click "Detect Device GPS Pin" to set pickup coordinates.');
    return;
  }

  const payload = {
    role: targetRole,
    name: document.getElementById('adm-name').value.trim(),
    email: document.getElementById('adm-email').value.trim() || undefined,
    phone: document.getElementById('adm-phone').value.trim() || undefined,
    password: document.getElementById('adm-password').value,
    restaurantAddress: document.getElementById('adm-restaurant-address').value.trim(),
    shopAddress: document.getElementById('adm-restaurant-address').value.trim(),
    pincode: pincodeVal || undefined,
    cuisine: document.getElementById('adm-cuisine').value.trim(),
    category: document.getElementById('adm-cuisine').value.trim(),
    deliveryVehicle: document.getElementById('adm-vehicle').value.trim(),
    digipin: digipinVal || undefined,
    lat: latVal ? Number(latVal) : undefined,
    lng: lngVal ? Number(lngVal) : undefined,
  };

  try {
    if (id) {
      await apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      if (!payload.password || payload.password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
      }
      await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('admin-user-modal');
    refreshAdminViews();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}


// =========================================================================
// ADMIN FLEET LIVE TRACKER RADAR
// =========================================================================
let adminFleetPollInterval = null;

async function openAdminFleetTrackerModal() {
  openModal('admin-fleet-tracker-modal');
  if (window.TomatoWS && typeof window.TomatoWS.subscribeFleetLiveTracking === 'function') {
    window.TomatoWS.subscribeFleetLiveTracking();
  }
  await refreshAdminFleet();

  if (adminFleetPollInterval) clearInterval(adminFleetPollInterval);
  adminFleetPollInterval = setInterval(refreshAdminFleet, 6000);
}

function closeAdminFleetTrackerModal() {
  if (window.TomatoWS && typeof window.TomatoWS.unsubscribeFleetLiveTracking === 'function') {
    window.TomatoWS.unsubscribeFleetLiveTracking();
  }
  if (adminFleetPollInterval) {
    clearInterval(adminFleetPollInterval);
    adminFleetPollInterval = null;
  }
  closeModal('admin-fleet-tracker-modal');
}

async function refreshAdminFleet() {
  try {
    const res = await apiFetch('/api/admin/riders/live-locations');
    renderAdminFleet(res);
  } catch (err) {
    const container = document.getElementById('admin-fleet-table-container');
    if (container) {
    container.innerHTML = `<p style="color:var(--tomato-dark); text-align:center;">Failed to fetch fleet: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function renderAdminFleet(data) {
  const riders = data.riders || [];
  const summary = data.summary || {};

  // Summary Bar
  const bar = document.getElementById('admin-fleet-summary-bar');
  if (bar) {
    bar.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:0.75rem; text-align:center;">
    <span style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:600; display:block;">Total Fleet</span>
    <strong style="font-size:1.3rem;">${summary.totalRiders || riders.length}</strong>
    </div>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:0.75rem; text-align:center;">
    <span style="font-size:0.75rem; color:#15803d; text-transform:uppercase; font-weight:600; display:block;">Live Online Now</span>
    <strong style="font-size:1.3rem; color:#16a34a;">${summary.onlineRiders || riders.filter((r) => r.isOnline).length}</strong>
    </div>
    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:0.75rem; text-align:center;">
    <span style="font-size:0.75rem; color:#0369a1; text-transform:uppercase; font-weight:600; display:block;">Active Trips</span>
    <strong style="font-size:1.3rem; color:#0284c7;">${summary.activeDeliveriesCount || 0}</strong>
    </div>
    `;
  }

  const pingEl = document.getElementById('admin-fleet-last-ping');
  if (pingEl) pingEl.textContent = `● Live updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // Draw Canvas
  const canvas = document.getElementById('admin-fleet-canvas');
  if (canvas) drawAdminFleetCanvas(canvas, riders);

  // Table
  const tableContainer = document.getElementById('admin-fleet-table-container');
  if (tableContainer) {
    if (!riders.length) {
    tableContainer.innerHTML = '<p style="color:var(--muted); text-align:center; padding:1rem 0;">No delivery partners registered in fleet.</p>';
    return;
    }

    tableContainer.innerHTML = `
    <div class="table-wrapper" style="max-height:280px; overflow-y:auto;">
    <table>
    <thead>
    <tr>
    <th>Rider (Name / ID)</th>
    <th>Transmitter Status</th>
    <th>Live GPS Coordinates</th>
    <th>Active Trips</th>
    <th>Vehicle</th>
    </tr>
    </thead>
    <tbody>
    ${riders.map((r) => {
    const isLive = Boolean(r.isOnline);
    const coords = r.currentLocation?.lat ? `${r.currentLocation.lat.toFixed(4)}, ${r.currentLocation.lng.toFixed(4)}` : 'Indiranagar Hub';

    return `
    <tr>
    <td>
    <strong>${escapeHtml(r.name)}</strong> / <span style="font-family:monospace; color:#0369a1; font-weight:700;">${escapeHtml(r.riderId || 'RIDE')}</span>
    ${r.phone ? `<br><small style="color:var(--muted);">📞 ${escapeHtml(r.phone)}</small>` : ''}
    </td>
    <td>
    <span class="badge" style="background:${isLive ? '#dcfce7' : '#f1f5f9'}; color:${isLive ? '#15803d' : '#64748b'}; font-weight:600;">
    ${isLive ? '🟢 GPS Active' : '⚪ Offline'}
    </span>
    </td>
    <td><span style="font-family:monospace; font-size:0.82rem;">${coords}</span></td>
    <td><span class="badge ${r.activeDeliveriesCount > 0 ? 'badge-transit' : 'badge-delivered'}">${r.activeDeliveriesCount || 0} Active</span></td>
    <td><span class="badge badge-accepted">${escapeHtml(r.deliveryVehicle || 'Bike')}</span></td>
    </tr>
    `;
    }).join('')}
    </tbody>
    </table>
    </div>
    `;
  }
}

function drawAdminFleetCanvas(canvas, riders) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Radar grid
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5;
  for (let x = 40; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 30; y < h; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Radar sweeps from Bengaluru center
  const cx = w * 0.5;
  const cy = h * 0.5;
  [40, 80, 120, 160].forEach((r) => {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Center hub marker (MG Road / Vidhana Soudha)
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#64748b';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Central Bengaluru', cx, cy + 16);

  // Center ref coords: lat 12.9716, lng 77.5946
  const baseLat = 12.9716;
  const baseLng = 77.5946;
  const scale = 2500; // pixels per degree

  riders.forEach((r, idx) => {
    const rLat = r.currentLocation?.lat || (baseLat + (idx % 2 === 0 ? 0.008 : -0.008) * ((idx + 1) * 0.7));
    const rLng = r.currentLocation?.lng || (baseLng + (idx % 3 === 0 ? 0.012 : -0.012) * ((idx + 1) * 0.6));

    // Project to canvas
    let px = cx + (rLng - baseLng) * scale;
    let py = cy - (rLat - baseLat) * scale;

    // Clamp to canvas borders
    px = Math.max(30, Math.min(w - 30, px));
    py = Math.max(30, Math.min(h - 30, py));

    const isOnline = Boolean(r.isOnline);

    // Pulse
    if (isOnline) {
    ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
    ctx.beginPath();
    ctx.arc(px, py, 16, 0, Math.PI * 2);
    ctx.fill();
    }

    // Blip
    ctx.fillStyle = isOnline ? '#22c55e' : '#64748b';
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = isOnline ? '#4ade80' : '#94a3b8';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    const rLabel = `${(r.name || 'Rider').split(' ')[0]} / ${r.riderId || 'RIDE'}`;
    ctx.fillText(rLabel, px, py - 10);
  });
}


// =========================================================================
// ADMIN: PLATFORM OVERVIEW REPORT LOGIC (DASHBOARD & KPIS)
// =========================================================================
let adminReportOrdersCache = [];
let adminReportKpisCache = null;
let adminReportAnalyticsCache = null;

async function refreshAdminReportData() {
  try {
    const promises = [
      apiFetch('/api/admin/dashboard').catch(() => ({ kpis: {} })),
      apiFetch('/api/admin/analytics?allTime=true').catch(() => ({ analytics: {} })),
    ];
    if (role === 'admin' || (userPerms && (userPerms.includes('orders_manage') || userPerms.includes('*')))) {
      promises.push(
        apiFetch('/api/admin/orders?byRange=true&startDate=2020-01-01&endDate=2099-12-31').catch(() =>
          apiFetch('/api/admin/orders?limit=300').catch(() => ({ orders: [] }))
        )
      );
    }
    const [dashRes, anRes, ordersRes] = await Promise.all(promises);
    adminReportKpisCache = dashRes?.kpis || {};
    adminReportAnalyticsCache = anRes?.analytics || {};
    adminReportOrdersCache = ordersRes && Array.isArray(ordersRes.orders) ? ordersRes.orders : [];
    renderAdminReportData();
  } catch (err) {
    console.error('Failed to load admin report data:', err);
  }
}

function renderAdminReportData() {
  const period = document.getElementById('admin-report-period')?.value || 'all';
  const channel = document.getElementById('admin-report-channel')?.value || 'all';
  const dateLabel = document.getElementById('admin-report-date-label');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let filteredOrders = [...adminReportOrdersCache];
  let rangeLabel = 'All historic platform orders';

  if (period === 'today') {
    filteredOrders = filteredOrders.filter((o) => new Date(o.createdAt || o.date) >= startOfDay);
    rangeLabel = `Today (${now.toLocaleDateString()})`;
  } else if (period === 'yesterday') {
    const startOfYesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
    filteredOrders = filteredOrders.filter((o) => {
      const d = new Date(o.createdAt || o.date);
      return d >= startOfYesterday && d < startOfDay;
    });
    rangeLabel = `Yesterday (${startOfYesterday.toLocaleDateString()})`;
  } else if (period === 'last7') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filteredOrders = filteredOrders.filter((o) => new Date(o.createdAt || o.date) >= sevenDaysAgo);
    rangeLabel = 'Past 7 days';
  } else if (period === 'thisMonth') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    filteredOrders = filteredOrders.filter((o) => new Date(o.createdAt || o.date) >= startOfMonth);
    rangeLabel = `${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
  }

  // Filter by channel (Restaurant vs Shop)
  if (channel === 'restaurant') {
    filteredOrders = filteredOrders.filter((o) => o.restaurantId || (o.restaurantName && !o.shopName) || o.storeType === 'restaurant');
  } else if (channel === 'shop') {
    filteredOrders = filteredOrders.filter((o) => o.shopId || o.shopName || o.storeType === 'shop');
  }

  if (dateLabel) {
    dateLabel.textContent = `• ${rangeLabel}${channel !== 'all' ? ` (${channel === 'restaurant' ? 'Restaurants' : 'Shops'})` : ''}`;
  }

  const kpis = adminReportKpisCache || {};
  const an = adminReportAnalyticsCache || {};

  let totalOrders = filteredOrders.length;
  let deliveredCount = 0;
  let cancelledCount = 0;
  let inProgressCount = 0;
  let grossSales = 0;
  let platformCommission = 0;
  let partnerPayouts = 0;
  let totalDiscounts = 0;
  const itemMap = new Map();

  if (adminReportOrdersCache.length > 0) {
    filteredOrders.forEach((o) => {
      const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
      if (st === 'delivered') deliveredCount++;
      else if (st === 'cancelled' || st === 'rejected') cancelledCount++;
      else inProgressCount++;

      const orderTotal = Number(o.totalAmount || o.billDetails?.grandTotal || o.bill?.grandTotal || 0);
      if (st !== 'cancelled' && st !== 'rejected') {
        grossSales += orderTotal;
        const commPct = Number(o.commissionRate || 15);
        const comm = orderTotal * (commPct / 100);
        platformCommission += comm;

        let storeDiscounts = 0;
        if (Array.isArray(o.appliedCoupons)) {
          o.appliedCoupons.forEach((ac) => {
            totalDiscounts += Number(ac.discountAmount || 0);
            if (ac.sponsorType === 'restaurant' || ac.sponsorType === 'shop') {
              storeDiscounts += Number(ac.partnerShare || ac.discountAmount || 0);
            } else if (ac.sponsorType === 'common') {
              storeDiscounts += Number(ac.partnerShare || 0);
            }
          });
        }
        partnerPayouts += Math.max(0, orderTotal - comm - storeDiscounts);
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
  } else {
    totalOrders = kpis.totalOrders || an.totalOrders || 0;
    deliveredCount = kpis.deliveredOrders || an.completedOrders || an.deliveredOrders || 0;
    cancelledCount = kpis.cancelledOrders || an.cancelledOrders || 0;
    inProgressCount = kpis.activeOrders || Math.max(0, totalOrders - deliveredCount - cancelledCount);
    grossSales = period === 'today' ? Number(kpis.todayRevenue || 0) : Number(kpis.totalRevenue || an.totalGMV || 0);
    platformCommission = Number(an.platformCommission || grossSales * 0.15);
    partnerPayouts = Math.max(0, grossSales - platformCommission);
  }

  const completionRate = totalOrders > 0 ? Math.round((deliveredCount / totalOrders) * 100) : 0;
  const totalRestaurants = kpis.totalRestaurants || (an.partnerBreakdown?.restaurants) || 0;
  const totalShops = kpis.totalShops || (an.partnerBreakdown?.shops) || 0;
  const totalRiders = kpis.totalRiders || (an.partnerBreakdown?.riders) || 0;

  const kpiGridEl = document.getElementById('admin-report-kpi-grid');
  if (kpiGridEl) {
    kpiGridEl.innerHTML = `
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Platform GMV</div>
        <div style="font-size:1.6rem; font-weight:800; color:var(--green); margin-top:0.2rem;">₹${grossSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
        <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Gross value of placed orders</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Platform Commission</div>
        <div style="font-size:1.6rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">₹${platformCommission.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
        <div style="font-size:0.74rem; color:#1d4ed8; font-weight:600; margin-top:0.15rem;">Tomato Net Revenue (~15%)</div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem;">
        <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Orders Volume</div>
        <div style="font-size:1.6rem; font-weight:800; color:var(--ink); margin-top:0.2rem;">${totalOrders}</div>
        <div style="font-size:0.74rem; color:var(--green); font-weight:600; margin-top:0.15rem;">${deliveredCount} delivered (${completionRate}%)</div>
      </div>
      <div class="stat-card clickable" onclick="openAdminPartnerFleetModal('all')" style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.9rem 1rem; cursor:pointer; transition:all 0.15s ease;" title="Click to view complete partner fleet list">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Active Partner Fleet</div>
          <span style="font-size:0.75rem; color:var(--muted); font-weight:600;">View List ↗</span>
        </div>
        <div style="font-size:1.6rem; font-weight:800; color:#c2410c; margin-top:0.2rem;">${totalRestaurants + totalShops}</div>
        <div style="font-size:0.75rem; margin-top:0.3rem; display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
          <span onclick="event.stopPropagation(); openAdminPartnerFleetModal('restaurant');" title="View Restaurants" style="cursor:pointer; background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; padding:0.12rem 0.45rem; border-radius:999px; font-weight:700; font-size:0.72rem;">🏪 ${totalRestaurants} Rest</span>
          <span style="color:var(--muted);">•</span>
          <span onclick="event.stopPropagation(); openAdminPartnerFleetModal('shop');" title="View Shops" style="cursor:pointer; background:#eff6ff; color:#1d4ed8; border:1px solid #dbeafe; padding:0.12rem 0.45rem; border-radius:999px; font-weight:700; font-size:0.72rem;">🏬 ${totalShops} Shops</span>
          <span style="color:var(--muted);">•</span>
          <span onclick="event.stopPropagation(); openAdminPartnerFleetModal('deliveryPartner');" title="View Riders" style="cursor:pointer; background:#f0fdf4; color:#15803d; border:1px solid #dcfce7; padding:0.12rem 0.45rem; border-radius:999px; font-weight:700; font-size:0.72rem;">🚴 ${totalRiders} Riders</span>
        </div>
      </div>
    `;
  }

  const finEl = document.getElementById('admin-report-financial-breakdown');
  if (finEl) {
    finEl.innerHTML = `
      <div style="background:#f8fafc; padding:0.75rem; border-radius:8px; border:1px solid #e2e8f0;">
        <div style="font-size:0.72rem; color:var(--muted); font-weight:700; text-transform:uppercase;">Gross Merchandise Value</div>
        <div style="font-size:1.15rem; font-weight:800; color:var(--ink); margin-top:0.15rem;">₹${grossSales.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:var(--muted);">Total billed items</div>
      </div>
      <div style="background:#eff6ff; padding:0.75rem; border-radius:8px; border:1px solid #bfdbfe;">
        <div style="font-size:0.72rem; color:#1e40af; font-weight:700; text-transform:uppercase;">Platform Commission</div>
        <div style="font-size:1.15rem; font-weight:800; color:#1d4ed8; margin-top:0.15rem;">+₹${platformCommission.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:#1e40af;">Tomato platform cut</div>
      </div>
      <div style="background:#f8fafc; padding:0.75rem; border-radius:8px; border:1px solid #e2e8f0;">
        <div style="font-size:0.72rem; color:var(--muted); font-weight:700; text-transform:uppercase;">Net Partner Payouts</div>
        <div style="font-size:1.15rem; font-weight:800; color:#047857; margin-top:0.15rem;">₹${partnerPayouts.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:var(--muted);">Payable to stores</div>
      </div>
      <div style="background:#fef2f2; padding:0.75rem; border-radius:8px; border:1px solid #fecaca;">
        <div style="font-size:0.72rem; color:#991b1b; font-weight:700; text-transform:uppercase;">Coupon Discounts Given</div>
        <div style="font-size:1.15rem; font-weight:800; color:#b91c1c; margin-top:0.15rem;">₹${totalDiscounts.toFixed(2)}</div>
        <div style="font-size:0.7rem; color:#991b1b;">Discounts distributed</div>
      </div>
    `;
  }

  const statusEl = document.getElementById('admin-report-status-breakdown');
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

  const topItemsEl = document.getElementById('admin-report-top-items');
  if (topItemsEl) {
    const sortedItems = Array.from(itemMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    if (!sortedItems.length) {
      if (an.topDishes && an.topDishes.length > 0) {
        topItemsEl.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:0.45rem;">
            ${an.topDishes.slice(0, 5).map((it, idx) => `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem; padding:0.35rem 0; border-bottom:1px dashed #e2e8f0;">
                <div>
                  <span style="font-weight:800; color:#c2410c; margin-right:0.35rem;">#${idx + 1}</span>
                  <span style="font-weight:600; color:var(--ink);">${escapeHtml(it.name)}</span>
                </div>
                <div style="text-align:right;">
                  <span style="font-weight:700; color:var(--charcoal);">${it.orderCount || it.quantity || 1} orders</span>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        topItemsEl.innerHTML = '<p style="color:var(--muted); font-size:0.8rem; margin:0.5rem 0;">No items sold in this period.</p>';
      }
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

function exportAdminReportCsv() {
  const period = document.getElementById('admin-report-period')?.value || 'all';
  if (!adminReportOrdersCache.length) {
    alert('No order records to export for this view.');
    return;
  }
  const headers = ['Order Number', 'Date', 'Channel', 'Store Name', 'Status', 'Customer', 'Items Count', 'Gross Total (INR)', 'Commission (INR)'];
  const rows = adminReportOrdersCache.map((o) => {
    const isShop = !!(o.shopId || o.shopName || o.storeType === 'shop');
    const channel = isShop ? 'Shop' : 'Restaurant';
    const store = o.shopName || o.restaurantName || 'Store';
    const gross = Number(o.totalAmount || o.billDetails?.grandTotal || 0);
    const comm = (gross * 0.15).toFixed(2);
    return [
      o.orderNumber || o.orderId || o._id,
      new Date(o.createdAt || o.date).toLocaleDateString(),
      channel,
      store,
      o.status || 'N/A',
      o.customerName || (o.customerId && o.customerId.name) || 'Customer',
      (o.items || []).length,
      gross.toFixed(2),
      comm,
    ];
  });
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Platform_Admin_Report_${period}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function printAdminReport() {
  window.print();
}

window.refreshAdminReportData = refreshAdminReportData;
window.renderAdminReportData = renderAdminReportData;
window.exportAdminReportCsv = exportAdminReportCsv;
window.printAdminReport = printAdminReport;

// Admin Orders Controls & Bulk Actions
window.navigateAdminOrderDay = navigateAdminOrderDay;
window.fetchAdminOrdersByDate = fetchAdminOrdersByDate;
window.fetchAdminOrders = fetchAdminOrders;
window.resetAdminOrdersFilter = resetAdminOrdersFilter;
window.getSelectedAdminOrderIds = getSelectedAdminOrderIds;
window.toggleSelectAllAdminOrders = toggleSelectAllAdminOrders;
window.updateAdminOrdersSelection = updateAdminOrdersSelection;
window.archiveAdminOrder = archiveAdminOrder;
window.deleteAdminOrder = deleteAdminOrder;
window.executeAdminBulkArchive = executeAdminBulkArchive;
window.executeAdminBulkDelete = executeAdminBulkDelete;
window.executeAdminPeriodArchive = executeAdminPeriodArchive;
window.executeAdminPeriodDelete = executeAdminPeriodDelete;

// Partner & Customer Management Desk (Shops, Restaurants, Riders, Customers)
window.fetchAdminUsers = fetchAdminUsers;
window.changeAdminUserPage = changeAdminUserPage;
window.fetchAdminRestaurants = fetchAdminRestaurants;
window.fetchAdminRiders = fetchAdminRiders;
window.fetchAdminCustomers = fetchAdminCustomers;
window.searchAdminUsers = searchAdminUsers;
window.clearAdminSearch = clearAdminSearch;
window.handleAdminSearchInput = handleAdminSearchInput;
window.renderPartnerManagementTable = renderPartnerManagementTable;
window.approveUser = approveUser;
window.rejectUser = rejectUser;
window.toggleBlockUser = toggleBlockUser;
window.deleteAdminUser = deleteAdminUser;
window.openAdminCreditTransferModal = openAdminCreditTransferModal;
window.showCurrentAdminWalletTransfer = showCurrentAdminWalletTransfer;
window.submitAdminCreditTransfer = submitAdminCreditTransfer;
window.refreshAdminViews = refreshAdminViews;
window.detectAdminRestaurantGPS = detectAdminRestaurantGPS;
window.openAdminCreateUserModal = openAdminCreateUserModal;
window.editAdminUser = editAdminUser;
window.toggleAdminUserFields = toggleAdminUserFields;
window.saveAdminUser = saveAdminUser;

// Pincodes & Live Radar
window.fetchAdminServiceablePincodes = fetchAdminServiceablePincodes;
window.renderAdminServiceablePincodesBars = renderAdminServiceablePincodesBars;
window.resolveFrontendPartnerPincode = resolveFrontendPartnerPincode;
window.openAdminFleetTrackerModal = openAdminFleetTrackerModal;
window.closeAdminFleetTrackerModal = closeAdminFleetTrackerModal;
window.refreshAdminFleet = refreshAdminFleet;
window.renderAdminFleet = renderAdminFleet;
window.drawAdminFleetCanvas = drawAdminFleetCanvas;

