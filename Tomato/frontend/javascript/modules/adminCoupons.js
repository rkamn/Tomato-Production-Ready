// =========================================================================
// COUPONS & DISCOUNTS MANAGEMENT MODULE (ADMIN, PARTNER & CUSTOMER)
// =========================================================================
// =========================================================================
// ADMIN: COUPON & DISCOUNT MANAGEMENT + CUSTOMER BILLING COUPON (MAX 1)
// =========================================================================
const MAX_COUPONS_PER_ORDER_LIMIT = 1;
const COUPON_TYPE_META = {
  instant: { icon: '⚡', label: 'Instant Coupon', badgeBg: '#fef08a', badgeColor: '#854d0e' },
  restaurant_item_category: { icon: '🍽️', label: 'Restaurant Item Category', badgeBg: '#ffedd5', badgeColor: '#c2410c' },
  category_occasion: { icon: '🥂', label: 'Category Occasion', badgeBg: '#fae8ff', badgeColor: '#a21caf' },
  new_user: { icon: '🆕', label: 'New Users', badgeBg: '#dcfce7', badgeColor: '#15803d' },
  festival: { icon: '🪔', label: 'Festivals', badgeBg: '#fef3c7', badgeColor: '#b45309' },
  specific_user: { icon: '👤', label: 'Specific User', badgeBg: '#dbeafe', badgeColor: '#1d4ed8' },
  settlement: { icon: '🤝', label: 'Settlement', badgeBg: '#f1f5f9', badgeColor: '#334155' },
  special_occasion: { icon: '🎉', label: 'Special Occasion', badgeBg: '#fce7f3', badgeColor: '#be185d' },
  shop: { icon: '🏬', label: 'Shop', badgeBg: '#ede9fe', badgeColor: '#6d28d9' },
  grocery: { icon: '🥦', label: 'Grocery', badgeBg: '#d1fae5', badgeColor: '#047857' },
};

let adminCouponsCache = [];
let adminCouponsSummary = {};
let customerAvailableCoupons = [];
let customerIsNewUserFlag = false;
let appliedCouponCodes = [];
let appliedCouponsBreakdown = [];
let appliedTotalDiscount = 0;

function saveCartCouponsToStorage() {
  try {
    localStorage.setItem(
      getCustomerCartCouponsStorageKey(),
      JSON.stringify({
        appliedCouponCodes,
        appliedCouponsBreakdown,
        appliedTotalDiscount,
      })
    );
  } catch (_) {}
}

function loadSavedCartCouponsFromStorage() {
  try {
    const raw = localStorage.getItem(getCustomerCartCouponsStorageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.appliedCouponCodes)) {
      appliedCouponCodes = parsed.appliedCouponCodes.slice(0, MAX_COUPONS_PER_ORDER_LIMIT);
      appliedCouponsBreakdown = Array.isArray(parsed.appliedCouponsBreakdown)
        ? parsed.appliedCouponsBreakdown.slice(0, MAX_COUPONS_PER_ORDER_LIMIT)
        : [];
      appliedTotalDiscount = appliedCouponsBreakdown.length
        ? Number(appliedCouponsBreakdown.reduce((s, c) => s + Number(c.discountAmount || 0), 0).toFixed(2))
        : Number(parsed.appliedTotalDiscount || 0);
    }
  } catch (_) {}
}
if (cart.length) {
  loadSavedCartCouponsFromStorage();
}

function resetAppliedCouponsState() {
  appliedCouponCodes = [];
  appliedCouponsBreakdown = [];
  appliedTotalDiscount = 0;
  saveCartCouponsToStorage();
}

function getActiveCartDiscountAmount(subtotalOverride) {
  const subtotal = typeof subtotalOverride === 'number'
    ? subtotalOverride
    : cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (!subtotal || subtotal <= 0 || !appliedCouponCodes.length) return 0;
  return Number(Math.min(subtotal, Math.max(0, appliedTotalDiscount || 0)).toFixed(2));
}

let cartCouponSyncTimer = null;
function syncCartCouponsOnCartChange() {
  if (!appliedCouponCodes.length || !cart.length) return;
  if (cartCouponSyncTimer) clearTimeout(cartCouponSyncTimer);
  cartCouponSyncTimer = setTimeout(() => {
    validateAndSyncCartCoupons({ silent: true });
  }, 180);
}

