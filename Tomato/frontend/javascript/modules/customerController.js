// =========================================================================
// CUSTOMER CONTROLLER MODULE (MENU, CART, CHECKOUT, ORDERS, REVIEWS, SEARCH)
// =========================================================================
// =========================================================================
// CUSTOMER: RESTAURANTS, MENU, CART, PAYMENT GATEWAY & ORDERS
// =========================================================================
function sortRestaurantsByDistance(restaurants) {
  return [...restaurants].sort((a, b) => {
    const distanceA = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY;
    const distanceB = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY;
    return distanceA - distanceB;
  });
}

function isStoreBeyondCustomerRange(store) {
  return typeof store?.distanceKm === 'number' && store.distanceKm > 15.0;
}

async function loadCustomerMenuSection() {
  try {
    if (!customerAddresses || !customerAddresses.length) {
      try {
        const addrData = await apiFetch('/api/customer/addresses');
        customerAddresses = addrData.addresses || [];
      } catch (_) {}
    }

    const defaultAddr = (Array.isArray(customerAddresses) && customerAddresses.length)
      ? (customerAddresses.find((a) => a.isDefault) || customerAddresses[0])
      : null;
    const customerPin = defaultAddr ? resolveFrontendAddressPincode(defaultAddr) : (user?.pincode || '');

    let custLat = null;
    let custLng = null;
    if (defaultAddr?.location?.coordinates && Array.isArray(defaultAddr.location.coordinates) && defaultAddr.location.coordinates.length >= 2) {
      const cLng = Number(defaultAddr.location.coordinates[0]);
      const cLat = Number(defaultAddr.location.coordinates[1]);
      if (!isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0)) {
        custLat = cLat;
        custLng = cLng;
      }
    }
    if ((custLat === null || custLng === null) && window.currentUserLat && window.currentUserLng) {
      custLat = window.currentUserLat;
      custLng = window.currentUserLng;
    }

    const qParams = new URLSearchParams();
    if (customerPin) qParams.set('pincode', customerPin);
    if (defaultAddr?.digipin) qParams.set('digipin', defaultAddr.digipin);
    if (custLat !== null && custLng !== null) {
      qParams.set('lat', custLat);
      qParams.set('lng', custLng);
    }
    const pinQuery = qParams.toString() ? `?${qParams.toString()}` : '';

    const restMenuParams = new URLSearchParams(qParams);
    restMenuParams.set('type', 'restaurant');
    const menuRestQuery = `?${restMenuParams.toString()}`;

    const shopMenuParams = new URLSearchParams(qParams);
    shopMenuParams.set('type', 'shop');
    const menuShopQuery = `?${shopMenuParams.toString()}`;

    const [restData, menuData, shopsData, shopItemsData, addrData] = await Promise.all([
      apiFetch(`/api/customer/restaurants${pinQuery}`),
      apiFetch(`/api/customer/menu${menuRestQuery}`),
      apiFetch(`/api/customer/shops${pinQuery}`).catch(() => ({ shops: [] })),
      apiFetch(`/api/customer/menu${menuShopQuery}`).catch(() => ({ menu: [] })),
      apiFetch('/api/customer/addresses').catch(() => ({ addresses: customerAddresses || [] })),
    ]);

    allRestaurants = sortRestaurantsByDistance(restData.restaurants || []);
    allMenuItems = menuData.menu || [];
    allShops = sortRestaurantsByDistance(shopsData.shops || []);
    allShopItems = shopItemsData.menu || [];
    customerAddresses = addrData.addresses || customerAddresses || [];
    window.cachedPlatformGsnNumber = restData.platformGsnNumber || shopsData.platformGsnNumber || '';
    window.customerActiveZonePincode = restData.matchedAdminPincode || customerPin;

    updateBrowseModeUI();
    renderRestaurantPills();
    renderMenuItems();
    updateCartUI();
  } catch (e) {
    console.error('Menu load error:', e);
  }
}

function updateBrowseModeUI() {
  const isShop = customerBrowseMode === 'shop';

  // Segmented pill buttons (Browse header and Sidebar below wallet)
  const restToggle = document.getElementById('toggle-store-restaurant');
  const shopToggle = document.getElementById('toggle-store-shop');
  const sidebarRestToggle = document.getElementById('sidebar-toggle-store-restaurant');
  const sidebarShopToggle = document.getElementById('sidebar-toggle-store-shop');

  if (restToggle) restToggle.classList.toggle('active', !isShop);
  if (shopToggle) shopToggle.classList.toggle('active', isShop);
  if (sidebarRestToggle) sidebarRestToggle.classList.toggle('active', !isShop);
  if (sidebarShopToggle) sidebarShopToggle.classList.toggle('active', isShop);

  const titleEl = document.getElementById('customer-browse-title');
  const subtitleEl = document.getElementById('customer-browse-subtitle');
  const searchInput = document.getElementById('dish-search');

  if (titleEl) {
    if (isCustomerCartViewActive) {
      const totalQty = cart.reduce((sum, i) => sum + i.quantity, 0);
      titleEl.textContent = `Item in your Cart : ${totalQty}`;
    } else {
      titleEl.textContent = isShop ? 'Explore Shops & Products' : 'Explore Restaurants & Menus';
    }
  }
  if (subtitleEl) {
    if (isCustomerCartViewActive) {
      subtitleEl.textContent = 'Review your selected items and proceed to checkout';
    } else {
      subtitleEl.textContent = isShop
        ? 'Fresh groceries, daily essentials & retail items from local shops'
        : 'Fresh dishes prepared and delivered to your doorstep';
    }
  }
  if (searchInput) {
    searchInput.placeholder = isShop
      ? 'Search products (e.g. Milk, Bread, Rice)...'
      : 'Search dishes (e.g. Paneer, Pasta)...';
  }
}

function toggleCustomerBrowseMode() {
  const nextMode = customerBrowseMode === 'shop' ? 'restaurant' : 'shop';
  setCustomerBrowseMode(nextMode);
}
window.toggleCustomerBrowseMode = toggleCustomerBrowseMode;

function setCustomerBrowseMode(mode) {
  customerBrowseMode = mode === 'shop' ? 'shop' : 'restaurant';
  updateBrowseModeUI();

  // If currently on another customer tab, switch to Order Online
  if (role === 'customer' && typeof activeView !== 'undefined' && activeView !== 'customer-order') {
    switchView('customer-order');
  }

  // Reset filter states for new mode
  if (customerBrowseMode === 'shop') {
    mainCustomerTab = 'all_shops';
    currentSelectedShopId = 'all';
  } else {
    mainCustomerTab = 'all_restaurants';
    currentSelectedRestaurantId = 'all';
  }
  selectedCategory = 'all';
  selectedMenuItemId = 'all';

  const searchInput = document.getElementById('dish-search');
  if (searchInput) searchInput.value = '';

  renderRestaurantPills();
  renderMenuItems();
}
window.setCustomerBrowseMode = setCustomerBrowseMode;

// Helper: case-insensitively deduplicated & nicely formatted distinct categories
function getDistinctCategories() {
  const categoryMap = new Map();
  allMenuItems.forEach((m) => {
    const raw = (m.category || 'Main Course').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!categoryMap.has(key)) {
      const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
      categoryMap.set(key, formatted);
    }
  });
  return Array.from(categoryMap.values());
}

// Helper: distinct categories for shops
function getDistinctShopCategories() {
  const categoryMap = new Map();
  allShopItems.forEach((m) => {
    const raw = (m.category || 'Retail Goods').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!categoryMap.has(key)) {
      const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
      categoryMap.set(key, formatted);
    }
  });
  return Array.from(categoryMap.values());
}

// Customer visited items storage and retrieval helpers (v2: strictly sorted by last visit, MRU first)
function getCustomerVisitedStorageKey(type) {
  const uid = (user && (user._id || user.id)) || 'guest';
  return `tomato_visited_v2_${type}_${uid}`;
}

