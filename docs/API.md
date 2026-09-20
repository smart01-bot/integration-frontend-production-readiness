# API Reference — Tour de Rotary DSM 2026 Backend

Complete reference for all **147 endpoints** across 29 route groups, generated from `routes/*.js` and `controllers/*.js`.

Base URL: `http://localhost:8800/api/v1`

## Conventions

### Authentication
| Scheme | How | Who |
|---|---|---|
| Session token | `Authorization: Bearer <supabase-access-token>` **or** httpOnly `accessToken` cookie | All `auth` endpoints |
| Role gate | Role resolved server-side from `profiles.role` after token verification | All `role` endpoints (staff) |
| Webhook | `x-payme-signature` HMAC header — **mandatory** when `PAYME_WEBHOOK_SECRET` is set | PayMe only |
| Guest | No auth; protected by rate limiting instead | Cart checkout, payment status/verify/retry |

Role gate fails closed: `401` if `auth()` never ran, `403 { code: 'RBAC_ACCESS_DENIED' }` on insufficient role. `admin`/`hq_admin` pass every role gate. Client-supplied role headers are never trusted.

### Response envelope
Most endpoints: `{ "success": true, "data": …, "pagination"?: { "page", "limit", "total", "pages" } }`.
Admin telemetry endpoints use `{ "status": "success", … }`. Errors always `{ "error": "message" }`, sometimes plus `code` (e.g. `SOCIAL_CLOSED`, `RBAC_ACCESS_DENIED`).

### Pagination (all clamped list endpoints)
`?page=` (≥1) and `?limit=` (1–100, default per endpoint). Applied by `clampPagination` middleware; out-of-range pages normalize to the last valid page instead of erroring.

### Lifecycle gating
Community writes are blocked when the event lifecycle is not `live`: `403 { code: 'SOCIAL_CLOSED', mode }` — past posts remain readable in `memory`/`archive` modes.

---

## Activities — public catalogue
`routes/activityRoutes.js`

| # | Method & path | Auth | Query / Body | Response |
|---|---|---|---|---|
| 1 | `GET /activities` | — | `?category=` | `{ success, data: Activity[] }` — 6 activities (swim, bike, run, walk, dance, corporate relay) with prices/capacity |
| 2 | `GET /activities/:id` | — | — | `{ success, data: Activity }` · 404 if unknown |

---

## Admin — HQ command centre (all `auth()` + `admin`)
`routes/adminRoutes.js`

| # | Method & path | Body / Query | Response |
|---|---|---|---|
| 3 | `GET /admin/dashboard/overview` | — | `{ status:'success', event_edition, edition_year, current_phase, telemetry: { total_registrations, capacity_max, capacity_percentage, total_revenue_tsh, active_merchandise_reservations, checked_in_participants }, registration_breakdown: [{activity, category, registered, capacity, price_tsh, status}] }` |
| 4 | `GET /admin/overview` | alias of #3 | same |
| 5 | `PATCH /admin/events/phase` | `{ new_phase }` (`pre_event\|event_day\|post_event\|archive`, alias `phase`) | `{ success, message, edition }` — also syncs `event_config` + `event_lifecycle`, writes audit log. Audit: `UPDATE_EVENT_PHASE` |
| 6 | `POST /admin/broadcast/sms` | `{ target_group='all_participants', message, role_filter? }` | broadcast queued to Textify |
| 7 | `GET /admin/orders` | pagination | order list for HQ |
| 8 | `PATCH /admin/orders/:id/status` | `{ status }` | updated order |
| 9 | `GET /admin/users` | pagination, filters | user list |
| 10 | `PATCH /admin/users/:id/role` | `{ role }` | updated profile · audit-logged |
| 11 | `GET /admin/inventory` | — | variant stock + active reservations |
| 12 | `POST /admin/inventory/release-expired` | — | runs the reservation-release worker immediately |
| 13 | `GET /admin/content` | — | CMS content blocks |
| 14 | `PUT /admin/content` | content map | updated blocks |
| 15 | `GET /admin/audit-logs` | pagination | audit trail — staff only (403 verified for non-staff) |
| 16 | `GET /admin/promo-codes` | — | `{ success, data: PromoCode[] }` |
| 17 | `POST /admin/promo-codes` | `{ code, discount_type, discount_value, … }` | created code |
| 18 | `GET /admin/capacities` | — | per-activity capacity/registerd counts |
| 19 | `PATCH /admin/capacities/:id` | `{ capacity, … }` | updated activity |
| 20 | `GET /admin/refunds` | — | refund request queue |
| 21 | `POST /admin/refunds/:id/process` | `{ decision, note? }` | processed refund |
| 22 | `GET /admin/incidents` | — | race-day incident reports |
| 23 | `PATCH /admin/incidents/:id/status` | `{ status }` | updated incident |
| 24 | `GET /admin/export/registrations.csv` | — | `text/csv` (header row even when empty) |
| 25 | `GET /admin/export/revenue.csv` | — | `text/csv` payment ledger |

