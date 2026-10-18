const API_ROOT = window.location.hostname
  ? `${window.location.protocol}//${window.location.hostname}:5050`
  : 'http://localhost:5050';

const token = localStorage.getItem('tomatoToken');
const storedUser = JSON.parse(localStorage.getItem('tomatoUser') || 'null');
if (!token || !storedUser || !storedUser.role) {
  window.location.href = '../index.html';
}

function formatCleanName(str) {
  if (!str) return '';
  return String(str).split('/')[0].trim();
}

const user = storedUser;
if (user) {
  delete user.walletBalance;
  delete user.creditPoint;
  try {
    const rawSaved = localStorage.getItem('tomatoUser');
    if (rawSaved && (rawSaved.includes('"walletBalance"') || rawSaved.includes('"creditPoint"'))) {
      const parsed = JSON.parse(rawSaved);
      delete parsed.walletBalance;
      delete parsed.creditPoint;
      localStorage.setItem('tomatoUser', JSON.stringify(parsed));
    }
  } catch (_) {}
  if (user.name) user.name = formatCleanName(user.name);
  if (user.displayName) user.displayName = formatCleanName(user.displayName);
}

// In-memory wallet state (never saved to localStorage or sessionStorage)
window.currentWallet = {
  walletBalance: 0,
  creditPoint: 0,
};
const normalizeRole = (r) => {
  const val = String(r || 'customer').trim().toLowerCase();
  if (['deliverypartner', 'delivery_partner', 'delivery partner', 'rider'].includes(val)) return 'deliveryPartner';
  if (['restaurant', 'restaurent'].includes(val)) return 'restaurant';
  if (['shop', 'store'].includes(val)) return 'shop';
  if (['admin', 'subadmin'].includes(val)) return val;
  return 'customer';
};
const role = normalizeRole(user.role);
const userPerms = Array.isArray(user?.permissions) ? user.permissions : [];
const hasPerm = (p) => role === 'admin' || userPerms.includes(p) || userPerms.includes('*');

const DEFAULT_TOMATO_PHOTO_URL =
  'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=800&q=80';
const DEFAULT_TOMATO_SVG_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="bgGrad" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stop-color="#450a0a"/>
          <stop offset="55%" stop-color="#1f1212"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </radialGradient>
        <radialGradient id="tom1" cx="36%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#fca5a5"/>
          <stop offset="28%" stop-color="#f87171"/>
          <stop offset="68%" stop-color="#dc2626"/>
          <stop offset="100%" stop-color="#7f1d1d"/>
        </radialGradient>
        <radialGradient id="tom2" cx="38%" cy="32%" r="62%">
          <stop offset="0%" stop-color="#ff6b6b"/>
          <stop offset="40%" stop-color="#ef4444"/>
          <stop offset="80%" stop-color="#b91c1c"/>
          <stop offset="100%" stop-color="#7f1d1d"/>
        </radialGradient>
      </defs>
      <rect width="800" height="500" fill="url(#bgGrad)"/>
      <g transform="translate(525, 275) scale(0.82)" opacity="0.88">
        <ellipse cx="0" cy="20" rx="140" ry="122" fill="url(#tom2)"/>
        <ellipse cx="-48" cy="-22" rx="40" ry="18" transform="rotate(-25 -48 -22)" fill="#ffffff" opacity="0.24"/>
        <path d="M-10,-88 C-5,-120 10,-120 12,-88 C38,-110 68,-98 32,-74 C64,-66 58,-44 22,-58 C12,-34 -6,-38 -8,-60 C-42,-44 -58,-66 -22,-74 C-58,-98 -28,-110 -10,-88 Z" fill="#15803d"/>
      </g>
      <g transform="translate(335, 255)">
        <ellipse cx="0" cy="22" rx="160" ry="138" fill="url(#tom1)"/>
        <ellipse cx="-56" cy="-28" rx="48" ry="22" transform="rotate(-25 -56 -28)" fill="#ffffff" opacity="0.34"/>
        <circle cx="-84" cy="12" r="9" fill="#ffffff" opacity="0.22"/>
        <path d="M-12,-100 C-6,-142 12,-142 14,-100 C46,-126 84,-110 40,-84 C78,-74 70,-48 26,-64 C14,-36 -8,-40 -10,-66 C-54,-48 -70,-74 -26,-84 C-70,-110 -34,-126 -12,-100 Z" fill="#16a34a" stroke="#14532d" stroke-width="3"/>
        <path d="M0,-104 Q10,-148 30,-162" fill="none" stroke="#15803d" stroke-width="11" stroke-linecap="round"/>
      </g>
    </svg>`
  ).replace(/'/g, '%27');
window.DEFAULT_TOMATO_SVG_URI = DEFAULT_TOMATO_SVG_URI;
window.DEFAULT_TOMATO_PHOTO_URL = DEFAULT_TOMATO_PHOTO_URL;

function resolveImageUrl(img) {
  if (!img || typeof img !== 'string' || !img.trim()) return '';
  const trimmed = img.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `${API_ROOT}${trimmed}`;
  }
  return `${API_ROOT}/${trimmed}`;
}
window.resolveImageUrl = resolveImageUrl;

function getFullTileBackgroundCss(rawImg) {
  const gradient =
    'linear-gradient(180deg, rgba(15,23,42,0.48) 0%, rgba(15,23,42,0.22) 50%, rgba(15,23,42,0.48) 100%)';
  const resolved = rawImg && typeof rawImg === 'string' && rawImg.trim() ? resolveImageUrl(rawImg) : '';
  if (resolved) {
    return `${gradient}, url('${escapeHtml(resolved)}'), url('${DEFAULT_TOMATO_SVG_URI}')`;
  }
  return `${gradient}, url('${DEFAULT_TOMATO_PHOTO_URL}'), url('${DEFAULT_TOMATO_SVG_URI}')`;
}
window.getFullTileBackgroundCss = getFullTileBackgroundCss;

function renderFullTileBackdropHtml(rawImg) {
  const resolved = rawImg && typeof rawImg === 'string' && rawImg.trim() ? resolveImageUrl(rawImg) : '';
  const primarySrc = resolved || DEFAULT_TOMATO_PHOTO_URL;
  return `
    <div class="tile-bg-media-wrap" style="position:absolute; inset:0; width:100%; height:100%; overflow:hidden; z-index:0; pointer-events:none;">
      <img
        src="${escapeHtml(primarySrc)}"
        alt=""
        loading="lazy"
        onerror="this.onerror=null; this.src=window.DEFAULT_TOMATO_SVG_URI;"
        style="width:100%; height:100%; object-fit:cover; object-position:center; display:block;"
      />
      <div style="position:absolute; inset:0; width:100%; height:100%; background:linear-gradient(180deg, rgba(15,23,42,0.48) 0%, rgba(15,23,42,0.22) 50%, rgba(15,23,42,0.48) 100%);"></div>
    </div>
  `;
}
window.renderFullTileBackdropHtml = renderFullTileBackdropHtml;

async function handleProductImageSelection(type, fileInput) {
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  const prefix = type === 'shop' ? 'si' : 'mi';
  const previewImg = document.getElementById(`${prefix}-image-preview`);
  const placeholder = document.getElementById(`${prefix}-image-placeholder`);
  const hiddenUrl = document.getElementById(`${prefix}-image-url`);
  const statusEl = document.getElementById(`${prefix}-image-status`);

  // Strict JPG/JPEG validation
  const fileName = (file.name || '').toLowerCase();
  const fileType = (file.type || '').toLowerCase();
  const isJpgExt = fileName.endsWith('.jpg') || fileName.endsWith('.jpeg');
  const isJpgMime = !fileType || fileType === 'image/jpeg' || fileType === 'image/jpg' || fileType === 'image/pjpeg';

  if (!isJpgExt || !isJpgMime) {
    if (statusEl) {
      statusEl.textContent = '⚠️ Only JPG and JPEG images are allowed (.jpg / .jpeg).';
      statusEl.style.color = '#dc2626';
    }
    alert('Invalid file format. Product image must be JPG or JPEG only (.jpg / .jpeg).');
    fileInput.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    if (statusEl) {
      statusEl.textContent = '⚠️ Image size exceeds 5MB limit.';
      statusEl.style.color = '#dc2626';
    }
    alert('File is too large. Product image must be less than 5MB.');
    fileInput.value = '';
    return;
  }

  // Local instant preview in circular box
  const reader = new FileReader();
  reader.onload = (e) => {
    if (previewImg) {
      previewImg.src = e.target.result;
      previewImg.style.display = 'block';
    }
    if (placeholder) {
      placeholder.style.display = 'none';
    }
  };
  reader.readAsDataURL(file);

  if (statusEl) {
    statusEl.textContent = 'Uploading image...';
    statusEl.style.color = '#2563eb';
  }

  try {
    const formData = new FormData();
    formData.append('image', file);
    const endpoint = type === 'shop' ? '/api/shop/upload-image' : '/api/restaurant/upload-image';
    const res = await fetch(`${API_ROOT}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    if (hiddenUrl) hiddenUrl.value = data.imageUrl || '';
    if (statusEl) {
      statusEl.textContent = '✓ Image uploaded! Ready to save.';
      statusEl.style.color = '#059669';
    }
  } catch (err) {
    console.error('Image upload failed:', err);
    if (statusEl) {
      statusEl.textContent = `⚠️ Upload failed: ${err.message}. You can try again.`;
      statusEl.style.color = '#dc2626';
    }
  }
}
window.handleProductImageSelection = handleProductImageSelection;

// Global state - Default landing view per role:
// - Admin: Analytics ('admin-analytics')
// - Shop: Overview ('overview')
// - Restaurant: Overview ('overview')
// - Rider: Available Pickups ('rider-available')
// - Customer: Order Online ('customer-order')
const getDefaultRoleView = () => {
  if (role === 'admin' || (role === 'subadmin' && hasPerm('dashboard_view'))) return 'admin-analytics';
  if (role === 'shop') return 'overview';
  if (role === 'restaurant') return 'overview';
  if (role === 'deliveryPartner') return 'overview';
  if (role === 'customer') return 'customer-order';
  return 'overview';
};

const getActiveViewStorageKey = () => {
  const uid = (user && (user._id || user.id || user.email)) || 'session';
  return `tomato_active_view_${uid}_${role}`;
};

const getInitialActiveView = () => {
  try {
    // 1. Check URL hash (e.g., #admin-bank)
    const hash = (window.location.hash || '').replace(/^#/, '').trim();
    if (hash && document.getElementById(`${hash}-view`)) {
      return hash;
    }
    // 2. Check sessionStorage for refreshed tab state
    const saved = sessionStorage.getItem(getActiveViewStorageKey()) || sessionStorage.getItem('tomato_active_view');
    if (saved && document.getElementById(`${saved}-view`)) {
      return saved;
    }
  } catch (_) {}
  return getDefaultRoleView();
};

let activeView = getInitialActiveView();
let customerBrowseMode = 'restaurant'; // 'restaurant' | 'shop'
let allRestaurants = [];
let allMenuItems = [];
let allShops = [];
let allShopItems = [];
let currentSelectedRestaurantId = 'all';
let currentSelectedShopId = 'all';
let mainCustomerTab = 'all_restaurants'; // 'all_restaurants' | 'all_menus' | 'category' for rest; 'all_shops' | 'all_products' | 'category' for shop
let selectedCategory = 'all';
let selectedMenuItemId = 'all';
let openDropdownTab = null;
function getCustomerCartStorageKey() {
  const uid = (user && (user._id || user.id || user.email)) || 'guest';
  return `tomato_customer_cart_${uid}`;
}

function getCustomerCartCouponsStorageKey() {
  const uid = (user && (user._id || user.id || user.email)) || 'guest';
  return `tomato_customer_cart_coupons_${uid}`;
}

function loadSavedCartFromStorage() {
  try {
    const raw = localStorage.getItem(getCustomerCartStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.itemId && Number(item.quantity) > 0)
      .map((item) => ({
        itemId: String(item.itemId),
        name: String(item.name || 'Item'),
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1),
        restaurantId: String(item.restaurantId || ''),
        storeType: item.storeType === 'shop' ? 'shop' : 'restaurant',
        category: String(item.category || ''),
      }));
  } catch (e) {
    console.warn('Could not load cart from localStorage:', e);
    return [];
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem(getCustomerCartStorageKey(), JSON.stringify(cart));
  } catch (e) {
    console.warn('Could not save cart to localStorage:', e);
  }
}

const cart = loadSavedCartFromStorage();
let isCustomerCartViewActive = false;
let customerAddresses = [];
let selectedPaymentMethod = 'razorpay';

// Safe fetch helper with Auth
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_ROOT}${endpoint}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem('tomatoToken');
    localStorage.removeItem('tomatoUser');
    window.location.href = '../index.html?auth=expired';
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    throw new Error(data.message || 'API request failed');
  }
  return data;
}

// UI Helpers
function showStatusBanner(text, type = 'warning') {
  const banner = document.getElementById('status-banner');
  if (!banner) return;
  banner.className = `alert-banner visible alert-${type}`;
  banner.innerHTML = `<strong>Notice:</strong> <span>${escapeHtml(text)}</span>`;
}

function hideStatusBanner() {
  const banner = document.getElementById('status-banner');
  if (banner) banner.className = 'alert-banner';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCleanName(str) {
  if (!str) return '';
  return String(str).split('/')[0].trim();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('visible');
    el.style.display = 'none';
  }
  if (id === 'admin-credit-transfer-modal') {
    const transferContainer = document.getElementById('admin-wallet-credit-track');
    if (transferContainer) {
      transferContainer.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Completed transfers appear here, newest first.</p>';
    }
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('visible');
    el.style.display = 'grid';
  }
}

// =========================================================================
// REAL-TIME NOTIFICATION SYSTEM (SSE & TOASTS & PHONE RINGING ALERTS)
// =========================================================================
let notificationEventSource = null;
let ringAudioContext = null;
let ringIntervalTimer = null;
let ringCountdownTimer = null;
let activeRingingOrderId = null;

/**
 * Real-Time Telephone Ring Tone & Mobile Vibration Engine
 * Generates standard telephone ringing dual frequencies (440Hz + 480Hz)
 */
function startPhoneRinging(orderData) {
  if (!orderData || !orderData.orderId) return;
  activeRingingOrderId = orderData.orderId;

  // Vibrate mobile device if supported
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([600, 300, 600, 300, 600, 1000]);
    } catch (_) {}
  }

  // Play dual-tone multi-frequency ring tone burst
  function playRingBurst() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!ringAudioContext || ringAudioContext.state === 'closed') {
        ringAudioContext = new AudioContext();
      }
      if (ringAudioContext.state === 'suspended') {
        ringAudioContext.resume();
      }

      const now = ringAudioContext.currentTime;
      const ringLength = 1.6;

      // Tone 1: 440 Hz
      const osc1 = ringAudioContext.createOscillator();
      const gain1 = ringAudioContext.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      gain1.gain.setValueAtTime(0.24, now);
      gain1.gain.setValueAtTime(0.24, now + ringLength - 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + ringLength);
      osc1.connect(gain1);
      gain1.connect(ringAudioContext.destination);
      osc1.start(now);
      osc1.stop(now + ringLength);

      // Tone 2: 480 Hz
      const osc2 = ringAudioContext.createOscillator();
      const gain2 = ringAudioContext.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(480, now);
      gain2.gain.setValueAtTime(0.24, now);
      gain2.gain.setValueAtTime(0.24, now + ringLength - 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + ringLength);
      osc2.connect(gain2);
      gain2.connect(ringAudioContext.destination);
      osc2.start(now);
      osc2.stop(now + ringLength);
    } catch (e) {
      console.debug('Phone ring tone deferred:', e);
    }
  }

  // Ring immediately
  playRingBurst();

  // Repeat ringing every 3 seconds (1.6s ring + 1.4s silence)
  clearInterval(ringIntervalTimer);
  ringIntervalTimer = setInterval(() => {
    if (!activeRingingOrderId) return;
    playRingBurst();
    if ('vibrate' in navigator) {
      try { navigator.vibrate([600, 300, 600, 300]); } catch (_) {}
    }
  }, 3000);

  // Fill incoming delivery modal fields
  const orderNumEl = document.getElementById('call-order-number');
  if (orderNumEl) orderNumEl.textContent = orderData.orderNumber || 'TOM-XXXX';

  const restNameEl = document.getElementById('call-restaurant-name');
  if (restNameEl) {
    const restDisplay = orderData.restaurantCode
      ? `${orderData.restaurantName} / ${orderData.restaurantCode}`
      : (orderData.restaurantName || 'Partner Kitchen');
    restNameEl.innerHTML = `${escapeHtml(restDisplay)} ${orderData.digipin ? `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.75rem; margin-left:0.35rem;">📍 DIGIPIN: ${escapeHtml(orderData.digipin)}</span>` : ''}`;
  }

  const restAddrEl = document.getElementById('call-restaurant-address');
  if (restAddrEl) restAddrEl.textContent = orderData.restaurantAddress || 'Bengaluru Food Quarter';

  const custAddrEl = document.getElementById('call-delivery-address');
  if (custAddrEl) {
    custAddrEl.textContent = orderData.deliveryAddress?.line1
      ? `${orderData.deliveryAddress.line1}, ${orderData.deliveryAddress.city || ''}`
      : 'Customer Address';
  }

  const distBadgeEl = document.getElementById('call-distance-badge');
  if (distBadgeEl) {
    distBadgeEl.textContent = `📍 ${orderData.distanceKm !== undefined ? orderData.distanceKm : '0.8'} km away`;
  }

  const totalAmtEl = document.getElementById('call-total-amount');
  if (totalAmtEl) totalAmtEl.textContent = `₹${orderData.totalAmount || 0}`;

  // Countdown timer (45 seconds)
  let secondsLeft = orderData.ringDurationSeconds || 45;
  const countdownEl = document.getElementById('ring-countdown');
  if (countdownEl) countdownEl.textContent = `${secondsLeft}s`;

  clearInterval(ringCountdownTimer);
  ringCountdownTimer = setInterval(() => {
    secondsLeft--;
    if (countdownEl) countdownEl.textContent = `${secondsLeft}s`;
    if (secondsLeft <= 0) {
      stopPhoneRinging();
      closeModal('incoming-delivery-modal');
    }
  }, 1000);

  openModal('incoming-delivery-modal');
}