function getVisitedItems(type) {
  try {
    const raw = localStorage.getItem(getCustomerVisitedStorageKey(type));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveVisitedItems(type, items) {
  try {
    const key = getCustomerVisitedStorageKey(type);
    localStorage.setItem(key, JSON.stringify(items.slice(0, 20)));
  } catch (e) {
    console.warn('Could not save visited items to localStorage', e);
  }
}

function getStablePillItems(type, availableItems, getIdFn) {
  const stored = getVisitedItems(type);
  const valid = [];
  for (const id of stored) {
    const found = availableItems.find((item) => String(getIdFn(item)).toLowerCase() === String(id).toLowerCase());
    if (found && !valid.some((v) => String(getIdFn(v)).toLowerCase() === String(getIdFn(found)).toLowerCase())) {
      valid.push(found);
    }
  }

  // Fill up to 5 with remaining available items for display ONLY (do NOT save unvisited items into localStorage)
  if (valid.length < 5) {
    for (const item of availableItems) {
      if (valid.length >= 5) break;
      const itemId = String(getIdFn(item)).toLowerCase();
      if (!valid.some((v) => String(getIdFn(v)).toLowerCase() === itemId)) {
        valid.push(item);
      }
    }
  }
  return valid.slice(0, 5);
}

function recordVisitedItem(type, idOrName) {
  if (!idOrName || idOrName === 'all') return;
  try {
    const key = getCustomerVisitedStorageKey(type);
    let items = getVisitedItems(type);
    // Remove any existing occurrence so the newly visited item moves to index 0 (most recently visited first)
    items = items.filter((x) => String(x).toLowerCase() !== String(idOrName).toLowerCase());
    items.unshift(idOrName);
    localStorage.setItem(key, JSON.stringify(items.slice(0, 20)));
  } catch (e) {
    console.warn('Could not save visited item to localStorage', e);
  }
}

function getVisitedRestaurantMetaKey() {
  const uid = (user && (user._id || user.id)) || 'guest';
  return `tomato_visited_rest_meta_v2_${uid}`;
}

function getVisitedRestaurantMeta() {
  try {
    const raw = localStorage.getItem(getVisitedRestaurantMetaKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // ignore
  }
  return { byRest: {}, lastRestId: null, lastCategory: null, lastProductNames: [], lastCategories: [] };
}

function recordVisitedRestaurant(restId, categoryName = null) {
  if (!restId || restId === 'all') return;
  const idStr = String(restId);
  recordVisitedItem('restaurants', idStr);

  try {
    const meta = getVisitedRestaurantMeta();
    if (!meta.byRest) meta.byRest = {};

    const restItems = allMenuItems.filter((m) => String(m.restaurantId) === idStr);
    const effectiveCategory =
      categoryName && categoryName !== 'all'
        ? categoryName
        : meta.byRest[idStr]?.lastCategory || null;

    let relevantItems = restItems;
    if (effectiveCategory) {
      const catLower = effectiveCategory.trim().toLowerCase();
      const catMatches = restItems.filter(
        (m) => (m.category || 'Main Course').trim().toLowerCase() === catLower
      );
      if (catMatches.length > 0) {
        relevantItems = catMatches;
      }
    }

    const productNames = Array.from(
      new Set(relevantItems.map((m) => (m.name || '').trim().toLowerCase()).filter(Boolean))
    );
    const categories = Array.from(
      new Set(relevantItems.map((m) => (m.category || 'Main Course').trim().toLowerCase()).filter(Boolean))
    );

    meta.byRest[idStr] = {
      lastVisitedAt: Date.now(),
      lastCategory: effectiveCategory,
      productNames,
      categories,
    };
    meta.lastRestId = idStr;
    meta.lastCategory = effectiveCategory;
    meta.lastProductNames = productNames;
    meta.lastCategories = categories;

    localStorage.setItem(getVisitedRestaurantMetaKey(), JSON.stringify(meta));
  } catch (e) {
    console.warn('Could not save visited restaurant metadata', e);
  }
}

// Returns distance-ordered restaurants while retaining visit and product matches for badges.
function getOrderedRestaurantsByVisitAndProduct() {
  const visitedIds = getVisitedItems('restaurants').map(String);
  const meta = getVisitedRestaurantMeta();
  const visitedRests = [];
  const visitedIdSet = new Set();

  visitedIds.forEach((vId) => {
    const found = allRestaurants.find((r) => String(r.id || r._id) === vId);
    if (found && !visitedIdSet.has(vId)) {
      visitedRests.push(found);
      visitedIdSet.add(vId);
    }
  });

  // Collect target product names and categories from the most recently visited restaurant (and other visited ones)
  const primaryProductNames = new Set((meta.lastProductNames || []).map((s) => s.toLowerCase()));
  const primaryCategories = new Set((meta.lastCategories || []).map((s) => s.toLowerCase()));
  if (meta.lastCategory) {
    primaryCategories.add(meta.lastCategory.trim().toLowerCase());
  }

  const secondaryProductNames = new Set();
  const secondaryCategories = new Set();
  visitedRests.forEach((r) => {
    const rId = String(r.id || r._id);
    const rMeta = meta.byRest?.[rId];
    if (rMeta) {
      (rMeta.productNames || []).forEach((n) => secondaryProductNames.add(n.toLowerCase()));
      (rMeta.categories || []).forEach((c) => secondaryCategories.add(c.toLowerCase()));
    } else {
      const rItems = allMenuItems.filter((m) => String(m.restaurantId) === rId);
      rItems.forEach((m) => {
        if (m.name) secondaryProductNames.add(m.name.trim().toLowerCase());
        if (m.category) secondaryCategories.add(m.category.trim().toLowerCase());
      });
    }
  });

  const sameProductEntries = [];
  const remainingRests = [];
  const featuredItemByRestId = new Map();

  // Determine featured item for each visited restaurant (prefer item from its last visited category)
  visitedRests.forEach((r) => {
    const rId = String(r.id || r._id);
    const rItems = allMenuItems.filter((m) => String(m.restaurantId) === rId);
    const lastCat = meta.byRest?.[rId]?.lastCategory;
    let featured = rItems[0] || null;
    if (lastCat) {
      const catMatch = rItems.find(
        (m) => (m.category || 'Main Course').trim().toLowerCase() === lastCat.trim().toLowerCase()
      );
      if (catMatch) featured = catMatch;
    }
    if (featured) featuredItemByRestId.set(rId, featured);
  });

  // Evaluate all non-visited restaurants for selling the same product/category
  allRestaurants.forEach((r) => {
    const rId = String(r.id || r._id);
    if (visitedIdSet.has(rId)) return;

    const rItems = allMenuItems.filter((m) => String(m.restaurantId) === rId);
    let bestScore = 0;
    let matchedItem = rItems[0] || null;

    for (const item of rItems) {
      const iName = (item.name || '').trim().toLowerCase();
      const iCat = (item.category || 'Main Course').trim().toLowerCase();
      let score = 0;

      if (iName && primaryProductNames.has(iName)) {
        score = 4; // Exact same product as last visited restaurant/category
      } else if (
        iName &&
        Array.from(primaryProductNames).some((p) => p.length > 2 && (iName.includes(p) || p.includes(iName)))
      ) {
        score = 3; // Similar product name to last visited restaurant/category
      } else if (iCat && primaryCategories.has(iCat)) {
        score = 2; // Same category/product type as last visited restaurant/category
      } else if ((iName && secondaryProductNames.has(iName)) || (iCat && secondaryCategories.has(iCat))) {
        score = 1; // Matches product/category from earlier visited restaurant
      }

      if (score > bestScore) {
        bestScore = score;
        matchedItem = item;
      }
    }

    if (matchedItem) {
      featuredItemByRestId.set(rId, matchedItem);
    }

    if (bestScore > 0) {
      sameProductEntries.push({ rest: r, score: bestScore });
    } else {
      remainingRests.push(r);
    }
  });

  sameProductEntries.sort((a, b) => b.score - a.score);
  const sameProductRests = sameProductEntries.map((e) => e.rest);

  // Build pill list:
  // 1) Visited ("favorite") restaurants in sorted order by last visit
  // 2) Followed by restaurants that sell the same product
  // 3) If no visits yet (or fewer than 5), fill from remaining restaurants
  let pillRests = [...visitedRests, ...sameProductRests];
  if (pillRests.length < 5) {
    for (const r of remainingRests) {
      if (pillRests.length >= 5) break;
      pillRests.push(r);
    }
  }

  return {
    visitedRests,
    sameProductRests,
    remainingRests,
    orderedAll: sortRestaurantsByDistance(allRestaurants),
    pillRests: sortRestaurantsByDistance(pillRests),
    visitedIdSet,
    sameProductIdSet: new Set(sameProductRests.map((r) => String(r.id || r._id))),
    featuredItemByRestId,
    meta,
  };
}

let activeFilterModalTab = 'all_restaurants';

function openFilterSelectionModal(tab) {
  activeFilterModalTab = tab || mainCustomerTab;
  const modal = document.getElementById('filter-selection-modal');
  if (!modal) return;

  const titleEl = document.getElementById('filter-modal-title');
  const searchInput = document.getElementById('filter-modal-search');

  if (titleEl) {
    if (customerBrowseMode === 'shop') {
      if (activeFilterModalTab === 'all_shops') {
        titleEl.textContent = '🏪 Select Retail Shop';
        if (searchInput) searchInput.placeholder = 'Search shop by name, category, address...';
      } else if (activeFilterModalTab === 'all_products') {
        titleEl.textContent = '🛍️ Select Product';
        if (searchInput) searchInput.placeholder = 'Search products by name, description, category...';
      } else if (activeFilterModalTab === 'category') {
        titleEl.textContent = '📑 Select Product Category';
        if (searchInput) searchInput.placeholder = 'Search product category...';
      }
    } else {
      if (activeFilterModalTab === 'all_restaurants') {
        titleEl.textContent = '🏪 Select Restaurant';
        if (searchInput) searchInput.placeholder = 'Search restaurant by name, cuisine, address...';
      } else if (activeFilterModalTab === 'all_menus') {
        titleEl.textContent = '🍽️ Select Menu / Dish';
        if (searchInput) searchInput.placeholder = 'Search dishes by name, description, or category...';
      } else if (activeFilterModalTab === 'category') {
        titleEl.textContent = '📑 Select Food Category';
        if (searchInput) searchInput.placeholder = 'Search food category...';
      }
    }
  }

  if (searchInput) {
    searchInput.value = '';
  }

  renderFilterModalItems(activeFilterModalTab, '');
  openModal('filter-selection-modal');

  setTimeout(() => {
    if (searchInput) searchInput.focus();
  }, 60);
}

function closeFilterModal() {
  closeModal('filter-selection-modal');
  if (typeof closeInlineRestaurantSearchDropdown === 'function') {
    closeInlineRestaurantSearchDropdown();
  }
}

function handleFilterModalBackdropClick(e) {
  if (e.target && e.target.id === 'filter-selection-modal') {
    closeFilterModal();
  }
}

function handleFilterModalSearch(input) {
  const q = (input?.value || '').trim();
  renderFilterModalItems(activeFilterModalTab, q);
}

function handleFilterModalCardClick(card, event) {
  if (event) {
    event.stopPropagation();
  }
  if (!card) return;
  const filterType = card.getAttribute('data-filter-type');
  const filterVal = card.getAttribute('data-filter-value');
  if (!filterType || filterVal === null || filterVal === undefined) return;

  if (filterType === 'restaurant') {
    if (filterVal === 'all') {
      selectRestaurantFilter('all');
    } else {
      toggleRestaurantModalCategories(event, filterVal);
    }
  } else if (filterType === 'shop') {
    selectShopFilter(filterVal);
  } else if (filterType === 'category') {
    selectCategoryFilter(filterVal);
  } else if (filterType === 'menu' || filterType === 'product') {
    selectMenuItemFilter(filterVal);
  }
}

function handleFilterModalItemClick(e) {
  if (e.target.closest('.rest-category-expand-btn') || e.target.closest('.rest-category-panel')) {
    return;
  }
  const card = e.target.closest('.filter-modal-card');
  if (card) {
    handleFilterModalCardClick(card, e);
  }
}

function toggleRestaurantModalCategories(event, restId) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const panel = document.getElementById(`rest-cat-panel-${restId}`);
  const btn = document.getElementById(`rest-cat-btn-${restId}`);
  if (!panel) return;

  const wasOpen = panel.classList.contains('open');

  // Close any previously opened restaurant category panel in modal or inline search dropdown
  document.querySelectorAll('.rest-category-panel.open').forEach((p) => {
    p.classList.remove('open');
  });
  document.querySelectorAll('.rest-category-expand-btn.expanded').forEach((b) => {
    b.classList.remove('expanded');
    b.innerHTML = '▾ Categories';
  });

  if (!wasOpen) {
    panel.classList.add('open');
    if (btn) {
      btn.classList.add('expanded');
      btn.innerHTML = '▴ Categories';
    }
  }
}
window.toggleRestaurantModalCategories = toggleRestaurantModalCategories;

function renderFilterModalItems(tab, query = '') {
  const container = document.getElementById('filter-modal-items-container');
  if (!container) return;

  const q = (query || '').toLowerCase().trim();
  let html = '';

  if (tab === 'all_shops') {
    const isAllActive = currentSelectedShopId === 'all';
    if (!q || 'all shops'.includes(q)) {
      html += `
        <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="shop" data-filter-value="all" onclick="handleFilterModalCardClick(this, event)">
          <div>
            <div style="font-weight:700; font-size:0.95rem;">All Shops</div>
            <div style="font-size:0.78rem; color:var(--muted);">View products across all retail shops</div>
          </div>
          <span class="filter-modal-card-badge">${allShopItems.length} products</span>
        </div>
      `;
    }

    const filteredShops = allShops.filter((shop) => {
      if (!q) return true;
      const name = (shop.name || shop.displayName || '').toLowerCase();
      const cat = (shop.category || '').toLowerCase();
      const addr = (shop.shopAddress || shop.address || '').toLowerCase();
      return name.includes(q) || cat.includes(q) || addr.includes(q);
    });

    if (!filteredShops.length && q) {
      html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No shops match "${escapeHtml(query)}"</p>`;
    } else {
      filteredShops.forEach((shop) => {
        const shopId = String(shop.id || shop._id);
        const count = allShopItems.filter((m) => String(m.restaurantId) === shopId).length;
        const shopDisplay = formatCleanName(shop.name || shop.displayName || 'Shop');
        const isClosed = shop.isOpen === false || shop.isOnline === false;
        const isActive = currentSelectedShopId === shopId;
        const catText = shop.category ? ` • ${escapeHtml(shop.category)}` : '';
        const addrText = (shop.shopAddress || shop.address) ? ` • ${escapeHtml(shop.shopAddress || shop.address)}` : '';

        html += `
          <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="shop" data-filter-value="${escapeHtml(shopId)}" onclick="handleFilterModalCardClick(this, event)">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                <span style="font-weight:600; font-size:0.92rem; color:var(--ink);">${escapeHtml(shopDisplay)}</span>
                ${isClosed ? '<span style="font-size:0.7em; color:#ef4444; font-weight:700; background:#fee2e2; padding:0.1rem 0.35rem; border-radius:4px;">[CLOSED]</span>' : ''}
              </div>
              <div style="font-size:0.76rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0.2rem;">
                ${count} products${catText}${addrText}
              </div>
            </div>
            <span class="filter-modal-card-badge">${count} products</span>
          </div>
        `;
      });
    }
  } else if (tab === 'all_products') {
    const isAllActive = selectedCategory === 'all' && selectedMenuItemId === 'all';

    if (!q || 'all products'.includes(q)) {
      html += `
        <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="product" data-filter-value="all" onclick="handleFilterModalCardClick(this, event)">
          <div>
            <div style="font-weight:700; font-size:0.95rem;">All Products</div>
            <div style="font-size:0.78rem; color:var(--muted);">All groceries, retail goods and packaged products</div>
          </div>
          <span class="filter-modal-card-badge">${allShopItems.length} products</span>
        </div>
      `;
    }

    const filteredProds = allShopItems.filter((m) => {
      if (!q) return true;
      const name = (m.name || '').toLowerCase();
      const cat = (m.category || '').toLowerCase();
      const desc = (m.description || '').toLowerCase();
      return name.includes(q) || cat.includes(q) || desc.includes(q);
    });

    if (!filteredProds.length && q) {
      html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No products match "${escapeHtml(query)}"</p>`;
    } else {
      filteredProds.forEach((item) => {
        const itemId = String(item.id || item._id);
        const isActive = selectedMenuItemId === itemId;
        const matchShop = allShops.find((s) => String(s.id || s._id) === String(item.restaurantId));
        const shopName = matchShop?.name || item.restaurantName || item.shopName || '';

        html += `
          <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="product" data-filter-value="${escapeHtml(itemId)}" onclick="handleFilterModalCardClick(this, event)">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <span style="font-weight:600; font-size:0.92rem;">${escapeHtml(item.name)}</span>
              </div>
              <div style="font-size:0.76rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0.2rem;">
                ${escapeHtml(item.category || 'Retail')}${shopName ? ` • by ${escapeHtml(shopName)}` : ''}
              </div>
            </div>
            <span class="filter-modal-card-badge">₹${item.price}</span>
          </div>
        `;
      });
    }
  } else if (tab === 'all_restaurants') {
    const isAllActive = currentSelectedRestaurantId === 'all' && selectedCategory === 'all';
    if (!q || 'all restaurants'.includes(q)) {
      html += `
        <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="restaurant" data-filter-value="all" onclick="handleFilterModalCardClick(this, event)">
          <div>
            <div style="font-weight:700; font-size:0.95rem;">All Restaurants</div>
            <div style="font-size:0.78rem; color:var(--muted);">View menus and dishes across all restaurants</div>
          </div>
          <span class="filter-modal-card-badge">${allMenuItems.length} dishes</span>
        </div>
      `;
    }

    const filteredRests = allRestaurants.filter((rest) => {
      if (!q) return true;
      const name = (rest.name || rest.displayName || '').toLowerCase();
      const cuisine = (rest.cuisine || '').toLowerCase();
      const addr = (rest.restaurantAddress || rest.address || '').toLowerCase();
      return name.includes(q) || cuisine.includes(q) || addr.includes(q);
    });

    if (!filteredRests.length && q) {
      html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No restaurants match "${escapeHtml(query)}"</p>`;
    } else {
      filteredRests.forEach((rest) => {
        const restId = String(rest.id || rest._id);
        const restItems = allMenuItems.filter((m) => String(m.restaurantId) === restId);
        const count = restItems.length;
        const restDisplay = formatCleanName(rest.name || rest.displayName || 'Restaurant');
        const isClosed = rest.isOpen === false || rest.isOnline === false;
        const isActive = currentSelectedRestaurantId === restId;
        const cuisineText = rest.cuisine ? ` • ${escapeHtml(rest.cuisine)}` : '';
        const addrText = (rest.restaurantAddress || rest.address) ? ` • ${escapeHtml(rest.restaurantAddress || rest.address)}` : '';

        const catMap = new Map();
        restItems.forEach((m) => {
          const raw = (m.category || 'Main Course').trim() || 'Main Course';
          const key = raw.toLowerCase();
          const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
          if (!catMap.has(key)) {
            catMap.set(key, { name: formatted, count: 0 });
          }
          catMap.get(key).count += 1;
        });
        const restCategories = Array.from(catMap.values());

        const categoriesContentHtml =
          restCategories.length > 0
            ? `<div style="font-size:0.74rem; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.2rem;">Food Categories (Click to Open):</div>
               <ul class="rest-category-bullet-list">
                ${restCategories
                  .map((c) => {
                    const isCatActive =
                      isActive &&
                      selectedCategory !== 'all' &&
                      selectedCategory.toLowerCase() === c.name.toLowerCase();
                    return `<li>
                      <button type="button" class="rest-category-bullet-btn ${isCatActive ? 'active' : ''}" onclick="selectRestaurantCategoryFilter(event, '${escapeHtml(restId)}', '${escapeHtml(c.name)}')" title="Open ${escapeHtml(c.name)} from ${escapeHtml(restDisplay)}">
                        <span>🍽️ ${escapeHtml(c.name)}</span>
                        <span style="font-size:0.75rem; opacity:0.8; font-weight:500;">${c.count} ${c.count === 1 ? 'item' : 'items'} →</span>
                      </button>
                    </li>`;
                  })
                  .join('')}
              </ul>`
            : `<ul class="rest-category-bullet-list"><li style="color:#dc2626; font-weight:600; font-size:0.8rem;">Not selling any item</li></ul>`;

        html += `
          <div>
            <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="restaurant" data-filter-value="${escapeHtml(restId)}" onclick="toggleRestaurantModalCategories(event, '${escapeHtml(restId)}')" title="Click to expand food categories sold by ${escapeHtml(restDisplay)}">
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                  <span style="font-weight:600; font-size:0.92rem; color:var(--ink);">${escapeHtml(restDisplay)}</span>
                  ${isClosed ? '<span style="font-size:0.7em; color:#ef4444; font-weight:700; background:#fee2e2; padding:0.1rem 0.35rem; border-radius:4px;">[CLOSED]</span>' : ''}
                </div>
                <div style="font-size:0.76rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0.2rem;">
                  ${count} menu items${cuisineText}${addrText}
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:0.4rem; flex-shrink:0;">
                <span class="filter-modal-card-badge">${count} items</span>
                <button
                  type="button"
                  id="rest-cat-btn-${escapeHtml(restId)}"
                  class="rest-category-expand-btn"
                  onclick="toggleRestaurantModalCategories(event, '${escapeHtml(restId)}')"
                  title="Expand to see food categories sold by this restaurant"
                >
                  ▾ Categories
                </button>
              </div>
            </div>
            <div id="rest-cat-panel-${escapeHtml(restId)}" class="rest-category-panel">
              ${categoriesContentHtml}
            </div>
          </div>
        `;
      });
    }
  } else if (tab === 'category') {
    const isShopMode = customerBrowseMode === 'shop';
    const distinctCategories = isShopMode ? getDistinctShopCategories() : getDistinctCategories();
    const sourceItems = isShopMode ? allShopItems : allMenuItems;
    const isAllActive = selectedCategory === 'all';

    if (!q || 'all categories'.includes(q)) {
      html += `
        <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="category" data-filter-value="all" onclick="handleFilterModalCardClick(this)">
          <div>
            <div style="font-weight:700; font-size:0.95rem;">All Categories</div>
            <div style="font-size:0.78rem; color:var(--muted);">${isShopMode ? 'Explore all retail product categories' : 'Explore all food categories'}</div>
          </div>
          <span class="filter-modal-card-badge">${sourceItems.length} ${isShopMode ? 'products' : 'dishes'}</span>
        </div>
      `;
    }

    const filteredCats = distinctCategories.filter((c) => !q || c.toLowerCase().includes(q));
    if (!filteredCats.length && q) {
      html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No categories match "${escapeHtml(query)}"</p>`;
    } else {
      filteredCats.forEach((cat) => {
        const count = sourceItems.filter((m) => (m.category || (isShopMode ? 'Retail Goods' : 'Main Course')).toLowerCase() === cat.toLowerCase()).length;
        const isActive = selectedCategory.toLowerCase() === cat.toLowerCase();
        html += `
          <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="category" data-filter-value="${escapeHtml(cat)}" onclick="handleFilterModalCardClick(this)">
            <div>
              <div style="font-weight:600; font-size:0.92rem;">${escapeHtml(cat)}</div>
            </div>
            <span class="filter-modal-card-badge">${count} items</span>
          </div>
        `;
      });
    }
  } else if (tab === 'all_menus') {
    const isAllActive = selectedCategory === 'all' && selectedMenuItemId === 'all';
    const vegCount = allMenuItems.filter((m) => m.dietary !== 'non-veg').length;
    const nonVegCount = allMenuItems.filter((m) => m.dietary === 'non-veg').length;

    if (!q || 'all menus dishes'.includes(q)) {
      html += `
        <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="menu" data-filter-value="all" onclick="handleFilterModalCardClick(this)">
          <div>
            <div style="font-weight:700; font-size:0.95rem;">All Menus</div>
            <div style="font-size:0.78rem; color:var(--muted);">All delicious food and beverage items</div>
          </div>
          <span class="filter-modal-card-badge">${allMenuItems.length} items</span>
        </div>
      `;
    }

    if (!q || 'pure veg vegetarian'.includes(q)) {
      html += `
        <div class="filter-modal-card ${selectedCategory === 'veg' && selectedMenuItemId === 'all' ? 'active' : ''}" data-filter-type="menu" data-filter-value="veg" onclick="handleFilterModalCardClick(this)">
          <div>
            <div style="font-weight:600; font-size:0.92rem; color:#16a34a;">🟢 Pure Veg</div>
            <div style="font-size:0.78rem; color:var(--muted);">Vegetarian dishes</div>
          </div>
          <span class="filter-modal-card-badge">${vegCount} items</span>
        </div>
      `;
    }

    if (!q || 'non-veg non veg'.includes(q)) {
      html += `
        <div class="filter-modal-card ${selectedCategory === 'non-veg' && selectedMenuItemId === 'all' ? 'active' : ''}" data-filter-type="menu" data-filter-value="non-veg" onclick="handleFilterModalCardClick(this)">
          <div>
            <div style="font-weight:600; font-size:0.92rem; color:#dc2626;">🔴 Non-Veg</div>
            <div style="font-size:0.78rem; color:var(--muted);">Non-vegetarian dishes</div>
          </div>
          <span class="filter-modal-card-badge">${nonVegCount} items</span>
        </div>
      `;
    }

    const filteredDishes = allMenuItems.filter((m) => {
      if (!q) return true;
      const name = (m.name || '').toLowerCase();
      const cat = (m.category || '').toLowerCase();
      const desc = (m.description || '').toLowerCase();
      return name.includes(q) || cat.includes(q) || desc.includes(q);
    });

    if (!filteredDishes.length && q) {
      html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No dishes match "${escapeHtml(query)}"</p>`;
    } else {
      filteredDishes.forEach((item) => {
        const itemId = String(item.id || item._id);
        const isActive = selectedMenuItemId === itemId;
        const matchRest = allRestaurants.find((r) => String(r.id || r._id) === String(item.restaurantId));
        const restName = matchRest?.name || item.restaurantName || '';

        html += `
          <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="menu" data-filter-value="${escapeHtml(itemId)}" onclick="handleFilterModalCardClick(this)">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <span style="font-weight:600; font-size:0.92rem;">${escapeHtml(item.name)}</span>
                <span class="dietary-tag ${item.dietary === 'non-veg' ? 'dietary-non-veg' : 'dietary-veg'}">${item.dietary === 'non-veg' ? 'NON-VEG' : 'VEG'}</span>
              </div>
              <div style="font-size:0.76rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0.2rem;">
                ${escapeHtml(item.category || 'Dish')}${restName ? ` • by ${escapeHtml(restName)}` : ''}
              </div>
            </div>
            <span class="filter-modal-card-badge">₹${item.price}</span>
          </div>
        `;
      });
    }
  }

  container.innerHTML = html;
}

function renderRestaurantPills() {
  const container = document.getElementById('restaurant-pills');
  if (!container) return;

  if (customerBrowseMode === 'shop') {
    // --- SHOP MODE PRIMARY HEADERS ---
    const totalProductsCount = allShopItems.length;
    const distinctCategories = getDistinctShopCategories();

    let headersHtml = `
      <button class="filter-pill ${mainCustomerTab === 'all_shops' ? 'active' : ''}" onclick="selectMainCustomerTab('all_shops')">
        🏪 Shops (${allShops.length})
      </button>
      <button class="filter-pill ${mainCustomerTab === 'all_products' ? 'active' : ''}" onclick="selectMainCustomerTab('all_products')">
        🛍️ Products (${totalProductsCount})
      </button>
      <button class="filter-pill ${mainCustomerTab === 'category' ? 'active' : ''}" onclick="selectMainCustomerTab('category')">
        📑 P-Category (${distinctCategories.length})
      </button>
    `;
    container.innerHTML = headersHtml;
    renderSubFilterPills();
    return;
  }

  // --- RESTAURANT MODE PRIMARY HEADERS ---
  const totalItemsCount = allMenuItems.length;
  const distinctCategories = getDistinctCategories();

  const existingSearchVal = typeof inlineRestaurantSearchQuery !== 'undefined' ? inlineRestaurantSearchQuery : '';
  let headersHtml = `
    <div id="inline-restaurant-search-wrapper" style="position:relative; display:inline-flex; align-items:center; min-width:255px;">
      <span style="position:absolute; left:0.75rem; font-size:0.88rem; pointer-events:none; z-index:1;">🏪</span>
      <input
        id="inline-restaurant-search-input"
        type="text"
        value="${escapeHtml(existingSearchVal)}"
        placeholder="Search Restaurants (${allRestaurants.length})..."
         autocomplete="off"
        style="width:100%; padding:0.46rem 2rem 0.46rem 2.15rem; font-size:0.84rem; font-weight:600; border:1.5px solid ${mainCustomerTab === 'all_restaurants' ? 'var(--ink)' : 'var(--line)'}; border-radius:999px; background:${mainCustomerTab === 'all_restaurants' ? '#fff' : 'var(--panel)'}; color:var(--ink); outline:none; box-shadow:${mainCustomerTab === 'all_restaurants' ? '0 2px 8px rgba(15,23,42,0.08)' : 'none'}; transition:all 0.15s ease;"
        onfocus="handleInlineRestaurantSearchFocus(this)"
        onclick="handleInlineRestaurantSearchFocus(this)"
        oninput="handleInlineRestaurantSearchInput(this)"
      />
      <span style="position:absolute; right:0.75rem; font-size:0.82rem; color:var(--muted); pointer-events:none;">🔍</span>
      <div
        id="inline-restaurant-search-dropdown"
        style="display:none; position:absolute; top:calc(100% + 6px); left:0; width:min(440px, 90vw); max-height:380px; overflow-y:auto; background:#ffffff; border:1px solid var(--line); border-radius:12px; box-shadow:0 14px 32px rgba(15,23,42,0.18); padding:0.6rem; z-index:1200; flex-direction:column; gap:0.45rem;"
        onclick="handleFilterModalItemClick(event)"
      ></div>
    </div>
    <button class="filter-pill ${mainCustomerTab === 'all_menus' ? 'active' : ''}" onclick="selectMainCustomerTab('all_menus')">
      🍽️ Menus (${totalItemsCount})
    </button>
    <button class="filter-pill ${mainCustomerTab === 'category' ? 'active' : ''}" onclick="selectMainCustomerTab('category')">
      📑 F-Category (${distinctCategories.length})
    </button>
  `;
  container.innerHTML = headersHtml;

  // 2. Secondary Sub-Filter Pills based on selected primary tab
  renderSubFilterPills();
}

function renderSubFilterPills() {
  const subContainer = document.getElementById('sub-filter-pills');
  if (!subContainer) return;

  let subHtml = '';

  if (customerBrowseMode === 'shop') {
    // ==================== SHOP MODE SUB-PILLS ====================
    if (mainCustomerTab === 'all_shops') {
      const isAllActive = currentSelectedShopId === 'all';
      const recentShops = getStablePillItems('shops', allShops, (s) => s.id || s._id);

      subHtml += `
        <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
          <button type="button" class="split-filter-pill-action" onclick="selectShopFilter('all')">
            All (${allShopItems.length})
          </button>
          <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('all_shops')" title="Open all shops popup" aria-label="Open all shops popup">
            ▼
          </button>
        </div>
      `;

      recentShops.forEach((shop) => {
        const shopId = String(shop.id || shop._id);
        const count = allShopItems.filter((m) => String(m.restaurantId) === shopId).length;
        const shopDisplay = formatCleanName(shop.name || shop.displayName || 'Shop');
        const isClosed = shop.isOpen === false || shop.isOnline === false;
        const statusBadge = isClosed ? ' <span style="font-size:0.7em; color:#ef4444; font-weight:700;">[CLOSED]</span>' : '';
        const isActive = currentSelectedShopId === shopId;
        subHtml += `
          <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; ${isClosed ? 'opacity:0.85; border-color:#fca5a5;' : ''}" onclick="selectShopFilter('${shopId}')">
            ${escapeHtml(shopDisplay)}${statusBadge} (${count})
          </button>
        `;
      });
    } else if (mainCustomerTab === 'category') {
      const distinctCategories = getDistinctShopCategories();
      const isAllActive = selectedCategory === 'all';
      const recentCats = getStablePillItems('shop_categories', distinctCategories, (c) => c);

      subHtml += `
        <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
          <button type="button" class="split-filter-pill-action" onclick="selectCategoryFilter('all')">
            All Categories (${allShopItems.length})
          </button>
          <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('category')" title="Open all categories popup" aria-label="Open all categories popup">
            ▼
          </button>
        </div>
      `;

      recentCats.forEach((cat) => {
        const count = allShopItems.filter((m) => (m.category || 'Retail Goods').toLowerCase() === cat.toLowerCase()).length;
        const isActive = selectedCategory.toLowerCase() === cat.toLowerCase();
        subHtml += `
          <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectCategoryFilter('${escapeHtml(cat)}')">
            ${escapeHtml(cat)} (${count})
          </button>
        `;
      });
    } else if (mainCustomerTab === 'all_products') {
      const isAllActive = selectedCategory === 'all' && selectedMenuItemId === 'all';
      const recentProducts = getStablePillItems('products', allShopItems, (m) => m.id || m._id);

      subHtml += `
        <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
          <button type="button" class="split-filter-pill-action" onclick="selectMenuItemFilter('all')">
            All Products (${allShopItems.length})
          </button>
          <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('all_products')" title="Open all products popup" aria-label="Open all products popup">
            ▼
          </button>
        </div>
      `;

      recentProducts.forEach((item) => {
        const itemId = String(item.id || item._id);
        const isActive = selectedMenuItemId === itemId;
        subHtml += `
          <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectMenuItemFilter('${itemId}')">
            ${escapeHtml(item.name)} (₹${item.price})
          </button>
        `;
      });
    }
  } else {
    // ==================== RESTAURANT MODE SUB-PILLS ====================
    if (mainCustomerTab === 'all_restaurants') {
      const isAllActive = currentSelectedRestaurantId === 'all' && selectedCategory === 'all';
      const { pillRests, visitedIdSet, sameProductIdSet } = getOrderedRestaurantsByVisitAndProduct();

      subHtml += `
        <button type="button" class="filter-pill ${isAllActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectRestaurantFilter('all')">
          Latest History
        </button>
      `;

      pillRests.forEach((rest) => {
        const restId = String(rest.id || rest._id);
        const count = allMenuItems.filter((m) => String(m.restaurantId) === restId).length;
        const restDisplay = formatCleanName(rest.name || rest.displayName || 'Restaurant');
        const isClosed = rest.isOpen === false || rest.isOnline === false;
        const statusBadge = isClosed ? ' <span style="font-size:0.7em; color:#ef4444; font-weight:700;">[CLOSED]</span>' : '';
        const isActive = String(currentSelectedRestaurantId) === restId;
        const isVisitedFav = visitedIdSet.has(restId);
        const isSameProd = sameProductIdSet.has(restId);
        const pillTitle = isVisitedFav
          ? 'Recently visited favorite restaurant (sorted by last visit)'
          : isSameProd
            ? 'Sells the same product / category'
            : 'Click to view restaurant menu';

        subHtml += `
          <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; ${isClosed ? 'opacity:0.85; border-color:#fca5a5;' : ''}" onclick="selectRestaurantFilter('${restId}')" title="${escapeHtml(pillTitle)}">
            ${escapeHtml(restDisplay)}${statusBadge} (${count})
          </button>
        `;
      });

      if (selectedCategory !== 'all') {
        const activeRest = allRestaurants.find((r) => String(r.id || r._id) === String(currentSelectedRestaurantId));
        const activeRestName = activeRest ? formatCleanName(activeRest.name || activeRest.displayName || 'Restaurant') : '';
        subHtml += `
          <button type="button" class="filter-pill active" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectRestaurantFilter('${escapeHtml(String(currentSelectedRestaurantId))}')" title="Click to show all categories from this restaurant">
            🍽️ ${activeRestName ? `${escapeHtml(activeRestName)}: ` : ''}${escapeHtml(selectedCategory)} ✕
          </button>
        `;
      }
    } else if (mainCustomerTab === 'category') {
      const distinctCategories = getDistinctCategories();
      const isAllActive = selectedCategory === 'all';
      const recentCats = getStablePillItems('categories', distinctCategories, (c) => c);

      subHtml += `
        <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
          <button type="button" class="split-filter-pill-action" onclick="selectCategoryFilter('all')">
            All Categories (${allMenuItems.length})
          </button>
          <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('category')" title="Open all categories popup" aria-label="Open all categories popup">
            ▼
          </button>
        </div>
      `;

      recentCats.forEach((cat) => {
        const count = allMenuItems.filter((m) => (m.category || 'Main Course').toLowerCase() === cat.toLowerCase()).length;
        const isActive = selectedCategory.toLowerCase() === cat.toLowerCase();
        subHtml += `
          <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectCategoryFilter('${escapeHtml(cat)}')">
            ${escapeHtml(cat)} (${count})
          </button>
        `;
      });
    } else if (mainCustomerTab === 'all_menus') {
      const isAllActive = selectedCategory === 'all' && selectedMenuItemId === 'all';
      const vegCount = allMenuItems.filter((m) => m.dietary !== 'non-veg').length;
      const nonVegCount = allMenuItems.filter((m) => m.dietary === 'non-veg').length;

      const recentMenuItems = getStablePillItems('menus', allMenuItems, (m) => m.id || m._id);

      const favoritePillsHtml = recentMenuItems
        .map((item) => {
          const itemId = String(item.id || item._id);
          const isActive = selectedMenuItemId === itemId;
          return `
            <button type="button" class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectMenuItemFilter('${itemId}')">
              ${escapeHtml(item.name)} (₹${item.price})
            </button>
          `;
        })
        .join('');

      subHtml += `
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.6rem; width:100%;">
          <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
            <button type="button" class="split-filter-pill-action" onclick="selectMenuItemFilter('all')">
              All Menus (${allMenuItems.length})
            </button>
            <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('all_menus')" title="Open all menus popup" aria-label="Open all menus popup">
              ▼
            </button>
          </div>
          <button type="button" class="filter-pill ${selectedCategory === 'veg' && selectedMenuItemId === 'all' ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; border-color:#86efac; color:#16a34a;" onclick="selectMenuItemFilter('veg')">
            🟢 Pure Veg (${vegCount})
          </button>
          <button type="button" class="filter-pill ${selectedCategory === 'non-veg' && selectedMenuItemId === 'all' ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; border-color:#fca5a5; color:#dc2626;" onclick="selectMenuItemFilter('non-veg')">
            🔴 Non-Veg (${nonVegCount})
          </button>
        </div>
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.55rem; width:100%; margin-top:0.15rem;">
          <span style="display:inline-flex; align-items:center; gap:0.35rem; font-size:0.8rem; font-weight:700; color:var(--tomato-dark, #a9382a); background:var(--tomato-soft, #fbeee9); border:1px solid rgba(217, 75, 53, 0.3); padding:0.35rem 0.85rem; border-radius:999px;">
            Your Favorites
          </span>
          ${favoritePillsHtml}
        </div>
      `;
    }
  }

  subContainer.innerHTML = subHtml;
}

function selectMainCustomerTab(tab) {
  mainCustomerTab = tab;
  selectedCategory = 'all';
  currentSelectedRestaurantId = 'all';
  currentSelectedShopId = 'all';
  selectedMenuItemId = 'all';
  openDropdownTab = null;
  renderRestaurantPills();
  renderMenuItems();
}
window.selectMainCustomerTab = selectMainCustomerTab;

function closeDropdownMenu() {
  closeFilterModal();
}

function selectRestaurantFilter(id) {
  if (id !== 'all') {
    const targetRest = Array.isArray(allRestaurants) ? allRestaurants.find((r) => String(r.id || r._id) === String(id)) : null;
    if (targetRest && isStoreBeyondCustomerRange(targetRest)) {
      if (typeof showRestaurantTooFarPopup === 'function') {
        showRestaurantTooFarPopup(targetRest.name || 'Restaurant', targetRest.distanceKm);
      } else {
        alert('Restaurant is too far from you');
      }
      return;
    }
  }
  currentSelectedRestaurantId = id;
  selectedCategory = 'all';
  if (id !== 'all') {
    recordVisitedRestaurant(id, null);
  }
  closeFilterModal();
  renderRestaurantPills();
  renderMenuItems();
}
window.selectRestaurantFilter = selectRestaurantFilter;

function selectRestaurantCategoryFilter(event, restId, categoryName) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  if (restId && restId !== 'all') {
    const targetRest = Array.isArray(allRestaurants) ? allRestaurants.find((r) => String(r.id || r._id) === String(restId)) : null;
    if (targetRest && isStoreBeyondCustomerRange(targetRest)) {
      if (typeof showRestaurantTooFarPopup === 'function') {
        showRestaurantTooFarPopup(targetRest.name || 'Restaurant', targetRest.distanceKm);
      } else {
        alert('Restaurant is too far from you');
      }
      return;
    }
  }
  mainCustomerTab = 'all_restaurants';
  currentSelectedRestaurantId = restId || 'all';
  selectedCategory = categoryName || 'all';
  selectedMenuItemId = 'all';
  if (restId && restId !== 'all') {
    recordVisitedRestaurant(restId, categoryName);
  }
  if (categoryName && categoryName !== 'all') {
    recordVisitedItem('categories', categoryName);
  }
  closeFilterModal();
  renderRestaurantPills();
  renderMenuItems();
}
window.selectRestaurantCategoryFilter = selectRestaurantCategoryFilter;

function selectShopFilter(id) {
  if (id !== 'all') {
    const targetShop = Array.isArray(allShops) ? allShops.find((s) => String(s.id || s._id) === String(id)) : null;
    if (targetShop && isStoreBeyondCustomerRange(targetShop)) {
      if (typeof showRestaurantTooFarPopup === 'function') {
        showRestaurantTooFarPopup(targetShop.name || 'Shop', targetShop.distanceKm);
      } else {
        alert('Shop is too far from you');
      }
      return;
    }
  }
  currentSelectedShopId = id;
  if (id !== 'all') {
    recordVisitedItem('shops', id);
  }
  closeFilterModal();
  renderRestaurantPills();
  renderMenuItems();
}
window.selectShopFilter = selectShopFilter;

function selectCategoryFilter(cat) {
  selectedCategory = cat;
  if (cat !== 'all') {
    const catKey = customerBrowseMode === 'shop' ? 'shop_categories' : 'categories';
    recordVisitedItem(catKey, cat);
  }
  closeFilterModal();
  renderRestaurantPills();
  renderMenuItems();
}
window.selectCategoryFilter = selectCategoryFilter;

function selectMenuItemFilter(val) {
  if (val === 'all') {
    selectedMenuItemId = 'all';
    selectedCategory = 'all';
  } else if (val === 'veg' || val === 'non-veg') {
    selectedCategory = val;
    selectedMenuItemId = 'all';
  } else {
    selectedMenuItemId = val;
    selectedCategory = 'all';
    const itemKey = customerBrowseMode === 'shop' ? 'products' : 'menus';
    recordVisitedItem(itemKey, val);
  }
  closeFilterModal();
  renderRestaurantPills();
  renderMenuItems();
}
window.selectMenuItemFilter = selectMenuItemFilter;

function filterMenu() {
  renderMenuItems();
}

let restaurantTileSliderIntervalId = null;

function setRestaurantTileSlide(tileEl, nextIndex) {
  if (!tileEl) return;
  const count = Number(tileEl.getAttribute('data-slide-count') || 0);
  if (count <= 1) return;

  const normalizedIdx = ((nextIndex % count) + count) % count;
  tileEl.setAttribute('data-slide-index', String(normalizedIdx));

  const track = tileEl.querySelector('.rest-tile-bg-slider-track');
  if (track) {
    const shiftPct = normalizedIdx * (100 / count);
    track.style.transform = `translateX(-${shiftPct}%)`;
  }

  tileEl.querySelectorAll('[data-rest-dietary-slide]').forEach((el) => {
    const idx = Number(el.getAttribute('data-rest-dietary-slide'));
    el.style.display = idx === normalizedIdx ? 'inline-flex' : 'none';
  });

  tileEl.querySelectorAll('[data-rest-cat-slide]').forEach((el) => {
    const idx = Number(el.getAttribute('data-rest-cat-slide'));
    el.style.display = idx === normalizedIdx ? 'inline-flex' : 'none';
  });

  tileEl.querySelectorAll('[data-rest-item-slide]').forEach((el) => {
    const idx = Number(el.getAttribute('data-rest-item-slide'));
    el.style.display = idx === normalizedIdx ? 'block' : 'none';
  });

  tileEl.querySelectorAll('[data-rest-dot-slide]').forEach((el) => {
    const idx = Number(el.getAttribute('data-rest-dot-slide'));
    if (idx === normalizedIdx) {
      el.style.background = '#fde047';
      el.style.width = '16px';
      el.style.opacity = '1';
    } else {
      el.style.background = 'rgba(255,255,255,0.55)';
      el.style.width = '6px';
      el.style.opacity = '0.75';
    }
  });
}

function stepRestaurantTileSlider(event, btnOrDotEl, deltaOrTargetIdx, isAbsolute = false) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const tileEl = btnOrDotEl ? btnOrDotEl.closest('.restaurant-history-tile') : null;
  if (!tileEl) return;
  const curIdx = Number(tileEl.getAttribute('data-slide-index') || 0);
  const nextIdx = isAbsolute ? deltaOrTargetIdx : curIdx + deltaOrTargetIdx;
  setRestaurantTileSlide(tileEl, nextIdx);
}
window.stepRestaurantTileSlider = stepRestaurantTileSlider;

function ensureRestaurantTileSliderTimer() {
  if (restaurantTileSliderIntervalId) return;
  restaurantTileSliderIntervalId = setInterval(() => {
    const tiles = document.querySelectorAll('.restaurant-history-tile[data-slide-count]');
    tiles.forEach((tileEl) => {
      if (tileEl.matches(':hover')) return; // Pause auto-slide while user hovers tile
      const count = Number(tileEl.getAttribute('data-slide-count') || 0);
      if (count <= 1) return;
      const curIdx = Number(tileEl.getAttribute('data-slide-index') || 0);
      setRestaurantTileSlide(tileEl, curIdx + 1);
    });
  }, 3200);
}

function renderRestaurantHistoryTileHtml(rest, featuredItemOverride = null, subtitleBadgeText = '🏪 Restaurant') {
  ensureRestaurantTileSliderTimer();

  const restId = String(rest.id || rest._id);
  const restName = formatCleanName(rest.name || rest.displayName || 'Restaurant');
  const isRestClosed = rest.isOpen === false || rest.isOnline === false;
  const restItems = allMenuItems.filter((m) => String(m.restaurantId) === restId);

  // Restaurant rating = average of the average ratings of each of its rated items
  const ratedRestItems = restItems.filter((m) => m.rating != null && Number(m.rating) > 0);
  const computedAvgOfItemAvgs =
    ratedRestItems.length > 0
      ? ratedRestItems.reduce((sum, m) => sum + Number(m.rating), 0) / ratedRestItems.length
      : rest.rating != null && Number(rest.rating) > 0
        ? Number(rest.rating)
        : null;
  const restRatingScore = computedAvgOfItemAvgs != null ? Number(computedAvgOfItemAvgs).toFixed(1) : 'New';
  const itemsReviewSum = restItems.reduce((sum, m) => sum + (Number(m.reviewCount) || 0), 0);
  const directRestReviews = Number(rest.directReviewCount || 0);
  const restReviewCount = Math.max(Number(rest.reviewCount || 0), itemsReviewSum + directRestReviews);

  // Order slide items so featuredItemOverride (if any) is first, followed by remaining items of this restaurant
  const slideItems = [];
  if (featuredItemOverride) {
    slideItems.push(featuredItemOverride);
  }
  restItems.forEach((item) => {
    const itemId = String(item._id || item.id);
    if (!slideItems.some((s) => String(s._id || s.id) === itemId)) {
      slideItems.push(item);
    }
  });

  const slideCount = Math.max(slideItems.length, 1);
  const bgSlidesHtml =
    slideItems.length > 0
      ? slideItems
          .map((item) => {
            const imgSrc =
              item && item.image && item.image.trim()
                ? item.image
                : rest.image && rest.image.trim()
                  ? rest.image
                  : '';
            return `<div class="rest-tile-bg-slide" style="position:relative; overflow:hidden; flex:0 0 ${100 / slideCount}%; width:${100 / slideCount}%; height:100%; background-color:#1e293b;">${renderFullTileBackdropHtml(imgSrc)}</div>`;
          })
          .join('')
      : `<div class="rest-tile-bg-slide" style="position:relative; overflow:hidden; flex:0 0 100%; width:100%; height:100%; background-color:#1e293b;">${renderFullTileBackdropHtml(rest.image || '')}</div>`;

  const dietaryBadgesHtml =
    slideItems.length > 0
      ? slideItems
          .map((item, idx) => {
            const isNonVeg = item.dietary === 'non-veg';
            return `<span data-rest-dietary-slide="${idx}" style="display:${idx === 0 ? 'inline-flex' : 'none'}; align-items:center; gap:0.3rem; padding:0.2rem 0.5rem; border-radius:4px; font-size:0.7rem; font-weight:800; background:${isNonVeg ? 'rgba(254,226,226,0.95)' : 'rgba(220,252,231,0.95)'}; color:${isNonVeg ? '#b91c1c' : '#15803d'}; border:1.5px solid ${isNonVeg ? '#ef4444' : '#22c55e'}; box-shadow:0 2px 6px rgba(0,0,0,0.25);">
              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${isNonVeg ? '#dc2626' : '#16a34a'};"></span>
              ${isNonVeg ? 'NON-VEG' : 'VEG'}
            </span>`;
          })
          .join('')
      : `<span style="display:inline-flex; align-items:center; gap:0.3rem; padding:0.2rem 0.5rem; border-radius:4px; font-size:0.7rem; font-weight:700; background:rgba(255,255,255,0.9); color:#475569;">🍽️ MENU</span>`;

  const categorySlidesHtml =
    slideItems.length > 0
      ? slideItems
          .map(
            (item, idx) =>
              `<span data-rest-cat-slide="${idx}" style="display:${idx === 0 ? 'inline-flex' : 'none'}; align-items:center; font-size:0.8rem; font-weight:800; color:#1e3a8a; background:rgba(255,255,255,0.68); backdrop-filter:blur(2px); padding:0.08rem 0.45rem; border-radius:4px;">${escapeHtml(item.category || 'Dish')}</span>`
          )
          .join('')
      : '';

  const sliderControlsHtml =
    slideItems.length > 1
      ? `
        <div style="display:flex; align-items:center; justify-content:space-between; z-index:1; margin:0.35rem 0 0.15rem 0;">
          <button type="button" onclick="stepRestaurantTileSlider(event, this, -1, false)" title="Previous item image" style="width:26px; height:26px; border-radius:50%; border:1px solid rgba(255,255,255,0.35); background:rgba(15,23,42,0.68); color:#ffffff; font-size:0.95rem; font-weight:800; line-height:1; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; backdrop-filter:blur(4px);">‹</button>
          <div style="display:flex; align-items:center; gap:0.3rem; background:rgba(15,23,42,0.55); padding:0.2rem 0.5rem; border-radius:999px; backdrop-filter:blur(4px);">
            ${slideItems
              .map(
                (_, idx) =>
                  `<span data-rest-dot-slide="${idx}" onclick="stepRestaurantTileSlider(event, this, ${idx}, true)" title="View item ${idx + 1}" style="display:inline-block; height:6px; width:${idx === 0 ? '16px' : '6px'}; border-radius:999px; background:${idx === 0 ? '#fde047' : 'rgba(255,255,255,0.55)'}; opacity:${idx === 0 ? '1' : '0.75'}; transition:all 0.25s ease; cursor:pointer;"></span>`
              )
              .join('')}
          </div>
          <button type="button" onclick="stepRestaurantTileSlider(event, this, 1, false)" title="Next item image" style="width:26px; height:26px; border-radius:50%; border:1px solid rgba(255,255,255,0.35); background:rgba(15,23,42,0.68); color:#ffffff; font-size:0.95rem; font-weight:800; line-height:1; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; backdrop-filter:blur(4px);">›</button>
        </div>
      `
      : '';

  const itemSlidesHtml =
    slideItems.length > 0
      ? slideItems
          .map(
            (item, idx) => `
              <div data-rest-item-slide="${idx}" style="display:${idx === 0 ? 'block' : 'none'};">
                <p class="food-desc" style="margin:0 0 0.35rem 0; font-size:0.82rem; color:#f1f5f9; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-shadow:0 1px 3px rgba(0,0,0,0.9);" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || 'Deliciously prepared with authentic ingredients.')}</p>
                <div style="display:flex; background:rgba(15,23,42,0.32); backdrop-filter:blur(2px); border:1px solid rgba(255,255,255,0.28); border-radius:10px; padding:0.65rem 0.8rem; justify-content:space-between; align-items:center; gap:0.6rem;">
                  <div style="min-width:0; flex:1;">
                    ${slideItems.length > 1 ? `<div style="font-size:0.68rem; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.04em; font-weight:600; margin-bottom:0.15rem;">Item ${idx + 1}/${slideItems.length}</div>` : ''}
                    <div style="font-size:0.95rem; font-weight:700; color:#ffffff; text-shadow:0 1px 3px rgba(0,0,0,0.85); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
                    <span style="font-size:1.05rem; font-weight:800; color:#4ade80; background:rgba(15,23,42,0.35); padding:0.2rem 0.5rem; border-radius:6px; border:1px solid rgba(74,222,128,0.45); text-shadow:0 1px 2px rgba(0,0,0,0.8);">₹${Number(item.price).toFixed(2)}</span>
                    ${!isRestClosed ? `<button type="button" class="btn btn-primary btn-sm" style="padding:0.32rem 0.65rem; font-size:0.75rem; background:rgba(217,75,53,0.78); border:1px solid rgba(255,255,255,0.35);" onclick="event.stopPropagation(); addToCart('${item._id || item.id}', '${escapeHtml(item.name)}', ${Number(item.price)}, '${item.restaurantId}', 'restaurant')">+ Add</button>` : ''}
                  </div>
                </div>
              </div>
            `
          )
          .join('')
      : `
        <div style="background:rgba(15,23,42,0.32); backdrop-filter:blur(2px); border:1px solid rgba(255,255,255,0.28); border-radius:10px; padding:0.65rem 0.8rem; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.85rem; color:#fca5a5; font-style:italic; font-weight:600;">Not selling any item</span>
          <span style="font-size:0.75rem; color:#cbd5e1;">0 items</span>
        </div>
      `;

  return `
    <div class="food-card restaurant-history-tile" data-slide-count="${slideItems.length}" data-slide-index="0" onclick="selectRestaurantFilter('${escapeHtml(restId)}')" style="position:relative; overflow:hidden; min-height:225px; border-radius:14px; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; padding:1.1rem; color:#ffffff; border:1px solid ${isRestClosed ? '#fca5a5' : 'rgba(255,255,255,0.18)'}; background-color:#1e293b; box-shadow:0 8px 20px rgba(15,23,42,0.18); transition:transform 0.2s ease, box-shadow 0.2s ease;">
      <div class="rest-tile-bg-slider-track" style="position:absolute; top:0; left:0; height:100%; width:${slideCount * 100}%; display:flex; z-index:0; pointer-events:none; transition:transform 0.55s cubic-bezier(0.25, 0.8, 0.25, 1);">
        ${bgSlidesHtml}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; z-index:1; position:relative;">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.3rem;">
            <span style="display:inline-block; font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#fde047; background:rgba(0,0,0,0.45); padding:0.15rem 0.45rem; border-radius:4px;">${escapeHtml(subtitleBadgeText)}</span>
            ${rest.distanceText ? `<span style="display:inline-block; font-size:0.68rem; font-weight:700; color:#38bdf8; background:rgba(15,23,42,0.65); padding:0.15rem 0.45rem; border-radius:4px; border:1px solid rgba(56,189,248,0.4);">📍 ${escapeHtml(rest.distanceText)}</span>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-start; gap:0.2rem;">
            <h3 style="margin:0; font-size:1.18rem; font-weight:800; color:#ffffff; text-shadow:0 2px 6px rgba(0,0,0,0.65); line-height:1.25;">${escapeHtml(restName)}</h3>
            ${categorySlidesHtml}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.3rem; flex-shrink:0;">
          <div style="display:flex; gap:0.35rem; align-items:center;">
            ${isRestClosed ? '<span style="background:#ef4444; color:#fff; font-size:0.65rem; font-weight:800; padding:0.15rem 0.45rem; border-radius:4px;">CLOSED</span>' : '<span style="background:rgba(22,163,74,0.9); color:#fff; font-size:0.65rem; font-weight:800; padding:0.15rem 0.45rem; border-radius:4px;">OPEN</span>'}
            ${dietaryBadgesHtml}
          </div>
          <button type="button" class="review-rating-pill" data-rest-id="${escapeHtml(restId)}" data-rest-name="${escapeHtml(restName)}" onclick="event.stopPropagation(); handleRestaurantReviewButtonClick(this)" title="View & write restaurant ratings & reviews" style="margin:0;">
            ⭐ ${restRatingScore} <span style="color:#78350f; font-weight:normal;">(${restReviewCount})</span>
          </button>
          <button type="button" class="review-action-link" data-rest-id="${escapeHtml(restId)}" data-rest-name="${escapeHtml(restName)}" onclick="event.stopPropagation(); handleRestaurantReviewButtonClick(this)" title="View & write restaurant ratings & reviews" style="color:#fde047; text-shadow:0 1px 2px rgba(0,0,0,0.8);">
            Reviews
          </button>
        </div>
      </div>

      ${sliderControlsHtml}

      <div style="z-index:1; position:relative; margin-top:auto; padding-top:0.45rem;">
        ${itemSlidesHtml}
      </div>
    </div>
  `;
}

function renderMenuItems() {
  const grid = document.getElementById('menu-items-grid');
  if (!grid) return;

  const searchVal = (document.getElementById('dish-search')?.value || '').toLowerCase().trim();

  if (customerBrowseMode === 'shop') {
    // ==================== SHOP PRODUCTS RENDERING ====================
    let filtered = allShopItems;

    if (mainCustomerTab === 'all_shops') {
      if (currentSelectedShopId !== 'all') {
        filtered = filtered.filter((m) => String(m.restaurantId) === String(currentSelectedShopId));
      }
    } else if (mainCustomerTab === 'all_products') {
      if (selectedMenuItemId !== 'all') {
        filtered = filtered.filter((m) => String(m.id || m._id) === String(selectedMenuItemId));
      }
    } else if (mainCustomerTab === 'category') {
      if (selectedCategory !== 'all') {
        filtered = filtered.filter((m) => (m.category || 'Retail Goods').toLowerCase() === selectedCategory.toLowerCase());
      }
    }

    if (searchVal) {
      filtered = filtered.filter((m) =>
        (m.name || '').toLowerCase().includes(searchVal) ||
        (m.description || '').toLowerCase().includes(searchVal) ||
        (m.category || '').toLowerCase().includes(searchVal)
      );
    }

    if (!filtered.length) {
      grid.innerHTML = `<p style="color:var(--muted); padding:2rem; grid-column:1/-1; text-align:center;">No products match your selection in shops.</p>`;
      return;
    }

    grid.innerHTML = filtered.map((item) => {
      const matchShop = allShops.find((s) => String(s.id || s._id) === String(item.restaurantId));
      const shopDisplay = formatCleanName(
        matchShop?.name || matchShop?.displayName || item.restaurantName || item.shopName || 'Retail Shop'
      );
      const isShopClosed = matchShop && (matchShop.isOpen === false || matchShop.isOnline === false);
      const stockQty = item.quantity != null ? item.quantity : 15;
      const itemIdStr = String(item._id || item.id || '');
      const ratingScore = item.rating ? Number(item.rating).toFixed(1) : 'New';
      const reviewCount = item.reviewCount || 0;

      return `
        <div class="food-card full-image-item-tile" style="position:relative; overflow:hidden; min-height:225px; border-radius:14px; display:flex; flex-direction:column; justify-content:space-between; padding:1.1rem; color:#ffffff; border:1px solid ${isShopClosed ? '#fca5a5' : 'rgba(255,255,255,0.18)'}; background-color:#1e293b; box-shadow:0 8px 20px rgba(15,23,42,0.18); ${isShopClosed ? 'opacity:0.85;' : ''}">
          ${renderFullTileBackdropHtml(item.image)}
          <div style="z-index:1; position:relative;">
            <div class="food-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.65rem;">
              <div style="flex:1; min-width:0;">
                <h3 class="food-title" style="margin-bottom:0.3rem; background:rgba(15,23,42,0.32); color:#ffffff; border-color:rgba(255,255,255,0.28); border-left:3.5px solid #f87171; backdrop-filter:blur(2px); text-shadow:0 1px 3px rgba(0,0,0,0.85);">${escapeHtml(item.name)}</h3>
                <div class="food-meta" style="margin-bottom:0.35rem; font-weight:600; display:flex; flex-direction:column; align-items:flex-start; gap:0.22rem;">
                  <span style="background:linear-gradient(135deg, rgba(30,58,138,0.52), rgba(29,78,216,0.52)); backdrop-filter:blur(2px); color:#ffffff; padding:0.12rem 0.5rem; border-radius:5px; border:1px solid rgba(96,165,250,0.65); font-weight:700; text-shadow:0 1px 2px rgba(0,0,0,0.8);">${escapeHtml(shopDisplay)}</span>
                  <span style="color:#1e3a8a; background:rgba(255,255,255,0.68); backdrop-filter:blur(2px); padding:0.08rem 0.45rem; border-radius:4px; font-weight:800;">${escapeHtml(item.category || 'Retail Product')}</span>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.3rem; flex-shrink:0;">
                <div style="display:flex; gap:0.35rem; align-items:center;">
                  ${isShopClosed ? '<span class="badge" style="background:#ef4444; color:#ffffff; font-size:0.68rem; font-weight:800; padding:0.15rem 0.45rem; border-radius:4px;">CLOSED</span>' : ''}
                  <span class="badge" style="background:rgba(240,253,244,0.95); color:#15803d; font-size:0.7rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:4px;">🏪 SHOP</span>
                </div>
                <button type="button" class="review-rating-pill" data-mode="view-only" data-item-id="${escapeHtml(itemIdStr)}" data-item-name="${escapeHtml(item.name)}" onclick="handleOrderReviewButtonClick(this)" title="View ratings & reviews" style="margin:0;">
                  ⭐ ${ratingScore} <span style="color:#78350f; font-weight:normal;">(${reviewCount})</span>
                </button>
                <button type="button" class="review-action-link" data-mode="view-only" data-item-id="${escapeHtml(itemIdStr)}" data-item-name="${escapeHtml(item.name)}" onclick="handleOrderReviewButtonClick(this)" title="View ratings & reviews" style="color:#fde047; text-shadow:0 1px 2px rgba(0,0,0,0.8);">
                  Reviews
                </button>
              </div>
            </div>
          </div>
          <div style="z-index:1; position:relative; margin-top:auto; padding-top:0.5rem;">
            <p class="food-desc" style="margin:0 0 0.4rem 0; font-size:0.83rem; color:#f1f5f9; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-shadow:0 1px 3px rgba(0,0,0,0.9);" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || 'Quality retail item from local store.')}</p>
            <div class="food-bottom" style="background:rgba(15,23,42,0.32); backdrop-filter:blur(2px); border:1px solid rgba(255,255,255,0.28); border-radius:10px; padding:0.55rem 0.75rem; margin-top:0;">
              <span class="food-price" style="color:#4ade80; font-weight:800; text-shadow:0 1px 3px rgba(0,0,0,0.85);">₹${Number(item.price).toFixed(2)}</span>
              ${isShopClosed
                ? `<button class="btn btn-outline btn-sm" disabled style="opacity:0.75; cursor:not-allowed; border-color:#f87171; color:#fca5a5;" title="Shop is closed and not taking orders">
                    Closed
                  </button>`
                : `<button class="btn btn-primary btn-sm" style="background:rgba(217,75,53,0.78); border:1px solid rgba(255,255,255,0.35);" onclick="addToCart('${item._id || item.id}', '${escapeHtml(item.name)}', ${Number(item.price)}, '${item.restaurantId}', 'shop')">
                    + Add to Cart
                  </button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join('');
    return;
  }

  // ==================== RESTAURANT DISHES RENDERING ====================
  if (mainCustomerTab === 'all_restaurants' && currentSelectedRestaurantId === 'all' && selectedCategory === 'all') {
    const { orderedAll, visitedIdSet, sameProductIdSet, featuredItemByRestId } = getOrderedRestaurantsByVisitAndProduct();

    const effectiveRestSearch = (searchVal || (typeof inlineRestaurantSearchQuery === 'string' ? inlineRestaurantSearchQuery.toLowerCase().trim() : ''));
    let filteredRests = orderedAll;
    if (effectiveRestSearch) {
      const searchVal = effectiveRestSearch;
      filteredRests = orderedAll.filter((r) => {
        const restId = String(r.id || r._id);
        const rName = (r.name || r.displayName || '').toLowerCase();
        const restItems = allMenuItems.filter((m) => String(m.restaurantId) === restId);
        const matchesItem = restItems.some(
          (m) =>
            (m.name || '').toLowerCase().includes(searchVal) ||
            (m.category || '').toLowerCase().includes(searchVal)
        );
        return rName.includes(searchVal) || matchesItem;
      });
    }

    if (!filteredRests.length) {
      grid.innerHTML = `<p style="color:var(--muted); padding:2rem; grid-column:1/-1; text-align:center;">No restaurants match your selection.</p>`;
      return;
    }

    grid.innerHTML = filteredRests
      .map((rest) => {
        const restId = String(rest.id || rest._id);
        const featuredItem = featuredItemByRestId.get(restId) || null;
        const badgeLabel = visitedIdSet.has(restId)
          ? '★ Visited Restaurant'
          : sameProductIdSet.has(restId)
            ? '✨ Sells Same Product'
            : '🏪 Restaurant';
        return renderRestaurantHistoryTileHtml(rest, featuredItem, badgeLabel);
      })
      .join('');
    return;
  }

  let filtered = allMenuItems;

  // 1. Primary tab filtering
  if (mainCustomerTab === 'all_restaurants') {
    if (currentSelectedRestaurantId !== 'all') {
      filtered = filtered.filter((m) => String(m.restaurantId) === String(currentSelectedRestaurantId));
    }
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(
        (m) => (m.category || 'Main Course').trim().toLowerCase() === selectedCategory.trim().toLowerCase()
      );
    }
  } else if (mainCustomerTab === 'all_menus') {
    if (selectedMenuItemId !== 'all') {
      filtered = filtered.filter((m) => String(m.id || m._id) === String(selectedMenuItemId));
    } else if (selectedCategory === 'veg') {
      filtered = filtered.filter((m) => m.dietary !== 'non-veg');
    } else if (selectedCategory === 'non-veg') {
      filtered = filtered.filter((m) => m.dietary === 'non-veg');
    }
  } else if (mainCustomerTab === 'category') {
    if (selectedCategory !== 'all') {
      filtered = filtered.filter((m) => (m.category || 'Main Course').toLowerCase() === selectedCategory.toLowerCase());
    }
  }

  // 2. Live dish search input filtering
  if (searchVal) {
    filtered = filtered.filter((m) =>
      m.name.toLowerCase().includes(searchVal) ||
      (m.description || '').toLowerCase().includes(searchVal) ||
      (m.category || '').toLowerCase().includes(searchVal)
    );
  }

  if (!filtered.length) {
    grid.innerHTML = `<p style="color:var(--muted); padding:2rem; grid-column:1/-1; text-align:center;">No dishes match your selection.</p>`;
    return;
  }

  let cardsHtml = filtered.map((item) => {
    const isNonVeg = item.dietary === 'non-veg';
    const matchRest = allRestaurants.find((r) => String(r.id || r._id) === String(item.restaurantId));
    const restDisplay = formatCleanName(
      matchRest?.name || matchRest?.displayName || item.restaurantName || 'Tomato Partner'
    );
    const isRestClosed = matchRest && (matchRest.isOpen === false || matchRest.isOnline === false);
    const itemIdStr = String(item._id || item.id || '');
    const ratingScore = item.rating ? Number(item.rating).toFixed(1) : 'New';
    const reviewCount = item.reviewCount || 0;

    const dietaryBadgeHtml = `<span style="display:inline-flex; align-items:center; gap:0.3rem; padding:0.2rem 0.5rem; border-radius:4px; font-size:0.7rem; font-weight:800; background:${isNonVeg ? 'rgba(254,226,226,0.95)' : 'rgba(220,252,231,0.95)'}; color:${isNonVeg ? '#b91c1c' : '#15803d'}; border:1.5px solid ${isNonVeg ? '#ef4444' : '#22c55e'}; box-shadow:0 2px 6px rgba(0,0,0,0.25);">
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${isNonVeg ? '#dc2626' : '#16a34a'};"></span>
      ${isNonVeg ? 'NON-VEG' : 'VEG'}
    </span>`;

    return `
      <div class="food-card full-image-item-tile" style="position:relative; overflow:hidden; min-height:225px; border-radius:14px; display:flex; flex-direction:column; justify-content:space-between; padding:1.1rem; color:#ffffff; border:1px solid ${isRestClosed ? '#fca5a5' : 'rgba(255,255,255,0.18)'}; background-color:#1e293b; box-shadow:0 8px 20px rgba(15,23,42,0.18); ${isRestClosed ? 'opacity:0.85;' : ''}">
        ${renderFullTileBackdropHtml(item.image)}
        <div style="z-index:1; position:relative;">
          <div class="food-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.65rem;">
            <div style="flex:1; min-width:0;">
              <h3 class="food-title" style="margin-bottom:0.3rem; background:rgba(15,23,42,0.32); color:#ffffff; border-color:rgba(255,255,255,0.28); border-left:3.5px solid #f87171; backdrop-filter:blur(2px); text-shadow:0 1px 3px rgba(0,0,0,0.85);">${escapeHtml(item.name)}</h3>
              <div class="food-meta" style="margin-bottom:0.35rem; font-weight:600; display:flex; flex-direction:column; align-items:flex-start; gap:0.22rem;">
                <span style="background:linear-gradient(135deg, rgba(30,58,138,0.52), rgba(29,78,216,0.52)); backdrop-filter:blur(2px); color:#ffffff; padding:0.12rem 0.5rem; border-radius:5px; border:1px solid rgba(96,165,250,0.65); font-weight:700; text-shadow:0 1px 2px rgba(0,0,0,0.8);">${escapeHtml(restDisplay)}</span>
                <span style="color:#1e3a8a; background:rgba(255,255,255,0.68); backdrop-filter:blur(2px); padding:0.08rem 0.45rem; border-radius:4px; font-weight:800;">${escapeHtml(item.category || 'Dish')}</span>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.3rem; flex-shrink:0;">
              <div style="display:flex; gap:0.35rem; align-items:center;">
                ${isRestClosed ? '<span class="badge" style="background:#ef4444; color:#ffffff; font-size:0.68rem; font-weight:800; padding:0.15rem 0.45rem; border-radius:4px;">CLOSED</span>' : ''}
                ${dietaryBadgeHtml}
              </div>
              <button type="button" class="review-rating-pill" data-mode="view-only" data-item-id="${escapeHtml(itemIdStr)}" data-item-name="${escapeHtml(item.name)}" onclick="handleOrderReviewButtonClick(this)" title="View ratings & reviews" style="margin:0;">
                ⭐ ${ratingScore} <span style="color:#78350f; font-weight:normal;">(${reviewCount})</span>
              </button>
              <button type="button" class="review-action-link" data-mode="view-only" data-item-id="${escapeHtml(itemIdStr)}" data-item-name="${escapeHtml(item.name)}" onclick="handleOrderReviewButtonClick(this)" title="View ratings & reviews" style="color:#fde047; text-shadow:0 1px 2px rgba(0,0,0,0.8);">
                Reviews
              </button>
            </div>
          </div>
        </div>
        <div style="z-index:1; position:relative; margin-top:auto; padding-top:0.5rem;">
          <p class="food-desc" style="margin:0 0 0.4rem 0; font-size:0.83rem; color:#f1f5f9; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-shadow:0 1px 3px rgba(0,0,0,0.9);" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || 'Deliciously prepared with authentic ingredients.')}</p>
          <div class="food-bottom" style="background:rgba(15,23,42,0.32); backdrop-filter:blur(2px); border:1px solid rgba(255,255,255,0.28); border-radius:10px; padding:0.55rem 0.75rem; margin-top:0;">
            <span class="food-price" style="color:#4ade80; font-weight:800; text-shadow:0 1px 3px rgba(0,0,0,0.85);">₹${Number(item.price).toFixed(2)}</span>
            ${isRestClosed
              ? `<button class="btn btn-outline btn-sm" disabled style="opacity:0.75; cursor:not-allowed; border-color:#f87171; color:#fca5a5;" title="Restaurant is closed and not taking orders">
                  Closed
                </button>`
              : `<button class="btn btn-primary btn-sm" style="background:rgba(217,75,53,0.78); border:1px solid rgba(255,255,255,0.35);" onclick="addToCart('${item._id || item.id}', '${escapeHtml(item.name)}', ${Number(item.price)}, '${item.restaurantId}', 'restaurant')">
                  + Add to Cart
                </button>`
            }
          </div>
        </div>
      </div>
    `;
  }).join('');

  // When a specific restaurant/category is selected under Restaurants, also show other restaurants selling the same product/category below
  if (mainCustomerTab === 'all_restaurants' && currentSelectedRestaurantId !== 'all') {
    const currentProductNames = new Set(filtered.map((m) => (m.name || '').trim().toLowerCase()).filter(Boolean));
    const currentCategories = new Set(
      filtered.map((m) => (m.category || 'Main Course').trim().toLowerCase()).filter(Boolean)
    );

    const matchingOtherRests = [];
    allRestaurants.forEach((r) => {
      const rId = String(r.id || r._id);
      if (rId === String(currentSelectedRestaurantId)) return;
      const rItems = allMenuItems.filter((m) => String(m.restaurantId) === rId);
      const matchedItem = rItems.find((m) => {
        const iName = (m.name || '').trim().toLowerCase();
        const iCat = (m.category || 'Main Course').trim().toLowerCase();
        return (
          (iName && currentProductNames.has(iName)) ||
          (iName && Array.from(currentProductNames).some((p) => p.length > 2 && (iName.includes(p) || p.includes(iName)))) ||
          (iCat && currentCategories.has(iCat))
        );
      });
      if (matchedItem) {
        matchingOtherRests.push({ rest: r, matchedItem });
      }
    });

    if (matchingOtherRests.length > 0) {
      cardsHtml += `
        <div style="grid-column:1/-1; margin-top:1rem; padding-top:0.85rem; border-top:1px dashed var(--border);">
          <div style="font-size:0.9rem; font-weight:700; color:var(--ink); margin-bottom:0.25rem;">
            🏪 Restaurants Selling Same Product / Category (${matchingOtherRests.length})
          </div>
        </div>
        ${matchingOtherRests
          .map(({ rest, matchedItem }) => renderRestaurantHistoryTileHtml(rest, matchedItem, '✨ Sells Same Product'))
          .join('')}
      `;
    }
  }

  grid.innerHTML = cardsHtml;
}

// Cart management
function addToCart(itemId, name, price, restaurantId, storeType = 'restaurant') {
  let isClosed = false;
  let storeName = 'Store';

  if (storeType === 'shop' || customerBrowseMode === 'shop') {
    storeType = 'shop';
    const shop = allShops.find((s) => String(s.id || s._id) === String(restaurantId));
    if (shop) {
      storeName = shop.name || 'Shop';
      if (isStoreBeyondCustomerRange(shop)) {
        if (typeof showRestaurantTooFarPopup === 'function') {
          showRestaurantTooFarPopup(storeName, shop.distanceKm);
        } else {
          alert('Shop is too far from you');
        }
        return;
      }
      if (shop.isOpen === false || shop.isOnline === false) isClosed = true;
    }
  } else {
    storeType = 'restaurant';
    const rest = allRestaurants.find((r) => String(r.id || r._id) === String(restaurantId));
    if (rest) {
      storeName = rest.name || 'Restaurant';
      if (isStoreBeyondCustomerRange(rest)) {
        if (typeof showRestaurantTooFarPopup === 'function') {
          showRestaurantTooFarPopup(storeName, rest.distanceKm);
        } else {
          alert('Restaurant is too far from you');
        }
        return;
      }
      if (rest.isOpen === false || rest.isOnline === false) isClosed = true;
    }
  }

  if (isClosed) {
    alert(`${storeName} is currently closed and not accepting orders.`);
    return;
  }

  // Multi-store conflict check
  if (cart.length && cart[0].restaurantId && restaurantId && cart[0].restaurantId !== restaurantId) {
    const currentStoreType = cart[0].storeType === 'shop' ? 'shop' : 'restaurant';
    const newStoreType = storeType === 'shop' ? 'shop' : 'restaurant';
    const confirmSwitch = window.confirm(
      `Your cart contains items from another ${currentStoreType}. Replace cart with items from this ${newStoreType}?`
    );
    if (confirmSwitch) {
      cart.length = 0;
      if (typeof resetAppliedCouponsState === 'function') resetAppliedCouponsState();
    } else {
      return;
    }
  }

  const sourceListForCat = storeType === 'shop' ? allShopItems : allMenuItems;
  const matchedItemForCat = sourceListForCat.find((m) => String(m.id || m._id) === String(itemId));
  const itemCategory = matchedItemForCat?.category || '';
  const existing = cart.find((i) => i.itemId === itemId);
  if (existing) {
    existing.quantity += 1;
    if (!existing.category && itemCategory) existing.category = itemCategory;
  } else {
    cart.push({ itemId, name, price, quantity: 1, restaurantId, storeType, category: itemCategory });
  }
  if (restaurantId) {
    recordVisitedItem(storeType === 'shop' ? 'shops' : 'restaurants', restaurantId);
  }
  if (itemId) {
    recordVisitedItem(storeType === 'shop' ? 'products' : 'menus', itemId);
  }
  const sourceList = storeType === 'shop' ? allShopItems : allMenuItems;
  const itemObj = sourceList.find((m) => String(m.id || m._id) === String(itemId));
  if (itemObj && itemObj.category) {
    recordVisitedItem(storeType === 'shop' ? 'shop_categories' : 'categories', itemObj.category);
  }
  updateCartUI();
}

function updateCartQuantity(itemId, delta) {
  const item = cart.find((i) => i.itemId === itemId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    const index = cart.indexOf(item);
    if (index > -1) cart.splice(index, 1);
  }
  updateCartUI();
}

function clearCart() {
  cart.length = 0;
  if (typeof resetAppliedCouponsState === 'function') resetAppliedCouponsState();
  updateCartUI();
}

function renderCartRowsHtml() {
  return cart.map((item) => `
    <div class="cart-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div style="font-size:0.75rem; color:var(--muted);">₹${item.price.toFixed(2)} each</div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="qty-btn" type="button" onclick="updateCartQuantity('${item.itemId}', -1)">-</button>
        <span style="font-weight:700; width:1.4rem; text-align:center;">${item.quantity}</span>
        <button class="qty-btn" type="button" onclick="updateCartQuantity('${item.itemId}', 1)">+</button>
      </div>
      <div style="font-weight:700; min-width:65px; text-align:right;">₹${(item.price * item.quantity).toFixed(2)}</div>
    </div>
  `).join('');
}

function updateCartUI() {
  const totalQty = cart.reduce((sum, i) => sum + i.quantity, 0);

  // Update Overview Cart Badges
  const overviewBadge = document.getElementById('overview-cart-badge');
  if (overviewBadge) {
    overviewBadge.textContent = String(totalQty);
  }
  const overviewToggleBadge = document.getElementById('overview-cart-toggle-badge');
  if (overviewToggleBadge) {
    overviewToggleBadge.textContent = String(totalQty);
  }
  const orderHeaderCartBadge = document.getElementById('order-header-cart-badge');
  if (orderHeaderCartBadge) {
    orderHeaderCartBadge.textContent = String(totalQty);
  }

  // Dynamically update header if cart view is active
  if (isCustomerCartViewActive) {
    const titleEl = document.getElementById('customer-browse-title');
    if (titleEl) {
      titleEl.textContent = `Item in your Cart : ${totalQty}`;
    }
  }

  if (!cart.length && typeof resetAppliedCouponsState === 'function') {
    resetAppliedCouponsState();
  }
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Number((subtotal * 0.05).toFixed(2));
  const discountAmt = typeof getActiveCartDiscountAmount === 'function' ? getActiveCartDiscountAmount(subtotal) : 0;
  const grandTotal = Number(Math.max(0, subtotal + tax + 40 - discountAmt).toFixed(2));
  const activeCodesLabel = (typeof appliedCouponCodes !== 'undefined' && appliedCouponCodes.length)
    ? `🎟️ Coupon (${appliedCouponCodes.join(' + ')})`
    : '🎟️ Coupon Discount';

  const defaultAddr = customerAddresses.find((a) => a.isDefault) || customerAddresses[0];
  const addrHtml = defaultAddr
    ? `<strong>${escapeHtml(defaultAddr.label)}</strong> (${escapeHtml(defaultAddr.line1)}, ${escapeHtml(defaultAddr.city)}) ${defaultAddr.isDefault ? '<span class="badge badge-delivered" style="padding:1px 5px; font-size:0.7rem;">Default</span>' : ''}`
    : 'Home (Click Addresses tab to add)';

  // Customer Order View Cart container (#customer-cart-view-container)
  const orderContainer = document.getElementById('order-cart-items-container');
  const orderEmptyMsg = document.getElementById('order-cart-empty-message');
  const orderFooter = document.getElementById('order-cart-footer-section');

  if (orderContainer || orderEmptyMsg || orderFooter) {
    if (!cart.length) {
      if (orderContainer) orderContainer.innerHTML = '';
      if (orderEmptyMsg) orderEmptyMsg.style.display = 'block';
      if (orderFooter) orderFooter.style.display = 'none';
    } else {
      if (orderEmptyMsg) orderEmptyMsg.style.display = 'none';
      if (orderFooter) orderFooter.style.display = 'block';
      if (orderContainer) orderContainer.innerHTML = renderCartRowsHtml();

      const orderSubtotalEl = document.getElementById('order-cart-subtotal');
      const orderTaxEl = document.getElementById('order-cart-tax');
      const orderGrandTotalEl = document.getElementById('order-cart-grand-total');
      const orderLabelEl = document.getElementById('order-cart-delivery-label');

      const orderDiscRow = document.getElementById('order-cart-discount-row');
      const orderDiscLabel = document.getElementById('order-cart-discount-label');
      const orderDiscVal = document.getElementById('order-cart-discount-val');
      if (orderDiscRow) orderDiscRow.style.display = discountAmt > 0 ? 'flex' : 'none';
      if (orderDiscLabel) orderDiscLabel.textContent = activeCodesLabel;
      if (orderDiscVal) orderDiscVal.textContent = `-₹${discountAmt.toFixed(2)}`;
      if (orderSubtotalEl) orderSubtotalEl.textContent = `₹${subtotal.toFixed(2)}`;
      if (orderTaxEl) orderTaxEl.textContent = `₹${tax.toFixed(2)}`;
      if (orderGrandTotalEl) orderGrandTotalEl.textContent = `₹${grandTotal.toFixed(2)}`;
      if (orderLabelEl) orderLabelEl.innerHTML = addrHtml;
    }
  }

  // Overview Cart drawer (#overview-cart-drawer) under Live Activity & Notifications (if present)
  const overviewDrawer = document.getElementById('overview-cart-drawer');
  const overviewContainer = document.getElementById('overview-cart-items-container');
  const overviewEmptyMsg = document.getElementById('overview-cart-empty-message');
  const overviewFooter = document.getElementById('overview-cart-footer-section');

  if (overviewDrawer && overviewDrawer.style.display !== 'none') {
    const overviewTitle = document.getElementById('overview-activity-title');
    if (overviewTitle) {
      overviewTitle.textContent = `Item in your Cart : ${totalQty}`;
    }
    const feed = document.getElementById('activity-feed');
    if (feed) feed.style.display = 'none';
    const paginationBar = document.getElementById('notif-pagination-container');
    if (paginationBar) paginationBar.style.display = 'none';
    const countBadge = document.getElementById('notif-count-badge');
    if (countBadge) countBadge.style.display = 'none';
    const refreshBtn = document.getElementById('overview-refresh-btn');
    if (refreshBtn) refreshBtn.style.display = 'inline-block';

    if (!cart.length) {
      if (overviewContainer) overviewContainer.innerHTML = '';
      if (overviewEmptyMsg) overviewEmptyMsg.style.display = 'block';
      if (overviewFooter) overviewFooter.style.display = 'none';
    } else {
      if (overviewEmptyMsg) overviewEmptyMsg.style.display = 'none';
      if (overviewFooter) overviewFooter.style.display = 'block';
      if (overviewContainer) overviewContainer.innerHTML = renderCartRowsHtml();

      const ovSubtotalEl = document.getElementById('overview-cart-subtotal');
      const ovTaxEl = document.getElementById('overview-cart-tax');
      const ovGrandTotalEl = document.getElementById('overview-cart-grand-total');
      const ovLabelEl = document.getElementById('overview-cart-delivery-label');

      const ovDiscRow = document.getElementById('overview-cart-discount-row');
      const ovDiscLabel = document.getElementById('overview-cart-discount-label');
      const ovDiscVal = document.getElementById('overview-cart-discount-val');
      if (ovDiscRow) ovDiscRow.style.display = discountAmt > 0 ? 'flex' : 'none';
      if (ovDiscLabel) ovDiscLabel.textContent = activeCodesLabel;
      if (ovDiscVal) ovDiscVal.textContent = `-₹${discountAmt.toFixed(2)}`;
      if (ovSubtotalEl) ovSubtotalEl.textContent = `₹${subtotal.toFixed(2)}`;
      if (ovTaxEl) ovTaxEl.textContent = `₹${tax.toFixed(2)}`;
      if (ovGrandTotalEl) ovGrandTotalEl.textContent = `₹${grandTotal.toFixed(2)}`;
      if (ovLabelEl) ovLabelEl.innerHTML = addrHtml;
    }
  }
  if (typeof saveCartToStorage === 'function') {
    saveCartToStorage();
  }
  if (typeof syncCartCouponsOnCartChange === 'function') {
    syncCartCouponsOnCartChange();
  }
}
const renderCart = updateCartUI;

function toggleCustomerOrderCart(forceOpen) {
  const cartContainer = document.getElementById('customer-cart-view-container');
  const browseWrapper = document.getElementById('customer-browse-menu-wrapper');
  const titleEl = document.getElementById('customer-browse-title');
  const subtitleEl = document.getElementById('customer-browse-subtitle');
  const topbarCartBtn = document.getElementById('topbar-cart-btn');

  const willOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !isCustomerCartViewActive;

  isCustomerCartViewActive = willOpen;

  if (cartContainer) {
    cartContainer.style.display = willOpen ? 'block' : 'none';
  }
  if (browseWrapper) {
    browseWrapper.style.display = willOpen ? 'none' : 'block';
  }
  if (topbarCartBtn) {
    topbarCartBtn.classList.toggle('active', willOpen);
  }

  const totalQty = cart.reduce((sum, i) => sum + i.quantity, 0);

  if (titleEl) {
    if (willOpen) {
      titleEl.textContent = `Item in your Cart : ${totalQty}`;
    } else {
      const isShop = customerBrowseMode === 'shop';
      titleEl.textContent = isShop ? 'Explore Shops & Products' : 'Explore Restaurants & Menus';
    }
  }
  if (subtitleEl) {
    if (willOpen) {
      subtitleEl.textContent = 'Review your selected items and proceed to checkout';
    } else {
      const isShop = customerBrowseMode === 'shop';
      subtitleEl.textContent = isShop
        ? 'Fresh groceries, daily essentials & retail items from local shops'
        : 'Fresh dishes prepared and delivered to your doorstep';
    }
  }

  if (willOpen) {
    // If customer addresses are not yet fetched, fetch them in background to populate address label
    if (role === 'customer' && (!customerAddresses || !customerAddresses.length)) {
      apiFetch('/api/customer/addresses')
        .then((data) => {
          customerAddresses = data.addresses || [];
          updateCartUI();
        })
        .catch(() => {});
    }

    if (cartContainer) {
      cartContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  updateCartUI();
}
window.toggleCustomerOrderCart = toggleCustomerOrderCart;

let overviewCustomerSubView = 'cart'; // 'cart' | 'notifications'
let overviewPartnerSubView = 'report'; // 'report' | 'notifications'
let overviewAdminSubView = 'report'; // 'report' | 'notifications'
let overviewRiderSubView = 'report'; // 'report' | 'notifications'
window.overviewRiderSubView = overviewRiderSubView;

function showOverviewCartView() {
  overviewCustomerSubView = 'cart';
  const drawer = document.getElementById('overview-cart-drawer');
  const feed = document.getElementById('activity-feed');
  const partnerReportContainer = document.getElementById('overview-partner-report-container');
  const adminReportContainer = document.getElementById('overview-admin-report-container');
  const riderReportContainer = document.getElementById('overview-rider-report-container');
  const paginationBar = document.getElementById('notif-pagination-container');
  const titleEl = document.getElementById('overview-activity-title');
  const countBadge = document.getElementById('notif-count-badge');
  const refreshBtn = document.getElementById('overview-refresh-btn');
  const cartBtn = document.getElementById('overview-cart-toggle-btn');
  const notifBtn = document.getElementById('overview-notif-btn');
  const notifIcon = document.getElementById('overview-notif-icon');
  const notifLabel = document.getElementById('overview-notif-label');
  const btn = document.getElementById('topbar-cart-btn');

  if (drawer) drawer.style.display = 'block';
  if (feed) feed.style.display = 'none';
  if (partnerReportContainer) partnerReportContainer.style.display = 'none';
  if (adminReportContainer) adminReportContainer.style.display = 'none';
  if (riderReportContainer) riderReportContainer.style.display = 'none';
  if (paginationBar) paginationBar.style.display = 'none';
  if (countBadge) countBadge.style.display = 'none';
  if (refreshBtn) refreshBtn.style.display = 'inline-block';

  if (cartBtn) {
    cartBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
    cartBtn.classList.add('active');
  }

  if (notifBtn) {
    notifBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
    notifBtn.classList.remove('active');
    if (notifIcon) notifIcon.textContent = '🔔';
    if (notifLabel) notifLabel.textContent = 'Notifications';
    notifBtn.title = 'View Live Activity & Notifications';
  }

  if (btn) {
    btn.classList.add('active');
  }

  const totalQty = cart.reduce((sum, i) => sum + i.quantity, 0);
  if (titleEl) {
    titleEl.textContent = `Item in your Cart : ${totalQty}`;
  }

  // Fetch customer addresses if needed
  if (role === 'customer' && (!customerAddresses || !customerAddresses.length)) {
    apiFetch('/api/customer/addresses')
      .then((data) => {
        customerAddresses = data.addresses || [];
        updateCartUI();
      })
      .catch(() => {});
  }

  updateCartUI();
}
window.showOverviewCartView = showOverviewCartView;

function showOverviewPartnerReportView() {
  overviewPartnerSubView = 'report';
  const reportContainer = document.getElementById('overview-partner-report-container');
  const adminReportContainer = document.getElementById('overview-admin-report-container');
  const riderReportContainer = document.getElementById('overview-rider-report-container');
  const drawer = document.getElementById('overview-cart-drawer');
  const feed = document.getElementById('activity-feed');
  const paginationBar = document.getElementById('notif-pagination-container');
  const titleEl = document.getElementById('overview-activity-title');
  const countBadge = document.getElementById('notif-count-badge');
  const refreshBtn = document.getElementById('overview-refresh-btn');
  const reportBtn = document.getElementById('partner-overview-report-btn');
  const notifBtn = document.getElementById('partner-overview-notif-btn');

  if (drawer) drawer.style.display = 'none';
  if (feed) feed.style.display = 'none';
  if (adminReportContainer) adminReportContainer.style.display = 'none';
  if (riderReportContainer) riderReportContainer.style.display = 'none';
  if (paginationBar) paginationBar.style.display = 'none';
  if (countBadge) countBadge.style.display = 'none';
  if (refreshBtn) refreshBtn.style.display = 'inline-block';
  if (reportContainer) reportContainer.style.display = 'block';

  if (reportBtn) {
    reportBtn.classList.add('active');
  }
  if (notifBtn) {
    notifBtn.classList.remove('active');
  }

  if (titleEl) {
    titleEl.textContent = role === 'shop' ? 'Shop Business & Sales Report' : 'Restaurant Business & Sales Report';
  }

  refreshPartnerReportData();
  loadNotifications();
}
window.showOverviewPartnerReportView = showOverviewPartnerReportView;

function showOverviewRiderReportView() {
  overviewRiderSubView = 'report';
  const riderReportContainer = document.getElementById('overview-rider-report-container');
  const partnerReportContainer = document.getElementById('overview-partner-report-container');
  const adminReportContainer = document.getElementById('overview-admin-report-container');
  const drawer = document.getElementById('overview-cart-drawer');
  const feed = document.getElementById('activity-feed');
  const paginationBar = document.getElementById('notif-pagination-container');
  const titleEl = document.getElementById('overview-activity-title');
  const countBadge = document.getElementById('notif-count-badge');
  const refreshBtn = document.getElementById('overview-refresh-btn');
  const reportBtn = document.getElementById('rider-overview-report-btn');
  const notifBtn = document.getElementById('rider-overview-notif-btn');

  if (drawer) drawer.style.display = 'none';
  if (feed) feed.style.display = 'none';
  if (partnerReportContainer) partnerReportContainer.style.display = 'none';
  if (adminReportContainer) adminReportContainer.style.display = 'none';
  if (paginationBar) paginationBar.style.display = 'none';
  if (countBadge) countBadge.style.display = 'none';
  if (refreshBtn) refreshBtn.style.display = 'inline-block';
  if (riderReportContainer) riderReportContainer.style.display = 'block';

  if (reportBtn) reportBtn.classList.add('active');
  if (notifBtn) notifBtn.classList.remove('active');

  if (titleEl) {
    titleEl.textContent = 'Rider Delivery & Collections Report';
  }

  if (typeof refreshRiderReportData === 'function') {
    refreshRiderReportData();
  }
  loadNotifications();
}
window.showOverviewRiderReportView = showOverviewRiderReportView;

function handleRiderOverviewNotifClick() {
  if (overviewRiderSubView === 'report') {
    showOverviewNotificationsView();
  } else {
    loadNotifications(1);
  }
}
window.handleRiderOverviewNotifClick = handleRiderOverviewNotifClick;

function handleRiderOverviewReportClick() {
  if (activeView !== 'overview') {
    switchView('overview');
  }
  showOverviewRiderReportView();
  const el = document.getElementById('overview-rider-report-container');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
window.handleRiderOverviewReportClick = handleRiderOverviewReportClick;

function showOverviewNotificationsView() {
  overviewCustomerSubView = 'notifications';
  overviewPartnerSubView = 'notifications';
  overviewAdminSubView = 'notifications';
  overviewRiderSubView = 'notifications';
  const reportContainer = document.getElementById('overview-partner-report-container');
  const adminReportContainer = document.getElementById('overview-admin-report-container');
  const riderReportContainer = document.getElementById('overview-rider-report-container');
  const drawer = document.getElementById('overview-cart-drawer');
  const feed = document.getElementById('activity-feed');
  const paginationBar = document.getElementById('notif-pagination-container');
  const titleEl = document.getElementById('overview-activity-title');
  const countBadge = document.getElementById('notif-count-badge');
  const refreshBtn = document.getElementById('overview-refresh-btn');
  const cartBtn = document.getElementById('overview-cart-toggle-btn');
  const notifBtn = document.getElementById('overview-notif-btn');
  const partnerReportBtn = document.getElementById('partner-overview-report-btn');
  const partnerNotifBtn = document.getElementById('partner-overview-notif-btn');
  const adminReportBtn = document.getElementById('admin-overview-report-btn');
  const adminNotifBtn = document.getElementById('admin-overview-notif-btn');
  const riderReportBtn = document.getElementById('rider-overview-report-btn');
  const riderNotifBtn = document.getElementById('rider-overview-notif-btn');
  const notifIcon = document.getElementById('overview-notif-icon');
  const notifLabel = document.getElementById('overview-notif-label');
  const btn = document.getElementById('topbar-cart-btn');

  if (reportContainer) reportContainer.style.display = 'none';
  if (adminReportContainer) adminReportContainer.style.display = 'none';
  if (riderReportContainer) riderReportContainer.style.display = 'none';
  if (drawer) drawer.style.display = 'none';
  if (feed) feed.style.display = 'block';
  if (countBadge) {
    countBadge.style.display = 'inline-block';
    countBadge.textContent = `${currentNotifications.length} ${currentNotifications.length === 1 ? 'Update' : 'Updates'}`;
  }
  if (refreshBtn) refreshBtn.style.display = 'inline-block';

  if (cartBtn) {
    cartBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
    cartBtn.classList.remove('active');
  }

  if (notifBtn) {
    notifBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
    notifBtn.classList.add('active');
    if (notifIcon) notifIcon.textContent = '🔔';
    if (notifLabel) notifLabel.textContent = 'Notifications';
    notifBtn.title = 'View Live Activity & Notifications';
  }

  if (partnerReportBtn) {
    partnerReportBtn.classList.remove('active');
  }
  if (partnerNotifBtn) {
    partnerNotifBtn.classList.add('active');
  }

  if (adminReportBtn) {
    adminReportBtn.classList.remove('active');
  }
  if (adminNotifBtn) {
    adminNotifBtn.classList.add('active');
  }

  if (riderReportBtn) {
    riderReportBtn.classList.remove('active');
  }
  if (riderNotifBtn) {
    riderNotifBtn.classList.add('active');
  }

  if (btn) {
    btn.classList.remove('active');
  }

  if (titleEl) {
    titleEl.textContent = 'Live Activity & Notifications';
  }

  const totalPages = Math.ceil(currentNotifications.length / NOTIFICATIONS_PER_PAGE);
  if (paginationBar) {
    paginationBar.style.display = totalPages > 1 ? 'flex' : 'none';
  }

  loadNotifications(1);
}
window.showOverviewNotificationsView = showOverviewNotificationsView;

function handleAdminOverviewNotifClick() {
  showOverviewNotificationsView();
}
window.handleAdminOverviewNotifClick = handleAdminOverviewNotifClick;

function handleAdminOverviewReportClick() {
  showOverviewAdminReportView();
}
window.handleAdminOverviewReportClick = handleAdminOverviewReportClick;

function showOverviewAdminReportView() {
  overviewAdminSubView = 'report';
  const adminReportContainer = document.getElementById('overview-admin-report-container');
  const partnerReportContainer = document.getElementById('overview-partner-report-container');
  const riderReportContainer = document.getElementById('overview-rider-report-container');
  const drawer = document.getElementById('overview-cart-drawer');
  const feed = document.getElementById('activity-feed');
  const paginationBar = document.getElementById('notif-pagination-container');
  const titleEl = document.getElementById('overview-activity-title');
  const countBadge = document.getElementById('notif-count-badge');
  const refreshBtn = document.getElementById('overview-refresh-btn');
  const adminReportBtn = document.getElementById('admin-overview-report-btn');
  const adminNotifBtn = document.getElementById('admin-overview-notif-btn');

  if (drawer) drawer.style.display = 'none';
  if (feed) feed.style.display = 'none';
  if (partnerReportContainer) partnerReportContainer.style.display = 'none';
  if (riderReportContainer) riderReportContainer.style.display = 'none';
  if (paginationBar) paginationBar.style.display = 'none';
  if (countBadge) countBadge.style.display = 'none';
  if (refreshBtn) refreshBtn.style.display = 'inline-block';
  if (adminReportContainer) adminReportContainer.style.display = 'block';

  if (adminReportBtn) adminReportBtn.classList.add('active');
  if (adminNotifBtn) adminNotifBtn.classList.remove('active');

  if (titleEl) {
    titleEl.textContent = 'Platform Business & Performance Report';
  }

  refreshAdminReportData();
}
window.showOverviewAdminReportView = showOverviewAdminReportView;

function handleOverviewNotifBtnClick() {
  if (overviewCustomerSubView === 'cart') {
    showOverviewNotificationsView();
  } else {
    showOverviewCartView();
  }
}
window.handleOverviewNotifBtnClick = handleOverviewNotifBtnClick;

function toggleOverviewCart(forceOpen) {
  if (typeof forceOpen === 'boolean') {
    if (forceOpen) {
      showOverviewCartView();
    } else {
      showOverviewNotificationsView();
    }
  } else {
    if (overviewCustomerSubView === 'cart') {
      showOverviewNotificationsView();
    } else {
      showOverviewCartView();
    }
  }
}
window.toggleOverviewCart = toggleOverviewCart;

function handleOverviewRefreshClick() {
  if (overviewCustomerSubView === 'cart' && role === 'customer') {
    updateCartUI();
  } else if (overviewPartnerSubView === 'report' && (role === 'restaurant' || role === 'shop')) {
    refreshPartnerReportData();
  } else if (overviewAdminSubView === 'report' && (role === 'admin' || role === 'subadmin')) {
    refreshAdminReportData();
  } else if (overviewRiderSubView === 'report' && role === 'deliveryPartner') {
    if (typeof refreshRiderReportData === 'function') {
      refreshRiderReportData();
    }
  } else {
    loadNotifications(1);
    if (role === 'admin' || role === 'subadmin') {
      loadRoleOverview();
    }
  }
}
window.handleOverviewRefreshClick = handleOverviewRefreshClick;

function handleHeaderCartClick() {
  if (activeView !== 'overview') {
    switchView('overview');
  }
  showOverviewCartView();
  const drawer = document.getElementById('overview-cart-drawer');
  if (drawer) {
    drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
window.handleHeaderCartClick = handleHeaderCartClick;
window.handleOrderHeaderCartClick = handleHeaderCartClick;

// =========================================================================
// PAYMENT GATEWAY & PLACE ORDER
// =========================================================================
async function populateCheckoutAddresses() {
  const container = document.getElementById('checkout-address-container');
  if (!container) return;

  // Ensure customer addresses are fresh
  if (!customerAddresses || customerAddresses.length === 0) {
    try {
      const data = await apiFetch('/api/customer/addresses');
      customerAddresses = data.addresses || [];
    } catch (e) {
      console.warn('Could not load customer addresses for checkout:', e);
    }
  }

  if (!customerAddresses || customerAddresses.length === 0) {
    container.innerHTML = `
      <div style="padding:0.6rem 0; color:var(--tomato); font-size:0.85rem;">
        ⚠️ You have no saved delivery addresses yet.
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="switchToAddressManagement()">+ Add Delivery Address Now</button>
    `;
    return;
  }

  container.innerHTML = `
    <select id="checkout-address-select" style="width:100%; padding:0.5rem; border:1px solid var(--line); border-radius:6px; font-size:0.85rem; margin-bottom:0.4rem; background:#fff;" onchange="handleCheckoutAddressChange()">
    </select>
    <div id="checkout-address-preview" style="font-size:0.82rem; color:var(--muted); background:#faf8f5; padding:0.5rem 0.7rem; border-radius:6px; line-height:1.4;">
    </div>
    <div id="checkout-default-prompt" style="margin-top:0.4rem;">
      <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; color:var(--muted); cursor:pointer;">
        <input type="checkbox" id="checkout-make-default" /> Set this address as my new default delivery address
      </label>
    </div>
  `;

  const sel = document.getElementById('checkout-address-select');
  const defaultAddr = customerAddresses.find((a) => a.isDefault) || customerAddresses[0];

  // Sort so default is at the top
  const sortedAddresses = [...customerAddresses].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));

  sel.innerHTML = sortedAddresses.map((a) => {
    const isSelected = defaultAddr && a._id === defaultAddr._id;
    return `<option value="${a._id}" ${isSelected ? 'selected' : ''}>${a.isDefault ? '⭐ [DEFAULT] ' : '📍 '}${escapeHtml(a.label || 'Home')}: ${escapeHtml(a.line1)}, ${escapeHtml(a.city)}</option>`;
  }).join('');

  updateCheckoutAddressPreview();
}

let cachedServiceablePincodes = [];
let cachedAdminZones = [];

function resolveFrontendAddressPincode(addr) {
  if (!addr) return '';
  const direct = String(addr.postalCode || addr.pincode || '').trim();
  const m1 = direct.match(/\b(\d{5,6})\b/);
  if (m1) return m1[1];

  if (addr.digipin) {
    const dPin = String(addr.digipin).trim().toUpperCase();
    const dgpPinMatch = dPin.match(/\b(\d{6})\b/);
    if (dgpPinMatch) return dgpPinMatch[1];
    if (dPin.includes('1857') || dPin.includes('7369')) return '411057';
    if (dPin.includes('2664') || dPin.includes('8490')) return '845401';
    if (dPin.includes('1297') || dPin.includes('7759')) return '560001';
  }

  let lat = null, lng = null;
  if (Array.isArray(addr.location?.coordinates) && addr.location.coordinates.length >= 2) {
    lng = Number(addr.location.coordinates[0]);
    lat = Number(addr.location.coordinates[1]);
  } else if (addr.lat && addr.lng) {
    lat = Number(addr.lat);
    lng = Number(addr.lng);
  }
  if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
    if (typeof calculateDistanceKm === 'function') {
      if (calculateDistanceKm(lat, lng, 18.5707, 73.6908) <= 25) return '411057';
      if (calculateDistanceKm(lat, lng, 26.6471, 84.9085) <= 25) return '845401';
      if (calculateDistanceKm(lat, lng, 12.9716, 77.5946) <= 25) return '560001';
    }
  }

  const combined = `${addr.line1 || ''} ${addr.line2 || ''} ${addr.city || ''}`;
  const m2 = combined.match(/\b(\d{5,6})\b/);
  return m2 ? m2[1] : '';
}

function isMatchingAdminZone(customerPin, storePin, adminZones) {
  if (!customerPin || !storePin) return false;
  const cPin = String(customerPin).trim();
  const sPin = String(storePin).trim();
  const zones = Array.isArray(adminZones) && adminZones.length > 0
    ? adminZones
    : (Array.isArray(window.cachedGlobalAdminZones) ? window.cachedGlobalAdminZones : []);

  if (zones.length > 0) {
    for (const adm of zones) {
      if (Array.isArray(adm.pincodes) && adm.pincodes.includes(cPin) && adm.pincodes.includes(sPin)) {
        return true;
      }
    }
    if (cPin === sPin) {
      for (const adm of zones) {
        if (Array.isArray(adm.pincodes) && adm.pincodes.includes(cPin)) {
          return true;
        }
      }
    }
    return false;
  }
  return cPin === sPin;
}

async function fetchCustomerServiceablePincodes() {
  try {
    const res = await apiFetch('/api/customer/serviceable-pincodes');
    if (Array.isArray(res.pincodes)) cachedServiceablePincodes = res.pincodes;
    if (Array.isArray(res.adminZones)) cachedAdminZones = res.adminZones;
  } catch (_) {}
  return cachedServiceablePincodes;
}

function resolveFrontendCoordinatesFromDigipin(digipin) {
  if (!digipin || typeof digipin !== 'string') return null;
  const clean = digipin.trim().toUpperCase();
  const dgpMatch = clean.match(/DGP-(\d{3,4})-(\d{3,4})/i);
  if (dgpMatch && dgpMatch[1] && dgpMatch[2]) {
    const latVal = parseInt(dgpMatch[1], 10) / 100;
    const lngVal = parseInt(dgpMatch[2], 10) / 100;
    if (!isNaN(latVal) && !isNaN(lngVal) && latVal > 0 && lngVal > 0) {
      return { lat: latVal, lng: lngVal };
    }
  }
  const pinMatch = clean.match(/\b\d{6}\b/);
  if (pinMatch) {
    return resolveFrontendCoordinatesFromPincode(pinMatch[0]);
  }
  return null;
}

function resolveFrontendCoordinatesFromPincode(pin) {
  if (!pin) return null;
  const clean = String(pin).trim();
  if (clean === '411057') return { lat: 18.5707, lng: 73.6908 };
  if (clean === '845401') return { lat: 26.6471, lng: 84.9085 };
  if (clean === '560001') return { lat: 12.9716, lng: 77.5946 };
  return null;
}

function getAddressCoordinates(addr) {
  if (!addr) return null;
  if (Array.isArray(addr.location?.coordinates) && addr.location.coordinates.length >= 2) {
    const lng = Number(addr.location.coordinates[0]);
    const lat = Number(addr.location.coordinates[1]);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) return { lat, lng };
  }
  if (addr.lat && addr.lng) {
    const lat = Number(addr.lat);
    const lng = Number(addr.lng);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }
  if (addr.digipin) {
    const dgp = resolveFrontendCoordinatesFromDigipin(addr.digipin);
    if (dgp) return dgp;
  }
  const pin = resolveFrontendAddressPincode(addr);
  return resolveFrontendCoordinatesFromPincode(pin);
}

function getStoreFrontendCoordinates(store) {
  if (!store) return null;
  if (store.location && typeof store.location.lat === 'number' && typeof store.location.lng === 'number') {
    return { lat: store.location.lat, lng: store.location.lng };
  }
  if (Array.isArray(store.location?.coordinates) && store.location.coordinates.length >= 2) {
    const lng = Number(store.location.coordinates[0]);
    const lat = Number(store.location.coordinates[1]);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) return { lat, lng };
  }
  if (store.digipin) {
    const dgp = resolveFrontendCoordinatesFromDigipin(store.digipin);
    if (dgp) return dgp;
  }
  const pin = store.pincode || store.postalCode || resolveFrontendAddressPincode({ line1: store.restaurantAddress || store.shopAddress || store.address || '' });
  return resolveFrontendCoordinatesFromPincode(pin);
}

function checkAddressDeliverableToStore(addr, store) {
  if (!addr) return { deliverable: false, reason: 'No address selected', distanceKm: null };
  const custPin = resolveFrontendAddressPincode(addr);
  const hasPinList = Array.isArray(cachedServiceablePincodes) && cachedServiceablePincodes.length > 0;
  if (hasPinList && (!custPin || !cachedServiceablePincodes.includes(custPin))) {
    return {
      deliverable: false,
      reason: `Pincode ${custPin || 'N/A'} is not in serviceable pincodes.`,
      distanceKm: null,
      custPin,
    };
  }

  if (store) {
    // 1. Distance Check (<= 15.0 km)
    const addrCoords = getAddressCoordinates(addr);
    const storeCoords = getStoreFrontendCoordinates(store);
    let distanceKm = null;
    if (addrCoords && storeCoords && typeof calculateDistanceKm === 'function') {
      distanceKm = Number(calculateDistanceKm(addrCoords.lat, addrCoords.lng, storeCoords.lat, storeCoords.lng).toFixed(2));
      if (distanceKm > 15.0) {
        return {
          deliverable: false,
          reason: `Distance (${distanceKm} km) exceeds maximum delivery radius of 15.0 km.`,
          distanceKm,
          custPin,
        };
      }
    }

    // 2. Admin Zone Match Check
    const storePin = store.pincode || store.postalCode || resolveFrontendAddressPincode({ line1: store.restaurantAddress || store.shopAddress || store.address || '' });
    if (storePin && custPin) {
      const isStoreAdminMatch = isMatchingAdminZone(custPin, storePin, cachedAdminZones);
      if (!isStoreAdminMatch) {
        return {
          deliverable: false,
          reason: `Selected address belongs to a different administrative delivery zone than ${store.name || 'this store'}.`,
          distanceKm,
          custPin,
        };
      }
    }
    return { deliverable: true, distanceKm, custPin };
  }

  return { deliverable: true, distanceKm: null, custPin };
}

function handleCheckoutAddressChange() {
  updateCheckoutAddressPreview({ isUserChange: true });
}
window.handleCheckoutAddressChange = handleCheckoutAddressChange;

function updateCheckoutAddressPreview(options = {}) {
  const isUserChange = Boolean(options && options.isUserChange);
  const select = document.getElementById('checkout-address-select');
  const preview = document.getElementById('checkout-address-preview');
  const defaultPrompt = document.getElementById('checkout-default-prompt');
  const makeDefaultCb = document.getElementById('checkout-make-default');
  if (!select || !preview) return;

  const selectedId = select.value;
  const addr = customerAddresses.find((a) => a._id === selectedId) || customerAddresses[0];

  if (!addr) {
    preview.innerHTML = '<span style="color:var(--muted);">No address selected</span>';
    return;
  }

  const isShop = cart[0]?.storeType === 'shop' || customerBrowseMode === 'shop';
  const store = cart.length > 0 && cart[0].restaurantId
    ? (isShop
        ? (Array.isArray(allShops) ? allShops.find((s) => String(s.id || s._id) === String(cart[0].restaurantId)) : null)
        : (Array.isArray(allRestaurants) ? allRestaurants.find((r) => String(r.id || r._id) === String(cart[0].restaurantId)) : null))
    : null;

  const status = checkAddressDeliverableToStore(addr, store);
  const isAreaDeliverable = status.deliverable;
  const custPin = status.custPin || resolveFrontendAddressPincode(addr);

  // If user changed the address in checkout dropdown and it is out of current restaurant deliverable range, popup alert
  if (!isAreaDeliverable && isUserChange) {
    if (typeof showDeliverableRangeAlert === 'function') {
      showDeliverableRangeAlert('your oder is out of deliverable range, please update your address', custPin, status.distanceKm);
    } else if (typeof showServiceableAreaPopup === 'function') {
      showServiceableAreaPopup(custPin, cachedServiceablePincodes, 'customer', 'your oder is out of deliverable range, please update your address');
    } else {
      alert("your oder is out of deliverable range, please update your address");
    }
  }

  preview.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.2rem; flex-wrap:wrap; gap:0.35rem;">
      <strong>📍 ${escapeHtml(addr.label || 'Home')}</strong>
      <div style="display:flex; gap:0.35rem; align-items:center;">
        ${!isAreaDeliverable
          ? `<span class="badge badge-blocked" style="padding:2px 7px; font-size:0.7rem;">✕ Out of Deliverable Range (${escapeHtml(custPin || 'No Pincode')})</span>`
          : ''}
        ${addr.isDefault ? '<span class="badge badge-delivered" style="padding:2px 7px; font-size:0.72rem;">✓ Default Address</span>' : '<span style="font-size:0.72rem; color:var(--muted);">Alternate Address</span>'}
      </div>
    </div>
    <div style="color:var(--ink);">${escapeHtml(addr.line1)}${addr.line2 ? ', ' + escapeHtml(addr.line2) : ''}, ${escapeHtml(addr.city)}, ${escapeHtml(addr.state || '')} - <strong>${escapeHtml(addr.postalCode || '')}</strong>${addr.digipin ? ` &nbsp;•&nbsp; <span style="display:inline-flex; align-items:center; background:#eff6ff; color:#1d4ed8; padding:0.1rem 0.4rem; border-radius:4px; font-weight:700; font-size:0.73rem; border:1px solid #bfdbfe;">📍 DigiPIN: ${escapeHtml(addr.digipin)}</span>` : ''}</div>
    <div style="margin-top:0.2rem; font-size:0.78rem; color:var(--muted);">📞 Delivery Contact: <strong>${escapeHtml(addr.phone || user.phone || 'N/A')}</strong></div>
    ${!isAreaDeliverable ? `<div style="margin-top:0.4rem; padding:0.4rem 0.6rem; border-radius:6px; background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; font-size:0.78rem; font-weight:600;">⚠️ your oder is out of deliverable range, please update your address</div>` : ''}
  `;

  if (defaultPrompt && makeDefaultCb) {
    defaultPrompt.style.display = addr.isDefault ? 'none' : 'block';
    makeDefaultCb.checked = false;
  }
}

function switchToAddressManagement() {
  closeModal('payment-gateway-modal');
  switchView('customer-address');
  showNewAddressForm();
}

let cachedPaymentConfig = null;

async function fetchPaymentConfig() {
  if (cachedPaymentConfig) return cachedPaymentConfig;
  try {
    const res = await apiFetch('/api/customer/payment/config');
    if (res && res.tomatoOfficialBank) {
      cachedPaymentConfig = res;
      const b = res.tomatoOfficialBank;
      const holderEl = document.getElementById('settle-holder');
      if (holderEl) holderEl.textContent = b.accountHolderName || 'Tomato Central Treasury';
      const bankEl = document.getElementById('settle-bank');
      if (bankEl) bankEl.textContent = `${b.bankName || 'HDFC Bank Ltd'} (${b.branch || 'Central Indiranagar'})`;
      const acEl = document.getElementById('settle-ac');
      if (acEl) acEl.textContent = b.accountNumber || '50200088991122';
      const ifscEl = document.getElementById('settle-ifsc');
      if (ifscEl) ifscEl.textContent = b.ifscCode || 'HDFC0000060';
      const upiEl = document.getElementById('settle-upi');
      if (upiEl) upiEl.textContent = b.upiId || 'tomato.official@hdfcbank';
    }
  } catch (err) {
    console.warn('Could not load payment config:', err);
  }
  return cachedPaymentConfig;
}

function copyTomatoOfficialUpi() {
  const upiText = document.getElementById('settle-upi')?.textContent?.trim() || 'tomato.official@hdfcbank';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(upiText).then(() => {
      alert(`Copied official Tomato Treasury UPI ID to clipboard:\n${upiText}\n\nYou can pay directly via Google Pay, PhonePe, Paytm, or BHIM.`);
    }).catch(() => {
      prompt('Copy Tomato official UPI ID:', upiText);
    });
  } else {
    prompt('Copy Tomato official UPI ID:', upiText);
  }
}
window.copyTomatoOfficialUpi = copyTomatoOfficialUpi;

function appendUpiHandle(handle) {
  const input = document.getElementById('gw-upi-id');
  if (!input) return;
  let val = input.value.trim();
  if (val.includes('@')) {
    val = val.split('@')[0];
  }
  input.value = (val ? val : (user?.phone || 'customer')) + handle;
  handleUpiInputChange();
}
window.appendUpiHandle = appendUpiHandle;

function handleUpiInputChange() {
  const input = document.getElementById('gw-upi-id');
  const statusEl = document.getElementById('gw-upi-format-status');
  if (!input || !statusEl) return;
  const val = input.value.trim();
  const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
  if (!val) {
    statusEl.textContent = 'e.g. name@okhdfcbank';
    statusEl.style.color = 'var(--muted)';
  } else if (upiRegex.test(val)) {
    statusEl.textContent = '✓ Valid UPI ID format';
    statusEl.style.color = '#15803d';
  } else {
    statusEl.textContent = '⚠ Must be username@bank';
    statusEl.style.color = '#dc2626';
  }
}
window.handleUpiInputChange = handleUpiInputChange;

function clientLuhnCheck(digits) {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function clientIdentifyCardBrand(digits) {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^(60|65|81|82|508)/.test(digits) || /^35(2[89]|[3-8][0-9])/.test(digits)) return 'RuPay';
  if (/^(50|5[6-8]|6\d)/.test(digits)) return 'Maestro';
  return 'Card';
}

function handleCardNumberInput(input) {
  const raw = input.value.replace(/\D/g, '').substring(0, 19);
  const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ');
  input.value = formatted;

  const preview = document.getElementById('gw-card-num-preview');
  if (preview) {
    if (raw.length === 0) {
      preview.textContent = '•••• •••• •••• ••••';
    } else {
      let padded = raw.padEnd(16, '•');
      preview.textContent = padded.substring(0, 19).replace(/(.{4})/g, '$1 ').trim();
    }
  }

  const brand = clientIdentifyCardBrand(raw);
  const brandDisplay = document.getElementById('gw-card-brand-display');
  if (brandDisplay) brandDisplay.textContent = brand.toUpperCase();

  const badge = document.getElementById('gw-card-validation-badge');
  if (badge) {
    if (raw.length < 13) {
      badge.textContent = `${raw.length}/16 digits`;
      badge.style.color = 'var(--muted)';
    } else if (clientLuhnCheck(raw)) {
      badge.textContent = `✓ Valid ${brand} Card`;
      badge.style.color = '#15803d';
    } else {
      badge.textContent = '⚠ Invalid Checksum (Luhn)';
      badge.style.color = '#dc2626';
    }
  }
}
window.handleCardNumberInput = handleCardNumberInput;

function handleCardExpiryInput(input) {
  let val = input.value.replace(/\D/g, '').substring(0, 4);
  if (val.length >= 2) {
    val = val.substring(0, 2) + '/' + val.substring(2);
  }
  input.value = val;

  const preview = document.getElementById('gw-card-exp-preview');
  if (preview) {
    preview.textContent = val || 'MM/YY';
  }
}
window.handleCardExpiryInput = handleCardExpiryInput;

function handleCardNameInput(input) {
  const preview = document.getElementById('gw-card-name-preview');
  if (preview) {
    preview.textContent = (input.value.trim() || user?.name || 'CUSTOMER NAME').toUpperCase();
  }
}
window.handleCardNameInput = handleCardNameInput;

function selectNetBankTile(bankCode, el) {
  document.querySelectorAll('.gateway-bank-tile').forEach((tile) => tile.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const sel = document.getElementById('gw-bank-select');
  if (sel) sel.value = bankCode;
}
window.selectNetBankTile = selectNetBankTile;

function handleNetBankDropdownChange(sel) {
  const val = sel.value;
  document.querySelectorAll('.gateway-bank-tile').forEach((tile) => {
    const tileText = tile.innerText || '';
    if (tileText.toUpperCase().includes(val.toUpperCase())) {
      tile.classList.add('selected');
    } else {
      tile.classList.remove('selected');
    }
  });
}
window.handleNetBankDropdownChange = handleNetBankDropdownChange;

function updateGatewayPayButtonText() {
  const payBtn = document.getElementById('gateway-pay-btn');
  if (!payBtn) return;
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Number((subtotal * 0.05).toFixed(2));
  const discountAmt = typeof getActiveCartDiscountAmount === 'function' ? getActiveCartDiscountAmount(subtotal) : 0;
  const totalAmount = Number(Math.max(1, subtotal + tax + 40 - discountAmt).toFixed(2));
  const amtStr = `₹${totalAmount.toFixed(2)}`;

  switch (selectedPaymentMethod) {
    case 'razorpay':
      payBtn.textContent = `Pay ${amtStr} via Razorpay ⚡`;
      break;
    case 'upi':
      payBtn.textContent = `Pay ${amtStr} via Tomato UPI 📱`;
      break;
    case 'card':
      payBtn.textContent = `Pay ${amtStr} via Card 💳`;
      break;
    case 'netbanking':
      payBtn.textContent = `Pay ${amtStr} via NetBanking 🏦`;
      break;
    case 'cod':
      payBtn.textContent = `Confirm Order (COD ${amtStr}) 💵`;
      break;
    default:
      payBtn.textContent = `Authorize & Pay ${amtStr}`;
  }
}
window.updateGatewayPayButtonText = updateGatewayPayButtonText;

async function openPaymentGatewayModal() {
  if (!cart.length) {
    alert('Please add at least one dish to the cart.');
    return;
  }

  document.getElementById('gateway-items-count').textContent = cart.reduce((sum, i) => sum + i.quantity, 0);
  await fetchCustomerAvailableCoupons();
  await validateAndSyncCartCoupons({ silent: true });
  updateGatewayBillingSummaryUI();
  await fetchCustomerServiceablePincodes();
  await populateCheckoutAddresses();

  // Load backend payment config and official Tomato Bank details
  await fetchPaymentConfig();

  // Calculate amount and set dynamic UPI QR Code
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Number((subtotal * 0.05).toFixed(2));
  const discountAmt = typeof getActiveCartDiscountAmount === 'function' ? getActiveCartDiscountAmount(subtotal) : 0;
  const totalAmount = Number(Math.max(1, subtotal + tax + 40 - discountAmt).toFixed(2));

  const officialUpi = cachedPaymentConfig?.tomatoOfficialBank?.upiId || 'tomato.official@hdfcbank';
  const officialPayee = cachedPaymentConfig?.tomatoOfficialBank?.accountHolderName || cachedPaymentConfig?.tomatoOfficialBank?.companyName || 'Tomato Official Treasury';
  const upiUrl = `upi://pay?pa=${encodeURIComponent(officialUpi)}&pn=${encodeURIComponent(officialPayee)}&am=${totalAmount.toFixed(2)}&cu=INR&tn=Order%20Payment`;
  const qrImg = document.getElementById('gw-dynamic-upi-qr');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(upiUrl)}`;
  }

  // Pre-fill card name & default preview if empty
  const cardNameInput = document.getElementById('gw-card-name');
  if (cardNameInput && !cardNameInput.value) {
    cardNameInput.value = (user?.name || 'Tomato Customer').toUpperCase();
    handleCardNameInput(cardNameInput);
  }

  // Default UPI input if empty
  const upiInput = document.getElementById('gw-upi-id');
  if (upiInput && !upiInput.value) {
    const handle = (user?.email ? user.email.split('@')[0] : (user?.phone || 'customer'));
    upiInput.value = `${handle}@okhdfcbank`;
    handleUpiInputChange();
  }

  // Ensure INR is always default selected for payment when user is paying via Razorpay
  const curSelect = document.getElementById('razorpay-currency-select');
  if (curSelect) {
    curSelect.value = 'INR';
  }

  switchGatewayTab(selectedPaymentMethod || 'razorpay');
  openModal('payment-gateway-modal');
}
window.openPaymentGatewayModal = openPaymentGatewayModal;

function handleRazorpayCurrencyChange(curr) {
  updateGatewayPayButtonText();
}
window.handleRazorpayCurrencyChange = handleRazorpayCurrencyChange;

function switchGatewayTab(tab) {
  selectedPaymentMethod = tab;
  document.querySelectorAll('.gateway-tab').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.gateway-panel').forEach((p) => p.classList.remove('active'));

  const tabButtons = document.querySelectorAll('.gateway-tab');
  tabButtons.forEach((b) => {
    if (b.getAttribute('onclick')?.includes(`'${tab}'`)) {
      b.classList.add('active');
    }
  });

  const panel = document.getElementById(`tab-${tab}`);
  if (panel) panel.classList.add('active');

  updateGatewayPayButtonText();
}
window.switchGatewayTab = switchGatewayTab;

async function placeOrderAfterPayment(txnId, method, chosenAddr) {
  const isShopOrder = cart[0]?.storeType === 'shop' || customerBrowseMode === 'shop';
  const deliveryAddress = {
    label: chosenAddr.label || 'Home',
    phone: chosenAddr.phone || user?.phone || '9523654737',
    line1: chosenAddr.line1,
    line2: chosenAddr.line2 || '',
    city: chosenAddr.city,
    state: chosenAddr.state || '',
    postalCode: chosenAddr.postalCode || '',
    digipin: chosenAddr.digipin || '',
    coordinates: chosenAddr.location?.coordinates || [77.5946, 12.9716],
  };

  const orderPayload = {
    restaurantId: cart[0]?.restaurantId,
    shopId: cart[0]?.restaurantId,
    isShopOrder,
    storeType: isShopOrder ? 'shop' : 'restaurant',
    items: cart.map((i) => ({
      foodItemId: i.itemId,
      name: i.name,
      quantity: i.quantity,
      price: i.price,
      category: i.category || '',
    })),
    couponCodes: Array.isArray(appliedCouponCodes) ? appliedCouponCodes.slice(0, 1) : [],
    paymentMethod: method,
    paymentTransactionId: txnId,
    addressId: chosenAddr._id,
    deliveryAddress,
  };

  const orderRes = await apiFetch('/api/customer/orders', {
    method: 'POST',
    body: JSON.stringify(orderPayload),
  });

  clearCart();
  closeModal('payment-gateway-modal');
  const storeLabel = isShopOrder ? '🏪 Shop Order' : '🍽️ Restaurant Order';
  const discountLine = orderRes.order?.discountAmount > 0
    ? `\nCoupon Savings: -₹${Number(orderRes.order.discountAmount).toFixed(2)} (${(orderRes.order.couponCodes || []).join(', ')})`
    : '';

  const bankInfo = cachedPaymentConfig?.tomatoOfficialBank;
  const officialBankName = bankInfo?.bankName || 'HDFC Bank Limited';
  const officialAcNum = bankInfo?.accountNumber || '50200088991122';

  const settlementNotice = method === 'cod'
    ? '\nDoorstep Collection: Physical Cash / Doorstep QR upon delivery.'
    : `\nOfficial Inflow: Credited directly to Tomato Treasury (${officialBankName} A/c ${officialAcNum}).`;

  alert(`🎉 ${storeLabel} Placed Successfully!\n\nOrder Number: ${orderRes.order.orderNumber}${discountLine}\nFinal Paid: ₹${Number(orderRes.order.totalAmount || 0).toFixed(2)}\nDelivering To: ${chosenAddr.label} (${chosenAddr.line1}, ${chosenAddr.city})\nPayment Mode: ${method.toUpperCase()}\nTransaction Ref: ${txnId}${settlementNotice}`);

  switchView('customer-orders');
}

async function executePaymentAndOrder() {
  const payBtn = document.getElementById('gateway-pay-btn');
  const loadingEl = document.getElementById('gateway-loading');
  const loadingText = document.getElementById('gateway-loading-text');

  // Resolve Delivery Address
  const selectedAddrId = document.getElementById('checkout-address-select')?.value;
  let chosenAddr = customerAddresses.find((a) => a._id === selectedAddrId);
  if (!chosenAddr) {
    chosenAddr = customerAddresses.find((a) => a.isDefault) || customerAddresses[0];
  }

  if (!chosenAddr) {
    alert('Please add a delivery address before placing your order.');
    switchToAddressManagement();
    return;
  }

  // Enforce Admin Serviceable Location & Zone Matching Checks
  const activePincodes = await fetchCustomerServiceablePincodes();
  const defaultAddr = customerAddresses.find((a) => a.isDefault) || customerAddresses[0];
  const defaultPincode = defaultAddr ? resolveFrontendAddressPincode(defaultAddr) : (user?.pincode || '');
  const custPincode = resolveFrontendAddressPincode(chosenAddr) || defaultPincode;

  const isShop = cart[0]?.storeType === 'shop' || customerBrowseMode === 'shop';
  const store = cart.length > 0 && cart[0].restaurantId
    ? (isShop
        ? (Array.isArray(allShops) ? allShops.find((s) => String(s.id || s._id) === String(cart[0].restaurantId)) : null)
        : (Array.isArray(allRestaurants) ? allRestaurants.find((r) => String(r.id || r._id) === String(cart[0].restaurantId)) : null))
    : null;

  // Deliverable range check
  const deliverableStatus = checkAddressDeliverableToStore(chosenAddr, store);
  if (!deliverableStatus.deliverable) {
    if (typeof showDeliverableRangeAlert === 'function') {
      showDeliverableRangeAlert('your oder is out of deliverable range, please update your address', custPincode, deliverableStatus.distanceKm);
    } else if (typeof showServiceableAreaPopup === 'function') {
      showServiceableAreaPopup(custPincode || defaultPincode || 'Not Set', activePincodes, 'customer', 'your oder is out of deliverable range, please update your address');
    } else {
      alert("your oder is out of deliverable range, please update your address");
    }
    return;
  }

  const makeDefaultChecked = document.getElementById('checkout-make-default')?.checked;
  if (makeDefaultChecked && !chosenAddr.isDefault) {
    try {
      await apiFetch(`/api/customer/addresses/${chosenAddr._id}/default`, { method: 'POST' });
      chosenAddr.isDefault = true;
      customerAddresses.forEach((a) => a.isDefault = (a._id === chosenAddr._id));
    } catch (err) {
      console.warn('Could not update default address flag:', err);
    }
  }

  if (Array.isArray(appliedCouponCodes) && appliedCouponCodes.length > 0) {
    const couponCheck = await validateAndSyncCartCoupons({ silent: false });
    if (!couponCheck.valid) {
      return;
    }
  }
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Number((subtotal * 0.05).toFixed(2));
  const discountAmt = typeof getActiveCartDiscountAmount === 'function' ? getActiveCartDiscountAmount(subtotal) : 0;
  const totalAmount = Number(Math.max(1, subtotal + tax + 40 - discountAmt).toFixed(2));

  // 1. Razorpay Payment Gateway Flow
  if (selectedPaymentMethod === 'razorpay') {
    if (typeof window.Razorpay === 'undefined') {
      alert('Razorpay Checkout SDK is still loading. Please check your network connection and try again.');
      return;
    }

    payBtn.disabled = true;
    loadingEl.style.display = 'block';
    if (loadingText) loadingText.innerText = 'Creating Razorpay payment order...';

    try {
      const rzpOrderRes = await apiFetch('/api/customer/payment/razorpay/order', {
        method: 'POST',
        body: JSON.stringify({ amount: totalAmount }),
      });

      if (!rzpOrderRes.success || !rzpOrderRes.orderId) {
        throw new Error(rzpOrderRes.message || 'Unable to initiate Razorpay order');
      }

      const selectedCurrency = document.getElementById('razorpay-currency-select')?.value || 'INR';

      const options = {
        key: rzpOrderRes.keyId || 'rzp_test_TjUFioCQLtVxJn',
        amount: rzpOrderRes.amount,
        currency: 'INR',
        display_currency: selectedCurrency,
        display_amount: selectedCurrency === 'INR' ? totalAmount : undefined,
        name: 'Tomato Technologies Treasury',
        description: `Order Payment (${selectedCurrency === 'INR' ? '₹' : ''}${totalAmount.toFixed(2)}${selectedCurrency !== 'INR' ? ' ' + selectedCurrency : ''})`,
        image: 'https://cdn-icons-png.flaticon.com/512/3075/3075977.png',
        order_id: rzpOrderRes.orderId,
        notes: {
          preferred_currency: selectedCurrency,
          default_currency: 'INR',
        },
        handler: async function (response) {
          try {
            loadingEl.style.display = 'block';
            if (loadingText) loadingText.innerText = 'Verifying Razorpay payment signature & crediting Tomato Treasury...';
            const verifyRes = await apiFetch('/api/customer/payment/razorpay/verify', {
              method: 'POST',
              body: JSON.stringify(response),
            });

            if (!verifyRes.verified) {
              alert('Razorpay payment verification failed: ' + (verifyRes.message || 'Signature mismatch'));
              payBtn.disabled = false;
              loadingEl.style.display = 'none';
              return;
            }

            if (loadingText) loadingText.innerText = 'Payment verified! Finalizing order into Tomato Treasury...';
            await placeOrderAfterPayment(response.razorpay_payment_id, 'razorpay', chosenAddr);
          } catch (err) {
            alert('Payment verification error: ' + err.message);
            payBtn.disabled = false;
            loadingEl.style.display = 'none';
          }
        },
        prefill: {
          name: user?.name || 'Tomato Customer',
          email: user?.email || 'customer@tomato.com',
          contact: chosenAddr.phone || user?.phone || '9523654737',
        },
        theme: {
          color: '#e23744',
        },
        modal: {
          ondismiss: function () {
            payBtn.disabled = false;
            loadingEl.style.display = 'none';
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (resp) {
        alert('Payment Failed: ' + (resp.error?.description || 'Transaction declined'));
        payBtn.disabled = false;
        loadingEl.style.display = 'none';
      });
      rzp.open();
    } catch (err) {
      alert('Razorpay Error: ' + err.message);
      payBtn.disabled = false;
      loadingEl.style.display = 'none';
    }
    return;
  }

  // Client-side validations for Direct methods
  if (selectedPaymentMethod === 'card') {
    const rawCard = (document.getElementById('gw-card-num')?.value || '').replace(/\D/g, '');
    if (rawCard.length < 13 || rawCard.length > 19) {
      alert('Please enter a valid card number between 13 and 19 digits.');
      document.getElementById('gw-card-num')?.focus();
      return;
    }
    if (!clientLuhnCheck(rawCard)) {
      alert('Card number failed Luhn Mod-10 checksum validation. Please check the digits.');
      document.getElementById('gw-card-num')?.focus();
      return;
    }
    const expVal = (document.getElementById('gw-card-exp')?.value || '').trim();
    const expMatch = expVal.match(/^(\d{2})\/(\d{2})$/);
    if (!expMatch) {
      alert('Please enter a valid expiration date in MM/YY format (e.g. 12/28).');
      document.getElementById('gw-card-exp')?.focus();
      return;
    }
    const expMonth = parseInt(expMatch[1], 10);
    const expYear = 2000 + parseInt(expMatch[2], 10);
    const now = new Date();
    if (expMonth < 1 || expMonth > 12) {
      alert('Card expiry month must be between 01 and 12.');
      document.getElementById('gw-card-exp')?.focus();
      return;
    }
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < (now.getMonth() + 1))) {
      alert('Card has expired. Please use an active card.');
      document.getElementById('gw-card-exp')?.focus();
      return;
    }
    const cvvVal = (document.getElementById('gw-card-cvv')?.value || '').trim();
    if (!/^\d{3,4}$/.test(cvvVal)) {
      alert('Please enter a valid 3 or 4-digit CVV security code.');
      document.getElementById('gw-card-cvv')?.focus();
      return;
    }
    const nameVal = (document.getElementById('gw-card-name')?.value || '').trim();
    if (nameVal.length < 2) {
      alert('Please enter the cardholder name.');
      document.getElementById('gw-card-name')?.focus();
      return;
    }
  } else if (selectedPaymentMethod === 'upi') {
    const upiVal = (document.getElementById('gw-upi-id')?.value || '').trim();
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
    if (!upiRegex.test(upiVal)) {
      alert('Please enter a valid Virtual Payment Address (UPI ID) in the format username@bank (e.g. name@okhdfcbank).');
      document.getElementById('gw-upi-id')?.focus();
      return;
    }
  } else if (selectedPaymentMethod === 'netbanking') {
    const bankVal = document.getElementById('gw-bank-select')?.value;
    if (!bankVal) {
      alert('Please select a bank for NetBanking authorization.');
      return;
    }
  }

  // Direct Gateway / COD Execution Flow
  payBtn.disabled = true;
  loadingEl.style.display = 'block';
  if (loadingText) {
    loadingText.innerText = selectedPaymentMethod === 'cod'
      ? 'Registering Cash on Delivery order...'
      : 'Authorizing direct settlement to Tomato Official Bank Account...';
  }

  try {
    let txnId = 'COD-PAY-ON-DELIVERY';
    if (selectedPaymentMethod !== 'cod') {
      const paymentPayload = {
        amount: totalAmount,
        paymentMethod: selectedPaymentMethod,
        cardDetails: {
          number: document.getElementById('gw-card-num')?.value || '',
          exp: document.getElementById('gw-card-exp')?.value || '',
          cvv: document.getElementById('gw-card-cvv')?.value || '',
          name: document.getElementById('gw-card-name')?.value || user?.name || 'Cardholder',
        },
        upiId: document.getElementById('gw-upi-id')?.value || '',
        bankCode: document.getElementById('gw-bank-select')?.value || 'HDFC',
        utrReference: document.getElementById('gw-upi-utr')?.value || '',
      };

      const payRes = await apiFetch('/api/customer/payment/process', {
        method: 'POST',
        body: JSON.stringify(paymentPayload),
      });
      txnId = payRes.transactionId;
    }

    await placeOrderAfterPayment(txnId, selectedPaymentMethod, chosenAddr);
  } catch (e) {
    if (e.message && (e.message.toLowerCase().includes('servicable range') || e.message.toLowerCase().includes('deliverable range') || e.code === 'AREA_OUT_OF_SERVICEABLE_RANGE' || e.code === 'ADMIN_ZONE_MISMATCH' || e.code === 'STORE_OUT_OF_SERVICEABLE_RANGE')) {
      if (typeof showDeliverableRangeAlert === 'function') {
        showDeliverableRangeAlert('your oder is out of deliverable range, please update your address', custPincode);
      } else if (typeof showServiceableAreaPopup === 'function') {
        showServiceableAreaPopup(custPincode || defaultPincode || 'Not Set', activePincodes, 'customer', 'your oder is out of deliverable range, please update your address');
      } else {
        alert("your oder is out of deliverable range, please update your address");
      }
    } else if (typeof showRestaurantTooFarPopup === 'function' && (e.code === 'STORE_TOO_FAR' || (e.message && e.message.toLowerCase().includes('too far from you')))) {
      if (typeof showDeliverableRangeAlert === 'function') {
        showDeliverableRangeAlert('your oder is out of deliverable range, please update your address', custPincode, e.distanceKm);
      } else {
        showRestaurantTooFarPopup(cart[0]?.name || (cart[0]?.storeType === 'shop' ? 'Shop' : 'Restaurant'), e.distanceKm);
      }
    } else {
      alert(`Payment & Order Error: ${e.message}`);
    }
  } finally {
    payBtn.disabled = false;
    loadingEl.style.display = 'none';
  }
}
window.executePaymentAndOrder = executePaymentAndOrder;

// =========================================================================
// CUSTOMER: ORDERS & TRACKING
// =========================================================================
let currentCustomerOrderFilter = 'all';
let cachedCustomerOrders = [];

function setCustomerOrdersFilter(filter) {
  currentCustomerOrderFilter = filter || 'all';
  updateCustomerFilterButtons();
  if (cachedCustomerOrders && cachedCustomerOrders.length) {
    renderCustomerOrdersList(cachedCustomerOrders);
  } else {
    fetchCustomerOrders();
  }
}
window.setCustomerOrdersFilter = setCustomerOrdersFilter;

function updateCustomerFilterButtons() {
  const allBtn = document.getElementById('cust-filter-all');
  const activeBtn = document.getElementById('cust-filter-active');
  const completedBtn = document.getElementById('cust-filter-completed');
  const indicator = document.getElementById('cust-filter-indicator');

  if (allBtn) allBtn.classList.toggle('active', currentCustomerOrderFilter === 'all');
  if (activeBtn) activeBtn.classList.toggle('active', currentCustomerOrderFilter === 'active');
  if (completedBtn) completedBtn.classList.toggle('active', currentCustomerOrderFilter === 'completed');

  if (indicator) {
    if (currentCustomerOrderFilter === 'active') {
      indicator.style.display = 'inline-block';
      indicator.innerHTML = 'Showing: <strong style="color:var(--ink);">Active Orders in Progress</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setCustomerOrdersFilter(\'all\')">Show All</button>';
    } else if (currentCustomerOrderFilter === 'completed') {
      indicator.style.display = 'inline-block';
      indicator.innerHTML = 'Showing: <strong style="color:var(--ink);">Delivered &amp; Past Orders</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setCustomerOrdersFilter(\'all\')">Show All</button>';
    } else {
      indicator.style.display = 'none';
    }
  }
}
window.updateCustomerFilterButtons = updateCustomerFilterButtons;

function renderCustomerOrdersList(orders) {
  const container = document.getElementById('customer-orders-list');
  if (!container) return;

  updateCustomerFilterButtons();

  if (!orders || !orders.length) {
    container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">You have not placed any orders yet. Visit Order Online to select delicious meals or fresh shop products!</p>';
    return;
  }

  const filtered = orders.filter((o) => {
    const status = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
    const isDeliveredOrCancelled = status === 'delivered' || status === 'cancelled';
    if (currentCustomerOrderFilter === 'active') {
      return !isDeliveredOrCancelled;
    }
    if (currentCustomerOrderFilter === 'completed') {
      return isDeliveredOrCancelled;
    }
    return true;
  });

  if (!filtered.length) {
    const msg = currentCustomerOrderFilter === 'active'
      ? 'No active orders in progress right now. All your orders are completed or delivered!'
      : currentCustomerOrderFilter === 'completed'
      ? 'No completed orders found.'
      : 'No orders found matching the selected filter.';
    container.innerHTML = `
      <div style="padding:1.5rem 1rem; text-align:center; color:var(--muted);">
        <p style="margin-bottom:0.8rem; font-size:0.95rem;">${msg}</p>
        <button class="btn btn-outline btn-sm" onclick="setCustomerOrdersFilter('all')">Show All Orders</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((o) => {
    const isShop = o.storeType === 'shop' || (o.orderNumber && String(o.orderNumber).startsWith('SHOP-')) || !!o.shopName;
    const steps = [
      { key: 'placed', label: 'Placed' },
      { key: 'accepted', label: 'Accepted' },
      { key: 'preparing', label: isShop ? 'Packing' : 'Cooking' },
      { key: 'out_for_delivery', label: 'On Route' },
      { key: 'delivered', label: 'Delivered' },
    ];

    const currentIdx = steps.findIndex((s) => s.key === o.status);
    const cleanRestName = formatCleanName(o.restaurantName || 'Tomato Kitchen');
    const restIdForReview = String(o.restaurantId || '');
    const storeTitle = isShop
      ? `🏪 Shop: <strong>${escapeHtml(formatCleanName(o.shopName || o.restaurantName || 'Retail Shop'))}</strong>`
      : `🍽️ Restaurant: <strong>${escapeHtml(cleanRestName)}</strong>${
          o.status !== 'cancelled'
            ? ` <button type="button" class="btn-rate-item" data-rest-id="${escapeHtml(restIdForReview)}" data-rest-name="${escapeHtml(cleanRestName)}" onclick="handleRestaurantReviewButtonClick(this)" title="Rate & Review this restaurant" style="margin-left:0.35rem;">⭐ Review Restaurant</button>`
            : ''
        }`;

    return `
      <div style="border:1px solid var(--line); border-radius:10px; padding:1.2rem; margin-bottom:1.2rem; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.8rem;">
          <div>
            <h3 style="font-size:1.1rem; margin-bottom:0.2rem;">Order #${escapeHtml(o.orderNumber || '')}</h3>
            <div style="font-size:0.8rem; color:var(--muted);">
              ${storeTitle}
              ${o.digipin ? `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.72rem; margin-left:0.3rem;">📍 DIGIPIN: ${escapeHtml(o.digipin)}</span>` : ''}
              ${o.riderName ? ` • 🚴 Rider: <strong style="color:var(--ink);">${escapeHtml(o.riderName)}</strong>` : ''}
              • ${new Date(o.createdAt).toLocaleString()}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span class="badge badge-${escapeHtml(o.status || '')}">${escapeHtml(String(o.status || '').replace(/_/g, ' '))}</span>
            ${!['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase()) ? `
              <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'customer')">📍 Live Tracking</button>
            ` : ''}
            <button class="btn btn-outline btn-sm" onclick="viewOrderBill('${o._id}')">🧾 View Bill</button>
          </div>
        </div>

        <!-- Tracker -->
        ${o.status !== 'cancelled' ? `
          <div class="order-tracker">
            ${steps.map((st, i) => `
              <div class="track-step ${i < currentIdx ? 'done' : i === currentIdx ? 'current' : ''}">
                <div class="track-node">${i < currentIdx ? '✓' : i + 1}</div>
                <div class="track-label">${st.label}</div>
              </div>
            `).join('')}
          </div>
        ` : '<div style="padding:0.6rem; color:var(--tomato-dark); font-weight:600;">This order was cancelled.</div>'}

        <div style="display:flex; justify-content:space-between; align-items:flex-start; padding-top:0.8rem; border-top:1px dashed var(--line); font-size:0.85rem; flex-wrap:wrap; gap:0.6rem;">
          <div style="flex:1; min-width:240px;">
            <div style="font-weight:600; color:var(--muted); font-size:0.8rem; margin-bottom:0.35rem;">Ordered Items:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
              ${(o.items || []).map((i) => {
                const rawId = String(i.foodItemId || i._id || i.id || '');
                const match = (allMenuItems || []).find(m => String(m._id || m.id) === rawId || (m.name && m.name.toLowerCase() === (i.name || '').toLowerCase()))
                  || (allShopItems || []).find(s => String(s._id || s.id) === rawId || (s.name && s.name.toLowerCase() === (i.name || '').toLowerCase()));
                const itmId = match ? String(match._id || match.id) : rawId;
                const canRate = o.status !== 'cancelled';
                return `
                  <span style="display:inline-flex; align-items:center; gap:0.4rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:0.25rem 0.55rem; font-size:0.82rem;">
                    <span><strong>${escapeHtml(i.name)}</strong> × ${i.quantity}</span>
                    ${canRate ? `
                      <button type="button" class="btn-rate-item" data-mode="write" data-item-id="${escapeHtml(itmId)}" data-item-name="${escapeHtml(i.name)}" onclick="handleOrderReviewButtonClick(this)" title="Rate & Review this product">
                        ⭐ Review
                      </button>
                    ` : ''}
                  </span>
                `;
              }).join('')}
            </div>
          </div>
          <div style="text-align:right;">
            <div>Payment: <strong style="text-transform:uppercase;">${escapeHtml(o.paymentMethod || 'COD')} (${escapeHtml(o.paymentStatus || 'pending')})</strong></div>
            <div>Total: <strong style="font-size:1.05rem; color:var(--green);">₹${Number(o.totalAmount).toFixed(2)}</strong></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
window.renderCustomerOrdersList = renderCustomerOrdersList;

function handleOrderReviewButtonClick(btn) {
  if (!btn) return;
  const itemId = btn.getAttribute('data-item-id') || '';
  const itemName = btn.getAttribute('data-item-name') || '';
  const mode = btn.getAttribute('data-mode') || 'write';
  openProductReviewsModal(itemId, itemName, mode);
}
window.handleOrderReviewButtonClick = handleOrderReviewButtonClick;

function handleRestaurantReviewButtonClick(btn) {
  if (!btn) return;
  const restId = btn.getAttribute('data-rest-id') || '';
  const restName = btn.getAttribute('data-rest-name') || '';
  openRestaurantReviewsModal(restId, restName);
}
window.handleRestaurantReviewButtonClick = handleRestaurantReviewButtonClick;

// =========================================================================
// PRODUCT & RESTAURANT REVIEWS & RATINGS SYSTEM
// =========================================================================
let currentReviewTargetType = 'item'; // 'item' | 'restaurant'
let currentReviewItemId = null;
let currentReviewItemName = '';
let currentReviewMode = 'write';
let currentSelectedStar = 5;
let hasExistingReview = false;
let savedReviewRating = null;
let savedReviewComment = '';

const STAR_CAPTIONS = {
  1: '1 Star - Poor',
  2: '2 Stars - Fair',
  3: '3 Stars - Good',
  4: '4 Stars - Very Good',
  5: '5 Stars - Excellent'
};

function checkReviewFormChanges() {
  const submitBtn = document.getElementById('btn-submit-review');
  const commentInput = document.getElementById('review-comment-input');
  if (!submitBtn) return;

  // If not eligible (cannot review), keep disabled
  const notEligibleAlert = document.getElementById('review-not-eligible-alert');
  if (notEligibleAlert && notEligibleAlert.style.display !== 'none') {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
    submitBtn.title =
      currentReviewTargetType === 'restaurant'
        ? 'You can only review restaurants you have purchased from.'
        : 'You can only review items you have ordered in the past.';
    return;
  }

  const currentComment = (commentInput ? commentInput.value : '').trim();
  const currentRating = Number(currentSelectedStar || 5);

  if (hasExistingReview) {
    const isRatingChanged = currentRating !== savedReviewRating;
    const isCommentChanged = currentComment !== savedReviewComment;

    if (isRatingChanged || isCommentChanged) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      submitBtn.textContent = 'Update Review';
      submitBtn.title = 'Click to submit your updated rating or review';
    } else {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.5';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.textContent = 'Review Submitted';
      submitBtn.title = 'Change your rating or review to enable updating';
    }
  } else {
    // Brand new review - enabled for verified buyers
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
    submitBtn.textContent = 'Submit Review';
    submitBtn.title = '';
  }
}
window.checkReviewFormChanges = checkReviewFormChanges;

function setStarRatingInput(rating, triggerCheck = true) {
  currentSelectedStar = Math.min(5, Math.max(1, Number(rating) || 5));
  const hiddenInput = document.getElementById('review-star-value');
  if (hiddenInput) hiddenInput.value = currentSelectedStar;

  const starGroup = document.getElementById('interactive-star-group');
  if (starGroup) {
    const stars = starGroup.querySelectorAll('.star-btn');
    stars.forEach((star) => {
      const val = Number(star.getAttribute('data-val'));
      if (val <= currentSelectedStar) {
        star.classList.add('active');
      } else {
        star.classList.remove('active');
      }
    });
  }

  const captionEl = document.getElementById('review-star-caption');
  if (captionEl) {
    captionEl.textContent = STAR_CAPTIONS[currentSelectedStar] || `${currentSelectedStar} Stars`;
  }

  if (triggerCheck) {
    checkReviewFormChanges();
  }
}
window.setStarRatingInput = setStarRatingInput;

async function openRestaurantReviewsModal(restId, fallbackName = '') {
  currentReviewTargetType = 'restaurant';
  currentReviewItemName = fallbackName || '';
  currentReviewMode = 'write';

  // If restId is empty, try to match from allRestaurants by name
  if ((!restId || restId === 'undefined' || restId === 'null') && fallbackName) {
    const match = (allRestaurants || []).find(
      (r) =>
        formatCleanName(r.name || r.displayName || '').toLowerCase() ===
        formatCleanName(fallbackName).toLowerCase()
    );
    if (match) {
      restId = String(match.id || match._id);
    }
  }

  currentReviewItemId = restId || '';

  const formContainer = document.getElementById('review-form-container');
  const viewOnlyHint = document.getElementById('review-view-only-hint');
  if (formContainer) formContainer.style.display = 'block';
  if (viewOnlyHint) viewOnlyHint.style.display = 'none';

  openModal('product-reviews-modal');
  const modalEl = document.getElementById('product-reviews-modal');
  if (modalEl) {
    modalEl.classList.add('visible');
    modalEl.style.display = 'grid';
    modalEl.style.zIndex = '999995';
  }

  const prodNameEl = document.getElementById('review-modal-product-name');
  const storeNameEl = document.getElementById('review-modal-store-name');
  const avgScoreEl = document.getElementById('review-modal-avg-score');
  const starsDisplayEl = document.getElementById('review-modal-stars-display');
  const totalCountEl = document.getElementById('review-modal-total-count');
  const reviewsContainer = document.getElementById('product-reviews-list-container');
  const reviewCountBadge = document.getElementById('review-list-count-badge');
  const hiddenItemId = document.getElementById('review-item-id');
  const commentInput = document.getElementById('review-comment-input');
  const statusMsgEl = document.getElementById('review-form-status-msg');
  const headingEl = document.getElementById('review-form-heading');
  const submitBtn = document.getElementById('btn-submit-review');
  const notEligibleAlert = document.getElementById('review-not-eligible-alert');
  const verifiedOrderPill = document.getElementById('review-verified-order-pill');
  const verifiedOrderNum = document.getElementById('review-verified-order-num');

  if (hiddenItemId) hiddenItemId.value = restId || '';
  if (prodNameEl) prodNameEl.textContent = formatCleanName(fallbackName) || 'Restaurant Reviews';
  if (storeNameEl) storeNameEl.textContent = 'Rating is the average of all item average ratings...';
  if (avgScoreEl) avgScoreEl.textContent = '--';
  if (starsDisplayEl) starsDisplayEl.textContent = '☆☆☆☆☆';
  if (totalCountEl) totalCountEl.textContent = 'Loading reviews...';
  if (commentInput) {
    commentInput.value = '';
    commentInput.placeholder =
      'Share your experience with this restaurant (food quality, service, packaging)...';
  }
  if (statusMsgEl) statusMsgEl.textContent = '';
  if (notEligibleAlert) {
    notEligibleAlert.style.display = 'none';
    notEligibleAlert.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.2rem;">🔒 Verified Purchase Required</div>
      <div>Only customers who have purchased from this specific restaurant can give a review to this restaurant.</div>
    `;
  }
  if (verifiedOrderPill) verifiedOrderPill.style.display = 'none';
  if (reviewsContainer) {
    reviewsContainer.innerHTML =
      '<p style="color:var(--muted); font-size:0.85rem; text-align:center; padding:1.5rem 0;">Loading verified customer reviews for this restaurant...</p>';
  }

  hasExistingReview = false;
  savedReviewRating = null;
  savedReviewComment = '';
  setStarRatingInput(5, false);

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.textContent = 'Loading...';
  }

  try {
    const queryParam = fallbackName ? `?name=${encodeURIComponent(formatCleanName(fallbackName))}` : '';
    const targetUrl = `/api/customer/restaurants/${encodeURIComponent(restId || 'by-name')}/reviews${queryParam}`;
    const res = await apiFetch(targetUrl);

    const restInfo = res.restaurant || {};
    const reviews = res.reviews || [];
    const totalReviews = res.totalReviews != null ? res.totalReviews : reviews.length;

    // Calculate average of each rated item's average rating from local menu items or backend response
    const localRestItems = (allMenuItems || []).filter(
      (m) => String(m.restaurantId) === String(restInfo._id || restId)
    );
    const localRatedItems = localRestItems.filter((m) => m.rating != null && Number(m.rating) > 0);
    const localAvgOfItemAvgs =
      localRatedItems.length > 0
        ? localRatedItems.reduce((sum, m) => sum + Number(m.rating), 0) / localRatedItems.length
        : null;

    const effectiveAvg =
      localAvgOfItemAvgs != null
        ? localAvgOfItemAvgs
        : res.averageRating != null
          ? Number(res.averageRating)
          : null;
    const avgRatingStr = effectiveAvg != null ? Number(effectiveAvg).toFixed(1) : null;

    const canReview = res.canReview;
    const userReview = res.userReview;
    const verifiedOrder = res.verifiedOrder;

    if (restInfo._id) {
      currentReviewItemId = String(restInfo._id);
      if (hiddenItemId) hiddenItemId.value = String(restInfo._id);
    }
    if (restInfo.name) {
      currentReviewItemName = formatCleanName(restInfo.name);
    }

    if (prodNameEl) {
      prodNameEl.textContent = `🏪 ${formatCleanName(restInfo.name || fallbackName || 'Restaurant')}`;
    }
    if (storeNameEl) {
      const ratedCnt = localRatedItems.length || res.ratedItemsCount || 0;
      storeNameEl.textContent =
        ratedCnt > 0
          ? `Rating averaged across ${ratedCnt} rated menu ${ratedCnt === 1 ? 'item' : 'items'} • ${restInfo.cuisine || 'Restaurant'}`
          : `${restInfo.cuisine || 'Verified Tomato Restaurant'} • Average of item ratings`;
    }

    if (avgScoreEl) avgScoreEl.textContent = avgRatingStr ? avgRatingStr : 'New';
    if (starsDisplayEl) {
      if (avgRatingStr) {
        const fullStars = Math.round(Number(avgRatingStr));
        starsDisplayEl.textContent = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);
      } else {
        starsDisplayEl.textContent = '☆☆☆☆☆';
      }
    }
    if (totalCountEl) {
      totalCountEl.textContent = `${totalReviews} verified ${totalReviews === 1 ? 'review' : 'reviews'}`;
    }
    if (reviewCountBadge) reviewCountBadge.textContent = totalReviews;

    if (!canReview) {
      if (notEligibleAlert) notEligibleAlert.style.display = 'block';
      if (verifiedOrderPill) verifiedOrderPill.style.display = 'none';
      if (headingEl) headingEl.textContent = 'Review This Restaurant';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
        submitBtn.title = 'Only customers who have purchased from this restaurant can give a review.';
      }
      if (commentInput) commentInput.disabled = true;
    } else {
      if (notEligibleAlert) notEligibleAlert.style.display = 'none';
      if (verifiedOrderPill) {
        verifiedOrderPill.style.display = 'inline-block';
        if (verifiedOrderNum) {
          verifiedOrderNum.textContent = verifiedOrder?.orderNumber
            ? `#${verifiedOrder.orderNumber}`
            : 'Verified';
        }
      }
      if (commentInput) commentInput.disabled = false;

      if (userReview) {
        hasExistingReview = true;
        savedReviewRating = Number(userReview.rating) || 5;
        savedReviewComment = (userReview.comment || '').trim();

        if (headingEl) headingEl.textContent = 'Update Your Restaurant Review';
        setStarRatingInput(savedReviewRating, false);
        if (commentInput) commentInput.value = userReview.comment || '';
        if (statusMsgEl) {
          statusMsgEl.innerHTML = `<span style="color:#059669;">✓ You previously reviewed this restaurant on ${new Date(userReview.updatedAt || userReview.createdAt).toLocaleDateString()}</span>`;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
          submitBtn.style.cursor = 'not-allowed';
          submitBtn.textContent = 'Review Submitted';
          submitBtn.title = 'Change your rating or review to enable updating';
        }
      } else {
        hasExistingReview = false;
        savedReviewRating = null;
        savedReviewComment = '';

        if (headingEl) headingEl.textContent = 'Write a Review for This Restaurant';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.style.cursor = 'pointer';
          submitBtn.textContent = 'Submit Review';
          submitBtn.title = '';
        }
      }
    }

    if (!reviews.length) {
      reviewsContainer.innerHTML = `
        <div style="background:#fff; border:1px dashed #cbd5e1; border-radius:8px; padding:1.5rem; text-align:center; color:var(--muted); font-size:0.85rem;">
          No reviews yet for this restaurant. ${canReview ? 'Be the first verified customer to share your review!' : 'Purchase from this restaurant to be the first to review it!'}
        </div>
      `;
    } else {
      reviewsContainer.innerHTML = reviews
        .map((r) => {
          const starsStr = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));
          const reviewDate = new Date(r.updatedAt || r.createdAt || Date.now()).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
          const isEdited =
            r.updatedAt &&
            r.createdAt &&
            new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime() > 2000;
          const isCurrentUser = userReview && String(r._id) === String(userReview._id);
          const itemTagHtml =
            !r.isRestaurantReview && r.productName
              ? `<span style="font-size:0.7rem; background:#f1f5f9; color:#334155; padding:0.1rem 0.45rem; border-radius:4px; font-weight:600;">🍽️ ${escapeHtml(r.productName)}</span>`
              : `<span style="font-size:0.7rem; background:#eff6ff; color:#1e3a8a; padding:0.1rem 0.45rem; border-radius:4px; font-weight:700;">🏪 Restaurant Review</span>`;

          return `
            <div class="review-item-card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.35rem; flex-wrap:wrap; gap:0.4rem;">
                <div>
                  <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                    <strong style="font-size:0.9rem; color:var(--ink);">${escapeHtml(r.customerName || 'Customer')}</strong>
                    ${isCurrentUser ? '<span style="font-size:0.7rem; background:#dbeafe; color:#1d4ed8; padding:0.1rem 0.4rem; border-radius:4px; font-weight:700;">YOU</span>' : ''}
                    <span class="review-verified-tag">✓ Verified Purchase</span>
                    ${itemTagHtml}
                  </div>
                  ${r.orderNumber ? `<div style="font-size:0.72rem; color:var(--muted);">Order #${escapeHtml(r.orderNumber)}</div>` : ''}
                </div>
                <div style="text-align:right;">
                  <div style="color:#f59e0b; font-size:0.95rem; letter-spacing:1px;">${starsStr}</div>
                  <div style="font-size:0.72rem; color:var(--muted);">${reviewDate}${isEdited ? ' <span style="font-size:0.68rem; color:#64748b; font-style:italic;">(updated)</span>' : ''}</div>
                </div>
              </div>
              <p style="font-size:0.85rem; color:#334155; margin:0.3rem 0 0; line-height:1.45;">
                ${r.comment ? escapeHtml(r.comment) : '<em style="color:var(--muted);">No written comments provided.</em>'}
              </p>
            </div>
          `;
        })
        .join('');
    }
  } catch (err) {
    console.error('Failed to load restaurant reviews:', err);
    if (reviewsContainer) {
      reviewsContainer.innerHTML = `<p style="color:#ef4444; font-size:0.85rem; text-align:center; padding:1rem 0;">Error loading restaurant reviews: ${escapeHtml(err.message || 'Server error')}</p>`;
    }
  }
}
window.openRestaurantReviewsModal = openRestaurantReviewsModal;

async function openProductReviewsModal(itemId, fallbackName = '', mode = 'write') {
  currentReviewTargetType = 'item';
  currentReviewItemName = fallbackName || '';
  currentReviewMode = mode || 'write';

  // Toggle View-Only vs Write Review form based on mode
  const formContainer = document.getElementById('review-form-container');
  const viewOnlyHint = document.getElementById('review-view-only-hint');
  if (currentReviewMode === 'view-only') {
    if (formContainer) formContainer.style.display = 'none';
    if (viewOnlyHint) viewOnlyHint.style.display = 'flex';
  } else {
    if (formContainer) formContainer.style.display = 'block';
    if (viewOnlyHint) viewOnlyHint.style.display = 'none';
  }

  // If itemId is empty or invalid, try to match by name from catalog
  if ((!itemId || itemId === 'undefined' || itemId === 'null') && fallbackName) {
    const match = (allMenuItems || []).find(m => m.name && m.name.toLowerCase() === fallbackName.toLowerCase())
      || (allShopItems || []).find(s => s.name && s.name.toLowerCase() === fallbackName.toLowerCase());
    if (match) {
      itemId = String(match._id || match.id);
    }
  }

  currentReviewItemId = itemId || '';
  openModal('product-reviews-modal');
  const modalEl = document.getElementById('product-reviews-modal');
  if (modalEl) {
    modalEl.classList.add('visible');
    modalEl.style.display = 'grid';
    modalEl.style.zIndex = '999995';
  }

  // Reset fields
  const prodNameEl = document.getElementById('review-modal-product-name');
  const storeNameEl = document.getElementById('review-modal-store-name');
  const avgScoreEl = document.getElementById('review-modal-avg-score');
  const starsDisplayEl = document.getElementById('review-modal-stars-display');
  const totalCountEl = document.getElementById('review-modal-total-count');
  const reviewsContainer = document.getElementById('product-reviews-list-container');
  const reviewCountBadge = document.getElementById('review-list-count-badge');
  const hiddenItemId = document.getElementById('review-item-id');
  const commentInput = document.getElementById('review-comment-input');
  const statusMsgEl = document.getElementById('review-form-status-msg');
  const headingEl = document.getElementById('review-form-heading');
  const submitBtn = document.getElementById('btn-submit-review');
  const notEligibleAlert = document.getElementById('review-not-eligible-alert');
  const verifiedOrderPill = document.getElementById('review-verified-order-pill');
  const verifiedOrderNum = document.getElementById('review-verified-order-num');

  if (hiddenItemId) hiddenItemId.value = itemId || '';
  if (prodNameEl) prodNameEl.textContent = fallbackName || 'Loading Product...';
  if (storeNameEl) storeNameEl.textContent = 'Fetching details & verified customer reviews...';
  if (avgScoreEl) avgScoreEl.textContent = '--';
  if (starsDisplayEl) starsDisplayEl.textContent = '☆☆☆☆☆';
  if (totalCountEl) totalCountEl.textContent = 'Loading reviews...';
  if (commentInput) {
    commentInput.value = '';
    commentInput.placeholder = 'Share your experience regarding taste, freshness, packaging, or quality...';
  }
  if (statusMsgEl) statusMsgEl.textContent = '';
  if (notEligibleAlert) {
    notEligibleAlert.style.display = 'none';
    notEligibleAlert.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.2rem;">🔒 Verified Purchase Required</div>
      <div>Only customers who have ordered this item in the past can write a review. Order it today to share your experience!</div>
    `;
  }
  if (verifiedOrderPill) verifiedOrderPill.style.display = 'none';
  if (reviewsContainer) {
    reviewsContainer.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; text-align:center; padding:1.5rem 0;">Loading reviews from verified customers...</p>';
  }

  hasExistingReview = false;
  savedReviewRating = null;
  savedReviewComment = '';
  setStarRatingInput(5, false);

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.textContent = 'Loading...';
  }

  try {
    const queryParam = fallbackName ? `?name=${encodeURIComponent(fallbackName)}` : '';
    const targetUrl = (itemId && itemId !== 'undefined')
      ? `/api/customer/items/${encodeURIComponent(itemId)}/reviews${queryParam}`
      : `/api/customer/items/by-name/reviews${queryParam}`;

    const res = await apiFetch(targetUrl);
    const item = res.item || {};
    const reviews = res.reviews || [];
    const totalReviews = res.totalReviews || reviews.length;
    const avgRating = res.averageRating != null ? Number(res.averageRating).toFixed(1) : null;
    const canReview = res.canReview;
    const userReview = res.userReview;
    const verifiedOrder = res.verifiedOrder;

    if (item._id) {
      currentReviewItemId = String(item._id);
      if (hiddenItemId) hiddenItemId.value = String(item._id);
    }
    if (item.name) {
      currentReviewItemName = item.name;
    }

    if (prodNameEl) prodNameEl.textContent = item.name || fallbackName || 'Product Reviews';
    if (storeNameEl) {
      const storeTitle = item.restaurantName || (item.category ? `${item.category}` : 'Verified Tomato Partner');
      storeNameEl.textContent = `${storeTitle} • ₹${Number(item.price || 0).toFixed(2)}`;
    }

    if (avgScoreEl) avgScoreEl.textContent = avgRating ? avgRating : 'New';
    if (starsDisplayEl) {
      if (avgRating) {
        const fullStars = Math.round(Number(avgRating));
        starsDisplayEl.textContent = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);
      } else {
        starsDisplayEl.textContent = '☆☆☆☆☆';
      }
    }
    if (totalCountEl) {
      totalCountEl.textContent = `${totalReviews} verified ${totalReviews === 1 ? 'review' : 'reviews'}`;
    }
    if (reviewCountBadge) reviewCountBadge.textContent = totalReviews;

    // Configure review form ONLY when mode is 'write'
    if (currentReviewMode === 'write') {
      if (!canReview) {
        if (notEligibleAlert) notEligibleAlert.style.display = 'block';
        if (verifiedOrderPill) verifiedOrderPill.style.display = 'none';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
          submitBtn.style.cursor = 'not-allowed';
          submitBtn.title = 'You can only review items you have ordered in the past.';
        }
        if (commentInput) commentInput.disabled = true;
      } else {
        if (notEligibleAlert) notEligibleAlert.style.display = 'none';
        if (verifiedOrderPill) {
          verifiedOrderPill.style.display = 'inline-block';
          if (verifiedOrderNum) verifiedOrderNum.textContent = verifiedOrder?.orderNumber ? `#${verifiedOrder.orderNumber}` : 'Verified';
        }
        if (commentInput) commentInput.disabled = false;

        // If user already wrote a review, populate their past review and disable submit until they change it!
        if (userReview) {
          hasExistingReview = true;
          savedReviewRating = Number(userReview.rating) || 5;
          savedReviewComment = (userReview.comment || '').trim();

          if (headingEl) headingEl.textContent = 'Update Your Review';
          setStarRatingInput(savedReviewRating, false);
          if (commentInput) commentInput.value = userReview.comment || '';
          if (statusMsgEl) {
            statusMsgEl.innerHTML = `<span style="color:#059669;">✓ You previously reviewed this item on ${new Date(userReview.updatedAt || userReview.createdAt).toLocaleDateString()}</span>`;
          }

          // Explicitly disable submit button until user modifies rating or comment
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';
            submitBtn.textContent = 'Review Submitted';
            submitBtn.title = 'Change your rating or review to enable updating';
          }
        } else {
          hasExistingReview = false;
          savedReviewRating = null;
          savedReviewComment = '';

          if (headingEl) headingEl.textContent = 'Write a Review';
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
            submitBtn.textContent = 'Submit Review';
            submitBtn.title = '';
          }
        }
      }
    }

    // Render reviews list
    if (!reviews.length) {
      reviewsContainer.innerHTML = `
        <div style="background:#fff; border:1px dashed #cbd5e1; border-radius:8px; padding:1.5rem; text-align:center; color:var(--muted); font-size:0.85rem;">
          No reviews yet for this product. ${canReview ? 'Be the first verified customer to share your thoughts!' : 'Order this product to be the first to review it!'}
        </div>
      `;
    } else {
      reviewsContainer.innerHTML = reviews.map((r) => {
        const starsStr = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));
        const reviewDate = new Date(r.updatedAt || r.createdAt || Date.now()).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        const isEdited = r.updatedAt && r.createdAt && (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime() > 2000);
        const isCurrentUser = userReview && String(r._id) === String(userReview._id);

        return `
          <div class="review-item-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.35rem; flex-wrap:wrap; gap:0.4rem;">
              <div>
                <div style="display:flex; align-items:center; gap:0.4rem;">
                  <strong style="font-size:0.9rem; color:var(--ink);">${escapeHtml(r.customerName || 'Customer')}</strong>
                  ${isCurrentUser ? '<span style="font-size:0.7rem; background:#dbeafe; color:#1d4ed8; padding:0.1rem 0.4rem; border-radius:4px; font-weight:700;">YOU</span>' : ''}
                  <span class="review-verified-tag">✓ Verified Purchase</span>
                </div>
                ${r.orderNumber ? `<div style="font-size:0.72rem; color:var(--muted);">Order #${escapeHtml(r.orderNumber)}</div>` : ''}
              </div>
              <div style="text-align:right;">
                <div style="color:#f59e0b; font-size:0.95rem; letter-spacing:1px;">${starsStr}</div>
                <div style="font-size:0.72rem; color:var(--muted);">${reviewDate}${isEdited ? ' <span style="font-size:0.68rem; color:#64748b; font-style:italic;">(updated)</span>' : ''}</div>
              </div>
            </div>
            <p style="font-size:0.85rem; color:#334155; margin:0.3rem 0 0; line-height:1.45;">
              ${r.comment ? escapeHtml(r.comment) : '<em style="color:var(--muted);">No written comments provided.</em>'}
            </p>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load product reviews:', err);
    if (reviewsContainer) {
      reviewsContainer.innerHTML = `<p style="color:#ef4444; font-size:0.85rem; text-align:center; padding:1rem 0;">Error loading reviews: ${escapeHtml(err.message || 'Server error')}</p>`;
    }
  }
}
window.openProductReviewsModal = openProductReviewsModal;

