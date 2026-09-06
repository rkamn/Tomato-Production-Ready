# Tomato

A Node.js/Express authentication service with a standalone browser UI and MongoDB Atlas persistence.

## Features

- TypeScript Express API
- MongoDB Atlas connection through Mongoose
- Email/password registration and login
- Salted `scrypt` password hashes
- One-hour JWT access tokens
- Plain HTML frontend for creating an account and signing in

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

Start the API:

```bash
cd Tomato/services/auth
npm run build
npm start
```

The API listens at `http://127.0.0.1:5050`.

Serve the frontend in a second terminal:

```bash
cd Tomato/frontend
python3 -m http.server 3000 --bind 127.0.0.1
```

Open `http://127.0.0.1:3000`. Create an account, then log in with the same email and password.

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
    "role": "user"
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
    "role": "user"
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

## Quick API test

```bash
curl -i -X POST http://127.0.0.1:5050/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Aman","email":"aman@example.com","password":"securepass123"}'
```

## Notes

- The app uses the MongoDB `users` collection, Mongoose's default plural form for the `User` model.
- Password hashes and JWT secrets are never returned by the API.
- Replace the local `JWT_SECRET` with a new, securely generated deployment secret before production.
