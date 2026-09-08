# Player App — Full Analysis Report

> **File**: `c:/projects/turff/apps/web/turf-complete-app.html`
> **Size**: 697KB | **Screens**: 31 | **Functions**: 332 | **API calls**: 7 (only!) | **Hardcoded data points**: 404

---

## 1. Current State — What's Built

### Screens Inventory (31 total)
| # | Screen ID | Status | Data Source |
|---|---|---|---|
| 1 | `authLogin` | ✅ Built | OTP via backend |
| 2 | `authRegister` | ✅ Built | OTP via backend |
| 3 | `authOtp` | ✅ Built | `/auth/verify-otp` |
| 4 | `home` | ✅ Built | 🔴 Hardcoded turfs, matches |
| 5 | `booking` | ✅ Built | 🔴 Hardcoded slots, turfs |
| 6 | `bookingDetails` | ✅ Built | 🔴 Hardcoded booking data |
| 7 | `games` | ✅ Built | 🔴 Hardcoded open games |
| 8 | `create` | ✅ Built | 🔴 Hardcoded turf dropdown |
| 9 | `matchRoom` | ✅ Built | 🔴 Hardcoded room data |
| 10 | `matchLobbyChat` | ✅ Built | 🔴 Seeded messages |
| 11 | `gamechat` | ✅ Built | 🔴 Seeded messages |
| 12 | `publicMatchDetails` | ✅ Built | 🔴 Hardcoded |
| 13 | `hostedGames` | ✅ Built | 🔴 Hardcoded |
| 14 | `clans` | ✅ Built | 🔴 Hardcoded clans |
| 15 | `clanDetail` | ✅ Built | 🔴 Hardcoded clan posts |
| 16 | `teamJoinCreate` | ✅ Built | 🔴 Hardcoded |
| 17 | `clanCreate` | ✅ Built | 🔴 Hardcoded |
| 18 | `teamExpenses` | ✅ Built | 🔴 Hardcoded expenses |
| 19 | `teamchat` | ✅ Built | 🔴 Seeded messages |
| 20 | `chatinbox` | ✅ Built | 🔴 Hardcoded threads |
| 21 | `moneyHub` | ✅ Built | 🔴 Hardcoded wallet, splits |
| 22 | `profile` | ✅ Built | ✅ `userProfile` object |
| 23 | `friends` | ✅ Built | 🔴 Hardcoded friends |
| 24 | `tourney` | ✅ Built | 🔴 Hardcoded tournaments |
| 25 | `notifications` | ✅ Built | 🔴 Hardcoded notifs |
| 26 | `settings` | ✅ Built | 🔴 Local state |
| 27 | `referral` | ✅ Built | 🔴 Static |
| 28 | `legalTerms` | ✅ Built | Static content |
| 29 | `legalPrivacy` | ✅ Built | Static content |
| 30 | `legalRefund` | ✅ Built | Static content |
| 31 | `hostedGames` | ✅ Built | 🔴 Hardcoded |

**30 of 31 screens are hardcoded. Only auth is wired to backend.**

---

## 2. Feature Modules — Detailed State

### 2A. Authentication ✅ Partially Wired
| Feature | State | Backend Endpoint |
|---|---|---|
| Phone OTP send | ✅ Wired | `POST /auth/send-otp` |
| OTP verify + login | ✅ Wired | `POST /auth/verify-otp` |
| User profile load | 🔴 Hardcoded `userProfile` const | `GET /users/me` (exists, not called) |
| Token storage | 🔴 Not persisted (lost on refresh) | localStorage needed |
| Session restore on reload | ❌ Missing | JWT check on load |
| Logout | ✅ Built (clears local state) | — |

### 2B. Home 🔴 Entirely Hardcoded
| Feature | State | Needs |
|---|---|---|
| Turf discovery cards | 🔴 Hardcoded array `openGamesData` | `GET /turfs` |
| Match carousel | 🔴 Hardcoded match data | `GET /games/public` |
| Filter drawer (sport, dist, rating, price) | ✅ UI built | `GET /turfs?sport=&maxPrice=&rating=` |
| Turf detail page | ⚠️ Partial (no amenities, no real reviews) | `GET /turfs/:id` |
| Featured turfs strip | ❌ Missing | `GET /turfs?featured=true` |
| "Recently played" | ❌ Missing | `GET /bookings/my-bookings` |
| Money status bar | ✅ UI built | needs wallet API |