---

## Bibs — digital bibs
`routes/bibRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 26 | `GET /bibs/me` | auth | — | `{ success, data: Bib }` — **lazy-issues** the caller's bib on first view |
| 27 | `POST /bibs/generate` | auth | — | generates/refreshes own bib |
| 28 | `POST /bibs/claim` | auth | `{ bib_number }` | claims an unclaimed bib onto your profile |
| 29 | `POST /bibs/claim/:bibNumber` | auth | — | same, number in path |
| 30 | `POST /bibs/batch` | admin | array of bibs **or** `{ bibs: [...] }` | bulk generation for race-day pack-in |
| 31 | `GET /bibs/:identifier` | — (public) | — | public shareable bib page data |

---

## Campaigns — landing pages & attribution
`routes/campaignRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 32 | `GET /campaigns/landing` | — | `?campaign=slug` | campaign-ready landing content |
| 33 | `GET /campaigns/list` | — | — | active campaigns |
| 34 | `POST /campaigns/track` | — | `{ slug, utm_source, utm_medium, utm_campaign }` | click tracked |

---

## Cart — guest checkout
`routes/cartRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 35 | `POST /cart/checkout` | — (guest) | `{ full_name*, email*, phone_number*, activity_id*, merchandise_items?: [{variant_id, quantity}], tshirt_size?, promo_code?, referral_code? }` | `201 { success, order: { order_number 'TDR-2026-#####', total_tsh, … } }` — creates/finds profile, validates stock & promo, creates order + items, reserves merch (409 if stock raced). Errors: 400 missing fields / closed registration / invalid promo, 404 unknown activity or variant |

---

## Challenges — community challenges
`routes/challengeRoutes.js` · Dar-timezone date windows

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 36 | `GET /challenges` | — | `?include_past=false&discipline=` | open challenges (windows evaluated in Africa/Dar_es_Salaam) |
| 37 | `POST /challenges/:challengeId/join` | auth | — | joins; badge assigned on completion |
| 38 | `PATCH /challenges/:challengeId/complete` | auth | `{ progress_value }` | marks progress/completion |
| 39 | `GET /challenges/:challengeId/leaderboard` | — | `?limit=50` | challenge standings |
| 40 | `POST /challenges` | admin | `{ title*, description*, discipline='general', target_metric='completion', target_value=1, unit='count', badge_name?, badge_icon?, start_date?, end_date? }` | created (audit-logged) |
| 41 | `PUT /challenges/:challengeId` | admin | partial challenge | updated |
| 42 | `DELETE /challenges/:challengeId` | admin | — | deleted (destroys participant progress) |
| 43 | `PATCH /challenges/:challengeId/end` | admin | — | closes early |

---

## Collectibles — digital collectibles & certificates
`routes/collectibleRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 44 | `GET /collectibles/verify/:hash` | — (public) | — | `{ success, data: { serial_number, tier, issued_at, athlete, … } }` — powers public QR verification. 404 unknown hash |
| 45 | `GET /collectibles/my-certificate` | auth | — | caller's collectible/certificate |
| 46 | `POST /collectibles/frame` | auth | `{ activity: frameId, photoBase64 }` | framed asset |
| 47 | `POST /collectibles/issue` | admin | `{ userId, badgeId }` | issues tiered collectible with serial + verification hash |

