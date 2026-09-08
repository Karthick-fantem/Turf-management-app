# TURFF PLATFORM — REGRESSION CHECKLIST

This checklist must be verified after every module and major change.

---

## MODULE 0 BASELINE

- [ ] Player OTP Login: `POST /auth/send-otp` returns mock OTP (`1234`)
- [ ] OTP Verify: `POST /auth/verify-otp` validates OTP and returns signed JWT
- [ ] JWT Authentication: Token accepted with `Authorization: Bearer <token>`
- [ ] GET /users/me returns authenticated user entity with Profile
- [ ] Flutter app persists `jwt_token` using `flutter_secure_storage`
- [ ] Token automatically attached by Dio interceptor on outgoing requests
- [ ] Player Home discover feed renders
- [ ] Turf Discovery: `GET /turfs` publicly accessible
- [ ] GET /turfs/:id returns specific turf with grounds list
- [ ] Booking History: `GET /bookings/my-bookings` returns user bookings
- [ ] Profile: `GET /users/me` loads profile, XP, and Level
- [ ] Profile Update: `PUT /profiles/me` updates avatar and sports preferences
- [ ] Public Game Discovery: `GET /games/public` returns public game lobbies
- [ ] Booking Concurrency: `POST /bookings` enforces SELECT FOR UPDATE row-level lock
- [ ] Concurrent same-slot requests: exactly one 201 Created, one 409 Conflict

---

## MODULE 1 — AUTHENTICATION & SECURITY HARDENING

### AUTHENTICATION

- [ ] OTP send works: `POST /auth/send-otp` ? 200
- [ ] OTP verify works: `POST /auth/verify-otp` ? JWT issued
- [ ] JWT issued contains: sub, phone, role, iat, exp
- [ ] JWT has expiration (1 hour by default)
- [ ] JWT_SECRET required at startup — no hardcoded fallback
- [ ] Invalid JWT rejected: `GET /users/me` with bad token ? 401
- [ ] Expired JWT rejected: `GET /users/me` with expired token ? 401

### AUTHORIZATION

- [ ] Public turf discovery works without JWT: `GET /turfs` ? 200
- [ ] Public games work without JWT: `GET /games/public` ? 200
- [ ] Auth endpoints public: `POST /auth/send-otp` and `POST /auth/verify-otp` ? 200
- [ ] Protected Player APIs require JWT: `GET /users/me` without JWT ? 401
- [ ] Role restrictions work: PLAYER on OWNER-only route ? 403
- [ ] PLAYER cannot access OWNER-only routes ? 403
- [ ] PLAYER cannot access ADMIN-only routes ? 403
- [ ] OWNER can access OWNER-only routes ? 200
- [ ] ADMIN can access ADMIN-only routes ? 200

### CHAT / WEBSOCKET

- [ ] Unauthenticated socket connection ? rejected (disconnected)
- [ ] Socket with invalid JWT ? rejected (disconnected)
- [ ] Socket with valid JWT ? accepted, socket.data.user populated
- [ ] senderId cannot be spoofed: client-supplied senderId ignored
- [ ] Authenticated identity from socket JWT used as senderId in persisted messages

### CORS

- [ ] Requests from http://localhost:5050 succeed
- [ ] Wildcard '*' not used with credentials: true

### PLAYER REGRESSION (from Module 0)

- [ ] OTP Login: PASS
- [ ] Home: PASS
- [ ] Turf Discovery: PASS
- [ ] Booking History: PASS
- [ ] Profile: PASS
- [ ] Public Games: PASS
- [ ] Existing Booking Concurrency (SELECT FOR UPDATE): PASS

---

## VERIFICATION COMMANDS

### 1. Database Schema Validation
```bash
cd apps/backend
npx prisma validate
```
Expected: Schema at prisma/schema.prisma is valid

### 2. Backend Compilation
```bash
cd apps/backend
npm run build
```
Expected: Nest build completes with 0 errors

### 3. E2E Tests
```bash
cd apps/backend
npm run test:e2e
```
Expected: 4 test suites pass (app, booking, player-flow, security)

### 4. Flutter Analysis
```bash
cd apps/mobile
flutter analyze
```

### 5. Flutter Tests
```bash
cd apps/mobile
flutter test
```
Note: Default widget_test.dart has known Module 0 failure (expects MyApp vs TurffApp).

---

## MODULE STATUS

| Module | Status     | E2E Tests | Notes                               |
|--------|------------|-----------|-------------------------------------|
| 0      | COMPLETE   | PASS      | Baseline established                |
| 1      | COMPLETE   | PASS      | Auth hardening, JWT expiry, WS auth |
| 2      | PENDING    | —         | TimeSlot schema + Owner publishing  |