function stopPhoneRinging() {
  activeRingingOrderId = null;
  clearInterval(ringIntervalTimer);
  clearInterval(ringCountdownTimer);

  if ('vibrate' in navigator) {
    try { navigator.vibrate(0); } catch (_) {}
  }

  if (ringAudioContext && ringAudioContext.state !== 'closed') {
    try {
      ringAudioContext.close();
    } catch (_) {}
    ringAudioContext = null;
  }
}

async function acceptIncomingDelivery() {
  const orderId = activeRingingOrderId;
  stopPhoneRinging();
  closeModal('incoming-delivery-modal');

  if (!orderId) return;
  try {
    await apiFetch(`/api/rider/orders/${orderId}/accept`, { method: 'POST' });
    alert('Delivery order claimed! Proceed to pick up the meal.');
    switchView('rider-active');
  } catch (e) {
    alert(`Accept Error: ${e.message}`);
    fetchAvailableRiderOrders();
  }
}

async function rejectIncomingDelivery() {
  const orderId = activeRingingOrderId;
  stopPhoneRinging();
  closeModal('incoming-delivery-modal');

  if (!orderId) return;
  try {
    const res = await apiFetch(`/api/rider/orders/${orderId}/reject`, { method: 'POST' });
    alert(res.message || 'Delivery rejected. Re-routed to other riders within 2km.');
    fetchAvailableRiderOrders();
  } catch (e) {
    console.error('Reject delivery error:', e);
  }
}

async function rejectDeliveryOrder(orderId) {
  if (!confirm('Reject delivery order? It will be automatically dispatched to other nearby riders within 2km.')) return;
  try {
    const res = await apiFetch(`/api/rider/orders/${orderId}/reject`, { method: 'POST' });
    alert(res.message || 'Delivery rejected and re-routed to other nearby riders.');
    fetchAvailableRiderOrders();
  } catch (e) {
    alert(`Reject Error: ${e.message}`);
  }
}

let currentRiderCoords = { lat: 12.9718, lng: 77.5948 };
let riderWatchId = null;
let riderHeartbeatTimer = null;