---

## Comms — direct staff messaging
`routes/commsRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 48 | `POST /comms/sms` | role | `{ to, message, templateId?, variables? }` | sent via Textify |
| 49 | `POST /comms/email` | role | `{ to, subject, html }` | sent via Resend |

## Communications — templates & queue monitoring
`routes/communicationRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 50 | `GET /communications/templates` | role | — | `{ success, data: Template[] }` |
| 51 | `POST /communications/preview` | role | `{ template_id, variables }` | rendered preview |
| 52 | `POST /communications/send-test` | role | `{ channel='SMS', recipient, message }` | test send |
| 53 | `GET /communications/logs` | role | pagination | queue + delivery log |

---

## Community — feed, reactions, moderation
`routes/communityRoutes.js` · writes blocked outside `live` mode (`403 SOCIAL_CLOSED`)

Constants: `post_type ∈ training|story|prep|tip|question|milestone|team_update|excitement` · `discipline ∈ swim|bike|run|triathlon|general` · `reaction ∈ cheer|fire|heart|applause|strong`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 54 | `GET /community/posts` | — | `?page&limit&discipline&type` | `{ success, data: Post[] (with author full_name, likes_count, comments_count), pagination }` |
| 55 | `GET /community/posts/:postId/comments` | — | — | comment thread |
| 56 | `POST /community/posts` | auth | `{ content* (≤2000 chars), post_type='training', discipline='general', media_urls?: string[] (≤8; first also mirrors to image_url) }` | `201 { success, data: Post }` |
| 57 | `POST /community/posts/:postId/react` | auth | `{ reaction_type='cheer' }` | toggles reaction, counters resynced |
| 58 | `POST /community/posts/:postId/comments` | auth | `{ content* }` | `201` comment |
| 59 | `DELETE /community/posts/:postId` | auth | — | author-or-staff delete |
| 60 | `DELETE /comments/:commentId` | auth | — | author-or-staff delete |
| 61 | `POST /community/posts/:postId/report` | auth | `{ reason }` | files a `post_reports` row |
| 62 | `GET /community/reports` | admin | — | moderation queue |
| 63 | `PATCH /community/posts/:postId/moderate` | admin | `{ status: 'hidden'\|'published', … }` | moderation action (verified end-to-end) |

---

## Consent — research consent (§18)
`routes/consentRoutes.js` · flags are independent; owner-only reads (RLS)

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 64 | `GET /consent` | auth | — | `{ success, data: { allow_anonymized_analytics, allow_motivation_research, allow_demographic_study, consent_given_at, status: 'active'\|'not_set' } }` — `null` flags when never set (never implies consent) |
| 65 | `PUT /consent` | auth | any of the three flags (≥1 required) | upserts, stamps `consent_given_at` |
| 66 | `DELETE /consent` | auth | — | **withdraws by deleting the row** |
| 67 | `GET /consent/summary` | admin | — | aggregated totals only — never individual choices |

---

## Content — phase-aware CMS
`routes/contentRoutes.js`

| # | Method & path | Auth | Response |
|---|---|---|---|
| 68 | `GET /content` | — | `{ success, data }` — content blocks for the current lifecycle phase |

---

