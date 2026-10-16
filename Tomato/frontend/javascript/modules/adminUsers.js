// =========================================================================
// ADMIN USERS & SUB-ADMINS MODULE (RBAC, PASSWORD RESET, FLEET MODAL)
// =========================================================================
// =========================================================================
// ADMIN: SUB-ADMINS & ROLE-BASED ACCESS CONTROL (RBAC)
// =========================================================================
let currentSubAdminsList = [];
let adminSubAdminSearchDebounceTimer = null;

const RBAC_PERMISSIONS_MAP = {
  dashboard_view: { label: 'Analytics', icon: '📊', color: '#0284c7' },
  orders_manage: { label: 'Orders', icon: '📦', color: '#d94b35' },
  shops_manage: { label: 'Shops', icon: '🏬', color: '#059669' },
  restaurants_manage: { label: 'Restaurants', icon: '🏪', color: '#16a34a' },
  riders_manage: { label: 'Riders Fleet', icon: '🚴', color: '#ea580c' },
  customers_manage: { label: 'Customers', icon: '👥', color: '#9333ea' },
  subadmins_manage: { label: 'Sub-Admins', icon: '🛡️', color: '#475569' },
};

const RBAC_PRESETS = {
  operations_lead: ['dashboard_view', 'orders_manage', 'riders_manage'],
  restaurant_lead: ['orders_manage', 'restaurants_manage', 'shops_manage'],
  support_lead: ['orders_manage', 'customers_manage', 'riders_manage'],
  full_admin: ['dashboard_view', 'orders_manage', 'shops_manage', 'restaurants_manage', 'riders_manage', 'customers_manage', 'subadmins_manage'],
};

function applySubAdminPreset(preset, prefix) {
  const perms = RBAC_PRESETS[preset] || [];
  Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
    const cb = document.getElementById(`${prefix}${key}`);
    if (cb) {
      cb.checked = perms.includes(key);
    }
  });
}

function handleAdminSubAdminSearchInput() {
  const input = document.getElementById('admin-subadmins-search');
  const clearBtn = document.getElementById('admin-subadmins-clear-btn');
  const q = input?.value?.trim() || '';

  if (clearBtn) {
    clearBtn.style.display = q ? 'inline-flex' : 'none';
  }

  clearTimeout(adminSubAdminSearchDebounceTimer);
  adminSubAdminSearchDebounceTimer = setTimeout(() => {
    fetchAdminSubAdmins(true);
  }, 350);
}

function clearAdminSubAdminsSearch() {
  const input = document.getElementById('admin-subadmins-search');
  if (input) input.value = '';
  const clearBtn = document.getElementById('admin-subadmins-clear-btn');
  if (clearBtn) clearBtn.style.display = 'none';
  fetchAdminSubAdmins(true);
}