async function submitProductReview(event) {
  if (event) event.preventDefault();
  const itemId = currentReviewItemId || document.getElementById('review-item-id')?.value;
  const rating = Number(document.getElementById('review-star-value')?.value || currentSelectedStar || 5);
  const comment = (document.getElementById('review-comment-input')?.value || '').trim();
  const statusMsgEl = document.getElementById('review-form-status-msg');
  const submitBtn = document.getElementById('btn-submit-review');

  let submissionSuccess = false;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.6';
      submitBtn.style.cursor = 'wait';
      submitBtn.textContent = 'Submitting...';
    }
    if (statusMsgEl) statusMsgEl.textContent = 'Submitting your review...';

    const targetUrl =
      currentReviewTargetType === 'restaurant'
        ? `/api/customer/restaurants/${encodeURIComponent(itemId || 'by-name')}/reviews`
        : itemId && itemId !== 'undefined'
          ? `/api/customer/items/${encodeURIComponent(itemId)}/reviews`
          : `/api/customer/items/by-name/reviews`;

    const res = await apiFetch(targetUrl, {
      method: 'POST',
      body: JSON.stringify({ rating, comment, name: currentReviewItemName }),
    });

    submissionSuccess = true;

    // Record as saved review state
    hasExistingReview = true;
    savedReviewRating = rating;
    savedReviewComment = comment;

    if (statusMsgEl) {
      statusMsgEl.innerHTML = `<span style="color:#059669; font-weight:600;">✓ ${escapeHtml(res.message || 'Review submitted successfully!')}</span>`;
    }

    // Reload customer menu in background so cards get updated ratings
    if (typeof loadCustomerMenuSection === 'function') {
      await loadCustomerMenuSection();
    }

    // Re-fetch review modal data to show updated review immediately
    if (currentReviewTargetType === 'restaurant') {
      await openRestaurantReviewsModal(itemId, currentReviewItemName);
    } else {
      await openProductReviewsModal(itemId, currentReviewItemName, 'write');
    }

    if (typeof showAutoDismissNotice === 'function') {
      showAutoDismissNotice({
        title: '⭐ Review Submitted',
        message: 'Thank you! Your verified review and rating have been posted.',
        icon: '⭐',
      });
    }
  } catch (err) {
    console.error('Submit review error:', err);
    if (statusMsgEl) {
      statusMsgEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">⚠️ ${escapeHtml(err.message || 'Failed to submit review')}</span>`;
    }
    alert(`Could not submit review: ${err.message || 'Verified purchase required'}`);
  } finally {
    if (!submissionSuccess && submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      submitBtn.textContent = hasExistingReview ? 'Update Review' : 'Submit Review';
    } else {
      checkReviewFormChanges();
    }
  }
}
window.submitProductReview = submitProductReview;

