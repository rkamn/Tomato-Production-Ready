// =========================================================================
// CONTROL PANEL MODULE: REGIONAL ADDRESS ASSIGNMENTS & ROLE GOVERNANCE
// Accessible by: Admin (Read-Only) and Super Admin (Read, Edit & Role Governance)
// =========================================================================

let currentControlPanelData = {
  isSuperAdmin: false,
  currentUserRole: 'admin',
  currentUserId: '',
  myLocation: null,
  admins: [],
  roles: [],
  supportContact: {
    priorityEmail: 'lightbits.infotech@gmail.com',
    helpline: '9523654737',
    updatedAt: null,
    updatedBy: 'System Default',
  },
};
let controlPanelActiveTab = 'addresses'; // 'addresses' | 'roles' | 'employees' | 'support'
let controlPanelSearchFilter = '';
let controlPanelRoleFilter = 'all'; // 'all' | 'admin' | 'subadmin' | 'employee'
let controlPanelRolesTabFilter = 'all'; // 'all' | 'custom' | 'system'
let controlPanelRolesSearch = '';
let controlPanelEmpStatusFilter = 'all'; // 'all' | 'pending' | 'approved' | 'rejected'
let controlPanelEmpSearch = '';

const CONTROL_PANEL_PERMS_MAP = {
  dashboard_view: { label: 'Analytics Dashboard', icon: '📊', color: '#0284c7' },
  orders_manage: { label: 'Orders & Dispatch', icon: '📦', color: '#d94b35' },
  shops_manage: { label: 'Grocery Shops', icon: '🏬', color: '#059669' },
  restaurants_manage: { label: 'Restaurants & Menus', icon: '🏪', color: '#16a34a' },
  riders_manage: { label: 'Riders Fleet', icon: '🚴', color: '#ea580c' },
  customers_manage: { label: 'Customers Management', icon: '👥', color: '#9333ea' },
  subadmins_manage: { label: 'Sub-Admins & Staff', icon: '🛡️', color: '#475569' },
  finance_manage: { label: 'Finance & Ledger', icon: '💰', color: '#b45309' },
  salary_manage: { label: 'Salary Disbursements', icon: '💸', color: '#7c3aed' },
  bank_manage: { label: 'Bank Approvals', icon: '🏦', color: '#0369a1' },
  coupons_manage: { label: 'Coupons & Deals', icon: '🎟️', color: '#db2777' },
  support_manage: { label: 'Support & Helpdesk', icon: '🛟', color: '#0891b2' },
};

/**
 * Fetch Control Panel data from server
 */