async function fetchAdminSubAdmins(force = false) {
  const container = document.getElementById('admin-subadmins-table');
  const statsContainer = document.getElementById('admin-subadmins-stats');
  if (!container) return;

  const q = document.getElementById('admin-subadmins-search')?.value?.trim() || '';
  const cacheKey = `subadmins_${q}`;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  const now = Date.now();

  if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 15000)) {
    return;
  }

  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('sub-administrators');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  const queryParam = q ? `?search=${encodeURIComponent(q)}` : '';

  try {
    const res = await apiFetch(`/api/admin/subadmins${queryParam}`);
    viewLastFetched[cacheKey] = now;
    const subadmins = res.subadmins || [];
    currentSubAdminsList = subadmins;

    // Render stats
    const activeCount = subadmins.filter(s => !s.isBlocked).length;
    const blockedCount = subadmins.filter(s => s.isBlocked).length;
    const fullAccessCount = subadmins.filter(s => Array.isArray(s.permissions) && s.permissions.length >= 6).length;

    if (statsContainer) {
      statsContainer.innerHTML = `
        <div class="stat-card"><span class="stat-label">Total Sub-Admins</span><div class="stat-value">${subadmins.length}</div><span class="stat-note">Delegated operators</span></div>
        <div class="stat-card"><span class="stat-label">Active Team</span><div class="stat-value" style="color:var(--green);">${activeCount}</div><span class="stat-note">Operating normally</span></div>
        <div class="stat-card"><span class="stat-label">Blocked / Restricted</span><div class="stat-value" style="color:${blockedCount ? 'var(--tomato)' : 'var(--muted)'};">${blockedCount}</div><span class="stat-note">Access revoked</span></div>
        <div class="stat-card"><span class="stat-label">Full Co-Admins</span><div class="stat-value">${fullAccessCount}</div><span class="stat-note">All 6 permissions</span></div>
      `;
    }

    if (!subadmins.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted); background:#faf8f5; border:1px dashed var(--line); border-radius:10px;">
          <span style="font-size:2rem; display:block; margin-bottom:0.5rem;">🛡️</span>
          <strong style="font-size:1.1rem; color:var(--ink);">${q ? `No sub-admins found matching "${escapeHtml(q)}"` : 'No Sub-Administrators Created Yet'}</strong>
          <p style="margin-top:0.4rem; font-size:0.85rem;">Click "+ Create Sub-Admin" above to delegate management roles with custom permissions.</p>
          <div style="margin-top:1rem;">
            <button type="button" class="btn btn-primary btn-sm" style="background:var(--green); border-color:var(--green);" onclick="openCreateSubAdminModal()">➕ Create Sub-Admin</button>
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
              <th>Sub-Admin &amp; Operational Title</th>
              <th>Contact Details</th>
              <th>Assigned RBAC Permissions</th>
              <th>Status</th>
              <th>Created By</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${subadmins.map(s => {
              const roleTitle = s.adminRoleTitle || 'Sub-Admin';
              const isBlocked = Boolean(s.isBlocked);
              const perms = Array.isArray(s.permissions) ? s.permissions : [];

              const permsBadges = perms.map(pKey => {
                const meta = RBAC_PERMISSIONS_MAP[pKey] || { label: pKey, icon: '🔑', color: '#475569' };
                return `<span class="badge" style="background:#f1f5f9; color:${meta.color}; border:1px solid #e2e8f0; font-size:0.7rem; margin:0.15rem 0.2rem 0.15rem 0; display:inline-flex; align-items:center; gap:0.25rem;">${meta.icon} ${meta.label}</span>`;
              }).join('');

              const sId = s.subadminId || String(s.id || s._id);
              return `
                <tr id="subadmin-row-${s._id}" style="${isBlocked ? 'background:#faf9f6; opacity:0.85;' : ''}">
                  <td>
                    <div style="font-weight:700; color:var(--ink);">${escapeHtml(formatCleanName(s.name || s.displayName || 'Sub-Admin'))}</div>
                    <div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap; margin-top:0.2rem;">
                      <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.72rem;">${escapeHtml(roleTitle)}</span>
                      <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(s.id || s._id))}">ID: ${escapeHtml(sId)}</span>
                    </div>
                  </td>
                  <td>
                    <div>✉️ ${escapeHtml(s.email || 'N/A')}</div>
                    ${s.phone ? `<small style="color:var(--muted);">📞 ${escapeHtml(s.phone)}</small>` : ''}
                  </td>
                  <td>
                    <div style="display:flex; flex-wrap:wrap; max-width:320px;">
                      ${permsBadges || '<span style="color:var(--muted); font-size:0.75rem;">No permissions</span>'}
                    </div>
                  </td>
                  <td>
                    <span class="badge ${isBlocked ? 'badge-cancelled' : 'badge-delivered'}">
                      ${isBlocked ? 'Restricted / Blocked' : 'Active'}
                    </span>
                  </td>
                  <td>
                    <small style="color:var(--muted);">${escapeHtml(s.createdBy || 'Platform Admin')}</small>
                  </td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="btn btn-outline btn-sm" onclick="openEditSubAdminModal('${s._id}')" title="Configure permissions">⚙️ Permissions</button>
                    <button type="button" class="btn btn-outline btn-sm" style="background:#fff7ed; border-color:#fdba74; color:#c2410c; font-weight:600;" onclick="openAdminResetPasswordModal('${s._id}', '${escapeHtml(formatCleanName(s.name || s.displayName || 'Sub-Admin'))}', 'subadmin', '${escapeHtml(s.dob || '')}', '${escapeHtml(s.email || s.phone || '')}')" title="Reset password to Tomato<DDMMYYYY> or custom">🔑 Reset Password</button>
                    <button class="btn btn-outline btn-sm" style="${isBlocked ? 'color:var(--green); border-color:var(--green);' : 'color:var(--tomato); border-color:var(--tomato);'}" onclick="toggleSubAdminStatus('${s._id}', ${isBlocked})">
                      ${isBlocked ? '✓ Unblock' : '🚫 Block'}
                    </button>
                    <button class="btn btn-sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:0.25rem 0.5rem;" onclick="deleteSubAdmin('${s._id}', '${escapeHtml(s.name)}')" title="Delete sub-admin">🗑️</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${err.message}</p>`;
    } else {
      console.error('Fetch subadmins error:', err);
    }
  } finally {
    container.style.opacity = '1';
  }
}

function openCreateSubAdminModal() {
  try {
    const form = document.getElementById('create-subadmin-form');
    if (form) form.reset();

    const nameInput = document.getElementById('subadm-name');
    if (nameInput) nameInput.value = '';
    const emailInput = document.getElementById('subadm-email');
    if (emailInput) emailInput.value = '';
    const phoneInput = document.getElementById('subadm-phone');
    if (phoneInput) phoneInput.value = '';
    const passInput = document.getElementById('subadm-password');
    if (passInput) passInput.value = '';
    const titleInput = document.getElementById('subadm-title');
    if (titleInput) titleInput.value = 'Operations Sub-Admin';
    const presetSelect = document.getElementById('subadm-preset');
    if (presetSelect) presetSelect.value = 'operations_lead';

    if (typeof applySubAdminPreset === 'function') {
      applySubAdminPreset('operations_lead', 'subadm-perm-');
    }
  } catch (err) {
    console.warn('Error preparing subadmin form:', err);
  }
  openModal('admin-create-subadmin-modal');
}

async function submitCreateSubAdmin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const submitBtn = document.getElementById('btn-create-subadmin-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
  }

  const name = document.getElementById('subadm-name')?.value?.trim() || '';
  const email = document.getElementById('subadm-email')?.value?.trim() || '';
  const phone = document.getElementById('subadm-phone')?.value?.trim() || '';
  const password = document.getElementById('subadm-password')?.value || '';
  const adminRoleTitle = document.getElementById('subadm-title')?.value?.trim() || 'Operations Sub-Admin';

  if (!name) {
    alert('Full name is required.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
    return;
  }

  if (!email && !phone) {
    alert('Please enter either an email address or mobile number.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
    return;
  }

  if (!password || password.length < 8) {
    alert('Password must be at least 8 characters long.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
    return;
  }

  // Collect checked permissions
  const permissions = [];
  if (typeof RBAC_PERMISSIONS_MAP !== 'undefined') {
    Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
      if (document.getElementById(`subadm-perm-${key}`)?.checked) {
        permissions.push(key);
      }
    });
  }

  if (!permissions.length) {
    alert('Please select at least one permission for this sub-admin.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
    return;
  }

  try {
    const res = await apiFetch('/api/admin/subadmins', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password, adminRoleTitle, permissions }),
    });

    alert(res.message || 'Sub-admin created successfully!');
    closeModal('admin-create-subadmin-modal');
    fetchAdminSubAdmins();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Sub-Admin';
    }
  }
}