function updateRiderTelemetryUI(lat, lng) {
  const coordsText = `${Number(lat).toFixed(4)}° N, ${Number(lng).toFixed(4)}° E`;
  const c1 = document.getElementById('rider-live-coords-text');
  if (c1) c1.textContent = coordsText;
  const c2 = document.getElementById('rider-active-coords-text');
  if (c2) c2.textContent = coordsText;
  const p1 = document.getElementById('rider-live-ping-time');
  if (p1) p1.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function broadcastRiderLocation(lat, lng, label = '') {
  currentRiderCoords = { lat: Number(lat), lng: Number(lng) };
  updateRiderTelemetryUI(currentRiderCoords.lat, currentRiderCoords.lng);

  // Push real-time GPS coordinates over WebSocket immediately
  if (window.TomatoWS && typeof window.TomatoWS.sendRiderLocationPing === 'function') {
    window.TomatoWS.sendRiderLocationPing(currentRiderCoords.lat, currentRiderCoords.lng, true);
  }

  try {
    await apiFetch('/api/rider/location', {
      method: 'PUT',
      body: JSON.stringify({
        lat: currentRiderCoords.lat,
        lng: currentRiderCoords.lng,
        isOnline: true,
      }),
    });
    if (label) {
      showToastNotification({
        title: 'Rider GPS Broadcast Active',
        message: `Stationed at ${label} (${currentRiderCoords.lat.toFixed(4)}, ${currentRiderCoords.lng.toFixed(4)})`,
        type: 'info',
      });
    }
  } catch (err) {
    console.error('Rider live broadcast error:', err);
  }
}

function setRiderSimulatedLocation(preset) {
  const coords = {
    near1: { lat: 12.9718, lng: 77.5948, label: 'Indiranagar Hub (~0.1 km - Inside 2km Proximity)' },
    near2: { lat: 12.9780, lng: 77.5990, label: 'Koramangala (~1.1 km - Inside 2km Proximity)' },
    far: { lat: 12.8200, lng: 77.4200, label: 'Whitefield (~18 km - Outside 2km Ring)' },
  }[preset] || { lat: 12.9716, lng: 77.5946, label: 'Default Bengaluru' };

  broadcastRiderLocation(coords.lat, coords.lng, coords.label);
}

function simulateRiderMovement() {
  // Move approximately 100 meters towards north-east
  const newLat = currentRiderCoords.lat + 0.0009;
  const newLng = currentRiderCoords.lng + 0.0009;
  broadcastRiderLocation(newLat, newLng, 'Moved ~100m');
}

function triggerDeviceGPSDetection() {
  if (!('geolocation' in navigator)) {
    alert('Geolocation API is not supported in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      broadcastRiderLocation(pos.coords.latitude, pos.coords.longitude, 'Device GPS Fix');
      alert(`Acquired device GPS fix: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
    },
    (err) => {
      alert(`GPS Error: ${err.message}. Using active default simulation coordinates.`);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function initRiderLocationTracking() {
  if (role !== 'deliveryPartner') return;

  // Default initial broadcast
  broadcastRiderLocation(currentRiderCoords.lat, currentRiderCoords.lng);

  // Continuous watchPosition for live hardware GPS
  if ('geolocation' in navigator) {
    try {
      if (riderWatchId) navigator.geolocation.clearWatch(riderWatchId);
      riderWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          broadcastRiderLocation(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
          console.debug('Geolocation watch warning:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
    } catch (e) {
      console.warn('Geolocation watchPosition setup error:', e);
    }
  }

  // Heartbeat transmitter: broadcast every 10 seconds to keep live ping fresh
  if (riderHeartbeatTimer) clearInterval(riderHeartbeatTimer);
  riderHeartbeatTimer = setInterval(() => {
    broadcastRiderLocation(currentRiderCoords.lat, currentRiderCoords.lng);
  }, 10000);
}

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // High note
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Harmonic note
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28);
    gain2.gain.setValueAtTime(0.14, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.45);
  } catch (e) {
    console.debug('Audio autoplay deferred until interaction:', e);
  }
}

function showToastNotification({ title, message, type = 'info', actionLabel, onAction, duration = 8000 }) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-card toast-${type}`;

  const typeIcons = {
    success: '✓',
    warning: '⚠️',
    info: '🔔',
    danger: '🚨',
  };
  const icon = typeIcons[type] || '🔔';

  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${icon} ${escapeHtml(title)}</span>
      <button class="toast-close" type="button" aria-label="Close notification">&times;</button>
    </div>
    <div class="toast-body">${escapeHtml(message)}</div>
    ${actionLabel ? `<div class="toast-actions"><button type="button" class="btn btn-primary btn-sm toast-action-btn">${escapeHtml(actionLabel)}</button></div>` : ''}
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => removeToast(toast));

  if (actionLabel && typeof onAction === 'function') {
    const actionBtn = toast.querySelector('.toast-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        removeToast(toast);
        onAction();
      });
    }
  }

  container.appendChild(toast);

  const timer = setTimeout(() => {
    removeToast(toast);
  }, duration);

  function removeToast(el) {
    clearTimeout(timer);
    el.style.opacity = '0';
    el.style.transform = 'translateX(110%)';
    setTimeout(() => el.remove(), 250);
  }
}

function updateLiveStatus(status, text) {
  const dot = document.getElementById('live-dot');
  const label = document.getElementById('live-status-text');
  if (!dot || !label) return;

  if (status === 'connected') {
    dot.className = 'live-dot';
    label.textContent = text || 'Live Sync Active';
  } else if (status === 'connecting') {
    dot.className = 'live-dot connecting';
    label.textContent = text || 'Reconnecting...';
  } else {
    dot.className = 'live-dot connecting';
    label.textContent = text || 'Offline';
  }
}

function initNotificationStream() {
  if (!token) return;

  if (notificationEventSource) {
    try { notificationEventSource.close(); } catch (_) {}
  }

  updateLiveStatus('connecting', 'Connecting...');

  const sseUrl = `${API_ROOT}/api/notifications/stream?token=${encodeURIComponent(token)}`;
  notificationEventSource = new EventSource(sseUrl);

  notificationEventSource.addEventListener('connected', () => {
    updateLiveStatus('connected', 'Live Sync Active');
  });

  notificationEventSource.onopen = () => {
    updateLiveStatus('connected', 'Live Sync Active');
  };

  notificationEventSource.onerror = () => {
    updateLiveStatus('connecting', 'Reconnecting live link...');
  };

  // Incoming Delivery Ring: Mobile phone rings continuously for riders in 2km circle!
  notificationEventSource.addEventListener('incoming_delivery_ring', (event) => {
    if (role !== 'deliveryPartner') return;
    try {
      const data = JSON.parse(event.data);
      startPhoneRinging(data);
    } catch (e) {
      console.error('Incoming delivery ring error:', e);
    }
  });

  // Dismiss Delivery Ring (e.g. after reject or timeout)
  notificationEventSource.addEventListener('dismiss_delivery_ring', (event) => {
    if (role !== 'deliveryPartner') return;
    stopPhoneRinging();
    closeModal('incoming-delivery-modal');
  });

  // Order claimed by another rider
  notificationEventSource.addEventListener('delivery_claimed', (event) => {
    if (role !== 'deliveryPartner') return;
    try {
      const data = JSON.parse(event.data);
      if (activeRingingOrderId === data.orderId) {
        stopPhoneRinging();
        closeModal('incoming-delivery-modal');
        showToastNotification({
          title: `Order #${data.orderNumber} Claimed`,
          message: `Delivery accepted by partner ${data.riderName || 'fleet rider'}.`,
          type: 'info',
        });
      }
      if (activeView === 'rider-available') fetchAvailableRiderOrders();
    } catch (e) {
      console.error(e);
    }
  });

  // Standard notification event
  notificationEventSource.addEventListener('notification', (event) => {
    try {
      const data = JSON.parse(event.data);

      // If not a ring event (ring handled above)
      if (!data.metadata?.ring) {
        playNotificationSound();
      }

      let actionLabel = null;
      let onAction = null;
      let toastType = 'info';

      if (role === 'deliveryPartner') {
        toastType = 'success';
        if (data.metadata?.canAccept || data.title?.includes('Pickup')) {
          actionLabel = '🚴 Claim Order';
          onAction = () => {
            const targetId = data.entityId || data.metadata?.orderId;
            if (targetId) {
              acceptDeliveryOrder(targetId);
            } else {
              switchView('rider-available');
            }
          };
        }
      } else if (role === 'restaurant') {
        toastType = 'warning';
        actionLabel = '🔔 Open Kitchen Orders';
        onAction = () => switchView('restaurant-orders');
      } else if (role === 'shop') {
        toastType = 'warning';
        actionLabel = '🛍️ Open Shop Orders';
        onAction = () => switchView('shop-orders');
      } else if (role === 'customer') {
        toastType = 'success';
        actionLabel = '📦 Track My Order';
        onAction = () => switchView('customer-orders');
      } else if (role === 'admin') {
        actionLabel = '📊 View Admin Orders';
        onAction = () => switchView('admin-orders');
      }

      showToastNotification({
        title: data.title || 'Tomato Notification',
        message: data.message || '',
        type: toastType,
        actionLabel,
        onAction,
      });

      const notifOrderId = String(data.entityId || data.metadata?.orderId || '');
      const notifStatus = String(data.metadata?.status || '').toLowerCase();
      if (
        (notifStatus === 'delivered' || notifStatus === 'cancelled') &&
        typeof activeTrackingOrderId !== 'undefined' &&
        activeTrackingOrderId &&
        String(activeTrackingOrderId) === notifOrderId &&
        typeof closeOrderLiveTrackingModal === 'function'
      ) {
        closeOrderLiveTrackingModal();
      }

      refreshActiveViewData();
      loadNotifications();
      loadRoleOverview();
    } catch (e) {
      console.error('Error handling notification SSE event:', e);
    }
  });

  // Broadcast: new pickup available for riders
  notificationEventSource.addEventListener('new_pickup_available', (event) => {
    if (role !== 'deliveryPartner') return;
    try {
      const data = JSON.parse(event.data);
      showToastNotification({
        title: `🛵 Pickup Ready: #${data.orderNumber}`,
        message: `${data.restaurantName || 'Restaurant'} has accepted order (₹${data.totalAmount}). Tap to claim!`,
        type: 'success',
        actionLabel: '🚴 Claim Order',
        onAction: () => {
          if (data.orderId) {
            acceptDeliveryOrder(data.orderId);
          } else {
            switchView('rider-available');
          }
        },
      });

      if (activeView === 'rider-available') {
        fetchAvailableRiderOrders();
      }
      loadRoleOverview();
    } catch (e) {
      console.error(e);
    }
  });

  // Broadcast: order placed for admin
  notificationEventSource.addEventListener('order_placed', (event) => {
    if (role !== 'admin') return;
    try {
      const data = JSON.parse(event.data);
      showToastNotification({
        title: `New Order Placed #${data.orderNumber}`,
        message: `${data.restaurantName} received ₹${data.totalAmount} order.`,
        type: 'info',
        actionLabel: 'View Platform Orders',
        onAction: () => switchView('admin-orders'),
      });
      if (activeView === 'admin-orders') fetchAdminOrders();
      loadRoleOverview();
    } catch (e) {
      console.error(e);
    }
  });
}

function refreshActiveViewData() {
  if (activeView === 'customer-orders') fetchCustomerOrders();
  if (activeView === 'restaurant-orders') fetchRestaurantOrders();
  if (activeView === 'shop-orders') fetchShopOrders();
  if (activeView === 'shop-items') fetchShopItems();
  if (activeView === 'rider-available') fetchAvailableRiderOrders();
  if (activeView === 'rider-active') fetchActiveRiderOrders();
  if (activeView === 'admin-orders') fetchAdminOrders();
}

// =========================================================================
// SIDEBAR LIVE DUTY STATUS (RESTAURANT/SHOP OPEN/CLOSE & RIDER ONLINE/OFFLINE)
// =========================================================================
let isDutyActive = true;

function initDutyStatusToggle() {
  if (role !== 'restaurant' && role !== 'shop' && role !== 'deliveryPartner') return;

  const wrapper = document.getElementById('duty-toggle-wrapper');
  if (!wrapper) return;
  wrapper.style.display = 'inline-flex';

  // Initial state from stored user
  if (role === 'restaurant' || role === 'shop') {
    isDutyActive = user.isOpen !== undefined ? Boolean(user.isOpen) : (user.isOnline !== undefined ? Boolean(user.isOnline) : true);
  } else {
    isDutyActive = user.isOnline !== undefined ? Boolean(user.isOnline) : true;
  }

  renderDutyToggleUI();

  // Fetch fresh state from server in background
  const endpoint = role === 'restaurant' ? '/api/restaurant/status' : role === 'shop' ? '/api/shop/status' : '/api/rider/status';
  apiFetch(endpoint)
    .then((res) => {
      if ((role === 'restaurant' || role === 'shop') && res && res.isOpen !== undefined) {
        isDutyActive = Boolean(res.isOpen);
        user.isOpen = isDutyActive;
        user.isOnline = isDutyActive;
      } else if (role === 'deliveryPartner' && res && res.isOnline !== undefined) {
        isDutyActive = Boolean(res.isOnline);
        user.isOnline = isDutyActive;
      }
      localStorage.setItem('tomatoUser', JSON.stringify(user));
      renderDutyToggleUI();
    })
    .catch(() => {});
}

function renderDutyToggleUI() {
  const btn = document.getElementById('duty-toggle-btn');
  const label = document.getElementById('duty-toggle-label');
  if (!btn || !label) return;

  btn.classList.toggle('is-open', isDutyActive);
  btn.classList.toggle('is-closed', !isDutyActive);
  btn.setAttribute('aria-pressed', String(isDutyActive));

  if (role === 'restaurant' || role === 'shop') {
    label.textContent = isDutyActive ? 'Open' : 'Closed';
    btn.title = isDutyActive
      ? (role === 'shop' ? 'Shop is OPEN & accepting orders. Click to close shop.' : 'Restaurant is OPEN & accepting orders. Click to close restaurant.')
      : (role === 'shop' ? 'Shop is CLOSED. Customers cannot order. Click to open shop.' : 'Restaurant is CLOSED. Customers cannot order. Click to open restaurant.');
  } else if (role === 'deliveryPartner') {
    label.textContent = isDutyActive ? 'Online' : 'Offline';
    btn.title = isDutyActive
      ? 'Rider is ONLINE & ready for deliveries. Click to go offline.'
      : 'Rider is OFFLINE. Cannot receive orders. Click to go online.';
  }

  updateDutyNoticeBanner();
}

function updateDutyNoticeBanner() {
  if (user.isBlocked || user.isApproved === false) return;

  if (role === 'restaurant' && !isDutyActive) {
    showStatusBanner('Your restaurant is currently CLOSED. You will not receive customer orders and cannot accept new orders until toggled to OPEN.', 'warning');
  } else if (role === 'shop' && !isDutyActive) {
    showStatusBanner('Your shop is currently CLOSED. You will not receive customer orders and cannot accept new orders until toggled to OPEN.', 'warning');
  } else if (role === 'deliveryPartner' && !isDutyActive) {
    showStatusBanner('You are currently OFFLINE. Toggle duty to ONLINE in the sidebar to view and accept delivery orders.', 'warning');
  } else {
    hideStatusBanner();
  }
}

async function toggleDutyStatus() {
  const btn = document.getElementById('duty-toggle-btn');
  if (!btn || btn.disabled) return;

  const nextState = !isDutyActive;
  btn.disabled = true;

  try {
    const endpoint = role === 'restaurant' ? '/api/restaurant/status' : role === 'shop' ? '/api/shop/status' : '/api/rider/status';
    const payload = (role === 'restaurant' || role === 'shop')
      ? { isOpen: nextState, isOnline: nextState }
      : { isOnline: nextState };

    const res = await apiFetch(endpoint, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    isDutyActive = nextState;
    if (role === 'restaurant' || role === 'shop') {
      user.isOpen = nextState;
      user.isOnline = nextState;
    } else {
      user.isOnline = nextState;
    }
    localStorage.setItem('tomatoUser', JSON.stringify(user));

    renderDutyToggleUI();

    const toastTitle = (role === 'restaurant' || role === 'shop')
      ? (nextState ? (role === 'shop' ? 'Shop Opened 🟢' : 'Restaurant Opened 🟢') : (role === 'shop' ? 'Shop Closed 🔴' : 'Restaurant Closed 🔴'))
      : (nextState ? 'Rider Online 🟢' : 'Rider Offline 🔴');

    const toastMsg = res.message || (
      (role === 'restaurant' || role === 'shop')
        ? (nextState ? (role === 'shop' ? 'Shop is live and ready to accept customer orders.' : 'Restaurant is live and ready to accept customer orders.') : (role === 'shop' ? 'Shop is closed. Customers cannot place new orders.' : 'Restaurant is closed. Customers cannot place new orders.'))
        : (nextState ? 'Duty enabled. You are now available for incoming delivery orders.' : 'Duty disabled. You will not receive order requests.')
    );

    showToastNotification({
      title: toastTitle,
      message: toastMsg,
      type: nextState ? 'success' : 'warning',
    });

    if (role === 'restaurant' && activeView === 'restaurant-orders') {
      fetchRestaurantOrders();
    } else if (role === 'shop' && activeView === 'shop-orders') {
      fetchShopOrders();
    } else if (role === 'deliveryPartner' && (activeView === 'rider-available' || activeView === 'rider-active')) {
      fetchAvailableRiderOrders();
    }
  } catch (err) {
    showToastNotification({
      title: 'Status Update Failed',
      message: err.message || 'Unable to update status',
      type: 'error',
    });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updateProfileWalletDisplay(walletBalance, creditPoint) {
  const walletText = document.getElementById('profile-wallet-text');
  if (!walletText) return;
  const wb = Math.max(0, Number(walletBalance ?? 0)).toFixed(2);
  const cp = Math.max(0, Number(creditPoint ?? 0)).toFixed(0);
  walletText.innerHTML = `<span class="wallet-balance-val" style="color:#16a34a; font-weight:800;">${wb}</span>/<span class="credit-points-val" style="color:#2563eb; font-weight:800;">${cp}</span>`;
}
window.updateProfileWalletDisplay = updateProfileWalletDisplay;

async function refreshProfileWallet() {
  try {
    const wallet = await apiFetch('/api/auth/wallet');
    window.currentWallet = {
      walletBalance: Math.max(0, Number(wallet?.walletBalance ?? 0)),
      creditPoint: Math.max(0, Number(wallet?.creditPoint ?? 0)),
    };
    updateProfileWalletDisplay(window.currentWallet.walletBalance, window.currentWallet.creditPoint);
    if (typeof syncFinanceWithCurrentWallet === 'function') {
      syncFinanceWithCurrentWallet();
    }
  } catch (error) {
    console.error('Wallet refresh failed:', error);
    showToastNotification({
      title: 'Wallet Refresh Failed',
      message: error.message || 'Unable to fetch current wallet balance.',
      type: 'danger',
    });
  }
}

// Helper to parse address strings to city and 6-digit pincode
function parseAddressStringToCityAndPincode(rawAddress) {
  const defaultCity = 'Bengaluru';
  const defaultPincode = '560001';
  if (!rawAddress || typeof rawAddress !== 'string' || !rawAddress.trim()) {
    return { city: defaultCity, postalCode: defaultPincode };
  }
  const str = rawAddress.trim();
  const pinMatch = str.match(/\b([1-9]\d{5})\b/);
  const postalCode = pinMatch ? pinMatch[1] : defaultPincode;
  const cleanStr = str.replace(/\b[1-9]\d{5}\b/g, '').replace(/[-–,]+$/, '').trim();
  const parts = cleanStr.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const indianStates = new Set([
    'karnataka', 'maharashtra', 'delhi', 'tamil nadu', 'telangana', 'uttar pradesh',
    'west bengal', 'gujarat', 'kerala', 'rajasthan', 'madhya pradesh', 'punjab',
    'haryana', 'bihar', 'odisha', 'assam', 'ka', 'mh', 'dl', 'tn', 'ts', 'up', 'wb'
  ]);
  let city = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = (parts[i] || '').replace(/[-–]+$/, '').trim();
    if (!part) continue;
    if (indianStates.has(part.toLowerCase()) && !city) {
      continue;
    } else if (!city) {
      city = part;
    }
  }
  return { city: city || defaultCity, postalCode };
}

// Location badge helper
async function fetchUserLocation(cachedAddress = null) {
  const badge = document.getElementById('user-location-badge');
  if (!badge) return;

  let addr = cachedAddress;
  if (!addr) {
    try {
      const res = await apiFetch('/api/auth/default-address').catch(() => null);
      addr = res && res.address;
    } catch (e) {
      console.warn('Error fetching user location:', e);
    }
  }

  // Fallback to user session data if addr is still missing
  if (!addr && user) {
    if ((role === 'restaurant' || role === 'shop') && (user.shopAddress || user.restaurantAddress)) {
      const addrStr = user.shopAddress || user.restaurantAddress;
      const parsed = parseAddressStringToCityAndPincode(addrStr);
      addr = {
        city: parsed.city,
        postalCode: parsed.postalCode,
        locality: addrStr,
        state: 'KA',
      };
    } else {
      addr = {
        city: 'Bengaluru',
        postalCode: '560001',
        state: 'Karnataka',
        locality: 'Central',
      };
    }
  }

  let city = (addr?.city || '').trim();
  let pincode = (addr?.postalCode || addr?.pincode || '').trim();
  const locality = (addr?.locality || addr?.line1 || addr?.line2 || '').trim();

  // If city is NA or missing, resolve from shopAddress/restaurantAddress or platform default
  if (!city || city === 'NA') {
    if ((role === 'restaurant' || role === 'shop') && (user?.shopAddress || user?.restaurantAddress)) {
      const parsed = parseAddressStringToCityAndPincode(user.shopAddress || user.restaurantAddress);
      city = parsed.city;
      if (!pincode || pincode === '000') pincode = parsed.postalCode;
    } else {
      city = 'Bengaluru';
    }
  }

  if (!pincode || pincode === '000') {
    pincode = '560001';
  }

  badge.textContent = `${city}, ${pincode}`;
  badge.title = `${locality ? locality + ', ' : ''}${city}, ${addr?.state || 'KA'} ${pincode}`.trim();
}

window.fetchUserLocation = fetchUserLocation;

function formatUserId(id) {
  if (!id || typeof id !== 'string') return '';
  const trimmed = id.trim();
  if (trimmed.length <= 4) return trimmed.toLowerCase();
  return trimmed.slice(0, 4).toLowerCase() + trimmed.slice(4);
}

window.formatUserId = formatUserId;

// Resolve global user/role identifier with first 4 characters lowercase
function getUserIdentifier() {
  if (!user) return '';
  let rawId = '';
  if (role === 'customer') {
    rawId = user.customerId || (user._id || user.id ? `cust-${String(user._id || user.id).slice(-4).toLowerCase()}` : '') || user.userId || user.id || user._id || '';
  } else if (role === 'restaurant') {
    rawId = user.restaurantId || (user._id || user.id ? `rest-${String(user._id || user.id).slice(-4).toLowerCase()}` : '') || user.userId || user.id || user._id || '';
  } else if (role === 'shop') {
    rawId = user.shopId || (user._id || user.id ? `shop-${String(user._id || user.id).slice(-4).toLowerCase()}` : '') || user.userId || user.id || user._id || '';
  } else if (role === 'deliveryPartner') {
    rawId = user.riderId || (user._id || user.id ? `ride-${String(user._id || user.id).slice(-4).toLowerCase()}` : '') || user.userId || user.id || user._id || '';
  } else if (role === 'subadmin') {
    rawId = user.subadminId || (user._id || user.id ? `sub-${String(user._id || user.id).slice(-4).toLowerCase()}` : '') || user.userId || user.id || user._id || '';
  } else if (role === 'admin') {
    rawId = user.adminId || (user._id || user.id ? `adm-${String(user._id || user.id).slice(-4).toLowerCase()}` : '') || user.userId || user.id || user._id || 'adm-1001';
  } else {
    rawId = user.customerId || user.restaurantId || user.riderId || user.subadminId || user.adminId || user.userId || user.id || user._id || '';
  }
  return formatUserId(rawId);
}

function populateSettingsUserIdBadge() {
  const uid = getUserIdentifier();

  // 1. Settings view panel header badge
  const valEl = document.getElementById('settings-user-id-val');
  const badgeEl = document.getElementById('settings-user-id-badge');
  if (valEl && badgeEl) {
    if (uid) {
      valEl.textContent = uid;
      badgeEl.style.display = 'inline-flex';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  // 2. Left panel sidebar badge after typeOfUser
  const sideValEl = document.getElementById('sidebar-user-id-val');
  const sideBadgeEl = document.getElementById('sidebar-user-id-badge');
  if (sideValEl && sideBadgeEl) {
    if (uid) {
      sideValEl.textContent = uid;
      sideBadgeEl.style.display = 'inline-flex';
    } else {
      sideBadgeEl.style.display = 'none';
    }
  }
}

window.getUserIdentifier = getUserIdentifier;
window.populateSettingsUserIdBadge = populateSettingsUserIdBadge;

// Initialize Dashboard
function initDashboard() {
  const partnerDisplay = formatCleanName(user.displayName || user.name || 'Tomato User');
  document.getElementById('mini-name').textContent = partnerDisplay;
  const displayRole = role === 'deliveryPartner' ? 'Delivery Partner' : role === 'subadmin' ? (user.adminRoleTitle || 'Sub-Admin') : role.charAt(0).toUpperCase() + role.slice(1);
  document.getElementById('mini-role').textContent = displayRole;

  const walletChip = document.getElementById('profile-wallet-chip');
  const walletText = document.getElementById('profile-wallet-text');
  const walletLabel = document.getElementById('profile-wallet-label');
  if (walletChip) walletChip.style.display = 'inline-flex';
  updateProfileWalletDisplay(window.currentWallet?.walletBalance, window.currentWallet?.creditPoint);
  if (walletLabel) walletLabel.textContent = role === 'admin' || role === 'subadmin' ? 'W' : 'Wallet';
  const creditTransferButton = document.getElementById('admin-credit-transfer-open');
  if (creditTransferButton) {
    creditTransferButton.style.display = (role === 'admin' || role === 'restaurant' || role === 'shop') ? 'inline-flex' : 'none';
  }

function handleSidebarTransferClick() {
  if (role === 'restaurant' || role === 'shop') {
    if (typeof openPartnerFinanceTransferModal === 'function') {
      openPartnerFinanceTransferModal();
    }
  } else {
    if (typeof openAdminFinanceTransferModal === 'function') {
      openAdminFinanceTransferModal();
    }
  }
}
window.handleSidebarTransferClick = handleSidebarTransferClick;
  const customerSidebarToggle = document.getElementById('customer-sidebar-store-toggle-wrapper');
  if (customerSidebarToggle) {
    customerSidebarToggle.style.display = role === 'customer' ? 'block' : 'none';
  }
  const topbarCartBtn = document.getElementById('topbar-cart-btn');
  if (topbarCartBtn) {
    topbarCartBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
  }
  const overviewCartToggleBtn = document.getElementById('overview-cart-toggle-btn');
  if (overviewCartToggleBtn) {
    overviewCartToggleBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
  }
  const overviewNotifBtn = document.getElementById('overview-notif-btn');
  if (overviewNotifBtn) {
    overviewNotifBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
  }
  const isPartner = role === 'restaurant' || role === 'shop';
  const partnerOverviewNotifBtn = document.getElementById('partner-overview-notif-btn');
  if (partnerOverviewNotifBtn) {
    partnerOverviewNotifBtn.style.display = isPartner ? 'inline-flex' : 'none';
    if (isPartner && overviewPartnerSubView === 'report') {
      partnerOverviewNotifBtn.classList.remove('active');
    }
  }
  const partnerOverviewReportBtn = document.getElementById('partner-overview-report-btn');
  if (partnerOverviewReportBtn) {
    partnerOverviewReportBtn.style.display = isPartner ? 'inline-flex' : 'none';
    if (isPartner && overviewPartnerSubView === 'report') {
      partnerOverviewReportBtn.classList.add('active');
    }
  }
  const isAdmin = role === 'admin' || role === 'subadmin';
  const adminOverviewNotifBtn = document.getElementById('admin-overview-notif-btn');
  if (adminOverviewNotifBtn) {
    adminOverviewNotifBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (isAdmin && typeof overviewAdminSubView !== 'undefined' && overviewAdminSubView === 'report') {
      adminOverviewNotifBtn.classList.remove('active');
    } else if (isAdmin) {
      adminOverviewNotifBtn.classList.add('active');
    }
  }
  const adminOverviewReportBtn = document.getElementById('admin-overview-report-btn');
  if (adminOverviewReportBtn) {
    adminOverviewReportBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (isAdmin && typeof overviewAdminSubView !== 'undefined' && overviewAdminSubView === 'report') {
      adminOverviewReportBtn.classList.add('active');
    } else if (isAdmin) {
      adminOverviewReportBtn.classList.remove('active');
    }
  }
  const isRider = role === 'deliveryPartner';
  const riderOverviewNotifBtn = document.getElementById('rider-overview-notif-btn');
  if (riderOverviewNotifBtn) {
    riderOverviewNotifBtn.style.display = isRider ? 'inline-flex' : 'none';
    if (isRider && typeof overviewRiderSubView !== 'undefined' && overviewRiderSubView === 'report') {
      riderOverviewNotifBtn.classList.remove('active');
    } else if (isRider) {
      riderOverviewNotifBtn.classList.add('active');
    }
  }
  const riderOverviewReportBtn = document.getElementById('rider-overview-report-btn');
  if (riderOverviewReportBtn) {
    riderOverviewReportBtn.style.display = isRider ? 'inline-flex' : 'none';
    if (isRider && typeof overviewRiderSubView !== 'undefined' && overviewRiderSubView === 'report') {
      riderOverviewReportBtn.classList.add('active');
    } else if (isRider) {
      riderOverviewReportBtn.classList.remove('active');
    }
  }
  const orderHeaderCartBtn = document.getElementById('order-header-cart-btn');
  if (orderHeaderCartBtn) {
    orderHeaderCartBtn.style.display = role === 'customer' ? 'inline-flex' : 'none';
  }
  refreshProfileWallet();

  const initials = (user.name || 'T').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const miniAvatar = document.getElementById('mini-avatar');
  miniAvatar.textContent = initials;
  if (user.image) {
    miniAvatar.innerHTML = `<img src="${user.image}" alt="" />`;
  }

  document.getElementById('today-date').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  // Populate Location: <stateCode>,<City>,<locality>,<pincode>
  fetchUserLocation();

  // Populate Profile Settings and Sidebar User ID badges globally
  populateSettingsUserIdBadge();

  // Sync fresh profile to ensure user IDs are completely up to date for all user roles
  apiFetch('/api/auth/profile')
    .then((data) => {
      if (data?.user) {
        if (data.user.name) data.user.name = formatCleanName(data.user.name);
        if (data.user.displayName) data.user.displayName = formatCleanName(data.user.displayName);
        Object.assign(user, data.user);
        localStorage.setItem('tomatoUser', JSON.stringify(user));
        const miniNameEl = document.getElementById('mini-name');
        if (miniNameEl) miniNameEl.textContent = formatCleanName(user.displayName || user.name || 'Tomato User');
        populateSettingsUserIdBadge();
      }
    })
    .catch(() => {});

  // Initialize Duty Status Toggle for Restaurant & Rider
  initDutyStatusToggle();

  // Approval / blocked status verification
  if (user.isBlocked) {
    showStatusBanner('Your account has been restricted by the administrator. Please contact support.', 'danger');
  } else if ((role === 'restaurant' || role === 'shop' || role === 'deliveryPartner') && user.isApproved === false) {
    showStatusBanner('Your account is awaiting Admin approval. Some operations may be limited until verified.', 'warning');
  }

  // Build navigation per role
  buildNav();

  // Load overview stats & data
  loadRoleOverview();

  // Activate view: restores current active page on browser refresh, or falls back to default landing page on fresh load
  activeView = getInitialActiveView();
  switchView(activeView, null, true);

  // Restore Cart UI & Badges from persisted localStorage cart
  if (role === 'customer') {
    updateCartUI();
    if (typeof renderCheckoutCouponsSection === 'function') {
      renderCheckoutCouponsSection();
    }
  }

  // Start real-time notifications stream
  initNotificationStream();

  // Initialize rider location reporting
  initRiderLocationTracking();

  // Sign out (with Yes/No confirmation)
  const signOutBtn = document.getElementById('sign-out');
  if (signOutBtn) {
    signOutBtn.onclick = handleSignOut;
  }
}

// =========================================================================
// GLOBAL SIGN OUT CONFIRMATION SYSTEM (YES / NO)
// =========================================================================
function handleSignOut(event) {
  if (event) {
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch (_) {}
  }
  const modal = document.getElementById('sign-out-confirm-modal');
  if (modal) {
    openModal('sign-out-confirm-modal');
  } else {
    // Native browser Yes/No fallback (OK=Yes, Cancel=No)
    const confirmed = window.confirm('Are you sure you want to sign out from Tomato?\n\n• Click OK (Yes) to sign out\n• Click Cancel (No) to stay');
    if (confirmed) {
      executeSignOut();
    }
  }
}

function cancelSignOut() {
  closeModal('sign-out-confirm-modal');
}

function executeSignOut() {
  closeModal('sign-out-confirm-modal');
  if (notificationEventSource) {
    try { notificationEventSource.close(); } catch (_) {}
  }
  localStorage.removeItem('tomatoToken');
  localStorage.removeItem('tomatoUser');
  try {
    sessionStorage.removeItem(getActiveViewStorageKey());
    sessionStorage.removeItem('tomato_active_view');
  } catch (_) {}
  window.location.href = '../index.html';
}

window.handleSignOut = handleSignOut;
window.confirmSignOut = handleSignOut;
window.cancelSignOut = cancelSignOut;
window.executeSignOut = executeSignOut;

// Global event delegation for any sign-out button across the dashboard
document.addEventListener('click', (event) => {
  const trigger = event.target && event.target.closest && event.target.closest('#sign-out, .sign-out, [data-action="sign-out"], [data-sign-out]');
  if (trigger) {
    handleSignOut(event);
  }
});

// Escape key to dismiss sign-out confirmation modal (equivalent to "No, Stay")
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const modal = document.getElementById('sign-out-confirm-modal');
    if (modal && modal.classList.contains('visible')) {
      cancelSignOut();
    }
  }
});

// Navigation Drag & Drop, Persistence & Ordering
let isDraggingNav = false;

function getNavStorageKey() {
  const userId = user && (user._id || user.id || user.email);
  return `tomato_nav_order_${userId ? `${userId}_${role}` : role}`;
}

function updateResetNavButtonVisibility() {
  const hint = document.getElementById('nav-reorder-hint');
  if (!hint) return;
  let isCustomized = false;
  try {
    isCustomized = !!localStorage.getItem(getNavStorageKey());
  } catch (_) {}
  hint.style.display = isCustomized ? 'flex' : 'none';
}

function saveNavOrder() {
  const navContainer = document.getElementById('dynamic-nav');
  if (!navContainer) return;
  const currentOrder = Array.from(navContainer.querySelectorAll('.nav-item'))
    .map((el) => el.dataset.targetView)
    .filter(Boolean);
  try {
    localStorage.setItem(getNavStorageKey(), JSON.stringify(currentOrder));
  } catch (_) {}
  updateResetNavButtonVisibility();
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.nav-item:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Build Navigation Menu dynamically
function buildNav() {
  const navContainer = document.getElementById('dynamic-nav');
  if (!navContainer) return;
  navContainer.innerHTML = '';

  const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
  const hasPerm = (p) => role === 'admin' || userPerms.includes(p) || userPerms.includes('*');

  const adminItems = [
    { id: 'overview', icon: '📊', label: 'Dashboard & KPIs' },
    ...(hasPerm('orders_manage') ? [{ id: 'admin-orders', icon: '📦', label: 'Platform Orders' }] : []),
    ...(hasPerm('shops_manage') || hasPerm('restaurants_manage') ? [{ id: 'admin-shops', icon: '🏬', label: 'Shops' }] : []),
    ...(hasPerm('restaurants_manage') ? [{ id: 'admin-restaurants', icon: '🏪', label: 'Restaurants' }] : []),
    ...(hasPerm('riders_manage') ? [{ id: 'admin-riders', icon: '🚴', label: 'Riders' }] : []),
    ...(hasPerm('customers_manage') ? [{ id: 'admin-customers', icon: '👥', label: 'Customers' }] : []),
    { id: 'admin-bank', icon: '🏦', label: 'Bank' },
    { id: 'admin-finance', icon: '💰', label: 'Finance' },
    { id: 'admin-partner-billing', icon: '📑', label: 'Partners Billing' },
    { id: 'admin-coupons', icon: '🎟️', label: 'Coupon & Discount' },
    ...(hasPerm('dashboard_view') ? [{ id: 'admin-analytics', icon: '📈', label: 'Analytics' }] : []),
    { id: 'admin-complaints', icon: '⚖️', label: 'Complaint Review' },
    ...(hasPerm('subadmins_manage') ? [{ id: 'admin-subadmins', icon: '🛡️', label: 'Sub-Admins & RBAC' }] : []),
    { id: 'settings', icon: '⚙️', label: 'Platform Settings' },
  ];

  const navConfigs = {
    customer: [
      { id: 'overview', icon: '🏠', label: 'Overview' },
      { id: 'customer-order', icon: '🍽️', label: 'Order Online' },
      { id: 'customer-orders', icon: '📦', label: 'My Orders' },
      { id: 'customer-address', icon: '📍', label: 'Saved Addresses' },
      { id: 'support', icon: '🛟', label: 'Help & Support' },
      { id: 'settings', icon: '⚙️', label: 'Profile Settings' },
    ],
    restaurant: [
      { id: 'overview', icon: '🏠', label: 'Overview' },
      { id: 'restaurant-orders', icon: '🔔', label: 'Kitchen Orders' },
      { id: 'restaurant-menu', icon: '📋', label: 'Menu Management' },
      { id: 'partner-coupons', icon: '🎟️', label: 'Coupons & Offers' },
      { id: 'partner-bank', icon: '🏦', label: 'Bank & Payouts' },
      { id: 'partner-finance', icon: '💰', label: 'Finance' },
      { id: 'support', icon: '🛟', label: 'Help & Support' },
      { id: 'settings', icon: '⚙️', label: 'Restaurant Profile' },
    ],
    shop: [
      { id: 'overview', icon: '🏠', label: 'Overview' },
      { id: 'shop-orders', icon: '🛍️', label: 'Shop Orders' },
      { id: 'shop-items', icon: '📋', label: 'Item Management' },
      { id: 'partner-coupons', icon: '🎟️', label: 'Coupons & Offers' },
      { id: 'partner-bank', icon: '🏦', label: 'Bank & Payouts' },
      { id: 'partner-finance', icon: '💰', label: 'Finance' },
      { id: 'support', icon: '🛟', label: 'Help & Support' },
      { id: 'settings', icon: '⚙️', label: 'Shop Profile' },
    ],
    deliveryPartner: [
      { id: 'overview', icon: '🏠', label: 'Overview' },
      { id: 'rider-available', icon: '🚴', label: 'Available Pickups' },
      { id: 'rider-active', icon: '🚀', label: 'Active Delivery' },
      { id: 'rider-history', icon: '💰', label: 'Trip Earnings' },
      { id: 'partner-bank', icon: '🏦', label: 'Bank & Payouts' },
      { id: 'support', icon: '🛟', label: 'Help & Support' },
      { id: 'settings', icon: '⚙️', label: 'Rider Profile' },
    ],
    admin: adminItems,
    subadmin: adminItems,
  };

  const defaultItems = navConfigs[role] || navConfigs.customer;

  // Retrieve saved custom order
  let savedOrder = [];
  try {
    const rawOrder = localStorage.getItem(getNavStorageKey());
    if (rawOrder) savedOrder = JSON.parse(rawOrder);
  } catch (_) {}

  let items = [];
  if (Array.isArray(savedOrder) && savedOrder.length > 0) {
    const itemMap = new Map(defaultItems.map((item) => [item.id, item]));
    savedOrder.forEach((id) => {
      if (itemMap.has(id)) {
        items.push(itemMap.get(id));
        itemMap.delete(id);
      }
    });
    // Ensure newly added tabs appear above settings if not in savedOrder (and 'admin-partner-billing' sits right below 'admin-bank')
    ['admin-bank', 'admin-partner-billing', 'admin-coupons', 'partner-coupons', 'partner-bank', 'partner-finance', 'support', 'admin-complaints'].forEach((newId) => {
      if (newId === 'admin-partner-billing' && itemMap.has('admin-partner-billing')) {
        const billingItem = itemMap.get('admin-partner-billing');
        itemMap.delete('admin-partner-billing');
        const bankIdx = items.findIndex((it) => it.id === 'admin-bank');
        if (bankIdx !== -1) {
          items.splice(bankIdx + 1, 0, billingItem);
          return;
        }
      }
      if (newId === 'admin-coupons' && itemMap.has('admin-coupons')) {
        const couponItem = itemMap.get('admin-coupons');
        itemMap.delete('admin-coupons');
        const billingIdx = items.findIndex((it) => it.id === 'admin-partner-billing');
        const bankIdx = items.findIndex((it) => it.id === 'admin-bank');
        const insertIdx = billingIdx !== -1 ? billingIdx + 1 : bankIdx !== -1 ? bankIdx + 1 : -1;
        if (insertIdx !== -1) {
          items.splice(insertIdx, 0, couponItem);
          return;
        }
      }
      if (newId === 'partner-finance' && itemMap.has('partner-finance')) {
        const finItem = itemMap.get('partner-finance');
        itemMap.delete('partner-finance');
        const bankIdx = items.findIndex((it) => it.id === 'partner-bank');
        if (bankIdx !== -1) {
          items.splice(bankIdx + 1, 0, finItem);
          return;
        }
      }
      if (itemMap.has(newId)) {
        const newItem = itemMap.get(newId);
        itemMap.delete(newId);
        const settingsIdx = items.findIndex((it) => it.id === 'settings');
        if (settingsIdx !== -1) {
          items.splice(settingsIdx, 0, newItem);
        } else {
          items.push(newItem);
        }
      }
    });
    // Append any remaining permitted items not in savedOrder (e.g. newly granted permissions)
    itemMap.forEach((item) => {
      items.push(item);
    });
  } else {
    items = defaultItems;
  }

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = `nav-item ${item.id === activeView ? 'active' : ''}`;
    btn.type = 'button';
    btn.draggable = true;
    btn.dataset.targetView = item.id;
    btn.setAttribute('aria-grabbed', 'false');
    btn.title = `Drag to reposition "${item.label}"`;
    btn.innerHTML = `
      <span class="nav-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    `;

    btn.addEventListener('click', (e) => {
      if (isDraggingNav) {
        e.preventDefault();
        return;
      }
      switchView(item.id);
    });

    btn.addEventListener('dragstart', (e) => {
      isDraggingNav = true;
      btn.setAttribute('aria-grabbed', 'true');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
      requestAnimationFrame(() => {
        btn.classList.add('dragging');
      });
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      btn.setAttribute('aria-grabbed', 'false');
      saveNavOrder();
      setTimeout(() => {
        isDraggingNav = false;
      }, 120);
    });

    navContainer.appendChild(btn);
  });

  // Initialize dragover, drop and touch event listeners on nav container once
  if (!navContainer.dataset.dragInitialized) {
    navContainer.dataset.dragInitialized = 'true';

    navContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const draggingItem = navContainer.querySelector('.nav-item.dragging');
      if (!draggingItem) return;
      const afterElement = getDragAfterElement(navContainer, e.clientY);
      if (afterElement == null) {
        navContainer.appendChild(draggingItem);
      } else if (afterElement !== draggingItem) {
        navContainer.insertBefore(draggingItem, afterElement);
      }
    });

    navContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      saveNavOrder();
    });

    // Mobile / tablet touch reordering support
    let touchItem = null;
    let touchStartY = 0;
    let touchMoved = false;

    navContainer.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.nav-drag-handle') || e.target.closest('.nav-item');
      if (!handle) return;
      const itemEl = e.target.closest('.nav-item');
      if (!itemEl) return;
      touchItem = itemEl;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });

    navContainer.addEventListener('touchmove', (e) => {
      if (!touchItem) return;
      const currentY = e.touches[0].clientY;
      if (!touchMoved && Math.abs(currentY - touchStartY) > 8) {
        touchMoved = true;
        isDraggingNav = true;
        touchItem.classList.add('dragging');
      }
      if (touchMoved) {
        if (e.cancelable) e.preventDefault();
        const afterElement = getDragAfterElement(navContainer, currentY);
        if (afterElement == null) {
          navContainer.appendChild(touchItem);
        } else if (afterElement !== touchItem) {
          navContainer.insertBefore(touchItem, afterElement);
        }
      }
    }, { passive: false });

    navContainer.addEventListener('touchend', () => {
      if (touchItem) {
        touchItem.classList.remove('dragging');
        if (touchMoved) {
          saveNavOrder();
          setTimeout(() => {
            isDraggingNav = false;
          }, 150);
        }
        touchItem = null;
        touchMoved = false;
      }
    });
  }

  // Initialize reset button listener once
  const resetBtn = document.getElementById('nav-reset-order-btn');
  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.dataset.bound = 'true';
    resetBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(getNavStorageKey());
      } catch (_) {}
      buildNav();
    });
  }

  updateResetNavButtonVisibility();
}