async function loadAdminControlPanel(force = false) {
  const container = document.getElementById('admin-control-panel-container');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center; padding:3rem 1rem; color:var(--muted);">
      <div style="font-size:2rem; animation:pulse 1s infinite;">🎛️</div>
      <p style="margin-top:0.6rem; font-weight:600;">Loading Control Panel Data...</p>
    </div>
  `;

  try {
    const res = await apiFetch('/api/admin/control-panel');
    if (res && res.success) {
      currentControlPanelData = {
        isSuperAdmin: Boolean(res.isSuperAdmin),
        currentUserRole: res.currentUserRole || 'admin',
        currentUserId: res.currentUserId || '',
        myLocation: res.myLocation || null,
        admins: Array.isArray(res.admins) ? res.admins : [],
        roles: Array.isArray(res.roles) ? res.roles : [],
        supportContact: res.supportContact || {
          priorityEmail: 'lightbits.infotech@gmail.com',
          helpline: '9523654737',
          updatedBy: 'System Default',
        },
      };
      renderAdminControlPanelView();
    } else {
      container.innerHTML = `
        <div style="text-align:center; padding:2.5rem; color:#b91c1c;">
          <p>⚠️ Unable to load control panel. Please check your administrative privileges.</p>
          <button type="button" class="btn btn-outline btn-sm" onclick="loadAdminControlPanel(true)">↻ Retry</button>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to load control panel:', err);
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem; color:#b91c1c;">
        <p>⚠️ Error loading control panel: ${escapeHtml(err.message || 'Unknown error')}</p>
        <button type="button" class="btn btn-outline btn-sm" onclick="loadAdminControlPanel(true)">↻ Retry</button>
      </div>
    `;
  }
}

/**
 * Toggle Control Panel Tab
 */
function setControlPanelTab(tab) {
  controlPanelActiveTab = tab === 'roles' ? 'roles' : tab === 'support' ? 'support' : tab === 'employees' ? 'employees' : 'addresses';
  renderAdminControlPanelView();
}

/**
 * Render the Control Panel HTML View
 */
function renderAdminControlPanelView() {
  const container = document.getElementById('admin-control-panel-container');
  if (!container) return;

  const isSuper = currentControlPanelData.isSuperAdmin || (typeof role !== 'undefined' && role === 'superadmin');
  const myLoc = currentControlPanelData.myLocation || {};
  const myCity = myLoc.city || 'Bengaluru';
  const myPincode = myLoc.postalCode || '560001';
  const myState = myLoc.state || 'Karnataka';
  const myLocality = myLoc.locality || 'Central HQ';
  const myLine1 = myLoc.line1 || 'Tomato Regional Headquarters';
  const myAssignedBy = myLoc.assignedBy || 'System Init';
  const myAssignedAt = myLoc.assignedAt ? new Date(myLoc.assignedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  // Stats calculation
  const totalSuperAdmins = currentControlPanelData.admins.filter(a => a.role === 'superadmin').length;
  const totalPlatformAdmins = currentControlPanelData.admins.filter(a => a.role === 'admin' || a.baseRole === 'admin').length;
  const totalSubAdmins = currentControlPanelData.admins.filter(a => a.role === 'subadmin' || a.baseRole === 'subadmin').length;
  const totalEmployees = currentControlPanelData.admins.filter(a => a.role === 'employee' || a.baseRole === 'employee').length;
  const totalWithAssignedLocation = currentControlPanelData.admins.filter(a => a.assignedLocation?.city && a.assignedLocation?.postalCode).length;

  const totalRoles = currentControlPanelData.roles.length;
  const customRolesCount = currentControlPanelData.roles.filter(r => !r.isSystem).length;
  const pendingEmployeesCount = currentControlPanelData.admins.filter(a =>
    (a.role === 'employee' || a.baseRole === 'employee' || a.approvalStatus === 'pending') &&
    a.approvalStatus !== 'rejected' &&
    (a.isApproved === false || a.approvalStatus === 'pending')
  ).length;

  container.innerHTML = `
    <!-- Top Summary Banner: Current Caller's Assigned Location -->
    <div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius:14px; padding:1.5rem 1.75rem; color:#fff; margin-bottom:1.5rem; box-shadow:0 10px 25px rgba(15,23,42,0.18); position:relative; overflow:hidden;">
      <div style="position:absolute; right:-20px; top:-20px; font-size:6rem; opacity:0.07; user-select:none; pointer-events:none;">📍</div>
      
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:1rem; position:relative; z-index:1;">
        <div>
          <div style="display:inline-flex; align-items:center; gap:0.4rem; background:rgba(255,255,255,0.12); padding:0.25rem 0.65rem; border-radius:999px; font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#93c5fd; margin-bottom:0.6rem;">
            <span>${isSuper ? '👑 Super Admin Control Center' : '🏢 Platform Administrator Dashboard'}</span>
          </div>
          <h3 style="font-size:1.35rem; font-weight:800; margin:0 0 0.4rem; color:#fff; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span>My Assigned Operating Location</span>
            <span class="badge" style="background:#22c55e; color:#fff; font-size:0.75rem; padding:0.2rem 0.6rem; border-radius:999px;">✓ Active on Dashboard</span>
          </h3>
          <p style="font-size:0.86rem; color:#cbd5e1; margin:0 0 0.85rem; max-width:650px;">
            ${isSuper
              ? 'As Super Administrator, you assign default operating locations, govern system permissions, and create custom administrative roles with supreme platform authority.'
              : 'This operating location is assigned to your administrator account by the Super Administrator and determines your dashboard header regional badge.'
            }
          </p>
          
          <div style="display:flex; flex-wrap:wrap; gap:0.75rem; align-items:center;">
            <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:0.5rem 0.85rem;">
              <span style="font-size:0.72rem; color:#94a3b8; display:block; text-transform:uppercase; font-weight:600;">Operating City &amp; Pincode</span>
              <strong style="font-size:1.05rem; color:#38bdf8;">📍 ${escapeHtml(myCity)}, ${escapeHtml(myPincode)}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:0.5rem 0.85rem;">
              <span style="font-size:0.72rem; color:#94a3b8; display:block; text-transform:uppercase; font-weight:600;">State &amp; Locality</span>
              <span style="font-size:0.92rem; color:#f8fafc; font-weight:600;">${escapeHtml(myLocality)}, ${escapeHtml(myState)}</span>
            </div>
            <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:0.5rem 0.85rem;">
              <span style="font-size:0.72rem; color:#94a3b8; display:block; text-transform:uppercase; font-weight:600;">Assignment Details</span>
              <span style="font-size:0.82rem; color:#e2e8f0;">Assigned by: <strong>${escapeHtml(myAssignedBy)}</strong> ${myAssignedAt ? `• ${escapeHtml(myAssignedAt)}` : ''}</span>
            </div>
          </div>
        </div>

        <div style="text-align:right;">
          <div style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:0.85rem 1.1rem; text-align:center;">
            <span style="font-size:0.75rem; color:#94a3b8; text-transform:uppercase; font-weight:700; letter-spacing:0.05em;">Authority Level</span>
            <div style="margin-top:0.3rem;">
              ${isSuper
                ? '<span style="font-size:0.95rem; font-weight:800; color:#fde047; display:inline-flex; align-items:center; gap:0.3rem;">👑 Super Admin (Supreme Authority)</span>'
                : '<span style="font-size:0.95rem; font-weight:800; color:#67e8f9; display:inline-flex; align-items:center; gap:0.3rem;">🛡️ Administrator (View Only)</span>'
              }
            </div>
            <div style="font-size:0.75rem; color:#cbd5e1; margin-top:0.35rem;">
              ${isSuper ? 'Can assign addresses, configure support, create roles' : 'Can create employees and assign roles'}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Navigation Tabs: Addresses vs Role Governance vs Support Channels -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:1.25rem; border-bottom:2px solid var(--line); padding-bottom:0.75rem;">
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button
          type="button"
          class="btn btn-sm ${controlPanelActiveTab === 'addresses' ? 'btn-primary' : 'btn-outline'}"
          style="display:inline-flex; align-items:center; gap:0.4rem; font-weight:700;"
          onclick="setControlPanelTab('addresses')"
        >
          <span>📍 Operating Addresses</span>
          <span class="badge" style="background:${controlPanelActiveTab === 'addresses' ? 'rgba(255,255,255,0.25)' : 'var(--line)'}; color:${controlPanelActiveTab === 'addresses' ? '#fff' : 'var(--ink)'}; font-size:0.7rem; border-radius:999px;">${currentControlPanelData.admins.length}</span>
        </button>

        <button
          type="button"
          class="btn btn-sm ${controlPanelActiveTab === 'roles' ? 'btn-primary' : 'btn-outline'}"
          style="display:inline-flex; align-items:center; gap:0.4rem; font-weight:700; ${controlPanelActiveTab === 'roles' ? 'background:#7c3aed; border-color:#7c3aed;' : ''}"
          onclick="setControlPanelTab('roles')"
        >
          <span>🎭 Platform Roles &amp; Governance</span>
          <span class="badge" style="background:${controlPanelActiveTab === 'roles' ? 'rgba(255,255,255,0.25)' : '#ede9fe'}; color:${controlPanelActiveTab === 'roles' ? '#fff' : '#6d28d9'}; font-size:0.7rem; border-radius:999px;">${totalRoles}</span>
        </button>

        <button
          type="button"
          class="btn btn-sm ${controlPanelActiveTab === 'employees' ? 'btn-primary' : 'btn-outline'}"
          style="display:inline-flex; align-items:center; gap:0.4rem; font-weight:700; ${controlPanelActiveTab === 'employees' ? 'background:#059669; border-color:#059669; color:#fff;' : ''}"
          onclick="setControlPanelTab('employees')"
        >
          <span>👥 Employee Approvals</span>
          ${pendingEmployeesCount > 0
            ? `<span class="badge" style="background:#ef4444; color:#fff; font-size:0.7rem; border-radius:999px; padding:0.15rem 0.5rem;">${pendingEmployeesCount} Pending</span>`
            : `<span class="badge" style="background:${controlPanelActiveTab === 'employees' ? 'rgba(255,255,255,0.25)' : '#dcfce7'}; color:${controlPanelActiveTab === 'employees' ? '#fff' : '#15803d'}; font-size:0.7rem; border-radius:999px;">${totalEmployees}</span>`
          }
        </button>

        <button
          type="button"
          class="btn btn-sm ${controlPanelActiveTab === 'support' ? 'btn-primary' : 'btn-outline'}"
          style="display:inline-flex; align-items:center; gap:0.4rem; font-weight:700; ${controlPanelActiveTab === 'support' ? 'background:#0891b2; border-color:#0891b2; color:#fff;' : ''}"
          onclick="setControlPanelTab('support')"
        >
          <span>🛟 Help &amp; Support Channels</span>
          <span class="badge" style="background:${controlPanelActiveTab === 'support' ? 'rgba(255,255,255,0.25)' : '#e0f2fe'}; color:${controlPanelActiveTab === 'support' ? '#fff' : '#0369a1'}; font-size:0.7rem; border-radius:999px;">Live Config</span>
        </button>
      </div>

      <div style="display:flex; align-items:center; gap:0.5rem;">
        ${isSuper && controlPanelActiveTab === 'roles' ? `
          <button
            type="button"
            class="btn btn-sm btn-primary"
            style="background:#7c3aed; border-color:#7c3aed; display:inline-flex; align-items:center; gap:0.35rem; font-weight:700;"
            onclick="openControlPanelCreateRoleModal()"
          >
            <span>➕ Create New Role</span>
          </button>
        ` : ''}
        <button type="button" class="btn btn-outline btn-sm" onclick="loadAdminControlPanel(true)">↻ Refresh</button>
      </div>
    </div>

    <!-- Active Tab Body -->
    ${controlPanelActiveTab === 'addresses'
      ? renderAddressesTabHtml(isSuper, totalSuperAdmins, totalPlatformAdmins, totalSubAdmins, totalEmployees, totalWithAssignedLocation)
      : controlPanelActiveTab === 'roles'
      ? renderRolesTabHtml(isSuper, totalRoles, customRolesCount)
      : controlPanelActiveTab === 'employees'
      ? renderEmployeeApprovalsTabHtml(isSuper)
      : renderSupportTabHtml(isSuper)
    }
  `;
}

/**
 * Render Addresses Tab (Regional Directory)
 */
function renderAddressesTabHtml(isSuper, totalSuperAdmins, totalPlatformAdmins, totalSubAdmins, totalEmployees, totalWithAssignedLocation) {
  // Filter admins list
  let filtered = currentControlPanelData.admins;
  if (controlPanelRoleFilter !== 'all') {
    if (controlPanelRoleFilter === 'superadmin') {
      filtered = filtered.filter(a => a.role === 'superadmin');
    } else if (controlPanelRoleFilter === 'admin') {
      filtered = filtered.filter(a => a.role === 'admin' || a.role === 'superadmin' || a.baseRole === 'admin');
    } else {
      filtered = filtered.filter(a => a.role === controlPanelRoleFilter || a.baseRole === controlPanelRoleFilter);
    }
  }

  if (controlPanelSearchFilter) {
    const q = controlPanelSearchFilter.toLowerCase();
    filtered = filtered.filter(a => {
      const name = String(a.name || '').toLowerCase();
      const uname = String(a.username || '').toLowerCase();
      const email = String(a.email || '').toLowerCase();
      const title = String(a.adminRoleTitle || '').toLowerCase();
      const city = String(a.assignedLocation?.city || '').toLowerCase();
      const pincode = String(a.assignedLocation?.postalCode || '').toLowerCase();
      const admId = String(a.adminId || a.subadminId || a.employeeId || a.id || '').toLowerCase();
      return name.includes(q) || uname.includes(q) || email.includes(q) || title.includes(q) || city.includes(q) || pincode.includes(q) || admId.includes(q);
    });
  }

  return `
    <!-- Quick Stats Cards (Interactive Filters) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
      <div
        class="stat-card clickable"
        onclick="setControlPanelRoleFilter('superadmin')"
        style="background:${controlPanelRoleFilter === 'superadmin' ? '#fef3c7' : '#fff'}; border:2px solid ${controlPanelRoleFilter === 'superadmin' ? '#b45309' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease;"
        title="Filter Super Administrator"
      >
        <span class="stat-label">Super Admin</span>
        <div class="stat-value" style="color:#b45309;">${totalSuperAdmins}</div>
        <span class="stat-note" style="color:${controlPanelRoleFilter === 'superadmin' ? '#b45309' : ''}; font-weight:${controlPanelRoleFilter === 'superadmin' ? '700' : 'normal'};">Supreme Authority ${controlPanelRoleFilter === 'superadmin' ? '● Active' : '↗'}</span>
      </div>

      <div
        class="stat-card clickable"
        onclick="setControlPanelRoleFilter('admin')"
        style="background:${controlPanelRoleFilter === 'admin' ? '#fdf2f8' : '#fff'}; border:2px solid ${controlPanelRoleFilter === 'admin' ? '#d94b35' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease;"
        title="Filter Platform Administrators"
      >
        <span class="stat-label">Platform Admins</span>
        <div class="stat-value" style="color:#d94b35;">${totalPlatformAdmins}</div>
        <span class="stat-note" style="color:${controlPanelRoleFilter === 'admin' ? '#d94b35' : ''}; font-weight:${controlPanelRoleFilter === 'admin' ? '700' : 'normal'};">Authority Level ${controlPanelRoleFilter === 'admin' ? '● Active' : '↗'}</span>
      </div>

      <div
        class="stat-card clickable"
        onclick="setControlPanelRoleFilter('subadmin')"
        style="background:${controlPanelRoleFilter === 'subadmin' ? '#f0f9ff' : '#fff'}; border:2px solid ${controlPanelRoleFilter === 'subadmin' ? '#0284c7' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease;"
        title="Filter Operations Sub-Admins"
      >
        <span class="stat-label">Sub-Admins</span>
        <div class="stat-value" style="color:#0284c7;">${totalSubAdmins}</div>
        <span class="stat-note" style="color:${controlPanelRoleFilter === 'subadmin' ? '#0284c7' : ''}; font-weight:${controlPanelRoleFilter === 'subadmin' ? '700' : 'normal'};">Operations Staff ${controlPanelRoleFilter === 'subadmin' ? '● Active' : '↗'}</span>
      </div>

      <div
        class="stat-card clickable"
        onclick="setControlPanelRoleFilter('employee')"
        style="background:${controlPanelRoleFilter === 'employee' ? '#fefce8' : '#fff'}; border:2px solid ${controlPanelRoleFilter === 'employee' ? '#a16207' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease;"
        title="Filter Normal Employees"
      >
        <span class="stat-label">Normal Employees</span>
        <div class="stat-value" style="color:#a16207;">${totalEmployees}</div>
        <span class="stat-note" style="color:${controlPanelRoleFilter === 'employee' ? '#a16207' : ''}; font-weight:${controlPanelRoleFilter === 'employee' ? '700' : 'normal'};">Staff Members ${controlPanelRoleFilter === 'employee' ? '● Active' : '↗'}</span>
      </div>

      <div
        class="stat-card clickable"
        onclick="setControlPanelRoleFilter('all')"
        style="background:${controlPanelRoleFilter === 'all' ? '#f0fdf4' : '#fff'}; border:2px solid ${controlPanelRoleFilter === 'all' ? '#16a34a' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease;"
        title="Show all regional deployments"
      >
        <span class="stat-label">Regional Deployments</span>
        <div class="stat-value" style="color:#16a34a;">${totalWithAssignedLocation}</div>
        <span class="stat-note" style="color:${controlPanelRoleFilter === 'all' ? '#16a34a' : ''}; font-weight:${controlPanelRoleFilter === 'all' ? '700' : 'normal'};">Locations Active ${controlPanelRoleFilter === 'all' ? '● Active' : '↗'}</span>
      </div>
    </div>

    <!-- Toolbar: Search & Role Filters -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem;">
      <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${controlPanelRoleFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setControlPanelRoleFilter('all')">All Staff (${currentControlPanelData.admins.length})</button>
        <button type="button" class="btn btn-sm ${controlPanelRoleFilter === 'superadmin' ? 'btn-primary' : 'btn-outline'}" onclick="setControlPanelRoleFilter('superadmin')">👑 Super Admin (${totalSuperAdmins})</button>
        <button type="button" class="btn btn-sm ${controlPanelRoleFilter === 'admin' ? 'btn-primary' : 'btn-outline'}" onclick="setControlPanelRoleFilter('admin')">👑 Platform Admins (${totalPlatformAdmins})</button>
        <button type="button" class="btn btn-sm ${controlPanelRoleFilter === 'subadmin' ? 'btn-primary' : 'btn-outline'}" onclick="setControlPanelRoleFilter('subadmin')">🛡️ Sub-Admins (${totalSubAdmins})</button>
        <button type="button" class="btn btn-sm ${controlPanelRoleFilter === 'employee' ? 'btn-primary' : 'btn-outline'}" onclick="setControlPanelRoleFilter('employee')">👔 Normal Employees (${totalEmployees})</button>
      </div>

      <div style="display:inline-flex; align-items:center; gap:0.35rem; background:#fff; border:1px solid var(--line); border-radius:8px; padding:0.25rem 0.6rem; min-width:240px;">
        <span style="font-size:0.85rem;">🔍</span>
        <input
          type="text"
          id="control-panel-search-input"
          placeholder="Search by name, city, pincode, ID..."
          value="${escapeHtml(controlPanelSearchFilter)}"
          style="border:none; outline:none; background:transparent; font-size:0.82rem; width:100%;"
          oninput="handleControlPanelSearchInput(this.value)"
        />
        ${controlPanelSearchFilter ? `<button type="button" style="border:none; background:none; cursor:pointer; color:var(--muted);" onclick="clearControlPanelSearch()">✕</button>` : ''}
      </div>
    </div>

    <!-- Administrators & Regional Deployments Table -->
    <div class="table-wrapper" style="background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden;">
      <table>
        <thead>
          <tr style="background:#f8fafc;">
            <th>Administrator &amp; Identity</th>
            <th>Role &amp; Designation</th>
            <th>Assigned Operating Location</th>
            <th>Assigned By &amp; Date</th>
            <th style="text-align:right;">Control Actions</th>
          </tr>
        </thead>
        <tbody>
          ${!filtered.length ? `
            <tr>
              <td colspan="5" style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
                <div style="font-size:1.8rem; margin-bottom:0.4rem;">👥</div>
                <strong>No administrators or staff found matching "${escapeHtml(controlPanelSearchFilter || controlPanelRoleFilter)}"</strong>
              </td>
            </tr>
          ` : filtered.map(a => {
            const isTargetSuper = a.role === 'superadmin';
            const isTargetAdmin = a.role === 'admin' || isTargetSuper || a.baseRole === 'admin';
            const isTargetEmployee = a.role === 'employee' || a.baseRole === 'employee';
            const isMe = String(a._id || a.id) === String(currentControlPanelData.currentUserId) || a.email === (typeof user !== 'undefined' && user?.email) || ((typeof user !== 'undefined' && user?.username) && a.username === user.username);
            
            const loc = a.assignedLocation || {};
            const hasLoc = Boolean(loc.city && loc.postalCode);
            const aId = a.adminId || a.subadminId || a.employeeId || `usr-${String(a._id || a.id).slice(-4)}`;

            let roleBadge = '';
            if (isTargetSuper) {
              roleBadge = '<span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:800; font-size:0.72rem;">👑 Super Admin</span>';
            } else if (isTargetAdmin) {
              roleBadge = '<span class="badge" style="background:#fdf2f8; color:#be185d; border:1px solid #fbcfe8; font-weight:700; font-size:0.72rem;">👑 Platform Admin</span>';
            } else if (isTargetEmployee) {
              roleBadge = '<span class="badge" style="background:#fefce8; color:#a16207; border:1px solid #fef08a; font-weight:700; font-size:0.72rem;">👔 Employee</span>';
            } else {
              roleBadge = '<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.72rem;">🛡️ Sub-Admin</span>';
            }

            return `
              <tr id="cp-admin-row-${a._id || a.id}" style="${isMe ? 'background:#f0fdf4;' : ''}">
                <td>
                  <div style="display:flex; align-items:center; gap:0.45rem;">
                    <strong style="color:var(--ink); font-size:0.95rem;">${escapeHtml(formatCleanName(a.name || 'Admin Member'))}</strong>
                    ${isMe ? '<span class="badge" style="background:#15803d; color:#fff; font-size:0.68rem; font-weight:700; border-radius:999px;">YOU</span>' : ''}
                  </div>
                  <div style="font-size:0.78rem; color:var(--muted); margin-top:0.2rem;">
                    <span>✉️ ${escapeHtml(a.email || (a.username ? '@' + a.username : 'N/A'))}</span>
                    ${a.phone ? ` • <span>📞 ${escapeHtml(a.phone)}</span>` : ''}
                  </div>
                  <div style="margin-top:0.3rem; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                    ${roleBadge}
                    <span class="badge" style="background:#f1f5f9; color:#475569; font-family:monospace; font-size:0.7rem; font-weight:700;">ID: ${escapeHtml(aId)}</span>
                    ${a.isBlocked
                      ? '<span class="badge" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-size:0.68rem; font-weight:700;">🚫 Blocked</span>'
                      : '<span class="badge" style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; font-size:0.68rem; font-weight:700;">✓ Active</span>'}
                  </div>
                </td>
                <td>
                  <div style="font-weight:700; color:var(--ink); font-size:0.88rem;">${escapeHtml(a.adminRoleTitle || (isTargetAdmin ? 'Platform Administrator' : a.role))}</div>
                  <small style="color:var(--muted); text-transform:capitalize;">${escapeHtml(a.role)} Account</small>
                </td>
                <td>
                  ${hasLoc ? `
                    <div style="display:inline-flex; align-items:center; gap:0.35rem; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:0.25rem 0.55rem; font-size:0.78rem; color:#1e40af; font-weight:700;">
                      <span>📍</span>
                      <span>${escapeHtml(loc.city)}, ${escapeHtml(loc.postalCode)}</span>
                    </div>
                    <div style="font-size:0.74rem; color:#475569; margin-top:0.25rem;">
                      ${escapeHtml(loc.locality || loc.city)}${loc.state ? `, ${escapeHtml(loc.state)}` : ''}
                    </div>
                  ` : `
                    <div style="display:inline-flex; align-items:center; gap:0.35rem; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:0.25rem 0.55rem; font-size:0.75rem; color:#b91c1c;">
                      <span>⚠️</span>
                      <span>No Location Assigned</span>
                    </div>
                  `}
                </td>
                <td>
                  <div style="font-size:0.8rem; color:var(--ink); font-weight:600;">
                    ${escapeHtml(loc.assignedBy || 'System Init')}
                  </div>
                  <small style="color:var(--muted); font-size:0.73rem;">
                    ${loc.assignedAt ? new Date(loc.assignedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Initial Seed'}
                  </small>
                </td>
                <td style="text-align:right; white-space:nowrap;">
                  <div style="display:inline-flex; align-items:center; justify-content:flex-end; gap:0.35rem;">
                    ${isTargetSuper && !isSuper ? `
                      <span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:700; font-size:0.75rem;">👑 Supreme Authority</span>
                    ` : ''}
                    ${isSuper ? `
                      <button
                        type="button"
                        class="btn btn-outline btn-sm"
                        style="background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:700; padding:0.25rem 0.6rem;"
                        onclick="openControlPanelLocationModal('${a._id || a.id}')"
                        title="Assign or edit operating location for ${escapeHtml(a.name)}"
                      >
                        📍 Edit Address
                      </button>
                    ` : ''}
                    ${(!isTargetSuper && (isSuper || (typeof role !== 'undefined' && role === 'admin'))) ? `
                      <button
                        type="button"
                        class="btn btn-outline btn-sm"
                        style="background:#fdf4ff; border-color:#f0abfc; color:#a21caf; font-weight:700; padding:0.25rem 0.6rem;"
                        onclick="openControlPanelChangeRoleModal('${a._id || a.id}')"
                        title="Assign role or designation for ${escapeHtml(a.name)}"
                      >
                        🛡️ Assign Role
                      </button>
                      ${(!isTargetAdmin && !isMe) ? `
                        <button
                          type="button"
                          class="btn btn-outline btn-sm"
                          style="${a.isBlocked ? 'background:#ecfdf5; border-color:#6ee7b7; color:#065f46;' : 'background:#fff1f2; border-color:#fecdd3; color:#e11d48;'} font-weight:700; padding:0.25rem 0.55rem;"
                          onclick="toggleStaffStatusFromControlPanel('${a._id || a.id}', ${Boolean(a.isBlocked)}, '${escapeHtml(a.name || 'Staff Member')}', '${escapeHtml(a.role || 'employee')}')"
                          title="${a.isBlocked ? 'Unblock / Enable ' : 'Block / Disable '}${escapeHtml(a.name)}"
                        >
                          ${a.isBlocked ? '✓ Enable' : '🚫 Disable'}
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm"
                          style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-weight:700; padding:0.25rem 0.55rem;"
                          onclick="deleteStaffFromControlPanel('${a._id || a.id}', '${escapeHtml(a.name || 'Staff Member')}', '${escapeHtml(a.role || 'employee')}')"
                          title="Delete ${escapeHtml(a.name)}"
                        >
                          🗑️
                        </button>
                      ` : ''}
                    ` : (isTargetSuper ? `
                      <span
                        class="badge"
                        style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-size:0.75rem; padding:0.25rem 0.6rem; display:inline-flex; align-items:center; gap:0.3rem;"
                        title="Super Administrator role is protected."
                      >
                        <span>👑</span>
                        <span>Super Admin</span>
                      </span>
                    ` : `
                      <span
                        class="badge"
                        style="background:#f1f5f9; color:#64748b; font-size:0.75rem; border:1px solid #cbd5e1; padding:0.25rem 0.6rem; display:inline-flex; align-items:center; gap:0.3rem;"
                        title="View Only"
                      >
                        <span>🔒</span>
                        <span>View Only</span>
                      </span>
                    `)}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render Roles Tab (Role Governance & Custom Roles)
 */
function renderRolesTabHtml(isSuper, totalRoles, customRolesCount) {
  const roles = currentControlPanelData.roles || [];
  const systemRolesCount = totalRoles - customRolesCount;
  const totalStaffCount = currentControlPanelData.admins.length;

  // Filter roles
  let filteredRoles = roles;
  if (controlPanelRolesTabFilter === 'custom') {
    filteredRoles = filteredRoles.filter(r => !r.isSystem);
  } else if (controlPanelRolesTabFilter === 'system') {
    filteredRoles = filteredRoles.filter(r => Boolean(r.isSystem));
  }

  if (controlPanelRolesSearch) {
    const q = controlPanelRolesSearch.toLowerCase().trim();
    filteredRoles = filteredRoles.filter(r =>
      String(r.displayName || '').toLowerCase().includes(q) ||
      String(r.roleKey || '').toLowerCase().includes(q) ||
      String(r.description || '').toLowerCase().includes(q) ||
      String(r.baseRole || '').toLowerCase().includes(q)
    );
  }

  const isAllActive = controlPanelRolesTabFilter === 'all';
  const isCustomActive = controlPanelRolesTabFilter === 'custom';
  const isSystemActive = controlPanelRolesTabFilter === 'system';

  return `
    <!-- Roles Overview Cards (Interactive Filters) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.25rem;">
      <!-- Card 1: Configured in System -->
      <div
        class="stat-card clickable"
        onclick="setControlPanelRolesTabFilter('all')"
        style="background:${isAllActive ? '#fdf4ff' : '#fff'}; border:2px solid ${isAllActive ? '#7c3aed' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease; box-shadow:${isAllActive ? '0 4px 14px rgba(124, 58, 237, 0.15)' : 'none'}; position:relative;"
        title="Click to view all platform roles configured in system"
      >
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="stat-label" style="font-weight:700;">Total Platform Roles</span>
          ${isAllActive ? '<span class="badge" style="background:#7c3aed; color:#fff; font-size:0.65rem; padding:0.1rem 0.4rem; border-radius:999px;">ACTIVE</span>' : ''}
        </div>
        <div class="stat-value" style="color:#7c3aed;">${totalRoles}</div>
        <span class="stat-note" style="color:${isAllActive ? '#6d28d9' : 'var(--muted)'}; font-weight:${isAllActive ? '700' : '600'};">Configured in System ${isAllActive ? '●' : '↗'}</span>
      </div>

      <!-- Card 2: Created by Super Admin -->
      <div
        class="stat-card clickable"
        onclick="setControlPanelRolesTabFilter('custom')"
        style="background:${isCustomActive ? '#f0f9ff' : '#fff'}; border:2px solid ${isCustomActive ? '#0284c7' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease; box-shadow:${isCustomActive ? '0 4px 14px rgba(2, 132, 199, 0.15)' : 'none'}; position:relative;"
        title="Click to filter custom roles created by Super Admin"
      >
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="stat-label" style="font-weight:700;">Custom Roles</span>
          ${isCustomActive ? '<span class="badge" style="background:#0284c7; color:#fff; font-size:0.65rem; padding:0.1rem 0.4rem; border-radius:999px;">ACTIVE</span>' : ''}
        </div>
        <div class="stat-value" style="color:#0284c7;">${customRolesCount}</div>
        <span class="stat-note" style="color:${isCustomActive ? '#0369a1' : 'var(--muted)'}; font-weight:${isCustomActive ? '700' : '600'};">Created by Super Admin ${isCustomActive ? '●' : '↗'}</span>
      </div>

      <!-- Card 3: Core Protected Tiers -->
      <div
        class="stat-card clickable"
        onclick="setControlPanelRolesTabFilter('system')"
        style="background:${isSystemActive ? '#fffbeb' : '#fff'}; border:2px solid ${isSystemActive ? '#b45309' : 'var(--line)'}; border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease; box-shadow:${isSystemActive ? '0 4px 14px rgba(180, 83, 9, 0.15)' : 'none'}; position:relative;"
        title="Click to filter core built-in system default roles"
      >
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="stat-label" style="font-weight:700;">System Default Roles</span>
          ${isSystemActive ? '<span class="badge" style="background:#b45309; color:#fff; font-size:0.65rem; padding:0.1rem 0.4rem; border-radius:999px;">ACTIVE</span>' : ''}
        </div>
        <div class="stat-value" style="color:#b45309;">${systemRolesCount}</div>
        <span class="stat-note" style="color:${isSystemActive ? '#92400e' : 'var(--muted)'}; font-weight:${isSystemActive ? '700' : '600'};">Core Protected Tiers ${isSystemActive ? '●' : '↗'}</span>
      </div>

      <!-- Card 4: Across All Roles -->
      <div
        class="stat-card clickable"
        onclick="switchControlPanelToStaffDirectory()"
        style="background:#fff; border:2px solid var(--line); border-radius:10px; padding:1rem; cursor:pointer; transition:all 0.15s ease;"
        title="Click to view all active platform staff directory across all roles"
      >
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="stat-label" style="font-weight:700;">Total Active Staff</span>
          <span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.65rem; padding:0.1rem 0.4rem; border-radius:999px;">DIRECTORY</span>
        </div>
        <div class="stat-value" style="color:#16a34a;">${totalStaffCount}</div>
        <span class="stat-note" style="color:#15803d; font-weight:700;">Across All Roles ↗</span>
      </div>
    </div>

    <!-- Interactive Filter Toolbar -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem;">
      <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
        <button
          type="button"
          class="btn btn-sm ${isAllActive ? 'btn-primary' : 'btn-outline'}"
          style="${isAllActive ? 'background:#7c3aed; border-color:#7c3aed;' : ''}; font-weight:700;"
          onclick="setControlPanelRolesTabFilter('all')"
        >
          Configured in System (${totalRoles})
        </button>

        <button
          type="button"
          class="btn btn-sm ${isCustomActive ? 'btn-primary' : 'btn-outline'}"
          style="${isCustomActive ? 'background:#0284c7; border-color:#0284c7;' : ''}; font-weight:700;"
          onclick="setControlPanelRolesTabFilter('custom')"
        >
          Created by Super Admin (${customRolesCount})
        </button>

        <button
          type="button"
          class="btn btn-sm ${isSystemActive ? 'btn-primary' : 'btn-outline'}"
          style="${isSystemActive ? 'background:#b45309; border-color:#b45309;' : ''}; font-weight:700;"
          onclick="setControlPanelRolesTabFilter('system')"
        >
          Core Protected Tiers (${systemRolesCount})
        </button>

        <button
          type="button"
          class="btn btn-sm btn-outline"
          style="color:#15803d; border-color:#86efac; font-weight:700; background:#f0fdf4;"
          onclick="switchControlPanelToStaffDirectory()"
        >
          Across All Roles (${totalStaffCount} Staff) ↗
        </button>
      </div>

      <div style="display:inline-flex; align-items:center; gap:0.35rem; background:#fff; border:1px solid var(--line); border-radius:8px; padding:0.25rem 0.6rem; min-width:240px;">
        <span style="font-size:0.85rem;">🔍</span>
        <input
          type="text"
          id="control-panel-roles-search-input"
          placeholder="Search by role name, key, permissions..."
          value="${escapeHtml(controlPanelRolesSearch)}"
          style="border:none; outline:none; background:transparent; font-size:0.82rem; width:100%;"
          oninput="handleControlPanelRolesSearch(this.value)"
        />
        ${controlPanelRolesSearch ? `<button type="button" style="border:none; background:none; cursor:pointer; color:var(--muted);" onclick="clearControlPanelRolesSearch()">✕</button>` : ''}
      </div>
    </div>

    <!-- Roles Table Header / Banner -->
    <div style="background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden;">
      <div style="padding:1rem 1.25rem; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; background:#f8fafc;">
        <div>
          <h4 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--ink); display:flex; align-items:center; gap:0.4rem;">
            <span>🎭 Platform Roles &amp; Permission Matrix</span>
            <span class="badge" style="font-size:0.72rem; background:${isCustomActive ? '#e0f2fe' : isSystemActive ? '#fef3c7' : '#ede9fe'}; color:${isCustomActive ? '#0369a1' : isSystemActive ? '#92400e' : '#6d28d9'}; font-weight:700;">
              ${isCustomActive ? 'Custom Roles (Super Admin Created)' : isSystemActive ? 'Core Protected Tiers' : 'All Roles Configured'} • ${filteredRoles.length} Visible
            </span>
          </h4>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--muted);">
            ${isSuper
              ? 'You have root authority to create new roles, customize module access rights, and assign them to staff members.'
              : 'Directory of all active platform roles and their assigned access permissions (View Only).'
            }
          </p>
        </div>

        ${(isSuper || (typeof role !== 'undefined' && role === 'admin')) ? `
          <button
            type="button"
            class="btn btn-sm btn-primary"
            style="background:#0284c7; border-color:#0284c7; font-weight:700; display:inline-flex; align-items:center; gap:0.35rem;"
            onclick="openCreateEmployeeModal()"
            title="Create a new normal employee account"
          >
            <span>➕ Create Employee</span>
          </button>
        ` : ''}
      </div>

      <div class="table-wrapper">
        <table>
          <thead>
            <tr style="background:#f1f5f9;">
              <th>Role &amp; Identifier</th>
              <th>Base Clearance Tier</th>
              <th>Description &amp; Mandate</th>
              <th>Assigned Permissions</th>
              <th style="text-align:center;">Assigned Staff</th>
              <th style="text-align:right;">Governance Actions</th>
            </tr>
          </thead>
          <tbody>
            ${!filteredRoles.length ? `
              <tr>
                <td colspan="6" style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
                  <div style="font-size:1.8rem; margin-bottom:0.4rem;">🎭</div>
                  <strong>No roles found matching "${escapeHtml(controlPanelRolesSearch || (isCustomActive ? 'Created by Super Admin' : isSystemActive ? 'Core Protected Tiers' : 'Configured in System'))}"</strong>
                  ${isCustomActive && isSuper ? `
                    <div style="margin-top:0.6rem;">
                      <button type="button" class="btn btn-sm btn-primary" onclick="openControlPanelCreateRoleModal()" style="background:#7c3aed; border-color:#7c3aed;">
                        ➕ Create First Custom Role
                      </button>
                    </div>
                  ` : ''}
                  <div style="margin-top:0.6rem;">
                    <button type="button" class="btn btn-outline btn-sm" onclick="setControlPanelRolesTabFilter('all'); clearControlPanelRolesSearch();">↺ Reset Filter</button>
                  </div>
                </td>
              </tr>
            ` : filteredRoles.map(r => {
              const isSys = Boolean(r.isSystem);
              const perms = Array.isArray(r.permissions) ? r.permissions : [];
              const hasWildcard = perms.includes('*');

              let baseBadge = '';
              if (r.baseRole === 'superadmin') {
                baseBadge = '<span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:800;">👑 Super Admin</span>';
              } else if (r.baseRole === 'admin') {
                baseBadge = '<span class="badge" style="background:#fdf2f8; color:#be185d; border:1px solid #fbcfe8; font-weight:700;">👑 Platform Admin</span>';
              } else if (r.baseRole === 'employee') {
                baseBadge = '<span class="badge" style="background:#fefce8; color:#a16207; border:1px solid #fef08a; font-weight:700;">👔 Employee</span>';
              } else {
                baseBadge = '<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">🛡️ Sub-Admin</span>';
              }

              return `
                <tr id="cp-role-row-${r._id || r.id}">
                  <td>
                    <div style="display:flex; align-items:center; gap:0.4rem;">
                      <strong style="color:var(--ink); font-size:0.95rem;">${escapeHtml(r.displayName)}</strong>
                      ${isSys
                        ? '<span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.68rem; border:1px solid #cbd5e1;">SYSTEM</span>'
                        : '<span class="badge" style="background:#f3e8ff; color:#7e22ce; font-size:0.68rem; border:1px solid #d8b4fe; font-weight:700;">CUSTOM</span>'
                      }
                    </div>
                    <div style="font-family:monospace; font-size:0.75rem; color:var(--muted); margin-top:0.2rem;">
                      <code>${escapeHtml(r.roleKey)}</code>
                    </div>
                  </td>
                  <td>
                    ${baseBadge}
                  </td>
                  <td style="max-width:280px;">
                    <div style="font-size:0.8rem; color:#475569; line-height:1.35;">
                      ${escapeHtml(r.description || 'Custom administrative role.')}
                    </div>
                  </td>
                  <td style="max-width:320px;">
                    <div style="display:flex; flex-wrap:wrap; gap:0.25rem;">
                      ${hasWildcard
                        ? '<span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.7rem; font-weight:700; border:1px solid #fde68a;">🌟 Full Platform Clearance (*)</span>'
                        : perms.length === 0
                          ? '<span style="color:var(--muted); font-size:0.75rem;">None</span>'
                          : perms.slice(0, 4).map(pKey => {
                              const meta = CONTROL_PANEL_PERMS_MAP[pKey] || { label: pKey, icon: '🔑', color: '#475569' };
                              return `<span class="badge" style="background:#f1f5f9; color:${meta.color}; font-size:0.68rem; border:1px solid #e2e8f0; display:inline-flex; align-items:center; gap:0.2rem;">${meta.icon} ${meta.label}</span>`;
                            }).join('') + (perms.length > 4 ? `<span class="badge" style="background:#f8fafc; color:#64748b; font-size:0.68rem;">+${perms.length - 4} more</span>` : '')
                      }
                    </div>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge" style="background:${(r.assignedCount || 0) > 0 ? '#dcfce7' : '#f1f5f9'}; color:${(r.assignedCount || 0) > 0 ? '#15803d' : '#64748b'}; font-weight:700; font-size:0.8rem; padding:0.2rem 0.55rem; border-radius:999px;">
                      ${r.assignedCount || 0} Staff
                    </span>
                  </td>
                  <td style="text-align:right; white-space:nowrap;">
                    ${isSuper ? `
                      ${!isSys ? `
                        <button
                          type="button"
                          class="btn btn-outline btn-sm"
                          style="background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:700; padding:0.2rem 0.55rem;"
                          onclick="openControlPanelEditRoleModal('${r._id || r.id}')"
                          title="Edit role metadata and permissions"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          class="btn btn-outline btn-sm"
                          style="background:#fef2f2; border-color:#fca5a5; color:#dc2626; font-weight:700; padding:0.2rem 0.55rem; margin-left:0.3rem;"
                          onclick="deleteControlPanelRole('${r._id || r.id}', '${escapeHtml(r.roleKey)}', '${escapeHtml(r.displayName)}')"
                          title="Delete custom role"
                        >
                          🗑️
                        </button>
                      ` : `
                        <span class="badge" style="background:#f8fafc; color:#64748b; font-size:0.72rem; border:1px solid #e2e8f0; padding:0.25rem 0.55rem;">
                          🔒 Built-in System Role
                        </span>
                      `}
                    ` : `
                      <span class="badge" style="background:#f1f5f9; color:#64748b; font-size:0.72rem; border:1px solid #cbd5e1; padding:0.25rem 0.55rem;">
                        🔒 View Only
                      </span>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Populate permissions checkboxes into a container
 */
function populateRolePermsCheckboxes(containerId, activePerms = [], prefix = 'cp-create') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const permsKeys = Object.keys(CONTROL_PANEL_PERMS_MAP);
  container.innerHTML = permsKeys.map(k => {
    const meta = CONTROL_PANEL_PERMS_MAP[k];
    const isChecked = activePerms.includes('*') || activePerms.includes(k);
    return `
      <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.8rem; cursor:pointer; background:#fff; border:1px solid var(--line); border-radius:6px; padding:0.35rem 0.5rem; user-select:none;">
        <input
          type="checkbox"
          id="${prefix}-perm-${k}"
          value="${k}"
          ${isChecked ? 'checked' : ''}
          style="accent-color:#7c3aed; cursor:pointer;"
        />
        <span>${meta.icon}</span>
        <span style="color:var(--ink); font-weight:600;">${escapeHtml(meta.label)}</span>
      </label>
    `;
  }).join('');
}

/**
 * Select All / Clear All Role Permissions
 */
function setAllRolePermissions(selectAll, prefix) {
  const permsKeys = Object.keys(CONTROL_PANEL_PERMS_MAP);
  permsKeys.forEach(k => {
    const cb = document.getElementById(`${prefix}-perm-${k}`);
    if (cb) cb.checked = Boolean(selectAll);
  });
}

/**
 * Handle Display Name input to generate roleKey slug
 */
function handleRoleDisplayNameInput(nameVal) {
  const keyInput = document.getElementById('cp-create-role-key');
  if (!keyInput) return;

  const slug = String(nameVal || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 35);

  keyInput.value = slug;
}

/**
 * Handle Base Clearance selection change
 */
function handleRoleBaseChange(baseVal, prefix) {
  if (baseVal === 'admin') {
    setAllRolePermissions(true, `cp-${prefix}`);
  } else if (baseVal === 'employee') {
    const permsKeys = Object.keys(CONTROL_PANEL_PERMS_MAP);
    permsKeys.forEach(k => {
      const cb = document.getElementById(`cp-${prefix}-perm-${k}`);
      if (cb) cb.checked = (k === 'orders_manage' || k === 'support_manage');
    });
  } else {
    // subadmin defaults
    const permsKeys = Object.keys(CONTROL_PANEL_PERMS_MAP);
    permsKeys.forEach(k => {
      const cb = document.getElementById(`cp-${prefix}-perm-${k}`);
      if (cb) cb.checked = ['dashboard_view', 'orders_manage', 'shops_manage', 'restaurants_manage', 'riders_manage', 'customers_manage'].includes(k);
    });
  }
}

/**
 * Super Admin: Open Create Role Modal
 */
function openControlPanelCreateRoleModal() {
  const nameInput = document.getElementById('cp-create-role-display-name');
  const keyInput = document.getElementById('cp-create-role-key');
  const baseSelect = document.getElementById('cp-create-role-base');
  const descInput = document.getElementById('cp-create-role-description');

  if (nameInput) nameInput.value = '';
  if (keyInput) keyInput.value = '';
  if (baseSelect) baseSelect.value = 'subadmin';
  if (descInput) descInput.value = '';

  populateRolePermsCheckboxes('cp-create-role-perms-container', ['dashboard_view', 'orders_manage', 'shops_manage', 'restaurants_manage', 'riders_manage', 'customers_manage'], 'cp-create');

  openModal('control-panel-create-role-modal');
}

/**
 * Super Admin: Submit Create Role
 */
async function submitControlPanelCreateRole(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const nameInput = document.getElementById('cp-create-role-display-name');
  const keyInput = document.getElementById('cp-create-role-key');
  const baseSelect = document.getElementById('cp-create-role-base');
  const descInput = document.getElementById('cp-create-role-description');
  const submitBtn = document.getElementById('cp-create-role-submit-btn');

  const displayName = nameInput?.value?.trim();
  const roleKey = keyInput?.value?.trim().toLowerCase();
  const baseRole = baseSelect?.value?.trim() || 'subadmin';
  const description = descInput?.value?.trim();

  if (!displayName || !roleKey) {
    alert('Please enter a role display name and key.');
    return;
  }

  // Collect checked permissions
  const permissions = [];
  Object.keys(CONTROL_PANEL_PERMS_MAP).forEach(k => {
    const cb = document.getElementById(`cp-create-perm-${k}`);
    if (cb && cb.checked) {
      permissions.push(k);
    }
  });

  if (!permissions.length && baseRole !== 'admin') {
    alert('Please select at least one permission module for this role.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Role...';
  }

  try {
    const res = await apiFetch('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({
        displayName,
        roleKey,
        baseRole,
        description,
        permissions: baseRole === 'admin' ? ['*'] : permissions,
      }),
    });

    closeModal('control-panel-create-role-modal');

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: '🎭 New Role Created',
        message: res.message || `Custom role "${displayName}" created successfully!`,
        type: 'success',
        duration: 4000,
      });
    } else {
      alert(`✅ ${res.message || 'Custom role created successfully!'}`);
    }

    // Refresh control panel
    loadAdminControlPanel(true);
  } catch (err) {
    console.error('Failed to create role:', err);
    alert(`Failed to create role: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '➕ Create Platform Role';
    }
  }
}

/**
 * Super Admin: Open Edit Role Modal
 */
function openControlPanelEditRoleModal(roleId) {
  const role = currentControlPanelData.roles.find(r => String(r._id || r.id) === String(roleId) || r.roleKey === String(roleId));
  if (!role) {
    alert('Role not found.');
    return;
  }

  if (role.isSystem) {
    alert('Built-in system roles cannot be modified.');
    return;
  }

  const idInput = document.getElementById('cp-edit-role-id');
  const banner = document.getElementById('cp-edit-role-banner');
  const nameInput = document.getElementById('cp-edit-role-display-name');
  const keyInput = document.getElementById('cp-edit-role-key');
  const baseSelect = document.getElementById('cp-edit-role-base');
  const descInput = document.getElementById('cp-edit-role-description');

  if (idInput) idInput.value = String(role._id || role.id);
  if (nameInput) nameInput.value = role.displayName || '';
  if (keyInput) keyInput.value = role.roleKey || '';
  if (baseSelect) baseSelect.value = role.baseRole || 'subadmin';
  if (descInput) descInput.value = role.description || '';

  if (banner) {
    banner.innerHTML = `
      <strong>Editing Custom Role:</strong> <code>${escapeHtml(role.roleKey)}</code> • Currently assigned to <strong>${role.assignedCount || 0}</strong> staff member(s).
    `;
  }

  populateRolePermsCheckboxes('cp-edit-role-perms-container', role.permissions || [], 'cp-edit');

  openModal('control-panel-edit-role-modal');
}

/**
 * Super Admin: Submit Edit Role
 */
async function submitControlPanelEditRole(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const idInput = document.getElementById('cp-edit-role-id');
  const nameInput = document.getElementById('cp-edit-role-display-name');
  const baseSelect = document.getElementById('cp-edit-role-base');
  const descInput = document.getElementById('cp-edit-role-description');
  const submitBtn = document.getElementById('cp-edit-role-submit-btn');

  const roleId = idInput?.value?.trim();
  const displayName = nameInput?.value?.trim();
  const baseRole = baseSelect?.value?.trim() || 'subadmin';
  const description = descInput?.value?.trim();

  if (!roleId || !displayName) {
    alert('Please provide a valid role name.');
    return;
  }

  const permissions = [];
  Object.keys(CONTROL_PANEL_PERMS_MAP).forEach(k => {
    const cb = document.getElementById(`cp-edit-perm-${k}`);
    if (cb && cb.checked) {
      permissions.push(k);
    }
  });

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving Changes...';
  }

  try {
    const res = await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        displayName,
        baseRole,
        description,
        permissions: baseRole === 'admin' ? ['*'] : permissions,
      }),
    });

    closeModal('control-panel-edit-role-modal');

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: '⚙️ Role Updated',
        message: res.message || 'Platform role updated successfully!',
        type: 'success',
        duration: 4000,
      });
    } else {
      alert(`✅ ${res.message || 'Platform role updated successfully!'}`);
    }

    loadAdminControlPanel(true);
  } catch (err) {
    console.error('Failed to update role:', err);
    alert(`Failed to update role: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 Save Role Changes';
    }
  }
}

