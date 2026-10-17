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
    .replace(/'/g, '&#39;');
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

  const totalCredits = summary.totalCreditPointsTransferred ? Number(summary.totalCreditPointsTransferred).toLocaleString() : '0';
  const totalWallet = Number(summary.totalWalletBalanceTransferred || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalTrans = Number(summary.totalTransfers || 0).toLocaleString();
  const todayTrans = Number(summary.todayTransfersCount || 0).toLocaleString();
  const todayWallet = Number(summary.todayWalletTransferred || 0).toFixed(2);
  const todayCredits = Number(summary.todayCreditsTransferred || 0).toLocaleString();

  kpiContainer.innerHTML = `
    <div class="stat-card" style="background:#fff; border:1px solid #bfdbfe; border-left:4px solid #3b82f6; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#1e40af; font-weight:700;">
        💳 Total Credit Points Transferred
      </span>
      <div class="stat-value" style="font-size:1.5rem; font-weight:800; color:#2563eb; margin:0.3rem 0;">
        ${totalCredits} <span style="font-size:0.9rem; font-weight:600;">pts</span>
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#1d4ed8;">
        Today: +${todayCredits} pts transferred
      </span>
    </div>

    <div class="stat-card" style="background:#fff; border:1px solid #86efac; border-left:4px solid #22c55e; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#166534; font-weight:700;">
        💵 Total Wallet Balance Transferred
      </span>
      <div class="stat-value" style="font-size:1.5rem; font-weight:800; color:#16a34a; margin:0.3rem 0;">
        ₹${totalWallet}
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#15803d;">
        Today: ₹${todayWallet} settled
      </span>
    </div>

    <div class="stat-card" style="background:#fff; border:1px solid #bae6fd; border-left:4px solid #0284c7; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#075985; font-weight:700;">
        🔄 Total Transactions Logged
      </span>
      <div class="stat-value" style="font-size:1.5rem; font-weight:800; color:#0284c7; margin:0.3rem 0;">
        ${totalTrans}
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#0369a1;">
        ${todayTrans} transfers recorded today
      </span>
    </div>

    <div class="stat-card" style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid #64748b; padding:1rem; border-radius:10px;">
      <span class="stat-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#475569; font-weight:700;">
        🛡️ Transfer Engine Status
      </span>
      <div class="stat-value" style="font-size:1.15rem; font-weight:800; color:#0f172a; margin:0.4rem 0;">
        Live Audit Verified
      </div>
      <span class="stat-note" style="font-size:0.76rem; color:#64748b;">
        Synchronized with 'wallet' table
      </span>
    </div>
  `;
}

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

function handleFinanceDateChange() {
  currentFinanceStartDate = document.getElementById('admin-finance-from-date')?.value || '';
  currentFinanceEndDate = document.getElementById('admin-finance-to-date')?.value || '';
  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
}

function setFinanceDatePreset(preset) {
  const fromInput = document.getElementById('admin-finance-from-date');
  const toInput = document.getElementById('admin-finance-to-date');

  const today = new Date();
  const formatInputDate = (d) => d.toISOString().split('T')[0];

  if (preset === 'today') {
    const todayStr = formatInputDate(today);
    currentFinanceStartDate = todayStr;
    currentFinanceEndDate = todayStr;
  } else if (preset === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    currentFinanceStartDate = formatInputDate(d);
    currentFinanceEndDate = formatInputDate(today);
  } else if (preset === '30days') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    currentFinanceStartDate = formatInputDate(d);
    currentFinanceEndDate = formatInputDate(today);
  } else if (preset === 'all') {
    currentFinanceStartDate = '';
    currentFinanceEndDate = '';
  }

  if (fromInput) fromInput.value = currentFinanceStartDate;
  if (toInput) toInput.value = currentFinanceEndDate;
  currentFinancePage = 1;
  fetchAdminFinanceTransfers();
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
            <th style="padding:0.65rem; font-weight:700;">Transfer Type</th>
            <th style="padding:0.65rem; font-weight:700;">Sender</th>
            <th style="padding:0.65rem; font-weight:700;">Beneficiary (Receiver)</th>
            <th style="padding:0.65rem; font-weight:700; text-align:right;">Amount Transferred</th>
            <th style="padding:0.65rem; font-weight:700;">Sender Balance Snapshot</th>
            <th style="padding:0.65rem; font-weight:700;">Receiver Balance Snapshot</th>
            <th style="padding:0.65rem; font-weight:700;">Purpose / Reference</th>
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

  fetchAdminFinanceTransfers();
}

function openAdminFinanceTransferModal() {
  const modal = document.getElementById('admin-finance-transfer-modal');
  if (!modal) return;

  const form = document.getElementById('admin-finance-transfer-form');
  if (form) form.reset();

  handleFinanceModalTypeChange();
  modal.classList.add('active');
}

function handleFinanceModalTypeChange() {
  const selectedType = document.querySelector('input[name="financeTransferType"]:checked')?.value || 'credit_point';
  const amountLabel = document.getElementById('admin-finance-amount-label');
  const amountInput = document.getElementById('admin-finance-amount');
  const availableDisplay = document.getElementById('admin-finance-available-display');
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
    if (creditLabel) creditLabel.style.background = '#fff';
    if (walletLabel) walletLabel.style.background = '#f0fdf4';
  } else {
    if (amountLabel) amountLabel.textContent = 'Transfer Amount (Credit Points) *';
    if (amountInput) {
      amountInput.step = '1';
      amountInput.min = '1';
      amountInput.placeholder = 'e.g. 500';
    }
    const currentCp = Math.round(Number(window.currentWallet?.creditPoint ?? 0)).toLocaleString();
    if (availableDisplay) availableDisplay.textContent = `${currentCp} points`;
    if (creditLabel) creditLabel.style.background = '#fef3c7';
    if (walletLabel) walletLabel.style.background = '#fff';
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
    'Transfer Type',
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
  a.download = `tomato_finance_transfers_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

