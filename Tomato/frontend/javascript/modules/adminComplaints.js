// =========================================================================
// ADMIN & SUB-ADMIN COMPLAINT REVIEW DESK MODULE
// =========================================================================
// =========================================================================
// ADMIN & SUB-ADMIN: COMPLAINT REVIEW DESK CONTROLLER
// =========================================================================
let adminComplaintsList = [];
let currentComplaintFilterStatus = 'all';
let adminComplaintsDebounceTimer = null;

async function fetchAdminComplaints() {
  const tableContainer = document.getElementById('admin-complaints-table-container');
  if (!tableContainer) return;

  // Display skeleton loading on initial or empty load
  if (!tableContainer.innerHTML.trim() || tableContainer.innerHTML.includes('No Complaints Found')) {
    tableContainer.innerHTML = renderTableSkeleton('complaint tickets');
  }

  const userSearchInput = document.getElementById('admin-complaints-user-search');
  const keywordSearchInput = document.getElementById('admin-complaints-keyword-search');
  const roleFilterSelect = document.getElementById('admin-complaints-role-filter');

  const userQuery = userSearchInput ? userSearchInput.value.trim() : '';
  const keywordQuery = keywordSearchInput ? keywordSearchInput.value.trim() : '';
  const roleQuery = roleFilterSelect ? roleFilterSelect.value : 'all';

  const params = new URLSearchParams();
  if (currentComplaintFilterStatus && currentComplaintFilterStatus !== 'all') {
    params.append('status', currentComplaintFilterStatus);
  }
  if (userQuery) {
    params.append('user', userQuery);
  }
  if (keywordQuery) {
    params.append('search', keywordQuery);
  }
  if (roleQuery && roleQuery !== 'all') {
    params.append('role', roleQuery);
  }

  // Active filter indicator updates
  const indicator = document.getElementById('admin-complaints-filter-indicator');
  if (indicator) {
    const activeFilters = [];
    if (currentComplaintFilterStatus !== 'all') activeFilters.push(`Status: ${currentComplaintFilterStatus}`);
    if (userQuery) activeFilters.push(`User: "${userQuery}"`);
    if (keywordQuery) activeFilters.push(`Keyword: "${keywordQuery}"`);
    if (roleQuery !== 'all') activeFilters.push(`Role: ${roleQuery}`);

    if (activeFilters.length > 0) {
      indicator.style.display = 'inline';
      indicator.textContent = `Filtered by (${activeFilters.join(' • ')})`;
    } else {
      indicator.style.display = 'none';
    }
  }

  try {
    const queryString = params.toString();
    const endpoint = `/api/admin/complaints${queryString ? `?${queryString}` : ''}`;
    const res = await apiFetch(endpoint);

    const complaints = res.complaints || [];
    adminComplaintsList = complaints;

    // Compute/update KPI statistics
    const counts = res.counts || {};
    const totalCount = counts.total != null ? counts.total : complaints.length;
    const openCount = counts.open != null ? counts.open : complaints.filter((c) => c.status === 'Open').length;
    const inReviewCount = counts.inReview != null ? counts.inReview : complaints.filter((c) => c.status === 'In Review').length;
    const resolvedCount = counts.resolved != null ? counts.resolved : complaints.filter((c) => c.status === 'Resolved' || c.status === 'Closed').length;

    const totalEl = document.getElementById('complaints-kpi-total');
    const openEl = document.getElementById('complaints-kpi-open');
    const inReviewEl = document.getElementById('complaints-kpi-in-review');
    const resolvedEl = document.getElementById('complaints-kpi-resolved');
    const badgeEl = document.getElementById('admin-complaints-total-badge');

    if (totalEl) totalEl.textContent = totalCount;
    if (openEl) openEl.textContent = openCount;
    if (inReviewEl) inReviewEl.textContent = inReviewCount;
    if (resolvedEl) resolvedEl.textContent = resolvedCount;
    if (badgeEl) badgeEl.textContent = `${totalCount} Complaint${totalCount === 1 ? '' : 's'}`;

    renderAdminComplaintsTable(complaints);
  } catch (err) {
    console.error('Failed to fetch admin complaints:', err);
    tableContainer.innerHTML = `
      <div style="text-align:center; padding:2.5rem; background:#fff; border:1px solid var(--line); border-radius:8px;">
        <span style="font-size:2rem; display:block; margin-bottom:0.5rem;">⚠️</span>
        <h3 style="font-size:1.05rem; margin-bottom:0.4rem; color:var(--ink);">Unable to Load Complaints</h3>
        <p style="color:var(--muted); font-size:0.85rem; margin-bottom:1rem;">${escapeHtml(err.message || 'Server error occurred')}</p>
        <button class="btn btn-outline btn-sm" onclick="fetchAdminComplaints()">Try Again</button>
      </div>
    `;
  }
}
window.fetchAdminComplaints = fetchAdminComplaints;