function openEditSubAdminModal(subAdminId) {
  const subAdmin = currentSubAdminsList.find(s => s._id === subAdminId);
  if (!subAdmin) return;

  document.getElementById('edit-subadm-id').value = subAdmin._id;
  document.getElementById('edit-subadm-name').textContent = subAdmin.name;
  document.getElementById('edit-subadm-email').textContent = subAdmin.email || subAdmin.phone || '';
  document.getElementById('edit-subadm-title').value = subAdmin.adminRoleTitle || 'Operations Sub-Admin';
  document.getElementById('edit-subadm-badge').textContent = subAdmin.adminRoleTitle || 'Sub-Admin';

  const perms = Array.isArray(subAdmin.permissions) ? subAdmin.permissions : [];
  Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
    const cb = document.getElementById(`edit-subadm-perm-${key}`);
    if (cb) cb.checked = perms.includes(key);
  });

  document.getElementById('edit-subadm-preset').value = 'custom';
  openModal('admin-edit-subadmin-modal');
}

async function submitEditSubAdminPermissions(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-edit-subadmin-submit');
  if (submitBtn) submitBtn.disabled = true;

  const id = document.getElementById('edit-subadm-id').value;
  const adminRoleTitle = document.getElementById('edit-subadm-title').value.trim();

  const permissions = [];
  Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
    if (document.getElementById(`edit-subadm-perm-${key}`)?.checked) {
      permissions.push(key);
    }
  });

  try {
    const res = await apiFetch(`/api/admin/subadmins/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ adminRoleTitle, permissions }),
    });

    alert(res.message || 'Permissions updated successfully!');
    closeModal('admin-edit-subadmin-modal');
    fetchAdminSubAdmins();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function toggleSubAdminStatus(subAdminId, currentlyBlocked) {
  const action = currentlyBlocked ? 'unblock' : 'block';
  if (!confirm(`Are you sure you want to ${action} this sub-administrator?`)) return;

  try {
    const res = await apiFetch(`/api/admin/subadmins/${subAdminId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ isBlocked: !currentlyBlocked }),
    });

    alert(res.message || `Sub-admin ${action}ed successfully`);
    fetchAdminSubAdmins();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteSubAdmin(subAdminId, name) {
  if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete sub-administrator "${name}"? This action cannot be undone.`)) return;

  try {
    const res = await apiFetch(`/api/admin/subadmins/${subAdminId}`, {
      method: 'DELETE',
    });

    alert(res.message || 'Sub-admin deleted permanently');
    fetchAdminSubAdmins();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}


// =========================================================================
// ADMIN: ACTIVE PARTNER FLEET LIST MODAL (RESTAURANTS / SHOPS / RIDERS)
// =========================================================================
let adminFleetModalCurrentRole = 'all'; // 'all' | 'restaurant' | 'shop' | 'deliveryPartner'
let adminFleetModalSearchQuery = '';
let adminFleetModalLoading = false;
let adminFleetModalCache = {
  restaurant: [],
  shop: [],
  deliveryPartner: [],
  lastFetched: 0,
};

async function openAdminPartnerFleetModal(initialRole = 'all') {
  adminFleetModalCurrentRole = initialRole || 'all';
  adminFleetModalSearchQuery = '';
  const searchInput = document.getElementById('admin-fleet-search-input');
  if (searchInput) searchInput.value = '';

  updateAdminFleetModalTabs();
  openModal('admin-partner-fleet-modal');

  // Load partners if not loaded or older than 30s
  const now = Date.now();
  if (!adminFleetModalCache.lastFetched || now - adminFleetModalCache.lastFetched > 30000) {
    await fetchAllAdminFleetPartners();
  } else {
    renderAdminPartnerFleetModalContent();
  }
}

async function fetchAllAdminFleetPartners() {
  adminFleetModalLoading = true;
  renderAdminPartnerFleetModalContent();
  try {
    const [restaurantsRes, shopsRes, ridersRes] = await Promise.all([
      apiFetch('/api/admin/users?role=restaurant&all=true'),
      apiFetch('/api/admin/users?role=shop&all=true'),
      apiFetch('/api/admin/users?role=deliveryPartner&all=true'),
    ]);
    adminFleetModalCache.restaurant = restaurantsRes?.users || [];
    adminFleetModalCache.shop = shopsRes?.users || [];
    adminFleetModalCache.deliveryPartner = ridersRes?.users || [];
    adminFleetModalCache.lastFetched = Date.now();
  } catch (err) {
    console.error('Failed to load partner fleet list:', err);
  } finally {
    adminFleetModalLoading = false;
    renderAdminPartnerFleetModalContent();
  }
}

function updateAdminFleetModalTabs() {
  const tabs = ['all', 'restaurant', 'shop', 'deliveryPartner'];
  tabs.forEach((t) => {
    const btn = document.getElementById(`admin-fleet-tab-${t}`);
    if (btn) {
      if (t === adminFleetModalCurrentRole) {
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-outline');
      } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
      }
    }
  });

  const titleSub = document.getElementById('admin-partner-fleet-modal-subtitle');
  if (titleSub) {
    const labels = {
      all: '⚡ Active Partner Fleet (All Partners)',
      restaurant: '🏪 Restaurant Fleet Directory',
      shop: '🏬 Shop Fleet Directory',
      deliveryPartner: '🚴 Delivery Fleet Directory (Riders)',
    };
    titleSub.textContent = labels[adminFleetModalCurrentRole] || '⚡ Active Partner Fleet';
  }
}

function filterAdminFleetModal(role) {
  adminFleetModalCurrentRole = role || 'all';
  updateAdminFleetModalTabs();
  renderAdminPartnerFleetModalContent();
}

function onAdminFleetSearchInput(query) {
  adminFleetModalSearchQuery = (query || '').trim().toLowerCase();
  renderAdminPartnerFleetModalContent();
}

function navigateToPartnerManagement(targetRole, userId = '') {
  closeModal('admin-partner-fleet-modal');
  const viewMap = {
    restaurant: 'admin-restaurants',
    shop: 'admin-shops',
    deliveryPartner: 'admin-riders',
  };
  const targetView = viewMap[targetRole] || 'admin-restaurants';
  switchView(targetView);
  if (userId) {
    setTimeout(() => {
      const searchPrefix = targetRole === 'deliveryPartner' ? 'admin-riders' : targetRole === 'shop' ? 'admin-shops' : 'admin-restaurants';
      const searchInput = document.getElementById(`${searchPrefix}-search`);
      if (searchInput) {
        searchInput.value = userId;
        handleAdminSearchInput(targetRole);
      }
    }, 200);
  }
}

function renderAdminPartnerFleetModalContent() {
  const container = document.getElementById('admin-partner-fleet-modal-content');
  const footerCount = document.getElementById('admin-fleet-modal-footer-count');
  if (!container) return;

  if (adminFleetModalLoading) {
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
        <div style="font-size:1.8rem; margin-bottom:0.5rem; animation:spin 1s linear infinite;">⏳</div>
        <p style="font-size:0.9rem; font-weight:600;">Loading partner fleet members...</p>
      </div>
    `;
    if (footerCount) footerCount.textContent = 'Loading...';
    return;
  }

  let list = [];
  if (adminFleetModalCurrentRole === 'all') {
    list = [
      ...adminFleetModalCache.restaurant.map((u) => ({ ...u, partnerCategory: 'restaurant' })),
      ...adminFleetModalCache.shop.map((u) => ({ ...u, partnerCategory: 'shop' })),
      ...adminFleetModalCache.deliveryPartner.map((u) => ({ ...u, partnerCategory: 'deliveryPartner' })),
    ];
  } else if (adminFleetModalCurrentRole === 'restaurant') {
    list = adminFleetModalCache.restaurant.map((u) => ({ ...u, partnerCategory: 'restaurant' }));
  } else if (adminFleetModalCurrentRole === 'shop') {
    list = adminFleetModalCache.shop.map((u) => ({ ...u, partnerCategory: 'shop' }));
  } else if (adminFleetModalCurrentRole === 'deliveryPartner') {
    list = adminFleetModalCache.deliveryPartner.map((u) => ({ ...u, partnerCategory: 'deliveryPartner' }));
  }

  const q = adminFleetModalSearchQuery;
  const filtered = list.filter((item) => {
    if (!q) return true;
    const name = (item.displayName || item.name || '').toLowerCase();
    const email = (item.email || '').toLowerCase();
    const phone = (item.phone || '').toLowerCase();
    const uid = (item.customUserId || item.userCode || item.code || item.id || item._id || '').toLowerCase();
    const city = (item.address?.city || item.city || '').toLowerCase();
    const pincode = (item.address?.pincode || item.pincode || '').toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q) || uid.includes(q) || city.includes(q) || pincode.includes(q);
  });

  if (footerCount) {
    const restCount = adminFleetModalCache.restaurant.length;
    const shopCount = adminFleetModalCache.shop.length;
    const riderCount = adminFleetModalCache.deliveryPartner.length;
    footerCount.innerHTML = `Showing <strong>${filtered.length}</strong> partners • (Total: ${restCount} Rest, ${shopCount} Shops, ${riderCount} Riders)`;
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted); background:#fcfaf5; border:1px dashed var(--line); border-radius:10px;">
        <div style="font-size:2rem; margin-bottom:0.4rem;">🔍</div>
        <p style="font-size:0.92rem; font-weight:700; color:var(--charcoal); margin-bottom:0.25rem;">No partners found</p>
        <p style="font-size:0.8rem; margin:0;">${q ? `No partners matched your search "${escapeHtml(q)}".` : 'No partners found in this category.'}</p>
      </div>
    `;
    return;
  }

  const rowsHtml = filtered.map((p, idx) => {
    const cat = p.partnerCategory || p.role || 'partner';
    const catBadge = cat === 'restaurant'
      ? '<span class="badge" style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; font-size:0.7rem; font-weight:700;">🏪 Restaurant</span>'
      : cat === 'shop'
      ? '<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #dbeafe; font-size:0.7rem; font-weight:700;">🏬 Shop</span>'
      : '<span class="badge" style="background:#f0fdf4; color:#15803d; border:1px solid #dcfce7; font-size:0.7rem; font-weight:700;">🚴 Rider</span>';

    const displayName = formatCleanName(p.displayName || p.name || 'Partner');
    const partnerId = p.customUserId || p.userCode || p.code || p._id || 'N/A';
    const phone = p.phone || p.phoneNumber || '—';
    const email = p.email || '—';
    const city = p.address?.city || p.city || '';
    const pin = p.address?.pincode || p.pincode || '';
    const locationStr = [city, pin].filter(Boolean).join(', ');

    const isDutyOn = p.isDutyOn ?? p.isOnline ?? true;
    const dutyBadge = isDutyOn
      ? '<span style="font-size:0.72rem; color:#15803d; font-weight:700; background:#dcfce7; padding:0.1rem 0.45rem; border-radius:4px;">● Online / Active</span>'
      : '<span style="font-size:0.72rem; color:#64748b; font-weight:600; background:#f1f5f9; padding:0.1rem 0.45rem; border-radius:4px;">○ Offline</span>';

    const isApproved = p.isApproved !== false;
    const approvalBadge = isApproved
      ? '<span class="badge badge-delivered" style="font-size:0.68rem; padding:0.1rem 0.4rem;">Approved</span>'
      : '<span class="badge badge-pending" style="font-size:0.68rem; padding:0.1rem 0.4rem;">Pending Approval</span>';

    return `
      <div style="background:#fff; border:1px solid var(--line); border-radius:9px; padding:0.75rem 0.95rem; margin-bottom:0.55rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.65rem; transition:box-shadow 0.15s ease;">
        <div style="display:flex; align-items:flex-start; gap:0.65rem; min-width:240px; flex:1;">
          <div style="width:36px; height:36px; border-radius:8px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-size:1.15rem; flex-shrink:0;">
            ${cat === 'restaurant' ? '🏪' : cat === 'shop' ? '🏬' : '🚴'}
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
              <strong style="font-size:0.92rem; color:var(--ink);">${escapeHtml(displayName)}</strong>
              ${catBadge}
              ${approvalBadge}
            </div>
            <div style="font-size:0.77rem; color:var(--muted); margin-top:2px; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <span style="font-family:monospace; font-weight:700; color:var(--charcoal); background:#f8fafc; padding:1px 5px; border-radius:4px; border:1px solid #e2e8f0;">🆔 ${escapeHtml(partnerId)}</span>
              <span>📞 ${escapeHtml(phone)}</span>
              <span>✉️ ${escapeHtml(email)}</span>
            </div>
            ${locationStr ? `<div style="font-size:0.73rem; color:var(--muted); margin-top:2px;">📍 ${escapeHtml(locationStr)}</div>` : ''}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:0.6rem; flex-shrink:0;">
          ${dutyBadge}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            style="font-size:0.75rem; padding:0.25rem 0.6rem; font-weight:600;"
            onclick="navigateToPartnerManagement('${cat}', '${escapeHtml(partnerId)}')"
            title="Open partner in management panel"
          >
            Manage ↗
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex; flex-direction:column;">
      ${rowsHtml}
    </div>
  `;
}

window.openAdminPartnerFleetModal = openAdminPartnerFleetModal;
window.filterAdminFleetModal = filterAdminFleetModal;
window.onAdminFleetSearchInput = onAdminFleetSearchInput;
window.navigateToPartnerManagement = navigateToPartnerManagement;
window.renderAdminPartnerFleetModalContent = renderAdminPartnerFleetModalContent;


// =========================================================================
// ADMIN: RESET USER PASSWORD (DEFAULT: Tomato<DDMMYYYY> OR CUSTOM PASSWORD)
// =========================================================================
function formatDobToDDMMYYYYFrontend(rawDob) {
  if (!rawDob) return "";
  const str = String(rawDob).trim().split("T")[0];
  const isoMatch = str.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}${isoMatch[2]}${isoMatch[1]}`;
  }
  const dmyMatch = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[1]}${dmyMatch[2]}${dmyMatch[3]}`;
  }
  const digits = str.replace(/\D/g, "");
  return digits.length === 8 ? digits : "";
}

function normalizeDobForDateInput(rawDob) {
  if (!rawDob) return "";
  const str = String(rawDob).trim().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmyMatch = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }
  return "";
}

function openAdminResetPasswordModal(userId, userName, targetRole, userDob = "", userContact = "") {
  const idInput = document.getElementById("admin-reset-pwd-user-id");
  const roleInput = document.getElementById("admin-reset-pwd-user-role");
  const summaryEl = document.getElementById("admin-reset-pwd-user-summary");
  const dobInput = document.getElementById("admin-reset-pwd-dob");
  const pwdInput = document.getElementById("admin-reset-pwd-input");
  const hintEl = document.getElementById("admin-reset-pwd-dob-hint");

  if (idInput) idInput.value = userId;
  if (roleInput) roleInput.value = targetRole;

  const roleLabels = {
    shop: "🏬 Shop Partner",
    restaurant: "🏪 Restaurant Partner",
    deliveryPartner: "🚴 Delivery Partner (Rider)",
    customer: "👥 Customer",
    subadmin: "🛡️ Sub-Admin",
    admin: "👑 Admin",
  };
  const roleDisplay = roleLabels[targetRole] || targetRole;
  const normalizedDob = normalizeDobForDateInput(userDob);
  const ddmmyyyy = formatDobToDDMMYYYYFrontend(normalizedDob || userDob);
  const defaultPwd = ddmmyyyy ? `Tomato${ddmmyyyy}` : "";

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
        <div>
          <strong style="font-size:0.96rem; color:var(--ink);">${escapeHtml(userName || "User")}</strong>
          ${userContact ? `<div style="font-size:0.78rem; color:var(--muted);">${escapeHtml(userContact)}</div>` : ""}
        </div>
        <span class="badge badge-approved" style="font-size:0.74rem;">${escapeHtml(roleDisplay)}</span>
      </div>
      <div style="margin-top:0.45rem; font-size:0.78rem; color:var(--charcoal);">
        Saved DOB: <strong>${normalizedDob ? escapeHtml(normalizedDob) + " (" + escapeHtml(ddmmyyyy) + ")" : "Not set yet — select DOB below or enter custom password"}</strong>
      </div>
    `;
  }

  if (dobInput) {
    dobInput.max = new Date().toISOString().split("T")[0];
    dobInput.value = normalizedDob;
  }

  if (pwdInput) {
    pwdInput.value = defaultPwd;
  }

  if (hintEl) {
    hintEl.innerHTML = defaultPwd
      ? `Default password generated from DOB: <strong style="font-family:monospace; color:#15803d;">${escapeHtml(defaultPwd)}</strong> (You can also edit the password below if needed).`
      : `Select the user's DOB above to auto-generate <strong style="font-family:monospace; color:var(--ink);">Tomato&lt;DDMMYYYY&gt;</strong>, or type a custom password directly below.`;
  }

  openModal("admin-reset-password-modal");
}