// Cache tracker for view data to eliminate flocking / layout shifting
const viewLastFetched = {};

function renderTableSkeleton(label = 'records') {
  return `
    <div class="skeleton-table-wrapper" style="min-height:380px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--line);">
        <div class="skeleton-shimmer" style="height:18px; width:180px;"></div>
        <div class="skeleton-shimmer" style="height:18px; width:110px;"></div>
      </div>
      <div class="skeleton-shimmer" style="height:40px; width:100%; margin-bottom:0.6rem;"></div>
      <div class="skeleton-shimmer" style="height:48px; width:100%; margin-bottom:0.6rem;"></div>
      <div class="skeleton-shimmer" style="height:48px; width:100%; margin-bottom:0.6rem;"></div>
      <div class="skeleton-shimmer" style="height:48px; width:100%; margin-bottom:0.6rem;"></div>
      <div class="skeleton-shimmer" style="height:48px; width:100%; margin-bottom:0.6rem;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; padding-top:0.75rem; border-top:1px solid var(--line);">
        <div class="skeleton-shimmer" style="height:20px; width:140px;"></div>
        <div class="skeleton-shimmer" style="height:28px; width:160px;"></div>
      </div>
    </div>
  `;
}

function renderAnalyticsSkeleton() {
  return `
    <div style="min-height:480px;">
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
        <div class="skeleton-shimmer" style="height:105px; border-radius:10px;"></div>
        <div class="skeleton-shimmer" style="height:105px; border-radius:10px;"></div>
        <div class="skeleton-shimmer" style="height:105px; border-radius:10px;"></div>
        <div class="skeleton-shimmer" style="height:105px; border-radius:10px;"></div>
      </div>
      <div class="skeleton-shimmer" style="height:280px; border-radius:10px; margin-bottom:1.5rem;"></div>
      <div class="skeleton-shimmer" style="height:220px; border-radius:10px;"></div>
    </div>
  `;
}