function renderAdminComplaintsTable(complaints) {
  const tableContainer = document.getElementById('admin-complaints-table-container');
  if (!tableContainer) return;

  if (!complaints || complaints.length === 0) {
    tableContainer.innerHTML = `
      <div style="text-align:center; padding:3rem 1.5rem; background:#fff; border:1px solid var(--line); border-radius:8px;">
        <span style="font-size:2.5rem; display:block; margin-bottom:0.5rem;">🕊️</span>
        <h3 style="font-size:1.1rem; margin-bottom:0.4rem; color:var(--ink);">No Complaints Found</h3>
        <p style="color:var(--muted); font-size:0.85rem; max-width:420px; margin:0 auto 1.25rem;">
          No complaint tickets matched your current search or filter criteria. You can clear the search or change status tabs.
        </p>
        <button class="btn btn-outline btn-sm" onclick="clearAllComplaintFilters()">Reset All Filters</button>
      </div>
    `;
    return;
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Open':
        return `<span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700; font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px;">🔴 Open</span>`;
      case 'In Review':
        return `<span class="badge" style="background:#fef3c7; color:#b45309; font-weight:700; font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px;">🟡 In Review</span>`;
      case 'Resolved':
        return `<span class="badge" style="background:#dcfce7; color:#15803d; font-weight:700; font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px;">🟢 Resolved</span>`;
      case 'Closed':
        return `<span class="badge" style="background:#f1f5f9; color:#475569; font-weight:700; font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px;">⚪ Closed</span>`;
      default:
        return `<span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.75rem; padding:0.2rem 0.55rem; border-radius:999px;">${escapeHtml(status || 'Unknown')}</span>`;
    }
  };

  const getPriorityBadge = (p) => {
    const pr = (p || 'Medium').toLowerCase();
    if (pr === 'urgent' || pr === 'critical') {
      return `<span class="badge" style="background:#dc2626; color:#fff; font-size:0.7rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:4px;">URGENT</span>`;
    } else if (pr === 'high') {
      return `<span class="badge" style="background:#ea580c; color:#fff; font-size:0.7rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:4px;">HIGH</span>`;
    } else if (pr === 'low') {
      return `<span class="badge" style="background:#f1f5f9; color:#64748b; font-size:0.7rem; font-weight:600; padding:0.15rem 0.45rem; border-radius:4px;">LOW</span>`;
    }
    return `<span class="badge" style="background:#fef9c3; color:#854d0e; font-size:0.7rem; font-weight:600; padding:0.15rem 0.45rem; border-radius:4px;">MEDIUM</span>`;
  };

  const getRoleBadge = (r) => {
    const roleStr = (r || 'customer').toLowerCase();
    const colors = {
      customer: { bg: '#e0f2fe', text: '#0369a1', icon: '👤' },
      restaurant: { bg: '#ffedd5', text: '#c2410c', icon: '🏪' },
      shop: { bg: '#f3e8ff', text: '#7e22ce', icon: '🏬' },
      rider: { bg: '#dcfce7', text: '#15803d', icon: '🚴' },
    };
    const style = colors[roleStr] || { bg: '#f1f5f9', text: '#475569', icon: '👥' };
    return `<span class="badge" style="background:${style.bg}; color:${style.text}; font-size:0.72rem; font-weight:600; padding:0.15rem 0.5rem; border-radius:999px; display:inline-flex; align-items:center; gap:0.25rem;">
      <span>${style.icon}</span>${escapeHtml(roleStr)}
    </span>`;
  };

  let html = `
    <div style="overflow-x:auto; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
      <table class="data-table" style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem;">
        <thead>
          <tr style="background:#f8fafc; border-bottom:1px solid var(--line); color:var(--muted); font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em;">
            <th style="padding:0.85rem 1rem;">Ticket / Ref</th>
            <th style="padding:0.85rem 1rem;">Complainant User</th>
            <th style="padding:0.85rem 1rem;">Subject &amp; Category</th>
            <th style="padding:0.85rem 1rem;">Priority</th>
            <th style="padding:0.85rem 1rem;">Status</th>
            <th style="padding:0.85rem 1rem;">Date Filed</th>
            <th style="padding:0.85rem 1rem; text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  complaints.forEach((c) => {
    const cid = c._id || c.id;
    const ticketId = c.ticketId || `TKT-${String(cid).slice(-6).toUpperCase()}`;
    const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';
    const hasAdminComment = Boolean(c.adminComment && c.adminComment.trim());

    html += `
      <tr style="border-bottom:1px solid var(--line); transition:background 0.15s;" onmouseover="this.style.background='#fafaf9'" onmouseout="this.style.background='transparent'">
        <td style="padding:0.85rem 1rem; vertical-align:top;">
          <strong style="color:var(--ink); font-size:0.88rem; display:block;">${escapeHtml(ticketId)}</strong>
          ${c.orderRef ? `<span style="font-size:0.75rem; color:#0284c7; display:block; margin-top:0.2rem;">📦 ${escapeHtml(c.orderRef)}</span>` : ''}
        </td>
        <td style="padding:0.85rem 1rem; vertical-align:top;">
          <div style="font-weight:600; color:var(--ink);">${escapeHtml(c.userName || 'Anonymous User')}</div>
          <div style="font-size:0.78rem; color:var(--muted);">${escapeHtml(c.userEmail || '')}</div>
          <div style="margin-top:0.3rem;">${getRoleBadge(c.userRole)}</div>
          ${c.userId ? `<span style="font-size:0.72rem; color:var(--muted); display:block; margin-top:0.2rem;">ID: ${escapeHtml(c.userId)}</span>` : ''}
        </td>
        <td style="padding:0.85rem 1rem; vertical-align:top; max-width:280px;">
          <div style="font-weight:600; color:var(--ink); line-height:1.3; margin-bottom:0.25rem;">${escapeHtml(c.subject || 'Complaint')}</div>
          <div style="font-size:0.75rem; color:var(--muted); margin-bottom:0.35rem;">Category: <strong>${escapeHtml(c.category || 'General')}</strong></div>
          <div style="font-size:0.8rem; color:#475569; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.35;">
            ${escapeHtml(c.description || '')}
          </div>
          ${hasAdminComment ? `
            <div style="margin-top:0.4rem; padding:0.35rem 0.5rem; background:#f0fdf4; border-left:3px solid #16a34a; border-radius:3px; font-size:0.75rem; color:#166534;">
              <strong>Admin Comment:</strong> ${escapeHtml(c.adminComment)}
            </div>
          ` : ''}
        </td>
        <td style="padding:0.85rem 1rem; vertical-align:top; white-space:nowrap;">
          ${getPriorityBadge(c.priority)}
        </td>
        <td style="padding:0.85rem 1rem; vertical-align:top; white-space:nowrap;">
          ${getStatusBadge(c.status)}
        </td>
        <td style="padding:0.85rem 1rem; vertical-align:top; white-space:nowrap; font-size:0.8rem; color:var(--muted);">
          ${escapeHtml(dateStr)}
        </td>
        <td style="padding:0.85rem 1rem; vertical-align:top; text-align:right; white-space:nowrap;">
          <button
            type="button"
            class="btn btn-outline btn-sm"
            style="padding:0.35rem 0.75rem; font-size:0.8rem; font-weight:600; display:inline-flex; align-items:center; gap:0.3rem;"
            onclick="openReviewComplaintModal('${escapeHtml(cid)}')"
            title="Review complaint, change status, and comment"
          >
            <span>⚖️</span> Review &amp; Comment
          </button>
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  tableContainer.innerHTML = html;
}
window.renderAdminComplaintsTable = renderAdminComplaintsTable;

