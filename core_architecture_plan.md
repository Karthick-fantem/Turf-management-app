# Turff Platform — Unified Core Architecture Plan

> This plan synthesises the Player App report, Admin Console report, and Owner Module report into one execution strategy. Everything connects through a single NestJS backend with one Prisma schema, one Redis instance, and one WebSocket gateway.

---

## 1. The Problem in Numbers

| | Player App | Admin Console | Owner App |
|---|---|---|---|
| **Screens / Pages** | 31 | 9 | 0 (not built yet) |
| **Functions** | 332 | 40 | 0 |
| **API endpoints used** | 7 | 15 | 0 |
| **Hardcoded data points** | 404 | ~60 | — |
| **Backend modules wired** | 1.5 / 13 | 8 / 13 | 0 / 13 |
| **Missing features (critical)** | 12 | 7 | 13 modules to build |

**The core gap:** The backend is already built. The frontend ignores it.

---

## 2. Canonical Data Model (Single Source of Truth)

Everything flows from this schema. All three apps read/write the same data.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CANONICAL ENTITIES                           │
│                                                                 │
│  User ────────────────┐                                         │
│    ├─ Profile         │                                         │
│    ├─ Wallet          │  ONE USER CAN HAVE MULTIPLE ROLES:      │
│    ├─ Badges          │  - PLAYER  → uses Player App            │
│    ├─ Reputation      │  - OWNER   → uses Owner App             │
│    └─ Notifications   │  - ADMIN   → uses Admin Console         │
│                       │                                         │
│  OwnerProfile ────────┤  (linked to User with role=OWNER)       │
│    ├─ Grounds[]       │                                         │
│    └─ verificationStatus                                        │
│                       │                                         │
│  Ground ──────────────┤                                         │
│    └─ Slots[]         │                                         │
│                       │                                         │
│  Slot ────────────────┤  AtomicSlotUnit — the booking primitive │
│    └─ Booking?        │                                         │
│                       │                                         │
│  Booking ─────────────┤  links User + Slot + Wallet transaction │
│    └─ WalletTx        │                                         │
│                       │                                         │
│  Game (Match Room) ───┤  links User[] + Booking                 │
│    ├─ Members[]       │                                         │
│    └─ ChatMessages[]  │                                         │
│                       │                                         │
│  Clan ────────────────┤                                         │
│    ├─ Members[]       │                                         │
│    └─ Posts[]         │                                         │
│                       │                                         │
│  Tournament ──────────┤                                         │
│    ├─ Teams[]         │                                         │
│    ├─ Matches[]       │                                         │
│    └─ linked to Slot  │  (tournament reserves slots)            │
│                       │                                         │
│  Promotion ───────────┤  per-turf discount rules                │
│  Review ──────────────┤  player → turf review                   │
│  Payout ──────────────┤  owner → platform payout                │
│  AuditLog ────────────┤  admin → every admin action logged      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Backend Architecture (NestJS — Current + Additions)

```
apps/backend/src/
├── auth/           ✅ OTP login, JWT, RolesGuard
├── users/          ✅ GET /users/me
├── profiles/       ✅ PUT /profiles/me
├── turfs/          ✅ GET /turfs, GET /turfs/:id/slots  ← extend with grounds/amenities
├── grounds/        🆕 Ground CRUD per owner
├── slots/          🆕 Slot generation, merge, split, block, hold
├── bookings/       ✅ CRUD  ← extend with ground link
├── wallet/         ✅ balance, ledger, topup, settle-split
├── games/          ✅ CRUD match rooms
├── chat/           ✅ WebSocket gateway (joinRoom, sendMessage)
├── friends/        ✅ CRUD
├── clans/          ✅ CRUD
├── reputation/     ✅ rate, get
├── gamification/   ✅ badges, award-xp
├── search/         ✅ GET /search
├── checkins/       ✅ QR generate, verify
├── notifications/  🆕 push + in-app notifications
├── tournaments/    🆕 Full tournament system
├── owner/          ✅ basic  ← major expansion
├── promotions/     🆕 Per-turf discount rules
├── reviews/        🆕 Player → turf reviews
├── payouts/        🆕 Owner payout requests
├── admin/          ✅ basic  ← add owners, tournaments, payouts, reviews
└── redis/          ✅ Slot hold locks, session cache
```

---

## 4. Shared API Contract (All Three Apps)

### Auth — Shared token system
```
POST /auth/send-otp          → Player App (phone OTP)
POST /auth/verify-otp        → Player App → returns JWT
POST /admin/auth/login       → Admin Console (email + password) → JWT
POST /owner/auth/login       → Owner App (email + password) → JWT
POST /owner/auth/reset       → Force password reset (first login)
```
**JWT payload** — same structure for all:
```json
{ "sub": "userId", "role": "PLAYER|OWNER|ADMIN", "email": "...", "iat": ..., "exp": ... }
```