// Switch View
function switchView(viewId, filter = null, force = false) {
  if (viewId === 'restaurant-orders') {
    currentRestaurantOrderFilter = filter || 'all';
    if (typeof updateRestaurantFilterButtons === 'function') {
      updateRestaurantFilterButtons();
    }
  } else if (viewId === 'shop-orders') {
    currentShopOrderFilter = filter || 'all';
    if (typeof updateShopFilterButtons === 'function') {
      updateShopFilterButtons();
    }
  } else if (viewId === 'customer-orders') {
    currentCustomerOrderFilter = filter || 'all';
    if (typeof updateCustomerFilterButtons === 'function') {
      updateCustomerFilterButtons();
    }
  }

  if (activeView === viewId && !force) {
    if (viewId === 'restaurant-orders') {
      if (cachedRestaurantOrders && cachedRestaurantOrders.length) {
        renderRestaurantOrdersTable(cachedRestaurantOrders);
      } else {
        fetchRestaurantOrders();
      }
    } else if (viewId === 'shop-orders') {
      if (cachedShopOrders && cachedShopOrders.length) {
        renderShopOrdersTable(cachedShopOrders);
      } else {
        fetchShopOrders();
      }
    } else if (viewId === 'customer-orders') {
      if (cachedCustomerOrders && cachedCustomerOrders.length) {
        renderCustomerOrdersList(cachedCustomerOrders);
      } else {
        fetchCustomerOrders();
      }
    } else if (viewId === 'customer-order') {
      if (isCustomerCartViewActive) {
        toggleCustomerOrderCart(false);
      }
    } else if (viewId === 'overview') {
      if (role === 'customer') {
        showOverviewCartView();
      } else if (role === 'restaurant' || role === 'shop') {
        showOverviewPartnerReportView();
      } else if (role === 'deliveryPartner') {
        if (typeof overviewRiderSubView !== 'undefined' && overviewRiderSubView === 'notifications') {
          showOverviewNotificationsView();
          loadNotifications();
        } else {
          showOverviewRiderReportView();
        }
      } else if (role === 'admin' || role === 'subadmin') {
        if (typeof overviewAdminSubView !== 'undefined' && overviewAdminSubView === 'notifications') {
          showOverviewNotificationsView();
          loadNotifications();
        } else {
          showOverviewAdminReportView();
        }
      } else {
        showOverviewNotificationsView();
        loadNotifications();
      }
    } else if (viewId === 'admin-partner-billing') {
      if (typeof refreshAdminPartnerBillingCurrentTab === 'function') {
        refreshAdminPartnerBillingCurrentTab();
      } else {
        fetchAdminPartnerBilling();
      }
    } else if (viewId === 'admin-finance') {
      if (typeof fetchAdminFinanceTransfers === 'function') {
        fetchAdminFinanceTransfers();
      }
    }
    return;
  }
  activeView = viewId;

  // Persist current active view so page refresh keeps user on the same page
  try {
    sessionStorage.setItem(getActiveViewStorageKey(), viewId);
    sessionStorage.setItem('tomato_active_view', viewId);
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', `#${viewId}`);
    }
  } catch (_) {}

  // Nav active state
  document.querySelectorAll('#dynamic-nav .nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.targetView === viewId);
  });

  // Hide all views
  document.querySelectorAll('.view-section').forEach((sec) => sec.classList.remove('active'));

  // Show target view
  const targetSec = document.getElementById(`${viewId}-view`);
  if (targetSec) {
    targetSec.classList.add('active');
  }

  // Close overview cart if switching to another view
  if (viewId !== 'overview') {
    const overviewDrawer = document.getElementById('overview-cart-drawer');
    if (overviewDrawer && overviewDrawer.style.display !== 'none') {
      overviewDrawer.style.display = 'none';
    }
  }

  // Trigger view data refresh
  if (viewId === 'overview') {
    if (role === 'customer') {
      showOverviewCartView();
    } else if (role === 'restaurant' || role === 'shop') {
      showOverviewPartnerReportView();
    } else if (role === 'deliveryPartner') {
      if (typeof overviewRiderSubView !== 'undefined' && overviewRiderSubView === 'notifications') {
        showOverviewNotificationsView();
        loadNotifications();
      } else {
        showOverviewRiderReportView();
      }
    } else if (role === 'admin' || role === 'subadmin') {
      if (typeof overviewAdminSubView !== 'undefined' && overviewAdminSubView === 'notifications') {
        showOverviewNotificationsView();
        loadNotifications();
      } else {
        showOverviewAdminReportView();
      }
    } else {
      showOverviewNotificationsView();
      loadNotifications();
    }
  } else if (viewId === 'customer-order') {
    if (isCustomerCartViewActive) {
      toggleCustomerOrderCart(false);
    }
    loadCustomerMenuSection();
  } else if (viewId === 'customer-orders') {
    fetchCustomerOrders();
  } else if (viewId === 'customer-address') {
    fetchCustomerAddresses();
  } else if (viewId === 'restaurant-orders') {
    fetchRestaurantOrders();
  } else if (viewId === 'restaurant-menu') {
    fetchRestaurantMenu();
  } else if (viewId === 'shop-orders') {
    fetchShopOrders();
  } else if (viewId === 'shop-items') {
    fetchShopItems();
  } else if (viewId === 'rider-available') {
    fetchAvailableRiderOrders();
  } else if (viewId === 'rider-active') {
    fetchActiveRiderOrders();
  } else if (viewId === 'rider-history') {
    fetchRiderHistory();
  } else if (viewId === 'admin-orders') {
    fetchAdminOrders();
  } else if (viewId === 'admin-shops') {
    fetchAdminShops();
  } else if (viewId === 'admin-restaurants') {
    fetchAdminRestaurants();
  } else if (viewId === 'admin-riders') {
    fetchAdminRiders();
  } else if (viewId === 'admin-customers') {
    fetchAdminCustomers();
  } else if (viewId === 'admin-analytics') {
    fetchAdminAnalytics();
  } else if (viewId === 'admin-subadmins') {
    fetchAdminSubAdmins();
  } else if (viewId === 'admin-complaints') {
    fetchAdminComplaints();
  } else if (viewId === 'admin-bank') {
    loadAdminBankPanel();
  } else if (viewId === 'admin-finance') {
    if (typeof loadAdminFinancePanel === 'function') {
      loadAdminFinancePanel();
    }
  } else if (viewId === 'admin-partner-billing') {
    if (typeof refreshAdminPartnerBillingCurrentTab === 'function') {
      refreshAdminPartnerBillingCurrentTab();
    } else {
      fetchAdminPartnerBilling();
    }
  } else if (viewId === 'admin-coupons') {
    fetchAdminCoupons();
  } else if (viewId === 'partner-bank') {
    loadPartnerBankPanel();
  } else if (viewId === 'partner-finance') {
    if (typeof loadPartnerFinancePanel === 'function') {
      loadPartnerFinancePanel();
    }
  } else if (viewId === 'partner-coupons') {
    fetchPartnerCoupons();
  } else if (viewId === 'support') {
    loadSupportPanel();
  } else if (viewId === 'settings') {
    loadProfileSettings();
  } else if (viewId === 'overview') {
    loadRoleOverview();
    if (role === 'deliveryPartner' && typeof overviewRiderSubView !== 'undefined' && overviewRiderSubView === 'report') {
      if (typeof showOverviewRiderReportView === 'function') {
        showOverviewRiderReportView();
      }
    }
  }
}

// =========================================================================
// AUTO-DISMISS NOTICE POPUP & STAT CARD CLICK HANDLERS
// =========================================================================
let noticeModalTimer = null;
function showAutoDismissNotice({ title = 'Notice', message = '', icon = 'ℹ️', duration = 2500 }) {
  const modal = document.getElementById('notice-auto-dismiss-modal');
  const titleEl = document.getElementById('notice-modal-title');
  const msgEl = document.getElementById('notice-modal-message');
  const iconEl = document.getElementById('notice-modal-icon');

  if (noticeModalTimer) {
    clearTimeout(noticeModalTimer);
    noticeModalTimer = null;
  }

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (iconEl) iconEl.textContent = icon;

  if (modal) {
    modal.classList.add('visible');
    modal.style.display = 'grid';
    modal.style.opacity = '1';

    noticeModalTimer = setTimeout(() => {
      closeNoticeModal();
    }, duration);
  }

  // Also trigger toast notification for immediate corner alert
  showToastNotification({
    title,
    message,
    type: 'info',
    duration: Math.max(duration, 3000),
  });
}

function closeNoticeModal() {
  if (noticeModalTimer) {
    clearTimeout(noticeModalTimer);
    noticeModalTimer = null;
  }
  const modal = document.getElementById('notice-auto-dismiss-modal');
  if (modal) {
    modal.style.transition = 'opacity 0.2s ease';
    modal.style.opacity = '0';
    setTimeout(() => {
      modal.classList.remove('visible');
      modal.style.display = 'none';
      modal.style.opacity = '1';
    }, 200);
  }
}

function handleNoticeModalBackdropClick(event) {
  if (event.target.id === 'notice-auto-dismiss-modal') {
    closeNoticeModal();
  }
}

function handleActiveOrdersCardClick(activeCount) {
  if (activeCount > 0) {
    switchView('customer-orders', 'active');
  } else {
    showAutoDismissNotice({
      title: 'Active Orders',
      message: 'No active orders',
      icon: '🛵',
      duration: 2500,
    });
  }
}

function handleTotalPlacedCardClick(totalCount) {
  if (totalCount > 0) {
    switchView('customer-orders', 'all');
  } else {
    showAutoDismissNotice({
      title: 'Total Placed',
      message: 'You have not placed any order yet',
      icon: '🍽️',
      duration: 2500,
    });
  }
}

function handleSavedAddressesCardClick() {
  switchView('customer-address');
  fetchCustomerAddresses();
}

function handleRestaurantNewIncomingCardClick() {
  switchView('restaurant-orders', 'incoming');
}

function handleRestaurantMenuItemsCardClick() {
  switchView('restaurant-menu');
}

function handleRestaurantCookingCardClick() {
  switchView('restaurant-orders', 'cooking');
}

function handleShopNewIncomingCardClick() {
  switchView('shop-orders', 'incoming');
}

function handleShopPackingCardClick() {
  switchView('shop-orders', 'cooking');
}

function handleShopItemsCardClick() {
  switchView('shop-items');
}

window.showAutoDismissNotice = showAutoDismissNotice;
window.closeNoticeModal = closeNoticeModal;
window.handleNoticeModalBackdropClick = handleNoticeModalBackdropClick;
window.handleActiveOrdersCardClick = handleActiveOrdersCardClick;
window.handleTotalPlacedCardClick = handleTotalPlacedCardClick;
window.handleSavedAddressesCardClick = handleSavedAddressesCardClick;
window.handleRestaurantNewIncomingCardClick = handleRestaurantNewIncomingCardClick;
window.handleRestaurantCookingCardClick = handleRestaurantCookingCardClick;
window.handleRestaurantMenuItemsCardClick = handleRestaurantMenuItemsCardClick;
window.handleShopNewIncomingCardClick = handleShopNewIncomingCardClick;
window.handleShopPackingCardClick = handleShopPackingCardClick;
window.handleShopItemsCardClick = handleShopItemsCardClick;

// =========================================================================
// OVERVIEW STATS & ACTIVITY
// =========================================================================
async function loadRoleOverview() {
  const statsEl = document.getElementById('stats-container');
  const kickerEl = document.getElementById('role-kicker');
  const headingEl = document.getElementById('welcome-heading');
  const copyEl = document.getElementById('welcome-copy');

  headingEl.textContent = `Good to see you, ${(user.name || 'there').split(' ')[0]}.`;

  if (role === 'customer') {
    kickerEl.textContent = 'Customer Ordering Hub';
    copyEl.textContent = 'Browse kitchens, place food orders, and track deliveries in real time.';
    try {
      const [ordersData, addrData] = await Promise.all([
        apiFetch('/api/customer/orders').catch(() => ({ orders: [] })),
        apiFetch('/api/customer/addresses').catch(() => ({ addresses: [] })),
      ]);
      const orders = ordersData.orders || [];
      const activeOrders = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length;

      statsEl.innerHTML = `
        <div class="stat-card clickable" onclick="handleActiveOrdersCardClick(${activeOrders})" title="Click to view active orders">
          <span class="stat-label">Active Orders</span>
          <div class="stat-value">${activeOrders}</div>
          <span class="stat-note">Live on route ${activeOrders > 0 ? '↗' : ''}</span>
        </div>
        <div class="stat-card clickable" onclick="handleTotalPlacedCardClick(${orders.length})" title="Click to view all orders">
          <span class="stat-label">Total Placed</span>
          <div class="stat-value">${orders.length}</div>
          <span class="stat-note">Lifetime meals ${orders.length > 0 ? '↗' : ''}</span>
        </div>
        <div class="stat-card clickable" onclick="handleSavedAddressesCardClick()" title="Click to manage saved delivery addresses">
          <span class="stat-label">Saved Addresses</span>
          <div class="stat-value">${addrData.addresses?.length || 0}</div>
          <span class="stat-note">Ready for checkout ↗</span>
        </div>
        <div class="stat-card"><span class="stat-label">Tomato Points</span><div class="stat-value">250</div><span class="stat-note">Earn 10% off</span></div>
      `;

      const addresses = addrData.addresses || [];
      const defaultAddr = addresses.find((a) => a.isDefault) || addresses[0];
      if (defaultAddr) {
        fetchUserLocation(defaultAddr);
      }
    } catch (e) {
      console.error(e);
    }
  } else if (role === 'restaurant') {
    kickerEl.textContent = 'Restaurant Kitchen Manager';
    copyEl.textContent = 'Manage your menu dishes, accept incoming orders, and generate official bills.';
    try {
      const [ordersData, menuData] = await Promise.all([
        apiFetch('/api/restaurant/orders').catch(() => ({ orders: [] })),
        apiFetch('/api/restaurant/menu').catch(() => ({ menu: [] })),
      ]);
      const orders = ordersData.orders || [];
      const newOrders = orders.filter((o) => o.status === 'placed').length;
      const preparingOrders = orders.filter((o) => ['accepted', 'preparing'].includes(o.status)).length;
      const revenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      statsEl.innerHTML = `
        <div class="stat-card clickable" onclick="handleRestaurantNewIncomingCardClick()" title="Click to view new incoming orders (Placed)">
          <span class="stat-label">New Incoming</span>
          <div class="stat-value" style="color:var(--tomato);">${newOrders}</div>
          <span class="stat-note">Needs acceptance ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleRestaurantCookingCardClick()" title="Click to view orders on stove / cooking (Accepted, Preparing, Out for Delivery)">
          <span class="stat-label">On Stove / Cooking</span>
          <div class="stat-value">${preparingOrders}</div>
          <span class="stat-note">Kitchen active ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleRestaurantMenuItemsCardClick()" title="Click to open Menu Management">
          <span class="stat-label">Menu Items</span>
          <div class="stat-value">${menuData.menu?.length || 0}</div>
          <span class="stat-note">Dishes available ↗</span>
        </div>
        <div class="stat-card"><span class="stat-label">Sales Volume</span><div class="stat-value">₹${revenue.toFixed(0)}</div><span class="stat-note">Total generated</span></div>
      `;
    } catch (e) {
      console.error(e);
    }
  } else if (role === 'shop') {
    kickerEl.textContent = 'Shop Store Manager';
    copyEl.textContent = 'Manage your shop inventory, accept incoming orders, pack items, and generate official bills.';
    try {
      const [ordersData, itemsData] = await Promise.all([
        apiFetch('/api/shop/orders').catch(() => ({ orders: [] })),
        apiFetch('/api/shop/items').catch(() => ({ items: [] })),
      ]);
      const orders = ordersData.orders || [];
      const newOrders = orders.filter((o) => o.status === 'placed').length;
      const packingOrders = orders.filter((o) => {
        const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
        return st === 'accepted' || st === 'preparing' || st === 'out for delivery';
      }).length;
      const revenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      statsEl.innerHTML = `
        <div class="stat-card clickable" onclick="handleShopNewIncomingCardClick()" title="Click to view new incoming orders (Placed)">
          <span class="stat-label">New Incoming</span>
          <div class="stat-value" style="color:var(--tomato);">${newOrders}</div>
          <span class="stat-note">Needs acceptance ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleShopPackingCardClick()" title="Click to view orders in packing / processing">
          <span class="stat-label">In Packing / Processing</span>
          <div class="stat-value">${packingOrders}</div>
          <span class="stat-note">Store active ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleShopItemsCardClick()" title="Click to open Item Management">
          <span class="stat-label">Shop Items</span>
          <div class="stat-value">${itemsData.items?.length || 0}</div>
          <span class="stat-note">Items in catalog ↗</span>
        </div>
        <div class="stat-card"><span class="stat-label">Sales Volume</span><div class="stat-value">₹${revenue.toFixed(0)}</div><span class="stat-note">Total generated</span></div>
      `;
    } catch (e) {
      console.error(e);
    }
  } else if (role === 'deliveryPartner') {
    kickerEl.textContent = 'Delivery Partner Fleet';
    copyEl.textContent = 'Check restaurant locations, accept pickup orders, and deliver to customer doorsteps.';
    try {
      const [availData, activeData, histData] = await Promise.all([
        apiFetch('/api/rider/orders/available').catch(() => ({ orders: [] })),
        apiFetch('/api/rider/orders/active').catch(() => ({ orders: [] })),
        apiFetch('/api/rider/orders/history').catch(() => ({ orders: [], totalEarnings: 0, totalDeliveries: 0 })),
      ]);

      const allOrders = histData.orders || [];
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Filter deliveries completed today
      const todayDeliveredOrders = allOrders.filter((o) => {
        const orderDate = new Date(o.updatedAt || o.createdAt || o.date);
        return orderDate >= startOfToday;
      });

      const todayDeliveriesCount = todayDeliveredOrders.length;
      const todayEarnings = todayDeliveriesCount * 40;

      const todayCodCollections = {
        cash: todayDeliveredOrders
          .filter(o => o.paymentMethod === 'cod' && o.codCollectedVia !== 'upi')
          .reduce((s, o) => s + Number(o.totalAmount || 0), 0),
        upi: todayDeliveredOrders
          .filter(o => o.paymentMethod === 'cod' && o.codCollectedVia === 'upi')
          .reduce((s, o) => s + Number(o.totalAmount || 0), 0),
        total: todayDeliveredOrders
          .filter(o => o.paymentMethod === 'cod')
          .reduce((s, o) => s + Number(o.totalAmount || 0), 0),
      };

      statsEl.innerHTML = `
        <div class="stat-card clickable" onclick="switchView('rider-available')" title="Click to view available pickups">
          <span class="stat-label">Available Pickups</span>
          <div class="stat-value" style="color:var(--tomato);">${availData.orders?.length || 0}</div>
          <span class="stat-note">Ready for pickup ↗</span>
        </div>
        <div class="stat-card clickable" onclick="switchView('rider-active')" title="Click to view active trip in progress">
          <span class="stat-label">Active Trip</span>
          <div class="stat-value">${activeData.orders?.length || 0}</div>
          <span class="stat-note">In transit ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleRiderOverviewReportClick()" title="Click to view Delivery & Earnings Report (Delivered Today: ${todayDeliveriesCount})">
          <span class="stat-label">Delivered Orders</span>
          <div class="stat-value">${todayDeliveriesCount}</div>
          <span class="stat-note">Delivered today ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleRiderOverviewReportClick()" title="Click to view Delivery & Collections Report (Collected Today: ₹${Number(todayCodCollections.total || 0).toLocaleString('en-IN')})">
          <span class="stat-label">Collections</span>
          <div class="stat-value" style="color:#0f172a;">₹${Number(todayCodCollections.total || 0).toLocaleString('en-IN')}</div>
          <span class="stat-note" style="font-weight:700; color:#1d4ed8;">UPI: ₹${Number(todayCodCollections.upi || 0).toLocaleString('en-IN')} / Cash: ₹${Number(todayCodCollections.cash || 0).toLocaleString('en-IN')} (Today) ↗</span>
        </div>
        <div class="stat-card clickable" onclick="handleRiderOverviewReportClick()" title="Click to view Delivery & Earnings Report (Earned Today: ₹${todayEarnings})">
          <span class="stat-label">Trip Earnings</span>
          <div class="stat-value" style="color:var(--green);">₹${Number(todayEarnings).toLocaleString('en-IN')}</div>
          <span class="stat-note">₹40 per delivery today ↗</span>
        </div>
      `;
    } catch (e) {
      console.error(e);
    }
  } else if (role === 'admin' || role === 'subadmin') {
    kickerEl.textContent = role === 'subadmin' ? `Sub-Admin • ${user.adminRoleTitle || 'Operations'}` : 'Platform Administration';
    copyEl.textContent = role === 'subadmin'
      ? 'Access operational tools and manage platform data according to your assigned permissions.'
      : 'Monitor platform transactions, approve or block partners, manage sub-admins, and view analytics.';
    try {
      const data = await apiFetch('/api/admin/dashboard').catch(() => ({ kpis: {} }));
      const kpis = data.kpis || {};

      const todayRev = kpis.todayRevenue != null ? kpis.todayRevenue : kpis.totalRevenue;
      statsEl.innerHTML = `
        <div class="stat-card"><span class="stat-label">Platform GMV (Today)</span><div class="stat-value" style="color:var(--green);">₹${Number(todayRev || 0).toFixed(0)}</div><span class="stat-note">Lifetime: ₹${Number(kpis.totalRevenue || 0).toFixed(0)}</span></div>
        <div class="stat-card clickable" onclick="switchView('admin-orders')"><span class="stat-label">Total Orders</span><div class="stat-value">${kpis.totalOrders || 0}</div><span class="stat-note">${kpis.activeOrders || 0} in progress ↗</span></div>
        <div class="stat-card clickable" onclick="switchView('admin-shops')"><span class="stat-label">Shops</span><div class="stat-value">${kpis.totalShops || 0}</div><span class="stat-note">${kpis.pendingShops || 0} pending review ↗</span></div>
        <div class="stat-card clickable" onclick="switchView('admin-restaurants')"><span class="stat-label">Restaurants</span><div class="stat-value">${kpis.totalRestaurants || 0}</div><span class="stat-note">${kpis.pendingRestaurants || 0} pending review ↗</span></div>
        <div class="stat-card clickable" onclick="switchView('admin-riders')"><span class="stat-label">Delivery Fleet</span><div class="stat-value">${kpis.totalRiders || 0}</div><span class="stat-note">${kpis.pendingRiders || 0} pending review ↗</span></div>
      `;
    } catch (e) {
      console.error(e);
    }
  }

  loadNotifications(1);
}

