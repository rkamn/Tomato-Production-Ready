// =========================================================================
// ADMIN FINANCE & TRANSFER AUDIT LEDGER MODULE
// Real-time tracking of Credit Points & Wallet Balance Transfers with Timestamps
// =========================================================================

let cachedFinanceTransfers = [];
let financeSummary = {};
let currentFinancePage = 1;
let currentFinanceLimit = 25;
let currentFinanceType = 'all'; // 'all' | 'credit_point' | 'wallet_balance'
let currentFinanceRole = 'all';
let currentFinanceSearch = '';
let currentFinanceStartDate = '';
let currentFinanceEndDate = '';
let financeSearchTimer = null;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatLocalInputDate(d) {
  if (!d || isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatNumber(val, decimals = 2) {
  const n = Number(val || 0);
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatFinanceTimestamp(dateVal) {
  if (!dateVal) return '—';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);

  const dateStr = d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const timeStr = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return { full: `${dateStr}, ${timeStr}`, date: dateStr, time: timeStr, raw: d };
}

function formatRoleBadge(role) {
  const r = String(role || 'customer').toLowerCase();
  if (r === 'admin') return '<span class="badge" style="background:#fee2e2; color:#991b1b; font-size:0.7rem; font-weight:700;">Admin</span>';
  if (r === 'subadmin') return '<span class="badge" style="background:#e0e7ff; color:#3730a3; font-size:0.7rem; font-weight:700;">Sub-Admin</span>';
  if (r === 'restaurant') return '<span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.7rem; font-weight:700;">Restaurant</span>';
  if (r === 'shop') return '<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.7rem; font-weight:700;">Shop</span>';
  if (r === 'deliverypartner' || r === 'rider') return '<span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.7rem; font-weight:700;">Rider</span>';
  return '<span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; font-weight:700;">Customer</span>';
}

async function loadAdminFinancePanel() {
  if (typeof refreshProfileWallet === 'function') {
    refreshProfileWallet().catch(() => {});
  }
  await fetchAdminFinanceTransfers();
}

async function fetchAdminFinanceTransfers() {
  const container = document.getElementById('admin-finance-table-container');
  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
        <div class="spinner" style="margin:0 auto 0.75rem auto; width:28px; height:28px; border:3px solid #e2e8f0; border-top-color:var(--tomato); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <p style="font-size:0.88rem; margin:0;">Loading transfer audit ledger from server...</p>
      </div>
    `;
  }

  try {
    const params = new URLSearchParams({
      page: String(currentFinancePage),
      limit: String(currentFinanceLimit),
      transferType: currentFinanceType,
      role: currentFinanceRole,
      today: formatLocalInputDate(new Date()),
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });

    if (currentFinanceSearch) params.append('search', currentFinanceSearch);
    if (currentFinanceStartDate) params.append('startDate', currentFinanceStartDate);
    if (currentFinanceEndDate) params.append('endDate', currentFinanceEndDate);

    const data = await apiFetch(`/api/admin/finance/transfers?${params.toString()}`);
    cachedFinanceTransfers = Array.isArray(data.records) ? data.records : [];
    financeSummary = data.summary || {};

    renderFinanceKPIs(financeSummary);
    renderFinanceTypePills();
    renderFinanceTable(cachedFinanceTransfers);
    renderFinancePagination(data.pagination);
  } catch (err) {
    console.error('Fetch finance transfers error:', err);
    if (container) {
      container.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:1.25rem; text-align:center; color:#991b1b;">
          <strong style="display:block; margin-bottom:0.35rem;">Failed to load finance transfers</strong>
          <span style="font-size:0.84rem;">${escapeHtml(err.message || 'Unable to retrieve transfers from server.')}</span>
          <div style="margin-top:0.85rem;">
            <button type="button" class="btn btn-outline btn-sm" onclick="fetchAdminFinanceTransfers()">↻ Retry</button>
          </div>
        </div>
      `;
    }
  }
}

