/**
 * Tomato Live Rider Location WebSocket Client (websocket.js)
 * Real-time bidirectional WebSocket transport for tracking delivery partners
 * picking up orders from restaurants/shops and delivering to customer addresses.
 */
(function () {
  class TomatoLiveWebSocket {
    constructor() {
      this.socket = null;
      this.isConnected = false;
      this.reconnectTimer = null;
      this.heartbeatTimer = null;
      this.reconnectAttempts = 0;
      this.subscribedOrderIds = new Set();
      this.isSubscribedToFleet = false;
      this.listeners = new Map();
      this.lastRiderPing = null;
    }

    /**
     * Resolve the WebSocket endpoint URL based on API_ROOT and JWT token
     */
    getWebSocketUrl() {
      const authToken =
        (typeof window !== 'undefined' && window.token) ||
        localStorage.getItem('tomatoToken') ||
        '';
      const baseRoot =
        (typeof window !== 'undefined' && window.API_ROOT) ||
        (typeof window !== 'undefined' && window.location.hostname
          ? `${window.location.protocol}//${window.location.hostname}:5050`
          : 'http://localhost:5050');
      const wsBase = baseRoot
        .replace(/^https:\/\//i, 'wss://')
        .replace(/^http:\/\//i, 'ws://')
        .replace(/\/+$/, '');
      const query = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
      return `${wsBase}/ws${query}`;
    }

    /**
     * Establish WebSocket connection and bind lifecycle handlers
     */
    connect() {
      if (
        this.socket &&
        (this.socket.readyState === WebSocket.OPEN ||
          this.socket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const authToken =
        typeof token !== 'undefined' && token
          ? token
          : localStorage.getItem('tomatoToken') || '';
      if (
        authToken &&
        typeof window !== 'undefined' &&
        window.TomatoSecurity &&
        typeof window.TomatoSecurity.isTokenExpired === 'function' &&
        window.TomatoSecurity.isTokenExpired(authToken)
      ) {
        return;
      }

      const wsUrl = this.getWebSocketUrl();
      try {
        this.socket = new WebSocket(wsUrl);
      } catch (err) {
        console.warn('[TomatoWS] WebSocket initialization error:', err);
        this.scheduleReconnect();
        return;
      }

      this.socket.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateConnectionBadge(true);

        // Authenticate explicitly if token is available
        const authToken =
          typeof token !== 'undefined' && token
            ? token
            : localStorage.getItem('tomatoToken') || '';
        if (authToken) {
          this.send({ type: 'auth', token: authToken });
        }

        // Re-subscribe to any active order tracking channels
        this.subscribedOrderIds.forEach((orderId) => {
          this.send({ type: 'subscribe_order', orderId });
        });

        // Re-subscribe to admin fleet radar if active
        if (this.isSubscribedToFleet) {
          this.send({ type: 'subscribe_fleet' });
        }

        // If rider had a recent GPS fix, push it immediately
        if (
          this.lastRiderPing &&
          typeof role !== 'undefined' &&
          (role === 'deliveryPartner' || role === 'rider')
        ) {
          this.send({
            type: 'rider_location_ping',
            lat: this.lastRiderPing.lat,
            lng: this.lastRiderPing.lng,
            isOnline: this.lastRiderPing.isOnline,
          });
        }

        this.startHeartbeat();
        this.emit('connected', { timestamp: new Date().toISOString() });
      };

      this.socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleMessage(payload);
        } catch (err) {
          console.debug('[TomatoWS] Non-JSON WebSocket frame ignored:', err);
        }
      };

      this.socket.onerror = (err) => {
        console.debug('[TomatoWS] WebSocket transport warning:', err);
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.updateConnectionBadge(false);
        this.scheduleReconnect();
      };
    }

    /**
     * Route incoming WebSocket messages to UI handlers and registered listeners
     */
    handleMessage(msg) {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'order_live_tracking': {
          const tracking = msg.tracking || msg;
          const incomingOrderId = String(tracking.orderId || msg.orderId || '');
          const st = String(tracking.status || '').toLowerCase();
          const isClosed = Boolean(tracking.trackingClosed) || st === 'delivered' || st === 'cancelled';

          if (isClosed && incomingOrderId) {
            this.unsubscribeOrderLiveTracking(incomingOrderId);
          }

          if (
            typeof activeTrackingOrderId !== 'undefined' &&
            activeTrackingOrderId &&
            String(activeTrackingOrderId) === incomingOrderId
          ) {
            if (isClosed && typeof closeOrderLiveTrackingModal === 'function') {
              closeOrderLiveTrackingModal();
            } else if (typeof renderOrderLiveTracking === 'function') {
              renderOrderLiveTracking(tracking);
            }
          }
          this.emit('order_live_tracking', tracking);
          break;
        }

        case 'rider_location_update': {
          // If an order tracking modal is open, trigger live tracking refresh or update
          if (
            typeof activeTrackingOrderId !== 'undefined' &&
            activeTrackingOrderId &&
            typeof refreshOrderLiveTracking === 'function'
          ) {
            refreshOrderLiveTracking();
          }
          // If admin fleet radar modal is open, refresh fleet
          const fleetModal = document.getElementById(
            'admin-fleet-tracker-modal',
          );
          if (
            fleetModal &&
            fleetModal.classList.contains('active') &&
            typeof refreshAdminFleet === 'function'
          ) {
            refreshAdminFleet();
          }
          this.emit('rider_location_update', msg);
          break;
        }

        default:
          this.emit(msg.type, msg);
          break;
      }
    }

    /**
     * Send a JSON payload over the active WebSocket connection
     */
    send(payload) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify(payload));
          return true;
        } catch (err) {
          console.debug('[TomatoWS] Send error:', err);
        }
      }
      return false;
    }

    /**
     * Stream live Rider GPS coordinates over WebSocket as the rider picks up
     * orders from the restaurant and delivers to the customer address.
     * Live location of the rider is tracked based on his phone number or mobile number.
     */
    sendRiderLocationPing(lat, lng, isOnline = true, phone = null) {
      const numericLat = Number(lat);
      const numericLng = Number(lng);
      if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
        return false;
      }

      const riderPhone =
        phone ||
        (typeof storedUser !== 'undefined' ? storedUser?.phone : null) ||
        (typeof user !== 'undefined' ? user?.phone : null) ||
        '';

      this.lastRiderPing = {
        lat: numericLat,
        lng: numericLng,
        phone: riderPhone,
        isOnline: Boolean(isOnline),
        at: Date.now(),
      };

      if (!this.isConnected) {
        this.connect();
      }

      return this.send({
        type: 'rider_location_ping',
        lat: numericLat,
        lng: numericLng,
        phone: riderPhone,
        mobile: riderPhone,
        isOnline: Boolean(isOnline),
      });
    }

    /**
     * Customer shares current delivery location (GPS location) with assigned rider in real-time
     */
    sendCustomerLocationShare(orderId, lat, lng) {
      const numericLat = Number(lat);
      const numericLng = Number(lng);
      if (!orderId || !Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
        return false;
      }
      if (!this.isConnected) {
        this.connect();
      }
      return this.send({
        type: 'customer_share_location',
        orderId: String(orderId),
        lat: numericLat,
        lng: numericLng,
      });
    }

    /**
     * Subscribe to real-time WebSocket updates for a specific order's rider & route
     */
    subscribeOrderLiveTracking(orderId) {
      if (!orderId) return;
      const id = String(orderId);
      this.subscribedOrderIds.add(id);
      if (!this.isConnected) {
        this.connect();
      } else {
        this.send({ type: 'subscribe_order', orderId: id });
      }
    }

    /**
     * Unsubscribe from a specific order's live tracking stream
     */
    unsubscribeOrderLiveTracking(orderId) {
      if (!orderId) {
        this.subscribedOrderIds.forEach((id) => {
          this.send({ type: 'unsubscribe_order', orderId: id });
        });
        this.subscribedOrderIds.clear();
        return;
      }
      const id = String(orderId);
      this.subscribedOrderIds.delete(id);
      this.send({ type: 'unsubscribe_order', orderId: id });
    }

    /**
     * Subscribe to real-time fleet-wide rider GPS updates (Admin / Sub-Admin)
     */
    subscribeFleetLiveTracking() {
      this.isSubscribedToFleet = true;
      if (!this.isConnected) {
        this.connect();
      } else {
        this.send({ type: 'subscribe_fleet' });
      }
    }

    /**
     * Unsubscribe from fleet-wide rider GPS updates
     */
    unsubscribeFleetLiveTracking() {
      this.isSubscribedToFleet = false;
      this.send({ type: 'unsubscribe_fleet' });
    }

    /**
     * Register custom event listener
     */
    on(eventType, callback) {
      if (!this.listeners.has(eventType)) {
        this.listeners.set(eventType, new Set());
      }
      this.listeners.get(eventType).add(callback);
      return () => this.off(eventType, callback);
    }

    off(eventType, callback) {
      const set = this.listeners.get(eventType);
      if (set) set.delete(callback);
    }

    emit(eventType, data) {
      const set = this.listeners.get(eventType);
      if (!set) return;
      set.forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error('[TomatoWS] Listener error:', err);
        }
      });
    }

    updateConnectionBadge(connected) {
      const badge = document.getElementById('ws-live-connection-indicator');
      if (badge) {
        badge.innerHTML = connected
          ? '🟢 WebSocket Live Stream Connected'
          : '🟡 Polling Fallback (Reconnecting WS...)';
        badge.style.color = connected ? '#22c55e' : '#eab308';
      }
    }

    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        this.send({ type: 'ping' });
      }, 20000);
    }

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return;
      const delay = Math.min(15000, 1500 * Math.pow(1.4, this.reconnectAttempts));
      this.reconnectAttempts += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }
  }

  const tomatoWS = new TomatoLiveWebSocket();
  window.TomatoWS = tomatoWS;

  // Auto-connect once the DOM is ready if a session token exists
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (localStorage.getItem('tomatoToken')) {
        tomatoWS.connect();
      }
    });
  } else if (localStorage.getItem('tomatoToken')) {
    tomatoWS.connect();
  }
})();

