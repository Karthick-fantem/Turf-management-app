# Admin Console — Full Analysis Report

> **File**: `c:/projects/turff/apps/web/admin.html`
> **Size**: 49KB | **Pages**: 9 | **Functions**: 40 | **API endpoints used**: 15 | **Demo data vars**: 8

---

## 1. Current State — What's Built

### Pages Inventory (9 total)
| # | Page ID | Status | Data Source |
|---|---|---|---|
| 1 | `overview` | ✅ Built | ✅ `/admin/overview` (live) |
| 2 | `analytics` | ✅ Built | 🔴 Hardcoded charts/bars |
| 3 | `turfs` | ✅ Built | ✅ `/admin/turf-verifications` |
| 4 | `bookings` | ✅ Built | ✅ `/admin/bookings` |
| 5 | `payments` | ✅ Built | ✅ `/admin/payments` |
| 6 | `disputes` | ✅ Built | ✅ `/admin/disputes` |
| 7 | `moderation` | ✅ Built | ✅ `/admin/moderation/users` |
| 8 | `settings` | ✅ Built | ✅ `/admin/settings` |
| 9 | `auditlog` | ✅ Built | ✅ `/admin/audit-logs` |

**7 of 9 pages call real backend. 2 are hardcoded (analytics charts).**

---

## 2. Feature Modules — Detailed State

### 2A. Authentication ✅ Fully Working
| Feature | State |
|---|---|
| Admin login (email + password) | ✅ `POST /admin/auth/login` |
| JWT token stored in memory | ✅ `jwt` variable |
| Token sent with all requests | ✅ Bearer header |
| Demo fallback (if backend offline) | ✅ Auto demo mode |
| Logout | ✅ Clears jwt + shows login screen |
| Session persistence (refresh) | 🔴 Lost on page refresh |

### 2B. Dashboard Overview ✅ Wired
| Feature | State | Gap |
|---|---|---|
| Total users, active turfs, GBV, revenue | ✅ Live data | — |
| Weekly metrics table | ✅ Live data | — |
| Quick action buttons | ✅ Built | Syntax was broken (now fixed) |
| Real-time clock | ✅ Built | — |
| Owner count | ❌ Missing | `GET /admin/overview` needs `totalOwners` |
| Active tournaments | ❌ Missing | needs tournament data |
| Pending payouts | ❌ Missing | needs payout data |
| Platform uptime / health | ❌ Missing | health check API |

### 2C. Analytics 🔴 Entirely Hardcoded
| Feature | State | Needs |
|---|---|---|
| Bookings by sport (bar chart) | 🔴 Hardcoded array | `GET /admin/analytics` |
| Revenue trend (8-week chart) | 🔴 Hardcoded array | `GET /admin/analytics` |
| Peak booking hours | 🔴 Hardcoded array | `GET /admin/analytics` |
| New users (7-day bar) | 🔴 Hardcoded array | `GET /admin/analytics` |
| Per-turf booking density | ❌ Missing | needs turf analytics |
| Tournament participation stats | ❌ Missing | needs tournament data |
| Owner revenue per turf | ❌ Missing | needs owner analytics |
| Geographic heat map | ❌ Missing | future |

### 2D. Turf Verification ✅ Basic — Needs Major Upgrade
| Feature | State | Gap |
|---|---|---|
| Pending turf list | ✅ Live data | — |
| Approve turf | ✅ `POST /admin/turf-verifications/:id/approve` | — |
| Reject turf | ✅ `POST /admin/turf-verifications/:id/reject` | — |
| Filter (pending/verified/all) | ✅ Built | demo data only (not API filtered) |
| **Full 6-step turf preview** | ❌ Missing | `GET /admin/turfs/:id/full` |
| **Photo gallery viewer** | ❌ Missing | image preview modal |
| **GPS map pin view** | ❌ Missing | embedded map |
| **Amenities checklist** | ❌ Missing | show all facility toggles |
| **Ground details table** | ❌ Missing | per-ground breakdown |
| **Rejection reason picker** | 🔴 Free text only | preset + custom reasons |
| **Re-submission queue** | ❌ Missing | rejected + resubmitted filter |
| **Featured toggle** | ❌ Missing | `PATCH /admin/turfs/:id/feature` |
| **Edit approved turf** | ❌ Missing | admin override editor |

### 2E. Bookings ✅ Mostly Working
| Feature | State | Gap |
|---|---|---|
| Bookings list | ✅ Live data | — |
| Search by user/turf | ✅ Built | client-side only |
| Filter by status | ✅ Built | client-side only |
| Force cancel booking | ✅ `POST /admin/bookings/:id/force-cancel` | — |
| **Booking detail view** | ❌ Missing | full booking info modal |
| **Export CSV** | ❌ Missing | — |
| **Slot utilization report** | ❌ Missing | % booked per turf |

### 2F. Payments ✅ Mostly Working
| Feature | State | Gap |
|---|---|---|
| Payments list | ✅ Live data | — |
| Process refund | ✅ `POST /admin/payments/:id/process-refund` | — |
| Filter by status | ✅ Built | demo fallback |
| **Payment detail modal** | ❌ Missing | full transaction view |
| **Commission breakdown** | ❌ Missing | platform cut per payment |
| **Bulk refund** | ❌ Missing | for cancelled tournaments |
| **Tax / GST report** | ❌ Missing | compliance |

