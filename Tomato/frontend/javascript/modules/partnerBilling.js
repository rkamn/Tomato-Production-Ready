// =========================================================================
// ADMIN PARTNERS BILLING & WEEKLY SETTLEMENT ENGINE MODULE
// =========================================================================
// =========================================================================
// VIEW 17.5: ADMIN PARTNERS BILLING (WEEKLY SETTLEMENTS & PAYOUT ENGINE)
// =========================================================================
let currentAdminPartnerBillingTab = 'weekly';
let adminPartnerBillingData = [];
let adminPartnerBillingSummary = {};
let adminPartnerBillingWeekStart = '';
let adminPartnerBillingWeekEnd = '';
let adminPartnerBillingLoading = false;

function switchAdminPartnerBillingTab(tabName) {
  currentAdminPartnerBillingTab = tabName || 'weekly';
  const weeklyTab = document.getElementById('admin-billing-tab-weekly');
  const settlementsTab = document.getElementById('admin-billing-tab-settlements');
  const weeklyBtn = document.getElementById('admin-billing-tab-weekly-btn');
  const settlementsBtn = document.getElementById('admin-billing-tab-settlements-btn');

  if (weeklyTab) weeklyTab.style.display = currentAdminPartnerBillingTab === 'weekly' ? 'block' : 'none';
  if (settlementsTab) settlementsTab.style.display = currentAdminPartnerBillingTab === 'settlements' ? 'block' : 'none';

  if (weeklyBtn) {
    weeklyBtn.className = currentAdminPartnerBillingTab === 'weekly' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  }
  if (settlementsBtn) {
    settlementsBtn.className = currentAdminPartnerBillingTab === 'settlements' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  }

  if (currentAdminPartnerBillingTab === 'weekly') {
    fetchAdminPartnerBilling();
  } else {
    fetchAdminBankSettlements();
  }
}

function refreshAdminPartnerBillingCurrentTab() {
  if (currentAdminPartnerBillingTab === 'settlements') {
    fetchAdminBankSettlements();
  } else {
    fetchAdminPartnerBilling();
  }
}