function onAdminResetPasswordDobChange() {
  const dobInput = document.getElementById("admin-reset-pwd-dob");
  const pwdInput = document.getElementById("admin-reset-pwd-input");
  const hintEl = document.getElementById("admin-reset-pwd-dob-hint");
  const ddmmyyyy = formatDobToDDMMYYYYFrontend(dobInput?.value || "");
  if (ddmmyyyy) {
    const defaultPwd = `Tomato${ddmmyyyy}`;
    if (pwdInput) pwdInput.value = defaultPwd;
    if (hintEl) {
      hintEl.innerHTML = `Default password generated from DOB: <strong style="font-family:monospace; color:#15803d;">${escapeHtml(defaultPwd)}</strong> (You can also edit the password below if needed).`;
    }
  }
}

function fillDefaultDobPasswordInResetModal() {
  const dobInput = document.getElementById("admin-reset-pwd-dob");
  const pwdInput = document.getElementById("admin-reset-pwd-input");
  const ddmmyyyy = formatDobToDDMMYYYYFrontend(dobInput?.value || "");
  if (!ddmmyyyy) {
    alert("Please select the user's DOB from the calendar first to generate Tomato<DDMMYYYY>.");
    dobInput?.focus();
    return;
  }
  if (pwdInput) pwdInput.value = `Tomato${ddmmyyyy}`;
}

