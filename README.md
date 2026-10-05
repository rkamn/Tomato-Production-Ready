### Reach to project location and exacute below command

eg. cd /Users/rakeshkumar/Documents/Projects/workspace/Web/Tomato-Production-Ready
// login url : http://127.0.0.1:3000
//Dashboard: http://127.0.0.1:3000/dashboard/loginDashboard.html
//Home / Registration: http://127.0.0.1:3000
//API Health: http://127.0.0.1:5050/health

BUILD: npm run build,
START server : npm start,
START server : npm run dev
CLOSE server : Ctrl + C

### Demo Test

/\*
To run the Tomato application via your terminal, follow these steps:

Option 1: Standard Start (Recommended)

From the project root directory (Tomato-Production-Ready):

bash
npm start

This single command automatically:

Compiles the TypeScript codebase (tsc)
Connects to the MongoDB Atlas cluster
Launches the Backend API & Auth Service on http://localhost:5050
Serves the Frontend Web App on http://127.0.0.1:3000
Option 2: Development Mode (Auto-Reload on Changes)

To run with automatic TypeScript compilation and process auto-restart on file changes:

bash
npm run dev
Option 3: Running Directly from the Auth Service Directory

If you prefer running directly from inside Tomato/services/auth:

bash
cd Tomato/services/auth
npm run build
npm start
Accessing the Application

Once started, open your browser and navigate to:

Frontend App: http://127.0.0.1:3000
(or http://localhost:5050)
API Health Check: http://localhost:5050/health
Demo Accounts for Testing (Password for all: password123)
Role Email / Mobile Number Password
Super Admin aditya@lightbits.in or 9999900000 password123
Restaurant Partner rahul@lightbits.in or 9999999999 password123
Delivery Rider (Amit) amit@lightbits.in or 9608761612 password123
Delivery Rider (Deepak) deepak@lightbits.in or 8888888888 password123
Customer aman@gmail.com or 9523654737 password123
Sub-Admin (Priya) priya.subadmin@tomato.com or 9876500001 password123
Sub-Admin (Rohan) rohan.subadmin@tomato.com or 9876500002 password123

\*/

# Tomato

A Node.js/Express authentication service with a standalone browser UI and MongoDB Atlas persistence.

## Features

- TypeScript Express API
- MongoDB Atlas connection through Mongoose
- Email-or-mobile/password registration and login
- Salted `scrypt` password hashes
- One-hour JWT access tokens
- Plain HTML frontend for creating an account and signing in
- Online food ordering and delivery end-to-end lifecycle
- Integrated interactive Payment Gateway (Card, UPI, NetBanking, COD)
- Comprehensive multi-role architecture: Customer, Restaurant, Delivery Partner (Rider), and Admin

Tomato is an online-only service. It does not support dine-in reservations or physical table management. Customer orders are delivered to saved addresses.

## User Roles & Capabilities

### 1. Customer

- **Browse Restaurants & Menus**: View active food items across all restaurants, filter by restaurant or category, and search dishes.
- **Cart Management**: Add items to cart with live quantity controls (`+` / `-`), subtotal, 5% GST tax, ₹40 delivery fee, and grand total.
- **Payment Gateway Integration**: Secure checkout with simulated Payment Gateway supporting Credit/Debit Cards, UPI, NetBanking, and Cash on Delivery (COD).
- **Place Food Orders**: Dispatches order to the target restaurant with immutable item snapshot and delivery address.
- **Live Order Tracking**: Visual progress pipeline (`Placed` -> `Accepted` -> `Cooking` -> `Out for Delivery` -> `Delivered`).
- **Official Bill & Tax Invoice**: View and print computer-generated GST tax invoice for any order.
- **Address & Profile Management**: Save, edit, delete, and set default delivery addresses with contact phone and coordinates; update profile details and photo.

### 2. Restaurant

- **Kitchen Order Management**: Real-time incoming orders queue with customer details, item breakdown, and payment status.
- **Order Lifecycle Transitions**: Accept order (`placed` -> `accepted`), start cooking (`accepted` -> `preparing`), and package for pickup (`preparing` -> `ready_for_pickup`).
- **Official GST Tax Invoice Generation**: Generate itemized bill with Restaurant GSTIN, CGST (2.5%), SGST (2.5%), packing/delivery fees, and printable layout.
- **Menu Management**: Add new food dishes (name, category, description, price, stock, veg/non-veg dietary tags); edit dish pricing and stock; toggle in-stock availability; delete dishes.
- **Restaurant Profile**: Update restaurant address, served cuisines, contact phone, and profile photo.

### 3. Delivery Partner (Rider)

- **Check Restaurant Location**: Review restaurant pickup address, contact number, coordinates, and open one-click Google Maps GPS navigation.
- **Accept Pickup Orders**: Claim available orders once accepted by the restaurant (`accepted`, `preparing`, or `ready_for_pickup`).
- **Check Customer Delivery Location**: View recipient name, contact phone with click-to-call (`tel:`), address, and GPS navigation link.
- **Mark as Delivered**: Change order status to `delivered` upon doorstep handover; automatically marks COD orders as paid and credits ₹40 trip fee to rider earnings.
- **Earnings & Shift History**: Track total completed trips and lifetime trip earnings.

### 4. Admin

- **Operations Dashboard & Analytics**: High-level KPIs (Total Platform Revenue/GMV, Total Orders, Active Kitchen Orders, Registered Customers, Active Restaurants, Delivery Fleet); graphical breakdown of orders by status, revenue by restaurant, top-selling dishes, and payment methods.
- **Global Order Monitoring**: Real-time table of all platform orders with status filtering, date range period filtering, single/bulk archive & delete, and live GPS telemetry inspection.
- **Partner Approval Workflow**: Approve or reject newly registered restaurants and riders with one click.
- **Moderation & User Blocking**: Instant block or unblock toggle for any Customer, Restaurant, or Rider; blocked accounts are immediately restricted from logging in and accessing APIs.
- **Direct Partner Onboarding**: Admin form to add and pre-approve new restaurants (with DIGIPIN and GPS detection), riders, or customers.
- **Live Fleet Radar & GPS Command Center**: Live satellite radar visualizer plotting all active delivery partners across Bengaluru with real-time telemetry, transmitter pings, and active deliveries.
- **Sub-Admin & Role-Based Access Control (RBAC)**: Super-Admin can create sub-administrators, assign custom permission sets or presets (`Operations Lead`, `Restaurant Lead`, `Support Specialist`, `Full Admin`), and strictly gate API endpoints.

### 5. Restaurant Location / DIGIPIN & Unique IDs

- **Mandatory Location / DIGIPIN on Registration**: Restaurants cannot register without sharing their pickup GPS coordinates or Digital Postal Index Number (DIGIPIN). Requests without either are rejected (400 Bad Request).
- **Auto-Generated Unique IDs**:
  - Each restaurant receives an immutable `restaurantId` (e.g. `REST-1001`).
  - Each delivery partner receives an immutable `riderId` (e.g. `RIDE-1002`).
- **Partner Display Format**: Consistently displayed across all customer, restaurant, rider, and admin views as `<name>/restaurantId` (e.g. `Tomato Kitchen & Grill / REST-1001`) and `<name>/riderId` (e.g. `Amit Kumar / RIDE-1002`).

### 6. Continuous Rider Live Location & Telemetry

- **Always-On GPS Broadcasting**: Riders continuously stream live coordinates via `navigator.geolocation.watchPosition` and background heartbeats every 10 seconds to `PUT /api/rider/location`.
- **Live Tracking for Customer & Restaurant**: Customers and restaurants can click `📍 Live Tracking` on any order to open an interactive modal with HTML5 Canvas Satellite Radar, live distances (Rider ➔ Restaurant, Rider ➔ Customer in km), dynamic ETA in minutes, and real-time transmitter status.
- **Proximity Dispatch (2km Circle)**: Orders accepted by restaurants trigger continuous mobile ringing notifications for all riders stationed within a 2km radius. If rejected, the order is automatically re-routed to other nearby riders.

## Project layout

```text
Tomato/
├── frontend/
│   └── index.html
└── services/
    └── auth/
        ├── src/
        │   ├── config/db.ts
        │   ├── controllers/auth.ts
        │   ├── model/User.ts
        │   ├── routes/auth.ts
        │   └── index.ts
        └── .env.example
```

API: http://127.0.0.1:5050
MongoDB: connected
Health check: {"status":"ok"}
Frontend: http://127.0.0.1:3000

## Requirements

- Node.js 20 or newer
- A MongoDB Atlas cluster, database user, and allowed network IP address

## Setup

Install dependencies:

```bash
cd Tomato/services/auth
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Configure `.env`:

```env
PORT=5050
MONGO_URI=mongodb+srv://study458458_db_user:<url-encoded-database-password>@cluster0.emamqrx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGO_DB_NAME=Tomato_clone
JWT_SECRET=<long-random-secret>
CORS_ORIGIN=http://127.0.0.1:3000
```

The configured Atlas host is `cluster0.emamqrx.mongodb.net`, the database user is `study458458_db_user`, and the application database is `Tomato_clone`. Replace `<url-encoded-database-password>` and `<long-random-secret>` only in your local `.env` file.

Do not commit `.env`, database passwords, or JWT secrets. In MongoDB Atlas, create a database user and add your development machine's public IP address under **Network Access**.

## Run

### Atlas connection troubleshooting

If startup reports `Could not connect to any servers in your MongoDB Atlas cluster`, open **Atlas > Security > Network Access > IP Access List** and add the machine's current public IPv4 address as a `/32` entry. You can check it with:

```bash
curl -4 https://api.ipify.org
```

For this development machine, the address observed during the last validation was `103.197.75.229`, so the entry should be `103.197.75.229/32`. Public IP addresses can change; rerun the command before adding or updating the Atlas entry. The service now retries the connection and refuses to start until MongoDB is reachable.

Build and start the API and frontend together from the repository root:

```bash
npm start
```

This builds and starts one Node.js server for both the API (`http://127.0.0.1:5050`) and frontend (`http://127.0.0.1:3000`). If port 3000 is already in use, the frontend is also available at `http://127.0.0.1:5050`. Press `Ctrl+C` to stop the server. Create an account, then log in with the same email or mobile number and password.

## API

Base URL: `http://127.0.0.1:5050`  
All request and response bodies use JSON.

### Health check

```http
GET /health
```

Response:

```json
{ "status": "ok" }
```

### Register

```http
POST /api/auth/register
Content-Type: application/json
```

```json
{
  "name": "Aman",
  "email": "aman@example.com",
  "password": "at-least-8-characters"
}
```

`name`, `email`, and `password` are required. Passwords must have at least eight characters. Email addresses are trimmed and converted to lowercase.

Successful response: `201 Created`

```json
{
  "token": "<jwt-access-token>",
  "user": {
    "id": "<mongo-object-id>",
    "name": "Aman",
    "email": "aman@example.com",
    "image": "",
    "role": "customer"
  }
}
```

Possible errors:

| Status | Response                                                                       |
| ------ | ------------------------------------------------------------------------------ |
| `400`  | Required fields are missing, or the password is shorter than eight characters. |
| `409`  | An account with the supplied email already exists.                             |

### Login

```http
POST /api/auth/login
Content-Type: application/json
```

```json
{
  "email": "aman@example.com",
  "password": "at-least-8-characters"
}
```

Successful response: `200 OK`

```json
{
  "token": "<jwt-access-token>",
  "user": {
    "id": "<mongo-object-id>",
    "name": "Aman",
    "email": "aman@example.com",
    "image": "",
    "role": "customer"
  }
}
```

Possible errors:

| Status | Response                                               |
| ------ | ------------------------------------------------------ |
| `400`  | Email or password is missing.                          |
| `401`  | The email does not exist or the password is incorrect. |

### Unmatched routes

Any route that is not defined returns:

```json
{ "message": "Route not found." }
```

with status `404 Not Found`.

## Real-Time Notification Service & Event-Driven Order Lifecycle

The platform features an event-driven Server-Sent Events (SSE) notification system delivering instant in-app toast notifications, Web Audio chimes, and automatic UI updates across roles.

### SSE Stream Endpoint

```http
GET /api/notifications/stream?token=<JWT_TOKEN>
```

Header: `Accept: text/event-stream`

### Notification Events & Workflow

1. **Order Placed**:
   - **Customer** places an order with items and delivery address.
   - **Restaurant** receives instant real-time notification: `🚨 New Order #TOM-... Received!` with total items, customer name, and bill amount.
   - **Admin** receives an `order_placed` broadcast.

2. **Order Accepted & 2km Proximity Ringing**:
   - **Restaurant** marks order as `accepted` and starts cooking.
   - **Customer** receives notification that kitchen accepted and started cooking.
   - **Geo-Proximity Routing (2km Circle)**: The system computes the straight-line Haversine distance between the restaurant and all active, approved riders.
   - **Mobile Phone Ringing**: Riders stationed within the **2km radius** get a continuous telephone ringtone loop (synthesized Web Audio 440Hz+480Hz) and mobile vibration (`navigator.vibrate`), opening the **Incoming Delivery Call Sheet**.
   - **Accept or Reject**:
     - **Accept** (`POST /api/rider/orders/:orderId/accept`): Rider claims the order, stops ringing, and broadcasts a cancellation to all other riders' phones to silence them.
     - **Reject** (`POST /api/rider/orders/:orderId/reject`): Stops ringing on the rejecting rider's device, logs rejection, and **automatically forwards and rings the phone of all other available riders within the 2km circle**!

3. **Rider Claim & Pickup**:
   - **Rider** accepts the order (`POST /api/rider/orders/:orderId/accept`).
   - Order transitions to `out_for_delivery`.
   - **Customer** receives notification with rider name and contact details.
   - **Restaurant** receives pickup confirmation notification.

4. **Delivery Completed**:
   - **Rider** delivers the meal (`POST /api/rider/orders/:orderId/deliver`).
   - **Customer** receives meal arrival notification.
   - **Rider's earnings** automatically credit ₹40 trip fee per delivery.

### Rider Proximity & Location APIs

| Method | Endpoint                            | Description                                                          |
| ------ | ----------------------------------- | -------------------------------------------------------------------- |
| `PUT`  | `/api/rider/location`               | Update rider live GPS location (`lat`, `lng`, `isOnline`)            |
| `POST` | `/api/rider/orders/:orderId/accept` | Accept delivery order and silence other ringing devices              |
| `POST` | `/api/rider/orders/:orderId/reject` | Reject delivery order and re-route to remaining riders in 2km circle |

### Notification Management APIs

| Method | Endpoint                      | Description                                   |
| ------ | ----------------------------- | --------------------------------------------- |
| `GET`  | `/api/notifications`          | Fetch user notification list and unread count |
| `PUT`  | `/api/notifications/:id/read` | Mark individual notification as read          |
| `PUT`  | `/api/notifications/read-all` | Mark all user notifications as read           |

## Notes

- The app uses the MongoDB `users`, `fooditems`, `orders`, and `notifications` collections.
- Password hashes and JWT secrets are never returned by the API.
- Replace the local `JWT_SECRET` with a new, securely generated deployment secret before production.