### Users & Profiles — Shared
```
GET  /users/me               → All three apps
PUT  /profiles/me            → Player + Owner
GET  /users/:id              → Public profile (Player App)
DELETE /users/me             → Player App (account delete)
```

### Turfs — Shared read, Owner write, Admin verify
```
GET  /turfs                  → Player App (discover)
GET  /turfs/:id              → Player App + Admin (full detail)
GET  /turfs/:id/slots        → Player App (slot grid)
GET  /turfs/:id/reviews      → Player App
POST /turfs/:id/reviews      → Player App (submit review)
GET  /turfs/:id/tournaments  → Player App
POST /turfs/:id/follow       → Player App

PUT  /owner/profile/step/:n  → Owner App (multi-step form)
POST /owner/turf/submit      → Owner App (trigger verification)
GET  /owner/turf/status      → Owner App (pending/approved)

GET  /admin/turf-verifications      → Admin Console
POST /admin/turf-verifications/:id/approve
POST /admin/turf-verifications/:id/reject
GET  /admin/turfs/:id/full          → Admin (all 6 steps)
PATCH /admin/turfs/:id/feature
```

### Slots — Owner write, Player read
```
GET  /owner/grounds/:id/slots?date=    → Owner slot manager
POST /owner/grounds/:id/slots/generate → Owner generates day slots
POST /owner/grounds/:id/slots/merge    → Owner merges adjacent
POST /owner/grounds/:id/slots/split/:id → Owner splits merged
PATCH /owner/slots/:id                 → Owner price/block override

GET  /turfs/:id/slots?date=&groundId=  → Player App slot picker
POST /bookings/slots/:slotId/hold      → Player App 10-min hold
```

### Bookings — Player writes, Owner + Admin reads
```
POST /bookings                         → Player App (confirm booking)
GET  /bookings/my-bookings             → Player App
GET  /bookings/:id                     → Player App (details + QR)
DELETE /bookings/:id/cancel            → Player App (cancel)

GET  /owner/bookings                   → Owner App
POST /owner/bookings/:id/checkin       → Owner App (QR scan)
POST /owner/bookings/:id/cancel        → Owner App

GET  /admin/bookings                   → Admin Console
POST /admin/bookings/:id/force-cancel  → Admin Console
```

### Wallet — Shared
```
GET  /wallet                → All three apps
GET  /wallet/ledger         → Player App + Owner App
POST /wallet/topup          → Player App
POST /wallet/settle-split   → Player App
```

### Games (Match Rooms) — Player-only
```
GET  /games/public          → Player App
POST /games                 → Player App
GET  /games/:id             → Player App
POST /games/:id/join        → Player App
POST /games/:id/complete    → Player App
GET  /games/history/me      → Player App
```

### Tournaments — Owner writes, Player reads, Admin monitors
```
POST /owner/tournaments                          → Owner App
POST /owner/tournaments/:id/close-registration   → Owner App
POST /owner/tournaments/:id/publish-bracket      → Owner App
PATCH /owner/tournaments/:id/matches/:matchId    → Owner App (scores)
POST /owner/tournaments/:id/finalize             → Owner App (winner)

GET  /tournaments/public                         → Player App
GET  /tournaments/:id                            → Player App
GET  /tournaments/:id/bracket                    → Player App
POST /tournaments/:id/register                   → Player App

GET  /admin/tournaments                          → Admin Console
PATCH /admin/tournaments/:id/cancel              → Admin Console
```

### Chat — WebSocket (all apps)
```
WS Events:
  joinRoom    { roomId, userId }    → join match/team/clan room
  sendMessage { roomId, message }  → send to room
  newMessage  { roomId, message }  → received from server

Room types:
  match:{gameId}       → Match lobby chat
  team:{clanId}        → Team/clan chat
  tournament:{id}      → Tournament announcements
  owner:{ownerId}      → Owner notification stream
  admin:broadcast      → Platform-wide admin messages
```

---

## 5. Wiring Priority Matrix

Cross-referencing all three reports, here's the priority order:

### 🔴 P0 — Must Wire Before Owner Module Launch

| Feature | Player App | Admin Console | Owner App | Backend |
|---|---|---|---|---|
| Session persistence | Save JWT to localStorage | Save JWT to localStorage | Save JWT | — |
| Load real user profile | Call `GET /users/me` on login | — | Call `GET /users/me` | ✅ exists |
| Real turf list | Replace hardcoded array → `GET /turfs` | — | — | ✅ exists |
| Real slot data | Replace SLOT_HOURS → `GET /turfs/:id/slots` | — | — | ✅ needs ground link |
| Confirm booking → real | Wire `POST /bookings` with real slotId/groundId | — | — | ✅ needs ground |
| Admin session persist | Save JWT to localStorage | ✅ | — | — |
| Owner login | — | — | `POST /owner/auth/login` | 🆕 |
| Create Owner (Admin) | — | Add "Owners" section | — | 🆕 `POST /admin/owners` |
| Owner turf setup wizard | — | — | 6-step form → `PUT /owner/profile/step/:n` | 🆕 |
| Prisma schema migration | — | — | — | 🆕 OwnerProfile, Ground, Slot |