## Evaluation — surveys & impact
`routes/evaluationRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 69 | `POST /evaluation/survey` | — (public) | `{ edition_id?, activity_id?, nps_score=10, route_safety_rating=5, hydration_rating=5, merchandise_rating=5, app_experience_rating=5, what_went_well?, areas_for_improvement?, would_recommend=true }` | submitted |
| 70 | `GET /evaluation/results` | admin | — | aggregate survey results |
| 71 | `GET /evaluation/impact-report` | admin | — | Schedule C impact report |

---

## Fitness — Strava (deferred)
`routes/fitnessRoutes.js`

| # | Method & path | Auth | Response |
|---|---|---|---|
| 72 | `GET /fitness/status` | auth | **`501 NOT_IMPLEMENTED`** — deferred pending third-party approval (Schedule A11) |
| 73 | `POST /fitness/strava/sync` | auth | **`501`** — honest placeholder, no fake data |

---

## Merchandise — catalogue
`routes/merchandiseRoutes.js`

| # | Method & path | Auth | Query | Response |
|---|---|---|---|---|
| 74 | `GET /merchandise` | — | `?category=` | catalogue with variants + stock |
| 75 | `GET /merchandise/:id` | — | — | single item · 404 unknown |

---

## Newsletter
`routes/newsletterRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 76 | `POST /newsletter/subscribe` | — | `{ email*, name? }` | subscribed (deduped) |

---

## Participant — portal (all `auth()`)
`routes/participantRoutes.js`

| # | Method & path | Role | Body / Notes | Response |
|---|---|---|---|---|
| 77 | `GET /participant/profile` | — | — | aggregated: profile + tickets + orders + digital bib + team + challenges(+badges) + result + activity counts |
| 78 | `PUT /participant/profile` | — | profile fields | updated |
| 79 | `GET /participant/orders` | — | — | order history + receipts |
| 80 | `GET /participant/tickets` | — | — | tickets with QR; **fails closed** (403) if identity unresolvable |
| 81 | `GET /participant/certificates` | — | — | certificates |
| 82 | `GET /participant/training` | — | — | training progress |
| 83 | `GET /participant/wishlist` | — | — | `{ count, data }` wishlist rows |
| 84 | `POST /participant/wishlist/toggle` | — | `{ variant_id* }` (validated) | toggled state |
| 85 | `GET /participant/orders/:order_id/tracking` | owner | — | tracking; 403 if not owner |
| 86 | `POST /participant/orders/:order_id/pickup` | volunteer/admin | — | confirms merch pickup (`delivery_status`/`picked_up_at`); 404 unknown order |
| 87 | `GET /participant/preferences` | — | — | account preferences |
| 88 | `PUT /participant/preferences` | — | prefs map | updated |
| 89 | `GET /participant/referrals` | — | — | referral centre stats |
| 90 | `POST /participant/referrals/mint-code` | — | — | `{ status:'success', referral_code }` (idempotent) |
| 91 | `POST /participant/incidents` | — | `{ title*, description*, incident_type='other' (medical\|route_hazard\|security\|mechanical\|lost_participant\|supply_shortage\|other), severity='low' (low\|medium\|high\|critical), station?, edition_id? }` | incident filed |

---

## Partner — partner portal
`routes/partnerRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 92 | `GET /partner/clearances` | role | `?profile_id=` (admin lookup) | clearances synced from partner deliverables |
| 93 | `POST /partner/clearances/update` | role | `{ id, cleared=true }` | updated clearance |

---

## Payments — PayMe Africa (guest + rate-limited)
`routes/paymentRoutes.js` · body fields accept snake_case and camelCase aliases

| # | Method & path | Auth | Body / Params | Response |
|---|---|---|---|---|
| 94 | `POST /payments/initiate` | rate-limited | `{ order_number*, amount_tsh*, phone_number*, provider='mpesa', registration_id? }` | PayMe checkout session; **502** when PayMe unconfigured |
| 95 | `POST /payments/payme/webhook` | signature + rate-limit | PayMe event payload + `x-payme-signature` | **401** missing/invalid HMAC · **400** amount ≠ order total · idempotent replays (`duplicate_prevented: true`) · on success: payment recorded, **tickets minted, digital bibs auto-issued** (fail-soft) |
| 96 | `GET /payments/status/:order_number` | rate-limited | — | payment + order status |
| 97 | `GET /payments/verify/:transactionRef` | rate-limited | — | `{ … , transaction }` · 404 unknown |
| 98 | `POST /payments/retry` | rate-limited | `{ order_number*, phone_number* }` | re-initiates; 400 already paid / missing fields, 404 unknown order |

---

## Photos — race photos & Find-Me
`routes/photoRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 99 | `GET /photos` | — | `?page&limit&discipline&bib_number` | paginated gallery |
| 100 | `GET /photos/bib/:bib_number` | — | — | Find-Me: photos tagged with that bib |
| 101 | `POST /photos` | admin/volunteer | `{ image_url, discipline?, checkpoint_name?, bib_numbers?, photographer? }` | uploaded to Supabase Storage |
| 102 | `POST /photos/batch` | admin/volunteer | array **or** `{ photos: [...] }` | bulk upload |
| 103 | `DELETE /photos/:photoId` | admin | — | removed |