function renderFinanceKPIs(summary) {
  const kpiContainer = document.getElementById('admin-finance-kpis');
  if (!kpiContainer) return;

  const adminWbNum = typeof summary.adminWalletBalance === 'number'
    ? summary.adminWalletBalance
    : Number(window.currentWallet?.walletBalance ?? 0);
  const adminCpNum = typeof summary.adminCreditPoints === 'number'
    ? summary.adminCreditPoints
    : Number(window.currentWallet?.creditPoint ?? 10000);

  const adminWb = adminWbNum.toFixed(2);
  const adminCp = Math.round(adminCpNum).toLocaleString();

  // Keep window.currentWallet and header display in continuous sync with the backend wallet
  if (window.currentWallet) {
    window.currentWallet.walletBalance = adminWbNum;
    window.currentWallet.creditPoint = adminCpNum;
    if (typeof updateProfileWalletDisplay === 'function') {
      updateProfileWalletDisplay(adminWbNum, adminCpNum);
    }
  }

  const totalCredits = summary.totalCreditPointsTransferred ? Number(summary.totalCreditPointsTransferred).toLocaleString() : '0';
  const totalWallet = Number(summary.totalWalletBalanceTransferred || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalTrans = Number(summary.totalTransfers || 0).toLocaleString();
  const todayTrans = Number(summary.todayTransfersCount || 0).toLocaleString();
  const todayWallet = Number(summary.todayWalletTransferred || 0).toFixed(2);
  const todayCredits = Number(summary.todayCreditsTransferred || 0).toLocaleString();

  kpiContainer.innerHTML = `
    <!-- 1. LIVE ADMIN WALLET BALANCE -->
    <div class="stat-card" style="background:#fff; border:1px solid #86efac; border-left:4px solid #16a34a; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#166534; font-weight:700;">
        🏛️ Admin Live Wallet Balance
      </span>
      <div class="stat-value" style="font-size:1.55rem; font-weight:800; color:#16a34a; margin:0.3rem 0;">
        ₹${adminWb}
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#15803d; font-weight:600;">
        🟢 Live synced with 'wallet' table
      </span>
    </div>

    <!-- 2. LIVE ADMIN CREDIT POINTS POOL -->
    <div class="stat-card" style="background:#fff; border:1px solid #bfdbfe; border-left:4px solid #2563eb; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#1e40af; font-weight:700;">
        💳 Admin Live Credit Points
      </span>
      <div class="stat-value" style="font-size:1.55rem; font-weight:800; color:#2563eb; margin:0.3rem 0;">
        ${adminCp} <span style="font-size:0.9rem; font-weight:600;">pts</span>
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#1d4ed8; font-weight:600;">
        🔵 Live synced with 'wallet' table
      </span>
    </div>

    <!-- 3. TOTAL CREDIT POINTS DISBURSED -->
    <div class="stat-card" style="background:#fff; border:1px solid #e0e7ff; border-left:4px solid #6366f1; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#3730a3; font-weight:700;">
        📤 Total Points Disbursed
      </span>
      <div class="stat-value" style="font-size:1.5rem; font-weight:800; color:#4f46e5; margin:0.3rem 0;">
        ${totalCredits} <span style="font-size:0.9rem; font-weight:600;">pts</span>
      </div>
      <div
        class="stat-note stat-today-clickable"
        onclick="filterFinanceByToday('credit_point')"
        title="Click to view today's disbursed credit points in ledger"
        style="font-size:0.76rem; color:#4338ca; cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem; padding:0.2rem 0.5rem; border-radius:6px; background:#eef2ff; border:1px solid #c7d2fe; font-weight:600; margin-top:0.2rem; transition:all 0.15s ease;"
        onmouseover="this.style.background='#e0e7ff'; this.style.borderColor='#818cf8';"
        onmouseout="this.style.background='#eef2ff'; this.style.borderColor='#c7d2fe';"
      >
        <span>Today: +${todayCredits} pts disbursed</span>
        <span style="font-size:0.75rem; font-weight:bold;">↗</span>
      </div>
    </div>

    <!-- 4. TOTAL WALLET BALANCE TRANSFERRED -->
    <div class="stat-card" style="background:#fff; border:1px solid #fed7aa; border-left:4px solid #f97316; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#9a3412; font-weight:700;">
        💸 Total Wallet Settled
      </span>
      <div class="stat-value" style="font-size:1.5rem; font-weight:800; color:#ea580c; margin:0.3rem 0;">
        ₹${totalWallet}
      </div>
      <div
        class="stat-note stat-today-clickable"
        onclick="filterFinanceByToday('wallet_balance')"
        title="Click to view today's settled wallet transfers in ledger"
        style="font-size:0.76rem; color:#c2410c; cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem; padding:0.2rem 0.5rem; border-radius:6px; background:#fff7ed; border:1px solid #fed7aa; font-weight:600; margin-top:0.2rem; transition:all 0.15s ease;"
        onmouseover="this.style.background='#ffedd5'; this.style.borderColor='#fb923c';"
        onmouseout="this.style.background='#fff7ed'; this.style.borderColor='#fed7aa';"
      >
        <span>Today: ₹${todayWallet} settled</span>
        <span style="font-size:0.75rem; font-weight:bold;">↗</span>
      </div>
    </div>

    <!-- 5. TOTAL TRANSACTIONS AUDITED -->
    <div class="stat-card" style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid #64748b; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#475569; font-weight:700;">
        🔄 Transfers Audited
      </span>
      <div class="stat-value" style="font-size:1.5rem; font-weight:800; color:#334155; margin:0.3rem 0;">
        ${totalTrans}
      </div>
      <div
        class="stat-note stat-today-clickable"
        onclick="filterFinanceByToday('all')"
        title="Click to view all transfers recorded today in ledger"
        style="font-size:0.76rem; color:#475569; cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem; padding:0.2rem 0.5rem; border-radius:6px; background:#f8fafc; border:1px solid #e2e8f0; font-weight:600; margin-top:0.2rem; transition:all 0.15s ease;"
        onmouseover="this.style.background='#f1f5f9'; this.style.borderColor='#94a3b8';"
        onmouseout="this.style.background='#f8fafc'; this.style.borderColor='#e2e8f0';"
      >
        <span>${todayTrans} transfers recorded today</span>
        <span style="font-size:0.75rem; font-weight:bold;">↗</span>
      </div>
    </div>
  `;
}

function syncFinanceWithCurrentWallet() {
  if (window.currentWallet) {
    if (!financeSummary) financeSummary = {};
    financeSummary.adminWalletBalance = window.currentWallet.walletBalance;
    financeSummary.adminCreditPoints = window.currentWallet.creditPoint;
    renderFinanceKPIs(financeSummary);
  }
}
window.syncFinanceWithCurrentWallet = syncFinanceWithCurrentWallet;

function renderFinanceTypePills() {
  const pillsContainer = document.getElementById('admin-finance-type-pills');
  if (!pillsContainer) return;

  const types = [
    { key: 'all', label: 'All Transfers', icon: '📋' },
    { key: 'credit_point', label: '💳 Credit Points', icon: '💳' },
    { key: 'wallet_balance', label: '💵 Wallet Balance (₹)', icon: '💵' },
  ];

  pillsContainer.innerHTML = `
    <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
      ${types
        .map((t) => {
          const isActive = currentFinanceType === t.key;
          return `
            <button
              type="button"
              class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}"
              style="padding:0.25rem 0.75rem; font-size:0.78rem; font-weight:600; border-radius:20px;"
              onclick="selectFinanceType('${t.key}')"
            >
              ${t.label}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function selectFinanceType(type) {
  currentFinanceType = type;
  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
}

function handleFinanceRoleChange(role) {
  currentFinanceRole = role;
  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
}

function updateFinancePresetButtons(activePreset) {
  const buttons = document.querySelectorAll('.finance-preset-btn');
  buttons.forEach((btn) => {
    const p = btn.getAttribute('data-preset');
    if (p === activePreset) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
      btn.style.background = 'var(--tomato, #e23744)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--tomato, #e23744)';
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
      btn.style.background = '#fff';
      btn.style.color = '#475569';
      btn.style.borderColor = '#cbd5e1';
    }
  });
}