### 2G. Disputes ✅ Working
| Feature | State | Gap |
|---|---|---|
| Dispute list | ✅ Live data | — |
| Resolve dispute | ✅ `PATCH /admin/disputes/:id/resolve` | — |
| **Dispute detail** | ❌ Missing | full chat history |
| **Evidence upload** | ❌ Missing | attach screenshots |
| **Escalation** | ❌ Missing | multi-level resolution |

### 2H. User Moderation ✅ Working
| Feature | State | Gap |
|---|---|---|
| User list | ✅ Live data | — |
| Suspend user | ✅ `POST /admin/moderation/users/:id/suspend` | — |
| Reinstate user | ✅ UI built | needs reinstate API |
| Search users | ✅ Built | client-side only |
| **User detail view** | ❌ Missing | full profile, booking history |
| **Trust score editor** | ❌ Missing | manual override |
| **Ban (permanent)** | ❌ Missing | permanent block |
| **Activity log per user** | ❌ Missing | all actions by this user |

### 2I. System Settings ✅ Working
| Feature | State | Gap |
|---|---|---|
| Settings list | ✅ Live data | — |
| Edit setting | ✅ `PUT /admin/settings/:key` | — |
| **New setting keys needed** | See below | 8 new keys for owner module |

### 2J. Audit Log ✅ Working
| Feature | State | Gap |
|---|---|---|
| Log list | ✅ Live data | — |
| **Filter by actor / action type** | ❌ Missing | currently shows all |
| **Date range filter** | ❌ Missing | — |
| **Export audit log** | ❌ Missing | compliance |

---

## 3. What's Missing Entirely (Not Built)

These entire sections need to be added to Admin Console for the Owner Module:

| Section | Priority | Description |
|---|---|---|
| **Owners** | 🔴 Critical | Create owner, list all, view profile, deactivate |
| **Tournament Oversight** | 🔴 Critical | All platform tournaments, cancel, force-resolve |
| **Payouts** | 🔴 Critical | Approve owner payout requests |
| **Reviews Moderation** | 🟡 High | Remove bad reviews, respond to flags |
| **Notifications Center** | 🟡 High | Send broadcast notifications to users/owners |
| **CRM / Player Insights** | 🟢 Medium | Power user analytics, churn risk |
| **Content Moderation** | 🟢 Medium | Flag community posts, remove inappropriate content |

---

## 4. API Gap Analysis

### Endpoints Used by Admin (15 currently)
```
POST /admin/auth/login           ✅
GET  /admin/overview             ✅
GET  /admin/turf-verifications   ✅
POST /admin/turf-verifications/:id/approve  ✅
POST /admin/turf-verifications/:id/reject   ✅
GET  /admin/bookings             ✅
POST /admin/bookings/:id/force-cancel       ✅
GET  /admin/payments             ✅
POST /admin/payments/:id/process-refund     ✅
GET  /admin/disputes             ✅
PATCH /admin/disputes/:id/resolve           ✅
GET  /admin/moderation/users     ✅
POST /admin/moderation/users/:id/suspend    ✅
GET  /admin/settings             ✅
PUT  /admin/settings/:key        ✅
GET  /admin/analytics            ✅ (exists but returns hardcoded)
GET  /admin/audit-logs           ✅
```

### Endpoints Needed but Missing (backend + UI)
```
POST /admin/owners                         ← Create owner account
GET  /admin/owners                         ← List all owners
GET  /admin/owners/:id                     ← Owner detail
PATCH /admin/owners/:id/deactivate         ← Suspend owner
GET  /admin/turfs/:id/full                 ← Full turf details for review
PATCH /admin/turfs/:id/feature             ← Toggle featured
GET  /admin/tournaments                    ← All tournaments
PATCH /admin/tournaments/:id/cancel        ← Force cancel tournament
GET  /admin/payouts                        ← Payout queue
PATCH /admin/payouts/:id/approve           ← Approve payout
GET  /admin/reviews                        ← All platform reviews
DELETE /admin/reviews/:id                  ← Remove review
POST /admin/notifications/broadcast        ← Send platform-wide notification
GET  /admin/users/:id/activity             ← Per-user activity
GET  /admin/reports/commission             ← Revenue/commission report
GET  /admin/reports/slot-utilization       ← Slot fill rate per turf
```

---

## 5. Demo Data Gaps

All 8 demo data variables are hardcoded Chennai-specific data. For owner module, these need to be extended or replaced with real data:

| Variable | Current | Needs |
|---|---|---|
| `demoOverview` | 4 stats | + `totalOwners`, `pendingPayouts`, `activeTournaments` |
| `demoTurfs` | 4 turfs | Real turf objects with full 6-step profile data |
| `demoBookings` | 5 bookings | Linked to real ground/slot IDs |
| `demoPayments` | 5 payments | Linked to real booking IDs |
| `demoDisputes` | 3 disputes | Linked to real user IDs |
| `demoUsers` | 5 users | Trust score, full profile |
| `demoSettings` | 7 settings | + 8 new owner module settings |
| `demoLogs` | 8 log entries | Richer action types |

---

## 6. UX Gaps in Admin Console

| Issue | Impact | Fix |
|---|---|---|
| Session lost on page refresh | 🔴 High | Persist JWT in localStorage |
| No loading states between pages | 🟡 Medium | Skeleton loaders (partial — needs all pages) |
| No search bar in audit logs | 🟡 Medium | Add filter row |
| Analytics charts are static | 🔴 High | Wire to real analytics API |
| No mobile responsiveness | 🟢 Low | Admin is desktop-only, acceptable |
| No keyboard shortcuts | 🟢 Low | Future |
| No breadcrumbs | 🟡 Medium | Add to detail views |
| Error handling too basic | 🟡 Medium | Better error display in tables |