---

## Research — §18 program (consent mirror + aggregate)
`routes/researchRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 104 | `GET /research/consent` | auth | — | same contract as `GET /consent` |
| 105 | `PUT /research/consent` | auth | `{ allow_anonymized_analytics=true, allow_motivation_research=true, allow_demographic_study=true }` | upserts (note: defaults **true** here vs explicit-null on `/consent`) |
| 106 | `GET /research/summary` | admin | — | **anonymized** aggregate for research |

---

## Results — race results & leaderboards
`routes/resultsRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 107 | `GET /results` | — | `?page&limit&category&search` (ilike on name/bib) | ranked by `rank_overall`; only finished/DNF visible (RLS) |
| 108 | `GET /results/leaderboard` | — | `?board=performance&limit=20&category=` — boards: `performance\|overall\|swim\|bike\|run\|community\|teams\|participation` | `{ success, board, category, data }` — swim/bike/run order by split; community = teams by size; participation = recent registrations |
| 109 | `GET /results/me` | auth | — | caller's result |
| 110 | `POST /results` | admin | single row object | ingested |
| 111 | `POST /results/batch` | admin | array **or** `{ results: [...] }` | batch ingest |
| 112 | `POST /results/csv` | admin | raw `text/csv` body **or** `{ csv }` / `{ data }` | header aliases (`bib\|bib_number`, `swim\|swim_time`, …), times as `1:23:45` or raw seconds, dedupe |
| 113 | `PATCH /results/:id` | admin | partial result | updated |
| 114 | `DELETE /results/:id` | admin | — | removed |

---

## Social — Twibbon & share assets
`routes/socialRoutes.js`

| # | Method & path | Auth | Body / Params | Response |
|---|---|---|---|---|
| 115 | `GET /social/twibbon/frames` | — | — | available frames |
| 116 | `POST /social/twibbon/generate` | auth | `{ frame_id, ticket_id, photo_url }` | generated badge |
| 117 | `POST /social/twibbon/public` | — | `{ frame_id, display_name, custom_label? }` | **SVG name badge** (not photo compositing) |
| 118 | `GET /social/og/:bib_or_id` | — | — | OG share-card metadata |

---

## Sponsor — sponsor portal
`routes/sponsorRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 119 | `GET /sponsor/portal` | role | `?profile_id=` (admin lookup) | profile, assets, deliverables, recognition |
| 120 | `POST /sponsor/logo/upload` | role | `{ logo_vector_url, profile_id? }` | logo set |

---

## Stories — "Why I Participate"
`routes/storiesRoutes.js` · backed by `whyIParticipateController.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 121 | `GET /stories` | — | `?page&limit&featured` | approved stories (RLS: `is_approved = TRUE`) |
| 122 | `POST /stories` | auth | `{ quote*/story_text*/story_details?, photo_url?, discipline='triathlon' }` | submitted for review |
| 123 | `PATCH /stories/:storyId/approve` | admin | `{ is_featured=false }` | approved/featured |

---