let currentNotifications = [];
let currentNotifPage = 1;
const NOTIFICATIONS_PER_PAGE = 5;

function isOverviewCartDrawerOpen() {
  const drawer = document.getElementById('overview-cart-drawer');
  return !!(drawer && drawer.style.display !== 'none');
}

function isOverviewPartnerReportOpen() {
  const container = document.getElementById('overview-partner-report-container');
  return !!(container && container.style.display !== 'none');
}

async function loadNotifications(targetPage = null) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  if (targetPage !== null) {
    currentNotifPage = targetPage;
  }

  const countBadge = document.getElementById('notif-count-badge');
  const paginationBar = document.getElementById('notif-pagination-container');

  if (!currentNotifications.length) {
    feed.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; padding:0.5rem 0;">Loading updates...</p>';
  }

  try {
    let endpointRole = role;
    if (role === 'deliveryPartner' || role === 'rider') {
      endpointRole = 'rider';
    } else if (role === 'subadmin') {
      endpointRole = 'admin';
    }
    const endpoint = `/api/${endpointRole}/notifications`;
    const data = await apiFetch(endpoint);
    currentNotifications = Array.isArray(data.notifications) ? data.notifications : [];

    if (countBadge) {
      countBadge.textContent = `${currentNotifications.length} ${currentNotifications.length === 1 ? 'Update' : 'Updates'}`;
    }

    const notifBtnBadge = document.getElementById('overview-notif-badge') || document.getElementById('overview-notif-btn-badge');
    if (notifBtnBadge) {
      if (currentNotifications.length > 0) {
        notifBtnBadge.textContent = String(currentNotifications.length);
        notifBtnBadge.style.display = 'inline-block';
      } else {
        notifBtnBadge.style.display = 'none';
      }
    }

    const partnerNotifBadge = document.getElementById('partner-overview-notif-badge');
    if (partnerNotifBadge) {
      if (currentNotifications.length > 0) {
        partnerNotifBadge.textContent = String(currentNotifications.length);
        partnerNotifBadge.style.display = 'inline-block';
      } else {
        partnerNotifBadge.style.display = 'none';
      }
    }

    const adminNotifBadge = document.getElementById('admin-overview-notif-badge');
    if (adminNotifBadge) {
      if (currentNotifications.length > 0) {
        adminNotifBadge.textContent = String(currentNotifications.length);
        adminNotifBadge.style.display = 'inline-block';
      } else {
        adminNotifBadge.style.display = 'none';
      }
    }

    if (!currentNotifications.length) {
      feed.innerHTML = `
        <div style="text-align:center; padding:2rem 1rem; color:var(--muted);">
          <div style="font-size:1.8rem; margin-bottom:0.4rem;">🔔</div>
          <strong style="font-size:0.95rem; color:var(--ink);">All Caught Up!</strong>
          <p style="margin:0.25rem 0 0; font-size:0.85rem;">No new notifications right now. Any live platform updates will appear here.</p>
        </div>
      `;
      if (paginationBar) paginationBar.style.display = 'none';
      if (isOverviewCartDrawerOpen() || isOverviewPartnerReportOpen()) {
        feed.style.display = 'none';
      }
      return;
    }

    const totalPages = Math.ceil(currentNotifications.length / NOTIFICATIONS_PER_PAGE);
    if (currentNotifPage > totalPages) currentNotifPage = totalPages;
    if (currentNotifPage < 1) currentNotifPage = 1;

    renderNotifPage(currentNotifPage);
    renderNotifPaginationControls();

    if (isOverviewCartDrawerOpen() || isOverviewPartnerReportOpen()) {
      if (feed) feed.style.display = 'none';
      if (paginationBar) paginationBar.style.display = 'none';
      if (countBadge) countBadge.style.display = 'none';
    }
  } catch (e) {
    console.error('Error loading notifications:', e);
    if (!currentNotifications.length) {
      feed.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; padding:0.5rem 0;">Unable to load notifications.</p>';
      if (paginationBar) paginationBar.style.display = 'none';
    }
    if (isOverviewCartDrawerOpen() || isOverviewPartnerReportOpen()) {
      if (feed) feed.style.display = 'none';
      if (paginationBar) paginationBar.style.display = 'none';
    }
  }
}

function renderNotifPage(page) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  if (isOverviewCartDrawerOpen()) {
    feed.style.display = 'none';
  }

  const startIndex = (page - 1) * NOTIFICATIONS_PER_PAGE;
  const endIndex = startIndex + NOTIFICATIONS_PER_PAGE;
  const pageItems = currentNotifications.slice(startIndex, endIndex);

  if (!pageItems.length) {
    feed.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; padding:0.5rem 0;">No updates on this page.</p>';
    return;
  }

  feed.innerHTML = pageItems.map((n) => {
    const dateObj = new Date(n.createdAt);
    const timeStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Just now';

    return `
      <div class="notif-item">
        <div style="flex:1; padding-right:1rem;">
          <div class="notif-title">
            <span>🔔</span>
            <span>${escapeHtml(n.title || 'Notification')}</span>
          </div>
          <p class="notif-message">${escapeHtml(n.message || '')}</p>
        </div>
        <time class="notif-time-badge">${timeStr}</time>
      </div>
    `;
  }).join('');
}

function renderNotifPaginationControls() {
  const paginationBar = document.getElementById('notif-pagination-container');
  const infoEl = document.getElementById('notif-pagination-info');
  const prevBtn = document.getElementById('notif-prev-btn');
  const nextBtn = document.getElementById('notif-next-btn');
  const pageNumbersEl = document.getElementById('notif-page-numbers');

  if (!paginationBar) return;

  if (isOverviewCartDrawerOpen()) {
    paginationBar.style.display = 'none';
    return;
  }

  const totalItems = currentNotifications.length;
  const totalPages = Math.ceil(totalItems / NOTIFICATIONS_PER_PAGE);

  paginationBar.style.display = 'flex';

  const startItem = (currentNotifPage - 1) * NOTIFICATIONS_PER_PAGE + 1;
  const endItem = Math.min(currentNotifPage * NOTIFICATIONS_PER_PAGE, totalItems);

  if (infoEl) {
    infoEl.textContent = `Showing ${startItem}–${endItem} of ${totalItems} updates (Page ${currentNotifPage} of ${Math.max(1, totalPages)})`;
  }

  if (prevBtn) {
    prevBtn.disabled = currentNotifPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = currentNotifPage >= totalPages;
  }

  if (pageNumbersEl) {
    let pagesHtml = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentNotifPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    if (startPage > 1) {
      pagesHtml += `<button class="notif-page-btn" type="button" onclick="goToNotifPage(1)">1</button>`;
      if (startPage > 2) {
        pagesHtml += `<span style="color:var(--muted); font-size:0.8rem; padding:0 0.15rem;">…</span>`;
      }
    }

    for (let p = startPage; p <= endPage; p++) {
      pagesHtml += `
        <button class="notif-page-btn ${p === currentNotifPage ? 'active' : ''}" type="button" onclick="goToNotifPage(${p})">
          ${p}
        </button>
      `;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pagesHtml += `<span style="color:var(--muted); font-size:0.8rem; padding:0 0.15rem;">…</span>`;
      }
      pagesHtml += `<button class="notif-page-btn" type="button" onclick="goToNotifPage(${totalPages})">${totalPages}</button>`;
    }

    pageNumbersEl.innerHTML = pagesHtml;
  }
}

function changeNotifPage(delta) {
  const totalPages = Math.ceil(currentNotifications.length / NOTIFICATIONS_PER_PAGE);
  const newPage = currentNotifPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    goToNotifPage(newPage);
  }
}

function goToNotifPage(page) {
  currentNotifPage = page;
  renderNotifPage(currentNotifPage);
  renderNotifPaginationControls();
}


// =========================================================================
// SUPPORT & HELP DESK (CUSTOMER, RESTAURANT, SHOP)
// =========================================================================
function getSupportTicketsStorageKey() {
  const userId = user && (user._id || user.id || user.email);
  return `tomato_support_tickets_${userId ? `${userId}_${role}` : role}`;
}