function getAdminCurrentWeekString(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function setAdminBillingCurrentWeek() {
  const weekInput = document.getElementById('admin-billing-week-input');
  if (weekInput) {
    weekInput.value = getAdminCurrentWeekString();
  }
  fetchAdminPartnerBilling();
}

function setAdminBillingPrevWeek() {
  const weekInput = document.getElementById('admin-billing-week-input');
  const d = new Date();
  d.setDate(d.getDate() - 7);
  if (weekInput) {
    weekInput.value = getAdminCurrentWeekString(d);
  }
  fetchAdminPartnerBilling();
}

function setAdminBillingAllTime() {
  const weekInput = document.getElementById('admin-billing-week-input');
  if (weekInput) {
    weekInput.value = '';
  }
  fetchAdminPartnerBilling('all');
}

function resetAdminBillingFilters() {
  const roleFilter = document.getElementById('admin-billing-role-filter');
  const statusFilter = document.getElementById('admin-billing-status-filter');
  const searchInput = document.getElementById('admin-billing-search-input');
  if (roleFilter) roleFilter.value = 'all';
  if (statusFilter) statusFilter.value = 'all';
  if (searchInput) searchInput.value = '';
  setAdminBillingCurrentWeek();
}

async function fetchAdminPartnerBilling(overrideWeek) {
  const tableContainer = document.getElementById('admin-partner-billing-table-container');
  const weekInput = document.getElementById('admin-billing-week-input');
  let weekVal = '';

  if (overrideWeek !== undefined) {
    weekVal = overrideWeek;
    if (weekInput) {
      weekInput.value = overrideWeek === 'all' ? '' : overrideWeek;
    }
  } else if (weekInput) {
    if (!weekInput.value) {
      weekInput.value = getAdminCurrentWeekString();
    }
    weekVal = weekInput.value;
  } else {
    weekVal = getAdminCurrentWeekString();
  }

  const roleVal = document.getElementById('admin-billing-role-filter')?.value || 'all';
  const statusVal = document.getElementById('admin-billing-status-filter')?.value || 'all';
  const searchVal = document.getElementById('admin-billing-search-input')?.value || '';

  if (tableContainer) {
    tableContainer.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
        <div style="font-size:1.8rem; margin-bottom:0.4rem; animation:spin 1s linear infinite;">⏳</div>
        <p style="font-size:0.9rem; font-weight:600;">Calculating weekly billing &amp; settlements...</p>
      </div>
    `;
  }

  adminPartnerBillingLoading = true;
  try {
    const params = new URLSearchParams();
    if (weekVal) params.set('week', weekVal);
    if (roleVal && roleVal !== 'all') params.set('role', roleVal);
    if (statusVal && statusVal !== 'all') params.set('status', statusVal);
    if (searchVal) params.set('search', searchVal);

    const res = await apiFetch(`/api/admin/billing/partners?${params.toString()}`);
    adminPartnerBillingData = Array.isArray(res.billingList) ? res.billingList : [];
    adminPartnerBillingSummary = res.summary || {};
    adminPartnerBillingWeekStart = res.weekStart || '';
    adminPartnerBillingWeekEnd = res.weekEnd || '';

    renderAdminPartnerBillingKPIs();
    renderAdminPartnerBillingTable();
  } catch (err) {
    console.error('Failed to load partner billing:', err);
    if (tableContainer) {
      tableContainer.innerHTML = `
        <div style="padding:1.5rem; text-align:center; color:#dc2626; background:#fef2f2; border-radius:8px;">
          Failed to load partner billing: ${escapeHtml(err.message || 'Server error')}
        </div>
      `;
    }
  } finally {
    adminPartnerBillingLoading = false;
  }
}

function renderAdminPartnerBillingKPIs() {
  const kpiEl = document.getElementById('admin-partner-billing-kpis');
  if (!kpiEl) return;

  const s = adminPartnerBillingSummary || {};
  const totalPayable = Number(s.totalPlatformPayable || 0);
  const totalPaid = Number(s.totalPlatformPaid || 0);
  const totalPending = Number(s.totalPlatformPending || 0);
  const pendingPartners = Number(s.totalPartnersWithPending || 0);
  const restPending = Number(s.pendingRestaurantsCount || 0);
  const shopPending = Number(s.pendingShopsCount || 0);
  const riderPending = Number(s.pendingRidersCount || 0);
  const rangeStr = adminPartnerBillingWeekStart && adminPartnerBillingWeekEnd
    ? `${adminPartnerBillingWeekStart} → ${adminPartnerBillingWeekEnd}`
    : 'Current Week';

  kpiEl.innerHTML = `
    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:0.8rem 1rem;">
      <div style="font-size:0.72rem; color:#1d4ed8; font-weight:700; text-transform:uppercase;">📅 Week Period</div>
      <div style="font-size:1.15rem; font-weight:800; color:#1e3a8a; margin-top:0.2rem;">${escapeHtml(rangeStr)}</div>
      <div style="font-size:0.72rem; color:#1e40af; margin-top:0.15rem;">${s.trackedPartnersCount || 0} Registered Partners Tracked</div>
    </div>
    <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; padding:0.8rem 1rem;">
      <div style="font-size:0.72rem; color:#c2410c; font-weight:700; text-transform:uppercase;">⏳ Total Amount Pending to Pay</div>
      <div style="font-size:1.45rem; font-weight:800; color:#9a3412; margin-top:0.15rem;">₹${totalPending.toLocaleString('en-IN')}</div>
      <div style="font-size:0.72rem; color:#c2410c; margin-top:0.15rem;">${pendingPartners} Partners Waiting (${restPending} Rest • ${shopPending} Shops • ${riderPending} Riders)</div>
    </div>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:0.8rem 1rem;">
      <div style="font-size:0.72rem; color:#15803d; font-weight:700; text-transform:uppercase;">✅ Total Amount Already Sent</div>
      <div style="font-size:1.45rem; font-weight:800; color:#14532d; margin-top:0.15rem;">₹${totalPaid.toLocaleString('en-IN')}</div>
      <div style="font-size:0.72rem; color:#166534; margin-top:0.15rem;">Successfully Disbursed This Week</div>
    </div>
    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:0.8rem 1rem;">
      <div style="font-size:0.72rem; color:#475569; font-weight:700; text-transform:uppercase;">💵 Gross Net Payouts Payable</div>
      <div style="font-size:1.45rem; font-weight:800; color:#0f172a; margin-top:0.15rem;">₹${totalPayable.toLocaleString('en-IN')}</div>
      <div style="font-size:0.72rem; color:#475569; margin-top:0.15rem;">After Tomato Comm &amp; Coupon Deductions</div>
    </div>
  `;
}

function renderAdminPartnerBillingTable() {
  const container = document.getElementById('admin-partner-billing-table-container');
  if (!container) return;

  const q = (document.getElementById('admin-billing-search-input')?.value || '').trim().toLowerCase();
  let list = adminPartnerBillingData;

  if (q) {
    list = list.filter((p) => {
      const hay = `${p.name} ${p.partnerCode} ${p.phone} ${p.email} ${p.partnerType}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (!list.length) {
    container.innerHTML = `
      <div style="padding:2.5rem 1rem; text-align:center; color:var(--muted); background:#fcfaf5; border:1px dashed var(--line); border-radius:8px;">
        <div style="font-size:2rem; margin-bottom:0.4rem;">📑</div>
        <p style="font-size:0.95rem; font-weight:700; color:var(--charcoal);">No partner billing records found</p>
        <p style="font-size:0.8rem; margin:0;">${q ? `No partners matched "${escapeHtml(q)}".` : 'No orders or activity recorded for this period.'}</p>
      </div>
    `;
    return;
  }

  const rows = list.map((p) => {
    const isShop = p.partnerType === 'shop';
    const isRider = p.partnerType === 'deliveryPartner';
    const typeIcon = isShop ? '🏬' : isRider ? '🚴' : '🏪';
    const typeLabel = isShop ? 'Shop' : isRider ? 'Rider' : 'Restaurant';
    const typeBadge = isShop
      ? '<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #dbeafe; font-size:0.7rem; font-weight:700;">🏬 Shop</span>'
      : isRider
      ? '<span class="badge" style="background:#f0fdf4; color:#15803d; border:1px solid #dcfce7; font-size:0.7rem; font-weight:700;">🚴 Rider</span>'
      : '<span class="badge" style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; font-size:0.7rem; font-weight:700;">🏪 Restaurant</span>';

    const hasBank = !!(p.bankDetails && p.bankDetails.accountNumber);
    const bankApproved = Boolean(p.isBankApproved);

    // Status badge
    let statusBadge = '';
    if (p.totalOrders === 0) {
      statusBadge = '<span class="badge badge-preparing" style="font-size:0.7rem;">⚪ No Orders This Week</span>';
    } else if (p.totalPending > 0) {
      statusBadge = `<span class="badge badge-pending" style="font-size:0.72rem; font-weight:700;">⏳ Pending: ₹${p.totalPending.toLocaleString('en-IN')}</span>`;
    } else {
      statusBadge = '<span class="badge badge-delivered" style="font-size:0.72rem; font-weight:700;">✅ Fully Settled</span>';
    }

    // Action button
    let actionBtnHtml = '';
    if (p.totalPending > 0) {
      if (!bankApproved) {
        actionBtnHtml = `
          <button type="button" class="btn btn-outline btn-sm" style="font-size:0.74rem; color:#dc2626; border-color:#fca5a5;" onclick="switchView('admin-bank'); quickFilterSettlementsById('${escapeHtml(p.partnerCode)}');">
            ⚠️ Approve Bank KYC First
          </button>
        `;
      } else {
        actionBtnHtml = `
          <button
            type="button"
            class="btn btn-success btn-sm"
            style="font-size:0.76rem; font-weight:700; white-space:nowrap; padding:0.3rem 0.65rem;"
            onclick="disbursePartnerWeeklyBillingPayout('${escapeHtml(p.partnerType)}', '${escapeHtml(p.partnerId)}', '${escapeHtml(p.name)}', ${p.totalPending})"
          >
            💸 Pay Pending (₹${p.totalPending.toLocaleString('en-IN')})
          </button>
        `;
      }
    } else if (p.totalOrders > 0) {
      actionBtnHtml = `<span style="font-size:0.74rem; color:#15803d; font-weight:700;">✓ Settled</span>`;
    } else {
      actionBtnHtml = `<span style="font-size:0.74rem; color:var(--muted);">—</span>`;
    }

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <strong>${typeIcon} ${escapeHtml(p.name)}</strong>
            ${typeBadge}
          </div>
          <div style="font-size:0.76rem; color:var(--muted); margin-top:2px; display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <span style="font-family:monospace; font-weight:700; color:#1e40af; background:#dbeafe; padding:1px 5px; border-radius:4px; font-size:0.7rem;">🆔 ${escapeHtml(p.partnerCode)}</span>
            ${p.phone ? `<span>📞 ${escapeHtml(p.phone)}</span>` : ''}
          </div>
        </td>
        <td>
          ${hasBank ? `
            <div style="font-size:0.78rem; font-weight:700; color:var(--charcoal);">${escapeHtml(p.bankDetails.bankName || 'Bank Account')}</div>
            <div style="font-family:monospace; font-size:0.73rem; color:var(--muted);">A/C: ${escapeHtml(p.bankDetails.accountNumber)} • ${escapeHtml(p.bankDetails.ifscCode || '')}</div>
            <div style="margin-top:2px;">
              ${bankApproved ? '<span class="badge badge-delivered" style="font-size:0.65rem; padding:1px 5px;">KYC Approved</span>' : '<span class="badge badge-pending" style="font-size:0.65rem; padding:1px 5px;">KYC Pending</span>'}
            </div>
          ` : '<span style="color:#dc2626; font-size:0.74rem; font-weight:600;">⚠️ No Bank Details</span>'}
        </td>
        <td style="text-align:center;">
          <div style="font-weight:800; font-size:0.92rem; color:var(--ink);">${p.totalOrders}</div>
          <div style="font-size:0.7rem; color:var(--muted);">orders</div>
        </td>
        <td style="text-align:right;">
          <div style="font-weight:700; color:var(--ink); font-size:0.86rem;">₹${Number(p.grossVolume || 0).toLocaleString('en-IN')}</div>
          ${!isRider ? `<div style="font-size:0.7rem; color:var(--muted);">Comm: -₹${Number(p.tomatoCommission || 0).toLocaleString('en-IN')}</div>` : ''}
          ${p.discountsFunded > 0 ? `<div style="font-size:0.7rem; color:#dc2626;">Disc: -₹${Number(p.discountsFunded).toLocaleString('en-IN')}</div>` : ''}
        </td>
        <td style="text-align:right;">
          <div style="font-weight:800; color:#15803d; font-size:0.9rem;">₹${p.totalPaid.toLocaleString('en-IN')}</div>
          <div style="font-size:0.68rem; color:#15803d; font-weight:600;">disbursed to bank</div>
        </td>
        <td style="text-align:right;">
          <div style="font-weight:800; color:${p.totalPending > 0 ? '#b91c1c' : '#15803d'}; font-size:0.92rem;">
            ₹${p.totalPending.toLocaleString('en-IN')}
          </div>
          <div style="font-size:0.68rem; color:${p.totalPending > 0 ? '#b91c1c' : '#15803d'}; font-weight:600;">
            ${p.totalPending > 0 ? 'owed by Tomato' : 'all settled'}
          </div>
        </td>
        <td style="text-align:center;">
          ${statusBadge}
        </td>
        <td style="text-align:right;">
          <div style="display:flex; flex-direction:column; gap:0.25rem; align-items:flex-end;">
            ${actionBtnHtml}
            <button
              type="button"
              class="btn btn-outline btn-sm"
              style="font-size:0.7rem; padding:0.15rem 0.45rem;"
              onclick="switchAdminPartnerBillingTab('settlements'); quickFilterSettlementsById('${escapeHtml(p.partnerCode)}');"
              title="View individual order settlements"
            >
              Order Ledger ↗
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Partner / Rider</th>
            <th>Bank &amp; KYC Status</th>
            <th style="text-align:center;">Orders</th>
            <th style="text-align:right;">Total Volume &amp; Comm</th>
            <th style="text-align:right;">Total Paid (₹)</th>
            <th style="text-align:right;">Still Pending (₹)</th>
            <th style="text-align:center;">Payout Status</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

async function disbursePartnerWeeklyBillingPayout(partnerType, partnerId, partnerName, pendingAmount) {
  if (!confirm(`Are you sure you want to disburse the weekly pending payout of ₹${Number(pendingAmount).toLocaleString('en-IN')} from Tomato central account to ${partnerName}?`)) {
    return;
  }

  try {
    const res = await apiFetch(`/api/admin/billing/partners/${encodeURIComponent(partnerType)}/${encodeURIComponent(partnerId)}/settle`, {
      method: 'POST',
    });
    alert(res.message || 'Weekly payout disbursed successfully!');
    fetchAdminPartnerBilling();
  } catch (err) {
    alert(err.message || 'Unable to disburse weekly payout.');
  }
}

function exportAdminPartnerBillingCsv() {
  if (!adminPartnerBillingData.length) {
    alert('No partner billing records to export.');
    return;
  }

  const weekStr = document.getElementById('admin-billing-week-input')?.value || 'current';
  const headers = [
    'Partner ID',
    'Partner Name',
    'Type',
    'Phone',
    'Bank Name',
    'Account Number',
    'IFSC',
    'KYC Approved',
    'Orders Count',
    'Gross Volume (INR)',
    'Commission Deducted (INR)',
    'Discount Funded (INR)',
    'Total Paid (INR)',
    'Still Pending (INR)',
    'Status',
  ];

  const rows = adminPartnerBillingData.map((p) => [
    p.partnerCode || p.partnerId,
    p.name || '',
    p.partnerType === 'shop' ? 'Shop' : p.partnerType === 'deliveryPartner' ? 'Rider' : 'Restaurant',
    p.phone || '',
    p.bankDetails?.bankName || '',
    p.bankDetails?.accountNumber ? `'${p.bankDetails.accountNumber}` : '',
    p.bankDetails?.ifscCode || '',
    p.isBankApproved ? 'Yes' : 'No',
    p.totalOrders || 0,
    Number(p.grossVolume || 0).toFixed(2),
    Number(p.tomatoCommission || 0).toFixed(2),
    Number(p.discountsFunded || 0).toFixed(2),
    Number(p.totalPaid || 0).toFixed(2),
    Number(p.totalPending || 0).toFixed(2),
    p.payoutStatus || 'settled',
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Tomato_Partners_Weekly_Billing_${weekStr}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

window.switchAdminPartnerBillingTab = switchAdminPartnerBillingTab;
window.refreshAdminPartnerBillingCurrentTab = refreshAdminPartnerBillingCurrentTab;
window.fetchAdminPartnerBilling = fetchAdminPartnerBilling;
window.renderAdminPartnerBillingKPIs = renderAdminPartnerBillingKPIs;
window.renderAdminPartnerBillingTable = renderAdminPartnerBillingTable;
window.setAdminBillingCurrentWeek = setAdminBillingCurrentWeek;
window.setAdminBillingPrevWeek = setAdminBillingPrevWeek;
window.setAdminBillingAllTime = setAdminBillingAllTime;
window.resetAdminBillingFilters = resetAdminBillingFilters;
window.disbursePartnerWeeklyBillingPayout = disbursePartnerWeeklyBillingPayout;
window.exportAdminPartnerBillingCsv = exportAdminPartnerBillingCsv;