async function submitAdminResetPassword(event) {
  event.preventDefault();
  const userId = document.getElementById("admin-reset-pwd-user-id")?.value?.trim();
  const targetRole = document.getElementById("admin-reset-pwd-user-role")?.value?.trim();
  const dob = document.getElementById("admin-reset-pwd-dob")?.value?.trim() || "";
  const newPassword = document.getElementById("admin-reset-pwd-input")?.value?.trim() || "";
  const submitBtn = document.getElementById("admin-reset-pwd-submit-btn");

  if (!userId) return;
  if (!newPassword && !dob) {
    alert("Please select the user's DOB to generate Tomato<DDMMYYYY> or enter a custom password.");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Resetting...";
  }

  try {
    const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ dob, newPassword }),
    });
    closeModal("admin-reset-password-modal");
    alert(`✅ ${res.message || "Password reset successfully!"}\n\nNew Password: ${res.resetPassword || newPassword}`);
    if (targetRole === "subadmin") {
      fetchAdminSubAdmins(true);
    } else {
      refreshAdminViews();
    }
  } catch (err) {
    alert(`Reset Password Error: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "🔑 Reset Password";
    }
  }
}

window.openAdminResetPasswordModal = openAdminResetPasswordModal;
window.onAdminResetPasswordDobChange = onAdminResetPasswordDobChange;
window.fillDefaultDobPasswordInResetModal = fillDefaultDobPasswordInResetModal;
window.submitAdminResetPassword = submitAdminResetPassword;

// Sub-Admin Management & RBAC
window.applySubAdminPreset = applySubAdminPreset;
window.handleAdminSubAdminSearchInput = handleAdminSubAdminSearchInput;
window.clearAdminSubAdminsSearch = clearAdminSubAdminsSearch;
window.fetchAdminSubAdmins = fetchAdminSubAdmins;
window.openCreateSubAdminModal = openCreateSubAdminModal;
window.submitCreateSubAdmin = submitCreateSubAdmin;
window.openEditSubAdminModal = openEditSubAdminModal;
window.submitEditSubAdminPermissions = submitEditSubAdminPermissions;
window.toggleSubAdminStatus = toggleSubAdminStatus;
window.deleteSubAdmin = deleteSubAdmin;

// Partner Fleet Directory
window.fetchAllAdminFleetPartners = fetchAllAdminFleetPartners;
window.updateAdminFleetModalTabs = updateAdminFleetModalTabs;
window.formatDobToDDMMYYYYFrontend = formatDobToDDMMYYYYFrontend;
window.normalizeDobForDateInput = normalizeDobForDateInput;