async function fetchCustomerOrders() {
  const container = document.getElementById('customer-orders-list');
  if (!container) return;
  const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    container.innerHTML = renderTableSkeleton('orders');
  } else {
    container.style.opacity = '0.75';
    container.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/customer/orders');
    cachedCustomerOrders = data.orders || [];
    renderCustomerOrdersList(cachedCustomerOrders);
  } catch (e) {
    if (!hasExisting) {
      container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">Failed to load orders: ${escapeHtml(e.message)}</p>`;
    } else {
      console.error('Fetch customer orders error:', e);
    }
  } finally {
    container.style.opacity = '1';
  }
}
window.fetchCustomerOrders = fetchCustomerOrders;

// =========================================================================
// CUSTOMER: ADDRESSES
// =========================================================================
function setAddressLabelPreset(label) {
  const input = document.getElementById('addr-label');
  if (input) input.value = label;
}

async function setAsDefaultAddress(addressId) {
  try {
    await apiFetch(`/api/customer/addresses/${addressId}/default`, { method: 'POST' });
    await fetchCustomerAddresses();
    await fetchUserLocation();
    await loadCustomerMenuSection();
    if (cart.length) {
      renderCart();
    }
    alert('Default delivery address updated successfully!');
  } catch (e) {
    alert(`Error setting default address: ${e.message}`);
  }
}