function setAdminComplaintsStatusFilter(status) {
  currentComplaintFilterStatus = status;
  const tabs = ['all', 'open', 'in-review', 'resolved', 'closed'];
  tabs.forEach((tabId) => {
    const btn = document.getElementById(`complaint-tab-${tabId}`);
    if (btn) {
      const matches =
        (tabId === 'all' && status === 'all') ||
        (tabId === 'open' && status.toLowerCase() === 'open') ||
        (tabId === 'in-review' && status.toLowerCase() === 'in review') ||
        (tabId === 'resolved' && status.toLowerCase() === 'resolved') ||
        (tabId === 'closed' && status.toLowerCase() === 'closed');
      btn.classList.toggle('active', matches);
    }
  });
  fetchAdminComplaints();
}
window.setAdminComplaintsStatusFilter = setAdminComplaintsStatusFilter;

function handleAdminComplaintsFilterChange() {
  fetchAdminComplaints();
}
window.handleAdminComplaintsFilterChange = handleAdminComplaintsFilterChange;

function debounceAdminComplaintsSearch() {
  if (adminComplaintsDebounceTimer) {
    clearTimeout(adminComplaintsDebounceTimer);
  }
  adminComplaintsDebounceTimer = setTimeout(() => {
    fetchAdminComplaints();
  }, 300);
}
window.debounceAdminComplaintsSearch = debounceAdminComplaintsSearch;

function clearComplaintsUserSearch() {
  const input = document.getElementById('admin-complaints-user-search');
  if (input) {
    input.value = '';
    fetchAdminComplaints();
  }
}
window.clearComplaintsUserSearch = clearComplaintsUserSearch;

function clearComplaintsKeywordSearch() {
  const input = document.getElementById('admin-complaints-keyword-search');
  if (input) {
    input.value = '';
    fetchAdminComplaints();
  }
}
window.clearComplaintsKeywordSearch = clearComplaintsKeywordSearch;

function clearAllComplaintFilters() {
  const userInput = document.getElementById('admin-complaints-user-search');
  const keywordInput = document.getElementById('admin-complaints-keyword-search');
  const roleSelect = document.getElementById('admin-complaints-role-filter');
  if (userInput) userInput.value = '';
  if (keywordInput) keywordInput.value = '';
  if (roleSelect) roleSelect.value = 'all';
  setAdminComplaintsStatusFilter('all');
}
window.clearAllComplaintFilters = clearAllComplaintFilters;