function handleFinanceDateChange() {
  currentFinanceStartDate = document.getElementById('admin-finance-from-date')?.value || '';
  currentFinanceEndDate = document.getElementById('admin-finance-to-date')?.value || '';
  updateFinancePresetButtons('');
  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
}

function setFinanceDatePreset(preset) {
  const fromInput = document.getElementById('admin-finance-from-date');
  const toInput = document.getElementById('admin-finance-to-date');

  const today = new Date();

  if (preset === 'today') {
    const todayStr = formatLocalInputDate(today);
    currentFinanceStartDate = todayStr;
    currentFinanceEndDate = todayStr;
  } else if (preset === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    currentFinanceStartDate = formatLocalInputDate(d);
    currentFinanceEndDate = formatLocalInputDate(today);
  } else if (preset === '30days') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    currentFinanceStartDate = formatLocalInputDate(d);
    currentFinanceEndDate = formatLocalInputDate(today);
  } else if (preset === 'all') {
    currentFinanceStartDate = '';
    currentFinanceEndDate = '';
  }

  if (fromInput) fromInput.value = currentFinanceStartDate;
  if (toInput) toInput.value = currentFinanceEndDate;

  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
}

function filterFinanceByToday(type = 'all') {
  currentFinanceType = type;
  const todayStr = formatLocalInputDate(new Date());
  currentFinanceStartDate = todayStr;
  currentFinanceEndDate = todayStr;

  const fromInput = document.getElementById('admin-finance-from-date');
  const toInput = document.getElementById('admin-finance-to-date');
  if (fromInput) fromInput.value = todayStr;
  if (toInput) toInput.value = todayStr;

  updateFinancePresetButtons('today');

  currentFinanceRole = 'all';
  const roleSelect = document.getElementById('admin-finance-role-filter');
  if (roleSelect) roleSelect.value = 'all';

  currentFinanceSearch = '';
  const searchInput = document.getElementById('admin-finance-search');
  if (searchInput) searchInput.value = '';

  currentFinancePage = 1;

  fetchAdminFinanceTransfers();

  setTimeout(() => {
    const tableEl = document.getElementById('admin-finance-table-container');
    if (tableEl) {
      tableEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 120);
}

function handleFinanceSearchInput(val) {
  clearTimeout(financeSearchTimer);
  financeSearchTimer = setTimeout(() => {
    currentFinanceSearch = String(val || '').trim();
    currentFinancePage = 1;
    fetchAdminFinanceTransfers();
  }, 300);
}

function clearFinanceSearch() {
  const searchInput = document.getElementById('admin-finance-search');
  if (searchInput) searchInput.value = '';
  currentFinanceSearch = '';
  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
}

function renderFinanceTable(records) {
  const container = document.getElementById('admin-finance-table-container');
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:3rem 1rem; color:var(--muted); background:#fcfcfc; border:1px dashed #cbd5e1; border-radius:10px;">
        <span style="font-size:2rem; display:block; margin-bottom:0.5rem;">💸</span>
        <strong style="color:var(--ink); font-size:1rem; display:block; margin-bottom:0.25rem;">No transfer records found</strong>
        <p style="font-size:0.84rem; margin:0; max-width:400px; margin:0 auto;">
          No credit point or wallet balance transfers matched the selected criteria.
        </p>
        <button type="button" class="btn btn-outline btn-sm" style="margin-top:1rem;" onclick="resetFinanceFilters()">Reset Filters</button>
      </div>
    `;
    return;
  }

  const rowsHtml = records
    .map((r, idx) => {
      const ts = formatFinanceTimestamp(r.createdAt);
      const isWallet = r.transferType === 'wallet_balance';
      const amountVal = Number(r.amount || r.walletBalanceTransferred || r.creditTransferred || 0);

      const typeBadge = isWallet
        ? `<span class="badge" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-weight:700;">💵 Wallet Balance</span>`
        : `<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700;">💳 Credit Points</span>`;

      const amountDisplay = isWallet
        ? `<span style="font-weight:800; color:#059669; font-size:0.92rem;">+₹${amountVal.toFixed(2)}</span>`
        : `<span style="font-weight:800; color:#2563eb; font-size:0.92rem;">+${Math.round(amountVal).toLocaleString()} pts</span>`;

      const senderIdDisplay = r.senderUserId || 'Platform Treasury';
      const receiverIdDisplay = r.receiverUserId || 'Beneficiary';

      const senderRoleBadge = formatRoleBadge(r.senderRole || 'admin');
      const receiverRoleBadge = formatRoleBadge(r.receiverRole || 'customer');

      const senderWb = typeof r.senderCurrentWalletBalance === 'number' ? `₹${r.senderCurrentWalletBalance.toFixed(2)}` : '—';
      const senderCp = typeof r.senderCurrentCreditBalance === 'number' ? `${r.senderCurrentCreditBalance} pts` : '—';

      const receiverWb = typeof r.receiverCurrentWalletBalance === 'number' ? `₹${r.receiverCurrentWalletBalance.toFixed(2)}` : '—';
      const receiverCp = typeof r.receiverCurrentCreditBalance === 'number' ? `${r.receiverCurrentCreditBalance} pts` : '—';

      const orderTag = r.orderNumber
        ? `<span class="badge" style="background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; font-weight:600; margin-top:0.2rem; display:inline-block;">Order #${escapeHtml(r.orderNumber)}</span>`
        : '';

      return `
        <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background='transparent'">
          <!-- 1. Timestamp -->
          <td style="padding:0.75rem 0.65rem; white-space:nowrap; vertical-align:middle;">
            <div style="font-weight:700; color:#0f172a; font-size:0.83rem;">${escapeHtml(ts.date)}</div>
            <div style="font-size:0.75rem; color:var(--muted);">${escapeHtml(ts.time)}</div>
          </td>

          <!-- 2. Transfer Type -->
          <td style="padding:0.75rem 0.65rem; white-space:nowrap; vertical-align:middle;">
            ${typeBadge}
          </td>

          <!-- 3. Sender User -->
          <td style="padding:0.75rem 0.65rem; vertical-align:middle;">
            <div style="font-weight:700; color:#0f172a; font-size:0.85rem; line-height:1.2;">
              ${escapeHtml(r.senderName || 'Sender')}
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.2rem; flex-wrap:wrap;">
              <code style="font-size:0.72rem; background:#f1f5f9; padding:0.1rem 0.35rem; border-radius:4px; color:#475569;">${escapeHtml(senderIdDisplay)}</code>
              ${senderRoleBadge}
            </div>
          </td>

          <!-- 4. Receiver User -->
          <td style="padding:0.75rem 0.65rem; vertical-align:middle;">
            <div style="font-weight:700; color:#0f172a; font-size:0.85rem; line-height:1.2;">
              ${escapeHtml(r.receiverName || 'Recipient')}
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.2rem; flex-wrap:wrap;">
              <code style="font-size:0.72rem; background:#f1f5f9; padding:0.1rem 0.35rem; border-radius:4px; color:#475569;">${escapeHtml(receiverIdDisplay)}</code>
              ${receiverRoleBadge}
            </div>
          </td>

          <!-- 5. Amount Transferred -->
          <td style="padding:0.75rem 0.65rem; white-space:nowrap; text-align:right; vertical-align:middle;">
            ${amountDisplay}
          </td>

          <!-- 6. Sender Balance At Transfer -->
          <td style="padding:0.75rem 0.65rem; font-size:0.76rem; color:#475569; vertical-align:middle; white-space:nowrap;">
            <div>💵 ${senderWb}</div>
            <div>💳 ${senderCp}</div>
          </td>

          <!-- 7. Receiver Balance At Transfer -->
          <td style="padding:0.75rem 0.65rem; font-size:0.76rem; color:#475569; vertical-align:middle; white-space:nowrap;">
            <div>💵 ${receiverWb}</div>
            <div>💳 ${receiverCp}</div>
          </td>

          <!-- 8. Purpose & Reference -->
          <td style="padding:0.75rem 0.65rem; vertical-align:middle; min-width:180px;">
            <div style="font-size:0.8rem; color:#334155; line-height:1.35;">
              ${escapeHtml(r.purpose || 'Direct Transfer')}
            </div>
            ${orderTag}
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <div style="overflow-x:auto; border:1px solid #e2e8f0; border-radius:10px;">
      <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.82rem;">
        <thead>
          <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0; color:#475569; font-size:0.74rem; text-transform:uppercase; letter-spacing:0.04em;">
            <th style="padding:0.65rem; font-weight:700;">Timestamp</th>
            <th style="padding:0.65rem; font-weight:700;">Transfer</th>
            <th style="padding:0.65rem; font-weight:700;">Sender</th>
            <th style="padding:0.65rem; font-weight:700;">Receiver</th>
            <th style="padding:0.65rem; font-weight:700; text-align:right;">Amt trnsfrd</th>
            <th style="padding:0.65rem; font-weight:700;" title="Point-in-time balance when this transaction occurred">Sender Bal</th>
            <th style="padding:0.65rem; font-weight:700;" title="Point-in-time balance when this transaction occurred">Receiver Bal</th>
            <th style="padding:0.65rem; font-weight:700;">Purpose</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

function renderFinancePagination(pagination) {
  const bar = document.getElementById('admin-finance-pagination-bar');
  if (!bar) return;

  const page = pagination?.page || 1;
  const total = pagination?.total || 0;
  const totalPages = pagination?.totalPages || 1;
  const limit = pagination?.limit || currentFinanceLimit;

  const fromRecord = total === 0 ? 0 : (page - 1) * limit + 1;
  const toRecord = Math.min(page * limit, total);

  bar.innerHTML = `
    <div style="font-size:0.8rem; color:var(--muted);">
      Showing <strong>${fromRecord}</strong> to <strong>${toRecord}</strong> of <strong>${total}</strong> transfers
    </div>
    <div style="display:flex; align-items:center; gap:0.4rem;">
      <button
        type="button"
        class="btn btn-outline btn-sm"
        style="padding:0.25rem 0.55rem; font-size:0.75rem;"
        ${page <= 1 ? 'disabled' : ''}
        onclick="changeFinancePage(${page - 1})"
      >
        ← Previous
      </button>
      <span style="font-size:0.8rem; font-weight:600; padding:0 0.4rem;">
        Page ${page} of ${totalPages}
      </span>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        style="padding:0.25rem 0.55rem; font-size:0.75rem;"
        ${page >= totalPages ? 'disabled' : ''}
        onclick="changeFinancePage(${page + 1})"
      >
        Next →
      </button>
    </div>
  `;
}

function changeFinancePage(newPage) {
  currentFinancePage = Math.max(1, newPage);
  fetchAdminFinanceTransfers();
}

function resetFinanceFilters() {
  currentFinanceType = 'all';
  currentFinanceRole = 'all';
  currentFinanceSearch = '';
  currentFinanceStartDate = '';
  currentFinanceEndDate = '';
  currentFinancePage = 1;

  const roleSelect = document.getElementById('admin-finance-role-filter');
  if (roleSelect) roleSelect.value = 'all';
  const fromInput = document.getElementById('admin-finance-from-date');
  if (fromInput) fromInput.value = '';
  const toInput = document.getElementById('admin-finance-to-date');
  if (toInput) toInput.value = '';
  const searchInput = document.getElementById('admin-finance-search');
  if (searchInput) searchInput.value = '';

  updateFinancePresetButtons('all');

  fetchAdminFinanceTransfers();
}

function openAdminFinanceTransferModal(recipientId = '', transferType = 'credit_point') {
  const modal = document.getElementById('admin-finance-transfer-modal');
  if (!modal) return;

  const form = document.getElementById('admin-finance-transfer-form');
  if (form) form.reset();

  if (transferType === 'wallet_balance') {
    const radio = document.querySelector('input[name="financeTransferType"][value="wallet_balance"]');
    if (radio) radio.checked = true;
  } else {
    const radio = document.querySelector('input[name="financeTransferType"][value="credit_point"]');
    if (radio) radio.checked = true;
  }

  if (recipientId) {
    const recInput = document.getElementById('admin-finance-recipient-id');
    if (recInput) recInput.value = recipientId;
  }

  handleFinanceModalTypeChange();

  if (typeof openModal === 'function') {
    openModal('admin-finance-transfer-modal');
  }
  modal.classList.add('visible');
  modal.style.display = 'grid';

  setTimeout(() => {
    if (recipientId) {
      document.getElementById('admin-finance-amount')?.focus();
    } else {
      document.getElementById('admin-finance-recipient-id')?.focus();
    }
  }, 100);
}

function handleFinanceModalTypeChange() {
  const selectedType = document.querySelector('input[name="financeTransferType"]:checked')?.value || 'credit_point';
  const amountLabel = document.getElementById('admin-finance-amount-label');
  const amountInput = document.getElementById('admin-finance-amount');
  const availableDisplay = document.getElementById('admin-finance-available-display');
  const availableBadge = document.getElementById('admin-finance-available-balance-badge');
  const creditLabel = document.getElementById('finance-type-label-credit');
  const walletLabel = document.getElementById('finance-type-label-wallet');

  if (selectedType === 'wallet_balance') {
    if (amountLabel) amountLabel.textContent = 'Transfer Amount (₹ INR) *';
    if (amountInput) {
      amountInput.step = '0.01';
      amountInput.min = '1';
      amountInput.placeholder = 'e.g. 250.00';
    }
    const currentWb = Number(window.currentWallet?.walletBalance ?? 0).toFixed(2);
    if (availableDisplay) availableDisplay.textContent = `₹${currentWb}`;

    // WALLET BALANCE selected -> light green background
    if (walletLabel) {
      walletLabel.style.background = '#f0fdf4';
      walletLabel.style.borderColor = '#86efac';
      walletLabel.style.color = '#166534';
      walletLabel.style.boxShadow = '0 0 0 1px #86efac';
    }
    if (creditLabel) {
      creditLabel.style.background = '#ffffff';
      creditLabel.style.borderColor = '#cbd5e1';
      creditLabel.style.color = '#475569';
      creditLabel.style.boxShadow = 'none';
    }
    if (availableBadge) {
      availableBadge.style.background = '#f0fdf4';
      availableBadge.style.borderColor = '#bbf7d0';
      availableBadge.style.color = '#166534';
    }
  } else {
    if (amountLabel) amountLabel.textContent = 'Transfer Amount (Credit Points) *';
    if (amountInput) {
      amountInput.step = '1';
      amountInput.min = '1';
      amountInput.placeholder = 'e.g. 500';
    }
    const currentCp = Math.round(Number(window.currentWallet?.creditPoint ?? 0)).toLocaleString();
    if (availableDisplay) availableDisplay.textContent = `${currentCp} points`;

    // CREDIT POINTS selected -> light blue background
    if (creditLabel) {
      creditLabel.style.background = '#eff6ff';
      creditLabel.style.borderColor = '#93c5fd';
      creditLabel.style.color = '#1e40af';
      creditLabel.style.boxShadow = '0 0 0 1px #93c5fd';
    }
    if (walletLabel) {
      walletLabel.style.background = '#ffffff';
      walletLabel.style.borderColor = '#cbd5e1';
      walletLabel.style.color = '#475569';
      walletLabel.style.boxShadow = 'none';
    }
    if (availableBadge) {
      availableBadge.style.background = '#eff6ff';
      availableBadge.style.borderColor = '#bfdbfe';
      availableBadge.style.color = '#1e40af';
    }
  }
}

async function submitAdminFinanceTransfer(event) {
  event.preventDefault();
  if (typeof role !== 'undefined' && role !== 'admin') {
    alert('Only administrators can initiate treasury transfers.');
    return;
  }

  const transferType = document.querySelector('input[name="financeTransferType"]:checked')?.value || 'credit_point';
  const recipientId = document.getElementById('admin-finance-recipient-id')?.value?.trim() || '';
  const amountVal = Number(document.getElementById('admin-finance-amount')?.value);
  const purpose = document.getElementById('admin-finance-purpose')?.value?.trim() || '';
  const orderNumber = document.getElementById('admin-finance-order-number')?.value?.trim() || '';
  const submitBtn = document.getElementById('admin-finance-submit-btn');

  if (!recipientId) {
    alert('Please enter a recipient Account ID, User ID, or mobile number.');
    return;
  }
  if (!amountVal || isNaN(amountVal) || amountVal <= 0) {
    alert('Please enter a valid positive transfer amount.');
    return;
  }
  if (!purpose) {
    alert('Please provide a purpose or reason for this transfer.');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    const result = await apiFetch('/api/admin/finance/transfer', {
      method: 'POST',
      body: JSON.stringify({
        recipientId,
        transferType,
        amount: amountVal,
        purpose,
        orderNumber,
      }),
    });

    if (transferType === 'wallet_balance') {
      if (window.currentWallet && typeof result.senderWalletBalance === 'number') {
        window.currentWallet.walletBalance = result.senderWalletBalance;
      }
    } else {
      if (window.currentWallet && typeof result.adminCreditPoint === 'number') {
        window.currentWallet.creditPoint = result.adminCreditPoint;
      }
    }

    // Refresh profile chip in sidebar
    if (typeof updateProfileWalletDisplay === 'function' && window.currentWallet) {
      updateProfileWalletDisplay(window.currentWallet.walletBalance, window.currentWallet.creditPoint);
    }

    if (typeof closeModal === 'function') {
      closeModal('admin-finance-transfer-modal');
    }

    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: 'Transfer Completed',
        message: result.message || 'Transfer completed successfully.',
        type: 'success',
      });
    } else {
      alert(result.message || 'Transfer completed successfully.');
    }

    // Refresh transfers ledger table
    fetchAdminFinanceTransfers();
  } catch (err) {
    console.error('Finance transfer submit error:', err);
    alert(err.message || 'Unable to complete transfer. Please check balances and recipient ID.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function exportAdminFinanceTransfersCSV() {
  if (!cachedFinanceTransfers || cachedFinanceTransfers.length === 0) {
    alert('No transfer records to export.');
    return;
  }

  const headers = [
    'Timestamp',
    'Transfer',
    'Sender Name',
    'Sender User ID',
    'Sender Role',
    'Beneficiary Name',
    'Beneficiary User ID',
    'Beneficiary Role',
    'Amount Transferred',
    'Sender Current Wallet',
    'Sender Current Credits',
    'Receiver Current Wallet',
    'Receiver Current Credits',
    'Purpose',
    'Order Number',
  ];

  const csvRows = [headers.join(',')];

  for (const r of cachedFinanceTransfers) {
    const ts = formatFinanceTimestamp(r.createdAt);
    const amountVal = Number(r.amount || r.walletBalanceTransferred || r.creditTransferred || 0);
    const row = [
      `"${ts.full}"`,
      `"${r.transferType === 'wallet_balance' ? 'Wallet Balance' : 'Credit Points'}"`,
      `"${(r.senderName || '').replace(/"/g, '""')}"`,
      `"${r.senderUserId || ''}"`,
      `"${r.senderRole || ''}"`,
      `"${(r.receiverName || '').replace(/"/g, '""')}"`,
      `"${r.receiverUserId || ''}"`,
      `"${r.receiverRole || ''}"`,
      amountVal,
      Number(r.senderCurrentWalletBalance || 0),
      Number(r.senderCurrentCreditBalance || 0),
      Number(r.receiverCurrentWalletBalance || 0),
      Number(r.receiverCurrentCreditBalance || 0),
      `"${(r.purpose || '').replace(/"/g, '""')}"`,
      `"${r.orderNumber || ''}"`,
    ];
    csvRows.push(row.join(','));
  }

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tomato_finance_transfers_${formatLocalInputDate(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openAdminFinanceReportModal() {
  const modal = document.getElementById('admin-finance-report-modal');
  if (!modal) {
    console.warn('[AdminFinance] Report modal not found: admin-finance-report-modal');
    return;
  }

  try {
    renderAdminFinanceReportContent();
  } catch (err) {
    console.error('[AdminFinance] Error rendering report content:', err);
  }

  if (typeof openModal === 'function') {
    openModal('admin-finance-report-modal');
  }
  modal.classList.add('visible');
  modal.style.display = 'grid';
}

function closeAdminFinanceReportModal() {
  const modal = document.getElementById('admin-finance-report-modal');
  if (modal) {
    modal.classList.remove('visible');
    modal.style.display = 'none';
  }
  if (typeof closeModal === 'function') {
    closeModal('admin-finance-report-modal');
  }
}

function printAdminFinanceReport() {
  const content = document.getElementById('admin-finance-report-content');
  if (!content) {
    window.print();
    return;
  }

  // Ensure latest figures and calculations are populated
  try {
    renderAdminFinanceReportContent();
  } catch (err) {
    console.error('[AdminFinance] Error updating report content before print:', err);
  }

  try {
    let iframe = document.getElementById('admin-finance-print-iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'admin-finance-print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Treasury Finance &amp; Settlement Audit Report - Lightbits Infotech</title>
          <style>
            * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
            body { margin: 0; padding: 24px; color: #0f172a; background: #ffffff; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
            th { background: #f8fafc; font-weight: 700; }
            .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; }
            @page {
              margin: 12mm;
              size: auto;
            }
            @media print {
              body { padding: 0; }
              table { page-break-inside: auto; }
              tr { page-break-inside: avoid; page-break-after: auto; }
              thead { display: table-header-group; }
            }
          </style>
        </head>
        <body>
          ${content.innerHTML}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.warn('[AdminFinance] Iframe print failed, falling back to window.print():', err);
        window.print();
      }
    }, 250);
  } catch (err) {
    console.warn('[AdminFinance] Print handler error, falling back to window.print():', err);
    window.print();
  }
}

function renderAdminFinanceReportContent() {
  const container = document.getElementById('admin-finance-report-content');
  if (!container) return;

  const s = financeSummary || {};
  const transfers = cachedFinanceTransfers || [];

  const adminWallet = formatNumber(s.adminWalletBalance || 0, 2);
  const adminCredits = formatNumber(s.adminCreditPoints || 0, 0);
  const totalSettled = formatNumber(s.totalWalletBalanceTransferred || 0, 2);
  const totalCredits = formatNumber(s.totalCreditPointsTransferred || 0, 0);
  const todayWallet = formatNumber(s.todayWalletTransferred || 0, 2);
  const todayCredits = formatNumber(s.todayCreditsTransferred || 0, 0);

  const genDate = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const periodLabel = currentFinanceStartDate || currentFinanceEndDate
    ? `From ${currentFinanceStartDate || 'Earliest'} to ${currentFinanceEndDate || 'Latest'}`
    : 'All Time Historical';

  // Calculate Breakdown by Beneficiary Role
  const roleBreakdown = {
    customer: { count: 0, wallet: 0, credits: 0, label: 'Customers' },
    restaurant: { count: 0, wallet: 0, credits: 0, label: 'Restaurants' },
    shop: { count: 0, wallet: 0, credits: 0, label: 'Shops' },
    rider: { count: 0, wallet: 0, credits: 0, label: 'Delivery Riders' },
    admin: { count: 0, wallet: 0, credits: 0, label: 'Platform Admins' },
    other: { count: 0, wallet: 0, credits: 0, label: 'Other Accounts' },
  };

  transfers.forEach((t) => {
    const rawRole = String(t.receiverRole || '').toLowerCase();
    const isW = t.transferType === 'wallet_balance';
    const amt = Number(t.amount || 0);
    let key = 'other';
    if (rawRole.includes('rest')) key = 'restaurant';
    else if (rawRole.includes('shop')) key = 'shop';
    else if (rawRole.includes('ride') || rawRole.includes('deliver')) key = 'rider';
    else if (rawRole.includes('cust')) key = 'customer';
    else if (rawRole.includes('admin')) key = 'admin';

    roleBreakdown[key].count += 1;
    if (isW) roleBreakdown[key].wallet += amt;
    else roleBreakdown[key].credits += amt;
  });

  container.innerHTML = `
    <!-- Report Statement Header -->
    <div style="border-bottom:2px solid #e2e8f0; padding-bottom:1rem; margin-bottom:1.25rem;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem;">
            <span style="font-size:1.4rem;">🍅</span>
            <span style="font-size:1.2rem; font-weight:800; color:#0f172a; letter-spacing:-0.02em;">Lightbits Infotech</span>
          </div>
          <span style="font-size:0.85rem; font-weight:700; color:#e23744; text-transform:uppercase; letter-spacing:0.04em;">Central Treasury &amp; Financial Audit Statement</span>
        </div>
        <div style="text-align:right; font-size:0.78rem; color:#64748b;">
          <div><strong>Generated On:</strong> ${genDate}</div>
          <div><strong>Scope / Period:</strong> ${escapeHtml(periodLabel)}</div>
          <div><strong>Role Filter:</strong> ${escapeHtml((currentFinanceRole || 'all').toUpperCase())} | <strong>Type:</strong> ${escapeHtml((currentFinanceType || 'all').toUpperCase())}</div>
        </div>
      </div>
    </div>

    <!-- Executive KPI Grid -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:0.75rem; margin-bottom:1.25rem;">
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:0.85rem 1rem;">
        <span style="font-size:0.72rem; text-transform:uppercase; font-weight:700; color:#15803d;">Admin Live Wallet Balance</span>
        <div style="font-size:1.35rem; font-weight:800; color:#16a34a; margin:0.25rem 0;">₹${adminWallet}</div>
        <span style="font-size:0.7rem; color:#166534;">Verified Treasury Funds</span>
      </div>

      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:0.85rem 1rem;">
        <span style="font-size:0.72rem; text-transform:uppercase; font-weight:700; color:#1d4ed8;">Admin Credit Points Pool</span>
        <div style="font-size:1.35rem; font-weight:800; color:#2563eb; margin:0.25rem 0;">${adminCredits} pts</div>
        <span style="font-size:0.7rem; color:#1e40af;">Reward / Incentive Pool</span>
      </div>

      <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:0.85rem 1rem;">
        <span style="font-size:0.72rem; text-transform:uppercase; font-weight:700; color:#c2410c;">Total Settled Funds</span>
        <div style="font-size:1.35rem; font-weight:800; color:#ea580c; margin:0.25rem 0;">₹${totalSettled}</div>
        <div
          onclick="closeAdminFinanceReportModal(); filterFinanceByToday('wallet_balance');"
          title="Click to view today's wallet settlements in finance ledger"
          style="font-size:0.72rem; color:#9a3412; cursor:pointer; font-weight:600; text-decoration:underline; display:inline-block;"
        >
          Today: ₹${todayWallet} settled ↗
        </div>
      </div>

      <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:8px; padding:0.85rem 1rem;">
        <span style="font-size:0.72rem; text-transform:uppercase; font-weight:700; color:#4338ca;">Total Points Disbursed</span>
        <div style="font-size:1.35rem; font-weight:800; color:#4f46e5; margin:0.25rem 0;">${totalCredits} pts</div>
        <div
          onclick="closeAdminFinanceReportModal(); filterFinanceByToday('credit_point');"
          title="Click to view today's disbursed credit points in finance ledger"
          style="font-size:0.72rem; color:#3730a3; cursor:pointer; font-weight:600; text-decoration:underline; display:inline-block;"
        >
          Today: +${todayCredits} pts disbursed ↗
        </div>
      </div>
    </div>

    <!-- Role-Wise Disbursement Breakdown -->
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:9px; padding:1rem; margin-bottom:1.25rem;">
      <h3 style="font-size:0.86rem; font-weight:800; color:#1e293b; margin:0 0 0.75rem 0; text-transform:uppercase; letter-spacing:0.04em;">
        👥 Disbursement &amp; Settlement Distribution by Role
      </h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0.65rem;">
        ${Object.values(roleBreakdown).map((rb) => `
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:7px; padding:0.65rem 0.8rem;">
            <strong style="font-size:0.8rem; color:#334155; display:block; margin-bottom:0.2rem;">${escapeHtml(rb.label)}</strong>
            <div style="font-size:0.74rem; color:#64748b;">
              <div>₹${formatNumber(rb.wallet, 2)} settled</div>
              <div>${formatNumber(rb.credits, 0)} pts disbursed</div>
              <span style="font-size:0.68rem; color:#94a3b8;">${rb.count} transfers</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Detailed Ledger Audit Table -->
    <div style="margin-bottom:1rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
        <h3 style="font-size:0.86rem; font-weight:800; color:#1e293b; margin:0; text-transform:uppercase; letter-spacing:0.04em;">
          📋 Audited Transfer Ledger Records (${transfers.length} loaded)
        </h3>
        <span style="font-size:0.73rem; color:#64748b;">Live Ledger Verification</span>
      </div>
      <div style="overflow-x:auto; border:1px solid #e2e8f0; border-radius:8px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.76rem; text-align:left;">
          <thead>
            <tr style="background:#f1f5f9; border-bottom:1.5px solid #cbd5e1; color:#475569; font-weight:700; text-transform:uppercase; font-size:0.71rem;">
              <th style="padding:0.55rem 0.7rem;">Timestamp</th>
              <th style="padding:0.55rem 0.7rem;">Transfer</th>
              <th style="padding:0.55rem 0.7rem;">Sender</th>
              <th style="padding:0.55rem 0.7rem;">Receiver</th>
              <th style="padding:0.55rem 0.7rem; text-align:right;">Amt trnsfrd</th>
              <th style="padding:0.55rem 0.7rem;">Purpose</th>
            </tr>
          </thead>
          <tbody>
            ${transfers.length === 0 ? `
              <tr>
                <td colspan="6" style="padding:2rem; text-align:center; color:#94a3b8;">No transfers recorded for the selected filter range.</td>
              </tr>
            ` : transfers.map((r) => {
              const ts = formatFinanceTimestamp(r.createdAt || r.snapshotAt);
              const isW = r.transferType === 'wallet_balance';
              const amtStr = isW ? `₹${formatNumber(r.amount || 0, 2)}` : `${formatNumber(r.amount || 0, 0)} pts`;
              const amtColor = isW ? '#ea580c' : '#4f46e5';
              return `
                <tr style="border-bottom:1px solid #f1f5f9;">
                  <td style="padding:0.5rem 0.7rem; font-family:monospace; color:#64748b; white-space:nowrap;">${escapeHtml(ts.full || ts)}</td>
                  <td style="padding:0.5rem 0.7rem;">
                    <span class="badge" style="${isW ? 'background:#ffedd5; color:#9a3412;' : 'background:#e0e7ff; color:#3730a3;'} font-size:0.69rem; font-weight:700;">
                      ${isW ? '💵 Wallet' : '💳 Points'}
                    </span>
                  </td>
                  <td style="padding:0.5rem 0.7rem;">
                    <strong style="color:#1e293b; font-size:0.76rem;">${escapeHtml(r.senderName || 'Admin')}</strong>
                    <span style="font-size:0.68rem; color:#94a3b8; display:block;">${escapeHtml(r.senderRole || 'admin')}</span>
                  </td>
                  <td style="padding:0.5rem 0.7rem;">
                    <strong style="color:#1e293b; font-size:0.76rem;">${escapeHtml(r.receiverName || 'User')}</strong>
                    <span style="font-size:0.68rem; color:#94a3b8; display:block;">${escapeHtml(r.receiverRole || 'customer')}</span>
                  </td>
                  <td style="padding:0.5rem 0.7rem; text-align:right; font-weight:800; color:${amtColor}; white-space:nowrap;">
                    ${amtStr}
                  </td>
                  <td style="padding:0.5rem 0.7rem; color:#475569; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${escapeHtml(r.purpose || '—')}
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

// Global exports
window.loadAdminFinancePanel = loadAdminFinancePanel;
window.fetchAdminFinanceTransfers = fetchAdminFinanceTransfers;
window.selectFinanceType = selectFinanceType;
window.handleFinanceRoleChange = handleFinanceRoleChange;
window.handleFinanceDateChange = handleFinanceDateChange;
window.setFinanceDatePreset = setFinanceDatePreset;
window.handleFinanceSearchInput = handleFinanceSearchInput;
window.clearFinanceSearch = clearFinanceSearch;
window.changeFinancePage = changeFinancePage;
window.resetFinanceFilters = resetFinanceFilters;
window.openAdminFinanceTransferModal = openAdminFinanceTransferModal;
window.handleFinanceModalTypeChange = handleFinanceModalTypeChange;
window.submitAdminFinanceTransfer = submitAdminFinanceTransfer;
window.exportAdminFinanceTransfersCSV = exportAdminFinanceTransfersCSV;
window.openAdminFinanceReportModal = openAdminFinanceReportModal;
window.closeAdminFinanceReportModal = closeAdminFinanceReportModal;
window.printAdminFinanceReport = printAdminFinanceReport;
window.renderAdminFinanceReportContent = renderAdminFinanceReportContent;
window.formatNumber = formatNumber;
window.filterFinanceByToday = filterFinanceByToday;