async function fetchCustomerAddresses() {
  const grid = document.getElementById('addresses-list-grid');
  if (!grid) return;
  const hasExisting = grid.children.length > 0 && !grid.querySelector('.skeleton-shimmer');
  if (!hasExisting) {
    grid.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">Loading addresses...</p>';
  } else {
    grid.style.opacity = '0.75';
    grid.style.transition = 'opacity 0.15s ease';
  }

  try {
    const data = await apiFetch('/api/customer/addresses');
    customerAddresses = data.addresses || [];

    if (!customerAddresses.length) {
      grid.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No addresses saved yet. Click "+ Add New Address" above to add your first delivery address.</p>';
      return;
    }

    grid.innerHTML = customerAddresses.map((a) => `
      <div style="border:1px solid ${a.isDefault ? 'var(--green)' : 'var(--line)'}; border-radius:10px; padding:1.2rem; margin-bottom:1rem; background:${a.isDefault ? '#f6fbf7' : '#fff'}; display:flex; justify-content:space-between; align-items:flex-start; box-shadow:${a.isDefault ? '0 2px 8px rgba(45,106,79,0.08)' : 'none'};">
        <div>
          <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.4rem;">
            <strong style="font-size:1.05rem;">📍 ${escapeHtml(a.label || 'Home')}</strong>
            ${a.isDefault
              ? '<span class="badge badge-delivered" style="background:#2d6a4f; color:#fff; font-weight:700;">✓ Default Delivery Address</span>'
              : '<span class="badge badge-ready" style="font-size:0.75rem;">Saved Address</span>'}
          </div>
          <p style="margin:0.2rem 0; font-size:0.9rem; color:var(--ink); font-weight:500;">${escapeHtml(a.line1)}${a.line2 ? `, ${escapeHtml(a.line2)}` : ''}</p>
          <p style="margin:0.2rem 0; font-size:0.84rem; color:var(--muted);">${escapeHtml(a.city)}, ${escapeHtml(a.state || '')} - <strong>${escapeHtml(a.postalCode || '')}</strong>${a.digipin ? ` &nbsp;•&nbsp; <span style="display:inline-flex; align-items:center; gap:0.25rem; background:#eff6ff; color:#1d4ed8; padding:0.12rem 0.45rem; border-radius:4px; font-weight:700; font-size:0.75rem; border:1px solid #bfdbfe;">📍 DigiPIN: ${escapeHtml(a.digipin)}</span>` : ''}</p>
          <div style="font-size:0.82rem; color:var(--muted); margin-top:0.3rem;">📞 Contact: <strong>${escapeHtml(a.phone || user.phone || 'N/A')}</strong></div>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; justify-content:flex-end;">
          ${!a.isDefault ? `<button class="btn btn-outline btn-sm" style="border-color:var(--green); color:var(--green); font-weight:600;" onclick="setAsDefaultAddress('${a._id}')">⭐ Set as Default</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="editAddress('${a._id}')">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteAddress('${a._id}')">🗑️ Delete</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    if (!hasExisting) {
      grid.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">Failed to load addresses: ${e.message}</p>`;
    } else {
      console.error('Fetch customer addresses error:', e);
    }
  } finally {
    grid.style.opacity = '1';
  }
}

