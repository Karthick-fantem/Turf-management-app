# Turff Platform — Security Documentation

> Module 1 — Authentication & Security Hardening
> Date: 2026-09-08

---

## 1. Authentication

### Player Authentication

Players authenticate using a **Phone Number + OTP** flow. No password is required.

```
POST /auth/send-otp   { phone }          ? sends OTP (mock: always "1234" in dev)
POST /auth/verify-otp { phone, otp }     ? validates OTP, returns signed JWT
```

These endpoints are **public** — no JWT is required to reach them.

### JWT

Upon successful OTP verification, the server issues a signed JWT containing:

| Claim  | Description                        |
|--------|------------------------------------|
| sub    | User's database UUID               |
| phone  | User's phone number                |
| role   | User's role (PLAYER, TURF_OWNER, ADMIN) |
| iat    | Issued-at timestamp                |
| exp    | Expiration timestamp               |

### JWT Expiration Policy

- **Access token lifetime**: `1 hour` (configurable via `JWT_EXPIRES_IN`)
- No refresh tokens in Module 1.
- When a token expires the client receives `401 Unauthorized`.

### JWT Secret

- Configured via the `JWT_SECRET` environment variable.
- The application **will not start** if `JWT_SECRET` is missing.
- There is **no hardcoded fallback secret**. The former `super-secret` fallback has been removed.

---

## 2. Authorization

### Role System

The platform uses a single `Role` enum defined in the Prisma schema:

```
PLAYER      — Default player role
TURF_OWNER  — Turf owner (future modules)
ADMIN       — Platform administrator (future modules)
```

### How Authorization Works

```
Request
  ?
JwtAuthGuard (global)
  ?
Is route @Public()?
  +-- YES ? continue (no JWT required)
  +-- NO  ? validate JWT
               ?
            RolesGuard (global)
               ?
            Is @Roles() decorator present?
               +-- NO  ? any authenticated user is allowed
               +-- YES ? user.role must match one of the allowed roles
                            +-- match    ? 200
                            +-- no match ? 403 Forbidden
```

### Decorators

| Decorator         | Usage                                     |
|-------------------|-------------------------------------------|
| @Public()         | Skips JWT authentication entirely         |
| @Roles(Role.X)    | Requires role X (one or more roles)       |

### HTTP Errors

| Situation                              | Response             |
|----------------------------------------|----------------------|
| Missing or malformed JWT               | 401 Unauthorized     |
| Expired JWT                            | 401 Unauthorized     |
| Invalid/tampered JWT                   | 401 Unauthorized     |
| Valid JWT but insufficient role        | 403 Forbidden        |

---

## 3. Public Endpoints

The following routes are decorated with `@Public()` and are accessible without a JWT:

```
GET  /                       Health check
POST /auth/send-otp           Send OTP to phone
POST /auth/verify-otp         Verify OTP, issue JWT

GET  /turfs                   List all turfs
GET  /turfs/:id               Get a single turf
GET  /turfs/:id/slots         Get available slots for a turf

GET  /games/public            List public game lobbies
```

---

## 4. Protected Endpoints (Player)

The following routes require a valid JWT (any role — typically PLAYER):

```
GET  /users/me
PUT  /profiles/me
POST /bookings
GET  /bookings/my-bookings
POST /games
POST /games/:id/join
GET  /friends
POST /friends/request/:userId
POST /friends/accept/:requestId
POST /clans
POST /clans/:id/join
GET  /clans/:id
```

---

## 5. WebSocket Chat Security

### Authentication

The client must supply the JWT in the Socket.IO handshake auth object:

```js
io('http://backend', { auth: { token: '<jwt>' } })
```

If token is missing, invalid, or expired the socket is immediately disconnected.

### Sender Identity

The authenticated user identity is attached to the socket:

```
socket.data.user = <verified database User>
```

senderId in every message comes exclusively from socket.data.user.id.
Any senderId value in the message payload is ignored — spoofing is prevented.

### Room Authorization

Room membership enforcement is a remaining gap — see Module 11.

---

## 6. CORS Configuration

Allowed origins (development):

```
http://localhost:5050
http://127.0.0.1:5050
http://localhost:3000
http://127.0.0.1:3000
http://localhost:8080
```

Additional origins: set ALLOWED_ORIGINS env var (comma-separated).
credentials: true is used. The wildcard '*' is NOT combined with credentials.

---

## 7. Environment Configuration

| Variable          | Required | Description                        | Example                            |
|-------------------|----------|------------------------------------|------------------------------------|
| JWT_SECRET        | YES      | Secret key for signing JWTs        | replace-with-a-long-random-secret  |
| JWT_EXPIRES_IN    | No       | Access token lifetime (default 1h) | 1h                                 |
| ALLOWED_ORIGINS   | No       | Comma-separated CORS origins       | http://localhost:5050              |

See .env.example for template. Never commit real secrets.

---

## 8. Known Remaining Security Gaps

| Gap                              | Target Module  |
|----------------------------------|----------------|
| Chat room membership enforcement  | Module 11      |
| Owner/Admin email+password login  | Module 3       |
| JWT refresh tokens               | Module 3+      |
| Rate limiting on OTP endpoints   | Future         |
| Audit logging                    | Future         |