function loadSupportPanel() {
  // Update role badge & description
  const roleBadge = document.getElementById('support-role-badge');
  const supportMeta = document.getElementById('support-meta');
  const orderRefLabel = document.getElementById('support-order-ref-label');
  const orderRefInput = document.getElementById('support-order-ref');
  const categorySelect = document.getElementById('support-category');

  let badgeText = 'Customer Help';
  let badgeBg = '#e0f2fe';
  let badgeColor = '#0369a1';
  let metaText = 'Instant assistance, order queries, ticket resolution and operational FAQs';
  let orderRefText = 'Related Order / Reference ID (Optional)';
  let orderRefPlaceholder = 'e.g. ORD-10023';

  let categories = [
    'Order Delay / Live Tracking Issue',
    'Missing or Incorrect Food Items',
    'Payment Deducted / Refund & Wallet Query',
    'Food Quality or Packaging Complaint',
    'Delivery Partner / Rider Coordination',
    'Account, Profile & App Feedback',
    'General Inquiry'
  ];

  if (role === 'restaurant') {
    badgeText = 'Restaurant Partner Help';
    badgeBg = '#fef3c7';
    badgeColor = '#92400e';
    metaText = 'Kitchen operations support, order dispatch issues, menu approval and billing inquiries';
    orderRefText = 'Related Kitchen Order / Settlement ID (Optional)';
    orderRefPlaceholder = 'e.g. ORD-5501 or BATCH-99';
    categories = [
    'Kitchen Order Delay / Prep Issues',
    'Rider Pickup Coordination Delay',
    'Menu Item, Pricing & Stock Availability',
    'Payout, Commission & Bank Settlements',
    'Operating Hours & Outlet Online Status',
    'Order Cancellation & Customer Disputes',
    'Merchant Technical / Dashboard Support'
    ];
  } else if (role === 'shop') {
    badgeText = 'Shop Partner Help';
    badgeBg = '#f3e8ff';
    badgeColor = '#6b21a8';
    metaText = 'Retail dispatch support, inventory synchronization, grocery orders and payout queries';
    orderRefText = 'Related Shop Order ID / Item SKU (Optional)';
    orderRefPlaceholder = 'e.g. ORD-8810 or SKU-201';
    categories = [
    'Shop Order Packing & Dispatch Issue',
    'Rider Pickup Coordination Delay',
    'Catalog, Inventory & Stock Sync Issue',
    'Weekly Payouts & Settlement Query',
    'Store Timings & Customer Inquiries',
    'Barcode / Scanner & System Query',
    'Retailer Technical Support'
    ];
  } else if (role === 'deliveryPartner' || role === 'rider') {
    badgeText = 'Rider Delivery Help';
    badgeBg = '#dcfce7';
    badgeColor = '#166534';
    metaText = 'Live trip routing assistance, restaurant delays, earnings reconciliation and emergency support';
    orderRefText = 'Related Delivery Trip ID (Optional)';
    orderRefPlaceholder = 'e.g. TRIP-3304';
    categories = [
    'Delivery Address Navigation Issue',
    'Customer Unreachable / Phone Switched Off',
    'Restaurant / Shop Pickup Delay',
    'Trip Earnings & Wallet Payout Query',
    'Accident / Vehicle Breakdown / Emergency',
    'Rider App Technical Issue'
    ];
  }

  if (roleBadge) {
    roleBadge.textContent = badgeText;
    roleBadge.style.background = badgeBg;
    roleBadge.style.color = badgeColor;
  }
  if (supportMeta) {
    supportMeta.textContent = metaText;
  }
  if (orderRefLabel) {
    orderRefLabel.textContent = orderRefText;
  }
  if (orderRefInput) {
    orderRefInput.placeholder = orderRefPlaceholder;
  }

  if (categorySelect) {
    categorySelect.innerHTML = categories
    .map((cat, idx) => `<option value="${escapeHtml(cat)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
  }

  renderSupportTicketsList();
  renderSupportFAQs();
}
window.loadSupportPanel = loadSupportPanel;

async function submitSupportTicket(e) {
  if (e && e.preventDefault) e.preventDefault();
  const categoryEl = document.getElementById('support-category');
  const priorityEl = document.getElementById('support-priority');
  const orderRefEl = document.getElementById('support-order-ref');
  const subjectEl = document.getElementById('support-subject');
  const descriptionEl = document.getElementById('support-description');
  const submitBtn = e?.target ? e.target.querySelector('button[type="submit"]') : null;

  const category = categoryEl ? categoryEl.value.trim() : 'General Inquiry';
  const priority = priorityEl ? priorityEl.value.trim() : 'Normal';
  const orderRef = orderRefEl ? orderRefEl.value.trim() : '';
  const subject = subjectEl ? subjectEl.value.trim() : '';
  const description = descriptionEl ? descriptionEl.value.trim() : '';

  if (!subject || !description) {
    alert('Please enter both a Subject and Detailed Description for your ticket.');
    return;
  }

  const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Submit Ticket';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Submitting...';
  }

  try {
    const res = await apiFetch('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify({
    category,
    priority,
    orderRef,
    subject,
    description,
    }),
    });

    const createdTicket = res.ticket || {
    ticketId: `TKT-${Math.floor(100000 + Math.random() * 900000)}`,
    category,
    priority,
    orderRef,
    subject,
    description,
    status: 'Open',
    createdAt: new Date().toISOString(),
    };

    // Also save in local cache
    let tickets = [];
    try {
    const raw = localStorage.getItem(getSupportTicketsStorageKey());
    if (raw) tickets = JSON.parse(raw);
    } catch (_) {}
    if (!Array.isArray(tickets)) tickets = [];
    tickets.unshift(createdTicket);
    try {
    localStorage.setItem(getSupportTicketsStorageKey(), JSON.stringify(tickets));
    } catch (_) {}

    if (subjectEl) subjectEl.value = '';
    if (descriptionEl) descriptionEl.value = '';
    if (orderRefEl) orderRefEl.value = '';

    renderSupportTicketsList();

    showToastNotification({
    title: 'Support Ticket Logged',
    message: `Ticket ${createdTicket.ticketId || createdTicket.id} received and queued in Complaint Review Desk`,
    type: 'success',
    });

    alert(`✅ Support Ticket Created Successfully!\nTicket ID: ${createdTicket.ticketId || createdTicket.id}\nCategory: ${category}\nPriority: ${priority}\n\nThis ticket has been sent to the Admin & Sub-Admin Complaint Review Desk for immediate review.`);
  } catch (err) {
    console.error('Support ticket submission error:', err);
    // Fallback to local storage if API failed
    const fallbackId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
    const fallbackTicket = {
    id: fallbackId,
    ticketId: fallbackId,
    role,
    category,
    priority,
    orderRef,
    subject,
    description,
    status: 'Open',
    createdAt: new Date().toISOString(),
    };

    let tickets = [];
    try {
    const raw = localStorage.getItem(getSupportTicketsStorageKey());
    if (raw) tickets = JSON.parse(raw);
    } catch (_) {}
    if (!Array.isArray(tickets)) tickets = [];
    tickets.unshift(fallbackTicket);
    try {
    localStorage.setItem(getSupportTicketsStorageKey(), JSON.stringify(tickets));
    } catch (_) {}

    if (subjectEl) subjectEl.value = '';
    if (descriptionEl) descriptionEl.value = '';
    if (orderRefEl) orderRefEl.value = '';

    renderSupportTicketsList();
    alert(`✅ Support Ticket Created (Offline Mode)!\nTicket ID: ${fallbackId}\nCategory: ${category}\nPriority: ${priority}`);
  } finally {
    if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
    }
  }
}
window.submitSupportTicket = submitSupportTicket;

async function renderSupportTicketsList() {
  const container = document.getElementById('support-tickets-list-container');
  const countBadge = document.getElementById('support-active-tickets-count');
  if (!container) return;

  let tickets = [];

  // Attempt to fetch fresh tickets from backend API
  try {
    const res = await apiFetch('/api/support/tickets');
    if (res && Array.isArray(res.tickets) && res.tickets.length > 0) {
    tickets = res.tickets;
    try {
    localStorage.setItem(getSupportTicketsStorageKey(), JSON.stringify(tickets));
    } catch (_) {}
    }
  } catch (_) {}

  // Fallback to localStorage if API returned empty or failed
  if (!tickets || tickets.length === 0) {
    try {
    const raw = localStorage.getItem(getSupportTicketsStorageKey());
    if (raw) tickets = JSON.parse(raw);
    } catch (_) {}
  }

  if (!Array.isArray(tickets) || !tickets.length) {
    // Provide default starter ticket for demo/clarity if empty
    tickets = [
    {
    id: 'TKT-10492',
    ticketId: 'TKT-10492',
    role,
    category: role === 'customer' ? 'Welcome & Onboarding' : 'Partner Account Verification',
    priority: 'Normal',
    orderRef: '',
    subject: role === 'customer' ? 'Welcome to Tomato Support' : 'Merchant Partner Support Desk',
    description: role === 'customer'
    ? 'Welcome to Tomato! If you face any issues with orders or delivery, raise a ticket here for priority resolution.'
    : 'Welcome to your Partner Helpdesk. Use this channel to coordinate orders, request settlements, and contact support.',
    status: 'Resolved',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    }
    ];
    try {
    localStorage.setItem(getSupportTicketsStorageKey(), JSON.stringify(tickets));
    } catch (_) {}
  }

  const activeCount = tickets.filter((t) => t.status === 'Open' || t.status === 'In Review' || t.status === 'In Progress').length;
  if (countBadge) {
    countBadge.textContent = `${activeCount} Active`;
    countBadge.style.color = activeCount > 0 ? 'var(--tomato)' : 'var(--ink)';
  }

  container.innerHTML = tickets.map((t) => {
    const tid = t.ticketId || t.id || t._id;
    const isResolved = t.status === 'Resolved' || t.status === 'Closed';
    const priorityColor = t.priority === 'Urgent' || t.priority === 'Critical' ? '#ef4444' : t.priority === 'High' ? '#f59e0b' : '#0284c7';
    const priorityBg = t.priority === 'Urgent' || t.priority === 'Critical' ? '#fef2f2' : t.priority === 'High' ? '#fffbeb' : '#f0f9ff';
    
    let statusBg = '#fee2e2';
    let statusColor = '#b91c1c';
    if (t.status === 'In Review') {
    statusBg = '#fef3c7';
    statusColor = '#b45309';
    } else if (t.status === 'Resolved') {
    statusBg = '#dcfce7';
    statusColor = '#15803d';
    } else if (t.status === 'Closed') {
    statusBg = '#f1f5f9';
    statusColor = '#475569';
    }

    const dateStr = new Date(t.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    });

    const hasAdminComment = Boolean(t.adminComment && t.adminComment.trim());

    return `
    <div style="border:1px solid var(--line); border-radius:6px; padding:0.85rem; margin-bottom:0.75rem; background:#fafafa;">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; margin-bottom:0.4rem;">
    <div style="display:flex; align-items:center; gap:0.45rem;">
    <strong style="font-size:0.85rem; color:var(--ink);">${escapeHtml(tid)}</strong>
    <span class="badge" style="background:${priorityBg}; color:${priorityColor}; font-size:0.7rem; padding:0.1rem 0.45rem; border-radius:999px; font-weight:700;">${escapeHtml(t.priority || 'Normal')}</span>
    ${t.orderRef ? `<span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; padding:0.1rem 0.45rem; border-radius:999px;">Ref: ${escapeHtml(t.orderRef)}</span>` : ''}
    </div>
    <div style="display:flex; align-items:center; gap:0.4rem;">
    <span class="badge" style="background:${statusBg}; color:${statusColor}; font-size:0.72rem; padding:0.15rem 0.5rem; border-radius:999px; font-weight:700;">${escapeHtml(t.status)}</span>
    <button type="button" class="btn btn-outline btn-sm" style="font-size:0.7rem; padding:0.15rem 0.45rem; cursor:pointer;" onclick="toggleSupportTicketStatus('${escapeHtml(tid)}')">
    ${isResolved ? 'Reopen' : 'Mark Resolved'}
    </button>
    </div>
    </div>
    <div style="font-weight:600; font-size:0.88rem; color:var(--ink); margin-bottom:0.25rem;">${escapeHtml(t.subject)}</div>
    <div style="font-size:0.8rem; color:var(--muted); margin-bottom:0.45rem; line-height:1.35;">${escapeHtml(t.description)}</div>
    ${hasAdminComment ? `
    <div style="margin-top:0.5rem; margin-bottom:0.45rem; padding:0.45rem 0.65rem; background:#ecfdf5; border-left:3px solid #10b981; border-radius:4px; font-size:0.78rem; color:#065f46;">
    <strong>💬 Admin Review Note:</strong> ${escapeHtml(t.adminComment)}
    ${t.reviewedBy?.name ? `<span style="display:block; font-size:0.72rem; color:#047857; margin-top:0.2rem;">Reviewed by: ${escapeHtml(t.reviewedBy.name)}</span>` : ''}
    </div>
    ` : ''}
    <div style="font-size:0.72rem; color:#94a3b8; display:flex; justify-content:space-between; align-items:center;">
    <span>Category: <em>${escapeHtml(t.category)}</em></span>
    <span>${dateStr}</span>
    </div>
    </div>
    `;
  }).join('');
}
window.renderSupportTicketsList = renderSupportTicketsList;

async function toggleSupportTicketStatus(ticketId) {
  try {
    await apiFetch(`/api/support/tickets/${ticketId}/toggle`, { method: 'PATCH' });
  } catch (_) {}

  let tickets = [];
  try {
    const raw = localStorage.getItem(getSupportTicketsStorageKey());
    if (raw) tickets = JSON.parse(raw);
  } catch (_) {}

  const target = tickets.find((t) => (t.ticketId || t.id || t._id) === ticketId);
  if (target) {
    target.status = target.status === 'Resolved' || target.status === 'Closed' ? 'Open' : 'Resolved';
    try {
    localStorage.setItem(getSupportTicketsStorageKey(), JSON.stringify(tickets));
    } catch (_) {}
  }
  renderSupportTicketsList();
}
window.toggleSupportTicketStatus = toggleSupportTicketStatus;

function renderSupportFAQs() {
  const container = document.getElementById('support-faqs-container');
  if (!container) return;

  let faqs = [];

  if (role === 'restaurant') {
    faqs = [
  {
  q: 'When are daily / weekly merchant payouts credited?',
  a: 'Settlement payouts are calculated automatically and transferred directly to your verified bank account every Tuesday morning. Check transaction reference IDs in your Banking statements.'
  },
  {
  q: 'How do I toggle item availability or mark dishes out of stock?',
  a: 'Navigate to "Menu Management" from the sidebar. You can toggle any food item between "In Stock" and "Out of Stock" instantly, which reflects on customer search in real time.'
  },
  {
  q: 'What should I do if a delivery rider is delayed for pickup?',
  a: 'Ensure you click "Accept" and "Food is Ready" on the Kitchen Orders panel. The system continuously tracks the closest active riders within a 2km proximity ring and dispatches replacements if needed.'
  },
  {
  q: 'How can I change kitchen opening hours or pause incoming orders?',
  a: 'Click your profile status toggle in the sidebar or under "Restaurant Profile" to mark your kitchen as "Closed" or "Busy" during rush hours.'
  }
    ];
  } else if (role === 'shop') {
    faqs = [
  {
  q: 'How does the shop order packing workflow work?',
  a: 'When an order arrives, click "Accept", pack all grocery / retail items, and click "Pack & Dispatch". An assigned rider will arrive at your store with the order verification code.'
  },
  {
  q: 'How do I update prices or add new retail items?',
  a: 'Go to "Item Management" in your sidebar. Click "+ Add New Retail Item" to upload products with prices, SKU tags, and category labels.'
  },
  {
  q: 'When do shop partner settlements arrive?',
  a: 'Reconciled settlements are generated on a rolling 7-day cycle and credited to your registered bank account.'
  },
  {
  q: 'What if an ordered grocery item is out of stock in my shop?',
  a: 'You can update stock quantity directly from Item Management, or raise a ticket above for immediate order adjustment.'
  }
    ];
  } else {
    // Customer FAQs
    faqs = [
  {
  q: 'How do I check the live status of my food order?',
  a: 'You can check real-time order tracking either under the "Live Activity & Notifications" panel on the Overview page or by visiting "My Orders" in the sidebar.'
  },
  {
  q: 'Where do refunds go if an order is cancelled or items are missing?',
  a: 'Refunds are automatically processed to your Tomato Wallet instantly, or back to your original payment card / UPI within 3–5 banking business days.'
  },
  {
  q: 'How do I add or change my delivery address?',
  a: 'Click "Saved Addresses" in the sidebar to add a new address or edit your Home, Work, and Landmark tags.'
  },
  {
  q: 'Can I cancel an order after placing it?',
  a: 'You can cancel an order before the kitchen accepts and starts preparation. If preparation has already begun, please raise a ticket above for assistance.'
  },
  {
  q: 'How do I use my Wallet points during checkout?',
  a: 'Your available wallet balance is automatically displayed on the checkout payment modal when placing your order.'
  }
    ];
  }

  container.innerHTML = faqs.map((f, i) => `
    <div style="border:1px solid var(--line); border-radius:6px; overflow:hidden; background:#fbfbfb;">
  <button
  type="button"
  onclick="toggleFaqAccordion(${i})"
  style="width:100%; text-align:left; background:#fff; border:none; padding:0.75rem 0.9rem; font-size:0.87rem; font-weight:600; color:var(--ink); display:flex; justify-content:space-between; align-items:center; cursor:pointer;"
  >
  <span>${escapeHtml(f.q)}</span>
  <span id="faq-chevron-${i}" style="font-size:0.8rem; color:var(--muted); transition:transform 0.2s;">▼</span>
  </button>
  <div id="faq-answer-${i}" style="display:none; padding:0.75rem 0.9rem; font-size:0.82rem; color:var(--muted); background:#f8fafc; border-top:1px solid var(--line); line-height:1.45;">
  ${escapeHtml(f.a)}
  </div>
    </div>
  `).join('');
}
window.renderSupportFAQs = renderSupportFAQs;

function toggleFaqAccordion(index) {
  const answer = document.getElementById(`faq-answer-${index}`);
  const chevron = document.getElementById(`faq-chevron-${index}`);
  if (!answer) return;
  const isOpen = answer.style.display === 'block';
  answer.style.display = isOpen ? 'none' : 'block';
  if (chevron) {
    chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  }
}
window.toggleFaqAccordion = toggleFaqAccordion;

function startQuickSupportChat() {
  const subjectEl = document.getElementById('support-subject');
  const descEl = document.getElementById('support-description');
  if (subjectEl && descEl) {
    subjectEl.value = 'Live Chat Assistance Request';
    descEl.value = 'Hi Support, I would like to speak to an agent regarding my recent activity on Tomato.';
    subjectEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    subjectEl.focus();
  }
}
window.startQuickSupportChat = startQuickSupportChat;

// =========================================================================
// SETTINGS & PROFILE
// =========================================================================
function loadProfileSettings() {
  populateSettingsUserIdBadge();
  document.getElementById('set-name').value = user.name || '';
  document.getElementById('set-role').value = role.toUpperCase();
  document.getElementById('set-email').value = user.email || '';
  document.getElementById('set-phone').value = user.phone || '';
  const dobEl = document.getElementById('set-dob');
  if (dobEl) {
    dobEl.max = new Date().toISOString().split('T')[0];
    dobEl.value = user.dob ? String(user.dob).split('T')[0] : '';
  }

  const gsnGroup = document.getElementById('set-gsn-group');
  const gsnEl = document.getElementById('set-gsn');
  const gsnLabel = document.getElementById('set-gsn-label');
  if (gsnGroup && gsnEl) {
    if (role === 'restaurant' || role === 'shop' || role === 'admin') {
      gsnGroup.style.display = 'block';
      if (gsnLabel) {
        gsnLabel.textContent = 'GST Number';
      }
      gsnEl.value = (user.gsnNumber && user.gsnNumber.trim()) ? user.gsnNumber.trim() : 'NA';
    } else {
      gsnGroup.style.display = 'none';
      gsnEl.value = '';
    }
  }

  const restGroup = document.getElementById('restaurant-settings-group');
  const riderGroup = document.getElementById('rider-settings-group');

  const adminPincodesBar = document.getElementById('admin-settings-pincodes-bar');
  if (adminPincodesBar) {
    if (role === 'admin' || role === 'subadmin') {
    adminPincodesBar.style.display = 'block';
    fetchAdminServiceablePincodes();
    } else {
    adminPincodesBar.style.display = 'none';
    }
  }

  if (role === 'restaurant' || role === 'shop') {
    restGroup.style.display = 'block';
    const addrLabel = document.getElementById('set-restaurant-address-label');
    if (addrLabel) addrLabel.textContent = role === 'shop' ? 'Shop Address' : 'Restaurant Address';
    const pinLabel = document.getElementById('set-restaurant-pincode-label');
    if (pinLabel) pinLabel.textContent = role === 'shop' ? 'Shop Pincode (Serviceable Area)' : 'Restaurant Pincode (Serviceable Area)';
    const cuisineLabel = document.getElementById('set-cuisine-label');
    if (cuisineLabel) cuisineLabel.textContent = role === 'shop' ? 'Shop Category / Speciality' : 'Cuisines Served';
    document.getElementById('set-restaurant-address').value = user.shopAddress || user.restaurantAddress || '';
    const pinInput = document.getElementById('set-restaurant-pincode');
    if (pinInput) pinInput.value = resolveFrontendPartnerPincode(user);
    document.getElementById('set-cuisine').value = user.category || user.cuisine || '';
  } else {
    restGroup.style.display = 'none';
  }

  if (role === 'deliveryPartner') {
    riderGroup.style.display = 'block';
    document.getElementById('set-vehicle').value = user.deliveryVehicle || '';
  } else {
    riderGroup.style.display = 'none';
  }
}

async function saveProfileSettings(e) {
  e.preventDefault();
  const notice = document.getElementById('profile-notice');
  notice.textContent = 'Saving changes...';
  notice.style.color = 'var(--muted)';

  const formData = new FormData();
  formData.append('name', document.getElementById('set-name').value.trim());
  if (document.getElementById('set-email').value.trim()) {
    formData.append('email', document.getElementById('set-email').value.trim());
  }
  if (document.getElementById('set-phone').value.trim()) {
    formData.append('phone', document.getElementById('set-phone').value.trim());
  }
  const dobVal = (document.getElementById('set-dob')?.value || '').trim();
  formData.append('dob', dobVal);
  if (role === 'restaurant' || role === 'shop' || role === 'admin') {
    const rawGsn = (document.getElementById('set-gsn')?.value || '').trim().toUpperCase();
    const gsnVal = (role === 'restaurant' || role === 'shop') ? (rawGsn || 'NA') : rawGsn;
    formData.append('gsnNumber', gsnVal);
  }
  if (role === 'restaurant') {
    formData.append('restaurantAddress', document.getElementById('set-restaurant-address').value.trim());
    formData.append('pincode', (document.getElementById('set-restaurant-pincode')?.value || '').trim());
    formData.append('cuisine', document.getElementById('set-cuisine').value.trim());
  }
  if (role === 'shop') {
    formData.append('shopAddress', document.getElementById('set-restaurant-address').value.trim());
    formData.append('pincode', (document.getElementById('set-restaurant-pincode')?.value || '').trim());
    formData.append('category', document.getElementById('set-cuisine').value.trim());
  }
  if (role === 'deliveryPartner') {
    formData.append('deliveryVehicle', document.getElementById('set-vehicle').value.trim());
  }

  const photoInput = document.getElementById('set-photo');
  if (photoInput.files && photoInput.files[0]) {
    formData.append('photo', photoInput.files[0]);
  }

  try {
    const res = await fetch(`${API_ROOT}/api/auth/profile`, {
    method: 'PUT',
    headers: {
    Authorization: `Bearer ${token}`,
    },
    body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to update profile');

    // Update local storage
    Object.assign(user, data.user || {});
    localStorage.setItem('tomatoUser', JSON.stringify(user));

    notice.textContent = 'Profile successfully updated!';
    notice.style.color = 'var(--green)';
    initDashboard();
  } catch (err) {
    notice.textContent = err.message;
    notice.style.color = 'var(--tomato-dark)';
  }
}

// =========================================================================
// REAL-TIME GPS ORDER LIVE TRACKING & RIDER TELEMETRY
// =========================================================================
let activeTrackingOrderId = null;
let activeTrackingViewerRole = null;
let orderLiveTrackingPollInterval = null;

async function openOrderLiveTrackingModal(orderId, viewerRole = null) {
  activeTrackingOrderId = orderId;
  activeTrackingViewerRole = viewerRole || role;

  const body = document.getElementById('olt-modal-body');
  if (body) {
    body.innerHTML = `
    <div style="text-align:center; padding:2rem 0; color:var(--muted);">
    <div style="font-size:2rem; margin-bottom:0.5rem; animation:pulse 1.5s infinite;">📡</div>
    Establishing WebSocket &amp; satellite GPS telemetry...
    </div>
    `;
  }

  openModal('order-live-tracking-modal');

  // Subscribe to real-time WebSocket stream for this order
  if (window.TomatoWS && typeof window.TomatoWS.subscribeOrderLiveTracking === 'function') {
    window.TomatoWS.subscribeOrderLiveTracking(orderId);
  }

  await refreshOrderLiveTracking();

  if (orderLiveTrackingPollInterval) clearInterval(orderLiveTrackingPollInterval);
  orderLiveTrackingPollInterval = setInterval(refreshOrderLiveTracking, 5000);
}

function closeOrderLiveTrackingModal() {
  if (window.TomatoWS && typeof window.TomatoWS.unsubscribeOrderLiveTracking === 'function') {
    window.TomatoWS.unsubscribeOrderLiveTracking(activeTrackingOrderId);
  }
  if (orderLiveTrackingPollInterval) {
    clearInterval(orderLiveTrackingPollInterval);
    orderLiveTrackingPollInterval = null;
  }
  activeTrackingOrderId = null;
  closeModal('order-live-tracking-modal');
}

async function refreshOrderLiveTracking() {
  if (!activeTrackingOrderId) return;
  const orderId = activeTrackingOrderId;
  const vRole = activeTrackingViewerRole || role;

  let endpoint = `/api/customer/orders/${orderId}/live-tracking`;
  if (vRole === 'restaurant') endpoint = `/api/restaurant/orders/${orderId}/live-tracking`;
  else if (vRole === 'shop') endpoint = `/api/shop/orders/${orderId}/live-tracking`;
  else if (vRole === 'deliveryPartner' || vRole === 'rider') endpoint = `/api/rider/orders/${orderId}/live-tracking`;
  else if (vRole === 'admin' || vRole === 'subadmin') endpoint = `/api/admin/orders/${orderId}/live-tracking`;

  try {
    const res = await apiFetch(endpoint);
    renderOrderLiveTracking(res);
  } catch (err) {
    const body = document.getElementById('olt-modal-body');
    if (body) {
    body.innerHTML = `
    <div style="padding:1.5rem; background:#fee2e2; border:1px solid #fca5a5; border-radius:8px; color:#b91c1c;">
    <strong>Live Telemetry Warning:</strong> ${escapeHtml(err.message)}
    <div style="margin-top:0.8rem;">
    <button class="btn btn-outline btn-sm" onclick="refreshOrderLiveTracking()">🔄 Retry Connection</button>
    </div>
    </div>
    `;
    }
  }
}

function renderOrderLiveTracking(rawData) {
  const data = rawData?.tracking || rawData || {};
  const statusLower = String(data.status || '').toLowerCase();
  if (data.trackingClosed || statusLower === 'delivered' || statusLower === 'cancelled') {
    closeOrderLiveTrackingModal();
    if (typeof showToastNotification === 'function') {
      showToastNotification({
        title: statusLower === 'delivered'
          ? `Order #${data.orderNumber || ''} Delivered`
          : `Order #${data.orderNumber || ''} Tracking Closed`,
        message: statusLower === 'delivered'
          ? 'Your order has been delivered! Live rider location tracking is now closed.'
          : 'This order is no longer active. Live rider location tracking is closed.',
        type: statusLower === 'delivered' ? 'success' : 'info',
      });
    }
    if (typeof refreshActiveViewData === 'function') {
      refreshActiveViewData();
    }
    return;
  }

  const body = document.getElementById('olt-modal-body');
  if (!body) return;

  const titleEl = document.getElementById('olt-modal-title');
  if (titleEl) titleEl.textContent = `Order #${data.orderNumber || ''} Live Telemetry`;

  const badgeEl = document.getElementById('olt-status-badge');
  if (badgeEl) {
  badgeEl.className = `badge badge-${data.status}`;
  badgeEl.textContent = String(data.status || 'in_progress').replace(/_/g, ' ').toUpperCase();
  }

  const telem = data.telemetry || {};
  const rider = data.rider || {};
  const rest = data.restaurant || {};
  const cust = data.customer || {};

  const isOnline = Boolean(telem.isLiveOnline ?? rider.isOnline);
  const distRestNum = telem.riderToRestaurantDistanceKm !== undefined ? Number(telem.riderToRestaurantDistanceKm) : 0.85;
  const distCustNum = telem.riderToCustomerDistanceKm !== undefined ? Number(telem.riderToCustomerDistanceKm) : 1.45;
  const distRest = distRestNum.toFixed(2);
  const distCust = distCustNum.toFixed(2);
  const eta = telem.etaMinutes !== undefined ? telem.etaMinutes : Math.round(distCustNum * 4 + 4);
  const wsConnected = Boolean(window.TomatoWS && window.TomatoWS.isConnected);

  const mapsUrl = rider.location?.lat && cust.location?.lat
  ? `https://www.google.com/maps/dir/?api=1&origin=${rider.location.lat},${rider.location.lng}&destination=${cust.location.lat},${cust.location.lng}&waypoints=${rest.location?.lat || 12.9716},${rest.location?.lng || 77.5946}`
  : rider.location?.lat && rest.location?.lat
  ? `https://www.google.com/maps/dir/?api=1&origin=${rider.location.lat},${rider.location.lng}&destination=${rest.location.lat},${rest.location.lng}`
  : 'https://maps.google.com';

  body.innerHTML = `
  <!-- KPI Cards -->
  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.75rem; margin-bottom:1.2rem;">
  <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.85rem; text-align:center;">
  <span style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:600; display:block;">Rider to Restaurant</span>
  <strong style="font-size:1.3rem; color:var(--ink);">${distRest} km</strong>
  </div>
  <div style="background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:0.85rem; text-align:center;">
  <span style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:600; display:block;">Rider to Customer</span>
  <strong style="font-size:1.3rem; color:var(--ink);">${distCust} km</strong>
  </div>
  <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:0.85rem; text-align:center;">
  <span style="font-size:0.75rem; color:#15803d; text-transform:uppercase; font-weight:600; display:block;">Estimated Arrival</span>
  <strong style="font-size:1.3rem; color:#16a34a;">~${eta} mins</strong>
  </div>
  <div style="background:${isOnline ? '#f0fdf4' : '#fef2f2'}; border:1px solid ${isOnline ? '#bbf7d0' : '#fecaca'}; border-radius:10px; padding:0.85rem; text-align:center;">
  <span style="font-size:0.75rem; color:${isOnline ? '#15803d' : '#991b1b'}; text-transform:uppercase; font-weight:600; display:block;">GPS Transmitter</span>
  <strong style="font-size:1rem; color:${isOnline ? '#16a34a' : '#dc2626'};">${isOnline ? '🟢 Live Online' : '⚪ Offline'}</strong>
  <div style="font-size:0.72rem; color:var(--muted);">${telem.lastPingSecondsAgo !== null && telem.lastPingSecondsAgo !== undefined ? `${telem.lastPingSecondsAgo}s ago` : 'Active'}</div>
  </div>
  </div>
  <!-- Radar Canvas -->
  <div style="background:#0f172a; border-radius:12px; padding:0.9rem; margin-bottom:1.2rem; position:relative; overflow:hidden;">
  <div style="display:flex; justify-content:space-between; align-items:center; color:#94a3b8; font-size:0.76rem; margin-bottom:0.4rem; padding:0 0.2rem; flex-wrap:wrap; gap:0.4rem;">
  <span>📡 LIVE SATELLITE DISPATCH RADAR (RESTAURANT ➔ RIDER ➔ CUSTOMER)</span>
  <span id="ws-live-connection-indicator" style="color:${wsConnected ? '#22c55e' : '#eab308'}; font-weight:600;">
    ${wsConnected ? '🟢 WebSocket Live Stream Connected' : '🟡 Polling Fallback (Connecting WS...)'}
  </span>
  </div>
  <canvas id="live-order-canvas" width="680" height="250" style="width:100%; height:auto; background:#1e293b; border-radius:8px; border:1px solid #334155; display:block;"></canvas>
  </div>
  <!-- Partner & Destination Cards -->
  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.9rem; margin-bottom:1.2rem; font-size:0.85rem;">
  <!-- Restaurant -->
  <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.9rem;">
  <span style="color:var(--tomato); font-weight:700; font-size:0.75rem; text-transform:uppercase; display:block; margin-bottom:0.3rem;">🏪 Pickup Restaurant</span>
  <div style="font-weight:700; font-size:0.95rem; color:var(--ink);">${escapeHtml(formatCleanName(rest.displayName || rest.name || 'Tomato Partner'))}</div>
  <div style="margin-top:0.3rem;">
  <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.75rem;">📍 DIGIPIN: ${escapeHtml(rest.digipin || 'DGP-BLR')}</span>
  </div>
  <div style="font-size:0.78rem; color:var(--muted); margin-top:0.35rem;">
  GPS: ${rest.location?.lat ? `${Number(rest.location.lat).toFixed(4)}, ${Number(rest.location.lng).toFixed(4)}` : 'Bengaluru'}
  </div>
  </div>
  <!-- Rider -->
  <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.9rem;">
  <span style="color:#0284c7; font-weight:700; font-size:0.75rem; text-transform:uppercase; display:block; margin-bottom:0.3rem;">🚴 Delivery Partner</span>
  <div style="font-weight:700; font-size:0.95rem; color:var(--ink);">${escapeHtml(formatCleanName(rider.displayName || rider.name || 'Assigned Partner'))}</div>
  <div style="margin-top:0.3rem;">
  <span class="badge" style="background:${isOnline ? '#dcfce7' : '#f1f5f9'}; color:${isOnline ? '#15803d' : '#475569'}; font-size:0.75rem;">
  ${isOnline ? '🟢 Continuous Live GPS Active' : '⚪ Signal Standby'}
  </span>
  </div>
  <div style="font-size:0.78rem; color:var(--muted); margin-top:0.35rem;">
  GPS: ${rider.location?.lat ? `${Number(rider.location.lat).toFixed(4)}, ${Number(rider.location.lng).toFixed(4)}` : 'Indiranagar'}
  </div>
  </div>
  <!-- Customer -->
  <div style="background:#fff; border:1px solid var(--line); border-radius:10px; padding:0.9rem;">
  <span style="color:var(--green); font-weight:700; font-size:0.75rem; text-transform:uppercase; display:block; margin-bottom:0.3rem;">🏠 Delivery Destination</span>
  <div style="font-weight:700; font-size:0.95rem; color:var(--ink);">${escapeHtml(cust.name || 'Customer')}</div>
  <div style="font-size:0.8rem; color:var(--ink); margin-top:0.3rem;">
  ${escapeHtml(cust.address?.line1 || 'Delivery Address')}${cust.address?.city ? ', ' + escapeHtml(cust.address.city) : ''}
  </div>
  </div>
  </div>
  <!-- Action Buttons -->
  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem; border-top:1px dashed var(--line); padding-top:1rem;">
  <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
  <button class="btn btn-outline btn-sm" onclick="refreshOrderLiveTracking()">🔄 Refresh Coordinates</button>
  <a href="${mapsUrl}" target="_blank" class="btn btn-outline btn-sm" style="color:var(--blue);">🗺️ Open in Google Maps</a>
  </div>
  ${role === 'deliveryPartner' ? `
  <button class="btn btn-primary btn-sm" onclick="simulateRiderMovement(); setTimeout(refreshOrderLiveTracking, 400);">🚴 Simulate Step Ahead (~100m)</button>
  ` : ''}
  </div>
  `;

  // Render Canvas
  setTimeout(() => {
  const canvas = document.getElementById('live-order-canvas');
  if (canvas) drawLiveOrderRadar(canvas, data);
  }, 30);
}