### 2C. Booking 🔴 Entirely Hardcoded
| Feature | State | Needs |
|---|---|---|
| Turf list | 🔴 Hardcoded | `GET /turfs` |
| Ground selection | ❌ Missing | `GET /turfs/:id/grounds` |
| Slot grid | 🔴 Hardcoded `SLOT_HOURS` array | `GET /turfs/:id/slots?date=&groundId=` |
| Slot hold (10-min lock) | ✅ Wired | `POST /bookings/slots/:id/hold` |
| Payment / confirm booking | 🔴 Hardcoded wallet deduct | `POST /bookings` |
| Booking confirmation + QR | ✅ UI built | `GET /bookings/:id` |
| Booking details / cancel | ✅ UI built | `DELETE /bookings/:id/cancel` |
| Split bill with teammates | ✅ UI built | wallet split API needed |
| My bookings list | ✅ UI built | `GET /bookings/my-bookings` |

### 2D. Games / Match Rooms 🔴 Entirely Hardcoded
| Feature | State | Needs |
|---|---|---|
| Public games list | 🔴 Hardcoded | `GET /games/public` |
| Create game | ✅ UI built | `POST /games` |
| Join game | ✅ UI built | `POST /games/:id/join` |
| Leave + refund | ✅ UI built | needs wallet + cancel |
| Match room view | 🔴 Hardcoded room data | `GET /games/:id` |
| Match lobby chat | 🔴 Seeded messages | WebSocket: `joinRoom`, `sendMessage` |
| Match carousel | 🔴 Hardcoded | `GET /games/history/me` |
| Score / result entry | ✅ UI built | `POST /games/:id/complete` |
| Game chat | 🔴 Seeded messages | WebSocket |

### 2E. Teams / Clans 🔴 Entirely Hardcoded
| Feature | State | Needs |
|---|---|---|
| Clan list / browse | 🔴 Hardcoded | `GET /clans` |
| Clan detail / posts | 🔴 Hardcoded | `GET /clans/:id` |
| Create clan | ✅ UI built | `POST /clans` |
| Join clan | ✅ UI built | `POST /clans/:id/join` |
| Team chat | 🔴 Seeded messages | WebSocket team room |
| Team expenses | 🔴 Hardcoded | wallet split API |
| Clan community posts | 🔴 Hardcoded | `GET /clans/:id/posts` |
| Follow clan | ✅ UI built | needs API |

### 2F. Tournament 🔴 Placeholder Only
| Feature | State | Needs |
|---|---|---|
| Tournament list | 🔴 2 hardcoded cards | `GET /tournaments/public` |
| Tournament detail | 🔴 Basic info only | `GET /tournaments/:id` |
| Register solo | 🔴 `handleTournamentEntry()` = random join | `POST /tournaments/:id/register` |
| Register team (captain) | ❌ Missing | needs team selection flow |
| Bracket view | ✅ UI built (`viewBracket`) | `GET /tournaments/:id/bracket` |
| Live score updates | ❌ Missing | WebSocket tournament channel |
| My tournaments | ❌ Missing | `GET /tournaments/my` |
| Winner announcement | ❌ Missing | push notification + XP |

### 2G. Money Hub 🔴 Entirely Hardcoded
| Feature | State | Needs |
|---|---|---|
| Wallet balance | 🔴 Hardcoded `₹2,450` | `GET /wallet` |
| Transaction ledger | 🔴 Hardcoded history | `GET /wallet/ledger` |
| Top-up | ✅ UI built | `POST /wallet/topup` |
| Receivables (owed to me) | 🔴 Hardcoded | needs splits API |
| Payables (I owe) | 🔴 Hardcoded | needs splits API |
| Settle debt | ✅ UI built | `POST /wallet/settle-split` |
| UPI VPA save | ✅ UI built | `PUT /profiles/me` |
| Send money reminder | ✅ UI built | notification API |

### 2H. Profile ✅ Mostly Working
| Feature | State | Needs |
|---|---|---|
| Profile display | ✅ `userProfile` object | `GET /users/me` to hydrate |
| Edit profile (9 fields) | ✅ Full modal | `PUT /profiles/me` |
| XP bar / level | ✅ UI built | `GET /gamification/...` |
| Badges | ✅ UI built (static) | `GET /gamification/badges` |
| Match history | 🔴 Hardcoded | `GET /games/history/me` |
| Stats (wins/goals) | 🔴 Hardcoded | aggregate from games |
| Friends count | 🔴 Hardcoded | `GET /friends` count |
| Favourite turfs | ✅ UI built | needs persistence |
| Reputation score | ❌ Missing | `GET /reputation/:userId` |

