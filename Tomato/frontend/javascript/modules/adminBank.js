// =========================================================================
// ADMIN BANK & KYC + ORDER SETTLEMENTS MODULE
// =========================================================================
// =========================================================================
// 17. ADMIN BANK PANEL & PARTNER BANK / PAN KYC + PAYOUT SETTLEMENTS
// =========================================================================
let currentAdminBankTab = 'partners';
let cachedAdminBankPartners = [];
let cachedAdminBankSettlements = [];
let currentEditingSettlementObj = null;

let currentAdminBankPartnerRole = 'all';
let currentAdminBankPartnerPage = 1;
const ADMIN_BANK_PAGE_SIZE = 10;

function selectAdminBankPartnerRole(role) {
  currentAdminBankPartnerRole = role || 'all';
  currentAdminBankPartnerPage = 1;
  const roleSelect = document.getElementById('admin-bank-role-filter');
  if (roleSelect && roleSelect.value !== currentAdminBankPartnerRole) {
    roleSelect.value = currentAdminBankPartnerRole;
  }
  renderAdminBankPartnersPaginationBar();
  renderAdminBankPartnersTable();
}

function changeAdminBankPartnerPage(page) {
  currentAdminBankPartnerPage = Number(page) || 1;
  renderAdminBankPartnersTable();
}

function renderAdminBankPartnersPaginationBar() {
  const bar = document.getElementById('admin-bank-partners-pagination-bar');
  if (!bar) return;

  const totalAll = cachedAdminBankPartners.length;
  const totalRest = cachedAdminBankPartners.filter((p) => p.role === 'restaurant').length;
  const totalShop = cachedAdminBankPartners.filter((p) => p.role === 'shop').length;
  const totalRider = cachedAdminBankPartners.filter((p) => p.role === 'deliveryPartner').length;
  const totalSubAdmin = cachedAdminBankPartners.filter((p) => p.role === 'subadmin').length;

  const roles = [
    { key: 'all', label: 'All Partners', count: totalAll, icon: '👥' },
    { key: 'restaurant', label: 'Restaurants', count: totalRest, icon: '🏪' },
    { key: 'shop', label: 'Shops', count: totalShop, icon: '🏬' },
    { key: 'deliveryPartner', label: 'Delivery Partners', count: totalRider, icon: '🚴' },
    { key: 'subadmin', label: 'Sub-Admins', count: totalSubAdmin, icon: '🛡️' },
  ];

  bar.innerHTML = `
    <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.4rem 0.65rem;">
      <span style="font-size:0.75rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; margin-right:0.25rem;">
        Partner Roles:
      </span>
      ${roles
        .map((r) => {
          const isActive = currentAdminBankPartnerRole === r.key;
          return `
            <button
              type="button"
              class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}"
              style="border-radius:20px; padding:0.22rem 0.7rem; font-size:0.78rem; font-weight:${isActive ? '700' : '600'}; display:inline-flex; align-items:center; gap:0.35rem; transition:all 0.15s ease; cursor:pointer;"
              onclick="selectAdminBankPartnerRole('${r.key}')"
            >
              <span>${r.icon}</span>
              <span>${r.label}</span>
              <span style="display:inline-block; padding:0.1rem 0.45rem; border-radius:12px; font-size:0.72rem; ${
                isActive
                  ? 'background:rgba(255,255,255,0.28); color:#fff;'
                  : 'background:#e2e8f0; color:#334155; font-weight:700;'
              }">
                ${r.count}
              </span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function loadAdminBankPanel() {
  fetchAdminBankPartners();
}

function switchAdminBankTab(tabName) {
  // Maintained for backward compatibility: if called with settlements, redirect to partner billing tab
  if (tabName === 'settlements') {
    switchView('admin-partner-billing');
    switchAdminPartnerBillingTab('settlements');
    return;
  }
  fetchAdminBankPartners();
}

function refreshAdminBankCurrentTab() {
  fetchAdminBankPartners();
}