function drawLiveOrderRadar(canvas, rawData) {
  const data = rawData?.tracking || rawData || {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5;
  for (let x = 40; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 30; y < h; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Concentric radar circles from center
  const cx = w * 0.48;
  const cy = h * 0.5;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
  ctx.lineWidth = 1;
  [40, 80, 120, 160].forEach((r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // 3 Nodes: Restaurant (Left), Rider (Dynamic Live Transit), Customer (Right)
  const restPt = { x: w * 0.16, y: h * 0.54 };
  const custPt = { x: w * 0.84, y: h * 0.48 };

  // Dynamically interpolate Rider position between Restaurant pickup and Customer destination
  const dRest = Number(data.telemetry?.riderToRestaurantDistanceKm ?? 0.85);
  const dCust = Number(data.telemetry?.riderToCustomerDistanceKm ?? 1.45);
  const totalLeg = Math.max(0.05, dRest + dCust);
  let progressRatio = dRest / totalLeg;
  if (data.status === 'delivered') progressRatio = 1;
  else if (data.status === 'placed' || data.status === 'accepted' || data.status === 'preparing') {
    progressRatio = Math.min(0.28, progressRatio);
  }
  progressRatio = Math.max(0.08, Math.min(0.94, progressRatio));

  // Slight arc curve between restaurant and customer
  const arcLift = Math.sin(progressRatio * Math.PI) * (h * 0.14);
  const riderPt = {
    x: restPt.x + (custPt.x - restPt.x) * progressRatio,
    y: restPt.y + (custPt.y - restPt.y) * progressRatio - arcLift,
  };

  // Completed route leg (Restaurant -> Rider)
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(restPt.x, restPt.y);
  ctx.lineTo(riderPt.x, riderPt.y);
  ctx.stroke();

  // Remaining route leg (Rider -> Customer)
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(riderPt.x, riderPt.y);
  ctx.lineTo(custPt.x, custPt.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Pulse around Rider
  ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
  ctx.beginPath();
  ctx.arc(riderPt.x, riderPt.y, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(34, 197, 94, 0.4)';
  ctx.beginPath();
  ctx.arc(riderPt.x, riderPt.y, 14, 0, Math.PI * 2);
  ctx.fill();

  // 1. Restaurant Pin
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(restPt.x, restPt.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏪', restPt.x, restPt.y + 4);
  ctx.fillStyle = '#f87171';
  ctx.font = 'bold 11px sans-serif';
  const rName = (data.restaurant?.name || 'Restaurant').slice(0, 14);
  ctx.fillText(rName, restPt.x, restPt.y + 24);
  if (data.restaurant?.digipin) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText(`[${data.restaurant.digipin}]`, restPt.x, restPt.y + 36);
  }

  // 2. Customer Pin
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(custPt.x, custPt.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏠', custPt.x, custPt.y + 4);
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 11px sans-serif';
  const cName = (data.customer?.name || 'Customer').slice(0, 14);
  ctx.fillText(cName, custPt.x, custPt.y + 24);

  // 3. Rider Pin
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(riderPt.x, riderPt.y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🚴', riderPt.x, riderPt.y + 4);
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 11px sans-serif';
  const rdName = formatCleanName(data.rider?.displayName || data.rider?.name || 'Rider').slice(0, 16);
  ctx.fillText(rdName, riderPt.x, riderPt.y - 18);
  ctx.fillStyle = '#38bdf8';
  ctx.font = '10px sans-serif';
  ctx.fillText('🟢 LIVE GPS', riderPt.x, riderPt.y - 6);
}


// Explicit window exports for modular domain controllers
window.API_ROOT = API_ROOT;
window.token = token;
window.storedUser = storedUser;
window.user = user;
window.role = role;
window.normalizeRole = normalizeRole;
window.hasPerm = hasPerm;
window.userPerms = userPerms;
window.cart = cart;
window.apiFetch = apiFetch;
window.showToastNotification = showToastNotification;
window.showToast = showToastNotification;
window.openModal = openModal;
window.closeModal = closeModal;
window.showAutoDismissNotice = showAutoDismissNotice;
window.formatCleanName = formatCleanName;
window.escapeHtml = escapeHtml;
window.switchView = switchView;
window.loadRoleOverview = loadRoleOverview;
window.initDashboard = initDashboard;
window.viewLastFetched = viewLastFetched;
window.loadNotifications = loadNotifications;
window.changeNotifPage = changeNotifPage;
window.goToNotifPage = goToNotifPage;
window.renderTableSkeleton = renderTableSkeleton;
window.renderAnalyticsSkeleton = renderAnalyticsSkeleton;
window.openOrderLiveTrackingModal = openOrderLiveTrackingModal;
window.closeOrderLiveTrackingModal = closeOrderLiveTrackingModal;
window.refreshProfileWallet = refreshProfileWallet;
window.showStatusBanner = showStatusBanner;
window.hideStatusBanner = hideStatusBanner;