/**
 * Super Admin: Delete Custom Role
 */
async function deleteControlPanelRole(roleId, roleKey, roleName) {
  if (!confirm(`Are you sure you want to permanently delete custom role "${roleName}" (${roleKey})?\n\nThis role can only be deleted if zero staff members are currently assigned to it.`)) {
    return;
  }

  try {
    const res = await apiFetch(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
      method: 'DELETE',
    });

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: '🗑️ Role Deleted',
        message: res.message || `Custom role "${roleName}" deleted successfully!`,
        type: 'info',
        duration: 4000,
      });
    } else {
      alert(`✅ ${res.message || 'Custom role deleted successfully!'}`);
    }

    loadAdminControlPanel(true);
  } catch (err) {
    console.error('Failed to delete role:', err);
    alert(`Failed to delete role: ${err.message}`);
  }
}

/**
 * Filter handlers
 */
function setControlPanelRoleFilter(fRole) {
  controlPanelRoleFilter = fRole || 'all';
  renderAdminControlPanelView();
}

function handleControlPanelSearchInput(val) {
  controlPanelSearchFilter = (val || '').trim();
  renderAdminControlPanelView();
}

function clearControlPanelSearch() {
  controlPanelSearchFilter = '';
  renderAdminControlPanelView();
}

/**
 * Roles tab filter handlers
 */
