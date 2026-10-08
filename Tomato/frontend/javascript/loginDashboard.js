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
        if (user.name) user.name = formatCleanName(user.name);
        if (user.displayName) user.displayName = formatCleanName(user.displayName);
      }
      const normalizeRole = (r) => {
        const val = String(r || 'customer').trim().toLowerCase();
        if (['deliverypartner', 'delivery_partner', 'delivery partner', 'rider'].includes(val)) return 'deliveryPartner';
        if (['restaurant', 'restaurent'].includes(val)) return 'restaurant';
        if (['shop', 'store'].includes(val)) return 'shop';
        if (['admin', 'subadmin'].includes(val)) return val;
        return 'customer';
      };
      const role = normalizeRole(user.role);

      // Global state
      let activeView = 'overview';
      let allRestaurants = [];
      let allMenuItems = [];
      let currentSelectedRestaurantId = 'all';
      let mainCustomerTab = 'all_restaurants'; // 'all_restaurants' | 'all_menus' | 'category' | 'grocery'
      let selectedCategory = 'all';
      let selectedMenuItemId = 'all';
      let openDropdownTab = null;
      const cart = [];
      let customerAddresses = [];
      let selectedPaymentMethod = 'card';

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

      async function refreshProfileWallet() {
        try {
          const wallet = await apiFetch('/api/auth/wallet');
          user.walletBalance = Number(wallet.walletBalance ?? 0);
          user.creditPoint = Number(wallet.creditPoint ?? 0);
          localStorage.setItem('tomatoUser', JSON.stringify(user));

          const walletText = document.getElementById('profile-wallet-text');
          if (walletText) {
            walletText.textContent = `${user.walletBalance.toFixed(2)}/${user.creditPoint.toFixed(0)}`;
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
        if (walletText) walletText.textContent = `${Number(user.walletBalance ?? 0).toFixed(2)}/${Number(user.creditPoint ?? 0).toFixed(0)}`;
        if (walletLabel) walletLabel.textContent = role === 'admin' || role === 'subadmin' ? 'W' : 'Wallet';
        const creditTransferButton = document.getElementById('admin-credit-transfer-open');
        if (creditTransferButton) {
          creditTransferButton.style.display = role === 'admin' ? 'inline-flex' : 'none';
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

        // Start real-time notifications stream
        initNotificationStream();

        // Initialize rider location reporting
        initRiderLocationTracking();

        // Sign out
        document.getElementById('sign-out').addEventListener('click', () => {
          if (notificationEventSource) {
            try { notificationEventSource.close(); } catch (_) {}
          }
          localStorage.removeItem('tomatoToken');
          localStorage.removeItem('tomatoUser');
          window.alert('Signed out from Tomato. Visit again soon!');
          window.location.href = '../index.html';
        });
      }

      // Build Navigation Menu dynamically
      function buildNav() {
        const navContainer = document.getElementById('dynamic-nav');
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
          ...(hasPerm('dashboard_view') ? [{ id: 'admin-analytics', icon: '📈', label: 'Analytics' }] : []),
          ...(hasPerm('subadmins_manage') ? [{ id: 'admin-subadmins', icon: '🛡️', label: 'Sub-Admins & RBAC' }] : []),
          { id: 'settings', icon: '⚙️', label: 'Platform Settings' },
        ];

        const navConfigs = {
          customer: [
            { id: 'overview', icon: '🏠', label: 'Overview' },
            { id: 'customer-order', icon: '🍽️', label: 'Order Online' },
            { id: 'customer-orders', icon: '📦', label: 'My Orders' },
            { id: 'customer-address', icon: '📍', label: 'Saved Addresses' },
            { id: 'settings', icon: '⚙️', label: 'Profile Settings' },
          ],
          restaurant: [
            { id: 'overview', icon: '🏠', label: 'Overview' },
            { id: 'restaurant-orders', icon: '🔔', label: 'Kitchen Orders' },
            { id: 'restaurant-menu', icon: '📋', label: 'Menu Management' },
            { id: 'settings', icon: '⚙️', label: 'Restaurant Profile' },
          ],
          shop: [
            { id: 'overview', icon: '🏠', label: 'Overview' },
            { id: 'shop-orders', icon: '🛍️', label: 'Shop Orders' },
            { id: 'shop-items', icon: '📋', label: 'Item Management' },
            { id: 'settings', icon: '⚙️', label: 'Shop Profile' },
          ],
          deliveryPartner: [
            { id: 'overview', icon: '🏠', label: 'Shift Overview' },
            { id: 'rider-available', icon: '🚴', label: 'Available Pickups' },
            { id: 'rider-active', icon: '🚀', label: 'Active Delivery' },
            { id: 'rider-history', icon: '💰', label: 'Trip Earnings' },
            { id: 'settings', icon: '⚙️', label: 'Rider Profile' },
          ],
          admin: adminItems,
          subadmin: adminItems,
        };

        const items = navConfigs[role] || navConfigs.customer;
        items.forEach((item, index) => {
          const btn = document.createElement('button');
          btn.className = `nav-item ${index === 0 ? 'active' : ''}`;
          btn.type = 'button';
          btn.dataset.targetView = item.id;
          btn.innerHTML = `<span class="nav-icon">${item.icon}</span> <span>${item.label}</span>`;
          btn.addEventListener('click', () => switchView(item.id));
          navContainer.appendChild(btn);
        });
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
      function switchView(viewId, filter = null) {
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
        }

        if (activeView === viewId) {
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
          }
          return;
        }
        activeView = viewId;

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

        // Trigger view data refresh
        if (viewId === 'customer-order') {
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
        } else if (viewId === 'settings') {
          loadProfileSettings();
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
          switchView('customer-orders');
          fetchCustomerOrders();
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
          switchView('customer-orders');
          fetchCustomerOrders();
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
          copyEl.textContent = 'Browse kitchens, place food / grocery orders, and track deliveries in real time.';
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

            statsEl.innerHTML = `
              <div class="stat-card"><span class="stat-label">Available Pickups</span><div class="stat-value" style="color:var(--tomato);">${availData.orders?.length || 0}</div><span class="stat-note">Ready for pickup</span></div>
              <div class="stat-card"><span class="stat-label">Active Trip</span><div class="stat-value">${activeData.orders?.length || 0}</div><span class="stat-note">In transit</span></div>
              <div class="stat-card"><span class="stat-label">Delivered Orders</span><div class="stat-value">${histData.totalDeliveries || 0}</div><span class="stat-note">Trips completed</span></div>
              <div class="stat-card"><span class="stat-label">Trip Earnings</span><div class="stat-value" style="color:var(--green);">₹${histData.totalEarnings || 0}</div><span class="stat-note">₹40 per delivery</span></div>
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

          if (!currentNotifications.length) {
            feed.innerHTML = `
              <div style="text-align:center; padding:2rem 1rem; color:var(--muted);">
                <div style="font-size:1.8rem; margin-bottom:0.4rem;">🔔</div>
                <strong style="font-size:0.95rem; color:var(--ink);">All Caught Up!</strong>
                <p style="margin:0.25rem 0 0; font-size:0.85rem;">No new notifications right now. Any live platform updates will appear here.</p>
              </div>
            `;
            if (paginationBar) paginationBar.style.display = 'none';
            return;
          }

          const totalPages = Math.ceil(currentNotifications.length / NOTIFICATIONS_PER_PAGE);
          if (currentNotifPage > totalPages) currentNotifPage = totalPages;
          if (currentNotifPage < 1) currentNotifPage = 1;

          renderNotifPage(currentNotifPage);
          renderNotifPaginationControls();
        } catch (e) {
          console.error('Error loading notifications:', e);
          if (!currentNotifications.length) {
            feed.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; padding:0.5rem 0;">Unable to load notifications.</p>';
            if (paginationBar) paginationBar.style.display = 'none';
          }
        }
      }

      function renderNotifPage(page) {
        const feed = document.getElementById('activity-feed');
        if (!feed) return;

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
      // CUSTOMER: RESTAURANTS, MENU, CART, PAYMENT GATEWAY & ORDERS
      // =========================================================================
      async function loadCustomerMenuSection() {
        try {
          const [restData, menuData, addrData] = await Promise.all([
            apiFetch('/api/customer/restaurants'),
            apiFetch('/api/customer/menu'),
            apiFetch('/api/customer/addresses').catch(() => ({ addresses: [] })),
          ]);

          allRestaurants = restData.restaurants || [];
          allMenuItems = menuData.menu || [];
          customerAddresses = addrData.addresses || [];

          renderRestaurantPills();
          renderMenuItems();
          updateCartUI();
        } catch (e) {
          console.error('Menu load error:', e);
        }
      }

      function isGroceryItem(item) {
        const cat = (item.category || '').toLowerCase();
        const groceryKeywords = ['grocery', 'spices', 'spice', 'kirana', 'dairy', 'staples', 'vegetables', 'fruits'];
        return groceryKeywords.some((kw) => cat === kw || cat.startsWith(kw));
      }

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

      // Customer visited items storage and retrieval helpers
      function getCustomerVisitedStorageKey(type) {
        const uid = (user && (user._id || user.id)) || 'guest';
        return `tomato_visited_${type}_${uid}`;
      }

      function getVisitedItems(type) {
        try {
          const raw = localStorage.getItem(getCustomerVisitedStorageKey(type));
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      }

      function saveVisitedItems(type, items) {
        try {
          const key = getCustomerVisitedStorageKey(type);
          localStorage.setItem(key, JSON.stringify(items.slice(0, 5)));
        } catch (e) {
          console.warn('Could not save visited items to localStorage', e);
        }
      }

      function getStablePillItems(type, availableItems, getIdFn) {
        let stored = getVisitedItems(type);
        let valid = [];
        for (const id of stored) {
          const found = availableItems.find((item) => String(getIdFn(item)).toLowerCase() === String(id).toLowerCase());
          if (found && !valid.some((v) => String(getIdFn(v)).toLowerCase() === String(getIdFn(found)).toLowerCase())) {
            valid.push(found);
          }
        }

        // If fewer than 5, fill up to 5 with remaining available items in stable order
        if (valid.length < 5) {
          for (const item of availableItems) {
            if (valid.length >= 5) break;
            const itemId = String(getIdFn(item)).toLowerCase();
            if (!valid.some((v) => String(getIdFn(v)).toLowerCase() === itemId)) {
              valid.push(item);
            }
          }
          saveVisitedItems(type, valid.map(getIdFn));
        }
        return valid.slice(0, 5);
      }

      function recordVisitedItem(type, idOrName) {
        if (!idOrName || idOrName === 'all') return;
        try {
          const key = getCustomerVisitedStorageKey(type);
          let items = getVisitedItems(type);
          const exists = items.some((x) => String(x).toLowerCase() === String(idOrName).toLowerCase());
          if (exists) {
            // Already in the list! Do NOT move or change its index!
            return;
          }
          if (items.length >= 5) {
            items[4] = idOrName; // Replace the 5th slot so existing 0-3 indices stay fixed
          } else {
            items.push(idOrName);
          }
          localStorage.setItem(key, JSON.stringify(items));
        } catch (e) {
          console.warn('Could not save visited item to localStorage', e);
        }
      }

      let activeFilterModalTab = 'all_restaurants';

      function openFilterSelectionModal(tab) {
        activeFilterModalTab = tab || mainCustomerTab;
        const modal = document.getElementById('filter-selection-modal');
        if (!modal) return;

        const titleEl = document.getElementById('filter-modal-title');
        const searchInput = document.getElementById('filter-modal-search');

        if (titleEl) {
          if (activeFilterModalTab === 'all_restaurants') {
            titleEl.textContent = '🏪 Select Restaurant';
            if (searchInput) searchInput.placeholder = 'Search restaurant by name, cuisine, address...';
          } else if (activeFilterModalTab === 'all_menus') {
            titleEl.textContent = '🍽️ Select Menu / Dish';
            if (searchInput) searchInput.placeholder = 'Search dishes by name, description, or category...';
          } else if (activeFilterModalTab === 'category') {
            titleEl.textContent = '📑 Select Food Category';
            if (searchInput) searchInput.placeholder = 'Search food category...';
          } else if (activeFilterModalTab === 'grocery') {
            titleEl.textContent = '🛒 Select Grocery Category';
            if (searchInput) searchInput.placeholder = 'Search grocery category...';
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

      function handleFilterModalCardClick(card) {
        if (!card) return;
        const filterType = card.getAttribute('data-filter-type');
        const filterVal = card.getAttribute('data-filter-value');
        if (!filterType || filterVal === null || filterVal === undefined) return;

        if (filterType === 'restaurant') {
          selectRestaurantFilter(filterVal);
        } else if (filterType === 'category') {
          selectCategoryFilter(filterVal);
        } else if (filterType === 'grocery') {
          selectGroceryFilter(filterVal);
        } else if (filterType === 'menu') {
          selectMenuItemFilter(filterVal);
        }
      }

      function handleFilterModalItemClick(e) {
        const card = e.target.closest('.filter-modal-card');
        if (card) {
          handleFilterModalCardClick(card);
        }
      }

      function renderFilterModalItems(tab, query = '') {
        const container = document.getElementById('filter-modal-items-container');
        if (!container) return;

        const q = (query || '').toLowerCase().trim();
        let html = '';

        if (tab === 'all_restaurants') {
          const isAllActive = currentSelectedRestaurantId === 'all';
          if (!q || 'all restaurants'.includes(q)) {
            html += `
              <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="restaurant" data-filter-value="all" onclick="handleFilterModalCardClick(this)">
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
              const count = allMenuItems.filter((m) => String(m.restaurantId) === restId).length;
              const restDisplay = formatCleanName(rest.name || rest.displayName || 'Restaurant');
              const isClosed = rest.isOpen === false || rest.isOnline === false;
              const isActive = currentSelectedRestaurantId === restId;
              const cuisineText = rest.cuisine ? ` • ${escapeHtml(rest.cuisine)}` : '';
              const addrText = (rest.restaurantAddress || rest.address) ? ` • ${escapeHtml(rest.restaurantAddress || rest.address)}` : '';

              html += `
                <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="restaurant" data-filter-value="${escapeHtml(restId)}" onclick="handleFilterModalCardClick(this)">
                  <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                      <span style="font-weight:600; font-size:0.92rem; color:var(--ink);">${escapeHtml(restDisplay)}</span>
                      ${isClosed ? '<span style="font-size:0.7em; color:#ef4444; font-weight:700; background:#fee2e2; padding:0.1rem 0.35rem; border-radius:4px;">[CLOSED]</span>' : ''}
                    </div>
                    <div style="font-size:0.76rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0.2rem;">
                      ${count} menu items${cuisineText}${addrText}
                    </div>
                  </div>
                  <span class="filter-modal-card-badge">${count} items</span>
                </div>
              `;
            });
          }
        } else if (tab === 'category') {
          const distinctCategories = getDistinctCategories();
          const isAllActive = selectedCategory === 'all';

          if (!q || 'all categories'.includes(q)) {
            html += `
              <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="category" data-filter-value="all" onclick="handleFilterModalCardClick(this)">
                <div>
                  <div style="font-weight:700; font-size:0.95rem;">All Categories</div>
                  <div style="font-size:0.78rem; color:var(--muted);">Explore all food categories</div>
                </div>
                <span class="filter-modal-card-badge">${allMenuItems.length} dishes</span>
              </div>
            `;
          }

          const filteredCats = distinctCategories.filter((c) => !q || c.toLowerCase().includes(q));
          if (!filteredCats.length && q) {
            html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No categories match "${escapeHtml(query)}"</p>`;
          } else {
            filteredCats.forEach((cat) => {
              const count = allMenuItems.filter((m) => (m.category || 'Main Course').toLowerCase() === cat.toLowerCase()).length;
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
        } else if (tab === 'grocery') {
          const groceryItems = allMenuItems.filter(isGroceryItem);
          const standardGroceryCategories = ['Spices', 'Dairy & Eggs', 'Staples', 'Snacks & Beverages', 'Fruits & Vegetables'];
          const existingGroceryCategories = Array.from(new Set(groceryItems.map((m) => (m.category || '').trim()).filter(Boolean)));
          const allGroceryCatsToDisplay = Array.from(new Set([...standardGroceryCategories, ...existingGroceryCategories]));
          const isAllActive = selectedCategory === 'all';

          if (!q || 'all grocery'.includes(q)) {
            html += `
              <div class="filter-modal-card ${isAllActive ? 'active' : ''}" data-filter-type="grocery" data-filter-value="all" onclick="handleFilterModalCardClick(this)">
                <div>
                  <div style="font-weight:700; font-size:0.95rem;">All Grocery</div>
                  <div style="font-size:0.78rem; color:var(--muted);">Explore all groceries & essentials</div>
                </div>
                <span class="filter-modal-card-badge">${groceryItems.length} items</span>
              </div>
            `;
          }

          const filteredGroceries = allGroceryCatsToDisplay.filter((sc) => !q || sc.toLowerCase().includes(q));
          if (!filteredGroceries.length && q) {
            html += `<p style="color:var(--muted); text-align:center; padding:1.5rem 0;">No grocery categories match "${escapeHtml(query)}"</p>`;
          } else {
            filteredGroceries.forEach((sc) => {
              const count = groceryItems.filter((m) => (m.category || '').toLowerCase() === sc.toLowerCase()).length;
              const isActive = selectedCategory.toLowerCase() === sc.toLowerCase();
              html += `
                <div class="filter-modal-card ${isActive ? 'active' : ''}" data-filter-type="grocery" data-filter-value="${escapeHtml(sc)}" onclick="handleFilterModalCardClick(this)">
                  <div>
                    <div style="font-weight:600; font-size:0.92rem;">${escapeHtml(sc)}</div>
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

        // Calculate counts for each primary header
        const totalItemsCount = allMenuItems.length;
        const groceryCount = allMenuItems.filter(isGroceryItem).length;
        const distinctCategories = getDistinctCategories();

        // 1. Primary Headers: Restaurants, Menus, F-Category, Grocery
        let headersHtml = `
          <button class="filter-pill ${mainCustomerTab === 'all_restaurants' ? 'active' : ''}" onclick="selectMainCustomerTab('all_restaurants')">
            🏪 Restaurants (${allRestaurants.length})
          </button>
          <button class="filter-pill ${mainCustomerTab === 'all_menus' ? 'active' : ''}" onclick="selectMainCustomerTab('all_menus')">
            🍽️ Menus (${totalItemsCount})
          </button>
          <button class="filter-pill ${mainCustomerTab === 'category' ? 'active' : ''}" onclick="selectMainCustomerTab('category')">
            📑 F-Category (${distinctCategories.length})
          </button>
          <button class="filter-pill ${mainCustomerTab === 'grocery' ? 'active' : ''}" onclick="selectMainCustomerTab('grocery')">
            🛒 Grocery (${groceryCount})
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

        if (mainCustomerTab === 'all_restaurants') {
          // --- RESTAURANTS TAB ---
          // Split pill: "All () ▼" (arrow opens modal popup) + stable last 5 restaurants
          const isAllActive = currentSelectedRestaurantId === 'all';
          const recentRests = getStablePillItems('restaurants', allRestaurants, (r) => r.id || r._id);

          subHtml += `
            <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
              <button type="button" class="split-filter-pill-action" onclick="selectRestaurantFilter('all')">
                All (${allMenuItems.length})
              </button>
              <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('all_restaurants')" title="Open all restaurants popup" aria-label="Open all restaurants popup">
                ▼
              </button>
            </div>
          `;

          // Stable 5 visited restaurant pills
          recentRests.forEach((rest) => {
            const restId = String(rest.id || rest._id);
            const count = allMenuItems.filter((m) => String(m.restaurantId) === restId).length;
            const restDisplay = formatCleanName(rest.name || rest.displayName || 'Restaurant');
            const isClosed = rest.isOpen === false || rest.isOnline === false;
            const statusBadge = isClosed ? ' <span style="font-size:0.7em; color:#ef4444; font-weight:700;">[CLOSED]</span>' : '';
            const isActive = currentSelectedRestaurantId === restId;
            subHtml += `
              <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; ${isClosed ? 'opacity:0.85; border-color:#fca5a5;' : ''}" onclick="selectRestaurantFilter('${restId}')">
                ${escapeHtml(restDisplay)}${statusBadge} (${count})
              </button>
            `;
          });
        } else if (mainCustomerTab === 'category') {
          // --- F-CATEGORY TAB ---
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
        } else if (mainCustomerTab === 'grocery') {
          // --- GROCERY TAB ---
          const groceryItems = allMenuItems.filter(isGroceryItem);
          const standardGroceryCategories = ['Spices', 'Dairy & Eggs', 'Staples', 'Snacks & Beverages', 'Fruits & Vegetables'];
          const existingGroceryCategories = Array.from(new Set(groceryItems.map((m) => (m.category || '').trim()).filter(Boolean)));
          const allGroceryCatsToDisplay = Array.from(new Set([...standardGroceryCategories, ...existingGroceryCategories]));

          const isAllActive = selectedCategory === 'all';
          const recentGroceries = getStablePillItems('groceries', allGroceryCatsToDisplay, (g) => g);

          subHtml += `
            <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
              <button type="button" class="split-filter-pill-action" onclick="selectGroceryFilter('all')">
                All Grocery (${groceryItems.length})
              </button>
              <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('grocery')" title="Open all grocery categories popup" aria-label="Open all grocery categories popup">
                ▼
              </button>
            </div>
          `;

          recentGroceries.forEach((sc) => {
            const count = groceryItems.filter((m) => (m.category || '').toLowerCase() === sc.toLowerCase()).length;
            const isActive = selectedCategory.toLowerCase() === sc.toLowerCase();
            subHtml += `
              <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectGroceryFilter('${escapeHtml(sc)}')">
                ${escapeHtml(sc)} (${count})
              </button>
            `;
          });
        } else if (mainCustomerTab === 'all_menus') {
          // --- MENUS TAB ---
          const isAllActive = selectedCategory === 'all' && selectedMenuItemId === 'all';
          const vegCount = allMenuItems.filter((m) => m.dietary !== 'non-veg').length;
          const nonVegCount = allMenuItems.filter((m) => m.dietary === 'non-veg').length;

          const recentMenuItems = getStablePillItems('menus', allMenuItems, (m) => m.id || m._id);

          subHtml += `
            <div class="split-filter-pill ${isAllActive ? 'active' : ''}">
              <button type="button" class="split-filter-pill-action" onclick="selectMenuItemFilter('all')">
                All Menus (${allMenuItems.length})
              </button>
              <button type="button" class="split-filter-pill-caret" onclick="openFilterSelectionModal('all_menus')" title="Open all menus popup" aria-label="Open all menus popup">
                ▼
              </button>
            </div>
            <button class="filter-pill ${selectedCategory === 'veg' && selectedMenuItemId === 'all' ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; border-color:#86efac; color:#16a34a;" onclick="selectMenuItemFilter('veg')">
              🟢 Pure Veg (${vegCount})
            </button>
            <button class="filter-pill ${selectedCategory === 'non-veg' && selectedMenuItemId === 'all' ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem; border-color:#fca5a5; color:#dc2626;" onclick="selectMenuItemFilter('non-veg')">
              🔴 Non-Veg (${nonVegCount})
            </button>
          `;

          recentMenuItems.forEach((item) => {
            const itemId = String(item.id || item._id);
            const isActive = selectedMenuItemId === itemId;
            subHtml += `
              <button class="filter-pill ${isActive ? 'active' : ''}" style="font-size:0.8rem; padding:0.35rem 0.8rem;" onclick="selectMenuItemFilter('${itemId}')">
                ${escapeHtml(item.name)} (₹${item.price})
              </button>
            `;
          });
        }

        subContainer.innerHTML = subHtml;
      }

      function selectMainCustomerTab(tab) {
        mainCustomerTab = tab;
        selectedCategory = 'all';
        currentSelectedRestaurantId = 'all';
        selectedMenuItemId = 'all';
        openDropdownTab = null;
        renderRestaurantPills();
        renderMenuItems();
      }

      function closeDropdownMenu() {
        closeFilterModal();
      }

      function selectRestaurantFilter(id) {
        currentSelectedRestaurantId = id;
        if (id !== 'all') {
          recordVisitedItem('restaurants', id);
        }
        closeFilterModal();
        renderRestaurantPills();
        renderMenuItems();
      }

      function selectCategoryFilter(cat) {
        selectedCategory = cat;
        if (cat !== 'all') {
          recordVisitedItem('categories', cat);
        }
        closeFilterModal();
        renderRestaurantPills();
        renderMenuItems();
      }

      function selectGroceryFilter(cat) {
        selectedCategory = cat;
        if (cat !== 'all') {
          recordVisitedItem('groceries', cat);
        }
        closeFilterModal();
        renderRestaurantPills();
        renderMenuItems();
      }

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
          recordVisitedItem('menus', val);
        }
        closeFilterModal();
        renderRestaurantPills();
        renderMenuItems();
      }

      function filterMenu() {
        renderMenuItems();
      }

      function renderMenuItems() {
        const grid = document.getElementById('menu-items-grid');
        if (!grid) return;

        const searchVal = (document.getElementById('dish-search')?.value || '').toLowerCase().trim();

        let filtered = allMenuItems;

        // 1. Primary tab filtering
        if (mainCustomerTab === 'all_restaurants') {
          if (currentSelectedRestaurantId !== 'all') {
            filtered = filtered.filter((m) => String(m.restaurantId) === String(currentSelectedRestaurantId));
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
        } else if (mainCustomerTab === 'grocery') {
          filtered = filtered.filter(isGroceryItem);
          if (selectedCategory !== 'all') {
            filtered = filtered.filter((m) => (m.category || '').toLowerCase() === selectedCategory.toLowerCase());
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
          const emptyMsg = mainCustomerTab === 'grocery'
            ? 'No grocery items currently found. Explore our restaurant menus or search for other dishes!'
            : 'No dishes match your selection.';
          grid.innerHTML = `<p style="color:var(--muted); padding:2rem; grid-column:1/-1; text-align:center;">${emptyMsg}</p>`;
          return;
        }

        grid.innerHTML = filtered.map((item) => {
          const dietaryClass = item.dietary === 'non-veg' ? 'dietary-non-veg' : 'dietary-veg';
          const dietaryText = item.dietary === 'non-veg' ? 'NON-VEG' : 'VEG';
          const matchRest = allRestaurants.find((r) => String(r.id || r._id) === String(item.restaurantId));
          const restDisplay = matchRest?.restaurantId
            ? `${matchRest.name} / ${matchRest.restaurantId}`
            : (matchRest?.displayName || item.restaurantName || 'Tomato Partner');
          const isRestClosed = matchRest && (matchRest.isOpen === false || matchRest.isOnline === false);

          return `
            <div class="food-card" style="${isRestClosed ? 'opacity:0.8; border-color:#fca5a5;' : ''}">
              <div>
                <div class="food-head">
                  <h3 class="food-title">${escapeHtml(item.name)}</h3>
                  <div style="display:flex; gap:0.35rem; align-items:center;">
                    ${isRestClosed ? '<span class="badge" style="background:#fee2e2; color:#b91c1c; font-size:0.68rem; font-weight:700; padding:0.12rem 0.4rem; border-radius:4px;">CLOSED</span>' : ''}
                    <span class="dietary-tag ${dietaryClass}">${dietaryText}</span>
                  </div>
                </div>
                <div class="food-meta">${escapeHtml(item.category || 'Dish')} • ${escapeHtml(restDisplay)}</div>
                <p class="food-desc">${escapeHtml(item.description || 'Deliciously prepared with authentic ingredients.')}</p>
                <div style="font-size:0.75rem; color:var(--muted); margin-bottom:0.6rem;">Available in stock: ${item.quantity || 10}</div>
              </div>
              <div class="food-bottom">
                <span class="food-price">₹${Number(item.price).toFixed(2)}</span>
                ${isRestClosed
                  ? `<button class="btn btn-outline btn-sm" disabled style="opacity:0.6; cursor:not-allowed; border-color:#f87171; color:#ef4444;" title="Restaurant is closed and not taking orders">
                      Closed
                    </button>`
                  : `<button class="btn btn-primary btn-sm" onclick="addToCart('${item._id || item.id}', '${escapeHtml(item.name)}', ${Number(item.price)}, '${item.restaurantId}')">
                      + Add to Cart
                    </button>`
                }
              </div>
            </div>
          `;
        }).join('');
      }

      // Cart management
      function addToCart(itemId, name, price, restaurantId) {
        const rest = allRestaurants.find((r) => String(r.id || r._id) === String(restaurantId));
        if (rest && (rest.isOpen === false || rest.isOnline === false)) {
          alert(`${rest.name} is currently closed and not accepting orders.`);
          return;
        }

        // Multi-restaurant alert check
        if (cart.length && cart[0].restaurantId && restaurantId && cart[0].restaurantId !== restaurantId) {
          const confirmSwitch = window.confirm('Your cart contains items from another restaurant. Replace cart with items from this restaurant?');
          if (confirmSwitch) {
            cart.length = 0;
          } else {
            return;
          }
        }

        const existing = cart.find((i) => i.itemId === itemId);
        if (existing) {
          existing.quantity += 1;
        } else {
          cart.push({ itemId, name, price, quantity: 1, restaurantId });
        }
        if (restaurantId) recordVisitedItem('restaurants', restaurantId);
        if (itemId) recordVisitedItem('menus', itemId);
        const itemObj = allMenuItems.find((m) => String(m.id || m._id) === String(itemId));
        if (itemObj && itemObj.category) {
          if (isGroceryItem(itemObj)) {
            recordVisitedItem('groceries', itemObj.category);
          } else {
            recordVisitedItem('categories', itemObj.category);
          }
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
        updateCartUI();
      }

      function updateCartUI() {
        const drawer = document.getElementById('cart-drawer');
        const container = document.getElementById('cart-items-container');
        if (!drawer || !container) return;

        if (!cart.length) {
          drawer.style.display = 'none';
          return;
        }

        drawer.style.display = 'block';

        container.innerHTML = cart.map((item) => `
          <div class="cart-row">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <div style="font-size:0.75rem; color:var(--muted);">₹${item.price.toFixed(2)} each</div>
            </div>
            <div class="cart-qty-ctrl">
              <button class="qty-btn" onclick="updateCartQuantity('${item.itemId}', -1)">-</button>
              <span style="font-weight:700; width:1.4rem; text-align:center;">${item.quantity}</span>
              <button class="qty-btn" onclick="updateCartQuantity('${item.itemId}', 1)">+</button>
            </div>
            <div style="font-weight:700; min-width:65px; text-align:right;">₹${(item.price * item.quantity).toFixed(2)}</div>
          </div>
        `).join('');

        const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const tax = Number((subtotal * 0.05).toFixed(2));
        const grandTotal = subtotal + tax + 40;

        document.getElementById('cart-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
        document.getElementById('cart-tax').textContent = `₹${tax.toFixed(2)}`;
        document.getElementById('cart-grand-total').textContent = `₹${grandTotal.toFixed(2)}`;

        const defaultAddr = customerAddresses.find((a) => a.isDefault) || customerAddresses[0];
        const labelEl = document.getElementById('cart-delivery-label');
        if (labelEl) {
          labelEl.innerHTML = defaultAddr
            ? `<strong>${escapeHtml(defaultAddr.label)}</strong> (${escapeHtml(defaultAddr.line1)}, ${escapeHtml(defaultAddr.city)}) ${defaultAddr.isDefault ? '<span class="badge badge-delivered" style="padding:1px 5px; font-size:0.7rem;">Default</span>' : ''}`
            : 'Home (Click Addresses tab to add)';
        }
      }

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
          <select id="checkout-address-select" style="width:100%; padding:0.5rem; border:1px solid var(--line); border-radius:6px; font-size:0.85rem; margin-bottom:0.4rem; background:#fff;" onchange="updateCheckoutAddressPreview()">
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

      function updateCheckoutAddressPreview() {
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

        preview.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.2rem;">
            <strong>📍 ${escapeHtml(addr.label || 'Home')}</strong>
            ${addr.isDefault ? '<span class="badge badge-delivered" style="padding:2px 7px; font-size:0.72rem;">✓ Default Address</span>' : '<span style="font-size:0.72rem; color:var(--muted);">Alternate Address</span>'}
          </div>
          <div style="color:var(--ink);">${escapeHtml(addr.line1)}${addr.line2 ? ', ' + escapeHtml(addr.line2) : ''}, ${escapeHtml(addr.city)}, ${escapeHtml(addr.state || '')} - <strong>${escapeHtml(addr.postalCode || '')}</strong></div>
          <div style="margin-top:0.2rem; font-size:0.78rem; color:var(--muted);">📞 Delivery Contact: <strong>${escapeHtml(addr.phone || user.phone || 'N/A')}</strong></div>
        `;

        if (defaultPrompt && makeDefaultCb) {
          if (addr.isDefault) {
            defaultPrompt.style.display = 'none';
            makeDefaultCb.checked = false;
          } else {
            defaultPrompt.style.display = 'block';
            makeDefaultCb.checked = false;
          }
        }
      }

      function switchToAddressManagement() {
        closeModal('payment-gateway-modal');
        switchView('customer-address');
        showNewAddressForm();
      }

      async function openPaymentGatewayModal() {
        if (!cart.length) {
          alert('Please add at least one dish to the cart.');
          return;
        }

        const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const tax = Number((subtotal * 0.05).toFixed(2));
        const grandTotal = subtotal + tax + 40;

        document.getElementById('gateway-amount').textContent = `₹${grandTotal.toFixed(2)}`;
        document.getElementById('gateway-items-count').textContent = cart.reduce((sum, i) => sum + i.quantity, 0);

        await populateCheckoutAddresses();
        openModal('payment-gateway-modal');
      }

      function switchGatewayTab(tab) {
        selectedPaymentMethod = tab;
        document.querySelectorAll('.gateway-tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.gateway-panel').forEach((p) => p.classList.remove('active'));

        event.target.classList.add('active');
        document.getElementById(`tab-${tab}`).classList.add('active');
      }

      async function executePaymentAndOrder() {
        const payBtn = document.getElementById('gateway-pay-btn');
        const loadingEl = document.getElementById('gateway-loading');

        payBtn.disabled = true;
        loadingEl.style.display = 'block';

        const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const tax = Number((subtotal * 0.05).toFixed(2));
        const totalAmount = subtotal + tax + 40;

        try {
          // 1. Process via Payment Gateway (if not COD)
          let txnId = 'COD-PAY-ON-DELIVERY';
          if (selectedPaymentMethod !== 'cod') {
            const paymentPayload = {
              amount: totalAmount,
              paymentMethod: selectedPaymentMethod,
              cardDetails: {
                number: document.getElementById('gw-card-num')?.value || '4111222233334444',
                exp: document.getElementById('gw-card-exp')?.value || '12/28',
                cvv: document.getElementById('gw-card-cvv')?.value || '123',
                name: document.getElementById('gw-card-name')?.value || user.name || 'Cardholder',
              },
              upiId: document.getElementById('gw-upi-id')?.value || 'customer@okaxis',
            };

            const payRes = await apiFetch('/api/customer/payment/process', {
              method: 'POST',
              body: JSON.stringify(paymentPayload),
            });
            txnId = payRes.transactionId;
          }

          // 2. Resolve Selected Delivery Address
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

          // If customer checked "Set this address as my new default delivery address"
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

          const deliveryAddress = {
            label: chosenAddr.label || 'Home',
            phone: chosenAddr.phone || user.phone || '',
            line1: chosenAddr.line1,
            line2: chosenAddr.line2 || '',
            city: chosenAddr.city,
            state: chosenAddr.state || '',
            postalCode: chosenAddr.postalCode || '',
            coordinates: chosenAddr.location?.coordinates || [77.5946, 12.9716],
          };

          // 3. Place order to restaurant
          const orderPayload = {
            restaurantId: cart[0]?.restaurantId,
            items: cart.map((i) => ({
              foodItemId: i.itemId,
              name: i.name,
              quantity: i.quantity,
              price: i.price,
            })),
            paymentMethod: selectedPaymentMethod,
            paymentTransactionId: txnId,
            addressId: chosenAddr._id,
            deliveryAddress,
          };

          const orderRes = await apiFetch('/api/customer/orders', {
            method: 'POST',
            body: JSON.stringify(orderPayload),
          });

          // Order created successfully!
          clearCart();
          closeModal('payment-gateway-modal');
          alert(`Order Placed Successfully!\nOrder Number: ${orderRes.order.orderNumber}\nDelivering To: ${chosenAddr.label} (${chosenAddr.line1}, ${chosenAddr.city})\nPayment Mode: ${selectedPaymentMethod.toUpperCase()}\nTransaction Ref: ${txnId}`);

          switchView('customer-orders');
        } catch (e) {
          alert(`Payment & Order Error: ${e.message}`);
        } finally {
          payBtn.disabled = false;
          loadingEl.style.display = 'none';
        }
      }

      // =========================================================================
      // CUSTOMER: ORDERS & TRACKING
      // =========================================================================
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
          const orders = data.orders || [];

          if (!orders.length) {
            container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">You have not placed any orders yet. Visit Order Online to select delicious meals!</p>';
            return;
          }

          container.innerHTML = orders.map((o) => {
            const steps = [
              { key: 'placed', label: 'Placed' },
              { key: 'accepted', label: 'Accepted' },
              { key: 'preparing', label: 'Cooking' },
              { key: 'out_for_delivery', label: 'On Route' },
              { key: 'delivered', label: 'Delivered' },
            ];

            const currentIdx = steps.findIndex((s) => s.key === o.status);

            return `
              <div style="border:1px solid var(--line); border-radius:10px; padding:1.2rem; margin-bottom:1.2rem; background:#fff;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.8rem;">
                  <div>
                    <h3 style="font-size:1.1rem; margin-bottom:0.2rem;">Order #${o.orderNumber}</h3>
                    <div style="font-size:0.8rem; color:var(--muted);">
                      Restaurant: <strong>${escapeHtml(o.restaurantName || 'Tomato Kitchen')}</strong>
                      ${o.digipin ? `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.72rem; margin-left:0.3rem;">📍 DIGIPIN: ${escapeHtml(o.digipin)}</span>` : ''}
                      ${o.riderName ? ` • 🚴 Rider: <strong style="color:var(--ink);">${escapeHtml(o.riderName)}</strong>` : ''}
                      • ${new Date(o.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                    <span class="badge badge-${o.status}">${o.status.replace(/_/g, ' ')}</span>
                    <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'customer')">📍 Live Tracking</button>
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

                <div style="display:flex; justify-content:space-between; align-items:center; padding-top:0.8rem; border-top:1px dashed var(--line); font-size:0.85rem;">
                  <div>
                    <span>Items: ${(o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', ')}</span>
                  </div>
                  <div>
                    <span>Payment: <strong style="text-transform:uppercase;">${o.paymentMethod || 'COD'} (${o.paymentStatus})</strong></span> • Total: <strong style="font-size:1rem; color:var(--green);">₹${Number(o.totalAmount).toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            `;
          }).join('');
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">Failed to load orders: ${e.message}</p>`;
          } else {
            console.error('Fetch customer orders error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

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
                <p style="margin:0.2rem 0; font-size:0.84rem; color:var(--muted);">${escapeHtml(a.city)}, ${escapeHtml(a.state || '')} - <strong>${escapeHtml(a.postalCode || '')}</strong></p>
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
          if (cart.length) {
            renderCart();
          }
        } catch (e) {
          alert(e.message);
        }
      }

      // =========================================================================
      // RESTAURANT: KITCHEN ORDERS & BILL GENERATION
      // =========================================================================
      // RESTAURANT: KITCHEN ORDERS & BILL GENERATION
      // =========================================================================
      let currentRestaurantOrderFilter = 'all'; // 'all' | 'cooking' | 'incoming'
      let cachedRestaurantOrders = [];

      function setRestaurantOrdersFilter(filter) {
        currentRestaurantOrderFilter = filter;
        updateRestaurantFilterButtons();
        if (cachedRestaurantOrders && cachedRestaurantOrders.length) {
          renderRestaurantOrdersTable(cachedRestaurantOrders);
        } else {
          fetchRestaurantOrders();
        }
      }
      window.setRestaurantOrdersFilter = setRestaurantOrdersFilter;

      function updateRestaurantFilterButtons() {
        const allBtn = document.getElementById('rest-filter-all');
        const cookingBtn = document.getElementById('rest-filter-cooking');
        const incomingBtn = document.getElementById('rest-filter-incoming');
        const indicator = document.getElementById('rest-filter-indicator');

        if (allBtn) allBtn.classList.toggle('active', currentRestaurantOrderFilter === 'all');
        if (cookingBtn) cookingBtn.classList.toggle('active', currentRestaurantOrderFilter === 'cooking');
        if (incomingBtn) incomingBtn.classList.toggle('active', currentRestaurantOrderFilter === 'incoming');

        if (indicator) {
          if (currentRestaurantOrderFilter === 'cooking') {
            indicator.style.display = 'inline-block';
            indicator.innerHTML = 'Filtered by: <strong>Accepted, Preparing, Out for Delivery</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setRestaurantOrdersFilter(\'all\')">Clear</button>';
          } else if (currentRestaurantOrderFilter === 'incoming') {
            indicator.style.display = 'inline-block';
            indicator.innerHTML = 'Filtered by: <strong>Placed</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setRestaurantOrdersFilter(\'all\')">Clear</button>';
          } else {
            indicator.style.display = 'none';
          }
        }
      }
      window.updateRestaurantFilterButtons = updateRestaurantFilterButtons;

      function renderRestaurantOrdersTable(orders) {
        const container = document.getElementById('restaurant-orders-table');
        if (!container) return;

        updateRestaurantFilterButtons();

        if (!orders.length) {
          container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No orders currently placed for your restaurant.</p>';
          return;
        }

        let displayOrders = orders;
        if (currentRestaurantOrderFilter === 'cooking') {
          displayOrders = orders.filter((o) => {
            const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
            return st === 'accepted' || st === 'preparing' || st === 'out for delivery';
          });
        } else if (currentRestaurantOrderFilter === 'incoming') {
          displayOrders = orders.filter((o) => {
            const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
            return st === 'placed';
          });
        }

        if (!displayOrders.length) {
          const emptyMsg = currentRestaurantOrderFilter === 'incoming'
            ? 'No incoming orders with status "placed" found.'
            : currentRestaurantOrderFilter === 'cooking'
            ? 'No orders with status "accepted, preparing or out for delivery" found.'
            : 'No orders found for the selected filter.';
          const emptyIcon = currentRestaurantOrderFilter === 'incoming' ? '🔔' : '🍳';
          container.innerHTML = `
            <div style="padding:2rem 1rem; text-align:center; color:var(--muted); background:#fcfcfc; border-radius:8px; border:1px dashed var(--line); margin-top:0.5rem;">
              <div style="font-size:2rem; margin-bottom:0.5rem;">${emptyIcon}</div>
              <p style="margin:0 0 0.75rem 0; font-weight:600; color:var(--ink);">${emptyMsg}</p>
              <button class="btn btn-primary btn-sm" onclick="setRestaurantOrdersFilter('all')">View All Kitchen Orders (${orders.length})</button>
            </div>
          `;
          return;
        }

        container.innerHTML = `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Dishes</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${displayOrders.map((o) => `
                  <tr>
                    <td><strong>#${o.orderNumber}</strong><br><small style="color:var(--muted);">${new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td>
                    <td>
                      <strong>${escapeHtml(o.customerName || 'Customer')}</strong><br>
                      <small style="color:var(--muted);">${escapeHtml(o.deliveryAddress?.line1 || '')}, ${escapeHtml(o.deliveryAddress?.city || '')}</small>
                      ${o.riderName ? `<br><small style="color:#0369a1; font-weight:600;">🚴 Rider: ${escapeHtml(o.riderName)}</small>` : ''}
                    </td>
                    <td>
                      ${(o.items || []).map((i) => `<div>${escapeHtml(i.name)} <span style="color:var(--muted); font-size:0.75rem;">x${i.quantity}</span></div>`).join('')}
                    </td>
                    <td><strong style="color:var(--green);">₹${Number(o.totalAmount).toFixed(2)}</strong></td>
                    <td><span class="badge ${o.paymentStatus === 'paid' ? 'badge-delivered' : 'badge-placed'}">${o.paymentMethod?.toUpperCase()} (${o.paymentStatus})</span></td>
                    <td><span class="badge badge-${o.status}">${o.status.replace(/_/g, ' ')}</span></td>
                    <td>
                      <div style="display:flex; flex-direction:column; gap:0.35rem;">
                        ${o.status === 'placed' ? `
                          <button class="btn btn-success btn-sm" onclick="updateOrderStatus('${o._id}', 'accepted')">✓ Accept Order</button>
                          <button class="btn btn-danger btn-sm" onclick="updateOrderStatus('${o._id}', 'cancelled')">✕ Decline</button>
                        ` : ''}
                        ${o.status === 'accepted' ? `
                          <button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${o._id}', 'preparing')">🍳 Mark Preparing</button>
                        ` : ''}
                        ${o.status === 'preparing' ? `
                          <button class="btn btn-success btn-sm" onclick="updateOrderStatus('${o._id}', 'ready_for_pickup')">📦 Ready for Pickup</button>
                        ` : ''}
                        ${o.riderName ? `
                          <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'restaurant')">📍 Track Rider</button>
                        ` : ''}
                        <button class="btn btn-outline btn-sm" onclick="viewOrderBill('${o._id}')">🧾 Generate Bill</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      async function fetchRestaurantOrders() {
        const container = document.getElementById('restaurant-orders-table');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('orders');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/restaurant/orders');
          cachedRestaurantOrders = data.orders || [];
          renderRestaurantOrdersTable(cachedRestaurantOrders);
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch restaurant orders error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      async function updateOrderStatus(orderId, nextStatus) {
        try {
          await apiFetch(`/api/restaurant/orders/${orderId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: nextStatus }),
          });
          fetchRestaurantOrders();
        } catch (e) {
          alert(`Status Update Failed: ${e.message}`);
        }
      }

      // =========================================================================
      // SHOP: ORDERS, PACKING & BILL GENERATION
      // =========================================================================
      let currentShopOrderFilter = 'all'; // 'all' | 'cooking' | 'incoming'
      let cachedShopOrders = [];

      function setShopOrdersFilter(filter) {
        currentShopOrderFilter = filter;
        updateShopFilterButtons();
        if (cachedShopOrders && cachedShopOrders.length) {
          renderShopOrdersTable(cachedShopOrders);
        } else {
          fetchShopOrders();
        }
      }
      window.setShopOrdersFilter = setShopOrdersFilter;

      function updateShopFilterButtons() {
        const allBtn = document.getElementById('shop-filter-all');
        const cookingBtn = document.getElementById('shop-filter-cooking');
        const incomingBtn = document.getElementById('shop-filter-incoming');
        const indicator = document.getElementById('shop-filter-indicator');

        if (allBtn) allBtn.classList.toggle('active', currentShopOrderFilter === 'all');
        if (cookingBtn) cookingBtn.classList.toggle('active', currentShopOrderFilter === 'cooking');
        if (incomingBtn) incomingBtn.classList.toggle('active', currentShopOrderFilter === 'incoming');

        if (indicator) {
          if (currentShopOrderFilter === 'cooking') {
            indicator.style.display = 'inline-block';
            indicator.innerHTML = 'Filtered by: <strong>Accepted, Preparing / Packing, Out for Delivery</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setShopOrdersFilter(\'all\')">Clear</button>';
          } else if (currentShopOrderFilter === 'incoming') {
            indicator.style.display = 'inline-block';
            indicator.innerHTML = 'Filtered by: <strong>Placed</strong> <button class="btn btn-xs btn-outline" style="margin-left:0.4rem; padding:0.15rem 0.5rem; font-size:0.75rem;" onclick="setShopOrdersFilter(\'all\')">Clear</button>';
          } else {
            indicator.style.display = 'none';
          }
        }
      }
      window.updateShopFilterButtons = updateShopFilterButtons;

      function renderShopOrdersTable(orders) {
        const container = document.getElementById('shop-orders-table');
        if (!container) return;

        updateShopFilterButtons();

        if (!orders.length) {
          container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No shop orders currently placed for your shop.</p>';
          return;
        }

        let displayOrders = orders;
        if (currentShopOrderFilter === 'cooking') {
          displayOrders = orders.filter((o) => {
            const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
            return st === 'accepted' || st === 'preparing' || st === 'out for delivery';
          });
        } else if (currentShopOrderFilter === 'incoming') {
          displayOrders = orders.filter((o) => {
            const st = String(o.status || '').toLowerCase().replace(/_/g, ' ').trim();
            return st === 'placed';
          });
        }

        if (!displayOrders.length) {
          const emptyMsg = currentShopOrderFilter === 'incoming'
            ? 'No incoming shop orders with status "placed" found.'
            : currentShopOrderFilter === 'cooking'
            ? 'No shop orders with status "accepted, preparing or out for delivery" found.'
            : 'No shop orders found for the selected filter.';
          const emptyIcon = currentShopOrderFilter === 'incoming' ? '🔔' : '📦';
          container.innerHTML = `
            <div style="padding:2rem 1rem; text-align:center; color:var(--muted); background:#fcfcfc; border-radius:8px; border:1px dashed var(--line); margin-top:0.5rem;">
              <div style="font-size:2rem; margin-bottom:0.5rem;">${emptyIcon}</div>
              <p style="margin:0 0 0.75rem 0; font-weight:600; color:var(--ink);">${emptyMsg}</p>
              <button class="btn btn-primary btn-sm" onclick="setShopOrdersFilter('all')">View All Shop Orders (${orders.length})</button>
            </div>
          `;
          return;
        }

        container.innerHTML = `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Products / Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${displayOrders.map((o) => `
                  <tr>
                    <td><strong>#${o.orderNumber}</strong><br><small style="color:var(--muted);">${new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td>
                    <td>
                      <strong>${escapeHtml(o.customerName || 'Customer')}</strong><br>
                      <small style="color:var(--muted);">${escapeHtml(o.deliveryAddress?.line1 || '')}, ${escapeHtml(o.deliveryAddress?.city || '')}</small>
                      ${o.riderName ? `<br><small style="color:#0369a1; font-weight:600;">🚴 Rider: ${escapeHtml(o.riderName)}</small>` : ''}
                    </td>
                    <td>
                      ${(o.items || []).map((i) => `<div>${escapeHtml(i.name)} <span style="color:var(--muted); font-size:0.75rem;">x${i.quantity}</span></div>`).join('')}
                    </td>
                    <td><strong style="color:var(--green);">₹${Number(o.totalAmount).toFixed(2)}</strong></td>
                    <td><span class="badge ${o.paymentStatus === 'paid' ? 'badge-delivered' : 'badge-placed'}">${o.paymentMethod?.toUpperCase()} (${o.paymentStatus})</span></td>
                    <td><span class="badge badge-${o.status}">${o.status.replace(/_/g, ' ')}</span></td>
                    <td>
                      <div style="display:flex; flex-direction:column; gap:0.35rem;">
                        ${o.status === 'placed' ? `
                          <button class="btn btn-success btn-sm" onclick="updateShopOrderStatus('${o._id}', 'accepted')">✓ Accept Order</button>
                          <button class="btn btn-danger btn-sm" onclick="updateShopOrderStatus('${o._id}', 'cancelled')">✕ Decline</button>
                        ` : ''}
                        ${o.status === 'accepted' ? `
                          <button class="btn btn-primary btn-sm" onclick="updateShopOrderStatus('${o._id}', 'preparing')">📦 Mark Packing</button>
                        ` : ''}
                        ${o.status === 'preparing' ? `
                          <button class="btn btn-success btn-sm" onclick="updateShopOrderStatus('${o._id}', 'ready_for_pickup')">✅ Ready for Pickup</button>
                        ` : ''}
                        ${o.riderName ? `
                          <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'shop')">📍 Track Rider</button>
                        ` : ''}
                        <button class="btn btn-outline btn-sm" onclick="viewShopOrderBill('${o._id}')">🧾 Generate Bill</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
      window.renderShopOrdersTable = renderShopOrdersTable;

      async function fetchShopOrders() {
        const container = document.getElementById('shop-orders-table');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('shop orders');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/shop/orders');
          cachedShopOrders = data.orders || [];
          renderShopOrdersTable(cachedShopOrders);
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch shop orders error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }
      window.fetchShopOrders = fetchShopOrders;

      async function updateShopOrderStatus(orderId, nextStatus) {
        try {
          await apiFetch(`/api/shop/orders/${orderId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: nextStatus }),
          });
          fetchShopOrders();
        } catch (e) {
          alert(`Shop Status Update Failed: ${e.message}`);
        }
      }
      window.updateShopOrderStatus = updateShopOrderStatus;

      async function viewShopOrderBill(orderId) {
        try {
          const data = await apiFetch(`/api/shop/orders/${orderId}/bill`);
          const bill = data.bill;

          const printArea = document.getElementById('bill-print-area');
          printArea.innerHTML = `
            <div class="bill-container">
              <div class="bill-head">
                <h2>${escapeHtml(bill.shop?.name || bill.restaurant?.name || 'Shop Partner')}</h2>
                <div style="font-size:0.8rem;">${escapeHtml(bill.shop?.address || bill.restaurant?.address || '')}</div>
                <div style="font-size:0.75rem;">Phone: ${escapeHtml(bill.shop?.phone || bill.restaurant?.phone || '')} | GSTIN: ${escapeHtml(bill.shop?.gstin || bill.restaurant?.gstin || '29AAAAA0000A1Z5')}</div>
                <div style="margin-top:0.6rem; font-weight:700; font-size:1.1rem; letter-spacing:0.1em;">RETAIL SHOP TAX INVOICE</div>
              </div>

              <div class="bill-details">
                <div>
                  <div><strong>Invoice #:</strong> ${bill.invoiceNumber}</div>
                  <div><strong>Order #:</strong> #${bill.orderNumber}</div>
                  <div><strong>Date:</strong> ${new Date(bill.date).toLocaleString()}</div>
                </div>
                <div style="text-align:right;">
                  <div><strong>Billed To:</strong> ${escapeHtml(bill.customer.name)}</div>
                  <div><strong>Contact:</strong> ${escapeHtml(bill.customer.phone || 'N/A')}</div>
                  <div><strong>Address:</strong> ${escapeHtml(bill.customer.address?.line1 || '')}, ${escapeHtml(bill.customer.address?.city || '')}</div>
                </div>
              </div>

              <table class="bill-table">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th style="text-align:center;">Qty</th>
                    <th style="text-align:right;">Rate</th>
                    <th style="text-align:right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${(bill.items || []).map((i) => `
                    <tr>
                      <td>${escapeHtml(i.name)}</td>
                      <td style="text-align:center;">${i.quantity}</td>
                      <td style="text-align:right;">₹${Number(i.price).toFixed(2)}</td>
                      <td style="text-align:right;">₹${Number(i.totalPrice || i.price * i.quantity).toFixed(2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="bill-totals">
                <div><span>Subtotal:</span> <strong>₹${Number(bill.subtotal).toFixed(2)}</strong></div>
                <div><span>CGST (2.5%):</span> <strong>₹${Number(bill.cgst).toFixed(2)}</strong></div>
                <div><span>SGST (2.5%):</span> <strong>₹${Number(bill.sgst).toFixed(2)}</strong></div>
                <div><span>Delivery & Packaging:</span> <strong>₹${Number(bill.deliveryFee).toFixed(2)}</strong></div>
                <div style="border-top:1px solid #111; margin-top:0.4rem; padding-top:0.4rem; font-size:1.15rem;">
                  <span>Grand Total:</span> <strong style="color:var(--green);">₹${Number(bill.totalAmount).toFixed(2)}</strong>
                </div>
              </div>

              <div style="margin-top:1rem; padding:0.6rem; background:#f4f4f4; border-radius:6px; font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  Payment Method: <strong>${(bill.paymentMethod || 'cod').toUpperCase()}</strong> (${bill.paymentStatus})
                </div>
                <div>Status: <span class="badge badge-${bill.orderStatus}">${(bill.orderStatus || '').replace(/_/g, ' ')}</span></div>
              </div>

              <div class="bill-footer">
                Thank you for shopping with ${escapeHtml(bill.shop?.name || bill.restaurant?.name || 'Shop Partner')} via Tomato!<br />
                This is a computer-generated tax invoice.
              </div>
            </div>
          `;

          openModal('bill-modal');
        } catch (e) {
          alert(`Shop Bill Generation Failed: ${e.message}`);
        }
      }
      window.viewShopOrderBill = viewShopOrderBill;

      // =========================================================================
      // SHOP: INVENTORY & ITEM MANAGEMENT
      // =========================================================================
      async function fetchShopItems() {
        const container = document.getElementById('shop-items-table');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('shop items');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/shop/items');
          const items = data.items || [];

          if (!items.length) {
            container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No items added to shop inventory yet. Click "+ Add New Shop Item" above.</p>';
            return;
          }

          container.innerHTML = `
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product / Item Name</th>
                    <th>Category</th>
                    <th>Unit / Pack</th>
                    <th>Price</th>
                    <th>Stock in Hand</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((it) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(it.name)}</strong>
                        ${it.description ? `<br><small style="color:var(--muted);">${escapeHtml(it.description)}</small>` : ''}
                      </td>
                      <td>${escapeHtml(it.category || 'General')}</td>
                      <td>${escapeHtml(it.unit || '1 unit')}</td>
                      <td><strong style="color:var(--green);">₹${Number(it.price).toFixed(2)}</strong></td>
                      <td>${it.quantity} in stock</td>
                      <td><span class="badge ${it.isActive ? 'badge-delivered' : 'badge-cancelled'}">${it.isActive ? 'Active' : 'Hidden'}</span></td>
                      <td>
                        <div style="display:flex; gap:0.4rem;">
                          <button class="btn btn-outline btn-sm" onclick="editShopItem('${it._id}', '${escapeHtml(it.name)}', '${escapeHtml(it.category || '')}', '${escapeHtml(it.unit || '')}', '${escapeHtml(it.description || '')}', ${it.price}, ${it.quantity}, ${Boolean(it.isActive)})">Edit</button>
                          <button class="btn btn-danger btn-sm" onclick="deleteShopItem('${it._id}')">Delete</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch shop items error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }
      window.fetchShopItems = fetchShopItems;

      function openAddShopItemModal() {
        document.getElementById('shop-modal-title').textContent = 'Add Shop Item';
        document.getElementById('shop-item-id').value = '';
        document.getElementById('si-name').value = '';
        document.getElementById('si-category').value = 'Groceries';
        document.getElementById('si-unit').value = '1 pack';
        document.getElementById('si-price').value = '';
        document.getElementById('si-quantity').value = '50';
        document.getElementById('si-desc').value = '';
        document.getElementById('si-active').checked = true;
        openModal('shop-item-modal');
      }
      window.openAddShopItemModal = openAddShopItemModal;

      function editShopItem(id, name, category, unit, desc, price, qty, isActive) {
        document.getElementById('shop-modal-title').textContent = 'Edit Shop Item';
        document.getElementById('shop-item-id').value = id;
        document.getElementById('si-name').value = name;
        document.getElementById('si-category').value = category;
        document.getElementById('si-unit').value = unit || '1 pack';
        document.getElementById('si-price').value = price;
        document.getElementById('si-quantity').value = qty;
        document.getElementById('si-desc').value = desc;
        document.getElementById('si-active').checked = isActive;
        openModal('shop-item-modal');
      }
      window.editShopItem = editShopItem;

      async function saveShopItem(e) {
        e.preventDefault();
        const id = document.getElementById('shop-item-id').value;
        const payload = {
          name: document.getElementById('si-name').value.trim(),
          category: document.getElementById('si-category').value.trim(),
          unit: document.getElementById('si-unit').value.trim(),
          price: Number(document.getElementById('si-price').value),
          quantity: Number(document.getElementById('si-quantity').value),
          description: document.getElementById('si-desc').value.trim(),
          isActive: document.getElementById('si-active').checked,
        };

        try {
          if (id) {
            await apiFetch(`/api/shop/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          } else {
            await apiFetch('/api/shop/items', { method: 'POST', body: JSON.stringify(payload) });
          }
          closeModal('shop-item-modal');
          fetchShopItems();
        } catch (err) {
          alert(`Error saving shop item: ${err.message}`);
        }
      }
      window.saveShopItem = saveShopItem;

      async function deleteShopItem(id) {
        if (!confirm('Are you sure you want to delete this shop item?')) return;
        try {
          await apiFetch(`/api/shop/items/${id}`, { method: 'DELETE' });
          fetchShopItems();
        } catch (e) {
          alert(e.message);
        }
      }
      window.deleteShopItem = deleteShopItem;

      // Generate & View Bill (Usable by Restaurant, Customer, and Admin)
      async function viewOrderBill(orderId) {
        try {
          const endpoint = role === 'restaurant'
            ? `/api/restaurant/orders/${orderId}/bill`
            : `/api/customer/orders/${orderId}/bill`;

          const data = await apiFetch(endpoint);
          const bill = data.bill;

          const printArea = document.getElementById('bill-print-area');
          printArea.innerHTML = `
            <div class="bill-container">
              <div class="bill-head">
                <h2>${escapeHtml(bill.restaurant.name)}</h2>
                <div style="font-size:0.8rem;">${escapeHtml(bill.restaurant.address)}</div>
                <div style="font-size:0.75rem;">Phone: ${escapeHtml(bill.restaurant.phone)} | GSTIN: ${escapeHtml(bill.restaurant.gstin)}</div>
                <div style="margin-top:0.6rem; font-weight:700; font-size:1.1rem; letter-spacing:0.1em;">RETAIL TAX INVOICE</div>
              </div>

              <div class="bill-details">
                <div>
                  <div><strong>Invoice #:</strong> ${bill.invoiceNumber}</div>
                  <div><strong>Order #:</strong> #${bill.orderNumber}</div>
                  <div><strong>Date:</strong> ${new Date(bill.date).toLocaleString()}</div>
                </div>
                <div style="text-align:right;">
                  <div><strong>Billed To:</strong> ${escapeHtml(bill.customer.name)}</div>
                  <div><strong>Contact:</strong> ${escapeHtml(bill.customer.phone || 'N/A')}</div>
                  <div><strong>Address:</strong> ${escapeHtml(bill.customer.address?.line1 || '')}, ${escapeHtml(bill.customer.address?.city || '')}</div>
                </div>
              </div>

              <table class="bill-table">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th style="text-align:center;">Qty</th>
                    <th style="text-align:right;">Rate</th>
                    <th style="text-align:right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${(bill.items || []).map((i) => `
                    <tr>
                      <td>${escapeHtml(i.name)}</td>
                      <td style="text-align:center;">${i.quantity}</td>
                      <td style="text-align:right;">₹${Number(i.price).toFixed(2)}</td>
                      <td style="text-align:right;">₹${Number(i.totalPrice).toFixed(2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div class="bill-summary">
                <div style="display:flex; justify-content:space-between;">
                  <span>Subtotal:</span>
                  <span>₹${Number(bill.subtotal).toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span>CGST (2.5%):</span>
                  <span>₹${Number(bill.cgst).toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span>SGST (2.5%):</span>
                  <span>₹${Number(bill.sgst).toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span>Packing & Delivery Fee:</span>
                  <span>₹${Number(bill.deliveryFee).toFixed(2)}</span>
                </div>
                <div class="bill-total-row">
                  <span>NET PAYABLE:</span>
                  <span>₹${Number(bill.totalAmount).toFixed(2)}</span>
                </div>
              </div>

              <div style="margin-top:0.8rem; font-size:0.75rem; border-top:1px dashed #777; padding-top:0.6rem;">
                <div>Payment Mode: <strong style="text-transform:uppercase;">${bill.paymentMethod} (${bill.paymentStatus})</strong></div>
                <div>Transaction ID: ${bill.paymentTransactionId}</div>
                ${bill.rider ? `<div>Assigned Rider: ${escapeHtml(bill.rider.name)} (${escapeHtml(bill.rider.phone)})</div>` : ''}
                <div style="text-align:center; margin-top:0.8rem;">Thank you for your order with Tomato! Visit Again.</div>
              </div>
            </div>
          `;

          openModal('bill-modal');
        } catch (e) {
          alert(`Unable to generate bill: ${e.message}`);
        }
      }

      // =========================================================================
      // RESTAURANT: MENU MANAGEMENT
      // =========================================================================
      async function fetchRestaurantMenu() {
        const container = document.getElementById('restaurant-menu-table');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('dishes');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/restaurant/menu');
          const menu = data.menu || [];

          if (!menu.length) {
            container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No dishes added yet. Click "+ Add New Food Item" above.</p>';
            return;
          }

          container.innerHTML = `
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Dish Name</th>
                    <th>Category</th>
                    <th>Dietary</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${menu.map((m) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(m.name)}</strong>
                        ${m.description ? `<br><small style="color:var(--muted);">${escapeHtml(m.description)}</small>` : ''}
                      </td>
                      <td>${escapeHtml(m.category)}</td>
                      <td><span class="dietary-tag ${m.dietary === 'non-veg' ? 'dietary-non-veg' : 'dietary-veg'}">${(m.dietary || 'veg').toUpperCase()}</span></td>
                      <td><strong style="color:var(--green);">₹${Number(m.price).toFixed(2)}</strong></td>
                      <td>${m.quantity} in stock</td>
                      <td><span class="badge ${m.isActive ? 'badge-delivered' : 'badge-cancelled'}">${m.isActive ? 'Active' : 'Hidden'}</span></td>
                      <td>
                        <div style="display:flex; gap:0.4rem;">
                          <button class="btn btn-outline btn-sm" onclick="editMenuItem('${m._id}', '${escapeHtml(m.name)}', '${escapeHtml(m.category)}', '${escapeHtml(m.description || '')}', ${m.price}, ${m.quantity}, '${m.dietary}', ${Boolean(m.isActive)})">Edit</button>
                          <button class="btn btn-danger btn-sm" onclick="deleteMenuItem('${m._id}')">Delete</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch restaurant menu error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      function openAddMenuItemModal() {
        document.getElementById('menu-modal-title').textContent = 'Add Menu Item';
        document.getElementById('menu-item-id').value = '';
        document.getElementById('mi-name').value = '';
        document.getElementById('mi-category').value = 'Main Course';
        document.getElementById('mi-dietary').value = 'veg';
        document.getElementById('mi-price').value = '';
        document.getElementById('mi-quantity').value = '20';
        document.getElementById('mi-desc').value = '';
        document.getElementById('mi-active').checked = true;
        openModal('menu-item-modal');
      }

      function editMenuItem(id, name, category, desc, price, qty, dietary, isActive) {
        document.getElementById('menu-modal-title').textContent = 'Edit Menu Item';
        document.getElementById('menu-item-id').value = id;
        document.getElementById('mi-name').value = name;
        document.getElementById('mi-category').value = category;
        document.getElementById('mi-dietary').value = dietary || 'veg';
        document.getElementById('mi-price').value = price;
        document.getElementById('mi-quantity').value = qty;
        document.getElementById('mi-desc').value = desc;
        document.getElementById('mi-active').checked = isActive;
        openModal('menu-item-modal');
      }

      async function saveMenuItem(e) {
        e.preventDefault();
        const id = document.getElementById('menu-item-id').value;
        const payload = {
          name: document.getElementById('mi-name').value.trim(),
          category: document.getElementById('mi-category').value.trim(),
          dietary: document.getElementById('mi-dietary').value,
          price: Number(document.getElementById('mi-price').value),
          quantity: Number(document.getElementById('mi-quantity').value),
          description: document.getElementById('mi-desc').value.trim(),
          isActive: document.getElementById('mi-active').checked,
        };

        try {
          if (id) {
            await apiFetch(`/api/restaurant/menu/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          } else {
            await apiFetch('/api/restaurant/menu', { method: 'POST', body: JSON.stringify(payload) });
          }
          closeModal('menu-item-modal');
          fetchRestaurantMenu();
        } catch (err) {
          alert(`Error saving food item: ${err.message}`);
        }
      }

      async function deleteMenuItem(id) {
        if (!confirm('Are you sure you want to delete this menu item?')) return;
        try {
          await apiFetch(`/api/restaurant/menu/${id}`, { method: 'DELETE' });
          fetchRestaurantMenu();
        } catch (e) {
          alert(e.message);
        }
      }

      // =========================================================================
      // RIDER: AVAILABLE, ACTIVE & EARNINGS
      // =========================================================================
      async function fetchAvailableRiderOrders() {
        const container = document.getElementById('rider-available-list');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('orders');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/rider/orders/available');
          const orders = data.orders || [];

          if (!orders.length) {
            container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No pickup orders currently available. As soon as restaurants accept and prepare orders, they will appear here!</p>';
            return;
          }

          container.innerHTML = orders.map((o) => {
            const restMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.restaurantAddress || o.restaurantName || 'Bengaluru')}`;
            const custMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}`;

            return `
              <div style="border:1px solid var(--line); border-radius:10px; padding:1.2rem; margin-bottom:1.2rem; background:#fff;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem;">
                  <div>
                    <h3 style="font-size:1.15rem; margin-bottom:0.2rem;">Order #${o.orderNumber}</h3>
                    <span class="badge badge-${o.status}">Restaurant Status: ${o.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button class="btn btn-danger btn-sm" onclick="rejectDeliveryOrder('${o._id}')">✕ Reject Offer</button>
                    <button class="btn btn-success btn-sm" onclick="acceptDeliveryOrder('${o._id}')">🚴 Accept Delivery</button>
                  </div>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1.2rem; margin:1rem 0; padding:0.9rem; background:#f9f6ee; border-radius:8px;">
                  <div>
                    <strong style="font-size:0.85rem; color:var(--tomato); text-transform:uppercase;">📍 Restaurant Pickup Location:</strong>
                    <div style="font-weight:700; margin-top:0.2rem;">${escapeHtml(o.restaurantName || 'Tomato Kitchen')}</div>
                    <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(o.restaurantAddress || 'Bengaluru Quarter')}</div>
                    <a href="${restMapUrl}" target="_blank" style="font-size:0.8rem; color:var(--blue); font-weight:600; display:inline-block; margin-top:0.3rem;">🗺️ Open Restaurant on Map</a>
                  </div>

                  <div>
                    <strong style="font-size:0.85rem; color:var(--green); text-transform:uppercase;">🏁 Customer Delivery Location:</strong>
                    <div style="font-weight:700; margin-top:0.2rem;">${escapeHtml(o.customerName || 'Customer')} (${escapeHtml(o.deliveryAddress?.phone || o.customerPhone || 'N/A')})</div>
                    <div style="font-size:0.84rem; color:var(--ink); margin:0.2rem 0;">
                      ${o.deliveryAddress?.label ? `<span class="badge badge-accepted" style="font-size:0.72rem; padding:1px 6px;">${escapeHtml(o.deliveryAddress.label)}</span> ` : ''}
                      ${escapeHtml(o.deliveryAddress?.line1 || '')}${o.deliveryAddress?.line2 ? ', ' + escapeHtml(o.deliveryAddress.line2) : ''}, ${escapeHtml(o.deliveryAddress?.city || '')} ${escapeHtml(o.deliveryAddress?.postalCode || '')}
                    </div>
                    <a href="${custMapUrl}" target="_blank" style="font-size:0.8rem; color:var(--blue); font-weight:600; display:inline-block; margin-top:0.3rem;">🗺️ Open Customer on Map</a>
                  </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; border-top:1px dashed var(--line); padding-top:0.8rem;">
                  <div>Dishes: ${(o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', ')}</div>
                  <div>Payment: <strong>${o.paymentMethod === 'cod' ? '💵 COLLECT ₹' + o.totalAmount + ' COD' : '✓ PREPAID ONLINE'}</strong></div>
                </div>
              </div>
            `;
          }).join('');
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch available rider orders error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      async function acceptDeliveryOrder(orderId) {
        try {
          await apiFetch(`/api/rider/orders/${orderId}/accept`, { method: 'POST' });
          alert('Delivery order claimed! Proceed to pick up the meal.');
          switchView('rider-active');
        } catch (e) {
          alert(`Accept Delivery Error: ${e.message}`);
        }
      }

      async function fetchActiveRiderOrders() {
        const container = document.getElementById('rider-active-list');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('deliveries');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/rider/orders/active');
          const orders = data.orders || [];

          if (!orders.length) {
            container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No deliveries currently assigned to you. Go to "Available Pickups" to accept a new delivery order!</p>';
            return;
          }

          container.innerHTML = orders.map((o) => {
            const custMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.deliveryAddress?.line1 || ''}, ${o.deliveryAddress?.city || ''}`)}`;

            return `
              <div style="border:2px solid var(--green); border-radius:12px; padding:1.4rem; background:#fff; box-shadow:var(--shadow);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.6rem;">
                  <div>
                    <span class="badge badge-transit" style="font-size:0.85rem;">🚴 OUT FOR DELIVERY IN PROGRESS</span>
                    <h2 style="font-size:1.35rem; margin:0.4rem 0 0.2rem;">Order #${o.orderNumber}</h2>
                  </div>
                  <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                    <button class="btn btn-outline" style="font-size:0.88rem; padding:0.6rem 1rem;" onclick="openOrderLiveTrackingModal('${o._id}', 'rider')">
                      📡 Live Route Radar
                    </button>
                    <button class="btn btn-success" style="font-size:0.95rem; padding:0.7rem 1.3rem;" onclick="markOrderDelivered('${o._id}')">
                      ✓ Mark as Delivered
                    </button>
                  </div>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem; margin:1.2rem 0; padding:1.2rem; background:#f4f9f5; border-radius:8px;">
                  <div>
                    <strong style="color:var(--tomato); font-size:0.82rem; text-transform:uppercase;">Pickup Restaurant:</strong>
                    <div style="font-size:1.05rem; font-weight:700; margin:0.2rem 0;">${escapeHtml(o.restaurantName || 'Restaurant')}</div>
                    ${o.digipin ? `<div style="font-size:0.82rem; margin:0.2rem 0;"><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">📍 DIGIPIN: ${escapeHtml(o.digipin)}</span></div>` : ''}
                    <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(o.restaurantAddress || 'Bengaluru')}</div>
                  </div>
                  <div>
                    <strong style="color:var(--muted); font-size:0.82rem; text-transform:uppercase;">Customer & Contact:</strong>
                    <div style="font-size:1.05rem; font-weight:700; margin:0.2rem 0;">${escapeHtml(o.customerName || 'Customer')}</div>
                    <div style="margin:0.4rem 0;">
                      <a href="tel:${o.deliveryAddress?.phone || o.customerPhone}" class="btn btn-outline btn-sm">📞 Call Customer: ${escapeHtml(o.deliveryAddress?.phone || o.customerPhone || 'N/A')}</a>
                    </div>
                  </div>
                  <div>
                    <strong style="color:var(--muted); font-size:0.82rem; text-transform:uppercase;">Destination Address:</strong>
                    <div style="font-weight:600; margin:0.2rem 0; font-size:0.92rem; color:var(--ink);">
                      ${o.deliveryAddress?.label ? `<span class="badge badge-accepted" style="font-size:0.72rem; padding:1px 6px;">${escapeHtml(o.deliveryAddress.label)}</span> ` : ''}
                      ${escapeHtml(o.deliveryAddress?.line1 || '')}${o.deliveryAddress?.line2 ? ', ' + escapeHtml(o.deliveryAddress.line2) : ''}, ${escapeHtml(o.deliveryAddress?.city || '')} ${escapeHtml(o.deliveryAddress?.postalCode || '')}
                    </div>
                    <a href="${custMapUrl}" target="_blank" class="btn btn-outline btn-sm" style="color:var(--blue);">🗺️ Open GPS Navigation</a>
                  </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed var(--line); padding-top:0.8rem;">
                  <div>Dishes: ${(o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', ')}</div>
                  <div style="font-weight:700; font-size:1.05rem;">
                    ${o.paymentMethod === 'cod' ? '<span style="color:var(--tomato-dark);">💵 Collect Cash on Delivery: ₹' + o.totalAmount + '</span>' : '<span style="color:var(--green);">✓ Paid Online via Gateway</span>'}
                  </div>
                </div>
              </div>
            `;
          }).join('');
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch active rider orders error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      async function markOrderDelivered(orderId) {
        if (!confirm('Confirm delivery: Has the order been delivered to the customer?')) return;
        try {
          await apiFetch(`/api/rider/orders/${orderId}/deliver`, { method: 'POST' });
          alert('Delivery completed successfully! ₹40 delivery fee has been credited to your earnings.');
          switchView('rider-history');
        } catch (e) {
          alert(`Delivery Error: ${e.message}`);
        }
      }

      async function fetchRiderHistory() {
        const container = document.getElementById('rider-history-list');
        if (!container) return;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('trips');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const data = await apiFetch('/api/rider/orders/history');
          const orders = data.orders || [];

          if (!orders.length) {
            container.innerHTML = '<p style="color:var(--muted); padding:1rem 0;">No deliveries completed yet.</p>';
            return;
          }

          container.innerHTML = `
            <div style="background:var(--green-soft); border:1px solid #a3e635; padding:1.2rem; border-radius:10px; margin-bottom:1.4rem; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <span style="font-size:0.85rem; color:#365314; font-weight:600;">TOTAL TRIP EARNINGS</span>
                <div style="font-size:2rem; font-weight:700; color:var(--green);">₹${data.totalEarnings || 0}</div>
              </div>
              <div style="text-align:right;">
                <span style="font-size:0.85rem; color:#365314;">COMPLETED DELIVERIES</span>
                <div style="font-size:1.5rem; font-weight:700; color:var(--ink);">${data.totalDeliveries || 0} Trips</div>
              </div>
            </div>

            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Customer</th>
                    <th>Restaurant</th>
                    <th>Delivered Date/Time</th>
                    <th>Trip Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  ${orders.map((o) => `
                    <tr>
                      <td><strong>#${o.orderNumber}</strong></td>
                      <td>${escapeHtml(o.customerName)}</td>
                      <td>${escapeHtml(o.restaurantName)}</td>
                      <td>${new Date(o.updatedAt).toLocaleString()}</td>
                      <td><span class="badge badge-delivered">+₹40.00</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch rider history error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      // =========================================================================
      // ADMIN: PLATFORM ORDERS (SEARCH, DATE FILTER, SINGLE & BULK ARCHIVE/DELETE)
      // =========================================================================
      let currentAdminOrdersList = [];
      let currentAdminOrdersPage = 1;
      let currentAdminOrdersDate = '';
      let currentAdminOrdersPagination = null;

      function navigateAdminOrderDay(direction) {
        if (!currentAdminOrdersPagination) {
          fetchAdminOrders(Math.max(1, currentAdminOrdersPage + direction));
          return;
        }
        if (direction > 0 && currentAdminOrdersPagination.hasNextPage) {
          fetchAdminOrders(currentAdminOrdersPage + 1);
        } else if (direction < 0 && currentAdminOrdersPagination.hasPrevPage) {
          fetchAdminOrders(currentAdminOrdersPage - 1);
        }
      }

      function fetchAdminOrdersByDate(dateStr) {
        if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
          fetchAdminOrders(null, dateStr.trim());
        }
      }

      function renderAdminOrdersPaginationUI(pagination) {
        currentAdminOrdersPagination = pagination;
        if (!pagination) return;

        // Update Date Picker input
        const picker = document.getElementById('admin-orders-date-picker');
        if (picker && pagination.currentDate) {
          picker.value = pagination.currentDate;
        }

        // Update Navigation buttons state
        const newerBtn = document.getElementById('admin-orders-newer-day-btn');
        const olderBtn = document.getElementById('admin-orders-older-day-btn');
        if (newerBtn) newerBtn.disabled = !pagination.hasPrevPage;
        if (olderBtn) olderBtn.disabled = !pagination.hasNextPage;

        const metaEl = document.getElementById('admin-orders-meta');
        const periodInfoEl = document.getElementById('admin-orders-period-info');

        if (metaEl) {
          metaEl.textContent = `Live orders for ${pagination.currentDateLabel || pagination.currentDate} • ${pagination.ordersOnThisDate} orders (Each page displays 1 day only)`;
        }
        if (periodInfoEl) {
          periodInfoEl.textContent = `Viewing ${pagination.currentDateLabel || pagination.currentDate} • ${pagination.ordersOnThisDate} orders on this page`;
        }
      }

      function renderAdminOrdersBottomPaginationHTML(pagination) {
        if (!pagination || pagination.totalPages <= 1) return '';
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem; padding-top:0.85rem; border-top:1px solid var(--line); flex-wrap:wrap; gap:0.6rem;">
            <div style="font-size:0.85rem; color:var(--muted);">
              Page <strong>${pagination.currentPage}</strong> of <strong>${pagination.totalPages}</strong>: <strong>${escapeHtml(pagination.currentDateLabel || pagination.currentDate)}</strong> (${pagination.ordersOnThisDate} orders on this day)
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasPrevPage ? 'disabled' : ''} onclick="navigateAdminOrderDay(-1)">◀ Newer Date</button>
              ${(pagination.dates || []).map((d) => {
                const isActive = d.page === pagination.currentPage;
                const shortLabel = d.isToday ? 'Today' : d.isYesterday ? 'Yesterday' : d.label.replace(/\s\d{4}$/, '');
                return `
                  <button
                    type="button"
                    class="btn ${isActive ? 'btn-primary' : 'btn-outline'} btn-sm"
                    style="padding:0.25rem 0.55rem; font-size:0.8rem; font-weight:${isActive ? '700' : '500'};"
                    onclick="fetchAdminOrders(${d.page})"
                  >
                    ${escapeHtml(shortLabel)} (${d.orderCount})
                  </button>
                `;
              }).join('')}
              <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasNextPage ? 'disabled' : ''} onclick="navigateAdminOrderDay(1)">Older Date ▶</button>
            </div>
          </div>
        `;
      }

      async function fetchAdminOrders(page, date, force = false) {
        if (page !== undefined && page !== null) {
          currentAdminOrdersPage = page;
          currentAdminOrdersDate = '';
        }
        if (date) {
          currentAdminOrdersDate = date;
        }

        const container = document.getElementById('admin-orders-table');
        if (!container) return;

        const status = document.getElementById('admin-order-status-filter')?.value || 'all';
        const search = document.getElementById('admin-orders-search')?.value.trim() || '';
        const archived = document.getElementById('admin-order-archive-filter')?.value || 'active';

        const cacheKey = `orders_${currentAdminOrdersPage || 1}_${currentAdminOrdersDate || ''}_${status}_${search}_${archived}`;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        const now = Date.now();

        if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 15000)) {
          return;
        }

        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('platform orders');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        const params = new URLSearchParams();
        if (status && status !== 'all') params.set('status', status);
        if (search) params.set('search', search);
        if (archived) params.set('archived', archived);

        if (currentAdminOrdersDate) {
          params.set('date', currentAdminOrdersDate);
        } else {
          params.set('page', String(currentAdminOrdersPage || 1));
        }

        try {
          const data = await apiFetch(`/api/admin/orders?${params.toString()}`);
          viewLastFetched[cacheKey] = now;
          const orders = data.orders || [];
          const pagination = data.pagination || null;
          currentAdminOrdersList = orders;

          if (pagination) {
            currentAdminOrdersPage = pagination.currentPage;
            currentAdminOrdersDate = pagination.currentDate;
            renderAdminOrdersPaginationUI(pagination);
          }

          updateAdminOrdersSelection();

          if (!orders.length) {
            const dateLabel = pagination?.currentDateLabel || pagination?.currentDate || 'this date';
            container.innerHTML = `
              <div style="background:#fcfaf5; border:1px dashed var(--line); border-radius:10px; padding:2.5rem 1.5rem; text-align:center; margin:1rem 0;">
                <p style="font-size:1.1rem; font-weight:700; color:var(--charcoal); margin-bottom:0.4rem;">No orders found for ${escapeHtml(dateLabel)}</p>
                <p style="color:var(--muted); font-size:0.85rem; margin-bottom:1rem;">Each page displays orders of 1 day only. Use the controls to navigate consecutive dates.</p>
                <div style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap;">
                  ${pagination?.hasPrevPage ? `<button class="btn btn-outline btn-sm" onclick="navigateAdminOrderDay(-1)">◀ Newer Date</button>` : ''}
                  <button class="btn btn-outline btn-sm" onclick="fetchAdminOrders(1)">📅 Today</button>
                  ${pagination?.hasNextPage ? `<button class="btn btn-primary btn-sm" onclick="navigateAdminOrderDay(1)">Older Date ▶</button>` : ''}
                </div>
              </div>
            `;
            return;
          }

          container.innerHTML = `
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style="width:36px; text-align:center;">
                      <input type="checkbox" id="admin-orders-select-all" onchange="toggleSelectAllAdminOrders(this.checked)" title="Select all orders" />
                    </th>
                    <th>Order #</th>
                    <th>Customer</th>
                    <th>Restaurant</th>
                    <th>Rider</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${orders.map((o) => {
                    const orderDisplayNum = o.orderNumber || String(o._id).slice(-6).toUpperCase();
                    const orderDateStr = o.createdAt ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const isArchived = Boolean(o.isArchived);

                    return `
                      <tr id="admin-order-row-${o._id}" style="${isArchived ? 'background:#faf9f6; opacity:0.88;' : ''}">
                        <td style="text-align:center;">
                          <input type="checkbox" class="admin-order-cb" value="${o._id}" onchange="updateAdminOrdersSelection()" />
                        </td>
                        <td>
                          <strong>#${escapeHtml(orderDisplayNum)}</strong>
                          ${isArchived ? '<span class="badge" style="background:#e2e8f0; color:#475569; font-size:0.68rem; margin-left:0.3rem;">Archived</span>' : ''}
                          <br><small style="color:var(--muted);">⏰ ${orderDateStr}</small>
                        </td>
                        <td>
                          <strong>${escapeHtml(formatCleanName(o.customerName || 'Customer'))}</strong>
                          ${o.customerPhone ? `<br><small style="color:var(--muted);">📞 ${escapeHtml(o.customerPhone)}</small>` : ''}
                        </td>
                        <td>${escapeHtml(formatCleanName(o.restaurantName || 'Restaurant'))}</td>
                        <td>${escapeHtml(formatCleanName(o.riderName || 'Unassigned'))}</td>
                        <td><strong>₹${Number(o.totalAmount || 0).toFixed(2)}</strong></td>
                        <td><span class="badge ${o.paymentStatus === 'paid' ? 'badge-delivered' : 'badge-placed'}">${(o.paymentMethod || 'cod').toUpperCase()} (${o.paymentStatus || 'pending'})</span></td>
                        <td><span class="badge badge-${o.status || 'placed'}">${String(o.status || 'placed').replace(/_/g, ' ')}</span></td>
                        <td style="text-align:right; white-space:nowrap;">
                          <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openOrderLiveTrackingModal('${o._id}', 'admin')" title="Live GPS Rider Telemetry">📍 Track</button>
                          <button class="btn btn-outline btn-sm" onclick="viewOrderBill('${o._id}')" title="View bill & tax invoice">🧾 Bill</button>
                          ${isArchived ? `
                            <button class="btn btn-outline btn-sm" onclick="archiveAdminOrder('${o._id}', false)" title="Unarchive this order">📂 Unarchive</button>
                          ` : `
                            <button class="btn btn-outline btn-sm" onclick="archiveAdminOrder('${o._id}', true)" title="Archive this order">📦 Archive</button>
                          `}
                          <button class="btn btn-sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:0.25rem 0.5rem;" onclick="deleteAdminOrder('${o._id}', '${escapeHtml(orderDisplayNum)}')" title="Permanently delete order">🗑️</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
            ${renderAdminOrdersBottomPaginationHTML(pagination)}
          `;
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch admin orders error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      function resetAdminOrdersFilter() {
        const searchInput = document.getElementById('admin-orders-search');
        const statusSelect = document.getElementById('admin-order-status-filter');
        const archiveSelect = document.getElementById('admin-order-archive-filter');

        if (searchInput) searchInput.value = '';
        if (statusSelect) statusSelect.value = 'all';
        if (archiveSelect) archiveSelect.value = 'active';

        currentAdminOrdersPage = 1;
        currentAdminOrdersDate = '';
        fetchAdminOrders(1);
      }

      function getSelectedAdminOrderIds() {
        const checkboxes = document.querySelectorAll('.admin-order-cb:checked');
        return Array.from(checkboxes).map(cb => cb.value);
      }

      function toggleSelectAllAdminOrders(checked) {
        const checkboxes = document.querySelectorAll('.admin-order-cb');
        checkboxes.forEach(cb => { cb.checked = checked; });
        updateAdminOrdersSelection();
      }

      function updateAdminOrdersSelection() {
        const selected = getSelectedAdminOrderIds();
        const count = selected.length;
        const countEl = document.getElementById('admin-orders-selected-count');
        const archiveBtn = document.getElementById('admin-bulk-archive-btn');
        const unarchiveBtn = document.getElementById('admin-bulk-unarchive-btn');
        const deleteBtn = document.getElementById('admin-bulk-delete-btn');
        const archiveFilter = document.getElementById('admin-order-archive-filter')?.value || 'active';

        if (countEl) {
          countEl.textContent = `${count} order${count === 1 ? '' : 's'} selected`;
        }

        if (count > 0) {
          if (deleteBtn) deleteBtn.style.display = 'inline-block';
          if (archiveFilter === 'archived') {
            if (unarchiveBtn) unarchiveBtn.style.display = 'inline-block';
            if (archiveBtn) archiveBtn.style.display = 'none';
          } else if (archiveFilter === 'all') {
            if (archiveBtn) archiveBtn.style.display = 'inline-block';
            if (unarchiveBtn) unarchiveBtn.style.display = 'inline-block';
          } else {
            if (archiveBtn) archiveBtn.style.display = 'inline-block';
            if (unarchiveBtn) unarchiveBtn.style.display = 'none';
          }
        } else {
          if (deleteBtn) deleteBtn.style.display = 'none';
          if (archiveBtn) archiveBtn.style.display = 'none';
          if (unarchiveBtn) unarchiveBtn.style.display = 'none';
        }

        // Update select-all checkbox state
        const allCbs = document.querySelectorAll('.admin-order-cb');
        const selectAllCb = document.getElementById('admin-orders-select-all');
        if (selectAllCb && allCbs.length > 0) {
          selectAllCb.checked = count === allCbs.length;
        }
      }

      async function archiveAdminOrder(orderId, isArchived) {
        const actionLabel = isArchived ? 'archive' : 'unarchive';
        if (!confirm(`Are you sure you want to ${actionLabel} this order?`)) return;

        try {
          const res = await apiFetch(`/api/admin/orders/${orderId}/archive`, {
            method: 'PUT',
            body: JSON.stringify({ isArchived }),
          });
          alert(res.message || `Order ${actionLabel}d successfully`);
          fetchAdminOrders();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      async function deleteAdminOrder(orderId, orderNum) {
        if (!confirm(`⚠️ Permanent Delete: Are you sure you want to delete order #${orderNum}? This action cannot be undone.`)) return;

        try {
          const res = await apiFetch(`/api/admin/orders/${orderId}`, {
            method: 'DELETE',
          });
          alert(res.message || 'Order deleted permanently');
          fetchAdminOrders();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      async function executeAdminBulkArchive(isArchived) {
        const orderIds = getSelectedAdminOrderIds();
        if (!orderIds.length) {
          alert('Please select at least one order to perform this action.');
          return;
        }

        const actionLabel = isArchived ? 'archive' : 'unarchive';
        if (!confirm(`Are you sure you want to ${actionLabel} ${orderIds.length} selected order(s)?`)) return;

        try {
          const res = await apiFetch('/api/admin/orders/bulk-archive', {
            method: 'POST',
            body: JSON.stringify({ orderIds, isArchived }),
          });
          alert(res.message || `Orders ${actionLabel}d successfully`);
          fetchAdminOrders();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      async function executeAdminBulkDelete() {
        const orderIds = getSelectedAdminOrderIds();
        if (!orderIds.length) {
          alert('Please select at least one order to delete.');
          return;
        }

        if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete ${orderIds.length} selected order(s)? This action CANNOT be undone.`)) return;

        try {
          const res = await apiFetch('/api/admin/orders/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ orderIds }),
          });
          alert(res.message || 'Selected orders deleted successfully');
          fetchAdminOrders();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      async function executeAdminPeriodArchive() {
        const targetDate = currentAdminOrdersDate || document.getElementById('admin-orders-date-picker')?.value || '';
        const status = document.getElementById('admin-order-status-filter')?.value || 'all';

        if (!targetDate) {
          alert('Please select a date first.');
          return;
        }

        const dateLabel = currentAdminOrdersPagination?.currentDateLabel || targetDate;
        if (!confirm(`📦 Bulk Archive by Date: Are you sure you want to archive ALL orders on ${dateLabel}?`)) return;

        try {
          const res = await apiFetch('/api/admin/orders/bulk-archive', {
            method: 'POST',
            body: JSON.stringify({ startDate: targetDate, endDate: targetDate, status, isArchived: true }),
          });
          alert(res.message || 'Orders archived successfully');
          fetchAdminOrders(currentAdminOrdersPage);
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      async function executeAdminPeriodDelete() {
        const targetDate = currentAdminOrdersDate || document.getElementById('admin-orders-date-picker')?.value || '';
        const status = document.getElementById('admin-order-status-filter')?.value || 'all';

        if (!targetDate) {
          alert('Please select a date first.');
          return;
        }

        const dateLabel = currentAdminOrdersPagination?.currentDateLabel || targetDate;
        if (!confirm(`⚠️ PERMANENT BULK DELETE: Are you sure you want to delete ALL orders on ${dateLabel}? This CANNOT be undone!`)) return;

        try {
          const res = await apiFetch('/api/admin/orders/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ startDate: targetDate, endDate: targetDate, status }),
          });
          alert(res.message || 'Orders on this day deleted permanently');
          fetchAdminOrders(currentAdminOrdersPage);
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      const adminUsersData = {
        shop: [],
        restaurant: [],
        deliveryPartner: [],
        customer: [],
      };
      const adminSearchQueries = {
        shop: '',
        restaurant: '',
        deliveryPartner: '',
        customer: '',
      };
      const adminUsersPagination = {
        shop: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
        restaurant: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
        deliveryPartner: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
        customer: { currentPage: 1, totalPages: 1, totalItems: 0, pageSize: 10, hasNextPage: false, hasPrevPage: false },
      };
      let adminSearchDebounceTimer = null;

      function getAdminRoleDomPrefix(role) {
        if (role === 'shop') return 'admin-shops';
        if (role === 'restaurant') return 'admin-restaurants';
        if (role === 'deliveryPartner') return 'admin-riders';
        if (role === 'customer') return 'admin-customers';
        return 'admin-' + role;
      }

      function changeAdminUserPage(role, targetPage) {
        const p = adminUsersPagination[role];
        if (!p) return;
        const next = Math.max(1, Math.min(targetPage, p.totalPages));
        adminUsersPagination[role].currentPage = next;
        fetchAdminUsers(role, adminSearchQueries[role] || '', next, true);
      }

      async function fetchAdminUsers(role, searchQuery = '', page = 1, force = false) {
        const prefix = getAdminRoleDomPrefix(role);
        const container = document.getElementById(`${prefix}-table`);
        const statusEl = document.getElementById(`${prefix}-search-status`);
        const clearBtn = document.getElementById(`${prefix}-clear-btn`);

        if (!container) return;
        const roleLabel = role === 'deliveryPartner' ? 'delivery partners' : role + 's';
        const cacheKey = `users_${role}_${searchQuery}_${page}`;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        const now = Date.now();

        if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 15000)) {
          return;
        }

        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton(roleLabel);
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        try {
          const params = new URLSearchParams();
          params.set('role', role);
          if (searchQuery) params.set('search', searchQuery);
          params.set('page', String(page || 1));
          params.set('limit', '10');

          const data = await apiFetch(`/api/admin/users?${params.toString()}`);
          viewLastFetched[cacheKey] = now;
          const users = data.users || [];
          const pagination = data.pagination || {
            currentPage: page || 1,
            totalPages: Math.ceil(users.length / 10) || 1,
            totalItems: users.length,
            pageSize: 10,
            hasNextPage: false,
            hasPrevPage: false,
          };

          adminUsersData[role] = users;
          adminSearchQueries[role] = searchQuery;
          adminUsersPagination[role] = pagination;

          if (clearBtn) {
            clearBtn.style.display = searchQuery ? 'inline-flex' : 'none';
          }

          if (statusEl) {
            if (searchQuery) {
              statusEl.style.display = 'block';
              statusEl.innerHTML = `Showing ${pagination.totalItems} ${roleLabel} matching &ldquo;<strong>${escapeHtml(searchQuery)}</strong>&rdquo; (Page ${pagination.currentPage} of ${pagination.totalPages})`;
            } else {
              statusEl.style.display = 'none';
              statusEl.innerHTML = '';
            }
          }

          container.innerHTML = renderPartnerManagementTable(users, role, searchQuery, pagination);
        } catch (e) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${e.message}</p>`;
          } else {
            console.error('Fetch admin users error:', e);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      function fetchAdminShops(page, force = false) {
        const query = document.getElementById('admin-shops-search')?.value?.trim() || '';
        const targetPage = page || adminUsersPagination.shop.currentPage || 1;
        return fetchAdminUsers('shop', query, targetPage, force);
      }
      window.fetchAdminShops = fetchAdminShops;

      function fetchAdminRestaurants(page, force = false) {
        const query = document.getElementById('admin-restaurants-search')?.value?.trim() || '';
        const targetPage = page || adminUsersPagination.restaurant.currentPage || 1;
        return fetchAdminUsers('restaurant', query, targetPage, force);
      }

      function fetchAdminRiders(page, force = false) {
        const query = document.getElementById('admin-riders-search')?.value?.trim() || '';
        const targetPage = page || adminUsersPagination.deliveryPartner.currentPage || 1;
        return fetchAdminUsers('deliveryPartner', query, targetPage, force);
      }

      function fetchAdminCustomers(page, force = false) {
        const query = document.getElementById('admin-customers-search')?.value?.trim() || '';
        const targetPage = page || adminUsersPagination.customer.currentPage || 1;
        return fetchAdminUsers('customer', query, targetPage, force);
      }

      function searchAdminUsers(role) {
        const prefix = getAdminRoleDomPrefix(role);
        const input = document.getElementById(`${prefix}-search`);
        const query = input?.value?.trim() || '';
        if (adminUsersPagination[role]) adminUsersPagination[role].currentPage = 1;
        fetchAdminUsers(role, query, 1, true);
      }

      function clearAdminSearch(role) {
        const prefix = getAdminRoleDomPrefix(role);
        const input = document.getElementById(`${prefix}-search`);
        if (input) input.value = '';
        if (adminUsersPagination[role]) adminUsersPagination[role].currentPage = 1;
        fetchAdminUsers(role, '', 1, true);
      }

      function handleAdminSearchInput(role) {
        const prefix = getAdminRoleDomPrefix(role);
        const input = document.getElementById(`${prefix}-search`);
        const clearBtn = document.getElementById(`${prefix}-clear-btn`);
        const query = input?.value?.trim() || '';

        if (clearBtn) {
          clearBtn.style.display = query ? 'inline-flex' : 'none';
        }

        clearTimeout(adminSearchDebounceTimer);
        adminSearchDebounceTimer = setTimeout(() => {
          if (adminUsersPagination[role]) adminUsersPagination[role].currentPage = 1;
          fetchAdminUsers(role, query, 1, true);
        }, 350);
      }

      function renderAdminUserPaginationControls(targetRole, pagination) {
        if (!pagination || pagination.totalPages <= 1) {
          if (pagination && pagination.totalItems > 0) {
            const roleLabel = targetRole === 'deliveryPartner' ? 'riders' : targetRole === 'restaurant' ? 'restaurants' : targetRole === 'shop' ? 'shops' : 'customers';
            return `
              <div style="margin-top:0.75rem; padding-top:0.6rem; border-top:1px solid var(--line); font-size:0.83rem; color:var(--muted); text-align:right;">
                Total: <strong>${pagination.totalItems}</strong> ${roleLabel} (All on 1 page)
              </div>
            `;
          }
          return '';
        }

        const startItem = pagination.totalItems === 0 ? 0 : (pagination.currentPage - 1) * pagination.pageSize + 1;
        const endItem = Math.min(pagination.currentPage * pagination.pageSize, pagination.totalItems);
        const roleLabel = targetRole === 'deliveryPartner' ? 'riders' : targetRole === 'restaurant' ? 'restaurants' : targetRole === 'shop' ? 'shops' : 'customers';

        const totalPages = pagination.totalPages;
        const current = pagination.currentPage;
        const pagesToShow = [];

        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= current - 1 && i <= current + 1)) {
            pagesToShow.push(i);
          } else if (pagesToShow[pagesToShow.length - 1] !== '...') {
            pagesToShow.push('...');
          }
        }

        return `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem; padding-top:0.85rem; border-top:1px solid var(--line); flex-wrap:wrap; gap:0.6rem;">
            <div style="font-size:0.85rem; color:var(--muted);">
              Showing <strong>${startItem}–${endItem}</strong> of <strong>${pagination.totalItems}</strong> ${roleLabel} (Page <strong>${current}</strong> of <strong>${totalPages}</strong>)
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasPrevPage ? 'disabled' : ''} onclick="changeAdminUserPage('${targetRole}', ${current - 1})">◀ Prev</button>
              ${pagesToShow.map((p) => {
                if (p === '...') return '<span style="color:var(--muted); padding:0 0.25rem;">…</span>';
                const isActive = p === current;
                return `
                  <button
                    type="button"
                    class="btn ${isActive ? 'btn-primary' : 'btn-outline'} btn-sm"
                    style="padding:0.25rem 0.55rem; font-size:0.8rem; font-weight:${isActive ? '700' : '500'};"
                    onclick="changeAdminUserPage('${targetRole}', ${p})"
                  >
                    ${p}
                  </button>
                `;
              }).join('')}
              <button type="button" class="btn btn-outline btn-sm" ${!pagination.hasNextPage ? 'disabled' : ''} onclick="changeAdminUserPage('${targetRole}', ${current + 1})">Next ▶</button>
            </div>
          </div>
        `;
      }

      function renderPartnerManagementTable(usersList, targetRole, searchQuery = '', pagination = null) {
        const roleLabel = targetRole === 'deliveryPartner' ? 'delivery partners' : targetRole === 'shop' ? 'shops' : targetRole + 's';
        if (!usersList.length) {
          if (searchQuery) {
            return `
              <div style="padding:2rem 1rem; text-align:center; color:var(--muted); background:#fdfdfd; border:1px dashed var(--line); border-radius:8px;">
                <p style="font-size:1rem; margin-bottom:0.6rem;">🔍 No ${roleLabel} found matching "<strong>${escapeHtml(searchQuery)}</strong>"</p>
                <button class="btn btn-outline btn-sm" onclick="clearAdminSearch('${targetRole}')">Clear Search</button>
              </div>
            `;
          }
          return `<p style="color:var(--muted); padding:1rem 0;">No accounts registered in this category.</p>`;
        }

        return `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name / Business</th>
                  <th>Contact (Mobile & Email)</th>
                  ${targetRole === 'restaurant' ? '<th>Address & Cuisine</th>' : ''}
                  ${targetRole === 'shop' ? '<th>Address & Category</th>' : ''}
                  ${targetRole === 'deliveryPartner' ? '<th>Vehicle</th>' : ''}
                  <th>Approval</th>
                  <th>Account Status</th>
                  <th>Admin Actions</th>
                </tr>
              </thead>
              <tbody>
                ${usersList.map((u) => {
                  const isPending = u.isApproved === false;
                  const isBlocked = Boolean(u.isBlocked);

                  const cleanName = formatCleanName(u.name || u.displayName);
                  let nameCellHtml = `<strong>${escapeHtml(cleanName)}</strong>`;
                  if (targetRole === 'restaurant') {
                    const rId = u.restaurantId || String(u.id || u._id);
                    nameCellHtml = `
                      <div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div>
                      <div style="margin-top:3px; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                        <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.75rem;">📍 DIGIPIN: ${escapeHtml(u.digipin || 'Not Set')}</span>
                        <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(u.id || u._id))}">ID: ${escapeHtml(rId)}</span>
                      </div>
                    `;
                  } else if (targetRole === 'shop') {
                    const sId = u.shopId || String(u.id || u._id);
                    nameCellHtml = `
                      <div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div>
                      <div style="margin-top:3px; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                        <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.75rem;">📍 DIGIPIN: ${escapeHtml(u.digipin || 'Not Set')}</span>
                        <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(u.id || u._id))}">ID: ${escapeHtml(sId)}</span>
                      </div>
                    `;
                  } else if (targetRole === 'deliveryPartner') {
                    const rdId = u.riderId || String(u.id || u._id);
                    nameCellHtml = `
                      <div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div>
                      <div style="margin-top:3px; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                        <span class="badge" style="background:${u.isOnline ? '#f0fdf4' : '#f1f5f9'}; color:${u.isOnline ? '#15803d' : '#64748b'}; font-weight:600; font-size:0.72rem;">
                          ● ${u.isOnline ? 'GPS Live Online' : 'GPS Offline'} ${u.currentLocation?.lat ? `(${u.currentLocation.lat.toFixed(3)}, ${u.currentLocation.lng.toFixed(3)})` : ''}
                        </span>
                        <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(u.id || u._id))}">ID: ${escapeHtml(rdId)}</span>
                      </div>
                    `;
                  } else if (targetRole === 'customer') {
                    const cId = u.customerId || String(u.id || u._id);
                    nameCellHtml = `
                      <div><strong style="font-size:0.95rem;">${escapeHtml(cleanName)}</strong></div>
                      <div style="margin-top:3px; display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
                        <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.72rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(u.id || u._id))}">ID: ${escapeHtml(cId)}</span>
                      </div>
                    `;
                  }

                  return `
                    <tr>
                      <td>
                        ${nameCellHtml}
                        <div style="margin-top:4px; font-size:0.75rem; color:#92400e; font-weight:600;">💳 Credit Points: ${Number(u.creditPoint ?? 0)}</div>
                      </td>
                      <td>
                        ${u.phone ? `<div>📞 <strong>${escapeHtml(u.phone)}</strong></div>` : '<div style="color:var(--muted); font-size:0.8rem;">No mobile</div>'}
                        ${u.email ? `<div style="margin-top:2px;">✉️ <a href="mailto:${escapeHtml(u.email)}" style="color:var(--ink);">${escapeHtml(u.email)}</a></div>` : '<div style="color:var(--muted); font-size:0.8rem;">No email</div>'}
                      </td>
                      ${targetRole === 'restaurant' ? `<td><small>${escapeHtml(u.restaurantAddress || 'Bengaluru')}</small><br><span class="badge badge-ready">${escapeHtml(u.cuisine || 'Multi-cuisine')}</span></td>` : ''}
                      ${targetRole === 'shop' ? `<td><small>${escapeHtml(u.shopAddress || u.restaurantAddress || 'Bengaluru')}</small><br><span class="badge badge-ready">${escapeHtml(u.category || 'Retail & Groceries')}</span></td>` : ''}
                      ${targetRole === 'deliveryPartner' ? `<td><span class="badge badge-accepted">${escapeHtml(u.deliveryVehicle || 'Bike')}</span></td>` : ''}
                      <td>
                        <span class="badge ${isPending ? 'badge-pending' : 'badge-approved'}">
                          ${isPending ? 'Pending Approval' : 'Approved'}
                        </span>
                      </td>
                      <td>
                        <span class="badge ${isBlocked ? 'badge-blocked' : 'badge-delivered'}">
                          ${isBlocked ? 'Blocked' : 'Active'}
                        </span>
                      </td>
                      <td>
                        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                          ${role === 'admin' ? `
                            <button type="button" class="btn btn-outline btn-sm" style="background:#fef3c7; border-color:#facc15; color:#92400e; font-weight:600;" onclick="openAdminCreditTransferModal('${escapeHtml(targetRole === 'customer' ? u.customerId || String(u.id || u._id) : targetRole === 'deliveryPartner' ? u.riderId || String(u.id || u._id) : targetRole === 'shop' ? u.shopId || String(u.id || u._id) : u.restaurantId || String(u.id || u._id))}')">💳 Add Credits</button>
                          ` : ''}
                          ${targetRole === 'deliveryPartner' ? `
                            <button class="btn btn-outline btn-sm" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:600;" onclick="openAdminFleetTrackerModal()">📍 Live Radar</button>
                          ` : ''}
                          ${isPending ? `
                            <button class="btn btn-success btn-sm" onclick="approveUser('${u.id || u._id}')">✓ Approve</button>
                            <button class="btn btn-danger btn-sm" onclick="rejectUser('${u.id || u._id}')">✕ Reject</button>
                          ` : ''}
                          <button class="btn ${isBlocked ? 'btn-success' : 'btn-danger'} btn-sm" onclick="toggleBlockUser('${u.id || u._id}', ${isBlocked})">
                            ${isBlocked ? 'Unblock' : 'Block'}
                          </button>
                          <button class="btn btn-outline btn-sm" onclick="editAdminUser('${u.id || u._id}', '${escapeHtml(cleanName)}', '${escapeHtml(u.email || '')}', '${escapeHtml(u.phone || '')}', '${u.role}', '${escapeHtml(u.shopAddress || u.restaurantAddress || '')}', '${escapeHtml(u.category || u.cuisine || '')}', '${escapeHtml(u.deliveryVehicle || '')}', '${escapeHtml(u.digipin || '')}', '${u.shopLocation?.lat || u.restaurantLocation?.lat || ''}', '${u.shopLocation?.lng || u.restaurantLocation?.lng || ''}')">Edit</button>
                          <button class="btn btn-danger btn-sm" onclick="deleteAdminUser('${u.id || u._id}', '${escapeHtml(cleanName)}', '${targetRole}')">🗑 Delete</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${renderAdminUserPaginationControls(targetRole, pagination)}
        `;
      }

      async function approveUser(userId) {
        try {
          await apiFetch(`/api/admin/users/${userId}/approve`, { method: 'POST' });
          alert('Partner account approved successfully!');
          refreshAdminViews();
        } catch (e) {
          alert(e.message);
        }
      }

      async function rejectUser(userId) {
        try {
          await apiFetch(`/api/admin/users/${userId}/reject`, { method: 'POST' });
          alert('Partner approval revoked/rejected.');
          refreshAdminViews();
        } catch (e) {
          alert(e.message);
        }
      }

      async function toggleBlockUser(userId, currentlyBlocked) {
        const action = currentlyBlocked ? 'unblock' : 'block';
        if (!confirm(`Are you sure you want to ${action} this account?`)) return;
        try {
          await apiFetch(`/api/admin/users/${userId}/${action}`, { method: 'POST' });
          alert(`Account ${action}ed successfully.`);
          refreshAdminViews();
        } catch (e) {
          alert(e.message);
        }
      }

      async function deleteAdminUser(userId, name, targetRole) {
        const roleLabel = targetRole === 'restaurant'
          ? 'restaurant and all its associated menu items'
          : targetRole === 'shop'
          ? 'shop and all its associated items'
          : `${targetRole} account`;
        if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete ${roleLabel} "${name}"? This CANNOT be undone.`)) return;
        try {
          const res = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
          alert(res.message || 'Account deleted successfully.');
          refreshAdminViews();
        } catch (e) {
          alert(`Error: ${e.message}`);
        }
      }

      function openAdminCreditTransferModal(recipientId = '') {
        if (role !== 'admin') return;
        const recipientInput = document.getElementById('admin-credit-recipient-id');
        const pointsInput = document.getElementById('admin-credit-points');
        const purposeInput = document.getElementById('admin-credit-purpose');
        const orderNumberInput = document.getElementById('admin-credit-order-number');
        if (recipientInput) recipientInput.value = recipientId;
        if (pointsInput) pointsInput.value = '';
        if (purposeInput) purposeInput.value = '';
        if (orderNumberInput) orderNumberInput.value = '';
        openModal('admin-credit-transfer-modal');
        if (recipientId) pointsInput?.focus();
        else recipientInput?.focus();
      }

      function showCurrentAdminWalletTransfer({ recipient, creditPoints, purpose, orderNumber, adminCreditPoint }) {
        const container = document.getElementById('admin-wallet-credit-track');
        if (!container) return;

        if (!container.querySelector('#current-wallet-transfers')) {
          container.innerHTML = `
            <div class="table-wrapper" style="max-height:360px; overflow:auto;">
              <table style="min-width:900px;">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Recipient</th>
                    <th>Purpose / Order</th>
                    <th>Credit Transferred</th>
                    <th>Admin Balance After (₹ / Points)</th>
                    <th>Recipient Credit After</th>
                  </tr>
                </thead>
                <tbody id="current-wallet-transfers"></tbody>
              </table>
            </div>
          `;
        }

        const timestamp = new Date().toLocaleString();
        const formatBalance = (value) =>
          Number(value ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        const formatPoints = (value) =>
          Number(value ?? 0).toLocaleString();
        const tbody = container.querySelector('#current-wallet-transfers');
        if (!tbody) return;

        tbody.insertAdjacentHTML('afterbegin', `
          <tr>
            <td>${escapeHtml(timestamp)}</td>
            <td><strong>${escapeHtml(recipient.name || 'Recipient')}</strong><br><small>${escapeHtml(recipient.role || '')} · ${escapeHtml(recipient.id || '')}</small></td>
            <td>${escapeHtml(purpose || '—')}${orderNumber ? `<br><small>Order: ${escapeHtml(orderNumber)}</small>` : ''}</td>
            <td>${escapeHtml(formatPoints(creditPoints))} points</td>
            <td>₹${escapeHtml(formatBalance(user.walletBalance))} / ${escapeHtml(formatPoints(adminCreditPoint))}</td>
            <td>${escapeHtml(formatPoints(recipient.creditPoint))} points</td>
          </tr>
        `);
      }

      async function submitAdminCreditTransfer(event) {
        event.preventDefault();
        if (role !== 'admin') {
          alert('Only an administrator can transfer credit points.');
          return;
        }

        const recipientId = document.getElementById('admin-credit-recipient-id')?.value?.trim() || '';
        const pointsInput = document.getElementById('admin-credit-points');
        const purpose = document.getElementById('admin-credit-purpose')?.value?.trim() || '';
        const orderNumber = document.getElementById('admin-credit-order-number')?.value?.trim() || '';
        const creditPoints = Number(pointsInput?.value);
        if (!recipientId) {
          alert('Enter a recipient account ID.');
          return;
        }
        if (!Number.isSafeInteger(creditPoints) || creditPoints <= 0) {
          alert('Enter a positive whole number of credit points.');
          return;
        }
        if (!purpose) {
          alert('Enter the purpose for this credit-point transfer.');
          return;
        }
        if (!confirm(`Transfer ${creditPoints} credit point(s) from your admin wallet to ${recipientId}?`)) return;

        const submitButton = document.getElementById('admin-credit-transfer-submit');
        if (submitButton) submitButton.disabled = true;
        try {
          const result = await apiFetch(
            `/api/admin/users/${encodeURIComponent(recipientId)}/credit-points`,
            {
              method: 'POST',
              body: JSON.stringify({ creditPoints, purpose, orderNumber }),
            },
          );
          user.creditPoint = result.adminCreditPoint;
          localStorage.setItem('tomatoUser', JSON.stringify(user));

          const walletText = document.getElementById('profile-wallet-text');
          if (walletText) {
            walletText.textContent = `${Number(user.walletBalance ?? 0).toFixed(2)}/${Number(user.creditPoint ?? 0).toFixed(0)}`;
          }

          document.getElementById('admin-credit-transfer-form')?.reset();
          showCurrentAdminWalletTransfer({
            recipient: result.recipient,
            creditPoints,
            purpose,
            orderNumber,
            adminCreditPoint: result.adminCreditPoint,
          });

          showToastNotification({
            title: 'Credit Points Transferred',
            message: `${creditPoints} point(s) added to ${result.recipient.name} (${result.recipient.role}). Admin wallet: ${result.adminCreditPoint} points remaining.`,
            type: 'success',
          });
          refreshAdminViews();
        } catch (error) {
          alert(`Credit-point transfer failed: ${error.message}`);
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      }

      function refreshAdminViews() {
        if (activeView === 'admin-shops') fetchAdminShops(null, true);
        else if (activeView === 'admin-restaurants') fetchAdminRestaurants(null, true);
        else if (activeView === 'admin-riders') fetchAdminRiders(null, true);
        else if (activeView === 'admin-customers') fetchAdminCustomers(null, true);
        else loadRoleOverview();
      }

      function detectAdminRestaurantGPS() {
        if (!('geolocation' in navigator)) {
          alert('Geolocation not supported in this browser.');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = Number(pos.coords.latitude.toFixed(5));
            const lng = Number(pos.coords.longitude.toFixed(5));
            const latEl = document.getElementById('adm-restaurant-lat');
            const lngEl = document.getElementById('adm-restaurant-lng');
            const digipinEl = document.getElementById('adm-restaurant-digipin');
            if (latEl) latEl.value = lat;
            if (lngEl) lngEl.value = lng;
            if (digipinEl && !digipinEl.value) {
              digipinEl.value = `DGP-${Math.round(lat * 100)}-${Math.round(lng * 100)}`;
            }
            alert(`Detected restaurant GPS coordinates: ${lat}, ${lng}`);
          },
          (err) => {
            alert(`GPS Error: ${err.message}. Please enter manually or try again.`);
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }

      // Admin Add / Edit User Modal
      function openAdminCreateUserModal(defaultRole = 'restaurant') {
        const roleLabel = defaultRole === 'shop' ? 'Shop Partner' : defaultRole === 'restaurant' ? 'Restaurant Partner' : defaultRole === 'deliveryPartner' ? 'Delivery Partner' : 'User';
        document.getElementById('admin-user-modal-title').textContent = `Add New ${roleLabel}`;
        document.getElementById('adm-user-id').value = '';
        document.getElementById('adm-role').value = defaultRole;
        document.getElementById('adm-name').value = '';
        document.getElementById('adm-email').value = '';
        document.getElementById('adm-phone').value = '';
        document.getElementById('adm-password').value = '';
        document.getElementById('adm-password-group').style.display = 'block';
        document.getElementById('adm-restaurant-address').value = '';
        document.getElementById('adm-cuisine').value = '';
        document.getElementById('adm-vehicle').value = '';
        const dPin = document.getElementById('adm-restaurant-digipin');
        if (dPin) dPin.value = '';
        const rLat = document.getElementById('adm-restaurant-lat');
        if (rLat) rLat.value = '';
        const rLng = document.getElementById('adm-restaurant-lng');
        if (rLng) rLng.value = '';
        toggleAdminUserFields();
        openModal('admin-user-modal');
      }

      function editAdminUser(id, name, email, phone, uRole, address, cuisine, vehicle, digipin = '', lat = '', lng = '') {
        document.getElementById('admin-user-modal-title').textContent = 'Edit User / Partner';
        document.getElementById('adm-user-id').value = id;
        document.getElementById('adm-role').value = uRole;
        document.getElementById('adm-name').value = formatCleanName(name);
        document.getElementById('adm-email').value = email;
        document.getElementById('adm-phone').value = phone;
        document.getElementById('adm-password-group').style.display = 'none'; // Password optional on edit
        document.getElementById('adm-restaurant-address').value = address;
        document.getElementById('adm-cuisine').value = cuisine;
        document.getElementById('adm-vehicle').value = vehicle;
        const dPin = document.getElementById('adm-restaurant-digipin');
        if (dPin) dPin.value = digipin;
        const rLat = document.getElementById('adm-restaurant-lat');
        if (rLat) rLat.value = lat;
        const rLng = document.getElementById('adm-restaurant-lng');
        if (rLng) rLng.value = lng;
        toggleAdminUserFields();
        openModal('admin-user-modal');
      }

      function toggleAdminUserFields() {
        const r = document.getElementById('adm-role')?.value;
        const restFields = document.getElementById('adm-restaurant-fields');
        const riderFields = document.getElementById('adm-rider-fields');
        if (restFields) {
          restFields.style.display = (r === 'restaurant' || r === 'shop') ? 'block' : 'none';
          const addrLabel = document.getElementById('adm-rest-address-label');
          if (addrLabel) addrLabel.innerHTML = (r === 'shop' ? 'Shop Address' : 'Restaurant Address') + ' <span style="color:var(--tomato);">*</span>';
          const digipinLabel = document.getElementById('adm-rest-digipin-label');
          if (digipinLabel) digipinLabel.innerHTML = (r === 'shop' ? 'Shop DIGIPIN' : 'Restaurant DIGIPIN') + ' <span style="color:var(--tomato);">*</span>';
          const catLabel = document.getElementById('adm-cuisine-label');
          if (catLabel) catLabel.textContent = r === 'shop' ? 'Shop Category / Speciality' : 'Cuisine';
        }
        if (riderFields) riderFields.style.display = r === 'deliveryPartner' ? 'block' : 'none';
      }

      async function saveAdminUser(e) {
        e.preventDefault();
        const id = document.getElementById('adm-user-id').value;
        const targetRole = document.getElementById('adm-role').value;
        const digipinVal = document.getElementById('adm-restaurant-digipin')?.value?.trim();
        const latVal = document.getElementById('adm-restaurant-lat')?.value;
        const lngVal = document.getElementById('adm-restaurant-lng')?.value;

        if ((targetRole === 'restaurant' || targetRole === 'shop') && !digipinVal && (!latVal || !lngVal)) {
          alert('Location requirement: Please provide either a valid DIGIPIN or click "Detect Device GPS Pin" to set pickup coordinates.');
          return;
        }

        const payload = {
          role: targetRole,
          name: document.getElementById('adm-name').value.trim(),
          email: document.getElementById('adm-email').value.trim() || undefined,
          phone: document.getElementById('adm-phone').value.trim() || undefined,
          password: document.getElementById('adm-password').value,
          restaurantAddress: document.getElementById('adm-restaurant-address').value.trim(),
          shopAddress: document.getElementById('adm-restaurant-address').value.trim(),
          cuisine: document.getElementById('adm-cuisine').value.trim(),
          category: document.getElementById('adm-cuisine').value.trim(),
          deliveryVehicle: document.getElementById('adm-vehicle').value.trim(),
          digipin: digipinVal || undefined,
          lat: latVal ? Number(latVal) : undefined,
          lng: lngVal ? Number(lngVal) : undefined,
        };

        try {
          if (id) {
            await apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          } else {
            if (!payload.password || payload.password.length < 8) {
              alert('Password must be at least 8 characters');
              return;
            }
            await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
          }
          closeModal('admin-user-modal');
          refreshAdminViews();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      // =========================================================================
      // ADMIN: SUB-ADMINS & ROLE-BASED ACCESS CONTROL (RBAC)
      // =========================================================================
      let currentSubAdminsList = [];
      let adminSubAdminSearchDebounceTimer = null;

      const RBAC_PERMISSIONS_MAP = {
        dashboard_view: { label: 'Analytics', icon: '📊', color: '#0284c7' },
        orders_manage: { label: 'Orders', icon: '📦', color: '#d94b35' },
        shops_manage: { label: 'Shops', icon: '🏬', color: '#059669' },
        restaurants_manage: { label: 'Restaurants', icon: '🏪', color: '#16a34a' },
        riders_manage: { label: 'Riders Fleet', icon: '🚴', color: '#ea580c' },
        customers_manage: { label: 'Customers', icon: '👥', color: '#9333ea' },
        subadmins_manage: { label: 'Sub-Admins', icon: '🛡️', color: '#475569' },
      };

      const RBAC_PRESETS = {
        operations_lead: ['dashboard_view', 'orders_manage', 'riders_manage'],
        restaurant_lead: ['orders_manage', 'restaurants_manage', 'shops_manage'],
        support_lead: ['orders_manage', 'customers_manage', 'riders_manage'],
        full_admin: ['dashboard_view', 'orders_manage', 'shops_manage', 'restaurants_manage', 'riders_manage', 'customers_manage', 'subadmins_manage'],
      };

      function applySubAdminPreset(preset, prefix) {
        const perms = RBAC_PRESETS[preset] || [];
        Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
          const cb = document.getElementById(`${prefix}${key}`);
          if (cb) {
            cb.checked = perms.includes(key);
          }
        });
      }

      function handleAdminSubAdminSearchInput() {
        const input = document.getElementById('admin-subadmins-search');
        const clearBtn = document.getElementById('admin-subadmins-clear-btn');
        const q = input?.value?.trim() || '';

        if (clearBtn) {
          clearBtn.style.display = q ? 'inline-flex' : 'none';
        }

        clearTimeout(adminSubAdminSearchDebounceTimer);
        adminSubAdminSearchDebounceTimer = setTimeout(() => {
          fetchAdminSubAdmins(true);
        }, 350);
      }

      function clearAdminSubAdminsSearch() {
        const input = document.getElementById('admin-subadmins-search');
        if (input) input.value = '';
        const clearBtn = document.getElementById('admin-subadmins-clear-btn');
        if (clearBtn) clearBtn.style.display = 'none';
        fetchAdminSubAdmins(true);
      }

      async function fetchAdminSubAdmins(force = false) {
        const container = document.getElementById('admin-subadmins-table');
        const statsContainer = document.getElementById('admin-subadmins-stats');
        if (!container) return;

        const q = document.getElementById('admin-subadmins-search')?.value?.trim() || '';
        const cacheKey = `subadmins_${q}`;
        const hasExisting = container.children.length > 0 && !container.querySelector('.skeleton-shimmer');
        const now = Date.now();

        if (!force && hasExisting && viewLastFetched[cacheKey] && (now - viewLastFetched[cacheKey] < 15000)) {
          return;
        }

        if (!hasExisting) {
          container.innerHTML = renderTableSkeleton('sub-administrators');
        } else {
          container.style.opacity = '0.75';
          container.style.transition = 'opacity 0.15s ease';
        }

        const queryParam = q ? `?search=${encodeURIComponent(q)}` : '';

        try {
          const res = await apiFetch(`/api/admin/subadmins${queryParam}`);
          viewLastFetched[cacheKey] = now;
          const subadmins = res.subadmins || [];
          currentSubAdminsList = subadmins;

          // Render stats
          const activeCount = subadmins.filter(s => !s.isBlocked).length;
          const blockedCount = subadmins.filter(s => s.isBlocked).length;
          const fullAccessCount = subadmins.filter(s => Array.isArray(s.permissions) && s.permissions.length >= 6).length;

          if (statsContainer) {
            statsContainer.innerHTML = `
              <div class="stat-card"><span class="stat-label">Total Sub-Admins</span><div class="stat-value">${subadmins.length}</div><span class="stat-note">Delegated operators</span></div>
              <div class="stat-card"><span class="stat-label">Active Team</span><div class="stat-value" style="color:var(--green);">${activeCount}</div><span class="stat-note">Operating normally</span></div>
              <div class="stat-card"><span class="stat-label">Blocked / Restricted</span><div class="stat-value" style="color:${blockedCount ? 'var(--tomato)' : 'var(--muted)'};">${blockedCount}</div><span class="stat-note">Access revoked</span></div>
              <div class="stat-card"><span class="stat-label">Full Co-Admins</span><div class="stat-value">${fullAccessCount}</div><span class="stat-note">All 6 permissions</span></div>
            `;
          }

          if (!subadmins.length) {
            container.innerHTML = `
              <div style="text-align:center; padding:2.5rem 1rem; color:var(--muted); background:#faf8f5; border:1px dashed var(--line); border-radius:10px;">
                <span style="font-size:2rem; display:block; margin-bottom:0.5rem;">🛡️</span>
                <strong style="font-size:1.1rem; color:var(--ink);">${q ? `No sub-admins found matching "${escapeHtml(q)}"` : 'No Sub-Administrators Created Yet'}</strong>
                <p style="margin-top:0.4rem; font-size:0.85rem;">Click "+ Create Sub-Admin" above to delegate management roles with custom permissions.</p>
                <div style="margin-top:1rem;">
                  <button type="button" class="btn btn-primary btn-sm" style="background:var(--green); border-color:var(--green);" onclick="openCreateSubAdminModal()">➕ Create Sub-Admin</button>
                </div>
              </div>
            `;
            return;
          }

          container.innerHTML = `
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Sub-Admin &amp; Operational Title</th>
                    <th>Contact Details</th>
                    <th>Assigned RBAC Permissions</th>
                    <th>Status</th>
                    <th>Created By</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${subadmins.map(s => {
                    const roleTitle = s.adminRoleTitle || 'Sub-Admin';
                    const isBlocked = Boolean(s.isBlocked);
                    const perms = Array.isArray(s.permissions) ? s.permissions : [];

                    const permsBadges = perms.map(pKey => {
                      const meta = RBAC_PERMISSIONS_MAP[pKey] || { label: pKey, icon: '🔑', color: '#475569' };
                      return `<span class="badge" style="background:#f1f5f9; color:${meta.color}; border:1px solid #e2e8f0; font-size:0.7rem; margin:0.15rem 0.2rem 0.15rem 0; display:inline-flex; align-items:center; gap:0.25rem;">${meta.icon} ${meta.label}</span>`;
                    }).join('');

                    const sId = s.subadminId || String(s.id || s._id);
                    return `
                      <tr id="subadmin-row-${s._id}" style="${isBlocked ? 'background:#faf9f6; opacity:0.85;' : ''}">
                        <td>
                          <div style="font-weight:700; color:var(--ink);">${escapeHtml(formatCleanName(s.name || s.displayName || 'Sub-Admin'))}</div>
                          <div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap; margin-top:0.2rem;">
                            <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.72rem;">${escapeHtml(roleTitle)}</span>
                            <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem; font-family:monospace;" title="MongoDB ID: ${escapeHtml(String(s.id || s._id))}">ID: ${escapeHtml(sId)}</span>
                          </div>
                        </td>
                        <td>
                          <div>✉️ ${escapeHtml(s.email || 'N/A')}</div>
                          ${s.phone ? `<small style="color:var(--muted);">📞 ${escapeHtml(s.phone)}</small>` : ''}
                        </td>
                        <td>
                          <div style="display:flex; flex-wrap:wrap; max-width:320px;">
                            ${permsBadges || '<span style="color:var(--muted); font-size:0.75rem;">No permissions</span>'}
                          </div>
                        </td>
                        <td>
                          <span class="badge ${isBlocked ? 'badge-cancelled' : 'badge-delivered'}">
                            ${isBlocked ? 'Restricted / Blocked' : 'Active'}
                          </span>
                        </td>
                        <td>
                          <small style="color:var(--muted);">${escapeHtml(s.createdBy || 'Platform Admin')}</small>
                        </td>
                        <td style="text-align:right; white-space:nowrap;">
                          <button class="btn btn-outline btn-sm" onclick="openEditSubAdminModal('${s._id}')" title="Configure permissions">⚙️ Permissions</button>
                          <button class="btn btn-outline btn-sm" style="${isBlocked ? 'color:var(--green); border-color:var(--green);' : 'color:var(--tomato); border-color:var(--tomato);'}" onclick="toggleSubAdminStatus('${s._id}', ${isBlocked})">
                            ${isBlocked ? '✓ Unblock' : '🚫 Block'}
                          </button>
                          <button class="btn btn-sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:0.25rem 0.5rem;" onclick="deleteSubAdmin('${s._id}', '${escapeHtml(s.name)}')" title="Delete sub-admin">🗑️</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;
        } catch (err) {
          if (!hasExisting) {
            container.innerHTML = `<p style="color:var(--tomato-dark); padding:1rem 0;">${err.message}</p>`;
          } else {
            console.error('Fetch subadmins error:', err);
          }
        } finally {
          container.style.opacity = '1';
        }
      }

      function openCreateSubAdminModal() {
        try {
          const form = document.getElementById('create-subadmin-form');
          if (form) form.reset();

          const nameInput = document.getElementById('subadm-name');
          if (nameInput) nameInput.value = '';
          const emailInput = document.getElementById('subadm-email');
          if (emailInput) emailInput.value = '';
          const phoneInput = document.getElementById('subadm-phone');
          if (phoneInput) phoneInput.value = '';
          const passInput = document.getElementById('subadm-password');
          if (passInput) passInput.value = '';
          const titleInput = document.getElementById('subadm-title');
          if (titleInput) titleInput.value = 'Operations Sub-Admin';
          const presetSelect = document.getElementById('subadm-preset');
          if (presetSelect) presetSelect.value = 'operations_lead';

          if (typeof applySubAdminPreset === 'function') {
            applySubAdminPreset('operations_lead', 'subadm-perm-');
          }
        } catch (err) {
          console.warn('Error preparing subadmin form:', err);
        }
        openModal('admin-create-subadmin-modal');
      }

      async function submitCreateSubAdmin(e) {
        if (e && e.preventDefault) e.preventDefault();
        const submitBtn = document.getElementById('btn-create-subadmin-submit');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
        }

        const name = document.getElementById('subadm-name')?.value?.trim() || '';
        const email = document.getElementById('subadm-email')?.value?.trim() || '';
        const phone = document.getElementById('subadm-phone')?.value?.trim() || '';
        const password = document.getElementById('subadm-password')?.value || '';
        const adminRoleTitle = document.getElementById('subadm-title')?.value?.trim() || 'Operations Sub-Admin';

        if (!name) {
          alert('Full name is required.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
          return;
        }

        if (!email && !phone) {
          alert('Please enter either an email address or mobile number.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
          return;
        }

        if (!password || password.length < 8) {
          alert('Password must be at least 8 characters long.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
          return;
        }

        // Collect checked permissions
        const permissions = [];
        if (typeof RBAC_PERMISSIONS_MAP !== 'undefined') {
          Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
            if (document.getElementById(`subadm-perm-${key}`)?.checked) {
              permissions.push(key);
            }
          });
        }

        if (!permissions.length) {
          alert('Please select at least one permission for this sub-admin.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Sub-Admin'; }
          return;
        }

        try {
          const res = await apiFetch('/api/admin/subadmins', {
            method: 'POST',
            body: JSON.stringify({ name, email, phone, password, adminRoleTitle, permissions }),
          });

          alert(res.message || 'Sub-admin created successfully!');
          closeModal('admin-create-subadmin-modal');
          fetchAdminSubAdmins();
        } catch (err) {
          alert(`Error: ${err.message}`);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Sub-Admin';
          }
        }
      }

      function openEditSubAdminModal(subAdminId) {
        const subAdmin = currentSubAdminsList.find(s => s._id === subAdminId);
        if (!subAdmin) return;

        document.getElementById('edit-subadm-id').value = subAdmin._id;
        document.getElementById('edit-subadm-name').textContent = subAdmin.name;
        document.getElementById('edit-subadm-email').textContent = subAdmin.email || subAdmin.phone || '';
        document.getElementById('edit-subadm-title').value = subAdmin.adminRoleTitle || 'Operations Sub-Admin';
        document.getElementById('edit-subadm-badge').textContent = subAdmin.adminRoleTitle || 'Sub-Admin';

        const perms = Array.isArray(subAdmin.permissions) ? subAdmin.permissions : [];
        Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
          const cb = document.getElementById(`edit-subadm-perm-${key}`);
          if (cb) cb.checked = perms.includes(key);
        });

        document.getElementById('edit-subadm-preset').value = 'custom';
        openModal('admin-edit-subadmin-modal');
      }

      async function submitEditSubAdminPermissions(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-edit-subadmin-submit');
        if (submitBtn) submitBtn.disabled = true;

        const id = document.getElementById('edit-subadm-id').value;
        const adminRoleTitle = document.getElementById('edit-subadm-title').value.trim();

        const permissions = [];
        Object.keys(RBAC_PERMISSIONS_MAP).forEach((key) => {
          if (document.getElementById(`edit-subadm-perm-${key}`)?.checked) {
            permissions.push(key);
          }
        });

        try {
          const res = await apiFetch(`/api/admin/subadmins/${id}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ adminRoleTitle, permissions }),
          });

          alert(res.message || 'Permissions updated successfully!');
          closeModal('admin-edit-subadmin-modal');
          fetchAdminSubAdmins();
        } catch (err) {
          alert(`Error: ${err.message}`);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      }

      async function toggleSubAdminStatus(subAdminId, currentlyBlocked) {
        const action = currentlyBlocked ? 'unblock' : 'block';
        if (!confirm(`Are you sure you want to ${action} this sub-administrator?`)) return;

        try {
          const res = await apiFetch(`/api/admin/subadmins/${subAdminId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ isBlocked: !currentlyBlocked }),
          });

          alert(res.message || `Sub-admin ${action}ed successfully`);
          fetchAdminSubAdmins();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

      async function deleteSubAdmin(subAdminId, name) {
        if (!confirm(`⚠️ Warning: Are you sure you want to permanently delete sub-administrator "${name}"? This action cannot be undone.`)) return;

        try {
          const res = await apiFetch(`/api/admin/subadmins/${subAdminId}`, {
            method: 'DELETE',
          });

          alert(res.message || 'Sub-admin deleted permanently');
          fetchAdminSubAdmins();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }

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

      function setAdminAnalyticsAllTime() {
        const startInput = document.getElementById('admin-analytics-start-date');
        const endInput = document.getElementById('admin-analytics-end-date');
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        fetchAdminAnalytics(true, true);
      }

      // Admin Analytics View
      async function fetchAdminAnalytics(isAllTime = false, force = false) {
        const container = document.getElementById('admin-analytics-content');
        if (!container) return;

        const startInput = document.getElementById('admin-analytics-start-date');
        const endInput = document.getElementById('admin-analytics-end-date');
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

        const cacheKey = `analytics_${isAllTime}_${startDate}_${endDate}`;
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
        let queryParams = '';
        if (isAllTime) {
          queryParams = '?allTime=true';
        } else if (startDate || endDate) {
          const params = new URLSearchParams();
          if (startDate) params.set('startDate', startDate);
          if (endDate) params.set('endDate', endDate);
          queryParams = `?${params.toString()}`;
        }

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

          if (isAllTime) {
            periodBadgeText = 'ALL TIME';
            periodBadgeClass = 'badge-accepted';
            periodSubNote = 'Cumulative platform GMV across all dates';
            if (subtitleEl) {
              subtitleEl.innerHTML = '<span class="badge badge-accepted" style="font-size:0.75rem;">Lifetime Data</span> Showing all analytics metrics across all time';
            }
          } else if (isTodayFilter) {
            periodBadgeText = 'TODAY';
            periodBadgeClass = 'badge-delivered';
            periodSubNote = `GMV sold today (${todayStr})`;
            if (subtitleEl) {
              subtitleEl.innerHTML = `<span class="badge badge-delivered" style="font-size:0.75rem;">Today: ${todayStr}</span> All fields below reflect activity for today`;
            }
          } else {
            const rangeText = `${startDate || 'Beginning'} to ${endDate || 'Present'}`;
            periodBadgeText = 'PERIOD';
            periodBadgeClass = 'badge-preparing';
            periodSubNote = `GMV for period: ${rangeText}`;
            if (subtitleEl) {
              subtitleEl.innerHTML = `<span class="badge badge-preparing" style="font-size:0.75rem;">Period: ${rangeText}</span> All fields below reflect activity for selected range`;
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
                ${Object.keys(an.paymentDistribution || {}).length ? Object.entries(an.paymentDistribution || {}).map(([method, info]) => {
                  const count = typeof info === 'object' ? (info.count || 0) : info;
                  const volume = typeof info === 'object' ? (info.volume || 0) : 0;
                  return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid #f1eee4;">
                      <div>
                        <span style="text-transform:uppercase; font-weight:700; font-size:0.88rem;">${escapeHtml(method)}</span>
                        <div style="font-size:0.75rem; color:var(--muted);">${count} order${count === 1 ? '' : 's'} in period</div>
                      </div>
                      <div style="text-align:right;">
                        <strong style="color:var(--green); font-size:0.92rem;">₹${formatRupees(volume)}</strong>
                        <div style="font-size:0.72rem; color:var(--muted);">${count} txn${count === 1 ? '' : 's'}</div>
                      </div>
                    </div>
                  `;
                }).join('') : '<p style="color:var(--muted); font-size:0.88rem; padding:1rem 0;">No payment transactions recorded for this period.</p>'}
              </div>

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

      // =========================================================================
      // SETTINGS & PROFILE
      // =========================================================================
      function loadProfileSettings() {
        populateSettingsUserIdBadge();
        document.getElementById('set-name').value = user.name || '';
        document.getElementById('set-role').value = role.toUpperCase();
        document.getElementById('set-email').value = user.email || '';
        document.getElementById('set-phone').value = user.phone || '';

        const restGroup = document.getElementById('restaurant-settings-group');
        const riderGroup = document.getElementById('rider-settings-group');

        if (role === 'restaurant' || role === 'shop') {
          restGroup.style.display = 'block';
          const addrLabel = document.getElementById('set-restaurant-address-label');
          if (addrLabel) addrLabel.textContent = role === 'shop' ? 'Shop Address' : 'Restaurant Address';
          const cuisineLabel = document.getElementById('set-cuisine-label');
          if (cuisineLabel) cuisineLabel.textContent = role === 'shop' ? 'Shop Category / Speciality' : 'Cuisines Served';
          document.getElementById('set-restaurant-address').value = user.shopAddress || user.restaurantAddress || '';
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
        if (role === 'restaurant') {
          formData.append('restaurantAddress', document.getElementById('set-restaurant-address').value.trim());
          formData.append('cuisine', document.getElementById('set-cuisine').value.trim());
        }
        if (role === 'shop') {
          formData.append('shopAddress', document.getElementById('set-restaurant-address').value.trim());
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
              Establishing satellite connection &amp; live GPS telemetry...
            </div>
          `;
        }

        openModal('order-live-tracking-modal');
        await refreshOrderLiveTracking();

        if (orderLiveTrackingPollInterval) clearInterval(orderLiveTrackingPollInterval);
        orderLiveTrackingPollInterval = setInterval(refreshOrderLiveTracking, 5000);
      }

      function closeOrderLiveTrackingModal() {
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

      function renderOrderLiveTracking(data) {
        const body = document.getElementById('olt-modal-body');
        if (!body) return;

        const titleEl = document.getElementById('olt-modal-title');
        if (titleEl) titleEl.textContent = `Order #${data.orderNumber} Live Telemetry`;

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
        const distRest = telem.riderToRestaurantDistanceKm !== undefined ? telem.riderToRestaurantDistanceKm.toFixed(2) : '0.85';
        const distCust = telem.riderToCustomerDistanceKm !== undefined ? telem.riderToCustomerDistanceKm.toFixed(2) : '1.45';
        const eta = telem.etaMinutes !== undefined ? telem.etaMinutes : Math.round(Number(distCust) * 4 + 4);

        const mapsUrl = rider.location?.lat && rest.location?.lat
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
              <div style="font-size:0.72rem; color:var(--muted);">${telem.lastPingSecondsAgo !== null ? `${telem.lastPingSecondsAgo}s ago` : 'Active'}</div>
            </div>
          </div>

          <!-- Radar Canvas -->
          <div style="background:#0f172a; border-radius:12px; padding:0.9rem; margin-bottom:1.2rem; position:relative; overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center; color:#94a3b8; font-size:0.76rem; margin-bottom:0.4rem; padding:0 0.2rem;">
              <span>📡 LIVE SATELLITE DISPATCH RADAR</span>
              <span style="color:#22c55e;">● GPS Signal Fixed</span>
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
                GPS: ${rest.location?.lat ? `${rest.location.lat.toFixed(4)}, ${rest.location.lng.toFixed(4)}` : 'Bengaluru'}
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
                GPS: ${rider.location?.lat ? `${rider.location.lat.toFixed(4)}, ${rider.location.lng.toFixed(4)}` : 'Indiranagar'}
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
              <button class="btn btn-primary btn-sm" onclick="simulateRiderMovement(); setTimeout(refreshOrderLiveTracking, 600);">🚴 Simulate Step Ahead (~100m)</button>
            ` : ''}
          </div>
        `;

        // Render Canvas
        setTimeout(() => {
          const canvas = document.getElementById('live-order-canvas');
          if (canvas) drawLiveOrderRadar(canvas, data);
        }, 30);
      }

      function drawLiveOrderRadar(canvas, data) {
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

        // 3 Nodes: Restaurant (Left), Rider (Center-Transit), Customer (Right)
        const restPt = { x: w * 0.16, y: h * 0.52 };
        const custPt = { x: w * 0.84, y: h * 0.48 };
        // Rider position interpolated between rest and cust
        const riderPt = { x: w * 0.50, y: h * 0.38 };

        // Route line from restaurant to customer via rider
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(restPt.x, restPt.y);
        ctx.lineTo(riderPt.x, riderPt.y);
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

      // =========================================================================
      // ADMIN FLEET LIVE TRACKER RADAR
      // =========================================================================
      let adminFleetPollInterval = null;

      async function openAdminFleetTrackerModal() {
        openModal('admin-fleet-tracker-modal');
        await refreshAdminFleet();

        if (adminFleetPollInterval) clearInterval(adminFleetPollInterval);
        adminFleetPollInterval = setInterval(refreshAdminFleet, 6000);
      }

      function closeAdminFleetTrackerModal() {
        if (adminFleetPollInterval) {
          clearInterval(adminFleetPollInterval);
          adminFleetPollInterval = null;
        }
        closeModal('admin-fleet-tracker-modal');
      }

      async function refreshAdminFleet() {
        try {
          const res = await apiFetch('/api/admin/riders/live-locations');
          renderAdminFleet(res);
        } catch (err) {
          const container = document.getElementById('admin-fleet-table-container');
          if (container) {
            container.innerHTML = `<p style="color:var(--tomato-dark); text-align:center;">Failed to fetch fleet: ${escapeHtml(err.message)}</p>`;
          }
        }
      }

      function renderAdminFleet(data) {
        const riders = data.riders || [];
        const summary = data.summary || {};

        // Summary Bar
        const bar = document.getElementById('admin-fleet-summary-bar');
        if (bar) {
          bar.innerHTML = `
            <div style="background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:0.75rem; text-align:center;">
              <span style="font-size:0.75rem; color:var(--muted); text-transform:uppercase; font-weight:600; display:block;">Total Fleet</span>
              <strong style="font-size:1.3rem;">${summary.totalRiders || riders.length}</strong>
            </div>
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:0.75rem; text-align:center;">
              <span style="font-size:0.75rem; color:#15803d; text-transform:uppercase; font-weight:600; display:block;">Live Online Now</span>
              <strong style="font-size:1.3rem; color:#16a34a;">${summary.onlineRiders || riders.filter((r) => r.isOnline).length}</strong>
            </div>
            <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:0.75rem; text-align:center;">
              <span style="font-size:0.75rem; color:#0369a1; text-transform:uppercase; font-weight:600; display:block;">Active Trips</span>
              <strong style="font-size:1.3rem; color:#0284c7;">${summary.activeDeliveriesCount || 0}</strong>
            </div>
          `;
        }

        const pingEl = document.getElementById('admin-fleet-last-ping');
        if (pingEl) pingEl.textContent = `● Live updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

        // Draw Canvas
        const canvas = document.getElementById('admin-fleet-canvas');
        if (canvas) drawAdminFleetCanvas(canvas, riders);

        // Table
        const tableContainer = document.getElementById('admin-fleet-table-container');
        if (tableContainer) {
          if (!riders.length) {
            tableContainer.innerHTML = '<p style="color:var(--muted); text-align:center; padding:1rem 0;">No delivery partners registered in fleet.</p>';
            return;
          }

          tableContainer.innerHTML = `
            <div class="table-wrapper" style="max-height:280px; overflow-y:auto;">
              <table>
                <thead>
                  <tr>
                    <th>Rider (Name / ID)</th>
                    <th>Transmitter Status</th>
                    <th>Live GPS Coordinates</th>
                    <th>Active Trips</th>
                    <th>Vehicle</th>
                  </tr>
                </thead>
                <tbody>
                  ${riders.map((r) => {
                    const isLive = Boolean(r.isOnline);
                    const coords = r.currentLocation?.lat ? `${r.currentLocation.lat.toFixed(4)}, ${r.currentLocation.lng.toFixed(4)}` : 'Indiranagar Hub';

                    return `
                      <tr>
                        <td>
                          <strong>${escapeHtml(r.name)}</strong> / <span style="font-family:monospace; color:#0369a1; font-weight:700;">${escapeHtml(r.riderId || 'RIDE')}</span>
                          ${r.phone ? `<br><small style="color:var(--muted);">📞 ${escapeHtml(r.phone)}</small>` : ''}
                        </td>
                        <td>
                          <span class="badge" style="background:${isLive ? '#dcfce7' : '#f1f5f9'}; color:${isLive ? '#15803d' : '#64748b'}; font-weight:600;">
                            ${isLive ? '🟢 GPS Active' : '⚪ Offline'}
                          </span>
                        </td>
                        <td><span style="font-family:monospace; font-size:0.82rem;">${coords}</span></td>
                        <td><span class="badge ${r.activeDeliveriesCount > 0 ? 'badge-transit' : 'badge-delivered'}">${r.activeDeliveriesCount || 0} Active</span></td>
                        <td><span class="badge badge-accepted">${escapeHtml(r.deliveryVehicle || 'Bike')}</span></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;
        }
      }

      function drawAdminFleetCanvas(canvas, riders) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Radar grid
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

        // Radar sweeps from Bengaluru center
        const cx = w * 0.5;
        const cy = h * 0.5;
        [40, 80, 120, 160].forEach((r) => {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        });

        // Center hub marker (MG Road / Vidhana Soudha)
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Central Bengaluru', cx, cy + 16);

        // Center ref coords: lat 12.9716, lng 77.5946
        const baseLat = 12.9716;
        const baseLng = 77.5946;
        const scale = 2500; // pixels per degree

        riders.forEach((r, idx) => {
          const rLat = r.currentLocation?.lat || (baseLat + (idx % 2 === 0 ? 0.008 : -0.008) * ((idx + 1) * 0.7));
          const rLng = r.currentLocation?.lng || (baseLng + (idx % 3 === 0 ? 0.012 : -0.012) * ((idx + 1) * 0.6));

          // Project to canvas
          let px = cx + (rLng - baseLng) * scale;
          let py = cy - (rLat - baseLat) * scale;

          // Clamp to canvas borders
          px = Math.max(30, Math.min(w - 30, px));
          py = Math.max(30, Math.min(h - 30, py));

          const isOnline = Boolean(r.isOnline);

          // Pulse
          if (isOnline) {
            ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
            ctx.beginPath();
            ctx.arc(px, py, 16, 0, Math.PI * 2);
            ctx.fill();
          }

          // Blip
          ctx.fillStyle = isOnline ? '#22c55e' : '#64748b';
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fill();

          // Label
          ctx.fillStyle = isOnline ? '#4ade80' : '#94a3b8';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          const rLabel = `${(r.name || 'Rider').split(' ')[0]} / ${r.riderId || 'RIDE'}`;
          ctx.fillText(rLabel, px, py - 10);
        });
      }

      // Run on page load
      document.addEventListener('DOMContentLoaded', () => {
        initDashboard();
      });
