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

let currentStaffRoleFilter = 'all'; // 'all' | 'admin' | 'subadmin' | 'employee'

function filterStaffRole(filterRole) {
  currentStaffRoleFilter = filterRole || 'all';
  const tabAll = document.getElementById('staff-filter-all');
  const tabAdmin = document.getElementById('staff-filter-admin');
  const tabSub = document.getElementById('staff-filter-subadmin');
  const tabEmp = document.getElementById('staff-filter-employee');

  [tabAll, tabAdmin, tabSub, tabEmp].forEach(tab => {
    if (tab) {
      tab.className = 'btn btn-outline btn-sm';
      tab.style.background = '';
      tab.style.color = '';
      tab.style.fontWeight = '500';
    }
  });

  const activeTab = filterRole === 'admin' ? tabAdmin : filterRole === 'subadmin' ? tabSub : filterRole === 'employee' ? tabEmp : tabAll;
  if (activeTab) {
    activeTab.className = 'btn btn-sm';
    activeTab.style.background = 'var(--primary)';
    activeTab.style.color = '#fff';
    activeTab.style.fontWeight = '700';
  }

  renderStaffMembersTable();
}

function renderStaffMembersTable() {
  const container = document.getElementById('admin-subadmins-table');
  if (!container) return;

  const q = document.getElementById('admin-subadmins-search')?.value?.trim().toLowerCase() || '';

  let filtered = currentSubAdminsList;
  if (currentStaffRoleFilter !== 'all') {
    if (currentStaffRoleFilter === 'admin') {
      filtered = filtered.filter(s => s.role === 'admin' || s.role === 'superadmin');
    } else {
      filtered = filtered.filter(s => s.role === currentStaffRoleFilter);
    }
  }
  if (q) {
    filtered = filtered.filter(s => {
      const name = String(s.name || '').toLowerCase();
      const username = String(s.username || '').toLowerCase();
      const email = String(s.email || '').toLowerCase();
      const phone = String(s.phone || '').toLowerCase();
      const title = String(s.adminRoleTitle || '').toLowerCase();
      const admId = String(s.adminId || '').toLowerCase();
      const subId = String(s.subadminId || '').toLowerCase();
      const empId = String(s.employeeId || '').toLowerCase();
      const id = String(s._id || s.id || '').toLowerCase();
      const locCity = String(s.assignedLocation?.city || '').toLowerCase();
      const locPincode = String(s.assignedLocation?.postalCode || '').toLowerCase();
      return name.includes(q) || username.includes(q) || email.includes(q) || phone.includes(q) || title.includes(q) || admId.includes(q) || subId.includes(q) || empId.includes(q) || id.includes(q) || locCity.includes(q) || locPincode.includes(q);
    });
  }

  if (!filtered.length) {
    const roleLabel = currentStaffRoleFilter === 'admin' ? 'Platform Admins' : currentStaffRoleFilter === 'subadmin' ? 'Sub-Administrators' : currentStaffRoleFilter === 'employee' ? 'Normal Employees' : 'Staff Members';
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted); background:#faf8f5; border:1px dashed var(--line); border-radius:10px;">
        <span style="font-size:2rem; display:block; margin-bottom:0.5rem;">👥</span>
        <strong style="font-size:1.1rem; color:var(--ink);">${q ? `No ${roleLabel} found matching "${escapeHtml(q)}"` : `No ${roleLabel} Created Yet`}</strong>
        <p style="margin-top:0.4rem; font-size:0.85rem;">Use the action buttons above to add Sub-Admins or Normal Employees.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Staff Member &amp; ID</th>
            <th>Contact &amp; Role</th>
            <th>Monthly Salary</th>
            <th>Operating Location</th>
            <th>Bank &amp; Account</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => {
            const isSuper = s.role === 'superadmin';
            const isAdmin = s.role === 'admin' || isSuper;
            const isEmployee = s.role === 'employee';
            const roleTitle = s.adminRoleTitle || (isSuper ? 'Super Administrator' : s.role === 'admin' ? 'Platform Administrator' : isEmployee ? 'Normal Employee' : 'Sub-Admin');
            const isBlocked = Boolean(s.isBlocked);
            const sId = isEmployee ? (s.employeeId || `emp-${String(s.id || s._id).slice(-4)}`) : isAdmin ? (s.adminId || (isSuper ? 'sup-0001' : `adm-${String(s.id || s._id).slice(-4)}`)) : (s.subadminId || `sub-${String(s.id || s._id).slice(-4)}`);
            const salaryVal = Number(s.salary || 0);

            const bd = s.bankDetails || {};
            const isBankApproved = Boolean(bd.isApproved);
            const hasBank = Boolean(bd.accountNumber);

            let bankBadge = '<span class="badge badge-pending" style="font-size:0.75rem;">⚠️ No Bank Details</span>';
            if (isAdmin && !hasBank) {
              bankBadge = '<span class="badge" style="font-size:0.75rem; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;">Platform Settlement</span>';
            } else if (isBankApproved) {
              bankBadge = '<span class="badge badge-approved" style="font-size:0.75rem; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;">🔒 Approved</span>';
            } else if (hasBank) {
              bankBadge = '<span class="badge badge-ready" style="font-size:0.75rem; background:#fffbeb; color:#b45309; border:1px solid #fde68a;">⏳ Verification Pending</span>';
            }

            let roleBadgeHtml = '';
            if (isSuper) {
              roleBadgeHtml = '<span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-size:0.72rem; font-weight:800;">👑 Super Admin</span>';
            } else if (isAdmin) {
              roleBadgeHtml = '<span class="badge" style="background:#fdf2f8; color:#be185d; border:1px solid #fbcfe8; font-size:0.72rem; font-weight:700;">👑 Admin</span>';
            } else if (isEmployee) {
              roleBadgeHtml = '<span class="badge" style="background:#fefce8; color:#a16207; border:1px solid #fef08a; font-size:0.72rem; font-weight:700;">👔 Employee</span>';
            } else {
              roleBadgeHtml = '<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.72rem; font-weight:700;">🛡️ Sub-Admin</span>';
            }

            const loc = s.assignedLocation || {};
            const hasLocation = Boolean(loc.city && loc.postalCode);
            const locBadge = hasLocation
              ? `<div style="display:inline-flex; align-items:center; gap:0.35rem; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:0.25rem 0.55rem; font-size:0.75rem; color:#1e40af; font-weight:600;" title="${escapeHtml((loc.locality ? loc.locality + ', ' : '') + loc.city + ', ' + (loc.state || '') + ' ' + loc.postalCode)}">
                   <span>📍</span>
                   <span>${escapeHtml(loc.city)}, ${escapeHtml(loc.postalCode)}</span>
                   ${loc.state ? `<span style="color:#64748b; font-weight:normal;">(${escapeHtml(loc.state)})</span>` : ''}
                 </div>`
              : `<div style="display:inline-flex; align-items:center; gap:0.35rem; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:0.25rem 0.55rem; font-size:0.75rem; color:#b91c1c;">
                   <span>⚠️</span>
                   <span>No Location Assigned</span>
                 </div>`;

            const perms = Array.isArray(s.permissions) ? s.permissions : [];
            const permsBadges = isEmployee
              ? `<span class="badge" style="background:#f8fafc; color:#475569; font-size:0.7rem; border:1px solid #e2e8f0;">Department: ${escapeHtml(s.department || 'Operations')}</span>`
              : isSuper
                ? '<span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.7rem; border:1px solid #fde68a;">🌟 Full Super Admin Access</span>'
                : perms.map(pKey => {
                    const meta = RBAC_PERMISSIONS_MAP[pKey] || { label: pKey, icon: '🔑', color: '#475569' };
                    return `<span class="badge" style="background:#f1f5f9; color:${meta.color}; border:1px solid #e2e8f0; font-size:0.7rem; margin:0.1rem 0.15rem 0.1rem 0; display:inline-flex; align-items:center; gap:0.2rem;">${meta.icon} ${meta.label}</span>`;
                  }).join('');

            return `
              <tr id="staff-row-${s._id}" style="${isBlocked ? 'background:#faf9f6; opacity:0.85;' : ''}">
                <td>
                  <div style="font-weight:700; color:var(--ink); font-size:0.95rem;">${escapeHtml(formatCleanName(s.name || s.displayName || 'Staff Member'))}</div>
                  <div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap; margin-top:0.2rem;">
                    ${roleBadgeHtml}
                    <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; font-family:monospace; font-weight:700;">ID: ${escapeHtml(sId)}</span>
                    <span class="badge" style="background:#f8fafc; color:#334155; font-size:0.7rem;">${escapeHtml(roleTitle)}</span>
                  </div>
                </td>
                <td>
                  <div>✉️ ${escapeHtml(s.email || s.username ? (s.email || `@${s.username}`) : 'N/A')}</div>
                  ${s.phone ? `<small style="color:var(--muted);">📞 ${escapeHtml(s.phone)}</small>` : ''}
                  <div style="margin-top:0.25rem; display:flex; flex-wrap:wrap; max-width:240px;">
                    ${permsBadges}
                  </div>
                </td>
                <td>
                  <div style="font-weight:800; color:var(--green); font-size:1.05rem;">₹${salaryVal.toLocaleString('en-IN')}</div>
                  <small style="color:var(--muted);">per month</small>
                </td>
                <td>
                  ${locBadge}
                  ${loc.locality ? `<div style="font-size:0.72rem; color:var(--muted); margin-top:0.2rem;">${escapeHtml(loc.locality)}</div>` : ''}
                </td>
                <td>
                  <div>${bankBadge}</div>
                  ${bd.accountNumber ? `<small style="color:var(--muted); font-family:monospace;">A/C: ${escapeHtml(bd.accountNumber.slice(-4).padStart(bd.accountNumber.length, '•'))} • ${escapeHtml(bd.bankName || '')}</small>` : ''}
                  <div style="margin-top:0.25rem;">
                    <span class="badge ${isBlocked ? 'badge-cancelled' : 'badge-delivered'}" style="font-size:0.72rem;">
                      ${isBlocked ? 'Restricted' : 'Active'}
                    </span>
                  </div>
                </td>
                <td style="text-align:right; white-space:nowrap;">
                  <button type="button" class="btn btn-outline btn-sm" style="background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:600; padding:0.25rem 0.55rem;" onclick="openAssignAdminLocationModal('${s._id || s.id}')" title="Assign default operating location">📍 Location</button>
                  <button type="button" class="btn btn-sm" style="background:#7c3aed; color:#fff; border:1px solid #7c3aed; font-weight:600; padding:0.25rem 0.55rem;" onclick="openSalaryReleaseModal('${s._id}')" title="Disburse salary">💸 Salary</button>
                  ${!isEmployee && !isAdmin ? `<button class="btn btn-outline btn-sm" onclick="openEditSubAdminModal('${s._id}')" title="Configure permissions">⚙️ Perms</button>` : ''}
                  <button type="button" class="btn btn-outline btn-sm" style="background:#fff7ed; border-color:#fdba74; color:#c2410c; font-weight:600; padding:0.25rem 0.55rem;" onclick="openAdminResetPasswordModal('${s._id}', '${escapeHtml(formatCleanName(s.name || s.displayName || 'Staff Member'))}', '${s.role}', '${escapeHtml(s.dob || '')}', '${escapeHtml(s.email || s.phone || s.username || '')}')" title="Reset password">🔑 Password</button>
                  ${!isAdmin ? `
                    <button class="btn btn-outline btn-sm" style="${isBlocked ? 'color:var(--green); border-color:var(--green);' : 'color:var(--tomato); border-color:var(--tomato);'} padding:0.25rem 0.5rem;" onclick="toggleSubAdminStatus('${s._id}', ${isBlocked})">
                      ${isBlocked ? '✓' : '🚫'}
                    </button>
                    <button class="btn btn-sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:0.25rem 0.5rem;" onclick="deleteSubAdmin('${s._id}', '${escapeHtml(s.name)}')" title="Delete staff member">🗑️</button>
                  ` : ''}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
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
    container.innerHTML = renderTableSkeleton('sub-administrators & employees');
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
    const totalStaff = subadmins.length;
    const subAdminCount = subadmins.filter(s => s.role === 'subadmin').length;
    const employeeCount = subadmins.filter(s => s.role === 'employee').length;
    const activeCount = subadmins.filter(s => !s.isBlocked).length;
    const blockedCount = subadmins.filter(s => s.isBlocked).length;
    const totalSalary = subadmins.reduce((sum, s) => sum + (Number(s.salary) || 0), 0);
    const approvedBankCount = subadmins.filter(s => s.bankDetails?.isApproved).length;

    if (statsContainer) {
      statsContainer.innerHTML = `
        <div class="stat-card"><span class="stat-label">Total Staff</span><div class="stat-value">${totalStaff}</div><span class="stat-note">${subAdminCount} Sub-Admins • ${employeeCount} Employees</span></div>
        <div class="stat-card"><span class="stat-label">Active Team</span><div class="stat-value" style="color:var(--green);">${activeCount}</div><span class="stat-note">${blockedCount} blocked</span></div>
        <div class="stat-card"><span class="stat-label">Monthly Payroll</span><div class="stat-value" style="color:#7c3aed;">₹${totalSalary.toLocaleString('en-IN')}</div><span class="stat-note">Base commitment / mo</span></div>
        <div class="stat-card"><span class="stat-label">Bank Verified</span><div class="stat-value" style="color:var(--green);">${approvedBankCount} / ${totalStaff}</div><span class="stat-note">Approved for payouts</span></div>
      `;
    }

    renderStaffMembersTable();
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

  const salary = Number(document.getElementById('subadm-salary')?.value || 0);
  const dob = (document.getElementById('subadm-dob')?.value || '').trim();

  try {
    const res = await apiFetch('/api/admin/subadmins', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password, adminRoleTitle, permissions, salary, dob }),
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
// NORMAL EMPLOYEES & SALARY DISBURSEMENT (PAYROLL)
// =========================================================================

function openCreateEmployeeModal() {
  const form = document.getElementById('create-employee-form');
  if (form) form.reset();
  const title = document.getElementById('emp-title');
  if (title) title.value = 'Operations Associate';
  const salary = document.getElementById('emp-salary');
  if (salary) salary.value = '25000';
  openModal('admin-create-employee-modal');
}

async function submitCreateEmployee(e) {
  if (e && e.preventDefault) e.preventDefault();
  const submitBtn = document.getElementById('btn-create-employee-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
  }

  const name = document.getElementById('emp-name')?.value?.trim() || '';
  const adminRoleTitle = document.getElementById('emp-title')?.value?.trim() || 'Operations Associate';
  const email = document.getElementById('emp-email')?.value?.trim() || '';
  const phone = document.getElementById('emp-phone')?.value?.trim() || '';
  const salary = Number(document.getElementById('emp-salary')?.value || 0);
  const dob = document.getElementById('emp-dob')?.value?.trim() || '';
  const password = document.getElementById('emp-password')?.value || '';

  if (!name) {
    alert('Full name is required.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Employee'; }
    return;
  }
  if (!email && !phone) {
    alert('Please enter either an email address or mobile number.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Employee'; }
    return;
  }
  if (!password || password.length < 8) {
    alert('Password must be at least 8 characters long.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Employee'; }
    return;
  }

  try {
    const res = await apiFetch('/api/admin/employees', {
      method: 'POST',
      body: JSON.stringify({ name, adminRoleTitle, email, phone, salary, dob, password }),
    });

    alert(res.message || 'Employee created successfully!');
    closeModal('admin-create-employee-modal');
    fetchAdminSubAdmins(true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Employee';
    }
  }
}

function openSalaryReleaseModal(preselectedStaffId = null) {
  const select = document.getElementById('salary-target-select');
  if (select) {
    select.innerHTML = '<option value="all">👥 All Active Staff (All Sub-Admins &amp; Employees)</option>';
    currentSubAdminsList.filter(s => !s.isBlocked).forEach(s => {
      const isEmp = s.role === 'employee';
      const roleText = isEmp ? 'Employee' : 'Sub-Admin';
      const opt = document.createElement('option');
      opt.value = s._id;
      opt.textContent = `${s.name} (${roleText} • Base: ₹${Number(s.salary || 0).toLocaleString('en-IN')}/mo)`;
      select.appendChild(opt);
    });

    if (preselectedStaffId) {
      select.value = preselectedStaffId;
    } else {
      select.value = 'all';
    }
  }

  const monthInput = document.getElementById('salary-month-input');
  if (monthInput) {
    const now = new Date();
    monthInput.value = now.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  }

  handleSalaryTargetChange(select ? select.value : 'all');
  openModal('admin-salary-release-modal');
}

function handleSalaryTargetChange(targetVal) {
  const amtGroup = document.getElementById('salary-amount-group');
  const amtInput = document.getElementById('salary-amount-input');
  const countEl = document.getElementById('salary-preview-count');
  const totalEl = document.getElementById('salary-preview-total');

  if (targetVal === 'all') {
    if (amtGroup) amtGroup.style.display = 'none';
    const activeStaff = currentSubAdminsList.filter(s => !s.isBlocked);
    const totalPayroll = activeStaff.reduce((sum, s) => sum + (Number(s.salary) || 0), 0);
    if (countEl) countEl.textContent = `${activeStaff.length} active staff members`;
    if (totalEl) totalEl.textContent = `₹${totalPayroll.toLocaleString('en-IN')}`;
  } else {
    if (amtGroup) amtGroup.style.display = 'block';
    const staff = currentSubAdminsList.find(s => String(s._id) === String(targetVal));
    const baseSalary = Number(staff?.salary || 0);
    if (amtInput) amtInput.value = baseSalary;
    if (countEl) countEl.textContent = `1 staff member (${staff?.name || 'Selected'})`;
    if (totalEl) totalEl.textContent = `₹${baseSalary.toLocaleString('en-IN')}`;
  }
}

async function submitSalaryRelease(e) {
  if (e && e.preventDefault) e.preventDefault();
  const submitBtn = document.getElementById('btn-submit-salary-release');
  const targetVal = document.getElementById('salary-target-select')?.value || 'all';
  const month = document.getElementById('salary-month-input')?.value?.trim() || '';
  const customAmt = document.getElementById('salary-amount-input')?.value;
  const note = document.getElementById('salary-notes-input')?.value?.trim() || '';

  if (!month) {
    alert('Please specify the salary month / period.');
    return;
  }

  const isAll = targetVal === 'all';
  const payload = {
    all: isAll,
    staffId: isAll ? undefined : targetVal,
    month,
    note,
    amount: (!isAll && customAmt) ? Number(customAmt) : undefined,
  };

  const confirmMsg = isAll
    ? `Are you sure you want to release monthly salaries for ALL active staff for "${month}" from Central Treasury?`
    : `Are you sure you want to release salary for this staff member for "${month}"?`;

  if (!confirm(confirmMsg)) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Disbursing Funds...';
  }

  try {
    const res = await apiFetch('/api/admin/payroll/release', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const reportMsg = `✅ ${res.message || 'Salaries disbursed successfully!'}\n\n` +
      `Staff Paid: ${res.disbursedCount || 0}\n` +
      `Total Disbursed: ₹${Number(res.totalDisbursed || 0).toLocaleString('en-IN')}\n` +
      `Treasury Reference: ${res.month || month}`;

    alert(reportMsg);
    closeModal('admin-salary-release-modal');
    fetchAdminSubAdmins(true);
    if (typeof loadProfileSettings === 'function') {
      loadProfileSettings();
    }
  } catch (err) {
    alert(`Salary Release Error: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '💸 Disburse Salary';
    }
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

// Employee Management & Payroll
window.filterStaffRole = filterStaffRole;
window.renderStaffMembersTable = renderStaffMembersTable;
window.openCreateEmployeeModal = openCreateEmployeeModal;
window.submitCreateEmployee = submitCreateEmployee;
window.openSalaryReleaseModal = openSalaryReleaseModal;
window.handleSalaryTargetChange = handleSalaryTargetChange;
window.submitSalaryRelease = submitSalaryRelease;

// =========================================================================
// SUPER ADMIN & ADMIN: LOCATION ASSIGNMENT MODAL & LOGIC
// =========================================================================

function openAssignAdminLocationModal(adminId) {
  let staff = currentSubAdminsList.find(s => String(s._id || s.id) === String(adminId));
  if (!staff && typeof currentControlPanelData !== "undefined" && currentControlPanelData?.admins) {
    staff = currentControlPanelData.admins.find(s => String(s._id || s.id) === String(adminId));
  }
  if (!staff) {
    alert("Admin / Staff member not found in current directory.");
    return;
  }

  const idInput = document.getElementById("assign-loc-admin-id");
  const summaryEl = document.getElementById("assign-loc-admin-summary");
  const cityInput = document.getElementById("assign-loc-city");
  const pincodeInput = document.getElementById("assign-loc-pincode");
  const stateInput = document.getElementById("assign-loc-state");
  const localityInput = document.getElementById("assign-loc-locality");
  const line1Input = document.getElementById("assign-loc-line1");

  if (idInput) idInput.value = String(staff._id || staff.id);

  const loc = staff.assignedLocation || {};
  const currentCity = loc.city || "Bengaluru";
  const currentPincode = loc.postalCode || "560001";
  const currentState = loc.state || "Karnataka";
  const currentLocality = loc.locality || "Central HQ";
  const currentLine1 = loc.line1 || "Tomato Operations Headquarters";

  if (cityInput) cityInput.value = currentCity;
  if (pincodeInput) pincodeInput.value = currentPincode;
  if (stateInput) stateInput.value = currentState;
  if (localityInput) localityInput.value = currentLocality;
  if (line1Input) line1Input.value = currentLine1;

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <strong style="font-size:1rem; color:var(--ink);">${escapeHtml(formatCleanName(staff.name || 'Staff Member'))}</strong>
          <span class="badge" style="margin-left:0.4rem; background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(staff.adminRoleTitle || staff.role)}</span>
          <div style="font-size:0.78rem; color:var(--muted); margin-top:0.2rem;">Email: ${escapeHtml(staff.email || (staff.username ? '@' + staff.username : 'N/A'))} • ID: ${escapeHtml(staff.adminId || staff.subadminId || staff.employeeId || staff._id)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.75rem; color:var(--muted);">Current Active Location</div>
          <strong style="color:#0284c7; font-size:0.88rem;">📍 ${escapeHtml(currentCity)}, ${escapeHtml(currentPincode)}</strong>
        </div>
      </div>
    `;
  }

  openModal("assign-admin-location-modal");
}

function applyLocationPreset(city, postalCode, state, locality, line1) {
  const cityInput = document.getElementById("assign-loc-city");
  const pincodeInput = document.getElementById("assign-loc-pincode");
  const stateInput = document.getElementById("assign-loc-state");
  const localityInput = document.getElementById("assign-loc-locality");
  const line1Input = document.getElementById("assign-loc-line1");

  if (cityInput) cityInput.value = city || "";
  if (pincodeInput) pincodeInput.value = postalCode || "";
  if (stateInput) stateInput.value = state || "";
  if (localityInput) localityInput.value = locality || "";
  if (line1Input) line1Input.value = line1 || "";
}

async function submitAssignAdminLocation(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const idInput = document.getElementById("assign-loc-admin-id");
  const cityInput = document.getElementById("assign-loc-city");
  const pincodeInput = document.getElementById("assign-loc-pincode");
  const stateInput = document.getElementById("assign-loc-state");
  const localityInput = document.getElementById("assign-loc-locality");
  const line1Input = document.getElementById("assign-loc-line1");
  const submitBtn = document.getElementById("assign-loc-submit-btn");

  const targetId = idInput?.value?.trim();
  const city = cityInput?.value?.trim();
  const postalCode = pincodeInput?.value?.trim();
  const state = stateInput?.value?.trim() || "Karnataka";
  const locality = localityInput?.value?.trim() || city;
  const line1 = line1Input?.value?.trim() || `${locality}, ${city}`;

  if (!targetId) {
    alert("Target admin ID is missing.");
    return;
  }
  if (!city) {
    alert("Please enter the operating city.");
    return;
  }
  if (!postalCode || !/^\d{5,6}$/.test(postalCode)) {
    alert("Please enter a valid 5 or 6 digit pincode.");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Assigning Location...";
  }

  try {
    const res = await apiFetch(`/api/admin/admins/${encodeURIComponent(targetId)}/location`, {
      method: "PUT",
      body: JSON.stringify({ city, postalCode, state, locality, line1 }),
    });

    closeModal("assign-admin-location-modal");

    // Update in memory directory
    const idx = currentSubAdminsList.findIndex(s => String(s._id || s.id) === String(targetId));
    if (idx !== -1 && res.assignedLocation) {
      currentSubAdminsList[idx].assignedLocation = res.assignedLocation;
      renderStaffMembersTable();
    }

    // If current logged-in user is this target admin, immediately refresh location badge!
    if (user && (String(user._id || user.id) === String(targetId) || user.email === currentSubAdminsList[idx]?.email || user.username === currentSubAdminsList[idx]?.username)) {
      if (typeof fetchUserLocation === "function") {
        await fetchUserLocation({
          city,
          postalCode,
          state,
          locality,
          line1,
        });
      }
    }

    if (typeof showToastNotification === "function") {
      showToastNotification({
        title: "📍 Location Assigned",
        message: res.message || `Location "${city}, ${postalCode}" assigned successfully!`,
        type: "success",
        duration: 4000,
      });
    } else {
      alert(`✅ ${res.message || `Location "${city}, ${postalCode}" assigned successfully!`}`);
    }

    fetchAdminSubAdmins(true);
    if (typeof loadAdminControlPanel === "function") {
      loadAdminControlPanel(true);
    }
  } catch (err) {
    console.error("Assign admin location failed:", err);
    alert(`Failed to assign location: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "📍 Assign & Save Location";
    }
  }
}

window.openAssignAdminLocationModal = openAssignAdminLocationModal;
window.applyLocationPreset = applyLocationPreset;
window.submitAssignAdminLocation = submitAssignAdminLocation;