function openReviewComplaintModal(complaintId) {
  if (!complaintId) {
    console.warn('openReviewComplaintModal called without complaintId');
    return;
  }

  const complaint = adminComplaintsList.find(
    (c) =>
      String(c._id || '') === String(complaintId) ||
      String(c.id || '') === String(complaintId) ||
      String(c.ticketId || '') === String(complaintId)
  );

  if (!complaint) {
    console.error('Complaint details not found for ID:', complaintId, 'in list:', adminComplaintsList);
    alert('Complaint details not found. Please refresh the Complaint Review list.');
    return;
  }

  const idEl = document.getElementById('review-modal-complaint-id');
  const ticketEl = document.getElementById('review-modal-ticket-id');
  const priorityEl = document.getElementById('review-modal-priority-badge');
  const subjectEl = document.getElementById('review-modal-subject');
  const userNameEl = document.getElementById('review-modal-user-name');
  const roleBadgeEl = document.getElementById('review-modal-user-role-badge');
  const emailEl = document.getElementById('review-modal-user-email');
  const userIdEl = document.getElementById('review-modal-user-id');
  const catEl = document.getElementById('review-modal-category');
  const orderRefEl = document.getElementById('review-modal-order-ref');
  const createdAtEl = document.getElementById('review-modal-created-at');
  const descEl = document.getElementById('review-modal-description');
  const statusSelect = document.getElementById('review-modal-status-select');
  const commentTextarea = document.getElementById('review-modal-comment-textarea');
  const auditBox = document.getElementById('review-modal-audit-info');
  const reviewerNameEl = document.getElementById('review-modal-reviewer-name');
  const reviewedAtEl = document.getElementById('review-modal-reviewed-at');

  const tid = complaint.ticketId || `TKT-${String(complaint._id || complaint.id).slice(-6).toUpperCase()}`;

  if (idEl) idEl.value = complaint._id || complaint.id || complaint.ticketId;
  if (ticketEl) ticketEl.textContent = tid;

  if (priorityEl) {
    priorityEl.textContent = (complaint.priority || 'Medium').toUpperCase();
    const p = (complaint.priority || 'Medium').toLowerCase();
    if (p === 'urgent' || p === 'critical') {
      priorityEl.style.background = '#dc2626';
      priorityEl.style.color = '#fff';
    } else if (p === 'high') {
      priorityEl.style.background = '#ea580c';
      priorityEl.style.color = '#fff';
    } else {
      priorityEl.style.background = '#0369a1';
      priorityEl.style.color = '#fff';
    }
  }

  if (subjectEl) subjectEl.textContent = complaint.subject || 'Complaint';
  if (userNameEl) userNameEl.textContent = complaint.userName || 'Anonymous User';
  if (roleBadgeEl) roleBadgeEl.textContent = (complaint.userRole || 'customer').toUpperCase();
  if (emailEl) emailEl.textContent = complaint.userEmail || 'No email provided';
  if (userIdEl) userIdEl.textContent = `ID: ${complaint.userId || 'N/A'}`;
  if (catEl) catEl.textContent = complaint.category || 'General';
  if (orderRefEl) orderRefEl.textContent = complaint.orderRef ? `Order: ${complaint.orderRef}` : 'Order: None';
  if (createdAtEl) {
    createdAtEl.textContent = complaint.createdAt ? new Date(complaint.createdAt).toLocaleString('en-US') : 'Recently';
  }
  if (descEl) descEl.textContent = complaint.description || 'No detailed description provided.';

  if (statusSelect) {
    statusSelect.value = complaint.status || 'Open';
  }

  if (commentTextarea) {
    commentTextarea.value = complaint.adminComment || '';
  }

  if (auditBox) {
    if (complaint.reviewedBy) {
      auditBox.style.display = 'block';
      if (reviewerNameEl) {
        const rName =
          typeof complaint.reviewedBy === 'object'
            ? complaint.reviewedBy.name || complaint.reviewedBy.userId || 'Admin'
            : complaint.reviewedBy;
        reviewerNameEl.textContent = rName || 'Admin';
      }
      if (reviewedAtEl) {
        reviewedAtEl.textContent = complaint.reviewedAt ? new Date(complaint.reviewedAt).toLocaleString('en-US') : '';
      }
    } else {
      auditBox.style.display = 'none';
    }
  }

  openModal('admin-complaint-review-modal');
}
window.openReviewComplaintModal = openReviewComplaintModal;