### 🟡 P1 — Core Loop (Week 2)

| Feature | Player App | Admin Console | Owner App | Backend |
|---|---|---|---|---|
| Dynamic slot manager | — | — | Visual grid → slot APIs | 🆕 Slot CRUD |
| Real booking confirm flow | Real ground/slot/price | Booking detail view | See who booked | 🔄 extend |
| Wallet calls | Wire all wallet displays | — | Wire revenue display | ✅ exists |
| Turf detail page | Build full detail screen | Full 6-step review | — | 🔄 extend /turfs/:id |
| Amenities display | Show tag grid on turf detail | Show in verification | — | 🔄 OwnerProfile fields |
| Games API wiring | Replace openGamesData | — | — | ✅ exists |
| Friends API wiring | Replace hardcoded friends | — | — | ✅ exists |
| Clans API wiring | Replace hardcoded clans | — | — | ✅ exists |

### 🟢 P2 — Full Feature Parity (Week 3–4)

| Feature | Player App | Admin Console | Owner App | Backend |
|---|---|---|---|---|
| Tournament system | Real list + team register + bracket | Oversight page | Full tournament manager | 🆕 |
| Reviews | Review prompt + display | Review moderation | Reply to reviews | 🆕 |
| Promotions | Show discount on slots | — | Create promos | 🆕 |
| Payouts | — | Approve payout queue | Request payout | 🆕 |
| Push notifications | Real triggers | Broadcast tool | Owner alerts | 🆕 |
| Community/turf posts | Follow turf + community feed | Content moderation | Post creator | 🆕 |
| Analytics (Admin) | — | Wire real analytics | Owner analytics | 🔄 |
| WebSocket chat | Real messages (no seeds) | — | — | ✅ extend |

---

## 6. Execution Phases

### Phase 1 — Foundation (Connect the Core) ~Week 1
```
1. Prisma migration:
   - Add OwnerProfile model (full amenities schema)
   - Add Ground model
   - Add Slot model
   - Add Notification model
   Run: npx prisma migrate dev --name owner_module_foundation

2. Backend:
   - POST /admin/owners  (create owner + send credentials)
   - POST /owner/auth/login
   - PUT /owner/profile/step/:n  (6-step wizard save)
   - POST /owner/turf/submit  (trigger admin verification)
   - Extend GET /turfs/:id → include grounds, amenities, pricing

3. Player App:
   - Persist JWT to localStorage → restore session on reload
   - Wire loadUserProfile() → GET /users/me (already exists!)
   - Wire renderHomeTurfs() → GET /turfs (already exists!)
   - Wire slot picker → GET /turfs/:id/slots?date=&groundId=

4. Admin Console:
   - Persist JWT to localStorage
   - Add "Owners" nav section + create owner form
   - Upgrade turf verification → 6-step full preview panel
   - Add full amenities checklist display

5. Owner App (new file: owner.html):
   - Login screen
   - 6-step wizard UI
   - Dashboard home (skeleton)
```

### Phase 2 — Slot Engine + Booking Loop ~Week 2
```
1. Prisma migration:
   - Slot model fully operational (merge/split fields)
   Run: npx prisma migrate dev --name slot_engine

2. Backend:
   - Slot generation, merge, split, block APIs
   - POST /bookings  with real groundId + slotId
   - GET /bookings/my-bookings
   - GET /owner/bookings  (owner view)
   - Revenue aggregation: GET /owner/revenue

3. Player App:
   - Wire POST /bookings (replace wallet.deduct mock)
   - Wire GET /bookings/my-bookings
   - Wire wallet display → GET /wallet + ledger
   - Wire games list → GET /games/public
   - Wire friends → GET /friends
   - Wire clans → GET /clans

4. Admin Console:
   - Wire analytics page → GET /admin/analytics
   - Add slot utilization widget to overview
   - Add booking detail modal

5. Owner App:
   - Visual slot manager grid
   - Bookings list
   - Revenue dashboard
```