async function fetchAdminBankPartners() {
  const container = document.getElementById('admin-bank-partners-table-container');
  const roleFilter = document.getElementById('admin-bank-role-filter')?.value || currentAdminBankPartnerRole || 'all';
  currentAdminBankPartnerRole = roleFilter;
  const statusFilter = document.getElementById('admin-bank-status-filter')?.value || 'all';
  if (container) {
    container.innerHTML = '<div style="padding:1.5rem; text-align:center; color:var(--muted);">Loading partner bank &amp; PAN KYC records...</div>';
  }
  try {
    const res = await apiFetch(
      `/api/admin/bank/partners?role=all&status=${encodeURIComponent(statusFilter)}`
    );
    cachedAdminBankPartners = Array.isArray(res.partners) ? res.partners : [];
    populateAdminBankPartnerDirectory();
    renderAdminBankPartnersKpis(cachedAdminBankPartners);
    renderAdminBankPartnersPaginationBar();
    renderAdminBankPartnersTable();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="empty-state"><p style="color:#dc2626;">Failed to load partner bank details: ${escapeHtml(err.message)}</p></div>`;
    }
  }
}

function renderAdminBankPartnersKpis(partners) {
  const kpiEl = document.getElementById('admin-bank-partners-kpis');
  if (!kpiEl) return;
  const total = partners.length;
  const approvedLocked = partners.filter((p) => p.bankDetails?.isApproved && p.bankDetails?.isLocked).length;
  const pendingVerification = partners.filter((p) => p.bankDetails?.isSubmitted && !p.bankDetails?.isApproved).length;
  const notSubmitted = partners.filter((p) => !p.bankDetails?.isSubmitted).length;

  kpiEl.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:0.7rem 0.85rem;">
    <div style="font-size:0.7rem; color:var(--muted); font-weight:700; text-transform:uppercase;">Total Partners</div>
    <div style="font-size:1.25rem; font-weight:800; color:var(--ink); margin-top:0.15rem;">${total}</div>
    <div style="font-size:0.7rem; color:var(--muted);">Restaurants, Shops, Riders &amp; Sub-Admins</div>
    </div>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:0.7rem 0.85rem;">
    <div style="font-size:0.7rem; color:#15803d; font-weight:700; text-transform:uppercase;">🔒 Approved &amp; Locked</div>
    <div style="font-size:1.25rem; font-weight:800; color:#14532d; margin-top:0.15rem;">${approvedLocked}</div>
    <div style="font-size:0.7rem; color:#166534;">Verified PAN + Bank Match</div>
    </div>
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:0.7rem 0.85rem;">
    <div style="font-size:0.7rem; color:#b45309; font-weight:700; text-transform:uppercase;">⏳ Pending Verification</div>
    <div style="font-size:1.25rem; font-weight:800; color:#92400e; margin-top:0.15rem;">${pendingVerification}</div>
    <div style="font-size:0.7rem; color:#b45309;">Submitted by Partner</div>
    </div>
    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:0.7rem 0.85rem;">
    <div style="font-size:0.7rem; color:#b91c1c; font-weight:700; text-transform:uppercase;">⚠️ Details Missing</div>
    <div style="font-size:1.25rem; font-weight:800; color:#991b1b; margin-top:0.15rem;">${notSubmitted}</div>
    <div style="font-size:0.7rem; color:#b91c1c;">Cannot Be Approved Yet</div>
    </div>
  `;
}

function renderAdminBankPartnersTable() {
  const container = document.getElementById('admin-bank-partners-table-container');
  if (!container) return;
  const q = (document.getElementById('admin-bank-partner-search')?.value || '').trim().toLowerCase();
  const idFilter = (document.getElementById('admin-bank-partner-id-filter')?.value || '').trim().toLowerCase();

  const filtered = cachedAdminBankPartners.filter((p) => {
    if (currentAdminBankPartnerRole !== 'all' && p.role !== currentAdminBankPartnerRole) {
      return false;
    }
    if (idFilter) {
      const idHay = [p.partnerCode, p.id, p._id, p.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!idHay.includes(idFilter)) return false;
    }
    if (!q) return true;
    const bd = p.bankDetails || {};
    const hay = [
      p.displayName,
      p.name,
      p.partnerCode,
      p.id,
      p._id,
      p.email,
      p.phone,
      bd.accountHolderName,
      bd.panHolderName,
      bd.panNumber,
      bd.ifscCode,
      bd.accountNumber,
      bd.bankName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    const roleLabelsMap = {
      restaurant: 'Restaurants',
      shop: 'Shops',
      deliveryPartner: 'Delivery Partners',
      subadmin: 'Sub-Admins',
    };
    const roleScope = roleLabelsMap[currentAdminBankPartnerRole] || 'Partner';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏦</div>
        <h3>No ${escapeHtml(roleScope)} Bank Records Found</h3>
        <p>Try switching partner role tab, changing KYC filter, or clearing your search query.</p>
      </div>
    `;
    return;
  }

  const roleBadge = (r) => {
    if (r === 'restaurant') return '<span class="badge badge-ready">🏪 Restaurant</span>';
    if (r === 'shop') return '<span class="badge badge-accepted">🏬 Shop</span>';
    if (r === 'deliveryPartner') return '<span class="badge badge-pending">🚴 Delivery Partner</span>';
    if (r === 'subadmin') return '<span class="badge" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">🛡️ Sub-Admin</span>';
    return `<span class="badge">${escapeHtml(r)}</span>`;
  };

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ADMIN_BANK_PAGE_SIZE));
  if (currentAdminBankPartnerPage > totalPages) {
    currentAdminBankPartnerPage = totalPages;
  }
  if (currentAdminBankPartnerPage < 1) {
    currentAdminBankPartnerPage = 1;
  }
  const startIndex = (currentAdminBankPartnerPage - 1) * ADMIN_BANK_PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + ADMIN_BANK_PAGE_SIZE);
  const startItem = totalItems === 0 ? 0 : startIndex + 1;
  const endItem = Math.min(startIndex + ADMIN_BANK_PAGE_SIZE, totalItems);

  const pagesToShow = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentAdminBankPartnerPage - 1 && i <= currentAdminBankPartnerPage + 1)) {
      pagesToShow.push(i);
    } else if (pagesToShow[pagesToShow.length - 1] !== '...') {
      pagesToShow.push('...');
    }
  }

  const paginationControls = totalPages > 1 ? `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; padding-top:0.85rem; border-top:1px solid var(--line); flex-wrap:wrap; gap:0.6rem;">
      <div style="font-size:0.83rem; color:var(--muted);">
        Showing <strong>${startItem}–${endItem}</strong> of <strong>${totalItems}</strong> partners (Page <strong>${currentAdminBankPartnerPage}</strong> of <strong>${totalPages}</strong>)
      </div>
      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
        <button
          type="button"
          class="btn btn-outline btn-sm"
          ${currentAdminBankPartnerPage <= 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}
          onclick="changeAdminBankPartnerPage(${currentAdminBankPartnerPage - 1})"
        >◀ Prev</button>
        ${pagesToShow.map((p) => p === '...'
          ? '<span style="color:var(--muted); padding:0 0.25rem;">…</span>'
          : `<button type="button" class="btn ${p === currentAdminBankPartnerPage ? 'btn-primary' : 'btn-outline'} btn-sm" style="padding:0.25rem 0.55rem; font-size:0.8rem; font-weight:${p === currentAdminBankPartnerPage ? '700' : '500'}; cursor:pointer;" onclick="changeAdminBankPartnerPage(${p})">${p}</button>`
        ).join('')}
        <button
          type="button"
          class="btn btn-outline btn-sm"
          ${currentAdminBankPartnerPage >= totalPages ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}
          onclick="changeAdminBankPartnerPage(${currentAdminBankPartnerPage + 1})"
        >Next ▶</button>
      </div>
    </div>
  ` : `
    <div style="font-size:0.8rem; color:var(--muted); margin-top:0.75rem; text-align:right;">
      Showing all <strong>${totalItems}</strong> partner records
    </div>
  `;

  container.innerHTML = `
    <div class="table-responsive">
    <table>
    <thead>
    <tr>
    <th>Partner &amp; ID</th>
    <th>Bank Account &amp; IFSC</th>
    <th>Account Holder vs PAN Card</th>
    <th>Agreement / Access</th>
    <th>KYC &amp; Lock Status</th>
    <th>Actions</th>
    </tr>
    </thead>
    <tbody>
    ${pageItems.map((p) => {
      const bd = p.bankDetails || {};
      const hasSubmitted = Boolean(bd.isSubmitted);
      const isBankApproved = Boolean(bd.isApproved);
      const isLocked = Boolean(bd.isLocked);
      const partnerCodeVal = p.partnerCode || String(p.id || p._id || '').slice(-6);
      let agreementLabel = `Tomato Comm: <strong>${Number(bd.agreementCommissionPercent ?? (p.role === 'shop' ? 12 : 15))}%</strong>`;
      if (p.role === 'deliveryPartner') {
        agreementLabel = `Rider Payout: <strong>₹${Number(bd.riderPayoutPerOrder ?? 40)}/order</strong>`;
      } else if (p.role === 'subadmin') {
        agreementLabel = `Admin Access: <strong>Sub-Admin</strong>`;
      }
      return `<tr>
      <td>
      <div style="font-weight:700; color:var(--ink);">${escapeHtml(p.displayName || p.name)}</div>
      <div style="margin-top:3px; display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
      ${roleBadge(p.role)}
      <span style="font-family:monospace; font-size:0.75rem; font-weight:700; background:#e2e8f0; color:#0f172a; padding:2px 6px; border-radius:5px;">🆔 ${escapeHtml(partnerCodeVal)}</span>
      </div>
      <div style="font-size:0.78rem; color:var(--muted); margin-top:3px;">📞 ${escapeHtml(p.phone || 'N/A')} ${p.email ? `• ✉️ ${escapeHtml(p.email)}` : ''}</div>
      </td>
      <td>
      ${bd.accountNumber ? `
      <div style="font-weight:700;">${escapeHtml(bd.bankName || 'Bank')}</div>
      <div style="font-family:monospace; font-size:0.82rem;">A/C: <strong>${escapeHtml(bd.accountNumber)}</strong></div>
      <div style="font-family:monospace; font-size:0.78rem; color:#1d4ed8;">IFSC: <strong>${escapeHtml(bd.ifscCode || '—')}</strong></div>
      ${bd.upiId ? `<div style="font-size:0.75rem; color:var(--muted);">UPI: ${escapeHtml(bd.upiId)}</div>` : ''}
      ` : '<span style="color:#dc2626; font-size:0.82rem; font-weight:600;">⚠️ Not Submitted</span>'}
      </td>
      <td>
      ${bd.accountHolderName || bd.panNumber ? `
      <div style="font-size:0.82rem;"><strong>Bank Holder:</strong> ${escapeHtml(bd.accountHolderName || '—')}</div>
      <div style="font-size:0.82rem;"><strong>PAN Holder:</strong> ${escapeHtml(bd.panHolderName || '—')}</div>
      <div style="font-family:monospace; font-size:0.8rem; margin-top:2px;">PAN: <strong>${escapeHtml(bd.panNumber || '—')}</strong></div>
      <div style="margin-top:4px;">${p.namesMatch || p.verification?.nameMatched ? '<span class="badge badge-approved" style="font-size:0.7rem;">✓ Bank &amp; PAN Name Match</span>' : '<span class="badge badge-blocked" style="font-size:0.7rem;">✕ Name Mismatch</span>'}</div>
      ` : '<span style="color:var(--muted); font-size:0.8rem;">No PAN / Holder Name</span>'}
      </td>
      <td>
      <div style="font-size:0.84rem;">${agreementLabel}</div>
      ${bd.adminNote ? `<div style="font-size:0.74rem; color:var(--muted); margin-top:2px;">📝 ${escapeHtml(bd.adminNote)}</div>` : ''}
      </td>
      <td>
      <div><span class="badge ${p.isApproved ? 'badge-approved' : 'badge-pending'}">Partner: ${p.isApproved ? 'Approved' : 'Pending'}</span></div>
      <div style="margin-top:4px;">${isBankApproved && isLocked ? '<span class="badge badge-delivered">🔒 Bank Approved &amp; Locked</span>' : hasSubmitted ? '<span class="badge badge-ready">⏳ Submitted (Awaiting Approval)</span>' : '<span class="badge badge-blocked">⚠️ Incomplete KYC</span>'}</div>
      </td>
      <td>
      <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
      <button type="button" class="btn btn-outline btn-sm" style="font-weight:600;" onclick="openAdminBankEditModal('${escapeHtml(String(p.id || p._id || ''))}')">✏️ View / Edit &amp; Configure</button>
      <button type="button" class="btn btn-outline btn-sm" style="font-weight:600; color:#1d4ed8; border-color:#bfdbfe; background:#eff6ff;" onclick="viewPartnerSettlementsById('${escapeHtml(partnerCodeVal)}')" title="Filter payout settlements by this Partner ID">💸 View Payouts</button>
      ${!p.isApproved || !isBankApproved ? `<button type="button" class="btn btn-success btn-sm" onclick="quickApprovePartnerBank('${escapeHtml(String(p.id || p._id || ''))}')" title="Approve Partner & Lock Bank Details">✓ Approve &amp; Lock</button>` : ''}
      </div>
      </td>
      </tr>`;
    }).join('')}
    </tbody>
    </table>
    </div>
    ${paginationControls}
  `;
}

async function openAdminBankModalByUserId(userId) {
  if (!cachedAdminBankPartners.length) {
    try {
    const res = await apiFetch('/api/admin/bank/partners?role=all&status=all');
    cachedAdminBankPartners = Array.isArray(res.partners) ? res.partners : [];
    } catch (_) {}
  }
  openAdminBankEditModal(userId);
}

async function openAdminBankEditModal(userId) {
  let partner = cachedAdminBankPartners.find(
    (p) => String(p.id || p._id) === String(userId)
  );
  if (!partner && userId) {
    try {
    const res = await apiFetch('/api/admin/bank/partners?role=all&status=all');
    cachedAdminBankPartners = Array.isArray(res.partners) ? res.partners : [];
    partner = cachedAdminBankPartners.find(
    (p) => String(p.id || p._id) === String(userId)
    );
    } catch (_) {}
  }
  if (!partner) {
    alert('Partner record could not be loaded. Please click Refresh and try again.');
    return;
  }
  const partnerIdStr = String(partner.id || partner._id);
  const bd = partner.bankDetails || {};
  document.getElementById('admin-bank-edit-user-id').value = partnerIdStr;
  document.getElementById('admin-bank-edit-user-role').value = partner.role;

  const summaryEl = document.getElementById('admin-bank-modal-partner-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
    <div>
    <strong>${escapeHtml(partner.displayName || partner.name)}</strong>
    <span style="color:var(--muted); font-family:monospace; margin-left:6px;">(${escapeHtml(partner.partnerCode || partner.role)})</span>
    <div style="font-size:0.78rem; color:var(--muted);">📞 ${escapeHtml(partner.phone || 'N/A')} • ✉️ ${escapeHtml(partner.email || 'N/A')}</div>
    </div>
    <div>
    <span class="badge ${bd.isLocked ? 'badge-delivered' : 'badge-pending'}">
    ${bd.isLocked ? '🔒 Locked for Partner (Admin Editable)' : '🔓 Editable'}
    </span>
    </div>
    </div>
    `;
  }

  document.getElementById('admin-bank-holder-name').value = bd.accountHolderName || '';
  document.getElementById('admin-pan-holder-name').value = bd.panHolderName || bd.accountHolderName || '';
  document.getElementById('admin-pan-number').value = bd.panNumber || '';
  document.getElementById('admin-bank-name').value = bd.bankName || '';
  document.getElementById('admin-bank-account-number').value = bd.accountNumber || '';
  document.getElementById('admin-bank-ifsc').value = bd.ifscCode || '';
  document.getElementById('admin-bank-upi').value = bd.upiId || '';
  document.getElementById('admin-bank-commission').value = Number(bd.agreementCommissionPercent ?? 15);
  document.getElementById('admin-bank-rider-payout').value = Number(bd.riderPayoutPerOrder ?? 40);
  document.getElementById('admin-bank-note').value = bd.adminNote || '';
  document.getElementById('admin-bank-approve-checkbox').checked = true;
  document.getElementById('admin-bank-lock-checkbox').checked = true;

  const commGroup = document.getElementById('admin-bank-commission-group');
  const riderGroup = document.getElementById('admin-bank-rider-payout-group');
  const noteInput = document.getElementById('admin-bank-note');
  const noteLabel = document.getElementById('admin-bank-note-label');
  const noteHint = document.getElementById('admin-bank-note-hint');
  if (partner.role === 'deliveryPartner') {
    if (commGroup) commGroup.style.display = 'none';
    if (riderGroup) riderGroup.style.display = 'block';
    if (noteLabel) {
      noteLabel.textContent = 'Admin Verification / Agreement Note (Rider Licence Number & Expiry)';
    }
    if (noteInput) {
      noteInput.placeholder = 'Rider has to share Licence number & expiry (e.g. DL No: KA0120200012345 | Expiry: 15/08/2035)';
    }
    if (noteHint) {
      noteHint.textContent = '📌 Rider has to share Licence number & expiry. (Shop and Restaurant has to share FSSAI registration number and expiry.)';
    }
  } else if (partner.role === 'subadmin') {
    if (commGroup) commGroup.style.display = 'none';
    if (riderGroup) riderGroup.style.display = 'none';
    if (noteLabel) {
      noteLabel.textContent = 'Sub-Admin Designation & Bank KYC Note';
    }
    if (noteInput) {
      noteInput.placeholder = 'Sub-Admin designation, permissions, and bank KYC verification note';
    }
    if (noteHint) {
      noteHint.textContent = '📌 Sub-Admin bank account and PAN details verification note.';
    }
  } else {
    if (commGroup) commGroup.style.display = 'block';
    if (riderGroup) riderGroup.style.display = 'none';
    if (noteLabel) {
      noteLabel.textContent = 'Agreement Note (FSSAI Registration Number & Expiry)';
    }
    if (noteInput) {
      noteInput.placeholder = 'Shop and Restaurant has to share FSSAI registration number and expiry (e.g. FSSAI: 11223344556677 | Expiry: 31/12/2028)';
    }
    if (noteHint) {
      noteHint.textContent = '📌 Shop and Restaurant has to share FSSAI registration number and expiry. (Rider has to share Licence number & expiry.)';
    }
  }

  checkAdminBankNameMatchLive();
  openModal('admin-bank-edit-modal');
}

function checkAdminBankNameMatchLive() {
  const holder = (document.getElementById('admin-bank-holder-name')?.value || '').trim();
  const panHolder = (document.getElementById('admin-pan-holder-name')?.value || '').trim();
  const indicator = document.getElementById('admin-bank-name-match-indicator');
  if (!indicator) return;
  if (!holder && !panHolder) {
    indicator.style.display = 'none';
    return;
  }
  indicator.style.display = 'block';
  const normA = holder.replace(/\s+/g, ' ').toLowerCase();
  const normB = panHolder.replace(/\s+/g, ' ').toLowerCase();
  if (normA && normB && normA === normB) {
    indicator.style.background = '#f0fdf4';
    indicator.style.border = '1px solid #86efac';
    indicator.style.color = '#15803d';
    indicator.innerHTML = '✓ Bank Account Holder Name matches PAN Card Name — Eligible for Approval.';
  } else {
    indicator.style.background = '#fef2f2';
    indicator.style.border = '1px solid #fecaca';
    indicator.style.color = '#dc2626';
    indicator.innerHTML = '⚠️ Bank Account Holder Name MUST match Name on PAN Card for partner approval.';
  }
}

async function saveAdminPartnerBankDetails(event) {
  event.preventDefault();
  const userId = document.getElementById('admin-bank-edit-user-id').value;
  if (!userId) return;

  const payload = {
    accountHolderName: document.getElementById('admin-bank-holder-name').value.trim(),
    panHolderName: document.getElementById('admin-pan-holder-name').value.trim(),
    panNumber: document.getElementById('admin-pan-number').value.trim().toUpperCase(),
    bankName: document.getElementById('admin-bank-name').value.trim(),
    accountNumber: document.getElementById('admin-bank-account-number').value.trim(),
    ifscCode: document.getElementById('admin-bank-ifsc').value.trim().toUpperCase(),
    upiId: document.getElementById('admin-bank-upi').value.trim(),
    agreementCommissionPercent: Number(document.getElementById('admin-bank-commission').value || 15),
    riderPayoutPerOrder: Number(document.getElementById('admin-bank-rider-payout').value || 40),
    adminNote: document.getElementById('admin-bank-note').value.trim(),
    approvePartner: document.getElementById('admin-bank-approve-checkbox').checked,
    isLocked: document.getElementById('admin-bank-lock-checkbox').checked,
  };

  try {
    const res = await apiFetch(`/api/admin/bank/partners/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    });
    alert(res.message || 'Partner bank details & approval saved!');
    closeModal('admin-bank-edit-modal');
    fetchAdminBankPartners();
    refreshAdminViews();
  } catch (err) {
    alert(err.message || 'Failed to update partner bank details.');
  }
}

async function quickApprovePartnerBank(userId) {
  try {
    const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/approve`, {
    method: 'POST',
    });
    alert(res.message || 'Partner approved & bank details locked!');
    fetchAdminBankPartners();
    refreshAdminViews();
  } catch (err) {
    const msg = err.message || 'Approval failed';
    if (/pincode|serviceable/i.test(msg)) {
    alert(`🚫 Approval Blocked — Pincode Out of Serviceable Range:\n\n${msg}`);
    return;
    }
    if (confirm(`${msg}\n\nWould you like to open the Bank & PAN verification form for this partner now?`)) {
    openAdminBankEditModal(userId);
    }
  }
}

// -------------------------------------------------------------------------
// SUB-TAB 2: TOMATO CENTRAL ACCOUNT & ORDER PAYOUT SETTLEMENTS
// -------------------------------------------------------------------------
function formatSettlementDateTime(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function populateAdminBankPartnerDirectory(directoryList) {
  const list = Array.isArray(directoryList) && directoryList.length
    ? directoryList
    : cachedAdminBankPartners.map((p) => ({
    id: String(p.id || p._id || ''),
    code: p.partnerCode || String(p.id || p._id || '').slice(-6),
    name: p.displayName || p.name || 'Partner',
    email: p.email || '',
    role: p.role || 'restaurant',
    }));

  const selectEl = document.getElementById('admin-bank-settlement-partner-select');
  const datalistEl = document.getElementById('admin-bank-settlement-id-datalist');
  const currentFilterId = (document.getElementById('admin-bank-settlement-filter-by-id')?.value || '').trim();

  if (selectEl) {
    const restaurants = list.filter((p) => p.role === 'restaurant');
    const shops = list.filter((p) => p.role === 'shop');
    const riders = list.filter((p) => p.role === 'deliveryPartner');

    const renderOpts = (items, icon) =>
    items
    .map(
    (p) =>
    `<option value="${escapeHtml(p.code)}" ${
    currentFilterId &&
    (currentFilterId.toLowerCase() === String(p.code).toLowerCase() ||
    currentFilterId.toLowerCase() === String(p.id).toLowerCase())
    ? 'selected'
    : ''
    }>${icon} ${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`
    )
    .join('');

    selectEl.innerHTML = `
    <option value="">All Partners</option>
    ${restaurants.length ? `<optgroup label="🏪 Restaurants (${restaurants.length})">${renderOpts(restaurants, '🏪')}</optgroup>` : ''}
    ${shops.length ? `<optgroup label="🏬 Shops (${shops.length})">${renderOpts(shops, '🏬')}</optgroup>` : ''}
    ${riders.length ? `<optgroup label="🚴 Riders (${riders.length})">${renderOpts(riders, '🚴')}</optgroup>` : ''}
    `;
  }

  if (datalistEl) {
    datalistEl.innerHTML = list
    .map((p) => {
    const roleLabel = p.role === 'shop' ? 'Shop' : p.role === 'restaurant' ? 'Restaurant' : 'Rider';
    return `<option value="${escapeHtml(p.code)}">${escapeHtml(roleLabel)}: ${escapeHtml(p.name)} (${escapeHtml(p.email || p.id)})</option>`;
    })
    .join('');
  }
}

function onAdminBankPartnerSelectChange(selectedCode) {
  const idInput = document.getElementById('admin-bank-settlement-filter-by-id');
  if (idInput) {
    idInput.value = selectedCode || '';
  }
  fetchAdminBankSettlements();
}
window.onAdminBankPartnerSelectChange = onAdminBankPartnerSelectChange;

function quickFilterSettlementsById(idVal, resetDates = false) {
  const cleanId = String(idVal || '').trim();
  const idInput = document.getElementById('admin-bank-settlement-filter-by-id');
  const selectEl = document.getElementById('admin-bank-settlement-partner-select');
  if (idInput) idInput.value = cleanId;
  if (selectEl) {
    const matchOpt = Array.from(selectEl.options).find(
      (opt) => opt.value.toLowerCase() === cleanId.toLowerCase()
    );
    selectEl.value = matchOpt ? matchOpt.value : '';
  }
  if (resetDates) {
    const fromEl = document.getElementById('admin-bank-settlement-from-date');
    const toEl = document.getElementById('admin-bank-settlement-to-date');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
  }
  fetchAdminBankSettlements();
}
window.quickFilterSettlementsById = quickFilterSettlementsById;

function quickFilterBankPartnerById(idVal) {
  switchView('admin-bank');
  const idInput = document.getElementById('admin-bank-partner-id-filter');
  if (idInput) {
    idInput.value = String(idVal || '').trim();
    renderAdminBankPartnersTable();
  }
}
window.quickFilterBankPartnerById = quickFilterBankPartnerById;

function viewPartnerSettlementsById(idVal) {
  switchView('admin-partner-billing');
  switchAdminPartnerBillingTab('settlements');
  quickFilterSettlementsById(idVal, true);
}
window.viewPartnerSettlementsById = viewPartnerSettlementsById;

function clearAdminBankPartnerIdFilter() {
  const el = document.getElementById('admin-bank-partner-id-filter');
  if (el) el.value = '';
  renderAdminBankPartnersTable();
}
window.clearAdminBankPartnerIdFilter = clearAdminBankPartnerIdFilter;

function clearAdminBankPartnerSearch() {
  const el = document.getElementById('admin-bank-partner-search');
  if (el) el.value = '';
  renderAdminBankPartnersTable();
}
window.clearAdminBankPartnerSearch = clearAdminBankPartnerSearch;

function clearAdminBankSettlementSearch() {
  const el = document.getElementById('admin-bank-settlement-search');
  if (el) el.value = '';
  renderAdminBankSettlementsTable();
}
window.clearAdminBankSettlementSearch = clearAdminBankSettlementSearch;

function clearAdminBankSettlementUserId() {
  const filterIdEl = document.getElementById('admin-bank-settlement-filter-by-id');
  const selectEl = document.getElementById('admin-bank-settlement-partner-select');
  if (filterIdEl) filterIdEl.value = '';
  if (selectEl) selectEl.value = '';
  fetchAdminBankSettlements();
}
window.clearAdminBankSettlementUserId = clearAdminBankSettlementUserId;

let currentAdminBankSettlementActiveWeek = 'all';

function getAdminSettlementWeekBounds(weekStr) {
  if (!weekStr || !/^\d{4}-W\d{2}$/.test(weekStr.trim())) {
    return null;
  }
  const parts = weekStr.trim().split('-W');
  const y = parseInt(parts[0], 10);
  const w = parseInt(parts[1], 10);
  const simple = new Date(Date.UTC(y, 0, 1 + (w - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) {
    monday.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    monday.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const formatYMD = (d) => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const opt = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const startStr = monday.toLocaleDateString('en-IN', opt);
  const endStr = sunday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return {
    fromDate: formatYMD(monday),
    toDate: formatYMD(sunday),
    label: `${startStr} – ${endStr}`,
    weekNum: w,
  };
}

function detectAdminSettlementWeekFromDates(fromDate, toDate) {
  if (!fromDate && !toDate) return 'all';
  if (!fromDate || !toDate) return '';
  try {
    const fromParts = fromDate.split('-').map(Number);
    const toParts = toDate.split('-').map(Number);
    const fromD = new Date(Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]));
    const toD = new Date(Date.UTC(toParts[0], toParts[1] - 1, toParts[2]));
    if (fromD.getUTCDay() === 1 && toD.getUTCDay() === 0 && (toD.getTime() - fromD.getTime() === 6 * 86400000)) {
      if (typeof getAdminCurrentWeekString === 'function') {
        return getAdminCurrentWeekString(fromD);
      }
      if (typeof window.getAdminCurrentWeekString === 'function') {
        return window.getAdminCurrentWeekString(fromD);
      }
    }
  } catch (_) {}
  return '';
}

function selectAdminBankSettlementWeek(targetWeekStr) {
  if (targetWeekStr === 'all') {
    setAdminBankSettlementAllTime();
    return;
  }
  const bounds = getAdminSettlementWeekBounds(targetWeekStr);
  if (!bounds) return;
  currentAdminBankSettlementActiveWeek = targetWeekStr;
  const fromEl = document.getElementById('admin-bank-settlement-from-date');
  const toEl = document.getElementById('admin-bank-settlement-to-date');
  if (fromEl) fromEl.value = bounds.fromDate;
  if (toEl) toEl.value = bounds.toDate;
  fetchAdminBankSettlements();
}

function navigateAdminBankSettlementWeekOffset(offset) {
  const getWeekStr = typeof getAdminCurrentWeekString === 'function'
    ? getAdminCurrentWeekString
    : (typeof window.getAdminCurrentWeekString === 'function' ? window.getAdminCurrentWeekString : null);
  const realCurrentWeek = getWeekStr ? getWeekStr() : '2026-W42';
  const base = (/^\d{4}-W\d{2}$/.test(currentAdminBankSettlementActiveWeek))
    ? currentAdminBankSettlementActiveWeek
    : realCurrentWeek;

  const getOffsetFn = typeof getAdminWeekOffset === 'function'
    ? getAdminWeekOffset
    : (typeof window.getAdminWeekOffset === 'function' ? window.getAdminWeekOffset : null);
  const targetWeek = getOffsetFn ? getOffsetFn(base, offset) : base;
  selectAdminBankSettlementWeek(targetWeek);
}

function renderAdminBankSettlementsWeekPaginationHTML() {
  const fromDate = (document.getElementById('admin-bank-settlement-from-date')?.value || '').trim();
  const toDate = (document.getElementById('admin-bank-settlement-to-date')?.value || '').trim();
  const isAllTime = currentAdminBankSettlementActiveWeek === 'all' || (!fromDate && !toDate);

  const getWeekStr = typeof getAdminCurrentWeekString === 'function'
    ? getAdminCurrentWeekString
    : (typeof window.getAdminCurrentWeekString === 'function' ? window.getAdminCurrentWeekString : null);
  const realCurrentWeek = getWeekStr ? getWeekStr() : '2026-W42';
  const centerWeek = (/^\d{4}-W\d{2}$/.test(currentAdminBankSettlementActiveWeek))
    ? currentAdminBankSettlementActiveWeek
    : realCurrentWeek;

  const getOffsetFn = typeof getAdminWeekOffset === 'function'
    ? getAdminWeekOffset
    : (typeof window.getAdminWeekOffset === 'function' ? window.getAdminWeekOffset : null);

  const weekOffsets = [-3, -2, -1, 0, 1, 2, 3];
  const weekPills = weekOffsets.map((offset) => {
    const wStr = getOffsetFn ? getOffsetFn(centerWeek, offset) : centerWeek;
    const wNum = parseInt(wStr.split('-W')[1], 10);
    const isSelected = !isAllTime && (wStr === currentAdminBankSettlementActiveWeek);
    const isCurrent = (wStr === realCurrentWeek);
    const bounds = getAdminSettlementWeekBounds(wStr);
    const dateRange = bounds ? bounds.label : wStr;

    let btnStyle = 'font-size:0.75rem; padding:0.24rem 0.58rem; min-width:44px; height:29px; font-weight:700; border-radius:6px; cursor:pointer;';
    let btnClass = 'btn btn-outline btn-sm';
    if (isSelected) {
      btnClass = 'btn btn-primary btn-sm';
      btnStyle += ' background:#0f172a; color:#fff; border-color:#0f172a; box-shadow:0 1px 3px rgba(0,0,0,0.18);';
    } else if (isCurrent) {
      btnStyle += ' border-color:#2563eb; color:#1d4ed8; background:#eff6ff;';
    }

    return `
      <button
        type="button"
        class="${btnClass}"
        style="${btnStyle}"
        onclick="selectAdminBankSettlementWeek('${wStr}')"
        title="Week ${wNum}: ${dateRange}${isCurrent ? ' (Current Week)' : ''}"
      >
        w${wNum}${isCurrent ? '<span style="color:#2563eb; font-size:0.55rem; margin-left:2px; vertical-align:super;">●</span>' : ''}
      </button>
    `;
  }).join('');

  let activeDateLabel = '';
  let activeBadgeText = '';

  if (isAllTime) {
    activeBadgeText = 'All Time';
    activeDateLabel = 'All Historical Payout Settlements';
  } else if (/^\d{4}-W\d{2}$/.test(currentAdminBankSettlementActiveWeek)) {
    activeBadgeText = `w${parseInt(currentAdminBankSettlementActiveWeek.split('-W')[1] || '0', 10)}`;
    const bounds = getAdminSettlementWeekBounds(currentAdminBankSettlementActiveWeek);
    activeDateLabel = bounds ? bounds.label : currentAdminBankSettlementActiveWeek;
  } else if (fromDate || toDate) {
    activeBadgeText = 'Custom Range';
    activeDateLabel = `${fromDate || 'Start'} → ${toDate || 'Now'}`;
  } else {
    activeBadgeText = `w${parseInt(centerWeek.split('-W')[1] || '0', 10)}`;
    const bounds = getAdminSettlementWeekBounds(centerWeek);
    activeDateLabel = bounds ? bounds.label : centerWeek;
  }

  return `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:0.55rem 0.85rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
      <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
        <span style="font-size:0.73rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">🗓️ Settlement Cycle:</span>
        <span style="font-size:0.83rem; font-weight:800; color:#0f172a; background:#f1f5f9; padding:0.18rem 0.55rem; border-radius:6px; border:1px solid #cbd5e1; font-family:monospace;">
          ${escapeHtml(activeBadgeText)}
        </span>
        <span style="font-size:0.75rem; color:#475569; font-weight:600;">
          (${escapeHtml(activeDateLabel)})
        </span>
      </div>

      <div style="display:inline-flex; align-items:center; gap:0.25rem; flex-wrap:wrap;">
        <button
          type="button"
          class="btn btn-outline btn-sm"
          style="font-size:0.74rem; padding:0.24rem 0.52rem; height:29px; border-radius:6px;"
          onclick="navigateAdminBankSettlementWeekOffset(-1)"
          title="Go to previous week"
        >
          ◀ Prev
        </button>

        ${weekPills}

        <button
          type="button"
          class="btn btn-outline btn-sm"
          style="font-size:0.74rem; padding:0.24rem 0.52rem; height:29px; border-radius:6px;"
          onclick="navigateAdminBankSettlementWeekOffset(1)"
          title="Go to next week"
        >
          Next ▶
        </button>

        <button
          type="button"
          class="btn ${isAllTime ? 'btn-primary' : 'btn-outline'} btn-sm"
          style="font-size:0.74rem; padding:0.24rem 0.55rem; height:29px; border-radius:6px; ${isAllTime ? 'background:#0f172a; color:#fff; border-color:#0f172a;' : ''}"
          onclick="selectAdminBankSettlementWeek('all')"
          title="View all time settlements without week filter"
        >
          All Time
        </button>
      </div>
    </div>
  `;
}

function renderAdminBankSettlementsWeekPagination() {
  const container = document.getElementById('admin-bank-settlements-weekly-pagination');
  if (container) {
    container.innerHTML = renderAdminBankSettlementsWeekPaginationHTML();
  }
}

function resetAdminBankSettlementDatesToToday() {
  currentAdminBankSettlementActiveWeek = '';
  const todayStr = getAdminTodayDateString();
  const fromEl = document.getElementById('admin-bank-settlement-from-date');
  const toEl = document.getElementById('admin-bank-settlement-to-date');
  if (fromEl) fromEl.value = todayStr;
  if (toEl) toEl.value = todayStr;
  fetchAdminBankSettlements();
}
window.resetAdminBankSettlementDatesToToday = resetAdminBankSettlementDatesToToday;

function setAdminBankSettlementLastMonth() {
  currentAdminBankSettlementActiveWeek = '';
  const now = new Date();
  const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const firstDay = new Date(prevMonthYear, prevMonth, 1);
  const lastDay = new Date(prevMonthYear, prevMonth + 1, 0);

  const formatYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const fromEl = document.getElementById('admin-bank-settlement-from-date');
  const toEl = document.getElementById('admin-bank-settlement-to-date');
  if (fromEl) fromEl.value = formatYMD(firstDay);
  if (toEl) toEl.value = formatYMD(lastDay);
  fetchAdminBankSettlements();
}
window.setAdminBankSettlementLastMonth = setAdminBankSettlementLastMonth;

function setAdminBankSettlementAllTime() {
  currentAdminBankSettlementActiveWeek = 'all';
  const fromEl = document.getElementById('admin-bank-settlement-from-date');
  const toEl = document.getElementById('admin-bank-settlement-to-date');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  fetchAdminBankSettlements();
}
window.setAdminBankSettlementAllTime = setAdminBankSettlementAllTime;

function clearAdminBankSettlementDates() {
  currentAdminBankSettlementActiveWeek = 'all';
  const fromEl = document.getElementById('admin-bank-settlement-from-date');
  const toEl = document.getElementById('admin-bank-settlement-to-date');
  const typeEl = document.getElementById('admin-bank-settlement-type-filter');
  const statusEl = document.getElementById('admin-bank-settlement-status-filter');
  const searchEl = document.getElementById('admin-bank-settlement-search');
  const filterIdEl = document.getElementById('admin-bank-settlement-filter-by-id');
  const selectEl = document.getElementById('admin-bank-settlement-partner-select');

  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  if (typeEl) typeEl.value = 'all';
  if (statusEl) statusEl.value = 'all';
  if (searchEl) searchEl.value = '';
  if (filterIdEl) filterIdEl.value = '';
  if (selectEl) selectEl.value = '';

  fetchAdminBankSettlements();
}
window.clearAdminBankSettlementDates = clearAdminBankSettlementDates;

let adminBankSettlementsLoading = false;

async function fetchAdminBankSettlements() {
  if (adminBankSettlementsLoading) return;
  const container = document.getElementById('admin-bank-settlements-table-container');
  const orderType = document.getElementById('admin-bank-settlement-type-filter')?.value || 'all';
  const status = document.getElementById('admin-bank-settlement-status-filter')?.value || 'all';
  const fromDate = (document.getElementById('admin-bank-settlement-from-date')?.value || '').trim();
  const toDate = (document.getElementById('admin-bank-settlement-to-date')?.value || '').trim();
  const filterById = (document.getElementById('admin-bank-settlement-filter-by-id')?.value || '').trim();

  if (fromDate && toDate && fromDate > toDate) {
    alert('From Date cannot be later than To Date.');
    return;
  }

  const detectedWeek = detectAdminSettlementWeekFromDates(fromDate, toDate);
  if (detectedWeek) {
    currentAdminBankSettlementActiveWeek = detectedWeek;
  } else if (!fromDate && !toDate) {
    currentAdminBankSettlementActiveWeek = 'all';
  } else {
    currentAdminBankSettlementActiveWeek = '';
  }
  renderAdminBankSettlementsWeekPagination();

  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
        <div style="font-size:1.8rem; margin-bottom:0.4rem; animation:spin 1s linear infinite;">⏳</div>
        <p style="font-size:0.9rem; font-weight:600;">Loading Tomato central account receipts &amp; partner settlements...</p>
      </div>
    `;
  }
  adminBankSettlementsLoading = true;
  try {
    const queryParams = new URLSearchParams({
      orderType,
      payoutStatus: status,
    });
    if (fromDate) queryParams.set('fromDate', fromDate);
    if (toDate) queryParams.set('toDate', toDate);
    if (filterById) queryParams.set('filterById', filterById);

    const res = await apiFetch(
      `/api/admin/bank/settlements?${queryParams.toString()}`
    );
    cachedAdminBankSettlements = Array.isArray(res.settlements) ? res.settlements : [];
    if (Array.isArray(res.partnerDirectory)) {
      populateAdminBankPartnerDirectory(res.partnerDirectory);
    }
    renderAdminBankSettlementsKpis(res.summary || {});
    renderAdminBankSettlementsWeekPagination();
    renderAdminBankSettlementsTable();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="empty-state"><p style="color:#dc2626;">Failed to load settlements: ${escapeHtml(err.message)}</p></div>`;
    }
  } finally {
    adminBankSettlementsLoading = false;
  }
}
window.fetchAdminBankSettlements = fetchAdminBankSettlements;

function renderAdminBankSettlementsKpis(summary) {
  const kpiEl = document.getElementById('admin-bank-settlements-kpis');
  if (!kpiEl) return;
  const totalRecv = Number(summary.totalReceivedInTomatoAccount ?? summary.tomatoTotalReceived ?? 0);
  const totalComm = Number(summary.totalTomatoCommission ?? summary.tomatoCommissionEarned ?? 0);
  const totalOrds = Number(summary.totalOrders ?? summary.totalOrdersTracked ?? 0);
  const netBalance = Number(
    summary.tomatoNetBankBalance ??
    totalRecv - Number(summary.completedPartnerPayouts || 0) - Number(summary.completedRiderPayouts || 0)
  );
  const fromDateVal = (document.getElementById('admin-bank-settlement-from-date')?.value || '').trim();
  const toDateVal = (document.getElementById('admin-bank-settlement-to-date')?.value || '').trim();
  const filterIdVal = (document.getElementById('admin-bank-settlement-filter-by-id')?.value || '').trim();
  const todayStr = getAdminTodayDateString();
  const periodBadgeEl = document.getElementById('admin-bank-settlements-period-badge');

  const userFilterBadge = filterIdVal
    ? `<span class="badge badge-accepted" style="font-size:0.72rem; margin-left:0.35rem;">User: ${escapeHtml(filterIdVal)}</span>`
    : '';

  if (periodBadgeEl) {
    if (!fromDateVal && !toDateVal) {
    periodBadgeEl.innerHTML = `<span class="badge badge-accepted" style="font-size:0.72rem;">All Time</span>${userFilterBadge} All fields &amp; settlements below reflect payout activity across all dates`;
    } else if (fromDateVal === todayStr && toDateVal === todayStr) {
    periodBadgeEl.innerHTML = `<span class="badge badge-delivered" style="font-size:0.72rem;">Today: ${escapeHtml(todayStr)}</span>${userFilterBadge} All fields &amp; settlements below reflect activity for today`;
    } else {
    const rangeText = `${fromDateVal || 'Beginning'} to ${toDateVal || 'Present'}`;
    periodBadgeEl.innerHTML = `<span class="badge badge-preparing" style="font-size:0.72rem;">Period: ${escapeHtml(rangeText)}</span>${userFilterBadge} All fields &amp; settlements below reflect activity for selected range`;
    }
  }

  const filterNoteParts = [];
  if (filterIdVal) filterNoteParts.push(`🆔 ${filterIdVal}`);
  if (fromDateVal || toDateVal) {
    filterNoteParts.push(`📅 ${fromDateVal || 'Start'} → ${toDateVal || 'Today'}`);
  }
  const dateRangeNote = filterNoteParts.length
    ? filterNoteParts.join(' • ')
    : `${totalOrds} Total Orders Credited`;

  kpiEl.innerHTML = `
    <div onclick="filterSettlementsQuickStatus('all')" title="Click to view all order settlements" style="cursor:pointer; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:0.7rem 0.85rem; transition:transform 0.15s ease, box-shadow 0.15s ease;">
      <div style="font-size:0.7rem; color:#1d4ed8; font-weight:700; text-transform:uppercase;">🏦 Credited to Tomato A/C</div>
      <div style="font-size:1.25rem; font-weight:800; color:#1e3a8a; margin-top:0.15rem;">₹${totalRecv.toLocaleString('en-IN')}</div>
      <div style="font-size:0.7rem; color:#1e40af;">${escapeHtml(dateRangeNote)} (${totalOrds} Orders)</div>
    </div>
    <div title="Net central account balance after disbursed payouts" style="background:#ecfeff; border:1px solid #a5f3fc; border-radius:10px; padding:0.7rem 0.85rem;">
      <div style="font-size:0.7rem; color:#0e7490; font-weight:700; text-transform:uppercase;">🏛️ Available in Tomato A/C</div>
      <div style="font-size:1.25rem; font-weight:800; color:#155e75; margin-top:0.15rem;">₹${netBalance.toLocaleString('en-IN')}</div>
      <div style="font-size:0.7rem; color:#0e7490;">After Partner &amp; Rider Payouts</div>
    </div>
    <div onclick="filterSettlementsQuickStatus('paid')" title="Click to view orders with retained commission" style="cursor:pointer; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:0.7rem 0.85rem; transition:transform 0.15s ease, box-shadow 0.15s ease;">
      <div style="font-size:0.7rem; color:#15803d; font-weight:700; text-transform:uppercase;">💰 Commission Retained</div>
      <div style="font-size:1.25rem; font-weight:800; color:#14532d; margin-top:0.15rem;">₹${totalComm.toLocaleString('en-IN')}</div>
      <div style="font-size:0.7rem; color:#166534;">Based on Partner Agreements</div>
    </div>
    <div onclick="filterSettlementsQuickStatus('pending_partner')" title="Click to filter settlements with pending partner payouts" style="cursor:pointer; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:0.7rem 0.85rem; transition:transform 0.15s ease, box-shadow 0.15s ease;">
      <div style="font-size:0.7rem; color:#b45309; font-weight:700; text-transform:uppercase;">🏪 Pending Partner Payouts ↗</div>
      <div style="font-size:1.25rem; font-weight:800; color:#92400e; margin-top:0.15rem;">₹${Number(summary.pendingPartnerPayouts || 0).toLocaleString('en-IN')}</div>
      <div style="font-size:0.7rem; color:#b45309;">Settled: ₹${Number(summary.completedPartnerPayouts || 0).toLocaleString('en-IN')}</div>
    </div>
    <div onclick="filterSettlementsQuickStatus('pending_rider')" title="Click to filter settlements with pending rider payouts" style="cursor:pointer; background:#fef3c7; border:1px solid #fde047; border-radius:10px; padding:0.7rem 0.85rem; transition:transform 0.15s ease, box-shadow 0.15s ease;">
      <div style="font-size:0.7rem; color:#a16207; font-weight:700; text-transform:uppercase;">🚴 Pending Rider Payouts ↗</div>
      <div style="font-size:1.25rem; font-weight:800; color:#854d0e; margin-top:0.15rem;">₹${Number(summary.pendingRiderPayouts || 0).toLocaleString('en-IN')}</div>
      <div style="font-size:0.7rem; color:#a16207;">Settled: ₹${Number(summary.completedRiderPayouts || 0).toLocaleString('en-IN')}</div>
    </div>
  `;
}

function filterSettlementsQuickStatus(mode) {
  const statusEl = document.getElementById('admin-bank-settlement-status-filter');
  if (!statusEl) return;
  if (mode === 'pending_partner' || mode === 'pending_rider') {
    statusEl.value = 'pending';
  } else if (mode === 'paid') {
    statusEl.value = 'paid';
  } else {
    statusEl.value = 'all';
  }
  fetchAdminBankSettlements();
}
window.filterSettlementsQuickStatus = filterSettlementsQuickStatus;

function renderAdminBankSettlementsTable() {
  const container = document.getElementById('admin-bank-settlements-table-container');
  if (!container) return;
  const q = (document.getElementById('admin-bank-settlement-search')?.value || '').trim().toLowerCase();
  const idFilter = (document.getElementById('admin-bank-settlement-filter-by-id')?.value || '').trim().toLowerCase();

  const filtered = cachedAdminBankSettlements.filter((s) => {
    if (idFilter) {
      const idHay = [
        s.partnerCode,
        s.partnerId,
        s.partnerEmail,
        s.partnerName,
        s.riderCode,
        s.riderId,
        s.riderEmail,
        s.riderName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!idHay.includes(idFilter)) return false;
    }
    if (!q) return true;
    const hay = [
      s.orderNumber,
      s.partnerName,
      s.partnerCode,
      s.partnerId,
      s.riderName,
      s.riderCode,
      s.riderId,
      s.transactionId,
      s.partnerPayoutRef,
      s.partnerPayoutReference,
      s.riderPayoutRef,
      s.riderPayoutReference,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <h3>No Order Payment Settlements Found</h3>
        <p>No settlements match the selected Shop/Restaurant ID, date range, or filter criteria. Try adjusting the Filter by ID / From–To dates or clicking "Clear Filters".</p>
      </div>
      <div style="margin-top:0.85rem;">
        ${renderAdminBankSettlementsWeekPaginationHTML()}
      </div>
    `;
    return;
  }

  const pendingPartnerTotal = filtered
    .filter(s => s.partnerPayoutStatus !== 'approved_paid' && s.partnerPayoutStatus !== 'paid')
    .reduce((sum, s) => sum + Number(s.partnerPayoutAmount || 0), 0);
  const pendingRiderTotal = filtered
    .filter(s => s.riderId && s.riderPayoutStatus !== 'approved_paid' && s.riderPayoutStatus !== 'paid')
    .reduce((sum, s) => sum + Number(s.riderPayoutAmount || 0), 0);
  const pendingCount = filtered.filter(
    s => s.partnerPayoutStatus !== 'approved_paid' || (s.riderId && s.riderPayoutStatus !== 'approved_paid')
  ).length;

  const totalReceived = filtered.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0);
  const totalPartnerPayout = filtered.reduce((sum, s) => sum + Number(s.partnerPayoutAmount || 0), 0);
  const paidPartnerPayout = filtered
    .filter(s => s.partnerPayoutStatus === 'approved_paid' || s.partnerPayoutStatus === 'paid')
    .reduce((sum, s) => sum + Number(s.partnerPayoutAmount || 0), 0);
  const totalRiderPayout = filtered.reduce((sum, s) => sum + Number(s.riderPayoutAmount || 0), 0);
  const paidRiderPayout = filtered
    .filter(s => s.riderId && (s.riderPayoutStatus === 'approved_paid' || s.riderPayoutStatus === 'paid'))
    .reduce((sum, s) => sum + Number(s.riderPayoutAmount || 0), 0);
  const totalTomatoComm = filtered.reduce((sum, s) => sum + Number(s.tomatoCommissionAmount || 0), 0);
  const totalOutflow = totalPartnerPayout + totalRiderPayout;
  const totalPendingAll = pendingPartnerTotal + pendingRiderTotal;

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem; padding:0.4rem 0.85rem; background:#f8fafc; border:1px solid var(--line); border-radius:8px; font-size:0.78rem; flex-wrap:wrap; gap:0.5rem;">
      <div>
        Showing <strong>${filtered.length}</strong> settlements
        ${pendingCount > 0 ? `• <span style="color:#b91c1c; font-weight:700;">⏳ ${pendingCount} orders with pending payouts (₹${(pendingPartnerTotal + pendingRiderTotal).toLocaleString('en-IN')})</span>` : '• <span style="color:#15803d; font-weight:700;">✅ All displayed payouts are settled</span>'}
      </div>
      <div style="font-size:0.72rem; color:var(--muted);">
        Partner Pending: <strong>₹${pendingPartnerTotal.toLocaleString('en-IN')}</strong> • Rider Pending: <strong>₹${pendingRiderTotal.toLocaleString('en-IN')}</strong>
      </div>
    </div>
    <div class="table-responsive">
      <table>
        <thead>
          <tr>
            <th>Order &amp; Tomato Receipt</th>
            <th>Shop / Restaurant Payout (ID)</th>
            <th>Rider Delivery Payout (ID)</th>
            <th>Tomato Net Share</th>
            <th>Approve &amp; Send Payout</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((s) => {
            const pBank = s.partnerBankDetails || s.partnerBankSnapshot || {};
            const rBank = s.riderBankDetails || s.riderBankSnapshot || {};
            const partnerPaid = s.partnerPayoutStatus === 'approved_paid' || s.partnerPayoutStatus === 'paid';
            const riderPaid = s.riderPayoutStatus === 'approved_paid' || s.riderPayoutStatus === 'paid';
            const partnerRef = s.partnerPayoutRef || s.partnerPayoutReference || 'UTR';
            const riderRef = s.riderPayoutRef || s.riderPayoutReference || 'UTR';
            const hasRider = Boolean(s.riderId);
            const partnerCodeLabel = s.partnerCode || (s.partnerId ? `${s.orderType === 'shop' ? 'SHOP' : 'REST'}-${String(s.partnerId).slice(-6).toUpperCase()}` : '');
            const riderCodeLabel = s.riderCode || (s.riderId ? `RDR-${String(s.riderId).slice(-6).toUpperCase()}` : '');
            const receiptDateLabel = formatSettlementDateTime(s.tomatoReceivedAt || s.createdAt);
            const partnerPaidDateLabel = formatSettlementDateTime(s.partnerPaidAt);
            const riderPaidDateLabel = formatSettlementDateTime(s.riderPaidAt);
            const hasPartnerBank = Boolean(pBank.accountNumber);
            const hasRiderBank = Boolean(rBank.accountNumber);

            return `<tr>
              <td>
                <div style="font-weight:700; color:var(--ink);">Order #${escapeHtml(s.orderNumber || String(s.orderId).slice(-6))}</div>
                ${receiptDateLabel ? `<div style="font-size:0.73rem; color:#475569; font-weight:600; margin-top:1px;">📅 ${escapeHtml(receiptDateLabel)}</div>` : ''}
                <div style="font-size:0.88rem; font-weight:800; color:#15803d; margin-top:2px;">Received: ₹${Number(s.totalAmount || 0).toLocaleString('en-IN')}</div>
                <div style="font-size:0.75rem; color:var(--muted);">Method: <strong>${escapeHtml((s.paymentMethod || 'online').toUpperCase())}</strong> • Status: <strong>${escapeHtml(s.orderStatus || 'placed')}</strong></div>
                <div style="margin-top:3px;"><span class="badge ${s.tomatoAccountStatus === 'received' ? 'badge-approved' : 'badge-pending'}" style="font-size:0.68rem;">${s.tomatoAccountStatus === 'received' ? '🏦 In Tomato Escrow' : '⏳ COD Collection Pending'}</span></div>
              </td>
              <td>
                <div style="font-weight:700; display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
                  <span>${s.orderType === 'shop' ? '🏬' : '🏪'} ${escapeHtml(s.partnerName || 'Partner')}</span>
                  ${partnerCodeLabel ? `<span onclick="quickFilterSettlementsById('${escapeHtml(partnerCodeLabel)}')" title="Click to filter settlements by ${escapeHtml(partnerCodeLabel)}" style="cursor:pointer; font-family:monospace; font-size:0.72rem; font-weight:700; background:#dbeafe; color:#1e40af; padding:1px 6px; border-radius:5px; border:1px solid #bfdbfe;">🆔 ${escapeHtml(partnerCodeLabel)}</span>` : ''}
                </div>
                <div style="font-size:0.84rem; color:#1d4ed8; font-weight:700; margin-top:2px;">Payout: ₹${Number(s.partnerPayoutAmount || 0).toLocaleString('en-IN')} <span style="font-size:0.74rem; color:var(--muted); font-weight:500;">(Agr: ${Number(s.agreementCommissionPercent || 15)}% comm)</span></div>
                ${hasPartnerBank ? `<div style="font-family:monospace; font-size:0.74rem; color:var(--muted);">A/C: ${escapeHtml(pBank.accountNumber)} (${escapeHtml(pBank.ifscCode || '')})</div>` : '<div style="font-size:0.73rem; color:#dc2626; font-weight:600;">⚠️ Bank Details Not Approved</div>'}
                <div style="margin-top:4px;">
                  <span class="badge ${partnerPaid ? 'badge-delivered' : 'badge-pending'}" style="font-size:0.7rem;">${partnerPaid ? `✅ Paid (${escapeHtml(partnerRef)})` : '⏳ Pending Transfer'}</span>
                  ${partnerPaid && partnerPaidDateLabel ? `<div style="font-size:0.7rem; color:#15803d; margin-top:2px;">Paid: ${escapeHtml(partnerPaidDateLabel)}</div>` : ''}
                </div>
              </td>
              <td>
                ${hasRider ? `
                  <div style="font-weight:700; display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
                    <span>🚴 ${escapeHtml(s.riderName || 'Rider')}</span>
                    ${riderCodeLabel ? `<span onclick="quickFilterSettlementsById('${escapeHtml(riderCodeLabel)}')" title="Click to filter settlements by ${escapeHtml(riderCodeLabel)}" style="cursor:pointer; font-family:monospace; font-size:0.72rem; font-weight:700; background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:5px; border:1px solid #fde68a;">🆔 ${escapeHtml(riderCodeLabel)}</span>` : ''}
                  </div>
                  <div style="font-size:0.84rem; color:#15803d; font-weight:700; margin-top:2px;">Payout: ₹${Number(s.riderPayoutAmount || 0).toLocaleString('en-IN')}</div>
                  ${hasRiderBank ? `<div style="font-family:monospace; font-size:0.74rem; color:var(--muted);">A/C: ${escapeHtml(rBank.accountNumber)} (${escapeHtml(rBank.ifscCode || '')})</div>` : '<div style="font-size:0.73rem; color:#dc2626; font-weight:600;">⚠️ Rider Bank Not Approved</div>'}
                  <div style="margin-top:4px;">
                    <span class="badge ${riderPaid ? 'badge-delivered' : 'badge-pending'}" style="font-size:0.7rem;">${riderPaid ? `✅ Paid (${escapeHtml(riderRef)})` : '⏳ Pending Transfer'}</span>
                    ${riderPaid && riderPaidDateLabel ? `<div style="font-size:0.7rem; color:#15803d; margin-top:2px;">Paid: ${escapeHtml(riderPaidDateLabel)}</div>` : ''}
                  </div>
                ` : '<span style="color:var(--muted); font-size:0.8rem;">No Rider Assigned</span>'}
              </td>
              <td>
                <div style="font-weight:800; color:#0f172a;">₹${Number(s.tomatoCommissionAmount || 0).toLocaleString('en-IN')}</div>
                <div style="font-size:0.74rem; color:var(--muted);">Commission (${Number(s.agreementCommissionPercent || 15)}%)</div>
              </td>
              <td>
                <div style="display:flex; flex-direction:column; gap:0.35rem;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="openAdminSettlementAgreementModal('${escapeHtml(String(s._id))}')">⚙️ Configure Agreement</button>
                  ${!partnerPaid ? (hasPartnerBank ? `
                    <button type="button" class="btn btn-success btn-sm" onclick="approveAndSendTomatoPayout('${escapeHtml(String(s._id))}', 'partner', this)">💸 Pay ${s.orderType === 'shop' ? 'Shop' : 'Restaurant'} (₹${Number(s.partnerPayoutAmount || 0)})</button>
                  ` : `
                    <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c; border-color:#fca5a5; font-size:0.72rem; padding:0.2rem 0.5rem;" onclick="quickFilterBankPartnerById('${escapeHtml(s.partnerCode || s.partnerId)}')" title="Verify partner bank details in KYC panel">⚠️ Complete Partner KYC</button>
                  `) : ''}
                  ${hasRider && !riderPaid ? (hasRiderBank ? `
                    <button type="button" class="btn btn-primary btn-sm" onclick="approveAndSendTomatoPayout('${escapeHtml(String(s._id))}', 'rider', this)">🚴 Pay Rider (₹${Number(s.riderPayoutAmount || 0)})</button>
                  ` : `
                    <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c; border-color:#fca5a5; font-size:0.72rem; padding:0.2rem 0.5rem;" onclick="quickFilterBankPartnerById('${escapeHtml(s.riderCode || s.riderId)}')" title="Verify rider bank details in KYC panel">⚠️ Complete Rider KYC</button>
                  `) : ''}
                  ${!partnerPaid && hasRider && !riderPaid && hasPartnerBank && hasRiderBank ? `
                    <button type="button" class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:700;" onclick="approveAndSendTomatoPayout('${escapeHtml(String(s._id))}', 'both', this)">✓ Approve &amp; Pay Both</button>
                  ` : ''}
                  ${partnerPaid && (!hasRider || riderPaid) ? `
                    <div style="font-size:0.75rem; color:#15803d; font-weight:700; margin-top:0.2rem;">✅ Payouts Disbursed</div>
                  ` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
          <tr style="background:#f8fafc; font-weight:700; border-top:2px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
            <td>
              <div style="font-size:0.88rem; font-weight:800; color:#0f172a;">Total (${filtered.length})</div>
              <div style="font-size:0.72rem; color:var(--muted); font-weight:500;">All Filtered Settlements</div>
              <div style="font-size:0.95rem; font-weight:800; color:#15803d; margin-top:3px;">
                Received: ₹${totalReceived.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.72rem; color:var(--muted); margin-top:1px;">Customer Payments in Escrow</div>
            </td>
            <td>
              <div style="font-size:0.88rem; font-weight:800; color:#1d4ed8;">
                Payout: ₹${totalPartnerPayout.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.73rem; color:#15803d; font-weight:600; margin-top:2px;">
                Disbursed: ₹${paidPartnerPayout.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.73rem; color:${pendingPartnerTotal > 0 ? '#b91c1c' : '#15803d'}; font-weight:600;">
                ${pendingPartnerTotal > 0 ? `Pending: ₹${pendingPartnerTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'All Partner Payouts Paid'}
              </div>
            </td>
            <td>
              <div style="font-size:0.88rem; font-weight:800; color:#15803d;">
                Payout: ₹${totalRiderPayout.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.73rem; color:#15803d; font-weight:600; margin-top:2px;">
                Disbursed: ₹${paidRiderPayout.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.73rem; color:${pendingRiderTotal > 0 ? '#b91c1c' : '#15803d'}; font-weight:600;">
                ${pendingRiderTotal > 0 ? `Pending: ₹${pendingRiderTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'All Rider Payouts Paid'}
              </div>
            </td>
            <td>
              <div style="font-size:0.95rem; font-weight:800; color:#0f172a;">
                ₹${totalTomatoComm.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.73rem; color:var(--muted); font-weight:600; margin-top:2px;">Tomato Retained Comm</div>
            </td>
            <td>
              <div style="font-size:0.84rem; font-weight:800; color:#0f172a;">
                Total Outflow: ₹${totalOutflow.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style="margin-top:4px;">
                <span class="badge ${totalPendingAll > 0 ? 'badge-pending' : 'badge-delivered'}" style="font-size:0.74rem; font-weight:700;">
                  ${totalPendingAll > 0 ? `⏳ ${pendingCount} Pending (₹${totalPendingAll.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '✅ All Disbursed'}
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:0.85rem;">
      ${renderAdminBankSettlementsWeekPaginationHTML()}
    </div>
  `;
}

let adminBankSettlementSearchDebounce = null;
function debouncedRenderAdminBankSettlementsTable() {
  clearTimeout(adminBankSettlementSearchDebounce);
  adminBankSettlementSearchDebounce = setTimeout(() => {
    renderAdminBankSettlementsTable();
  }, 100);
}
window.debouncedRenderAdminBankSettlementsTable = debouncedRenderAdminBankSettlementsTable;

function openAdminSettlementAgreementModal(paymentId) {
  const s = cachedAdminBankSettlements.find((item) => String(item._id) === String(paymentId));
  if (!s) return;
  currentEditingSettlementObj = s;
  document.getElementById("admin-settlement-payment-id").value = String(s._id);
  document.getElementById("admin-settlement-commission-input").value = Number(s.agreementCommissionPercent ?? 15);
  document.getElementById("admin-settlement-rider-payout-input").value = Number(s.riderPayoutAmount ?? 40);
  document.getElementById("admin-settlement-note-input").value = s.adminNote || "";

  const summaryEl = document.getElementById("admin-settlement-order-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div><strong>Order #${escapeHtml(s.orderNumber || "")}</strong> • Total Received by Tomato: <strong>₹${Number(s.totalAmount || 0).toLocaleString('en-IN')}</strong></div>
      <div style="font-size:0.8rem; color:var(--muted); margin-top:2px;">
        Partner: ${escapeHtml(s.partnerName || "")} ${s.riderName ? `• Rider: ${escapeHtml(s.riderName)}` : ""}
      </div>
    `;
  }
  previewAdminSettlementBreakdown();
  openModal("admin-settlement-agreement-modal");
}

function previewAdminSettlementBreakdown() {
  if (!currentEditingSettlementObj) return;
  const total = Number(currentEditingSettlementObj.totalAmount || 0);
  const commPct = Math.max(0, Math.min(100, Number(document.getElementById("admin-settlement-commission-input")?.value || 0)));
  const riderAmt = Math.max(0, Number(document.getElementById("admin-settlement-rider-payout-input")?.value || 0));
  const baseForPartner = Math.max(0, total - riderAmt);
  const commAmt = Math.round(((baseForPartner * commPct) / 100) * 100) / 100;
  const partnerAmt = Math.max(0, Math.round((baseForPartner - commAmt) * 100) / 100);

  const previewEl = document.getElementById("admin-settlement-breakdown-preview");
  if (previewEl) {
    previewEl.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px;">Live Settlement Breakdown (from ₹${total.toLocaleString('en-IN')} Order Total):</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.4rem; margin-top:0.35rem; font-size:0.82rem;">
        <div>• Store Volume Base: <strong>₹${baseForPartner.toLocaleString('en-IN')}</strong></div>
        <div>• Rider Delivery Payout: <strong>₹${riderAmt.toLocaleString('en-IN')}</strong></div>
        <div>• Tomato Commission (${commPct}%): <strong>₹${commAmt.toLocaleString('en-IN')}</strong></div>
        <div style="color:#1d4ed8; font-weight:700;">• Net ${currentEditingSettlementObj.orderType === "shop" ? "Shop" : "Restaurant"} Payout: <strong>₹${partnerAmt.toLocaleString('en-IN')}</strong></div>
      </div>
    `;
  }
}

async function saveAdminSettlementAgreement(event) {
  event.preventDefault();
  const paymentId = document.getElementById("admin-settlement-payment-id").value;
  if (!paymentId) return;

  const payload = {
    agreementCommissionPercent: Number(document.getElementById("admin-settlement-commission-input").value || 15),
    riderPayoutAmount: Number(document.getElementById("admin-settlement-rider-payout-input").value || 40),
    adminNote: document.getElementById("admin-settlement-note-input").value.trim(),
  };

  try {
    const res = await apiFetch(`/api/admin/bank/settlements/${encodeURIComponent(paymentId)}/agreement`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (typeof showToast === 'function') {
      showToast(res.message || "Payout agreement updated!", 'success');
    } else {
      alert(res.message || "Payout agreement updated!");
    }
    closeModal("admin-settlement-agreement-modal");
    fetchAdminBankSettlements();
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(err.message || "Failed to update agreement.", 'error');
    } else {
      alert(err.message || "Failed to update agreement.");
    }
  }
}

let adminPayoutProcessingMap = {};

async function approveAndSendTomatoPayout(paymentId, target, btnElement) {
  const lockKey = `${paymentId}_${target}`;
  if (adminPayoutProcessingMap[lockKey]) return;

  const targetDesc =
    target === "both"
      ? "both the Partner (Shop/Restaurant) and the Rider"
      : target === "rider"
      ? "the Rider"
      : "the Partner (Shop/Restaurant)";
  if (!confirm(`Approve and transfer payout from Tomato's central account to ${targetDesc}?`)) {
    return;
  }

  adminPayoutProcessingMap[lockKey] = true;
  let originalBtnHtml = '';
  if (btnElement && btnElement.innerHTML) {
    originalBtnHtml = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = '⏳ Processing...';
  }

  try {
    const res = await apiFetch(`/api/admin/bank/settlements/${encodeURIComponent(paymentId)}/payout`, {
      method: "POST",
      body: JSON.stringify({ target }),
    });
    if (typeof showToast === 'function') {
      showToast(res.message || "Payout approved and transferred successfully!", 'success');
    } else {
      alert(res.message || "Payout approved and transferred successfully!");
    }
    await fetchAdminBankSettlements();
    if (typeof fetchAdminPartnerBilling === 'function' && typeof adminPartnerBillingData !== 'undefined' && adminPartnerBillingData.length) {
      fetchAdminPartnerBilling();
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(err.message || "Payout transfer failed.", 'error');
    } else {
      alert(err.message || "Payout transfer failed.");
    }
  } finally {
    delete adminPayoutProcessingMap[lockKey];
    if (btnElement && originalBtnHtml) {
      btnElement.disabled = false;
      btnElement.innerHTML = originalBtnHtml;
    }
  }
}

function formatYMDLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getBeginningOfLastWeekDate(refDate = new Date()) {
  const d = new Date(refDate);
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const currentMonday = new Date(d);
  currentMonday.setDate(d.getDate() + diffToMonday);

  const lastWeekMonday = new Date(currentMonday);
  lastWeekMonday.setDate(currentMonday.getDate() - 7);
  return lastWeekMonday;
}

function getDefaultSettlementExportDateRange() {
  const now = new Date();
  const lastWeekMonday = getBeginningOfLastWeekDate(now);
  return {
    fromDate: formatYMDLocal(lastWeekMonday),
    toDate: formatYMDLocal(now),
  };
}

function setAdminSettlementExportDefaultPreset() {
  const defaults = getDefaultSettlementExportDateRange();
  const fromEl = document.getElementById('admin-settlement-export-from-date');
  const toEl = document.getElementById('admin-settlement-export-to-date');
  if (fromEl) fromEl.value = defaults.fromDate;
  if (toEl) toEl.value = defaults.toDate;
}

function setAdminSettlementExportCurrentWeekPreset() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fromEl = document.getElementById('admin-settlement-export-from-date');
  const toEl = document.getElementById('admin-settlement-export-to-date');
  if (fromEl) fromEl.value = formatYMDLocal(monday);
  if (toEl) toEl.value = formatYMDLocal(sunday);
}

function setAdminSettlementExportLastWeekPreset() {
  const now = new Date();
  const lastWeekMonday = getBeginningOfLastWeekDate(now);
  const lastWeekSunday = new Date(lastWeekMonday);
  lastWeekSunday.setDate(lastWeekMonday.getDate() + 6);

  const fromEl = document.getElementById('admin-settlement-export-from-date');
  const toEl = document.getElementById('admin-settlement-export-to-date');
  if (fromEl) fromEl.value = formatYMDLocal(lastWeekMonday);
  if (toEl) toEl.value = formatYMDLocal(lastWeekSunday);
}

function setAdminSettlementExportCurrentFilterPreset() {
  const dashFrom = (document.getElementById('admin-bank-settlement-from-date')?.value || '').trim();
  const dashTo = (document.getElementById('admin-bank-settlement-to-date')?.value || '').trim();
  const fromEl = document.getElementById('admin-settlement-export-from-date');
  const toEl = document.getElementById('admin-settlement-export-to-date');

  if (dashFrom && dashTo) {
    if (fromEl) fromEl.value = dashFrom;
    if (toEl) toEl.value = dashTo;
  } else {
    setAdminSettlementExportDefaultPreset();
  }
}

function openAdminSettlementExportModal() {
  const modal = document.getElementById('admin-settlement-export-modal');
  setAdminSettlementExportDefaultPreset();

  if (modal && typeof openModal === 'function') {
    openModal('admin-settlement-export-modal');
  } else {
    const defaults = getDefaultSettlementExportDateRange();
    const fromInput = prompt('Enter Period From Date (YYYY-MM-DD):', defaults.fromDate);
    if (!fromInput) return;
    const toInput = prompt('Enter Period To Date (YYYY-MM-DD):', defaults.toDate);
    if (!toInput) return;
    performAdminBankSettlementsExport(fromInput, toInput);
  }
}

async function submitAdminSettlementExport(e) {
  if (e && e.preventDefault) e.preventDefault();
  const fromDate = (document.getElementById('admin-settlement-export-from-date')?.value || '').trim();
  const toDate = (document.getElementById('admin-settlement-export-to-date')?.value || '').trim();

  if (!fromDate || !toDate) {
    alert('Please specify both Period From Date and Period To Date.');
    return;
  }
  if (fromDate > toDate) {
    alert('Period From Date cannot be later than Period To Date.');
    return;
  }

  const submitBtn = document.getElementById('admin-settlement-export-submit-btn');
  const origText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Generating...';
  }

  try {
    await performAdminBankSettlementsExport(fromDate, toDate);
    if (typeof closeModal === 'function') {
      closeModal('admin-settlement-export-modal');
    }
  } catch (err) {
    alert(err.message || 'Failed to export settlements CSV.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  }
}

async function performAdminBankSettlementsExport(exportFromDate, exportToDate) {
  const fromDate = String(exportFromDate || '').trim();
  const toDate = String(exportToDate || '').trim();

  if (!fromDate || !toDate) {
    alert('Please specify both From Date and To Date for the export.');
    return;
  }
  if (fromDate > toDate) {
    alert('From Date cannot be later than To Date.');
    return;
  }

  const orderType = document.getElementById('admin-bank-settlement-type-filter')?.value || 'all';
  const status = document.getElementById('admin-bank-settlement-status-filter')?.value || 'all';
  const filterById = (document.getElementById('admin-bank-settlement-filter-by-id')?.value || '').trim();
  const q = (document.getElementById('admin-bank-settlement-search')?.value || '').trim().toLowerCase();

  const queryParams = new URLSearchParams({
    orderType,
    payoutStatus: status,
    fromDate,
    toDate,
  });
  if (filterById) queryParams.set('filterById', filterById);

  let list = [];
  try {
    const res = await apiFetch(`/api/admin/bank/settlements?${queryParams.toString()}`);
    list = Array.isArray(res.settlements) ? res.settlements : [];
  } catch (err) {
    console.warn('Direct fetch for export failed, falling back to cached settlements:', err);
    list = cachedAdminBankSettlements.filter((s) => {
      const sDateStr = (s.tomatoReceivedAt || s.createdAt || '').slice(0, 10);
      if (!sDateStr) return false;
      return sDateStr >= fromDate && sDateStr <= toDate;
    });
  }

  if (filterById) {
    const idLow = filterById.toLowerCase();
    list = list.filter((s) => {
      const idHay = [s.partnerCode, s.partnerId, s.partnerEmail, s.partnerName, s.riderCode, s.riderId, s.riderEmail, s.riderName]
        .filter(Boolean).join(' ').toLowerCase();
      return idHay.includes(idLow);
    });
  }

  if (q) {
    list = list.filter((s) => {
      const hay = [s.orderNumber, s.partnerName, s.partnerCode, s.partnerId, s.riderName, s.riderCode, s.riderId, s.transactionId, s.partnerPayoutRef, s.riderPayoutRef]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  if (!list.length) {
    alert(`No order payment settlements found between ${fromDate} and ${toDate} to export.`);
    return;
  }

  const metadataRows = [
    ['Tomato Platform - Central Account & Order Payout Settlements Report'],
    ['Period From Date', fromDate],
    ['Period To Date', toDate],
    ['Generated On', new Date().toLocaleString('en-IN')],
    ['Total Settlements Exported', String(list.length)],
    [],
  ];

  const headers = [
    'Order Number',
    'Date & Time',
    'Order Type',
    'Customer Received (INR)',
    'Payment Method',
    'Order Status',
    'Tomato Central Status',
    'Partner Name',
    'Partner Code',
    'Partner Bank',
    'Partner Account Number',
    'Partner IFSC',
    'Agreement Comm (%)',
    'Tomato Retained Comm (INR)',
    'Partner Payout (INR)',
    'Partner Payout Status',
    'Partner UTR Ref',
    'Partner Paid At',
    'Rider Name',
    'Rider Code',
    'Rider Bank',
    'Rider Account Number',
    'Rider IFSC',
    'Rider Payout (INR)',
    'Rider Payout Status',
    'Rider UTR Ref',
    'Rider Paid At'
  ];

  const totalReceived = list.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0);
  const totalTomatoComm = list.reduce((sum, s) => sum + Number(s.tomatoCommissionAmount || 0), 0);
  const totalPartnerPayout = list.reduce((sum, s) => sum + Number(s.partnerPayoutAmount || 0), 0);
  const totalRiderPayout = list.reduce((sum, s) => sum + Number(s.riderPayoutAmount || 0), 0);

  const dataRows = list.map((s) => {
    const pBank = s.partnerBankDetails || s.partnerBankSnapshot || {};
    const rBank = s.riderBankDetails || s.riderBankSnapshot || {};
    return [
      s.orderNumber || s.orderId || '',
      formatSettlementDateTime(s.tomatoReceivedAt || s.createdAt),
      s.orderType === 'shop' ? 'Shop' : 'Restaurant',
      Number(s.totalAmount || 0).toFixed(2),
      (s.paymentMethod || 'online').toUpperCase(),
      s.orderStatus || 'placed',
      s.tomatoAccountStatus || 'received',
      s.partnerName || '',
      s.partnerCode || '',
      pBank.bankName || '',
      pBank.accountNumber ? `'${pBank.accountNumber}` : '',
      pBank.ifscCode || '',
      Number(s.agreementCommissionPercent ?? 15),
      Number(s.tomatoCommissionAmount || 0).toFixed(2),
      Number(s.partnerPayoutAmount || 0).toFixed(2),
      s.partnerPayoutStatus || 'pending_approval',
      s.partnerPayoutRef || s.partnerPayoutReference || '',
      formatSettlementDateTime(s.partnerPaidAt),
      s.riderName || '',
      s.riderCode || '',
      rBank.bankName || '',
      rBank.accountNumber ? `'${rBank.accountNumber}` : '',
      rBank.ifscCode || '',
      Number(s.riderPayoutAmount || 0).toFixed(2),
      s.riderPayoutStatus || (s.riderId ? 'pending_approval' : 'none'),
      s.riderPayoutRef || s.riderPayoutReference || '',
      formatSettlementDateTime(s.riderPaidAt)
    ];
  });

  const totalRow = [
    `Total (${list.length})`,
    '',
    '',
    totalReceived.toFixed(2),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    totalTomatoComm.toFixed(2),
    totalPartnerPayout.toFixed(2),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    totalRiderPayout.toFixed(2),
    '',
    '',
    ''
  ];

  const allRows = [
    ...metadataRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')),
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(','),
    ...dataRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')),
    totalRow.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
  ];

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + allRows.join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  const safeFrom = String(fromDate).replace(/[^\w-]/g, '_');
  const safeTo = String(toDate).replace(/[^\w-]/g, '_');
  link.setAttribute('download', `Tomato_Order_Settlements_From_${safeFrom}_To_${safeTo}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportAdminBankSettlementsCsv(explicitFromDate, explicitToDate) {
  if (explicitFromDate && explicitToDate) {
    performAdminBankSettlementsExport(explicitFromDate, explicitToDate);
    return;
  }
  openAdminSettlementExportModal();
}


function getPartnerBankApiEndpoint() {
  if (role === "shop") return "/api/shop/bank-details";
  if (role === "deliveryPartner") return "/api/rider/bank-details";
  return "/api/restaurant/bank-details";
}

async function loadPartnerBankPanel() {
  try {
    const res = await apiFetch(getPartnerBankApiEndpoint());
    const bd = res.bankDetails || {};
    const isApproved = Boolean(bd.isApproved || res.isApproved);
    const isLocked = Boolean(bd.isLocked);
    const isSubmitted = Boolean(bd.isSubmitted);

    const badgeEl = document.getElementById("partner-bank-status-badge");
    const lockBanner = document.getElementById("partner-bank-lock-banner");
    const pendingBanner = document.getElementById("partner-bank-pending-banner");
    const submitRow = document.getElementById("partner-bank-submit-row");
    const agreementText = document.getElementById("partner-bank-agreement-text");
    const adminNoteEl = document.getElementById("partner-bank-admin-note");

    if (badgeEl) {
if (isApproved && isLocked) {
  badgeEl.className = "badge badge-approved";
  badgeEl.textContent = "🔒 Approved & Locked";
} else if (isSubmitted) {
  badgeEl.className = "badge badge-ready";
  badgeEl.textContent = "⏳ Submitted — Pending Admin Approval";
} else {
  badgeEl.className = "badge badge-pending";
  badgeEl.textContent = "⚠️ Not Submitted";
}
    }

    if (lockBanner) lockBanner.style.display = isLocked ? "block" : "none";
    if (pendingBanner) pendingBanner.style.display = !isLocked ? "block" : "none";
    if (submitRow) submitRow.style.display = isLocked ? "none" : "flex";

    if (agreementText) {
if (role === "deliveryPartner") {
  agreementText.innerHTML = `Rider Delivery Payout Agreement: <strong>₹${Number(bd.riderPayoutPerOrder ?? 40)} per completed order</strong> (Settled from Tomato Central Account)`;
} else {
  agreementText.innerHTML = `Tomato Platform Commission Agreement: <strong>${Number(bd.agreementCommissionPercent ?? 15)}%</strong> (Remaining order amount settled to your bank account)`;
}
    }
    if (adminNoteEl) {
      const noteLabelPrefix = role === "deliveryPartner" ? "Admin Note :" : "FSSAI No. :";
      adminNoteEl.textContent = bd.adminNote ? `${noteLabelPrefix} ${bd.adminNote}` : "";
    }

    const noteLabel = document.getElementById("partner-bank-note-label");
    const noteInput = document.getElementById("partner-bank-note");
    const noteHint = document.getElementById("partner-bank-note-hint");
    if (role === "deliveryPartner") {
      if (noteLabel) {
        noteLabel.textContent = "Agreement Note (Driving Licence Number & Expiry) *";
      }
      if (noteInput) {
        noteInput.placeholder = "Rider has to share Licence number & expiry (e.g. DL-0420110149646, Exp: 12/2032)";
      }
      if (noteHint) {
        noteHint.textContent = "📌 Mandatory for Rider: Please enter your Driving Licence Number and Expiry Date.";
      }
    } else {
      if (noteLabel) {
        noteLabel.textContent = "Agreement Note (FSSAI Registration Number & Expiry) *";
      }
      if (noteInput) {
        noteInput.placeholder = "Shop and restaurant has to share FSSAI registration number and expiry (e.g. FSSAI: 11223344556677, Exp: 08/2028)";
      }
      if (noteHint) {
        noteHint.textContent = "📌 Mandatory for Shop & Restaurant: Please enter your FSSAI Registration Number and Expiry Date.";
      }
    }

    const fields = [
["partner-bank-holder-name", bd.accountHolderName || ""],
["partner-pan-holder-name", bd.panHolderName || ""],
["partner-pan-number", bd.panNumber || ""],
["partner-bank-name", bd.bankName || ""],
["partner-bank-account-number", bd.accountNumber || ""],
["partner-bank-ifsc", bd.ifscCode || ""],
["partner-bank-upi", bd.upiId || ""],
["partner-bank-note", bd.adminNote || ""],
    ];

    fields.forEach(([id, val]) => {
const el = document.getElementById(id);
if (el) {
  el.value = val;
  el.disabled = isLocked;
  el.style.background = isLocked ? "#f1f5f9" : "#fff";
}
    });

    checkPartnerBankNameMatchLive();
  } catch (err) {
    console.error("Failed to load partner bank details:", err);
  }
}

function checkPartnerBankNameMatchLive() {
  const bankHolder = (document.getElementById("partner-bank-holder-name")?.value || "").trim();
  const panHolder = (document.getElementById("partner-pan-holder-name")?.value || "").trim();
  const indicator = document.getElementById("partner-bank-name-match-indicator");
  if (!indicator) return;

  if (!bankHolder && !panHolder) {
    indicator.style.display = "none";
    return;
  }
  indicator.style.display = "block";
  const normBank = bankHolder.toLowerCase().replace(/\s+/g, " ");
  const normPan = panHolder.toLowerCase().replace(/\s+/g, " ");

  if (normBank && normPan && normBank === normPan) {
    indicator.style.background = "#f0fdf4";
    indicator.style.border = "1px solid #bbf7d0";
    indicator.style.color = "#15803d";
    indicator.innerHTML = "✅ Bank Account Holder Name matches Name on PAN Card.";
  } else {
    indicator.style.background = "#fef2f2";
    indicator.style.border = "1px solid #fecaca";
    indicator.style.color = "#dc2626";
    indicator.innerHTML = "⚠️ Bank Account Holder Name MUST match Name on PAN Card for admin approval.";
  }
}

async function savePartnerBankDetails(event) {
  event.preventDefault();
  const payload = {
    accountHolderName: document.getElementById("partner-bank-holder-name")?.value.trim() || "",
    panHolderName: document.getElementById("partner-pan-holder-name")?.value.trim() || "",
    panNumber: (document.getElementById("partner-pan-number")?.value || "").trim().toUpperCase(),
    bankName: document.getElementById("partner-bank-name")?.value.trim() || "",
    accountNumber: document.getElementById("partner-bank-account-number")?.value.trim() || "",
    ifscCode: (document.getElementById("partner-bank-ifsc")?.value || "").trim().toUpperCase(),
    upiId: document.getElementById("partner-bank-upi")?.value.trim() || "",
    adminNote: document.getElementById("partner-bank-note")?.value.trim() || "",
  };

  try {
    const res = await apiFetch(getPartnerBankApiEndpoint(), {
method: "PUT",
body: JSON.stringify(payload),
    });
    alert(res.message || "Bank & PAN details submitted for admin verification!");
    loadPartnerBankPanel();
  } catch (err) {
    alert(err.message || "Unable to save bank details.");
  }
}

window.switchAdminBankTab = switchAdminBankTab;
window.fetchAdminBankPartners = fetchAdminBankPartners;
window.renderAdminBankPartnersTable = renderAdminBankPartnersTable;
window.openAdminBankEditModal = openAdminBankEditModal;
window.checkAdminBankNameMatchLive = checkAdminBankNameMatchLive;
window.saveAdminPartnerBankDetails = saveAdminPartnerBankDetails;
window.quickApprovePartnerBank = quickApprovePartnerBank;
window.fetchAdminBankSettlements = fetchAdminBankSettlements;
window.renderAdminBankSettlementsTable = renderAdminBankSettlementsTable;
window.openAdminSettlementAgreementModal = openAdminSettlementAgreementModal;
window.previewAdminSettlementBreakdown = previewAdminSettlementBreakdown;
window.saveAdminSettlementAgreement = saveAdminSettlementAgreement;
window.approveAndSendTomatoPayout = approveAndSendTomatoPayout;
window.loadPartnerBankPanel = loadPartnerBankPanel;
window.checkPartnerBankNameMatchLive = checkPartnerBankNameMatchLive;
window.savePartnerBankDetails = savePartnerBankDetails;
window.loadAdminBankPanel = loadAdminBankPanel;
window.refreshAdminBankCurrentTab = refreshAdminBankCurrentTab;
window.openAdminBankModalByUserId = openAdminBankModalByUserId;
window.renderAdminBankPartnersKpis = renderAdminBankPartnersKpis;
window.renderAdminBankSettlementsKpis = renderAdminBankSettlementsKpis;
window.populateAdminBankPartnerDirectory = populateAdminBankPartnerDirectory;
window.quickFilterBankPartnerById = quickFilterBankPartnerById;
window.exportAdminBankSettlementsCsv = exportAdminBankSettlementsCsv;
window.filterSettlementsQuickStatus = filterSettlementsQuickStatus;
window.selectAdminBankSettlementWeek = selectAdminBankSettlementWeek;
window.navigateAdminBankSettlementWeekOffset = navigateAdminBankSettlementWeekOffset;
window.renderAdminBankSettlementsWeekPagination = renderAdminBankSettlementsWeekPagination;
window.renderAdminBankSettlementsWeekPaginationHTML = renderAdminBankSettlementsWeekPaginationHTML;
window.getAdminSettlementWeekBounds = getAdminSettlementWeekBounds;
window.openAdminSettlementExportModal = openAdminSettlementExportModal;
window.submitAdminSettlementExport = submitAdminSettlementExport;
window.performAdminBankSettlementsExport = performAdminBankSettlementsExport;
window.getDefaultSettlementExportDateRange = getDefaultSettlementExportDateRange;
window.setAdminSettlementExportDefaultPreset = setAdminSettlementExportDefaultPreset;
window.setAdminSettlementExportCurrentWeekPreset = setAdminSettlementExportCurrentWeekPreset;
window.setAdminSettlementExportLastWeekPreset = setAdminSettlementExportLastWeekPreset;
window.setAdminSettlementExportCurrentFilterPreset = setAdminSettlementExportCurrentFilterPreset;
window.selectAdminBankPartnerRole = selectAdminBankPartnerRole;
window.changeAdminBankPartnerPage = changeAdminBankPartnerPage;
window.renderAdminBankPartnersPaginationBar = renderAdminBankPartnersPaginationBar;

