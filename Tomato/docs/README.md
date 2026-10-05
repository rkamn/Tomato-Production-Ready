# Tomato Architecture & Service Documentation

This directory houses all service specifications, architecture designs, and database documentation for the Tomato platform.

---

## Service Specifications

1. [**Admin Service**](./services/admin.md)
   - User and role management (Approval, Rejection, Blocking, Modification).
   - Multi-role pagination for Restaurants, Riders, and Customers.
   - Platform-wide orders and financial analytics (GMV, fulfillment rate, payment distribution).
   - API Prefix: `/api/admin`

2. [**Customer Service**](./services/customer.md)
   - Profile management, saved delivery addresses.
   - Food browsing, carts, order placement, and billing invoices.
   - Active orders and real-time live delivery tracking.
   - API Prefix: `/api/customer`

3. [**Restaurant Service**](./services/restaurant.md)
   - Restaurant kitchen management, live open/closed availability toggle.
   - Menu catalog management (food items, pricing, categories).
   - Incoming order acceptance, preparation state updates.
   - API Prefix: `/api/restaurant`

4. [**Rider Service**](./services/rider.md)
   - Delivery partner fleet operations, online/offline availability toggle.
   - Order delivery assignments, pickup and drop updates.
   - Real-time GPS location updates and live routing calculation.
   - API Prefix: `/api/rider`

---

## Database Design & Data Models

- [**Database Schema Design**](./DATABASE_DESIGN.md): Details the multi-table database architecture separating platform users into dedicated collections:
  - `users`: Platform administrators and sub-administrators.
  - `customers`: Registered customer accounts.
  - `restaurants`: Restaurant partners and kitchen locations.
  - `riders`: Delivery partners and fleet state.
  - `orders`: Food orders with items, pricing, delivery address, and status.
  - `fooditems`: Menu dishes per restaurant.
  - `notifications`: Real-time system notifications.
  - `addresses`: Customer saved delivery addresses.