## Teams — relay & community teams
`routes/teamRoutes.js` · captain-only edit (403 verified)

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 124 | `GET /teams` | — | `?page&limit&type` | `{ success, data, pagination }` with member_count |
| 125 | `GET /teams/:teamId` | — | — | detail + members |
| 126 | `POST /teams` | auth | `{ name*, story?, team_type='community', is_relay=false, logo_url? }` | `201`; creator becomes captain |
| 127 | `PATCH /teams/:teamId` | captain | `{ name?, story?, team_type?, logo_url? }` | updated |
| 128 | `POST /teams/:teamId/join` | auth | `{ role='member' }` | joined |
| 129 | `DELETE /teams/:teamId/leave` | auth | — | left |
| 130 | `GET /teams/:teamId/discussions` | member | — | team thread |
| 131 | `POST /teams/:teamId/discussions` | member | `{ message* }` | posted |

---

## Tickets — issuance & check-in
`routes/ticketRoutes.js`

| # | Method & path | Auth | Body | Response |
|---|---|---|---|---|
| 132 | `GET /tickets` | auth | — | caller's tickets with QR tokens |
| 133 | `GET /tickets/qr/:qr_token` | — | — | ticket lookup by QR (check-in scan path) |
| 134 | `POST /tickets/checkin` | volunteer/admin | `{ qr_token*, station_name='Gate 1 (Waterfront Arch)' }` | checked in |

---

## Triathlon — course, map & lifecycle
`routes/triathlonRoutes.js`

| # | Method & path | Auth | Body / Query | Response |
|---|---|---|---|---|
| 135 | `GET /triathlon/overview` | — | — | stages (swim/T1/bike/T2/run — `is_confirmed=false` until verified), categories |
| 136 | `GET /triathlon/live-activity` | — | — | event-day live feed |
| 137 | `GET /triathlon/map` | — | `?discipline=` | Dar Map waypoints |
| 138 | `GET /triathlon/impact` | — | — | community impact stats |
| 139 | `PATCH /triathlon/lifecycle` | admin | `{ mode }` | lifecycle override (`live\|memory\|archive\|custom`) |
| 140 | `POST /triathlon/waypoints` | admin | `{ discipline*, point_type* (start\|turn\|aid\|medical\|transition\|spectator\|parking\|finish), name*, lat* (Dar range), lng* (Dar range), description?, landmark?, order_index? }` | created |
| 141 | `PATCH /triathlon/waypoints/:waypointId` | admin | partial | updated |
| 142 | `DELETE /triathlon/waypoints/:waypointId` | admin | — | removed |
| 143 | `POST /triathlon/categories` | admin | category fields | created |
| 144 | `PATCH /triathlon/categories/:categoryId` | admin | partial | updated |

---

## Volunteer — shift operations
`routes/volunteerRoutes.js` · backed by `volunteer_assignments`

| # | Method & path | Auth | Response |
|---|---|---|---|
| 145 | `GET /volunteer/shift` | auth | caller's assignment (role, zone, shift times) with profile + edition |
| 146 | `POST /volunteer/briefing/acknowledge` | auth | sets `briefing_acknowledged = true` |
| 147 | `POST /volunteer/checkin-ticket` | auth | participant ticket check-in from volunteer station |

---

## Status codes used

| Code | Meaning here |
|---|---|
| `200/201` | Success |
| `400` | Validation (bad body, mismatched webhook amount, invalid enum, closed registration) |
| `401` | No/invalid token, missing webhook signature |
| `403` | Wrong role (`RBAC_ACCESS_DENIED`), non-owner, community closed (`SOCIAL_CLOSED`), unresolved identity (fails closed) |
| `404` | Unknown resource |
| `409` | Stock race lost at checkout |
| `429` | Rate limit exceeded (tiered per route group) |
| `501` | Fitness/Strava (deferred, honest) |
| `502` | Payment provider unreachable/unconfigured |
| `503` | Database down (health check only) |

## Rate-limit tiers (middleware/apiHygiene.js)

| Tier | Applied to |
|---|---|
| `webhookLimiter` | `POST /payments/payme/webhook` |
| `paymentActionLimiter` / `statusLimiter` | initiate, retry / status, verify |
| `writeLimiter` | community posts, reactions, comments, reports |
| `mutationLimiter` | challenge join/complete, team create/join, story submit |
| `readLimiter` | hot public lists (results, photos, feed, teams, challenges) |