async function fetchAdminCoupons() {
  const tableContainer = document.getElementById('admin-coupons-table-container');
  try {
    const res = await apiFetch('/api/admin/coupons');
    adminCouponsCache = Array.isArray(res.coupons) ? res.coupons : [];
    adminCouponsSummary = res.summary || {};
    renderAdminCouponsKPIs();
    renderAdminCouponsTable();
    populateAdminCouponDatalists();
  } catch (err) {
    if (tableContainer) {
      tableContainer.innerHTML = `<p style="color:var(--tomato); padding:1rem;">Failed to load coupons: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function populateAdminCouponDatalists() {
  const catList = document.getElementById('adm-coupon-categories-datalist');
  if (catList) {
    const defaultCats = ['Main Course', 'Starters', 'Sweets', 'Desserts', 'Beverages', 'Biryani', 'Breads', 'Snacks', 'South Indian', 'Chinese', 'Groceries', 'Fresh Produce', 'Dairy & Bakery', 'Household'];
    const dynamicCats = new Set(defaultCats);
    (allMenuItems || []).forEach((m) => { if (m.category) dynamicCats.add(m.category); });
    (allShopItems || []).forEach((s) => { if (s.category) dynamicCats.add(s.category); });
    (adminCouponsCache || []).forEach((c) => { if (c.targetItemCategory) dynamicCats.add(c.targetItemCategory); });
    catList.innerHTML = Array.from(dynamicCats).map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  }
}

function renderAdminCouponsKPIs() {
  const kpiEl = document.getElementById('admin-coupons-kpis');
  if (!kpiEl) return;
  const total = adminCouponsCache.length;
  const activeCount = adminCouponsCache.filter((c) => c.isActive).length;
  const redemptions = adminCouponsCache.reduce((sum, c) => sum + Number(c.usedCount || 0), 0);
  const categoryCovered = new Set(adminCouponsCache.map((c) => c.couponType)).size;

  kpiEl.innerHTML = `
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Total Coupons</div>
      <div style="font-size:1.5rem; font-weight:800; color:var(--ink); margin-top:0.2rem;">${total}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Across ${categoryCovered} of 9 coupon categories</div>
    </div>
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Active for Billing</div>
      <div style="font-size:1.5rem; font-weight:800; color:var(--green); margin-top:0.2rem;">${activeCount}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Inactive / Paused: ${total - activeCount}</div>
    </div>
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Total Redemptions</div>
      <div style="font-size:1.5rem; font-weight:800; color:#c2410c; margin-top:0.2rem;">${redemptions}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Tracked per user &amp; order</div>
    </div>
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Coupon Policy</div>
      <div style="font-size:1.35rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">Max 1 / Billing</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Customers can use only 1 coupon per order</div>
    </div>
  `;
}

function renderAdminCouponsTable() {
  const container = document.getElementById('admin-coupons-table-container');
  if (!container) return;

  const typeFilter = document.getElementById('admin-coupon-type-filter')?.value || 'all';
  const sponsorFilter = document.getElementById('admin-coupon-sponsor-filter')?.value || 'all';
  const storeFilter = document.getElementById('admin-coupon-store-filter')?.value || 'all';
  const statusFilter = document.getElementById('admin-coupon-status-filter')?.value || 'all';
  const searchVal = (document.getElementById('admin-coupon-search')?.value || '').trim().toLowerCase();

  const filtered = adminCouponsCache.filter((c) => {
    if (typeFilter !== 'all' && c.couponType !== typeFilter) return false;
    if (sponsorFilter !== 'all' && (c.sponsorType || 'tomato') !== sponsorFilter) return false;
    if (storeFilter !== 'all' && c.applicableStoreType !== storeFilter && c.applicableStoreType !== 'all') return false;
    if (statusFilter === 'active' && !c.isActive) return false;
    if (statusFilter === 'inactive' && c.isActive) return false;
    if (searchVal) {
      const hay = `${c.code || ''} ${c.title || ''} ${c.description || ''} ${c.couponType || ''} ${c.sponsorType || ''} ${c.partnerName || ''} ${c.targetItemCategory || ''} ${c.occasionName || ''} ${c.targetUserIdentifier || ''}`.toLowerCase();
      if (!hay.includes(searchVal)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--muted); padding:1.2rem 0; text-align:center;">No coupons match the selected filters. Click "Create New Coupon" above to add one.</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Code &amp; Title</th>
            <th>Sponsor &amp; Funding</th>
            <th>Coupon Category</th>
            <th>Discount &amp; Billing Rules</th>
            <th>Target / Eligibility</th>
            <th>Store Scope</th>
            <th>Usage &amp; Validity</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((c) => {
            const meta = COUPON_TYPE_META[c.couponType] || { icon: '🎟️', label: c.couponType, badgeBg: '#f3f4f6', badgeColor: '#374151' };
            const discountBadge = c.discountType === 'percentage'
              ? `${c.discountValue}% OFF${c.maxDiscountAmount > 0 ? ` (Up to ₹${c.maxDiscountAmount})` : ''}`
              : `Flat ₹${c.discountValue} OFF`;

            let sponsorBadge = '';
            const sType = c.sponsorType || 'tomato';
            if (sType === 'tomato') {
              sponsorBadge = `<span style="display:inline-flex; flex-direction:column; background:#fee2e2; color:#991b1b; font-weight:800; font-size:0.72rem; padding:0.2rem 0.55rem; border-radius:999px; border:1px solid #fca5a5; line-height:1.25;"><span>🍅 Tomato Specific</span><span style="font-weight:600; font-size:0.67rem; opacity:0.9;">100% Tomato Paid</span></span>`;
            } else if (sType === 'common') {
              sponsorBadge = `<span style="display:inline-flex; flex-direction:column; background:#ede9fe; color:#5b21b6; font-weight:800; font-size:0.72rem; padding:0.2rem 0.55rem; border-radius:999px; border:1px solid #c4b5fd; line-height:1.25;"><span>🤝 Common Coupon</span><span style="font-weight:600; font-size:0.67rem; opacity:0.9;">Shared by Agreement %</span></span>`;
            } else if (sType === 'restaurant') {
              sponsorBadge = `<span style="display:inline-flex; flex-direction:column; background:#ffedd5; color:#9a3412; font-weight:800; font-size:0.72rem; padding:0.2rem 0.55rem; border-radius:999px; border:1px solid #fdba74; line-height:1.25;"><span>🍽️ Restaurant Specific</span><span style="font-weight:600; font-size:0.67rem; opacity:0.9;">${escapeHtml(c.partnerName || 'Store')} (100% Store)</span></span>`;
            } else if (sType === 'shop') {
              sponsorBadge = `<span style="display:inline-flex; flex-direction:column; background:#fef3c7; color:#92400e; font-weight:800; font-size:0.72rem; padding:0.2rem 0.55rem; border-radius:999px; border:1px solid #fcd34d; line-height:1.25;"><span>🛍️ Shop Specific</span><span style="font-weight:600; font-size:0.67rem; opacity:0.9;">${escapeHtml(c.partnerName || 'Store')} (100% Store)</span></span>`;
            }

            const targetParts = [];
            if (c.targetItemCategory) targetParts.push(`<span style="color:#1e3a8a; font-weight:700;">Category: ${escapeHtml(c.targetItemCategory)}</span>`);
            if (c.occasionName) targetParts.push(`<span>Occasion: <strong>${escapeHtml(c.occasionName)}</strong></span>`);
            if (c.couponType === 'instant') {
              targetParts.push(`<span style="color:#854d0e; font-weight:800; background:#fef9c3; padding:1px 6px; border-radius:4px; border:1px solid #fde047;">⚡ Assigned: ${escapeHtml(c.targetUserIdentifier || 'User ID')}</span>`);
              targetParts.push('<span style="color:#dc2626; font-size:0.72rem; font-weight:600;">💥 Single-use (Destroys after use)</span>');
            } else if (c.targetUserIdentifier) {
              targetParts.push(`<span style="color:#b45309; font-weight:700;">User: ${escapeHtml(c.targetUserIdentifier)}</span>`);
            }
            if (c.couponType === 'new_user') targetParts.push('<span style="color:#15803d; font-weight:700;">First Order / New Users</span>');
            if (!targetParts.length) targetParts.push('<span style="color:var(--muted);">All Eligible Orders</span>');

            const storeBadge = c.applicableStoreType === 'restaurant'
              ? '🍽️ Restaurant'
              : c.applicableStoreType === 'shop'
              ? '🏬 Shop / Grocery'
              : '🌐 All Stores';

            const expiryStr = c.validUntil ? new Date(c.validUntil).toLocaleDateString() : 'No Expiry';
            const isExpired = c.validUntil && new Date(c.validUntil).getTime() < Date.now();

            return `
              <tr>
                <td>
                  <div style="font-family:monospace; font-weight:800; font-size:0.92rem; color:#c2410c; background:#fff7ed; border:1px dashed #fdba74; display:inline-block; padding:0.15rem 0.5rem; border-radius:5px;">
                    ${escapeHtml(c.code)}
                  </div>
                  <div style="font-weight:700; color:var(--ink); margin-top:0.25rem; font-size:0.84rem;">${escapeHtml(c.title)}</div>
                  ${c.description ? `<div style="font-size:0.74rem; color:var(--muted); max-width:250px;">${escapeHtml(c.description)}</div>` : ''}
                </td>
                <td>
                  ${sponsorBadge}
                </td>
                <td>
                  <span style="display:inline-flex; align-items:center; gap:0.3rem; background:${meta.badgeBg}; color:${meta.badgeColor}; font-weight:700; font-size:0.75rem; padding:0.24rem 0.6rem; border-radius:999px;">
                    <span>${meta.icon}</span>
                    <span>${escapeHtml(meta.label)}</span>
                  </span>
                </td>
                <td>
                  <div style="font-weight:800; color:var(--green); font-size:0.86rem;">${escapeHtml(discountBadge)}</div>
                  <div style="font-size:0.75rem; color:var(--muted);">Min Billing: <strong>₹${Number(c.minOrderAmount || 0)}</strong></div>
                </td>
                <td style="font-size:0.78rem; line-height:1.45;">
                  ${targetParts.join('<br/>')}
                </td>
                <td style="font-size:0.79rem; font-weight:600;">${storeBadge}</td>
                <td style="font-size:0.76rem;">
                  <div>Used: <strong>${Number(c.usedCount || 0)}</strong>${c.totalUsageLimit > 0 ? ` / ${c.totalUsageLimit}` : ' (Unlimited)'}</div>
                  <div style="color:var(--muted);">Per User: ${c.usageLimitPerUser > 0 ? c.usageLimitPerUser : '∞'}</div>
                  <div style="color:${isExpired ? '#dc2626' : 'var(--muted)'};">Valid till: ${expiryStr}</div>
                </td>
                <td>
                  <span class="badge ${c.isActive && !isExpired ? 'badge-approved' : 'badge-blocked'}">
                    ${!c.isActive ? 'Paused' : isExpired ? 'Expired' : 'Active'}
                  </span>
                </td>
                <td>
                  <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                    <button type="button" class="btn btn-outline btn-sm" style="padding:0.22rem 0.55rem; font-size:0.74rem;" onclick="editAdminCoupon('${c._id}')">✏️ Edit</button>
                    <button type="button" class="btn btn-outline btn-sm" style="padding:0.22rem 0.55rem; font-size:0.74rem;" onclick="toggleAdminCouponStatus('${c._id}')">${c.isActive ? '⏸ Pause' : '▶ Enable'}</button>
                    <button type="button" class="btn btn-danger btn-sm" style="padding:0.22rem 0.55rem; font-size:0.74rem;" onclick="deleteAdminCoupon('${c._id}')">🗑️</button>
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

function onAdminCouponDiscountTypeChange() {
  const mode = document.getElementById('adm-coupon-discount-type')?.value || 'percentage';
  const label = document.getElementById('adm-coupon-discount-val-label');
  const maxCapInput = document.getElementById('adm-coupon-max-discount');
  if (label) {
    label.innerHTML = mode === 'percentage'
      ? 'Discount Value (%) <span style="color:var(--tomato);">*</span>'
      : 'Flat Discount Amount (₹) <span style="color:var(--tomato);">*</span>';
  }
  if (maxCapInput && mode === 'flat') {
    maxCapInput.value = '0';
  }
}

function onAdminCouponTypeChange() {
  const cType = document.getElementById('adm-coupon-type')?.value || 'restaurant_item_category';
  const storeSelect = document.getElementById('adm-coupon-store-type');
  const catInput = document.getElementById('adm-coupon-item-category');
  const occasionInput = document.getElementById('adm-coupon-occasion');
  const userInput = document.getElementById('adm-coupon-target-user');
  const perUserInput = document.getElementById('adm-coupon-per-user-limit');

  const catLabel = document.getElementById('adm-coupon-item-cat-label');
  const occLabel = document.getElementById('adm-coupon-occasion-label');
  const userLabel = document.getElementById('adm-coupon-user-label');

  if (catLabel) catLabel.innerHTML = 'Target Item Category (Restaurant / Shop / Grocery)';
  if (occLabel) occLabel.innerHTML = 'Occasion / Festival / Settlement Label';
  if (userLabel) userLabel.innerHTML = 'Specific User (Customer ID, Email, or Phone)';

  const expiryEl = document.getElementById('adm-coupon-valid-until');
  if (expiryEl && cType !== 'instant') {
    expiryEl.removeAttribute('max');
  }

  if (cType === 'instant') {
    if (storeSelect) storeSelect.value = 'all';
    if (userLabel) userLabel.innerHTML = 'Assigned User (User ID / Customer ID / Phone / Email) <span style="color:var(--tomato);">*</span>';
    if (userInput) userInput.placeholder = 'e.g. cust-1001, user@email.com, or 9876543210 (Required)';
    if (perUserInput) perUserInput.value = '1';
    const totalLimitInput = document.getElementById('adm-coupon-total-limit');
    if (totalLimitInput) totalLimitInput.value = '1';

    // Auto-calculate 15 days validity max
    const max15 = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const yyyy = max15.getFullYear();
    const mm = String(max15.getMonth() + 1).padStart(2, '0');
    const dd = String(max15.getDate()).padStart(2, '0');
    if (expiryEl) {
      expiryEl.value = `${yyyy}-${mm}-${dd}`;
      expiryEl.max = `${yyyy}-${mm}-${dd}`;
    }
    const descInput = document.getElementById('adm-coupon-description');
    if (descInput && !descInput.value) {
      descInput.value = 'Single-use instant coupon for assigned user. Auto-destroys upon use. Valid for max 15 days.';
    }
  } else if (cType === 'restaurant_item_category') {
    if (storeSelect) storeSelect.value = 'restaurant';
    if (catLabel) catLabel.innerHTML = 'Target Restaurant Item Category <span style="color:var(--tomato);">*</span>';
    if (catInput && !catInput.value) catInput.placeholder = 'e.g. Sweets, Main Course, Starters, Biryani';
  } else if (cType === 'category_occasion') {
    if (catLabel) catLabel.innerHTML = 'Target Item Category <span style="color:var(--tomato);">*</span>';
    if (occLabel) occLabel.innerHTML = 'Category Occasion Name <span style="color:var(--tomato);">*</span>';
  } else if (cType === 'new_user') {
    if (storeSelect) storeSelect.value = 'all';
    if (perUserInput) perUserInput.value = '1';
    if (occasionInput && !occasionInput.value) occasionInput.value = 'First Order Welcome';
  } else if (cType === 'festival') {
    if (storeSelect) storeSelect.value = 'all';
    if (occLabel) occLabel.innerHTML = 'Festival Name <span style="color:var(--tomato);">*</span>';
  } else if (cType === 'specific_user') {
    if (userLabel) userLabel.innerHTML = 'Specific User (Customer ID / Email / Phone) <span style="color:var(--tomato);">*</span>';
  } else if (cType === 'settlement') {
    if (occLabel) occLabel.innerHTML = 'Settlement Reference / Reason';
    if (occasionInput && !occasionInput.value) occasionInput.value = 'Order Settlement Credit';
  } else if (cType === 'special_occasion') {
    if (occLabel) occLabel.innerHTML = 'Special Occasion (Birthday / Anniversary / Party) <span style="color:var(--tomato);">*</span>';
  } else if (cType === 'shop') {
    if (storeSelect) storeSelect.value = 'shop';
  } else if (cType === 'grocery') {
    if (storeSelect) storeSelect.value = 'shop';
    if (catInput && !catInput.value) catInput.value = 'Groceries';
  }
}

function generateAdminCouponCode() {
  const cType = document.getElementById('adm-coupon-type')?.value || 'restaurant_item_category';
  const prefixes = {
    instant: 'INSTANT',
    restaurant_item_category: 'ITEM',
    category_occasion: 'CATOCC',
    new_user: 'WELCOME',
    festival: 'FEST',
    specific_user: 'VIPUSER',
    settlement: 'SETTLE',
    special_occasion: 'SPECIAL',
    shop: 'SHOP',
    grocery: 'GROCERY',
  };
  const prefix = prefixes[cType] || 'TOMATO';
  const rand = Math.floor(10 + Math.random() * 89);
  const codeInput = document.getElementById('adm-coupon-code');
  if (codeInput) codeInput.value = `${prefix}${rand}`;
}

function openAdminCouponForm(presetType) {
  const card = document.getElementById('admin-coupon-form-card');
  const form = document.getElementById('admin-coupon-form');
  if (!card || !form) return;

  form.reset();
  document.getElementById('adm-coupon-id').value = '';
  document.getElementById('admin-coupon-form-title').textContent = '➕ Create New Coupon';
  document.getElementById('adm-coupon-active').checked = true;

  // Set default expiry 90 days ahead
  const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const yyyy = future.getFullYear();
  const mm = String(future.getMonth() + 1).padStart(2, '0');
  const dd = String(future.getDate()).padStart(2, '0');
  const expiryEl = document.getElementById('adm-coupon-valid-until');
  if (expiryEl) expiryEl.value = `${yyyy}-${mm}-${dd}`;

  if (presetType) {
    const typeSelect = document.getElementById('adm-coupon-type');
    if (typeSelect) typeSelect.value = presetType;
  }
  const sponsorSelect = document.getElementById('adm-coupon-sponsor-type');
  if (sponsorSelect) sponsorSelect.value = 'tomato';
  onAdminCouponTypeChange();
  onAdminCouponDiscountTypeChange();
  generateAdminCouponCode();

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeAdminCouponForm() {
  const card = document.getElementById('admin-coupon-form-card');
  if (card) card.style.display = 'none';
}

function editAdminCoupon(couponId) {
  const c = adminCouponsCache.find((x) => String(x._id) === String(couponId));
  if (!c) return;

  const card = document.getElementById('admin-coupon-form-card');
  if (!card) return;

  document.getElementById('adm-coupon-id').value = c._id;
  document.getElementById('admin-coupon-form-title').textContent = `✏️ Edit Coupon: ${c.code}`;
  const sponsorSelect = document.getElementById('adm-coupon-sponsor-type');
  if (sponsorSelect) sponsorSelect.value = c.sponsorType || 'tomato';
  document.getElementById('adm-coupon-type').value = c.couponType || 'restaurant_item_category';
  document.getElementById('adm-coupon-code').value = c.code || '';
  document.getElementById('adm-coupon-title').value = c.title || '';
  document.getElementById('adm-coupon-discount-type').value = c.discountType || 'percentage';
  document.getElementById('adm-coupon-discount-value').value = c.discountValue ?? 20;
  document.getElementById('adm-coupon-max-discount').value = c.maxDiscountAmount ?? 0;
  document.getElementById('adm-coupon-min-order').value = c.minOrderAmount ?? 0;
  document.getElementById('adm-coupon-item-category').value = c.targetItemCategory || '';
  document.getElementById('adm-coupon-occasion').value = c.occasionName || '';
  document.getElementById('adm-coupon-target-user').value = c.targetUserIdentifier || '';
  document.getElementById('adm-coupon-store-type').value = c.applicableStoreType || 'all';
  document.getElementById('adm-coupon-per-user-limit').value = c.usageLimitPerUser ?? 1;
  document.getElementById('adm-coupon-total-limit').value = c.totalUsageLimit ?? 0;
  document.getElementById('adm-coupon-description').value = c.description || '';
  document.getElementById('adm-coupon-active').checked = Boolean(c.isActive);

  if (c.validUntil) {
    const d = new Date(c.validUntil);
    if (!Number.isNaN(d.getTime())) {
      document.getElementById('adm-coupon-valid-until').value = d.toISOString().split('T')[0];
    }
  } else {
    document.getElementById('adm-coupon-valid-until').value = '';
  }

  onAdminCouponTypeChange();
  onAdminCouponDiscountTypeChange();

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveAdminCoupon(event) {
  event.preventDefault();
  const couponId = document.getElementById('adm-coupon-id')?.value.trim();
  const payload = {
    code: (document.getElementById('adm-coupon-code')?.value || '').trim().toUpperCase(),
    sponsorType: document.getElementById('adm-coupon-sponsor-type')?.value || 'tomato',
    title: (document.getElementById('adm-coupon-title')?.value || '').trim(),
    description: (document.getElementById('adm-coupon-description')?.value || '').trim(),
    couponType: document.getElementById('adm-coupon-type')?.value || 'restaurant_item_category',
    discountType: document.getElementById('adm-coupon-discount-type')?.value || 'percentage',
    discountValue: Number(document.getElementById('adm-coupon-discount-value')?.value || 0),
    maxDiscountAmount: Number(document.getElementById('adm-coupon-max-discount')?.value || 0),
    minOrderAmount: Number(document.getElementById('adm-coupon-min-order')?.value || 0),
    targetItemCategory: (document.getElementById('adm-coupon-item-category')?.value || '').trim(),
    occasionName: (document.getElementById('adm-coupon-occasion')?.value || '').trim(),
    targetUserIdentifier: (document.getElementById('adm-coupon-target-user')?.value || '').trim(),
    applicableStoreType: document.getElementById('adm-coupon-store-type')?.value || 'all',
    usageLimitPerUser: Number(document.getElementById('adm-coupon-per-user-limit')?.value || 0),
    totalUsageLimit: Number(document.getElementById('adm-coupon-total-limit')?.value || 0),
    validUntil: document.getElementById('adm-coupon-valid-until')?.value || null,
    isActive: Boolean(document.getElementById('adm-coupon-active')?.checked),
  };

  if (payload.couponType === 'instant') {
    if (!payload.targetUserIdentifier) {
      alert('Please provide the Assigned User (User ID / Customer ID / Email / Phone) for this Instant Coupon.');
      document.getElementById('adm-coupon-target-user')?.focus();
      return;
    }
    payload.usageLimitPerUser = 1;
    payload.totalUsageLimit = 1;

    const max15 = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000 + 86400000);
    if (!payload.validUntil) {
      const exp = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      payload.validUntil = exp.toISOString().split('T')[0];
    } else if (new Date(payload.validUntil) > max15) {
      alert('Instant coupon validity cannot exceed 15 days. Expiry date has been capped to 15 days.');
      const exp = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      payload.validUntil = exp.toISOString().split('T')[0];
    }
  }

  try {
    const endpoint = couponId ? `/api/admin/coupons/${couponId}` : '/api/admin/coupons';
    const method = couponId ? 'PUT' : 'POST';
    const res = await apiFetch(endpoint, {
      method,
      body: JSON.stringify(payload),
    });
    closeAdminCouponForm();
    await fetchAdminCoupons();
    if (typeof showAutoDismissNotice === 'function') {
      showAutoDismissNotice({
        title: couponId ? 'Coupon Updated' : 'Coupon Created',
        message: res.message || `Coupon ${payload.code} saved successfully.`,
        icon: '🎟️',
      });
    } else {
      alert(res.message || 'Coupon saved!');
    }
  } catch (err) {
    alert(err.message || 'Failed to save coupon.');
  }
}

async function toggleAdminCouponStatus(couponId) {
  const c = adminCouponsCache.find((x) => String(x._id) === String(couponId));
  if (!c) return;
  try {
    await apiFetch(`/api/admin/coupons/${couponId}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    await fetchAdminCoupons();
  } catch (err) {
    alert(err.message || 'Unable to update coupon status.');
  }
}

async function deleteAdminCoupon(couponId) {
  const c = adminCouponsCache.find((x) => String(x._id) === String(couponId));
  if (!c) return;
  if (!window.confirm(`Delete coupon "${c.code}" (${c.title}) permanently?`)) return;
  try {
    await apiFetch(`/api/admin/coupons/${couponId}`, { method: 'DELETE' });
    await fetchAdminCoupons();
  } catch (err) {
    alert(err.message || 'Unable to delete coupon.');
  }
}

// =========================================================================
// PARTNER (RESTAURANT & SHOP) COUPON MANAGEMENT
// =========================================================================
let partnerCouponsCache = [];
let partnerCouponsSummary = {};

async function fetchPartnerCoupons() {
  const container = document.getElementById('partner-coupons-table-container');
  const roleBadge = document.getElementById('partner-coupons-role-badge');
  const endpoint = role === 'shop' ? '/api/shop/coupons' : '/api/restaurant/coupons';

  if (roleBadge) {
    roleBadge.textContent = role === 'shop' ? '🛍️ Shop Specific' : '🍽️ Restaurant Specific';
  }

  try {
    const res = await apiFetch(endpoint);
    partnerCouponsCache = Array.isArray(res.coupons) ? res.coupons : [];
    partnerCouponsSummary = res.summary || {};
    renderPartnerCouponsKPIs();
    renderPartnerCouponsTable();
  } catch (err) {
    console.error('Failed to load partner coupons:', err);
    if (container) {
      container.innerHTML = `<p style="color:var(--tomato); padding:1rem;">Failed to load store coupons: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function renderPartnerCouponsKPIs() {
  const kpiEl = document.getElementById('partner-coupons-kpis');
  if (!kpiEl) return;
  const total = partnerCouponsCache.length;
  const activeCount = partnerCouponsCache.filter((c) => c.isActive).length;
  const redemptions = partnerCouponsCache.reduce((sum, c) => sum + Number(c.usedCount || 0), 0);
  const totalDiscounts = Number(partnerCouponsSummary.totalDiscountGiven || 0);

  kpiEl.innerHTML = `
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Store Coupons</div>
      <div style="font-size:1.5rem; font-weight:800; color:var(--ink); margin-top:0.2rem;">${total}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Custom offers for your store</div>
    </div>
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Active Coupons</div>
      <div style="font-size:1.5rem; font-weight:800; color:var(--green); margin-top:0.2rem;">${activeCount}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Paused / Inactive: ${total - activeCount}</div>
    </div>
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Customer Redemptions</div>
      <div style="font-size:1.5rem; font-weight:800; color:#c2410c; margin-top:0.2rem;">${redemptions}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">Times availed by your customers</div>
    </div>
    <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:700;">Discount Funded (₹)</div>
      <div style="font-size:1.5rem; font-weight:800; color:#4338ca; margin-top:0.2rem;">₹${totalDiscounts.toFixed(2)}</div>
      <div style="font-size:0.74rem; color:var(--muted); margin-top:0.15rem;">100% store funded settlement</div>
    </div>
  `;
}

function renderPartnerCouponsTable() {
  const container = document.getElementById('partner-coupons-table-container');
  if (!container) return;

  const statusFilter = document.getElementById('partner-coupon-status-filter')?.value || 'all';
  const searchVal = (document.getElementById('partner-coupon-search')?.value || '').trim().toLowerCase();

  const filtered = partnerCouponsCache.filter((c) => {
    if (statusFilter === 'active' && !c.isActive) return false;
    if (statusFilter === 'inactive' && c.isActive) return false;
    if (searchVal) {
      const hay = `${c.code || ''} ${c.title || ''} ${c.description || ''} ${c.targetItemCategory || ''} ${c.occasionName || ''}`.toLowerCase();
      if (!hay.includes(searchVal)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:2rem 1rem; background:#fff; border:1px dashed var(--line); border-radius:10px; margin-top:0.5rem;">
        <div style="font-size:2rem; margin-bottom:0.4rem;">🎟️</div>
        <div style="font-weight:700; color:var(--ink); font-size:0.95rem; margin-bottom:0.25rem;">No store coupons found</div>
        <p style="color:var(--muted); margin:0 0 1rem 0; font-size:0.82rem;">Create promotional discount coupons for your store to attract more customer orders.</p>
        <button type="button" class="btn btn-primary btn-sm" onclick="openPartnerCouponForm()">➕ Create Store Coupon</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coupon Code &amp; Title</th>
            <th>Discount Mode &amp; Rules</th>
            <th>Target Category / Tag</th>
            <th>Usage &amp; Expiry</th>
            <th>Funding Sponsor</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((c) => {
            const discountBadge = c.discountType === 'percentage'
              ? `${c.discountValue}% OFF${c.maxDiscountAmount > 0 ? ` (Up to ₹${c.maxDiscountAmount})` : ''}`
              : `Flat ₹${c.discountValue} OFF`;
            const expiryStr = c.validUntil ? new Date(c.validUntil).toLocaleDateString() : 'No Expiry';
            const isExpired = c.validUntil && new Date(c.validUntil).getTime() < Date.now();
            const sponsorLabel = role === 'shop' ? '🛍️ Shop Funded (100%)' : '🍽️ Restaurant Funded (100%)';

            return `
              <tr>
                <td>
                  <div style="font-family:monospace; font-weight:800; font-size:0.92rem; color:#c2410c; background:#fff7ed; border:1px dashed #fdba74; display:inline-block; padding:0.15rem 0.5rem; border-radius:5px;">
                    ${escapeHtml(c.code)}
                  </div>
                  <div style="font-weight:700; color:var(--ink); margin-top:0.25rem; font-size:0.84rem;">${escapeHtml(c.title)}</div>
                  ${c.description ? `<div style="font-size:0.74rem; color:var(--muted); max-width:250px;">${escapeHtml(c.description)}</div>` : ''}
                </td>
                <td>
                  <div style="font-weight:800; color:var(--green); font-size:0.86rem;">${escapeHtml(discountBadge)}</div>
                  <div style="font-size:0.75rem; color:var(--muted);">Min Order: <strong>₹${Number(c.minOrderAmount || 0)}</strong></div>
                </td>
                <td style="font-size:0.78rem;">
                  <div>${c.targetItemCategory ? `<span style="color:#1e3a8a; font-weight:700;">Category: ${escapeHtml(c.targetItemCategory)}</span>` : '<span style="color:var(--muted);">All Items</span>'}</div>
                  ${c.occasionName ? `<div style="color:var(--muted); margin-top:0.1rem;">Tag: ${escapeHtml(c.occasionName)}</div>` : ''}
                </td>
                <td style="font-size:0.76rem;">
                  <div>Redemptions: <strong>${Number(c.usedCount || 0)}</strong>${c.totalUsageLimit > 0 ? ` / ${c.totalUsageLimit}` : ' (Unlimited)'}</div>
                  <div style="color:var(--muted);">Per Customer: ${c.usageLimitPerUser > 0 ? c.usageLimitPerUser : '∞'}</div>
                  <div style="color:${isExpired ? '#dc2626' : 'var(--muted)'};">Valid till: ${expiryStr}</div>
                </td>
                <td>
                  <span style="display:inline-flex; align-items:center; gap:0.25rem; background:#fef3c7; color:#92400e; font-weight:700; font-size:0.73rem; padding:0.18rem 0.55rem; border-radius:999px; border:1px solid #fcd34d;">
                    ${sponsorLabel}
                  </span>
                </td>
                <td>
                  <span class="badge ${c.isActive && !isExpired ? 'badge-approved' : 'badge-blocked'}">
                    ${!c.isActive ? 'Paused' : isExpired ? 'Expired' : 'Active'}
                  </span>
                </td>
                <td>
                  <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                    <button type="button" class="btn btn-outline btn-sm" style="padding:0.22rem 0.55rem; font-size:0.74rem;" onclick="editPartnerCoupon('${c._id || c.id}')">✏️ Edit</button>
                    <button type="button" class="btn btn-outline btn-sm" style="padding:0.22rem 0.55rem; font-size:0.74rem;" onclick="togglePartnerCouponStatus('${c._id || c.id}')">${c.isActive ? '⏸ Pause' : '▶ Enable'}</button>
                    <button type="button" class="btn btn-danger btn-sm" style="padding:0.22rem 0.55rem; font-size:0.74rem;" onclick="deletePartnerCoupon('${c._id || c.id}')">🗑️</button>
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

function onPartnerCouponDiscountTypeChange() {
  const mode = document.getElementById('partner-coupon-discount-type')?.value || 'percentage';
  const label = document.getElementById('partner-coupon-discount-val-label');
  const maxCapInput = document.getElementById('partner-coupon-max-discount');
  if (label) {
    label.innerHTML = mode === 'percentage'
      ? 'Discount Value (%) <span style="color:var(--tomato);">*</span>'
      : 'Flat Discount Amount (₹) <span style="color:var(--tomato);">*</span>';
  }
  if (maxCapInput && mode === 'flat') {
    maxCapInput.value = '0';
  }
}

function generatePartnerCouponCode() {
  const prefix = role === 'shop' ? 'SHOP' : 'REST';
  const rand = Math.floor(1000 + Math.random() * 9000);
  const codeInput = document.getElementById('partner-coupon-code');
  if (codeInput) codeInput.value = `${prefix}${rand}`;
}

function openPartnerCouponForm() {
  const card = document.getElementById('partner-coupon-form-card');
  const form = document.getElementById('partner-coupon-form');
  if (!card || !form) return;

  form.reset();
  const idEl = document.getElementById('partner-coupon-id');
  if (idEl) idEl.value = '';

  const titleHeaderEl = document.getElementById('partner-coupon-form-title');
  if (titleHeaderEl) titleHeaderEl.textContent = '➕ Create Store Coupon';

  const activeEl = document.getElementById('partner-coupon-active');
  if (activeEl) activeEl.checked = true;

  const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const yyyy = future.getFullYear();
  const mm = String(future.getMonth() + 1).padStart(2, '0');
  const dd = String(future.getDate()).padStart(2, '0');
  const expiryEl = document.getElementById('partner-coupon-valid-until');
  if (expiryEl) expiryEl.value = `${yyyy}-${mm}-${dd}`;

  // Prepopulate standard defaults
  const titleEl = document.getElementById('partner-coupon-title');
  if (titleEl) {
    titleEl.value = role === 'shop' ? 'Special Store Discount' : 'Special Dining Discount';
  }
  const discountValEl = document.getElementById('partner-coupon-discount-value');
  if (discountValEl) {
    discountValEl.value = '15';
  }
  const maxDiscountEl = document.getElementById('partner-coupon-max-discount');
  if (maxDiscountEl) {
    maxDiscountEl.value = '100';
  }
  const minOrderEl = document.getElementById('partner-coupon-min-order');
  if (minOrderEl) {
    minOrderEl.value = '199';
  }
  const perUserEl = document.getElementById('partner-coupon-per-user-limit');
  if (perUserEl) {
    perUserEl.value = '2';
  }
  const totalLimitEl = document.getElementById('partner-coupon-total-limit');
  if (totalLimitEl) {
    totalLimitEl.value = '200';
  }

  onPartnerCouponDiscountTypeChange();
  generatePartnerCouponCode();

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const codeInput = document.getElementById('partner-coupon-code');
  if (codeInput) {
    setTimeout(() => codeInput.focus(), 150);
  }
}

function closePartnerCouponForm() {
  const card = document.getElementById('partner-coupon-form-card');
  if (card) card.style.display = 'none';
}

function editPartnerCoupon(couponId) {
  const c = partnerCouponsCache.find((x) => String(x._id || x.id) === String(couponId));
  if (!c) return;

  const card = document.getElementById('partner-coupon-form-card');
  if (!card) return;

  document.getElementById('partner-coupon-id').value = c._id;
  document.getElementById('partner-coupon-form-title').textContent = `✏️ Edit Store Coupon: ${c.code}`;
  document.getElementById('partner-coupon-code').value = c.code || '';
  document.getElementById('partner-coupon-title').value = c.title || '';
  document.getElementById('partner-coupon-discount-type').value = c.discountType || 'percentage';
  document.getElementById('partner-coupon-discount-value').value = c.discountValue ?? 15;
  document.getElementById('partner-coupon-max-discount').value = c.maxDiscountAmount ?? 0;
  document.getElementById('partner-coupon-min-order').value = c.minOrderAmount ?? 0;
  document.getElementById('partner-coupon-item-category').value = c.targetItemCategory || '';
  document.getElementById('partner-coupon-occasion').value = c.occasionName || '';
  document.getElementById('partner-coupon-per-user-limit').value = c.usageLimitPerUser ?? 2;
  document.getElementById('partner-coupon-total-limit').value = c.totalUsageLimit ?? 200;
  document.getElementById('partner-coupon-description').value = c.description || '';
  document.getElementById('partner-coupon-active').checked = Boolean(c.isActive);

  if (c.validUntil) {
    const d = new Date(c.validUntil);
    if (!Number.isNaN(d.getTime())) {
      document.getElementById('partner-coupon-valid-until').value = d.toISOString().split('T')[0];
    }
  } else {
    document.getElementById('partner-coupon-valid-until').value = '';
  }

  onPartnerCouponDiscountTypeChange();
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function savePartnerCoupon(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  const saveBtn = document.getElementById('partner-coupon-save-btn');
  const originalBtnText = saveBtn ? saveBtn.textContent : '💾 Save Coupon';

  const couponId = (document.getElementById('partner-coupon-id')?.value || '').trim();
  const endpointBase = role === 'shop' ? '/api/shop/coupons' : '/api/restaurant/coupons';

  const code = (document.getElementById('partner-coupon-code')?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  const title = (document.getElementById('partner-coupon-title')?.value || '').trim();
  const description = (document.getElementById('partner-coupon-description')?.value || '').trim();
  const discountType = document.getElementById('partner-coupon-discount-type')?.value || 'percentage';
  const discountValue = Number(document.getElementById('partner-coupon-discount-value')?.value || 0);
  const maxDiscountAmount = Math.max(0, Number(document.getElementById('partner-coupon-max-discount')?.value || 0));
  const minOrderAmount = Math.max(0, Number(document.getElementById('partner-coupon-min-order')?.value || 0));
  const targetItemCategory = (document.getElementById('partner-coupon-item-category')?.value || '').trim();
  const occasionName = (document.getElementById('partner-coupon-occasion')?.value || '').trim();
  const usageLimitPerUser = Math.max(1, Number(document.getElementById('partner-coupon-per-user-limit')?.value || 1));
  const totalUsageLimit = Math.max(0, Number(document.getElementById('partner-coupon-total-limit')?.value || 0));
  const validUntil = document.getElementById('partner-coupon-valid-until')?.value || null;
  const isActive = Boolean(document.getElementById('partner-coupon-active')?.checked);

  if (!code || code.length < 3) {
    alert('Please enter a valid coupon code (at least 3 characters).');
    document.getElementById('partner-coupon-code')?.focus();
    return;
  }
  if (!title) {
    alert('Please enter a coupon title/headline.');
    document.getElementById('partner-coupon-title')?.focus();
    return;
  }
  if (!discountValue || discountValue <= 0) {
    alert('Please enter a discount value greater than 0.');
    document.getElementById('partner-coupon-discount-value')?.focus();
    return;
  }
  if (discountType === 'percentage' && discountValue > 100) {
    alert('Percentage discount cannot exceed 100%.');
    document.getElementById('partner-coupon-discount-value')?.focus();
    return;
  }

  const payload = {
    code,
    title,
    description,
    discountType,
    discountValue,
    maxDiscountAmount,
    minOrderAmount,
    targetItemCategory,
    occasionName,
    usageLimitPerUser,
    totalUsageLimit,
    validUntil,
    isActive,
  };

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Saving Coupon...';
    }

    const endpoint = couponId ? `${endpointBase}/${couponId}` : endpointBase;
    const method = couponId ? 'PUT' : 'POST';
    const res = await apiFetch(endpoint, {
      method,
      body: JSON.stringify(payload),
    });
    closePartnerCouponForm();
    await fetchPartnerCoupons();
    const tableContainer = document.getElementById('partner-coupons-table-container');
    if (tableContainer) {
      tableContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (typeof showAutoDismissNotice === 'function') {
      showAutoDismissNotice({
        title: couponId ? 'Store Coupon Updated' : 'Store Coupon Created',
        message: res.message || `Coupon ${payload.code} saved successfully!`,
        icon: '🎟️',
        duration: 3500,
      });
    } else {
      alert(res.message || 'Coupon saved successfully!');
    }
  } catch (err) {
    console.error('Failed to save partner coupon:', err);
    alert(err.message || 'Failed to save store coupon. Please try again.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalBtnText;
    }
  }
}

async function togglePartnerCouponStatus(couponId) {
  const endpointBase = role === 'shop' ? '/api/shop/coupons' : '/api/restaurant/coupons';
  try {
    const res = await apiFetch(`${endpointBase}/${couponId}/toggle`, { method: 'PATCH' });
    await fetchPartnerCoupons();
    if (typeof showAutoDismissNotice === 'function') {
      showAutoDismissNotice({
        title: 'Coupon Status Updated',
        message: res.message || 'Status updated',
        icon: '🎟️',
      });
    }
  } catch (err) {
    alert(err.message || 'Unable to toggle coupon status.');
  }
}

async function deletePartnerCoupon(couponId) {
  const c = partnerCouponsCache.find((x) => String(x._id || x.id) === String(couponId));
  if (!c) return;
  if (!window.confirm(`Delete store coupon "${c.code}" permanently?`)) return;
  const endpointBase = role === 'shop' ? '/api/shop/coupons' : '/api/restaurant/coupons';
  try {
    await apiFetch(`${endpointBase}/${couponId}`, { method: 'DELETE' });
    await fetchPartnerCoupons();
  } catch (err) {
    alert(err.message || 'Unable to delete store coupon.');
  }
}

// =========================================================================
// CUSTOMER BILLING: APPLY UP TO 2 COUPONS AT A TIME
// =========================================================================
async function fetchCustomerAvailableCoupons() {
  try {
    const isShopOrder = cart[0]?.storeType === 'shop' || customerBrowseMode === 'shop';
    const storeType = isShopOrder ? 'shop' : 'restaurant';
    const storeId = cart[0]?.restaurantId || cart[0]?.shopId || currentStoreId || '';
    let url = `/api/customer/coupons?storeType=${encodeURIComponent(storeType)}`;
    if (storeId) {
      url += `&storeId=${encodeURIComponent(storeId)}`;
    }
    const res = await apiFetch(url);
    customerAvailableCoupons = Array.isArray(res.coupons) ? res.coupons : [];
    customerIsNewUserFlag = Boolean(res.isNewUser);
    renderCheckoutCouponsSection();
  } catch (err) {
    console.warn('Could not load available coupons:', err);
  }
}

function setCheckoutCouponFeedback(message, isError = false) {
  const feedbackIds = [
    'checkout-coupon-message',
    'overview-cart-coupon-feedback',
    'order-cart-coupon-feedback',
  ];
  feedbackIds.forEach((id) => {
    const msgEl = document.getElementById(id);
    if (!msgEl) return;
    if (!message) {
      msgEl.style.display = 'none';
      msgEl.textContent = '';
      return;
    }
    msgEl.style.display = 'block';
    msgEl.style.color = isError ? '#dc2626' : '#15803d';
    msgEl.style.fontWeight = '600';
    msgEl.textContent = message;
  });
}

async function applyCartInlineCouponCode(inputId) {
  const input = document.getElementById(inputId);
  const raw = (input?.value || '').trim().toUpperCase();
  if (!raw) {
    setCheckoutCouponFeedback('Please enter a coupon code to apply to the bill.', true);
    return;
  }
  await toggleCheckoutCouponCode(raw, true);
  if (input) input.value = '';
}

async function validateAndSyncCartCoupons({ silent = false } = {}) {
  if (!cart.length || !appliedCouponCodes.length) {
    appliedCouponsBreakdown = [];
    appliedTotalDiscount = 0;
    saveCartCouponsToStorage();
    updateCartUI();
    updateGatewayBillingSummaryUI();
    renderCheckoutCouponsSection();
    return { valid: true, totalDiscount: 0 };
  }

  if (appliedCouponCodes.length > MAX_COUPONS_PER_ORDER_LIMIT) {
    appliedCouponCodes = appliedCouponCodes.slice(0, MAX_COUPONS_PER_ORDER_LIMIT);
  }

  const isShopOrder = cart[0]?.storeType === 'shop' || customerBrowseMode === 'shop';
  const storeId = cart[0]?.restaurantId || cart[0]?.shopId || currentStoreId || '';
  const payload = {
    couponCodes: appliedCouponCodes,
    storeType: isShopOrder ? 'shop' : 'restaurant',
    storeId,
    restaurantId: cart[0]?.restaurantId,
    shopId: cart[0]?.restaurantId,
    items: cart.map((i) => ({
      foodItemId: i.itemId,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      category: i.category || '',
    })),
  };

  try {
    const res = await apiFetch('/api/customer/coupons/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    appliedCouponsBreakdown = Array.isArray(res.appliedCoupons) ? res.appliedCoupons : [];
    appliedCouponCodes = appliedCouponsBreakdown.map((c) => c.code);
    appliedTotalDiscount = Number(res.totalDiscount || 0);
    saveCartCouponsToStorage();
    if (!silent) {
      setCheckoutCouponFeedback(res.message || `Applied ${appliedCouponCodes.length} coupon(s)! Bill reduced by ₹${appliedTotalDiscount.toFixed(2)}`, false);
    }
    updateCartUI();
    updateGatewayBillingSummaryUI();
    renderCheckoutCouponsSection();
    return { valid: true, totalDiscount: appliedTotalDiscount };
  } catch (err) {
    if (!silent) {
      setCheckoutCouponFeedback(err.message || 'Coupon is not valid for current cart.', true);
    }
    return { valid: false, message: err.message };
  }
}

async function applyManualCouponCode() {
  const input = document.getElementById('checkout-coupon-input');
  const raw = (input?.value || '').trim().toUpperCase();
  if (!raw) {
    setCheckoutCouponFeedback('Please enter a coupon code to apply.', true);
    return;
  }
  await toggleCheckoutCouponCode(raw, true);
  if (input) input.value = '';
}

async function toggleCheckoutCouponCode(code, forceAdd = false) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return;

  const existingIdx = appliedCouponCodes.indexOf(cleanCode);
  if (existingIdx !== -1 && !forceAdd) {
    appliedCouponCodes.splice(existingIdx, 1);
    setCheckoutCouponFeedback(`Removed coupon ${cleanCode}.`, false);
    await validateAndSyncCartCoupons({ silent: true });
    return;
  }

  if (existingIdx !== -1 && forceAdd) {
    setCheckoutCouponFeedback(`Coupon "${cleanCode}" is already applied.`, true);
    return;
  }

  if (appliedCouponCodes.length >= MAX_COUPONS_PER_ORDER_LIMIT) {
    setCheckoutCouponFeedback('Only 1 coupon code can be used per order. Remove the applied coupon to use another.', true);
    return;
  }

  const prevCodes = [...appliedCouponCodes];
  appliedCouponCodes.push(cleanCode);
  const check = await validateAndSyncCartCoupons({ silent: false });
  if (!check.valid) {
    appliedCouponCodes = prevCodes;
    await validateAndSyncCartCoupons({ silent: true });
    setCheckoutCouponFeedback(check.message || `Cannot apply coupon ${cleanCode}.`, true);
  }
}

async function removeCheckoutCouponCode(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  appliedCouponCodes = appliedCouponCodes.filter((c) => c !== cleanCode);
  setCheckoutCouponFeedback(`Removed coupon ${cleanCode}.`, false);
  await validateAndSyncCartCoupons({ silent: true });
}

function updateGatewayBillingSummaryUI() {
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Number((subtotal * 0.05).toFixed(2));
  const deliveryFee = cart.length ? 40 : 0;
  const grossTotal = Number((subtotal + tax + deliveryFee).toFixed(2));
  const discountAmt = getActiveCartDiscountAmount(subtotal);
  const finalPayable = Number(Math.max(0, grossTotal - discountAmt).toFixed(2));

  const gwAmount = document.getElementById('gateway-amount');
  if (gwAmount) gwAmount.textContent = `₹${finalPayable.toFixed(2)}`;

  const savingsBadge = document.getElementById('gateway-savings-badge');
  if (savingsBadge) {
    savingsBadge.textContent = discountAmt > 0
      ? `🎉 Bill Reduced by ₹${discountAmt.toFixed(2)} with coupon ${appliedCouponCodes[0] || ''}!`
      : 'No extra gateway fees';
  }

  const breakdownEl = document.getElementById('gateway-bill-breakdown');
  if (breakdownEl) {
    const storeId = String(cart[0]?.restaurantId || '');
    const matchedRest = (allRestaurants || []).find((r) => String(r._id || r.id) === storeId);
    const matchedShop = (allShops || []).find((s) => String(s._id || s.id) === storeId);
    const storeGsn = matchedRest?.gsnNumber || matchedShop?.gsnNumber;
    const activeGsn = storeGsn && String(storeGsn).trim()
      ? String(storeGsn).trim()
      : (window.cachedPlatformGsnNumber || 'NA');

    const individualCouponLines = Array.isArray(appliedCouponsBreakdown) && appliedCouponsBreakdown.length
      ? appliedCouponsBreakdown.map((c) => `
          <div style="display:flex; justify-content:space-between; color:#15803d; font-size:0.78rem; font-weight:600;">
            <span>🎟️ Coupon (${escapeHtml(c.code)}):</span>
            <span>-₹${Number(c.discountAmount || 0).toFixed(2)}</span>
          </div>
        `).join('')
      : '';

    breakdownEl.innerHTML = `
      ${activeGsn ? `
      <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#1e3a8a; padding-bottom:0.2rem; border-bottom:1px dashed var(--line); margin-bottom:0.2rem;">
        <span>🧾 Billing GSN Number:</span>
        <strong style="font-family:monospace;">${escapeHtml(activeGsn)}</strong>
      </div>` : ''}
      <div style="display:flex; justify-content:space-between;">
        <span>Item Subtotal:</span>
        <strong>₹${subtotal.toFixed(2)}</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>GST &amp; Restaurant Taxes (5%):</span>
        <span>₹${tax.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Packing &amp; Delivery Fee:</span>
        <span>₹${deliveryFee.toFixed(2)}</span>
      </div>
      ${discountAmt > 0 ? `
      <div style="display:flex; justify-content:space-between; color:var(--muted); font-size:0.77rem; border-top:1px dashed var(--line); padding-top:0.2rem;">
        <span>Gross Bill Total:</span>
        <span style="text-decoration:line-through;">₹${grossTotal.toFixed(2)}</span>
      </div>
      ${individualCouponLines}
      <div style="display:flex; justify-content:space-between; color:var(--green); font-weight:800;">
        <span>Total Coupon Bill Reduction (${appliedCouponCodes.map((c) => escapeHtml(c)).join(' + ')}):</span>
        <span>-₹${discountAmt.toFixed(2)}</span>
      </div>` : ''}
      <div style="display:flex; justify-content:space-between; font-weight:800; color:var(--ink); border-top:1px solid var(--line); padding-top:0.25rem; margin-top:0.15rem;">
        <span>Net Payable Bill:</span>
        <span style="color:var(--tomato);">₹${finalPayable.toFixed(2)}</span>
      </div>
    `;
  }
}

function renderCheckoutCouponsSection() {
  const badgeText = `${appliedCouponCodes.length} / ${MAX_COUPONS_PER_ORDER_LIMIT} Applied`;
  [
    'checkout-coupon-count-badge',
    'overview-cart-coupon-count-badge',
    'order-cart-coupon-count-badge',
  ].forEach((badgeId) => {
    const el = document.getElementById(badgeId);
    if (el) el.textContent = badgeText;
  });

  const chipsHtml = appliedCouponsBreakdown.map((c) => `
    <div style="display:inline-flex; align-items:center; gap:0.4rem; background:#dcfce7; border:1px solid #86efac; color:#166534; padding:0.22rem 0.55rem; border-radius:999px; font-size:0.74rem; font-weight:700;">
      <span>✓ ${escapeHtml(c.code)} (-₹${Number(c.discountAmount || 0).toFixed(2)})</span>
      <button type="button" onclick="removeCheckoutCouponCode('${escapeHtml(c.code)}')" style="border:none; background:transparent; color:#166534; font-weight:900; cursor:pointer; padding:0 0.15rem; font-size:0.8rem;" title="Remove coupon">✕</button>
    </div>
  `).join('');

  const appliedListEl = document.getElementById('checkout-applied-coupons-list');
  if (appliedListEl) {
    if (!appliedCouponsBreakdown.length) {
      appliedListEl.innerHTML = '<span style="font-size:0.75rem; color:var(--muted);">No coupon applied yet. Select 1 coupon below or enter a code above.</span>';
    } else {
      appliedListEl.innerHTML = chipsHtml;
    }
  }

  ['overview-cart-applied-coupons-list', 'order-cart-applied-coupons-list'].forEach((listId) => {
    const el = document.getElementById(listId);
    if (el) {
      el.innerHTML = appliedCouponsBreakdown.length ? chipsHtml : '';
    }
  });

  const availListEl = document.getElementById('checkout-available-coupons-list');
  if (!availListEl) return;

  if (!customerAvailableCoupons.length) {
    availListEl.innerHTML = '<span style="font-size:0.77rem; color:var(--muted);">No active coupons available right now.</span>';
    return;
  }

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cartCategories = new Set(cart.map((i) => String(i.category || '').trim().toLowerCase()).filter(Boolean));

  availListEl.innerHTML = customerAvailableCoupons.map((c) => {
    const isApplied = appliedCouponCodes.includes(c.code);
    const meta = COUPON_TYPE_META[c.couponType] || { icon: '🎟️', label: c.couponType, badgeBg: '#f3f4f6', badgeColor: '#374151' };
    const offerText = c.discountType === 'percentage'
      ? `${c.discountValue}% OFF${c.maxDiscountAmount > 0 ? ` up to ₹${c.maxDiscountAmount}` : ''}`
      : `FLAT ₹${c.discountValue} OFF`;

    const hints = [];
    if (c.minOrderAmount > 0) hints.push(`Min ₹${c.minOrderAmount}`);
    if (c.targetItemCategory) hints.push(`Category: ${c.targetItemCategory}`);
    if (c.occasionName) hints.push(c.occasionName);
    if (c.couponType === 'new_user') hints.push(customerIsNewUserFlag ? 'Eligible New User' : 'New Users Only');

    const catMismatch = c.targetItemCategory && !Array.from(cartCategories).some((cat) => cat.includes(String(c.targetItemCategory).toLowerCase()) || String(c.targetItemCategory).toLowerCase().includes(cat));
    const belowMin = c.minOrderAmount > 0 && subtotal < c.minOrderAmount;
    const maxReached = !isApplied && appliedCouponCodes.length >= MAX_COUPONS_PER_ORDER_LIMIT;

    let sponsorTag = '';
    const sType = c.sponsorType || 'tomato';
    if (sType === 'tomato') {
      sponsorTag = '<span style="font-size:0.68rem; background:#fee2e2; color:#991b1b; padding:0.08rem 0.4rem; border-radius:999px; font-weight:700;">🍅 Tomato Sponsored</span>';
    } else if (sType === 'restaurant') {
      sponsorTag = '<span style="font-size:0.68rem; background:#ffedd5; color:#9a3412; padding:0.08rem 0.4rem; border-radius:999px; font-weight:700;">🍽️ Restaurant Deal</span>';
    } else if (sType === 'shop') {
      sponsorTag = '<span style="font-size:0.68rem; background:#fef3c7; color:#92400e; padding:0.08rem 0.4rem; border-radius:999px; font-weight:700;">🛍️ Shop Deal</span>';
    } else if (sType === 'common') {
      sponsorTag = '<span style="font-size:0.68rem; background:#ede9fe; color:#5b21b6; padding:0.08rem 0.4rem; border-radius:999px; font-weight:700;">🤝 Common Platform Deal</span>';
    }

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; background:${isApplied ? '#f0fdf4' : '#fff'}; border:1px solid ${isApplied ? '#86efac' : '#e5e0d5'}; border-radius:6px; padding:0.45rem 0.6rem;">
        <div style="min-width:0; flex:1;">
          <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
            <span style="font-family:monospace; font-weight:800; font-size:0.79rem; color:#c2410c; background:#fff7ed; border:1px dashed #fdba74; padding:0.08rem 0.4rem; border-radius:4px;">${escapeHtml(c.code)}</span>
            <span style="font-weight:700; font-size:0.77rem; color:var(--green);">${escapeHtml(offerText)}</span>
            <span style="font-size:0.68rem; background:${meta.badgeBg}; color:${meta.badgeColor}; padding:0.08rem 0.4rem; border-radius:999px; font-weight:700;">${meta.icon} ${escapeHtml(meta.label)}</span>
            ${sponsorTag}
          </div>
          <div style="font-size:0.75rem; color:var(--ink); font-weight:600; margin-top:0.15rem;">${escapeHtml(c.title)}</div>
          <div style="font-size:0.7rem; color:${(catMismatch || belowMin) ? '#b45309' : 'var(--muted)'};">
            ${escapeHtml(hints.join(' • '))}
            ${belowMin ? ` • Add ₹${(c.minOrderAmount - subtotal).toFixed(0)} more` : ''}
          </div>
        </div>
        <button
          type="button"
          class="btn ${isApplied ? 'btn-secondary' : 'btn-outline'} btn-sm"
          style="font-size:0.74rem; padding:0.25rem 0.6rem; white-space:nowrap;"
          ${maxReached ? 'disabled title="Only 1 coupon can be used per order"' : ''}
          onclick="toggleCheckoutCouponCode('${escapeHtml(c.code)}')"
        >
          ${isApplied ? '✓ Applied' : maxReached ? '1 Coupon Applied' : 'Apply'}
        </button>
      </div>
    `;
  }).join('');
}

window.fetchAdminCoupons = fetchAdminCoupons;
window.renderAdminCouponsTable = renderAdminCouponsTable;
window.openAdminCouponForm = openAdminCouponForm;
window.closeAdminCouponForm = closeAdminCouponForm;
window.onAdminCouponTypeChange = onAdminCouponTypeChange;
window.onAdminCouponDiscountTypeChange = onAdminCouponDiscountTypeChange;
window.generateAdminCouponCode = generateAdminCouponCode;
window.editAdminCoupon = editAdminCoupon;
window.saveAdminCoupon = saveAdminCoupon;
window.toggleAdminCouponStatus = toggleAdminCouponStatus;
window.deleteAdminCoupon = deleteAdminCoupon;
window.fetchCustomerAvailableCoupons = fetchCustomerAvailableCoupons;
window.validateAndSyncCartCoupons = validateAndSyncCartCoupons;
window.applyManualCouponCode = applyManualCouponCode;
window.toggleCheckoutCouponCode = toggleCheckoutCouponCode;
window.removeCheckoutCouponCode = removeCheckoutCouponCode;

window.fetchPartnerCoupons = fetchPartnerCoupons;
window.renderPartnerCouponsTable = renderPartnerCouponsTable;
window.openPartnerCouponForm = openPartnerCouponForm;
window.closePartnerCouponForm = closePartnerCouponForm;
window.onPartnerCouponDiscountTypeChange = onPartnerCouponDiscountTypeChange;
window.generatePartnerCouponCode = generatePartnerCouponCode;
window.editPartnerCoupon = editPartnerCoupon;
window.savePartnerCoupon = savePartnerCoupon;
window.togglePartnerCouponStatus = togglePartnerCouponStatus;
window.deletePartnerCoupon = deletePartnerCoupon;

// Coupon KPI & Discount calculation helpers
window.renderAdminCouponsKPIs = renderAdminCouponsKPIs;
window.renderPartnerCouponsKPIs = renderPartnerCouponsKPIs;
window.populateAdminCouponDatalists = populateAdminCouponDatalists;
window.renderCheckoutCouponsSection = renderCheckoutCouponsSection;
window.updateGatewayBillingSummaryUI = updateGatewayBillingSummaryUI;
window.getActiveCartDiscountAmount = getActiveCartDiscountAmount;
window.resetAppliedCouponsState = resetAppliedCouponsState;