### 2I. Chat Inbox 🔴 Hardcoded
| Feature | State | Needs |
|---|---|---|
| Inbox thread list | 🔴 Hardcoded threads | `GET /chat/threads` |
| Match chat | 🔴 Seeded messages | WebSocket |
| Team chat | 🔴 Seeded messages | WebSocket |
| DM (direct message) | ❌ Missing | WebSocket DM channel |
| Poll in chat | ✅ UI built | WebSocket broadcast |
| Schedule share | ✅ UI built | WebSocket broadcast |

### 2J. Friends 🔴 Hardcoded
| Feature | State | Needs |
|---|---|---|
| Friends list | 🔴 Hardcoded | `GET /friends` |
| Add friend | ✅ UI built | `POST /friends/request/:userId` |
| Accept request | ✅ UI built | `POST /friends/accept/:requestId` |
| Invite to game | ✅ UI built | notification API |
| Message friend | ✅ UI built | WebSocket DM |

### 2K. Notifications 🔴 Hardcoded
| Feature | State | Needs |
|---|---|---|
| Notification list | 🔴 Hardcoded | `GET /notifications` |
| Mark read | ✅ UI built | `PATCH /notifications/mark-read` |
| Clear all | ✅ UI built | `DELETE /notifications` |
| Push (real-time) | ❌ Missing | WebSocket / FCM |

### 2L. Settings ✅ UI Complete
| Feature | State | Needs |
|---|---|---|
| Theme toggle | ✅ Works locally | — |
| Notification prefs | ✅ UI built | `PUT /profiles/me` |
| Privacy settings | ✅ UI built | `PUT /profiles/me` |
| Support chat | ✅ UI built | needs support API |
| FAQ | ✅ Built (static) | — |
| Bug report | ✅ UI built | needs report API |
| Delete account | ✅ UI built | `DELETE /users/me` |

---

## 3. What's Missing Entirely (Not Built at All)

| Feature | Priority | Required For |
|---|---|---|
| Real turf detail page (amenities, gallery, map) | 🔴 Critical | Owner module launch |
| Ground selection in booking | 🔴 Critical | Owner module launch |
| Real slot data (owner-configured) | 🔴 Critical | Owner module launch |
| Tournament team registration (captain flow) | 🔴 Critical | Tournament module |
| Live tournament bracket | 🔴 Critical | Tournament module |
| Post-match rating / review prompt | 🟡 High | Reviews feature |
| Turf follow + community feed | 🟡 High | Community feature |
| Check-in via QR | 🟡 High | Attendance tracking |
| Token persistence (session survive refresh) | 🔴 Critical | Production readiness |
| Real notifications (push) | 🟡 High | Engagement |
| DM / direct messages | 🟢 Medium | Social feature |
| Reputation score display | 🟢 Medium | Trust system |

---

## 4. API Wiring Gap Analysis

| Module | Backend Endpoints Exist | Player App Calls Them |
|---|---|---|
| Auth | ✅ send-otp, verify-otp | ✅ Yes |
| Profile | ✅ GET /users/me, PUT /profiles/me | ❌ Never called |
| Turfs | ✅ GET /turfs, GET /turfs/:id | ❌ Never called |
| Slots | ✅ GET /turfs/:id/slots | ❌ Never called |
| Bookings | ✅ Full CRUD | ❌ Slot hold only |
| Wallet | ✅ Full CRUD | ❌ Never called |
| Games | ✅ Full CRUD | ❌ Never called |
| Friends | ✅ Full CRUD | ❌ Never called |
| Clans | ✅ Full CRUD | ❌ Never called |
| Gamification | ✅ badges, award-xp | ❌ Never called |
| Chat | ✅ WebSocket gateway | ❌ Never connected |
| Reputation | ✅ rate, get | ❌ Never called |
| Search | ✅ GET /search | ❌ Never called |
| Notifications | ❌ Not built | ❌ — |
| Tournaments | ❌ Not built | ❌ — |

**Summary: 13 backend modules exist. Player App uses 1.5 of them.**

---

## 5. Data Model Currently in Player App

```javascript
// Canonical user state — currently a static const
const userProfile = {
  name, fullName, handle, bio, sport, skill,
  position, city, phone, avatar, avatarColor,
  xp, level, matches, wins, goals
}

// Other hardcoded local state
- openGamesData[]     → should come from GET /games/public
- SLOT_HOURS[]        → should come from GET /turfs/:id/slots
- teamChatSeeds[]     → should come from WebSocket
- lobbyChatSeedMsgs[] → should come from WebSocket
- initialPosts[]      → should come from GET /clans/:id/posts
- staticHistory[]     → should come from GET /games/history/me
- reviews[]           → should come from GET /turfs/:id/reviews
```
