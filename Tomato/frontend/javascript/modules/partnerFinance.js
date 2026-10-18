// =========================================================================
// PARTNER FINANCE & TRANSFER AUDIT LEDGER MODULE (RESTAURANT / SHOP)
// Real-time tracking of Credit Points & Wallet Balance Transfers with Timestamps
// =========================================================================

let cachedPartnerFinanceTransfers = [];
let partnerFinanceSummary = {};
let currentPartnerFinancePage = 1;
let currentPartnerFinanceLimit = 25;
let currentPartnerFinanceType = 'all'; // 'all' | 'credit_point' | 'wallet_balance'
let currentPartnerFinanceRole = 'all';
let currentPartnerFinanceSearch = '';
let currentPartnerFinanceStartDate = '';
let currentPartnerFinanceEndDate = '';
let partnerFinanceSearchTimer = null;

function escapePartnerHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPartnerLocalInputDate(d) {
  if (!d || isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPartnerNumber(val, decimals = 2) {
  const n = Number(val || 0);
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPartnerFinanceTimestamp(dateVal) {
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

function formatPartnerRoleBadge(rRole) {
  const r = String(rRole || 'customer').toLowerCase();
  if (r === 'admin') return '<span class="badge" style="background:#fee2e2; color:#991b1b; font-size:0.7rem; font-weight:700;">Admin</span>';
  if (r === 'subadmin') return '<span class="badge" style="background:#e0e7ff; color:#3730a3; font-size:0.7rem; font-weight:700;">Sub-Admin</span>';
  if (r === 'restaurant') return '<span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.7rem; font-weight:700;">Restaurant</span>';
  if (r === 'shop') return '<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.7rem; font-weight:700;">Shop</span>';
  if (r === 'deliverypartner' || r === 'rider') return '<span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.7rem; font-weight:700;">Rider</span>';
  return '<span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; font-weight:700;">Customer</span>';
}

function getPartnerApiPrefix() {
  const activeRole = typeof role !== 'undefined' ? role : (window.user?.role || 'restaurant');
  return activeRole === 'shop' ? '/api/shop/finance' : '/api/restaurant/finance';
}

async function loadPartnerFinancePanel() {
  if (typeof refreshProfileWallet === 'function') {
    refreshProfileWallet().catch(() => {});
  }
  await fetchPartnerFinanceTransfers();
}

async function fetchPartnerFinanceTransfers() {
  const container = document.getElementById('partner-finance-table-container');
  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted);">
        <div class="spinner" style="margin:0 auto 0.75rem auto; width:28px; height:28px; border:3px solid #e2e8f0; border-top-color:var(--tomato); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <p style="font-size:0.88rem; margin:0;">Loading store transfer audit ledger from server...</p>
      </div>
    `;
  }

  try {
    const params = new URLSearchParams({
      page: String(currentPartnerFinancePage),
      limit: String(currentPartnerFinanceLimit),
      transferType: currentPartnerFinanceType,
      role: currentPartnerFinanceRole,
      today: formatPartnerLocalInputDate(new Date()),
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });

    if (currentPartnerFinanceSearch) params.append('search', currentPartnerFinanceSearch);
    if (currentPartnerFinanceStartDate) params.append('startDate', currentPartnerFinanceStartDate);
    if (currentPartnerFinanceEndDate) params.append('endDate', currentPartnerFinanceEndDate);

    const apiBase = getPartnerApiPrefix();
    const data = await apiFetch(`${apiBase}/transfers?${params.toString()}`);
    cachedPartnerFinanceTransfers = Array.isArray(data.records) ? data.records : [];
    partnerFinanceSummary = data.summary || {};

    renderPartnerFinanceKPIs(partnerFinanceSummary);
    renderPartnerFinanceTypePills();
    renderPartnerFinanceTable(cachedPartnerFinanceTransfers);
    renderPartnerFinancePagination(data.pagination);
  } catch (err) {
    console.error('Fetch partner finance transfers error:', err);
    if (container) {
      container.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:1.25rem; text-align:center; color:#991b1b;">
          <strong style="display:block; margin-bottom:0.35rem;">Failed to load finance transfers</strong>
          <span style="font-size:0.84rem;">${escapePartnerHtml(err.message || 'Unable to retrieve transfers from server.')}</span>
          <div style="margin-top:0.85rem;">
            <button type="button" class="btn btn-outline btn-sm" onclick="fetchPartnerFinanceTransfers()">↻ Retry</button>
          </div>
        </div>
      `;
    }
  }
}

function renderPartnerFinanceKPIs(summary) {
  const kpiContainer = document.getElementById('partner-finance-kpis');
  if (!kpiContainer) return;

  const partnerWbNum = typeof summary.partnerWalletBalance === 'number'
    ? summary.partnerWalletBalance
    : typeof summary.adminWalletBalance === 'number'
      ? summary.adminWalletBalance
      : Number(window.currentWallet?.walletBalance ?? 0);

  const partnerCpNum = typeof summary.partnerCreditPoints === 'number'
    ? summary.partnerCreditPoints
    : typeof summary.adminCreditPoints === 'number'
      ? summary.adminCreditPoints
      : Number(window.currentWallet?.creditPoint ?? 0);

  const partnerWb = partnerWbNum.toFixed(2);
  const partnerCp = Math.round(partnerCpNum).toLocaleString();

  // Keep window.currentWallet and header display in continuous sync with the backend wallet
  if (window.currentWallet) {
    window.currentWallet.walletBalance = partnerWbNum;
    window.currentWallet.creditPoint = partnerCpNum;
    if (typeof updateProfileWalletDisplay === 'function') {
      updateProfileWalletDisplay(partnerWbNum, partnerCpNum);
    }
  }

  const totalCredits = summary.totalCreditPointsTransferred ? Number(summary.totalCreditPointsTransferred).toLocaleString() : '0';
  const totalWallet = Number(summary.totalWalletBalanceTransferred || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalTrans = Number(summary.totalTransfers || 0).toLocaleString();
  const todayTrans = Number(summary.todayTransfersCount || 0).toLocaleString();
  const todayWallet = Number(summary.todayWalletTransferred || 0).toFixed(2);
  const todayCredits = Number(summary.todayCreditsTransferred || 0).toLocaleString();

  kpiContainer.innerHTML = `
    <!-- 1. LIVE STORE WALLET BALANCE -->
    <div class="stat-card" style="background:#fff; border:1px solid #86efac; border-left:4px solid #16a34a; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#166534; font-weight:700;">
        🏪 Store Live Wallet Balance
      </span>
      <div class="stat-value" style="font-size:1.55rem; font-weight:800; color:#16a34a; margin:0.3rem 0;">
        ₹${partnerWb}
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#15803d; font-weight:600;">
        🟢 Live synced with store wallet
      </span>
    </div>

    <!-- 2. LIVE STORE CREDIT POINTS POOL -->
    <div class="stat-card" style="background:#fff; border:1px solid #bfdbfe; border-left:4px solid #2563eb; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#1e40af; font-weight:700;">
        💳 Store Live Credit Points
      </span>
      <div class="stat-value" style="font-size:1.55rem; font-weight:800; color:#2563eb; margin:0.3rem 0;">
        ${partnerCp} <span style="font-size:0.9rem; font-weight:600;">pts</span>
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#1d4ed8; font-weight:600;">
        🔵 Live synced with store points
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
        onclick="filterPartnerFinanceByToday('credit_point')"
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
        onclick="filterPartnerFinanceByToday('wallet_balance')"
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
        onclick="filterPartnerFinanceByToday('all')"
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

function syncPartnerFinanceWithCurrentWallet() {
  if (window.currentWallet) {
    if (!partnerFinanceSummary) partnerFinanceSummary = {};
    partnerFinanceSummary.partnerWalletBalance = window.currentWallet.walletBalance;
    partnerFinanceSummary.partnerCreditPoints = window.currentWallet.creditPoint;
    renderPartnerFinanceKPIs(partnerFinanceSummary);
  }
}
window.syncPartnerFinanceWithCurrentWallet = syncPartnerFinanceWithCurrentWallet;

function renderPartnerFinanceTypePills() {
  const pillsContainer = document.getElementById('partner-finance-type-pills');
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
          const isActive = currentPartnerFinanceType === t.key;
          return `
            <button
              type="button"
              class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}"
              style="padding:0.25rem 0.75rem; font-size:0.78rem; font-weight:600; border-radius:20px;"
              onclick="selectPartnerFinanceType('${t.key}')"
            >
              ${t.label}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function selectPartnerFinanceType(type) {
  currentPartnerFinanceType = type;
  currentPartnerFinancePage = 1;
  fetchPartnerFinanceTransfers();
}

function handlePartnerFinanceRoleChange(rRole) {
  currentPartnerFinanceRole = rRole;
  currentPartnerFinancePage = 1;
  fetchPartnerFinanceTransfers();
}

function updatePartnerFinancePresetButtons(activePreset) {
  const buttons = document.querySelectorAll('.partner-finance-preset-btn');
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

function handlePartnerFinanceDateChange() {
  currentPartnerFinanceStartDate = document.getElementById('partner-finance-from-date')?.value || '';
  currentPartnerFinanceEndDate = document.getElementById('partner-finance-to-date')?.value || '';
  updatePartnerFinancePresetButtons('');
  currentPartnerFinancePage = 1;
  fetchPartnerFinanceTransfers();
}

function setPartnerFinanceDatePreset(preset) {
  const fromInput = document.getElementById('partner-finance-from-date');
  const toInput = document.getElementById('partner-finance-to-date');

  const today = new Date();

  if (preset === 'today') {
    const todayStr = formatPartnerLocalInputDate(today);
    currentPartnerFinanceStartDate = todayStr;
    currentPartnerFinanceEndDate = todayStr;
  } else if (preset === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    currentPartnerFinanceStartDate = formatPartnerLocalInputDate(d);
    currentPartnerFinanceEndDate = formatPartnerLocalInputDate(today);
  } else if (preset === '30days') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    currentPartnerFinanceStartDate = formatPartnerLocalInputDate(d);
    currentPartnerFinanceEndDate = formatPartnerLocalInputDate(today);
  } else if (preset === 'all') {
    currentPartnerFinanceStartDate = '';
    currentPartnerFinanceEndDate = '';
  }

  if (fromInput) fromInput.value = currentPartnerFinanceStartDate;
  if (toInput) toInput.value = currentPartnerFinanceEndDate;

  currentPartnerFinancePage = 1;
  fetchPartnerFinanceTransfers();
}

function filterPartnerFinanceByToday(type = 'all') {
  currentPartnerFinanceType = type;
  const todayStr = formatPartnerLocalInputDate(new Date());
  currentPartnerFinanceStartDate = todayStr;
  currentPartnerFinanceEndDate = todayStr;

  const fromInput = document.getElementById('partner-finance-from-date');
  const toInput = document.getElementById('partner-finance-to-date');
  if (fromInput) fromInput.value = todayStr;
  if (toInput) toInput.value = todayStr;

  updatePartnerFinancePresetButtons('today');

  currentPartnerFinanceRole = 'all';
  const roleSelect = document.getElementById('partner-finance-role-filter');
  if (roleSelect) roleSelect.value = 'all';

  currentPartnerFinanceSearch = '';
  const searchInput = document.getElementById('partner-finance-search');
  if (searchInput) searchInput.value = '';

  currentPartnerFinancePage = 1;

  fetchPartnerFinanceTransfers();

  setTimeout(() => {
    const tableEl = document.getElementById('partner-finance-table-container');
    if (tableEl) {
      tableEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 120);
}

function handlePartnerFinanceSearchInput(val) {
  clearTimeout(partnerFinanceSearchTimer);
  partnerFinanceSearchTimer = setTimeout(() => {
    currentPartnerFinanceSearch = String(val || '').trim();
    currentPartnerFinancePage = 1;
    fetchPartnerFinanceTransfers();
  }, 300);
}

function clearPartnerFinanceSearch() {
  const searchInput = document.getElementById('partner-finance-search');
  if (searchInput) searchInput.value = '';
  currentPartnerFinanceSearch = '';
  currentPartnerFinancePage = 1;
  fetchPartnerFinanceTransfers();
}

function renderPartnerFinanceTable(records) {
  const container = document.getElementById('partner-finance-table-container');
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:3rem 1rem; color:var(--muted); background:#fcfcfc; border:1px dashed #cbd5e1; border-radius:10px;">
        <span style="font-size:2rem; display:block; margin-bottom:0.5rem;">💸</span>
        <strong style="color:var(--ink); font-size:1rem; display:block; margin-bottom:0.25rem;">No transfer records found</strong>
        <p style="font-size:0.84rem; margin:0; max-width:400px; margin:0 auto;">
          No credit point or wallet balance transfers matched the selected criteria.
        </p>
        <button type="button" class="btn btn-outline btn-sm" style="margin-top:1rem;" onclick="resetPartnerFinanceFilters()">Reset Filters</button>
      </div>
    `;
    return;
  }

  const rowsHtml = records
    .map((r) => {
      const ts = formatPartnerFinanceTimestamp(r.createdAt);
      const isWallet = r.transferType === 'wallet_balance';
      const amountVal = Number(r.amount || r.walletBalanceTransferred || r.creditTransferred || 0);

      const typeBadge = isWallet
        ? `<span class="badge" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-weight:700;">💵 Wallet Balance</span>`
        : `<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700;">💳 Credit Points</span>`;

      const amountDisplay = isWallet
        ? `<span style="font-weight:800; color:#059669; font-size:0.92rem;">+₹${amountVal.toFixed(2)}</span>`
        : `<span style="font-weight:800; color:#2563eb; font-size:0.92rem;">+${Math.round(amountVal).toLocaleString()} pts</span>`;

      const senderIdDisplay = r.senderUserId || 'Store Account';
      const receiverIdDisplay = r.receiverUserId || 'Beneficiary';

      const senderRoleBadge = formatPartnerRoleBadge(r.senderRole || 'restaurant');
      const receiverRoleBadge = formatPartnerRoleBadge(r.receiverRole || 'customer');

      const senderWb = typeof r.senderCurrentWalletBalance === 'number' ? `₹${r.senderCurrentWalletBalance.toFixed(2)}` : '—';
      const senderCp = typeof r.senderCurrentCreditBalance === 'number' ? `${r.senderCurrentCreditBalance} pts` : '—';

      const receiverWb = typeof r.receiverCurrentWalletBalance === 'number' ? `₹${r.receiverCurrentWalletBalance.toFixed(2)}` : '—';
      const receiverCp = typeof r.receiverCurrentCreditBalance === 'number' ? `${r.receiverCurrentCreditBalance} pts` : '—';

      const orderTag = r.orderNumber
        ? `<span class="badge" style="background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; font-weight:600; margin-top:0.2rem; display:inline-block;">Order #${escapePartnerHtml(r.orderNumber)}</span>`
        : '';

      return `
        <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background='transparent'">
          <!-- 1. Timestamp -->
          <td style="padding:0.75rem 0.65rem; white-space:nowrap; vertical-align:middle;">
            <div style="font-weight:700; color:#0f172a; font-size:0.83rem;">${escapePartnerHtml(ts.date)}</div>
            <div style="font-size:0.75rem; color:var(--muted);">${escapePartnerHtml(ts.time)}</div>
          </td>

          <!-- 2. Transfer Type -->
          <td style="padding:0.75rem 0.65rem; white-space:nowrap; vertical-align:middle;">
            ${typeBadge}
          </td>

          <!-- 3. Sender User -->
          <td style="padding:0.75rem 0.65rem; vertical-align:middle;">
            <div style="font-weight:700; color:#0f172a; font-size:0.85rem; line-height:1.2;">
              ${escapePartnerHtml(r.senderName || 'Sender')}
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.2rem; flex-wrap:wrap;">
              <code style="font-size:0.72rem; background:#f1f5f9; padding:0.1rem 0.35rem; border-radius:4px; color:#475569;">${escapePartnerHtml(senderIdDisplay)}</code>
              ${senderRoleBadge}
            </div>
          </td>

          <!-- 4. Receiver User -->
          <td style="padding:0.75rem 0.65rem; vertical-align:middle;">
            <div style="font-weight:700; color:#0f172a; font-size:0.85rem; line-height:1.2;">
              ${escapePartnerHtml(r.receiverName || 'Recipient')}
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.2rem; flex-wrap:wrap;">
              <code style="font-size:0.72rem; background:#f1f5f9; padding:0.1rem 0.35rem; border-radius:4px; color:#475569;">${escapePartnerHtml(receiverIdDisplay)}</code>
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
              ${escapePartnerHtml(r.purpose || 'Direct Transfer')}
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

function renderPartnerFinancePagination(pagination) {
  const bar = document.getElementById('partner-finance-pagination-bar');
  if (!bar) return;

  const page = pagination?.page || 1;
  const total = pagination?.total || 0;
  const totalPages = pagination?.totalPages || 1;
  const limit = pagination?.limit || currentPartnerFinanceLimit;

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
        onclick="changePartnerFinancePage(${page - 1})"
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
        onclick="changePartnerFinancePage(${page + 1})"
      >
        Next →
      </button>
    </div>
  `;
}

function changePartnerFinancePage(newPage) {
  currentPartnerFinancePage = Math.max(1, newPage);
  fetchPartnerFinanceTransfers();
}

function resetPartnerFinanceFilters() {
  currentPartnerFinanceType = 'all';
  currentPartnerFinanceRole = 'all';
  currentPartnerFinanceSearch = '';
  currentPartnerFinanceStartDate = '';
  currentPartnerFinanceEndDate = '';
  currentPartnerFinancePage = 1;

  const roleSelect = document.getElementById('partner-finance-role-filter');
  if (roleSelect) roleSelect.value = 'all';
  const fromInput = document.getElementById('partner-finance-from-date');
  if (fromInput) fromInput.value = '';
  const toInput = document.getElementById('partner-finance-to-date');
  if (toInput) toInput.value = '';
  const searchInput = document.getElementById('partner-finance-search');
  if (searchInput) searchInput.value = '';

  updatePartnerFinancePresetButtons('all');

  fetchPartnerFinanceTransfers();
}

function openPartnerFinanceTransferModal(recipientId = '', transferType = 'credit_point') {
  const modal = document.getElementById('partner-finance-transfer-modal');
  if (!modal) return;

  const form = document.getElementById('partner-finance-transfer-form');
  if (form) form.reset();

  if (transferType === 'wallet_balance') {
    const radio = document.querySelector('input[name="partnerFinanceTransferType"][value="wallet_balance"]');
    if (radio) radio.checked = true;
  } else {
    const radio = document.querySelector('input[name="partnerFinanceTransferType"][value="credit_point"]');
    if (radio) radio.checked = true;
  }

  if (recipientId) {
    const recInput = document.getElementById('partner-finance-recipient-id');
    if (recInput) recInput.value = recipientId;
  }

  handlePartnerFinanceModalTypeChange();

  if (typeof openModal === 'function') {
    openModal('partner-finance-transfer-modal');
  }
  modal.classList.add('visible');
  modal.style.display = 'grid';

  setTimeout(() => {
    if (recipientId) {
      document.getElementById('partner-finance-amount')?.focus();
    } else {
      document.getElementById('partner-finance-recipient-id')?.focus();
    }
  }, 100);
}

function handlePartnerFinanceModalTypeChange() {
  const selectedType = document.querySelector('input[name="partnerFinanceTransferType"]:checked')?.value || 'credit_point';
  const amountLabel = document.getElementById('partner-finance-amount-label');
  const amountInput = document.getElementById('partner-finance-amount');
  const availableDisplay = document.getElementById('partner-finance-available-display');
  const availableBadge = document.getElementById('partner-finance-available-balance-badge');
  const creditLabel = document.getElementById('partner-finance-type-label-credit');
  const walletLabel = document.getElementById('partner-finance-type-label-wallet');

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

async function submitPartnerFinanceTransfer(event) {
  event.preventDefault();
  const activeRole = typeof role !== 'undefined' ? role : (window.user?.role || '');
  if (activeRole !== 'restaurant' && activeRole !== 'shop') {
    alert('Only authorized partners can initiate store transfers.');
    return;
  }

  const transferType = document.querySelector('input[name="partnerFinanceTransferType"]:checked')?.value || 'credit_point';
  const recipientId = document.getElementById('partner-finance-recipient-id')?.value?.trim() || '';
  const amountVal = Number(document.getElementById('partner-finance-amount')?.value);
  const purpose = document.getElementById('partner-finance-purpose')?.value?.trim() || '';
  const orderNumber = document.getElementById('partner-finance-order-number')?.value?.trim() || '';
  const submitBtn = document.getElementById('partner-finance-submit-btn');

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
    const apiBase = getPartnerApiPrefix();
    const result = await apiFetch(`${apiBase}/transfer`, {
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
      closeModal('partner-finance-transfer-modal');
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
    fetchPartnerFinanceTransfers();
  } catch (err) {
    console.error('Partner finance transfer submit error:', err);
    alert(err.message || 'Unable to complete transfer. Please check balances and recipient ID.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function exportPartnerFinanceTransfersCSV() {
  if (!cachedPartnerFinanceTransfers || cachedPartnerFinanceTransfers.length === 0) {
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

  for (const r of cachedPartnerFinanceTransfers) {
    const ts = formatPartnerFinanceTimestamp(r.createdAt);
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
  a.download = `store_finance_transfers_${formatPartnerLocalInputDate(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Global exports
window.loadPartnerFinancePanel = loadPartnerFinancePanel;
window.fetchPartnerFinanceTransfers = fetchPartnerFinanceTransfers;
window.selectPartnerFinanceType = selectPartnerFinanceType;
window.handlePartnerFinanceRoleChange = handlePartnerFinanceRoleChange;
window.handlePartnerFinanceDateChange = handlePartnerFinanceDateChange;
window.setPartnerFinanceDatePreset = setPartnerFinanceDatePreset;
window.handlePartnerFinanceSearchInput = handlePartnerFinanceSearchInput;
window.clearPartnerFinanceSearch = clearPartnerFinanceSearch;
window.changePartnerFinancePage = changePartnerFinancePage;
window.resetPartnerFinanceFilters = resetPartnerFinanceFilters;
window.openPartnerFinanceTransferModal = openPartnerFinanceTransferModal;
window.handlePartnerFinanceModalTypeChange = handlePartnerFinanceModalTypeChange;
window.submitPartnerFinanceTransfer = submitPartnerFinanceTransfer;
window.exportPartnerFinanceTransfersCSV = exportPartnerFinanceTransfersCSV;
window.formatPartnerNumber = formatPartnerNumber;
window.filterPartnerFinanceByToday = filterPartnerFinanceByToday;