function showNewAddressForm() {
  document.getElementById('addr-id').value = '';
  document.getElementById('addr-label').value = 'Home';
  document.getElementById('addr-phone').value = user.phone || '';
  document.getElementById('addr-line1').value = '';
  document.getElementById('addr-line2').value = '';
  document.getElementById('addr-city').value = 'Bengaluru';
  document.getElementById('addr-state').value = 'Karnataka';
  document.getElementById('addr-pincode').value = '560001';
  const digipinInput = document.getElementById('addr-digipin');
  if (digipinInput) digipinInput.value = '';
  document.getElementById('addr-default').checked = customerAddresses.length === 0;
  document.getElementById('address-edit-form').style.display = 'block';
  document.getElementById('addr-line1').focus();
}

function editAddress(id) {
  const addr = customerAddresses.find((a) => a._id === id);
  if (!addr) return;
  document.getElementById('addr-id').value = addr._id;
  document.getElementById('addr-label').value = addr.label || 'Home';
  document.getElementById('addr-phone').value = addr.phone || '';
  document.getElementById('addr-line1').value = addr.line1 || '';
  document.getElementById('addr-line2').value = addr.line2 || '';
  document.getElementById('addr-city').value = addr.city || '';
  document.getElementById('addr-state').value = addr.state || '';
  document.getElementById('addr-pincode').value = addr.postalCode || '';
  const digipinInput = document.getElementById('addr-digipin');
  if (digipinInput) digipinInput.value = addr.digipin || '';
  document.getElementById('addr-default').checked = Boolean(addr.isDefault);
  document.getElementById('address-edit-form').style.display = 'block';
  document.getElementById('addr-line1').focus();
}