function setControlPanelRolesTabFilter(filter) {
  controlPanelRolesTabFilter = filter || 'all';
  renderAdminControlPanelView();
}

function handleControlPanelRolesSearch(val) {
  controlPanelRolesSearch = (val || '').trim();
  renderAdminControlPanelView();
}

function clearControlPanelRolesSearch() {
  controlPanelRolesSearch = '';
  renderAdminControlPanelView();
}

function switchControlPanelToStaffDirectory() {
  controlPanelActiveTab = 'addresses';
  controlPanelRoleFilter = 'all';
  controlPanelSearchFilter = '';
  renderAdminControlPanelView();
  setTimeout(() => {
    const table = document.querySelector('#admin-control-panel-container table');
    if (table) {
      table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 50);
}

/**
 * Super Admin: Open Location Modal from Control Panel
 */
function openControlPanelLocationModal(adminId) {
  const admin = currentControlPanelData.admins.find(a => String(a._id || a.id) === String(adminId));
  if (!admin) {
    alert('Administrator account not found.');
    return;
  }

  const idInput = document.getElementById('assign-loc-admin-id');
  const summaryEl = document.getElementById('assign-loc-admin-summary');
  const cityInput = document.getElementById('assign-loc-city');
  const pincodeInput = document.getElementById('assign-loc-pincode');
  const stateInput = document.getElementById('assign-loc-state');
  const localityInput = document.getElementById('assign-loc-locality');
  const line1Input = document.getElementById('assign-loc-line1');

  if (idInput) idInput.value = String(admin._id || admin.id);

  const loc = admin.assignedLocation || {};
  const currentCity = loc.city || 'Bengaluru';
  const currentPincode = loc.postalCode || '560001';
  const currentState = loc.state || 'Karnataka';
  const currentLocality = loc.locality || 'Central HQ';
  const currentLine1 = loc.line1 || 'Tomato Operations Headquarters';

  if (cityInput) cityInput.value = currentCity;
  if (pincodeInput) pincodeInput.value = currentPincode;
  if (stateInput) stateInput.value = currentState;
  if (localityInput) localityInput.value = currentLocality;
  if (line1Input) line1Input.value = currentLine1;

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <strong style="font-size:1rem; color:var(--ink);">${escapeHtml(formatCleanName(admin.name || 'Admin Member'))}</strong>
          <span class="badge" style="margin-left:0.4rem; background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(admin.adminRoleTitle || admin.role)}</span>
          <div style="font-size:0.78rem; color:var(--muted); margin-top:0.2rem;">Email: ${escapeHtml(admin.email || (admin.username ? '@' + admin.username : 'N/A'))} • ID: ${escapeHtml(admin.adminId || admin.subadminId || admin.employeeId || admin._id)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.75rem; color:var(--muted);">Current Active Location</div>
          <strong style="color:#0284c7; font-size:0.88rem;">📍 ${escapeHtml(currentCity)}, ${escapeHtml(currentPincode)}</strong>
        </div>
      </div>
    `;
  }

  openModal('assign-admin-location-modal');
}

/**
 * Super Admin: Open Change Role Modal (Dynamically Populates System & Custom Roles)
 */
async function openControlPanelChangeRoleModal(adminId) {
  let admin = Array.isArray(currentControlPanelData?.admins)
    ? currentControlPanelData.admins.find(a => String(a._id || a.id) === String(adminId))
    : null;

  if (!admin && Array.isArray(window.currentSubAdminsList)) {
    admin = window.currentSubAdminsList.find(a => String(a._id || a.id) === String(adminId));
  }

  if (!admin) {
    try {
      const data = await apiFetch('/api/admin/control-panel');
      if (data && Array.isArray(data.admins)) {
        currentControlPanelData = {
          admins: data.admins,
          roles: Array.isArray(data.roles) ? data.roles : [],
          supportContact: data.supportContact || null,
        };
        admin = data.admins.find(a => String(a._id || a.id) === String(adminId));
      }
    } catch (_) {}
  }

  if (!admin) {
    alert('Staff account not found.');
    return;
  }

  const idInput = document.getElementById('cp-change-role-admin-id');
  const summaryEl = document.getElementById('cp-change-role-admin-summary');
  const selectRole = document.getElementById('cp-change-role-select');
  const titleInput = document.getElementById('cp-change-role-title');

  if (idInput) idInput.value = String(admin._id || admin.id);

  const isSuper = Boolean(currentControlPanelData?.isSuperAdmin || (typeof role !== 'undefined' && role === 'superadmin'));

  // Dynamically populate available roles from currentControlPanelData.roles
  if (selectRole) {
    const rolesList = Array.isArray(currentControlPanelData?.roles) && currentControlPanelData.roles.length
      ? currentControlPanelData.roles
      : [
          { roleKey: 'admin', displayName: 'Platform Administrator', baseRole: 'admin', isSystem: true },
          { roleKey: 'subadmin', displayName: 'Operations Sub-Admin', baseRole: 'subadmin', isSystem: true },
          { roleKey: 'employee', displayName: 'Normal Employee', baseRole: 'employee', isSystem: true },
        ];

    const sysRoles = rolesList.filter(r => r.isSystem);
    const visibleSysRoles = isSuper ? sysRoles : sysRoles.filter(r => r.roleKey !== 'superadmin');
    const customRoles = rolesList.filter(r => !r.isSystem);

    let optsHtml = `
      <optgroup label="System Standard Roles">
        ${visibleSysRoles.map(r => `
          <option value="${escapeHtml(r.roleKey)}" data-title="${escapeHtml(r.displayName)}" ${admin.role === r.roleKey ? 'selected' : ''}>
            ${r.roleKey === 'superadmin' ? '👑' : r.roleKey === 'admin' ? '👑' : r.roleKey === 'subadmin' ? '🛡️' : '👔'} ${escapeHtml(r.displayName)} (${escapeHtml(r.baseRole.toUpperCase())})
          </option>
        `).join('')}
      </optgroup>
    `;

    if (customRoles.length > 0) {
      optsHtml += `
        <optgroup label="Custom Roles (Created by Super Admin)">
          ${customRoles.map(r => `
            <option value="${escapeHtml(r.roleKey)}" data-title="${escapeHtml(r.displayName)}" ${admin.role === r.roleKey ? 'selected' : ''}>
              ✨ ${escapeHtml(r.displayName)} [${escapeHtml(r.roleKey)}] (${escapeHtml(r.baseRole.toUpperCase())})
            </option>
          `).join('')}
        </optgroup>
      `;
    }

    selectRole.innerHTML = optsHtml;

    selectRole.onchange = function() {
      const selectedOpt = selectRole.options[selectRole.selectedIndex];
      const titleAttr = selectedOpt?.getAttribute('data-title');
      if (titleInput && titleAttr) {
        titleInput.value = titleAttr;
      }
    };
  }

  if (titleInput) {
    titleInput.value = admin.adminRoleTitle || (admin.role === 'admin' ? 'Platform Administrator' : admin.role === 'subadmin' ? 'Operations Sub-Admin' : 'Operations Staff');
  }

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="background:#fdf4ff; border:1px solid #f0abfc; border-radius:10px; padding:0.75rem 1rem; margin-bottom:1rem; font-size:0.86rem; color:#86198f;">
        <div style="font-weight:700; font-size:1rem; color:var(--ink);">${escapeHtml(formatCleanName(admin.name || 'Staff Member'))}</div>
        <div style="margin-top:0.2rem; font-size:0.78rem; color:#701a75;">
          Current Active Role: <strong>${escapeHtml(admin.role.toUpperCase())}</strong> (${escapeHtml(admin.adminRoleTitle || 'N/A')}) • ID: <code>${escapeHtml(admin.adminId || admin.subadminId || admin.employeeId || admin._id)}</code>
        </div>
      </div>
    `;
  }

  openModal('control-panel-change-role-modal');
}

/**
 * Super Admin: Submit Role Change
 */
async function submitControlPanelChangeRole(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const idInput = document.getElementById('cp-change-role-admin-id');
  const selectRole = document.getElementById('cp-change-role-select');
  const titleInput = document.getElementById('cp-change-role-title');
  const submitBtn = document.getElementById('cp-change-role-submit-btn');

  const adminId = idInput?.value?.trim();
  const roleVal = selectRole?.value?.trim();
  const titleVal = titleInput?.value?.trim();

  if (!adminId || !roleVal) {
    alert('Please select a valid role.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating Role...';
  }

  try {
    const res = await apiFetch(`/api/admin/admins/${encodeURIComponent(adminId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({
        role: roleVal,
        adminRoleTitle: titleVal || '',
      }),
    });

    closeModal('control-panel-change-role-modal');

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: '🛡️ Role Updated',
        message: res.message || 'Platform role updated successfully!',
        type: 'success',
        duration: 4000,
      });
    } else {
      alert(`✅ ${res.message || 'Platform role updated successfully!'}`);
    }

    loadAdminControlPanel(true);
    if (typeof fetchAdminSubAdmins === 'function') {
      fetchAdminSubAdmins(true);
    }
  } catch (err) {
    console.error('Failed to change admin role:', err);
    alert(`Failed to update role: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🛡️ Update Platform Role';
    }
  }
}

/**
 * Render Help & Support Channels Tab
 */
function renderSupportTabHtml(isSuper) {
  const contact = currentControlPanelData.supportContact || {
    priorityEmail: 'lightbits.infotech@gmail.com',
    helpline: '9523654737',
    updatedBy: 'System Default',
    updatedAt: null,
  };

  const emailVal = contact.priorityEmail || 'lightbits.infotech@gmail.com';
  const helplineVal = contact.helpline || '9523654737';
  const updatedBy = contact.updatedBy || 'Super Admin';
  const updatedAtStr = contact.updatedAt ? new Date(contact.updatedAt).toLocaleString() : 'System Default Configuration';

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:1.5rem; align-items:start;">
      <!-- LEFT: CONFIGURATION FORM -->
      <div style="background:#fff; border:1px solid var(--line); border-radius:12px; padding:1.5rem; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.25rem; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <h3 style="margin:0 0 0.35rem; font-size:1.15rem; color:var(--ink); display:flex; align-items:center; gap:0.5rem;">
              <span>🛟</span> Help &amp; Support Channels Config
            </h3>
            <p style="margin:0; font-size:0.83rem; color:var(--muted); line-height:1.4;">
              Configure official support touchpoints. Any update here is instantly broadcast to all users under the <strong>Help &amp; Support</strong> desk.
            </p>
          </div>
          <span class="badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; font-size:0.75rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:999px;">
            ● Live Broadcast Active
          </span>
        </div>

        ${!isSuper ? `
          <div style="background:#fffbeb; border:1px solid #fef3c7; border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.25rem; font-size:0.82rem; color:#92400e; display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:1.1rem;">🔒</span>
            <span><strong>Read-Only Access:</strong> You are viewing platform support channels. Only <strong>Super Administrator</strong> can edit or update these fields.</span>
          </div>
        ` : ''}

        <form id="cp-support-channels-form" onsubmit="event.preventDefault(); saveControlPanelSupportContact();">
          <!-- Priority Email Field -->
          <div class="form-group" style="margin-bottom:1.25rem;">
            <label for="cp-support-priority-email" style="display:block; font-weight:700; font-size:0.88rem; color:var(--ink); margin-bottom:0.35rem;">
              Priority Email <span style="color:#d94b35;">*</span>
            </label>
            <div style="position:relative; display:flex; align-items:center;">
              <span style="position:absolute; left:12px; font-size:1.1rem; color:#64748b;">✉️</span>
              <input
                id="cp-support-priority-email"
                type="email"
                value="${escapeHtml(emailVal)}"
                placeholder="lightbits.infotech@gmail.com"
                required
                ${isSuper ? '' : 'readonly'}
                oninput="handleSupportPreviewInput()"
                style="width:100%; padding:0.65rem 0.75rem 0.65rem 2.5rem; border:1px solid var(--line); border-radius:8px; font-size:0.92rem; background:${isSuper ? '#fff' : '#f8fafc'}; color:var(--ink);"
              />
            </div>
            <small style="display:block; margin-top:0.35rem; font-size:0.76rem; color:var(--muted);">
              Reflects under <strong>"Priority Email"</strong> on all users' Help &amp; Support dashboard. Default: <code>lightbits.infotech@gmail.com</code>
            </small>
          </div>

          <!-- 24/7 Helpline Field -->
          <div class="form-group" style="margin-bottom:1.5rem;">
            <label for="cp-support-helpline" style="display:block; font-weight:700; font-size:0.88rem; color:var(--ink); margin-bottom:0.35rem;">
              24/7 Helpline <span style="color:#d94b35;">*</span>
            </label>
            <div style="position:relative; display:flex; align-items:center;">
              <span style="position:absolute; left:12px; font-size:1.1rem; color:#64748b;">📞</span>
              <input
                id="cp-support-helpline"
                type="text"
                value="${escapeHtml(helplineVal)}"
                placeholder="9523654737"
                required
                ${isSuper ? '' : 'readonly'}
                oninput="handleSupportPreviewInput()"
                style="width:100%; padding:0.65rem 0.75rem 0.65rem 2.5rem; border:1px solid var(--line); border-radius:8px; font-size:0.92rem; background:${isSuper ? '#fff' : '#f8fafc'}; color:var(--ink);"
              />
            </div>
            <small style="display:block; margin-top:0.35rem; font-size:0.76rem; color:var(--muted);">
              Reflects under <strong>"24/7 Helpline"</strong> on all users' Help &amp; Support dashboard. Default: <code>9523654737</code>
            </small>
          </div>

          <!-- Action Buttons -->
          ${isSuper ? `
            <div style="display:flex; gap:0.75rem; align-items:center; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:1.25rem;">
              <button
                type="submit"
                id="cp-save-support-btn"
                class="btn btn-primary"
                style="background:#0891b2; border-color:#0891b2; padding:0.6rem 1.4rem; font-weight:700; font-size:0.9rem; display:inline-flex; align-items:center; gap:0.4rem;"
              >
                <span>💾 Save &amp; Broadcast to All Dashboards</span>
              </button>

              <button
                type="button"
                class="btn btn-outline"
                style="padding:0.6rem 1rem; font-size:0.85rem;"
                onclick="resetControlPanelSupportContactDefaults()"
              >
                ↺ Reset to Defaults
              </button>
            </div>
          ` : ''}
        </form>

        <!-- Governance Footer -->
        <div style="margin-top:1.5rem; padding-top:1rem; border-top:1px dashed var(--line); font-size:0.75rem; color:var(--muted); display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
          <span>Last modified by: <strong>${escapeHtml(updatedBy)}</strong></span>
          <span>Timestamp: <strong>${escapeHtml(updatedAtStr)}</strong></span>
        </div>
      </div>

      <!-- RIGHT: LIVE PREVIEW OF "HELP & SUPPORT" TILES -->
      <div>
        <div style="background:#fff; border:1px solid var(--line); border-radius:12px; padding:1.5rem; box-shadow:0 1px 3px rgba(0,0,0,0.05); margin-bottom:1.5rem;">
          <h4 style="margin:0 0 0.5rem; font-size:1rem; color:var(--ink); display:flex; align-items:center; gap:0.4rem;">
            <span>👁️</span> Live User Dashboard Preview
          </h4>
          <p style="margin:0 0 1.25rem; font-size:0.8rem; color:var(--muted);">
            This is exactly how the <strong>Help &amp; Support</strong> header cards render for Customers, Restaurants, Riders, and Shops:
          </p>

          <div style="display:grid; grid-template-columns:1fr; gap:0.85rem;">
            <!-- Live Preview Helpline Card -->
            <div style="background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:1rem; display:flex; align-items:flex-start; gap:0.8rem;">
              <div style="font-size:1.8rem; line-height:1;">📞</div>
              <div>
                <strong style="display:block; font-size:0.9rem; color:var(--ink);">24/7 Helpline</strong>
                <a id="cp-preview-helpline-link" href="tel:${escapeHtml(helplineVal.replace(/\s+/g, ''))}" style="font-size:0.9rem; color:var(--tomato, #d94b35); font-weight:800; text-decoration:none;">
                  <span id="cp-preview-helpline-text">${escapeHtml(helplineVal)}</span>
                </a>
                <p style="margin:0.2rem 0 0; font-size:0.75rem; color:var(--muted);">Toll-free immediate assistance</p>
              </div>
            </div>

            <!-- Live Preview Priority Email Card -->
            <div style="background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:1rem; display:flex; align-items:flex-start; gap:0.8rem;">
              <div style="font-size:1.8rem; line-height:1;">✉️</div>
              <div>
                <strong style="display:block; font-size:0.9rem; color:var(--ink);">Priority Email</strong>
                <a id="cp-preview-email-link" href="mailto:${escapeHtml(emailVal)}" style="font-size:0.9rem; color:var(--ink); font-weight:800; text-decoration:none;">
                  <span id="cp-preview-email-text">${escapeHtml(emailVal)}</span>
                </a>
                <p style="margin:0.2rem 0 0; font-size:0.75rem; color:var(--muted);">Guaranteed response within 2 hrs</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Touchpoints Information Card -->
        <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:1.25rem;">
          <h5 style="margin:0 0 0.5rem; font-size:0.9rem; color:#0369a1; display:flex; align-items:center; gap:0.4rem;">
            <span>ℹ️</span> Multi-Role Visibility Scope
          </h5>
          <ul style="margin:0; padding-left:1.2rem; font-size:0.8rem; color:#0c4a6e; line-height:1.6;">
            <li><strong>Customers:</strong> Shown under Customer Help &amp; Support desk for instant order queries.</li>
            <li><strong>Restaurant Partners:</strong> Shown under Kitchen &amp; Menu Help for settlement &amp; order inquiries.</li>
            <li><strong>Delivery Riders:</strong> Shown under Rider Delivery Help for roadside assistance.</li>
            <li><strong>Grocery Shops:</strong> Shown under Retail Partner Help for catalog &amp; dispatch issues.</li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

function handleSupportPreviewInput() {
  const emailInput = document.getElementById('cp-support-priority-email');
  const helplineInput = document.getElementById('cp-support-helpline');

  const emailVal = emailInput ? emailInput.value.trim() : '';
  const helplineVal = helplineInput ? helplineInput.value.trim() : '';

  const prevEmailText = document.getElementById('cp-preview-email-text');
  const prevEmailLink = document.getElementById('cp-preview-email-link');
  if (prevEmailText) prevEmailText.textContent = emailVal || 'lightbits.infotech@gmail.com';
  if (prevEmailLink) prevEmailLink.href = `mailto:${emailVal || 'lightbits.infotech@gmail.com'}`;

  const prevHelpText = document.getElementById('cp-preview-helpline-text');
  const prevHelpLink = document.getElementById('cp-preview-helpline-link');
  if (prevHelpText) prevHelpText.textContent = helplineVal || '9523654737';
  if (prevHelpLink) prevHelpLink.href = `tel:${(helplineVal || '9523654737').replace(/\s+/g, '')}`;
}

function resetControlPanelSupportContactDefaults() {
  const emailInput = document.getElementById('cp-support-priority-email');
  const helplineInput = document.getElementById('cp-support-helpline');
  if (emailInput) emailInput.value = 'lightbits.infotech@gmail.com';
  if (helplineInput) helplineInput.value = '9523654737';
  handleSupportPreviewInput();
}

async function saveControlPanelSupportContact() {
  const emailInput = document.getElementById('cp-support-priority-email');
  const helplineInput = document.getElementById('cp-support-helpline');
  const btn = document.getElementById('cp-save-support-btn');

  const priorityEmail = String(emailInput?.value || '').trim();
  const helpline = String(helplineInput?.value || '').trim();

  if (!priorityEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(priorityEmail)) {
    alert('Please enter a valid Priority Email address.');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!helpline || helpline.length < 5) {
    alert('Please enter a valid 24/7 Helpline number.');
    if (helplineInput) helplineInput.focus();
    return;
  }

  const origBtnText = btn ? btn.innerHTML : 'Save';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Saving & Broadcasting...';
  }

  try {
    const res = await apiFetch('/api/admin/control-panel/support-contact', {
      method: 'PUT',
      body: JSON.stringify({ priorityEmail, helpline }),
    });

    if (res && res.success) {
      currentControlPanelData.supportContact = res.supportContact;

      // Update local storage so immediate reloads or other views have it
      try {
        localStorage.setItem(
          'tomato_support_contact',
          JSON.stringify({ priorityEmail, helpline })
        );
      } catch (_) {}

      // Immediately update DOM elements on current dashboard if present
      const emailLink = document.getElementById('support-priority-email-link');
      const emailDisplay = document.getElementById('support-priority-email-display');
      if (emailLink) emailLink.href = `mailto:${priorityEmail}`;
      if (emailDisplay) emailDisplay.textContent = priorityEmail;

      const helplineLink = document.getElementById('support-helpline-link');
      const helplineDisplay = document.getElementById('support-helpline-display');
      if (helplineLink) helplineLink.href = `tel:${helpline.replace(/\s+/g, '')}`;
      if (helplineDisplay) helplineDisplay.textContent = helpline;

      if (typeof showToastNotification === 'function') {
        showToastNotification({
          title: '🛟 Support Channels Updated',
          message: `Priority Email set to "${priorityEmail}" and Helpline to "${helpline}". Reflected across all dashboards!`,
          type: 'success',
          duration: 4500,
        });
      } else {
        alert(`✅ Support channels updated successfully!\nPriority Email: ${priorityEmail}\n24/7 Helpline: ${helpline}`);
      }

      renderAdminControlPanelView();
    } else {
      alert(`⚠️ Failed to update support contacts: ${res?.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Error saving support contact:', err);
    alert(`⚠️ Error saving support contact: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

/**
 * Render Employee Approvals Tab (Approve / Reject & Assign Role)
 */
function renderEmployeeApprovalsTabHtml(isSuper) {
  const staff = currentControlPanelData.admins || [];
  const employeeAccounts = staff.filter(a =>
    a.role === 'employee' ||
    a.baseRole === 'employee' ||
    Boolean(a.employeeId) ||
    a.approvalStatus === 'pending' ||
    a.approvalStatus === 'rejected' ||
    a.isApproved === false
  );

  const pendingCount = employeeAccounts.filter(a => a.approvalStatus === 'pending' || (a.isApproved === false && a.approvalStatus !== 'rejected')).length;
  const approvedCount = employeeAccounts.filter(a => a.approvalStatus === 'approved' && a.isApproved !== false).length;
  const rejectedCount = employeeAccounts.filter(a => a.approvalStatus === 'rejected').length;

  let filtered = employeeAccounts;

  if (controlPanelEmpStatusFilter === 'pending') {
    filtered = filtered.filter(a => a.approvalStatus === 'pending' || (a.isApproved === false && a.approvalStatus !== 'rejected'));
  } else if (controlPanelEmpStatusFilter === 'approved') {
    filtered = filtered.filter(a => a.approvalStatus === 'approved' && a.isApproved !== false);
  } else if (controlPanelEmpStatusFilter === 'rejected') {
    filtered = filtered.filter(a => a.approvalStatus === 'rejected');
  }

  if (controlPanelEmpSearch) {
    const q = controlPanelEmpSearch.toLowerCase();
    filtered = filtered.filter(a =>
      (a.name && a.name.toLowerCase().includes(q)) ||
      (a.email && a.email.toLowerCase().includes(q)) ||
      (a.phone && a.phone.includes(q)) ||
      (a.employeeId && a.employeeId.toLowerCase().includes(q)) ||
      (a.adminRoleTitle && a.adminRoleTitle.toLowerCase().includes(q))
    );
  }

  return `
    <div style="background:#fff; border:1px solid var(--line); border-radius:12px; padding:1.25rem 1.5rem; margin-bottom:1.5rem; box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <!-- Summary metrics cards -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.25rem;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:1rem;">
          <div style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color:#64748b;">Total Staff Applicants</div>
          <div style="font-size:1.75rem; font-weight:800; color:#0f172a; margin-top:0.25rem;">${employeeAccounts.length}</div>
          <small style="color:#64748b; font-size:0.75rem;">Registered employee applicants</small>
        </div>

        <div style="background:#fefce8; border:1px solid #fef08a; border-radius:10px; padding:1rem;">
          <div style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color:#854d0e;">Pending Approval</div>
          <div style="font-size:1.75rem; font-weight:800; color:#b45309; margin-top:0.25rem;">${pendingCount}</div>
          <small style="color:#a16207; font-size:0.75rem;">Awaiting admin review &amp; role</small>
        </div>

        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:1rem;">
          <div style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color:#166534;">Approved &amp; Active</div>
          <div style="font-size:1.75rem; font-weight:800; color:#15803d; margin-top:0.25rem;">${approvedCount}</div>
          <small style="color:#166534; font-size:0.75rem;">Active with assigned roles</small>
        </div>

        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:1rem;">
          <div style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color:#991b1b;">Rejected Applications</div>
          <div style="font-size:1.75rem; font-weight:800; color:#b91c1c; margin-top:0.25rem;">${rejectedCount}</div>
          <small style="color:#991b1b; font-size:0.75rem;">Declined registrations</small>
        </div>
      </div>

      <!-- Search & Status Filter Controls -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding-bottom:1rem; border-bottom:1px solid var(--line);">
        <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${controlPanelEmpStatusFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setControlPanelEmpStatusFilter('all')">All (${employeeAccounts.length})</button>
          <button type="button" class="btn btn-sm ${controlPanelEmpStatusFilter === 'pending' ? 'btn-primary' : 'btn-outline'}" style="${controlPanelEmpStatusFilter === 'pending' ? 'background:#d97706; border-color:#d97706;' : ''}" onclick="setControlPanelEmpStatusFilter('pending')">⏳ Pending (${pendingCount})</button>
          <button type="button" class="btn btn-sm ${controlPanelEmpStatusFilter === 'approved' ? 'btn-primary' : 'btn-outline'}" style="${controlPanelEmpStatusFilter === 'approved' ? 'background:#16a34a; border-color:#16a34a;' : ''}" onclick="setControlPanelEmpStatusFilter('approved')">✓ Approved (${approvedCount})</button>
          <button type="button" class="btn btn-sm ${controlPanelEmpStatusFilter === 'rejected' ? 'btn-primary' : 'btn-outline'}" style="${controlPanelEmpStatusFilter === 'rejected' ? 'background:#dc2626; border-color:#dc2626;' : ''}" onclick="setControlPanelEmpStatusFilter('rejected')">✕ Rejected (${rejectedCount})</button>
        </div>

        <div style="display:flex; gap:0.5rem; align-items:center;">
          <div style="position:relative;">
            <input
              type="text"
              id="control-panel-emp-search-input"
              class="form-control form-control-sm"
              placeholder="Search by name, ID, email..."
              value="${escapeHtml(controlPanelEmpSearch)}"
              oninput="handleControlPanelEmpSearchInput(this.value)"
              style="padding-left:1.8rem; font-size:0.82rem; min-width:220px;"
            />
            <span style="position:absolute; left:0.6rem; top:50%; transform:translateY(-50%); font-size:0.85rem; color:var(--muted); pointer-events:none;">🔍</span>
          </div>
          ${controlPanelEmpSearch ? `<button type="button" class="btn btn-outline btn-sm" onclick="clearControlPanelEmpSearch()">✕</button>` : ''}
        </div>
      </div>

      <!-- Employee Table -->
      ${filtered.length === 0 ? `
        <div style="text-align:center; padding:3rem 1rem; color:var(--muted);">
          <div style="font-size:2.5rem; margin-bottom:0.5rem;">👥</div>
          <p style="font-size:0.95rem; font-weight:600;">No employees found matching the filter criteria.</p>
        </div>
      ` : `
        <div style="overflow-x:auto; margin-top:1rem;">
          <table style="width:100%; border-collapse:collapse; font-size:0.86rem; text-align:left;">
            <thead>
              <tr style="border-bottom:2px solid var(--line); color:var(--muted); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em;">
                <th style="padding:0.75rem 0.85rem;">Employee &amp; ID</th>
                <th style="padding:0.75rem 0.85rem;">Contact</th>
                <th style="padding:0.75rem 0.85rem;">Applied On</th>
                <th style="padding:0.75rem 0.85rem;">Approval Status</th>
                <th style="padding:0.75rem 0.85rem;">Assigned Role &amp; Designation</th>
                <th style="padding:0.75rem 0.85rem; text-align:right;">Governance Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(emp => {
                const isRejected = emp.approvalStatus === 'rejected';
                const isApproved = emp.approvalStatus === 'approved' && emp.isApproved !== false;
                const isPending = !isRejected && (emp.approvalStatus === 'pending' || emp.isApproved === false);
                const joined = emp.createdAt ? new Date(emp.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently';

                return `
                  <tr style="border-bottom:1px solid var(--line); vertical-align:middle;">
                    <td style="padding:0.85rem;">
                      <div style="font-weight:700; color:var(--ink);">${escapeHtml(emp.name || 'Unnamed Staff')}</div>
                      <div style="font-size:0.75rem; color:var(--muted); margin-top:0.15rem;">ID: <code>${escapeHtml(emp.employeeId || emp.subadminId || emp.adminId || emp._id)}</code></div>
                    </td>
                    <td style="padding:0.85rem;">
                      <div>${escapeHtml(emp.email || 'N/A')}</div>
                      <div style="font-size:0.78rem; color:var(--muted);">${escapeHtml(emp.phone || 'N/A')}</div>
                    </td>
                    <td style="padding:0.85rem; color:var(--muted); font-size:0.8rem;">
                      ${escapeHtml(joined)}
                    </td>
                    <td style="padding:0.85rem;">
                      ${isPending
                        ? `<span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:700; font-size:0.75rem; padding:0.25rem 0.55rem; border-radius:999px;">⏳ Pending Approval</span>`
                        : isRejected
                        ? `<span class="badge" style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; font-weight:700; font-size:0.75rem; padding:0.25rem 0.55rem; border-radius:999px;" title="${escapeHtml(emp.rejectionReason || 'Rejected')}">✕ Rejected</span>`
                        : `<span class="badge" style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; font-weight:700; font-size:0.75rem; padding:0.25rem 0.55rem; border-radius:999px;">✓ Active &amp; Approved</span>`
                      }
                    </td>
                    <td style="padding:0.85rem;">
                      ${isApproved
                        ? `
                          <div style="display:inline-flex; align-items:center; gap:0.35rem; background:#f1f5f9; padding:0.2rem 0.5rem; border-radius:6px; border:1px solid #e2e8f0;">
                            <span style="font-weight:700; color:#0f172a; font-size:0.8rem;">${escapeHtml((emp.role || 'employee').toUpperCase())}</span>
                            <span style="color:#64748b; font-size:0.75rem;">• ${escapeHtml(emp.adminRoleTitle || 'Staff')}</span>
                          </div>
                        `
                        : isRejected
                        ? `<span style="color:#b91c1c; font-size:0.78rem; font-weight:600;">✕ Application Rejected</span>`
                        : `<span style="color:#d97706; font-size:0.78rem; font-weight:600;">⚠️ Role Pending Assignment</span>`
                      }
                    </td>
                    <td style="padding:0.85rem; text-align:right;">
                      <div style="display:inline-flex; gap:0.4rem; justify-content:flex-end; flex-wrap:wrap;">
                        ${isPending ? `
                          <button
                            type="button"
                            class="btn btn-sm btn-primary"
                            style="background:#059669; border-color:#059669; font-size:0.78rem; padding:0.3rem 0.65rem; font-weight:700;"
                            onclick="openApproveEmployeeModal('${emp._id}')"
                          >
                            ✅ Approve &amp; Assign Role
                          </button>
                          <button
                            type="button"
                            class="btn btn-outline btn-sm"
                            style="color:#b91c1c; border-color:#fca5a5; font-size:0.78rem; padding:0.3rem 0.65rem;"
                            onclick="openRejectEmployeeModal('${emp._id}')"
                          >
                            ✕ Reject
                          </button>
                        ` : isApproved ? `
                          <button
                            type="button"
                            class="btn btn-outline btn-sm"
                            style="font-size:0.78rem; padding:0.3rem 0.65rem; color:#7c3aed; border-color:#c4b5fd;"
                            onclick="openControlPanelChangeRoleModal(currentControlPanelData.admins.find(x => x._id === '${emp._id}'))"
                          >
                            🎭 Reassign Role
                          </button>
                          <button
                            type="button"
                            class="btn btn-outline btn-sm"
                            style="font-size:0.78rem; padding:0.3rem 0.65rem; color:${emp.isBlocked ? '#15803d' : '#b91c1c'}; border-color:${emp.isBlocked ? '#86efac' : '#fecaca'};"
                            onclick="toggleStaffStatusFromControlPanel('${emp._id}', ${Boolean(emp.isBlocked)})"
                          >
                            ${emp.isBlocked ? '🔓 Unblock' : '🚫 Block'}
                          </button>
                        ` : `
                          <button
                            type="button"
                            class="btn btn-sm btn-primary"
                            style="background:#059669; border-color:#059669; font-size:0.78rem; padding:0.3rem 0.65rem; font-weight:700;"
                            onclick="openApproveEmployeeModal('${emp._id}')"
                          >
                            ↻ Re-evaluate &amp; Approve
                          </button>
                        `}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function openApproveEmployeeModal(employeeId) {
  const emp = currentControlPanelData.admins.find(a => String(a._id) === String(employeeId) || String(a.id) === String(employeeId));
  if (!emp) {
    alert('Employee account not found.');
    return;
  }

  const idInput = document.getElementById('cp-approve-emp-id');
  const summaryEl = document.getElementById('cp-approve-emp-summary');
  const roleSelect = document.getElementById('cp-approve-role-select');
  const titleInput = document.getElementById('cp-approve-role-title');

  if (idInput) idInput.value = emp._id;

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:0.85rem 1rem; margin-bottom:1rem; font-size:0.86rem; color:#166534;">
        <div style="font-weight:800; font-size:1.05rem; color:#0f172a;">${escapeHtml(emp.name || 'Unnamed Staff')}</div>
        <div style="margin-top:0.3rem; font-size:0.78rem; color:#15803d; line-height:1.5;">
          <strong>Email:</strong> ${escapeHtml(emp.email || 'N/A')} &nbsp;•&nbsp; <strong>Phone:</strong> ${escapeHtml(emp.phone || 'N/A')}<br>
          <strong>Employee ID:</strong> <code>${escapeHtml(emp.employeeId || emp._id)}</code> &nbsp;•&nbsp; <strong>Registered:</strong> ${emp.createdAt ? new Date(emp.createdAt).toLocaleDateString('en-IN') : 'Recently'}
        </div>
      </div>
    `;
  }

  if (roleSelect) {
    const rolesList = currentControlPanelData.roles || [];
    let opts = `
      <optgroup label="Standard System Roles">
        <option value="employee" selected>👔 Operations Staff / Employee (Standard Staff View)</option>
        <option value="subadmin">🛡️ Operations Sub-Admin (Delegated RBAC operations)</option>
        <option value="admin">👑 Platform Administrator (Full system management)</option>
      </optgroup>
    `;

    const customRoles = rolesList.filter(r => !r.isSystem);
    if (customRoles.length > 0) {
      opts += `
        <optgroup label="Custom Platform Roles">
          ${customRoles.map(r => `
            <option value="${escapeHtml(r.roleKey)}">${escapeHtml(r.roleName || r.displayName || r.roleKey)} (${r.baseRole || 'subadmin'})</option>
          `).join('')}
        </optgroup>
      `;
    }
    roleSelect.innerHTML = opts;
  }

  if (titleInput) {
    titleInput.value = 'Operations Associate';
  }

  openModal('control-panel-approve-employee-modal');
}
window.openApproveEmployeeModal = openApproveEmployeeModal;

function handleApproveRoleSelectChange() {
  const roleSelect = document.getElementById('cp-approve-role-select');
  const titleInput = document.getElementById('cp-approve-role-title');
  if (!roleSelect || !titleInput) return;

  const val = roleSelect.value;
  if (val === 'admin') {
    titleInput.value = 'Platform Administrator';
  } else if (val === 'subadmin') {
    titleInput.value = 'Operations Sub-Admin';
  } else if (val === 'employee') {
    titleInput.value = 'Operations Associate';
  } else {
    const customRole = (currentControlPanelData.roles || []).find(r => r.roleKey === val);
    titleInput.value = customRole?.roleName || customRole?.displayName || val.toUpperCase();
  }
}
window.handleApproveRoleSelectChange = handleApproveRoleSelectChange;

async function submitControlPanelApproveEmployee(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const idInput = document.getElementById('cp-approve-emp-id');
  const roleSelect = document.getElementById('cp-approve-role-select');
  const titleInput = document.getElementById('cp-approve-role-title');
  const submitBtn = document.getElementById('cp-approve-submit-btn');

  const empId = idInput?.value?.trim();
  const roleVal = roleSelect?.value?.trim();
  const titleVal = titleInput?.value?.trim();

  if (!empId || !roleVal) {
    alert('Please select a valid role to assign to this employee.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Approving & Activating...';
  }

  try {
    const res = await apiFetch(`/api/admin/employees/${encodeURIComponent(empId)}/approve`, {
      method: 'PUT',
      body: JSON.stringify({
        role: roleVal,
        adminRoleTitle: titleVal || '',
      }),
    });

    closeModal('control-panel-approve-employee-modal');

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: '✅ Employee Approved',
        message: res.message || 'Employee account approved and activated successfully!',
        type: 'success',
        duration: 4000,
      });
    } else {
      alert(`✅ ${res.message || 'Employee approved and activated successfully!'}`);
    }

    loadAdminControlPanel(true);
    if (typeof fetchAdminSubAdmins === 'function') {
      fetchAdminSubAdmins(true);
    }
  } catch (err) {
    console.error('Failed to approve employee:', err);
    alert(`Failed to approve employee: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '✅ Approve & Activate Account';
    }
  }
}
window.submitControlPanelApproveEmployee = submitControlPanelApproveEmployee;

function openRejectEmployeeModal(employeeId) {
  const emp = currentControlPanelData?.admins?.find(a => String(a._id) === String(employeeId) || String(a.id) === String(employeeId));
  if (!emp) {
    alert('Employee account not found.');
    return;
  }

  const idInput = document.getElementById('cp-reject-emp-id');
  const summaryEl = document.getElementById('cp-reject-emp-summary');
  const reasonInput = document.getElementById('cp-reject-reason');

  if (idInput) idInput.value = emp._id || employeeId;

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:0.85rem 1rem; margin-bottom:1rem; font-size:0.86rem; color:#991b1b;">
        <div style="font-weight:800; font-size:1.05rem; color:#991b1b;">${escapeHtml(emp.name || 'Unnamed Staff')}</div>
        <div style="margin-top:0.3rem; font-size:0.78rem; color:#b91c1c; line-height:1.5;">
          <strong>Email:</strong> ${escapeHtml(emp.email || 'N/A')} &nbsp;•&nbsp; <strong>Phone:</strong> ${escapeHtml(emp.phone || 'N/A')}<br>
          <strong>Employee ID:</strong> <code>${escapeHtml(emp.employeeId || emp._id)}</code> &nbsp;•&nbsp; <strong>Registered:</strong> ${emp.createdAt ? new Date(emp.createdAt).toLocaleDateString('en-IN') : 'Recently'}
        </div>
      </div>
    `;
  }

  if (reasonInput) {
    reasonInput.value = 'Application rejected by administrator';
  }

  if (typeof openModal === 'function') {
    openModal('control-panel-reject-employee-modal');
  } else {
    const m = document.getElementById('control-panel-reject-employee-modal');
    if (m) m.classList.add('visible');
  }
}
window.openRejectEmployeeModal = openRejectEmployeeModal;

async function submitControlPanelRejectEmployee(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const idInput = document.getElementById('cp-reject-emp-id');
  const reasonInput = document.getElementById('cp-reject-reason');
  const submitBtn = document.getElementById('cp-reject-submit-btn');

  const empId = idInput?.value?.trim();
  const reasonVal = reasonInput?.value?.trim() || 'Application rejected by administrator';

  if (!empId) {
    alert('Employee ID is missing.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Rejecting...';
  }

  try {
    const res = await apiFetch(`/api/admin/employees/${encodeURIComponent(empId)}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ reason: reasonVal }),
    });

    if (typeof closeModal === 'function') {
      closeModal('control-panel-reject-employee-modal');
    } else {
      const m = document.getElementById('control-panel-reject-employee-modal');
      if (m) m.classList.remove('visible');
    }

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: '✕ Employee Rejected',
        message: res.message || 'Employee application has been rejected.',
        type: 'info',
        duration: 4000,
      });
    } else {
      alert(`✕ ${res.message || 'Employee application has been rejected.'}`);
    }

    loadAdminControlPanel(true);
    if (typeof fetchAdminSubAdmins === 'function') {
      fetchAdminSubAdmins(true);
    }
  } catch (err) {
    console.error('Failed to reject employee:', err);
    alert(`Failed to reject employee: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '✕ Confirm Rejection';
    }
  }
}
window.submitControlPanelRejectEmployee = submitControlPanelRejectEmployee;

async function rejectEmployeeFromControlPanel(empId) {
  openRejectEmployeeModal(empId);
}
window.rejectEmployeeFromControlPanel = rejectEmployeeFromControlPanel;

function setControlPanelEmpStatusFilter(status) {
  controlPanelEmpStatusFilter = status || 'all';
  renderAdminControlPanelView();
}
window.setControlPanelEmpStatusFilter = setControlPanelEmpStatusFilter;

function handleControlPanelEmpSearchInput(val) {
  controlPanelEmpSearch = String(val || '').trim();
  renderAdminControlPanelView();
}
window.handleControlPanelEmpSearchInput = handleControlPanelEmpSearchInput;

function clearControlPanelEmpSearch() {
  controlPanelEmpSearch = '';
  renderAdminControlPanelView();
}
window.clearControlPanelEmpSearch = clearControlPanelEmpSearch;

async function toggleStaffStatusFromControlPanel(staffId, currentlyBlocked, name = 'Staff Member', role = 'employee') {
  const isEmp = role === 'employee';
  const roleName = isEmp ? 'employee' : role === 'subadmin' ? 'sub-administrator' : 'staff member';
  const action = currentlyBlocked ? 'unblock / enable' : 'block / disable';
  if (!confirm(`Are you sure you want to ${action} ${roleName} "${name}"?`)) return;

  try {
    const res = await apiFetch(`/api/admin/employees/${staffId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ isBlocked: !currentlyBlocked }),
    });

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: `Staff ${currentlyBlocked ? 'Enabled' : 'Disabled'}`,
        message: res.message || `${roleName.charAt(0).toUpperCase() + roleName.slice(1)} "${name}" ${action}ed successfully.`,
        type: 'success',
        duration: 3500,
      });
    } else {
      alert(res.message || `${roleName.charAt(0).toUpperCase() + roleName.slice(1)} "${name}" ${action}ed successfully.`);
    }

    loadAdminControlPanel(true);
    if (typeof fetchAdminSubAdmins === 'function') {
      fetchAdminSubAdmins(true);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteStaffFromControlPanel(staffId, name = 'Staff Member', role = 'employee') {
  const isEmp = role === 'employee';
  const roleName = isEmp ? 'employee' : role === 'subadmin' ? 'sub-administrator' : 'staff member';
  if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete ${roleName} "${name}"? This action cannot be undone.`)) return;

  try {
    const res = await apiFetch(`/api/admin/employees/${staffId}`, {
      method: 'DELETE',
    });

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: 'Staff Member Deleted',
        message: res.message || `${roleName.charAt(0).toUpperCase() + roleName.slice(1)} "${name}" deleted permanently.`,
        type: 'success',
        duration: 3500,
      });
    } else {
      alert(res.message || `${roleName.charAt(0).toUpperCase() + roleName.slice(1)} "${name}" deleted permanently.`);
    }

    loadAdminControlPanel(true);
    if (typeof fetchAdminSubAdmins === 'function') {
      fetchAdminSubAdmins(true);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Window exports
window.loadAdminControlPanel = loadAdminControlPanel;
window.renderAdminControlPanelView = renderAdminControlPanelView;
window.setControlPanelTab = setControlPanelTab;
window.setControlPanelRoleFilter = setControlPanelRoleFilter;
window.setControlPanelRolesTabFilter = setControlPanelRolesTabFilter;
window.handleControlPanelSearchInput = handleControlPanelSearchInput;
window.clearControlPanelSearch = clearControlPanelSearch;
window.handleControlPanelRolesSearch = handleControlPanelRolesSearch;
window.clearControlPanelRolesSearch = clearControlPanelRolesSearch;
window.switchControlPanelToStaffDirectory = switchControlPanelToStaffDirectory;
window.openControlPanelLocationModal = openControlPanelLocationModal;
window.openControlPanelChangeRoleModal = openControlPanelChangeRoleModal;
window.submitControlPanelChangeRole = submitControlPanelChangeRole;
window.openControlPanelCreateRoleModal = openControlPanelCreateRoleModal;
window.submitControlPanelCreateRole = submitControlPanelCreateRole;
window.openControlPanelEditRoleModal = openControlPanelEditRoleModal;
window.submitControlPanelEditRole = submitControlPanelEditRole;
window.deleteControlPanelRole = deleteControlPanelRole;
window.handleRoleDisplayNameInput = handleRoleDisplayNameInput;
window.handleRoleBaseChange = handleRoleBaseChange;
window.setAllRolePermissions = setAllRolePermissions;
window.renderSupportTabHtml = renderSupportTabHtml;
window.handleSupportPreviewInput = handleSupportPreviewInput;
window.resetControlPanelSupportContactDefaults = resetControlPanelSupportContactDefaults;
window.saveControlPanelSupportContact = saveControlPanelSupportContact;
window.toggleStaffStatusFromControlPanel = toggleStaffStatusFromControlPanel;
window.deleteStaffFromControlPanel = deleteStaffFromControlPanel;
window.renderEmployeeApprovalsTabHtml = renderEmployeeApprovalsTabHtml;
window.openApproveEmployeeModal = openApproveEmployeeModal;
window.handleApproveRoleSelectChange = handleApproveRoleSelectChange;
window.submitControlPanelApproveEmployee = submitControlPanelApproveEmployee;
window.rejectEmployeeFromControlPanel = rejectEmployeeFromControlPanel;
window.setControlPanelEmpStatusFilter = setControlPanelEmpStatusFilter;
window.handleControlPanelEmpSearchInput = handleControlPanelEmpSearchInput;
window.clearControlPanelEmpSearch = clearControlPanelEmpSearch;
window.CONTROL_PANEL_PERMS_MAP = CONTROL_PANEL_PERMS_MAP;