async function handleSaveComplaintReview(event) {
  if (event && event.preventDefault) event.preventDefault();

  const idEl = document.getElementById('review-modal-complaint-id');
  const statusSelect = document.getElementById('review-modal-status-select');
  const commentTextarea = document.getElementById('review-modal-comment-textarea');
  const submitBtn = document.getElementById('btn-save-complaint-review');

  if (!idEl || !idEl.value) {
    alert('Complaint ID is missing.');
    return;
  }

  const complaintId = idEl.value;
  const newStatus = statusSelect ? statusSelect.value : 'In Review';
  const adminComment = commentTextarea ? commentTextarea.value.trim() : '';

  if (!adminComment) {
    alert('Please provide an admin review comment or resolution note.');
    if (commentTextarea) commentTextarea.focus();
    return;
  }

  const originalText = submitBtn ? submitBtn.innerHTML : 'Save';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Saving...';
  }

  try {
    const res = await apiFetch(`/api/admin/complaints/${complaintId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: newStatus,
        adminComment: adminComment,
      }),
    });

    closeModal('admin-complaint-review-modal');
    showToastNotification({
      title: 'Complaint Review Saved',
      message: res.message || `Status changed to ${newStatus}`,
      type: 'success',
    });
    fetchAdminComplaints();
  } catch (err) {
    console.error('Failed to update complaint:', err);
    alert(`Error saving complaint review: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}
window.handleSaveComplaintReview = handleSaveComplaintReview;

async function handleDirectCloseComplaint() {
  const statusSelect = document.getElementById('review-modal-status-select');
  const commentTextarea = document.getElementById('review-modal-comment-textarea');

  if (statusSelect) {
    statusSelect.value = 'Closed';
  }

  if (commentTextarea && !commentTextarea.value.trim()) {
    commentTextarea.value = 'Complaint has been reviewed, addressed, and closed by the administrator.';
  }

  const form = document.getElementById('admin-complaint-review-form');
  if (form) {
    handleSaveComplaintReview(new Event('submit'));
  }
}
window.handleDirectCloseComplaint = handleDirectCloseComplaint;

// Admin Analytics Date Helpers & View
function getAdminTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resetAdminAnalyticsDatesToToday() {
  const todayStr = getAdminTodayDateString();
  const startInput = document.getElementById('admin-analytics-start-date');
  const endInput = document.getElementById('admin-analytics-end-date');
  if (startInput) startInput.value = todayStr;
  if (endInput) endInput.value = todayStr;
  fetchAdminAnalytics(false, true);
}
window.resetAdminAnalyticsDatesToToday = resetAdminAnalyticsDatesToToday;

function setAdminAnalyticsLastMonth() {
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

  const startInput = document.getElementById('admin-analytics-start-date');
  const endInput = document.getElementById('admin-analytics-end-date');
  if (startInput) startInput.value = formatYMD(firstDay);
  if (endInput) endInput.value = formatYMD(lastDay);
  fetchAdminAnalytics(false, true);
}
window.setAdminAnalyticsLastMonth = setAdminAnalyticsLastMonth;

function setAdminAnalyticsAllTime() {
  const startInput = document.getElementById('admin-analytics-start-date');
  const endInput = document.getElementById('admin-analytics-end-date');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  fetchAdminAnalytics(true, true);
}
window.setAdminAnalyticsAllTime = setAdminAnalyticsAllTime;

function clearAdminAnalyticsUserId() {
  const userInput = document.getElementById('admin-analytics-user-id');
  if (userInput) {
    userInput.value = '';
  }
  fetchAdminAnalytics(false, true);
}
window.clearAdminAnalyticsUserId = clearAdminAnalyticsUserId;

// Admin Analytics View
async function fetchAdminAnalytics(isAllTime = false, force = false) {
  const container = document.getElementById('admin-analytics-content');
  if (!container) return;

  const startInput = document.getElementById('admin-analytics-start-date');
  const endInput = document.getElementById('admin-analytics-end-date');
  const userInput = document.getElementById('admin-analytics-user-id');
  const subtitleEl = document.getElementById('admin-analytics-period-badge');

  const todayStr = getAdminTodayDateString();

  // If not explicitly all-time, ensure both date boxes show today's date if empty
  if (!isAllTime) {
    if (startInput && !startInput.value) {
      startInput.value = todayStr;
    }
    if (endInput && !endInput.value) {
      endInput.value = todayStr;
    }
  }

  const startDate = startInput ? startInput.value.trim() : '';
  const endDate = endInput ? endInput.value.trim() : '';
  const userId = userInput ? userInput.value.trim() : '';

  const cacheKey = `analytics_${isAllTime}_${startDate}_${endDate}_${userId}`;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  const now = Date.now();

  if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 30000)) {
    return;
  }

  if (!hasExisting) {
    container.innerHTML = renderAnalyticsSkeleton();
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  // Build query string
  const params = new URLSearchParams();
  if (isAllTime) {
    params.set('allTime', 'true');
  } else {
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
  }
  if (userId) {
    params.set('userId', userId);
  }
  const queryParams = params.toString() ? `?${params.toString()}` : '';

  try {
    const data = await apiFetch(`/api/admin/analytics${queryParams}`);
    viewLastFetched[cacheKey] = now;
    const an = data.analytics || {};

    // Format Indian Rupee currency
    const formatRupees = (val) => Number(val || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // Determine date filter state
    const isTodayFilter = an.isToday || (startDate === todayStr && endDate === todayStr);
    let periodBadgeText = 'TODAY';
    let periodBadgeClass = 'badge-delivered';
    let periodSubNote = `GMV sold today (${todayStr})`;

    const userFilterBadge = userId
      ? `<span class="badge badge-accepted" style="font-size:0.75rem; margin-left:0.35rem;">User: ${escapeHtml(userId)}${an.userFilter?.matchedUser ? ` (${escapeHtml(an.userFilter.matchedUser.name)} [${escapeHtml(an.userFilter.matchedUser.role)}])` : ''}</span>`
      : '';

    if (isAllTime) {
      periodBadgeText = 'ALL TIME';
      periodBadgeClass = 'badge-accepted';
      periodSubNote = 'Cumulative platform GMV across all dates';
      if (subtitleEl) {
        subtitleEl.innerHTML = `<span class="badge badge-accepted" style="font-size:0.75rem;">Lifetime Data</span>${userFilterBadge} Showing all analytics metrics across all time`;
      }
    } else if (isTodayFilter) {
      periodBadgeText = 'TODAY';
      periodBadgeClass = 'badge-delivered';
      periodSubNote = `GMV sold today (${todayStr})`;
      if (subtitleEl) {
        subtitleEl.innerHTML = `<span class="badge badge-delivered" style="font-size:0.75rem;">Today: ${todayStr}</span>${userFilterBadge} All fields below reflect activity for today`;
      }
    } else {
      const rangeText = `${startDate || 'Beginning'} to ${endDate || 'Present'}`;
      periodBadgeText = 'PERIOD';
      periodBadgeClass = 'badge-preparing';
      periodSubNote = `GMV for period: ${rangeText}`;
      if (subtitleEl) {
        subtitleEl.innerHTML = `<span class="badge badge-preparing" style="font-size:0.75rem;">Period: ${rangeText}</span>${userFilterBadge} All fields below reflect activity for selected range`;
      }
    }

    const topDishSummary = (an.topDishes && an.topDishes[0]) ? an.topDishes[0].name : 'None';

    container.innerHTML = `
      <!-- Primary KPI Cards (Controlled by Search Button) -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:1rem;">
        <div class="stat-card" style="border-top:3px solid var(--green); background:#fafffa;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="stat-label" style="font-weight:700;">TOTAL PLATFORM GMV</span>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          <div class="stat-value" style="color:var(--green); font-size:1.75rem; margin:0.35rem 0;">₹${formatRupees(an.totalGMV ?? an.periodGMV ?? 0)}</div>
          <span class="stat-note" style="color:var(--charcoal); font-size:0.8rem;">${periodSubNote}</span>
          <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--muted); border-top:1px dashed #dbe5d8; padding-top:0.35rem;">
            Lifetime GMV: <strong style="color:var(--charcoal);">₹${formatRupees(an.lifetimeGMV || 0)}</strong>
          </div>
        </div>

        <div class="stat-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="stat-label">Orders in Period</span>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          <div class="stat-value" style="font-size:1.75rem; margin:0.35rem 0;">${an.periodOrdersCount ?? 0}</div>
          <span class="stat-note">${an.deliveredOrdersCount ?? 0} delivered • ${an.activeOrdersCount ?? 0} in progress</span>
          <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--muted); border-top:1px dashed var(--line); padding-top:0.35rem;">
            Lifetime Orders: <strong style="color:var(--charcoal);">${an.totalOrdersCount || 0}</strong>
          </div>
        </div>

        <div class="stat-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="stat-label">Average Order Value</span>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          <div class="stat-value" style="font-size:1.75rem; margin:0.35rem 0; color:var(--charcoal);">₹${formatRupees(an.avgOrderValue || 0)}</div>
          <span class="stat-note">Fulfillment rate: ${an.fulfillmentRate ?? 100}%</span>
          <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--muted); border-top:1px dashed var(--line); padding-top:0.35rem;">
            Cancelled: <strong style="color:var(--charcoal);">${an.cancelledOrdersCount || 0} orders</strong>
          </div>
        </div>

        <div class="stat-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="stat-label">Food Units Ordered</span>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          <div class="stat-value" style="font-size:1.75rem; margin:0.35rem 0;">${an.totalUnitsSold ?? 0}</div>
          <span class="stat-note">Total items across orders in period</span>
          <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--muted); border-top:1px dashed var(--line); padding-top:0.35rem;">
            Top item: <strong style="color:var(--charcoal);">${escapeHtml(topDishSummary)}</strong>
          </div>
        </div>

        <div class="stat-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="stat-label">Accounts in Period</span>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          <div class="stat-value" style="font-size:1.75rem; margin:0.35rem 0;">${an.periodUsersCount ?? 0}</div>
          <span class="stat-note">${an.periodCustomersCount ?? 0} cust • ${an.periodRestaurantsCount ?? 0} rest • ${an.periodRidersCount ?? 0} riders</span>
          <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--muted); border-top:1px dashed var(--line); padding-top:0.35rem;">
            Total platform directory: <strong style="color:var(--charcoal);">${an.totalUsersCount || 0}</strong>
          </div>
        </div>

        <div class="stat-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="stat-label">Active Delivery Fleet</span>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          <div class="stat-value" style="font-size:1.75rem; margin:0.35rem 0;">${an.activeRidersInPeriod ?? 0}</div>
          <span class="stat-note">Active riders who delivered in period</span>
          <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--muted); border-top:1px dashed var(--line); padding-top:0.35rem;">
            Total fleet: <strong style="color:var(--charcoal);">${an.totalRiders || 0} riders</strong>
          </div>
        </div>
      </div>

      <!-- Detailed Analytical Panels (Controlled by Search Button) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1.5rem; margin-top:1.5rem;">
        
        <!-- 1. Top Selling Dishes in Selected Period -->
        <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:1.2rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 style="font-size:1.05rem; margin:0; font-weight:700;">Top Selling Dishes</h3>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          ${(an.topDishes || []).length ? (an.topDishes || []).map((d, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid #f1eee4;">
              <div style="display:flex; align-items:center; gap:0.6rem;">
                <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; background:#f4f0e6; border-radius:50%; font-size:0.75rem; font-weight:700; color:var(--charcoal);">${idx + 1}</span>
                <div>
                  <strong>${escapeHtml(d.name)}</strong>
                  <div style="font-size:0.75rem; color:var(--muted);">${d.quantity} unit${d.quantity === 1 ? '' : 's'} ordered in period</div>
                </div>
              </div>
              <strong style="color:var(--green); font-size:0.92rem;">₹${formatRupees(d.revenue)}</strong>
            </div>
          `).join('') : '<p style="color:var(--muted); font-size:0.88rem; padding:1rem 0;">No dish sales recorded for this period.</p>'}
        </div>

        <!-- 2. Top Performing Restaurants in Selected Period -->
        <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:1.2rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 style="font-size:1.05rem; margin:0; font-weight:700;">Top Restaurants by Sales</h3>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          ${(an.topRestaurants || []).length ? (an.topRestaurants || []).map((r, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid #f1eee4;">
              <div style="display:flex; align-items:center; gap:0.6rem;">
                <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; background:#f4f0e6; border-radius:50%; font-size:0.75rem; font-weight:700; color:var(--charcoal);">${idx + 1}</span>
                <div>
                  <strong>${escapeHtml(r.name)}</strong>
                  <div style="font-size:0.75rem; color:var(--muted);">${r.orderCount} order${r.orderCount === 1 ? '' : 's'} in period</div>
                </div>
              </div>
              <strong style="color:var(--green); font-size:0.92rem;">₹${formatRupees(r.revenue)}</strong>
            </div>
          `).join('') : '<p style="color:var(--muted); font-size:0.88rem; padding:1rem 0;">No restaurant orders recorded for this period.</p>'}
        </div>

        <!-- 3. Payment Method Breakdown in Selected Period -->
        <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:1.2rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 style="font-size:1.05rem; margin:0; font-weight:700;">Payment Method Breakdown</h3>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          ${(() => {
            const dist = { ...(an.paymentDistribution || {}) };
            const codInfo = dist['cod'] || (an.codDetails ? { count: an.codDetails.totalOrders || 0, volume: an.codDetails.collectedVolume || 0, codDetails: an.codDetails } : null);
            if (codInfo && !dist['cod']) {
              dist['cod'] = codInfo;
            }

            const entries = Object.entries(dist);
            if (!entries.length) {
              return '<p style="color:var(--muted); font-size:0.88rem; padding:1rem 0;">No payment transactions recorded for this period.</p>';
            }

            return entries.map(([method, info]) => {
              const count = typeof info === 'object' ? (info.count || 0) : info;
              const volume = typeof info === 'object' ? (info.volume || 0) : 0;
              const isCod = method === 'cod';
              const cod = isCod ? (info.codDetails || an.codDetails || {}) : null;

              let methodName = 'Cash on Delivery (COD)';
              let methodIcon = '💵';
              if (method === 'razorpay') {
                methodName = 'Razorpay (Online / Cards / UPI)';
                methodIcon = '⚡';
              } else if (method === 'wallet') {
                methodName = 'Tomato In-App Wallet';
                methodIcon = '👛';
              } else if (method === 'upi') {
                methodName = 'Direct UPI';
                methodIcon = '📱';
              } else if (method === 'card') {
                methodName = 'Credit / Debit Card';
                methodIcon = '💳';
              } else if (method !== 'cod') {
                methodName = method.toUpperCase();
                methodIcon = '💳';
              }

              const totalCodVol = cod ? (cod.totalVolume || volume || 0) : 0;
              const codActiveBase = Math.max(1, (totalCodVol - (cod?.cancelledVolume || 0)));
              const cashPct = cod ? Math.min(100, Math.round(((cod.cashVolume || 0) / codActiveBase) * 100)) : 0;
              const upiPct = cod ? Math.min(100, Math.round(((cod.upiVolume || 0) / codActiveBase) * 100)) : 0;
              const pendingPct = cod ? Math.max(0, 100 - cashPct - upiPct) : 0;

              return `
                <div style="padding:0.75rem 0; border-bottom:1px solid #f1eee4;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <div style="display:flex; align-items:center; gap:0.45rem;">
                        <span style="font-size:1.1rem;">${methodIcon}</span>
                        <strong style="font-size:0.92rem; color:var(--ink);">${escapeHtml(methodName)}</strong>
                        ${isCod && cod ? `
                          <span class="badge ${cod.collectionRate >= 80 ? 'badge-delivered' : 'badge-preparing'}" style="font-size:0.68rem; font-weight:800; padding:0.15rem 0.5rem; border-radius:999px;">
                            ${cod.collectionRate || 0}% Collected
                          </span>
                        ` : ''}
                      </div>
                      <div style="font-size:0.75rem; color:var(--muted); margin-top:0.15rem; margin-left:1.55rem;">
                        ${count} order${count === 1 ? '' : 's'} in selected period
                      </div>
                    </div>
                    <div style="text-align:right;">
                      <strong style="color:var(--green); font-size:0.95rem;">₹${formatRupees(volume)}</strong>
                      <div style="font-size:0.72rem; color:var(--muted);">${count} txn${count === 1 ? '' : 's'}</div>
                    </div>
                  </div>

                  ${isCod && cod ? `
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:0.75rem 0.85rem; margin-top:0.6rem; margin-left:0.5rem;">
                      <!-- Visual Pipeline Progress Bar -->
                      <div style="margin-bottom:0.55rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:#475569; margin-bottom:0.25rem;">
                          <span style="font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">COD Settlement Breakdown</span>
                          <span><strong>${cod.collectedOrders || 0}</strong> collected • <strong>${cod.pendingOrders || 0}</strong> pending</span>
                        </div>
                        <div style="height:6px; width:100%; background:#e2e8f0; border-radius:999px; overflow:hidden; display:flex;">
                          <div style="width:${cashPct}%; background:#16a34a;" title="Cash Handed to Rider: ₹${formatRupees(cod.cashVolume || 0)}"></div>
                          <div style="width:${upiPct}%; background:#0284c7;" title="UPI / QR at Doorstep: ₹${formatRupees(cod.upiVolume || 0)}"></div>
                          <div style="width:${pendingPct}%; background:#f59e0b;" title="Pending Delivery Collection: ₹${formatRupees(cod.pendingVolume || 0)}"></div>
                        </div>
                      </div>

                      <!-- Metric Badges Grid -->
                      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:0.45rem;">
                        <div style="background:#fff; border:1px solid #bbf7d0; border-radius:6px; padding:0.4rem 0.55rem;">
                          <div style="font-size:0.68rem; color:#15803d; font-weight:700; display:flex; align-items:center; gap:0.25rem;">
                            <span>💵</span> Physical Cash
                          </div>
                          <div style="font-size:0.92rem; font-weight:800; color:#166534; margin-top:0.1rem;">₹${formatRupees(cod.cashVolume || 0)}</div>
                          <div style="font-size:0.68rem; color:#64748b;">${cod.cashOrders || 0} order${cod.cashOrders === 1 ? '' : 's'} collected</div>
                        </div>

                        <div style="background:#fff; border:1px solid #bae6fd; border-radius:6px; padding:0.4rem 0.55rem;">
                          <div style="font-size:0.68rem; color:#0369a1; font-weight:700; display:flex; align-items:center; gap:0.25rem;">
                            <span>📱</span> UPI / QR Code
                          </div>
                          <div style="font-size:0.92rem; font-weight:800; color:#075985; margin-top:0.1rem;">₹${formatRupees(cod.upiVolume || 0)}</div>
                          <div style="font-size:0.68rem; color:#64748b;">${cod.upiOrders || 0} order${cod.upiOrders === 1 ? '' : 's'} collected</div>
                        </div>

                        <div style="background:#fff; border:1px solid #fde68a; border-radius:6px; padding:0.4rem 0.55rem;">
                          <div style="font-size:0.68rem; color:#b45309; font-weight:700; display:flex; align-items:center; gap:0.25rem;">
                            <span>⏳</span> Pending Collection
                          </div>
                          <div style="font-size:0.92rem; font-weight:800; color:#92400e; margin-top:0.1rem;">₹${formatRupees(cod.pendingVolume || 0)}</div>
                          <div style="font-size:0.68rem; color:#64748b;">${cod.pendingOrders || 0} order${cod.pendingOrders === 1 ? '' : 's'} in delivery</div>
                        </div>

                        ${cod.cancelledOrders ? `
                          <div style="background:#fff; border:1px solid #fecaca; border-radius:6px; padding:0.4rem 0.55rem;">
                            <div style="font-size:0.68rem; color:#b91c1c; font-weight:700; display:flex; align-items:center; gap:0.25rem;">
                              <span>✕</span> Cancelled / Void
                            </div>
                            <div style="font-size:0.92rem; font-weight:800; color:#991b1b; margin-top:0.1rem;">₹${formatRupees(cod.cancelledVolume || 0)}</div>
                            <div style="font-size:0.68rem; color:#64748b;">${cod.cancelledOrders} order${cod.cancelledOrders === 1 ? '' : 's'}</div>
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('');
          })()}

        <!-- 4. Order Status Breakdown in Selected Period -->
        <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:1.2rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h3 style="font-size:1.05rem; margin:0; font-weight:700;">Order Status Pipeline</h3>
            <span class="badge ${periodBadgeClass}" style="font-size:0.72rem;">${periodBadgeText}</span>
          </div>
          ${an.ordersByStatus ? `
            <div style="display:flex; flex-direction:column; gap:0.4rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #f1eee4;">
                <span style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600;"><span style="color:#2d6a4f;">●</span> Delivered</span>
                <span class="badge badge-delivered">${an.ordersByStatus.delivered || 0}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #f1eee4;">
                <span style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600;"><span style="color:#1d4ed8;">●</span> Out For Delivery</span>
                <span class="badge badge-accepted">${an.ordersByStatus.out_for_delivery || 0}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #f1eee4;">
                <span style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600;"><span style="color:#b45309;">●</span> Preparing / In Kitchen</span>
                <span class="badge badge-preparing">${(an.ordersByStatus.preparing || 0) + (an.ordersByStatus.ready_for_pickup || 0)}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #f1eee4;">
                <span style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600;"><span style="color:#64748b;">●</span> Placed / Accepted</span>
                <span class="badge badge-pending">${(an.ordersByStatus.placed || 0) + (an.ordersByStatus.accepted || 0)}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0;">
                <span style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600;"><span style="color:#dc2626;">●</span> Cancelled</span>
                <span class="badge badge-cancelled">${an.ordersByStatus.cancelled || 0}</span>
              </div>
            </div>
          ` : '<p style="color:var(--muted); font-size:0.88rem; padding:1rem 0;">No status data available.</p>'}
        </div>

      </div>
    `;
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">Error loading analytics: ${e.message}</p>`;
    } else {
      console.error('Fetch analytics error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}
window.fetchAdminAnalytics = fetchAdminAnalytics;