function cancelAddressEdit() {
  document.getElementById('address-edit-form').style.display = 'none';
}

async function saveCustomerAddress(e) {
  e.preventDefault();
  const id = document.getElementById('addr-id').value;
  const payload = {
    label: document.getElementById('addr-label').value.trim(),
    phone: document.getElementById('addr-phone').value.trim(),
    line1: document.getElementById('addr-line1').value.trim(),
    line2: document.getElementById('addr-line2').value.trim(),
    city: document.getElementById('addr-city').value.trim(),
    state: document.getElementById('addr-state').value.trim(),
    postalCode: document.getElementById('addr-pincode').value.trim(),
    digipin: (document.getElementById('addr-digipin')?.value || '').trim().toUpperCase(),
    isDefault: document.getElementById('addr-default').checked,
  };

  try {
    if (id) {
      await apiFetch(`/api/customer/addresses/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/customer/addresses', { method: 'POST', body: JSON.stringify(payload) });
    }
    cancelAddressEdit();
    await fetchCustomerAddresses();
    await fetchUserLocation();
    await loadCustomerMenuSection();
    if (cart.length) {
      renderCart();
    }
  } catch (err) {
    alert(`Address Error: ${err.message}`);
  }
}

async function deleteAddress(id) {
  if (!confirm('Are you sure you want to delete this address?')) return;
  try {
    await apiFetch(`/api/customer/addresses/${id}`, { method: 'DELETE' });
    await fetchCustomerAddresses();
    await fetchUserLocation();
    await loadCustomerMenuSection();
    if (cart.length) {
      renderCart();
    }
  } catch (e) {
    alert(e.message);
  }
}


// =========================================================================
// CUSTOMER ORDER ONLINE: INLINE RESTAURANT SEARCH BOX & DROPDOWN
// =========================================================================
let inlineRestaurantSearchQuery = "";

function buildRestaurantFilterCardsHtml(query = "") {
  const q = (query || "").toLowerCase().trim();
  let html = "";
  const isAllActive = currentSelectedRestaurantId === "all" && selectedCategory === "all";
  if (!q || "all restaurants".includes(q)) {
    html += `
      <div class="filter-modal-card ${isAllActive ? "active" : ""}" data-filter-type="restaurant" data-filter-value="all" onclick="handleFilterModalCardClick(this, event)">
        <div>
          <div style="font-weight:700; font-size:0.92rem;">All Restaurants (Latest History &amp; Favorites)</div>
          <div style="font-size:0.76rem; color:var(--muted);">View menus and dishes across all restaurants</div>
        </div>
        <span class="filter-modal-card-badge">${allMenuItems.length} dishes</span>
      </div>
    `;
  }

  const filteredRests = allRestaurants.filter((rest) => {
    if (!q) return true;
    const restId = String(rest.id || rest._id);
    const name = (rest.name || rest.displayName || "").toLowerCase();
    const cuisine = (rest.cuisine || "").toLowerCase();
    const addr = (rest.restaurantAddress || rest.address || "").toLowerCase();
    const itemMatch = allMenuItems.some(
      (m) =>
        String(m.restaurantId) === restId &&
        ((m.name || "").toLowerCase().includes(q) || (m.category || "").toLowerCase().includes(q))
    );
    return name.includes(q) || cuisine.includes(q) || addr.includes(q) || itemMatch;
  });

  if (!filteredRests.length && q) {
    html += `<p style="color:var(--muted); text-align:center; padding:1.2rem 0; margin:0; font-size:0.85rem;">No restaurants match "${escapeHtml(query)}"</p>`;
  } else {
    filteredRests.forEach((rest) => {
      const restId = String(rest.id || rest._id);
      const restItems = allMenuItems.filter((m) => String(m.restaurantId) === restId);
      const count = restItems.length;
      const restDisplay = formatCleanName(rest.name || rest.displayName || "Restaurant");
      const isClosed = rest.isOpen === false || rest.isOnline === false;
      const isActive = currentSelectedRestaurantId === restId;
      const cuisineText = rest.cuisine ? ` • ${escapeHtml(rest.cuisine)}` : "";
      const addrText = (rest.restaurantAddress || rest.address) ? ` • ${escapeHtml(rest.restaurantAddress || rest.address)}` : "";

      const catMap = new Map();
      restItems.forEach((m) => {
        const raw = (m.category || "Main Course").trim() || "Main Course";
        const key = raw.toLowerCase();
        const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
        if (!catMap.has(key)) {
          catMap.set(key, { name: formatted, count: 0 });
        }
        catMap.get(key).count += 1;
      });
      const restCategories = Array.from(catMap.values());

      const categoriesContentHtml =
        restCategories.length > 0
          ? `<div style="font-size:0.74rem; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.2rem;">Food Categories (Click to Open):</div>
             <ul class="rest-category-bullet-list">
              ${restCategories
                .map((c) => {
                  const isCatActive =
                    isActive &&
                    selectedCategory !== "all" &&
                    selectedCategory.toLowerCase() === c.name.toLowerCase();
                  return `<li>
                    <button type="button" class="rest-category-bullet-btn ${isCatActive ? "active" : ""}" onclick="selectRestaurantCategoryFilter(event, '${escapeHtml(restId)}', '${escapeHtml(c.name)}')" title="Open ${escapeHtml(c.name)} from ${escapeHtml(restDisplay)}">
                      <span>🍽️ ${escapeHtml(c.name)}</span>
                      <span style="font-size:0.75rem; opacity:0.8; font-weight:500;">${c.count} ${c.count === 1 ? "item" : "items"} →</span>
                    </button>
                  </li>`;
                })
                .join("")}
            </ul>`
          : `<ul class="rest-category-bullet-list"><li style="color:#dc2626; font-weight:600; font-size:0.8rem;">Not selling any item</li></ul>`;

      html += `
        <div>
          <div class="filter-modal-card ${isActive ? "active" : ""}" data-filter-type="restaurant" data-filter-value="${escapeHtml(restId)}" onclick="toggleRestaurantModalCategories(event, '${escapeHtml(restId)}')" title="Click to expand food categories sold by ${escapeHtml(restDisplay)}">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                <span style="font-weight:600; font-size:0.9rem; color:var(--ink);">${escapeHtml(restDisplay)}</span>
                ${isClosed ? '<span style="font-size:0.7em; color:#ef4444; font-weight:700; background:#fee2e2; padding:0.1rem 0.35rem; border-radius:4px;">[CLOSED]</span>' : ""}
              </div>
              <div style="font-size:0.75rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0.15rem;">
                ${count} menu items${cuisineText}${addrText}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.4rem; flex-shrink:0;">
              <span class="filter-modal-card-badge">${count} items</span>
              <button
                type="button"
                id="rest-cat-btn-${escapeHtml(restId)}"
                class="rest-category-expand-btn"
                onclick="toggleRestaurantModalCategories(event, '${escapeHtml(restId)}')"
                title="Expand to see food categories sold by this restaurant"
              >
                ▾ Categories
              </button>
            </div>
          </div>
          <div id="rest-cat-panel-${escapeHtml(restId)}" class="rest-category-panel">
            ${categoriesContentHtml}
          </div>
        </div>
      `;
    });
  }
  return html;
}

function handleInlineRestaurantSearchFocus(inputEl) {
  if (mainCustomerTab !== "all_restaurants") {
    mainCustomerTab = "all_restaurants";
    selectedCategory = "all";
    currentSelectedRestaurantId = "all";
    selectedMenuItemId = "all";
    renderSubFilterPills();
    renderMenuItems();
  }
  const dropdown = document.getElementById("inline-restaurant-search-dropdown");
  if (dropdown) {
    dropdown.innerHTML = buildRestaurantFilterCardsHtml(inputEl?.value || "");
    dropdown.style.display = "flex";
  }
}

function handleInlineRestaurantSearchInput(inputEl) {
  inlineRestaurantSearchQuery = inputEl?.value || "";
  if (mainCustomerTab !== "all_restaurants") {
    mainCustomerTab = "all_restaurants";
    renderSubFilterPills();
  }
  const dropdown = document.getElementById("inline-restaurant-search-dropdown");
  if (dropdown) {
    dropdown.innerHTML = buildRestaurantFilterCardsHtml(inlineRestaurantSearchQuery);
    dropdown.style.display = "flex";
  }
  // Also filter the restaurant tiles grid live using the existing Latest History & Favorites ordering
  renderMenuItems();
}

function closeInlineRestaurantSearchDropdown() {
  const dropdown = document.getElementById("inline-restaurant-search-dropdown");
  if (dropdown) {
    dropdown.style.display = "none";
  }
}

document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("inline-restaurant-search-wrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    closeInlineRestaurantSearchDropdown();
  }
});

window.handleInlineRestaurantSearchFocus = handleInlineRestaurantSearchFocus;
window.handleInlineRestaurantSearchInput = handleInlineRestaurantSearchInput;
window.closeInlineRestaurantSearchDropdown = closeInlineRestaurantSearchDropdown;