### Phase 3 — Tournament + Social ~Week 3–4
```
1. Prisma migration:
   - Tournament, TournamentTeam, TournamentMatch
   - Review, Promotion, Payout, TurfPost, TurfFollow
   Run: npx prisma migrate dev --name tournament_social

2. Backend:
   - Full tournament CRUD
   - Reviews CRUD
   - Promotions CRUD
   - Payouts CRUD
   - Notifications module (in-app + FCM placeholder)

3. Player App:
   - Full tournament rebuild (browse → register → bracket)
   - Review prompt post-booking
   - Turf follow + community feed
   - Wire all chat to real WebSocket

4. Admin Console:
   - Tournament oversight page
   - Payout approval queue
   - Review moderation page
   - Broadcast notification tool

5. Owner App:
   - Full tournament manager
   - Promotions creator
   - Reviews + replies
   - Payout request
   - Community posts
   - Analytics page
```

---

## 7. Shared Code Patterns (Optimisation Strategy)

Instead of three separate codebases with duplicated logic, extract shared utilities:

### Shared API Client Pattern
```javascript
// apps/web/shared/api.js  (imported by all three apps)
class TurffAPI {
  constructor(baseUrl, tokenKey) {
    this.base = baseUrl;
    this.tokenKey = tokenKey;
  }
  
  get token() { return localStorage.getItem(this.tokenKey); }
  set token(t) { localStorage.setItem(this.tokenKey, t); }
  
  async fetch(path, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: 'Bearer ' + this.token } : {})
    };
    const res = await fetch(this.base + path, { ...opts, headers });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'HTTP ' + res.status); }
    return res.json().catch(() => ({}));
  }
  
  get(path) { return this.fetch(path); }
  post(path, body) { return this.fetch(path, { method: 'POST', body: JSON.stringify(body) }); }
  put(path, body) { return this.fetch(path, { method: 'PUT', body: JSON.stringify(body) }); }
  patch(path, body) { return this.fetch(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  delete(path) { return this.fetch(path, { method: 'DELETE' }); }
}

// Each app instantiates with its own base + token key:
const playerAPI = new TurffAPI('http://localhost:3000', 'turff_player_token');
const ownerAPI  = new TurffAPI('http://localhost:3000', 'turff_owner_token');
const adminAPI  = new TurffAPI('http://localhost:3000', 'turff_admin_token');
```

### Shared UI Components
```javascript
// Shared toast, skeleton, modal — same across all 3 apps
function showToast(msg, icon='✅') { ... }
function skeletonRow(cols=6, rows=5) { ... }
function openModal(title, body, onConfirm) { ... }
```

### Shared Token Auth Guard
```javascript
// On every app load — restore session or redirect to login
function initApp(api, loginScreen, appShell, onLoggedIn) {
  const token = api.token;
  if (token) {
    api.get('/users/me')
      .then(user => { onLoggedIn(user); appShell.show(); loginScreen.hide(); })
      .catch(() => { api.token = null; loginScreen.show(); });
  } else {
    loginScreen.show();
  }
}
```

---

## 8. File Structure — End State

```
apps/
├── web/
│   ├── turf-complete-app.html   ← Player App (697KB → will grow, maybe split)
│   ├── admin.html               ← Admin Console (49KB → ~100KB with new sections)
│   ├── owner.html               ← Owner App (new, ~120KB)
│   └── shared/
│       ├── api.js               ← Shared API client class
│       ├── ui.js                ← Shared toast, modal, skeleton
│       └── auth.js              ← Shared token guard
│
└── backend/src/
    ├── auth/            ✅
    ├── users/           ✅
    ├── profiles/        ✅
    ├── turfs/           🔄 extend
    ├── grounds/         🆕
    ├── slots/           🆕
    ├── bookings/        🔄 extend
    ├── wallet/          ✅
    ├── games/           ✅
    ├── chat/            ✅
    ├── friends/         ✅
    ├── clans/           ✅
    ├── reputation/      ✅
    ├── gamification/    ✅
    ├── search/          ✅
    ├── checkins/        ✅
    ├── notifications/   🆕
    ├── tournaments/     🆕
    ├── owner/           🔄 major expand
    ├── promotions/      🆕
    ├── reviews/         🆕
    ├── payouts/         🆕
    └── admin/           🔄 expand
```

---

## 9. Summary — The Single Core Truth

```
┌──────────────────────────────────────────────────────────────┐
│                    ONE BACKEND                               │
│                  NestJS + Prisma + Redis                     │
│                   localhost:3000                              │
│                                                              │
│  Same JWT system • Same DB • Same WebSocket gateway          │
│                                                              │
│  /player routes → JwtGuard (any authenticated user)         │
│  /owner routes  → JwtGuard + RolesGuard (OWNER only)        │
│  /admin routes  → JwtGuard + RolesGuard (ADMIN only)        │
└──────────────────────┬───────────────────────────────────────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
 Player App        Owner App       Admin Console
 (31 screens)     (13 modules)    (9 → 16 pages)
 697KB HTML        owner.html      admin.html
                   (new)
```

**One schema. One API. Three apps. Zero duplication.**
