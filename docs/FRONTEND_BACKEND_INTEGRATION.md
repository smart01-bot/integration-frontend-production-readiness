# Frontend/backend integration

## Verified live integration (2026-09-15)

The full auth/bridge chain was tested end-to-end against the running backend
(port 8800) and the shared Supabase project, using the seeded test accounts
(`participant@gmail.com`, `admin@gmail.com`, password `user1234`):

| Check | Result |
|---|---|
| Supabase login with the same project the frontend uses → session token | OK |
| `Authorization: Bearer <frontend session token>` on `/api/v1/participant/profile` and `/api/v1/tickets` | 200 |
| CORS preflight from `http://localhost:3000` | 204 with correct `access-control-allow-origin` |
| `POST /api/v1/newsletter/subscribe` (the frontend's active API call) | 201 |
| `GET /api/v1/payments/verify/:registrationId` (frontend verify contract) | 200 `{status:'completed'}` |
| `POST /api/v1/payments/initiate` with frontend payload (`registrationId, amountTSh, phone`) | 502 `PAYME unconfigured` — correct until PayMe keys are added; validation path (400) also verified |
| `POST /api/v1/collectibles/frame` (frontend `frameApi.generate`) | 200, returns SVG data-URI |
| `GET /api/v1/admin/orders`, `/api/v1/admin/export/registrations.csv` with admin token | 200 |
| Frontend `tsc --noEmit` typecheck | clean |

### Bugs fixed in this pass — ambiguous PostgREST embeds

Migration `006` gave `orders` a second profile FK (`user_id`) and `tickets`
already had two (`profile_id` + `checked_in_by`). Every unqualified
`profiles(...)` embed on those tables failed with *"Could not embed because
more than one relationship was found"* (HTTP 500). Fixed by pinning the
relation (`profiles:profile_id(...)`) in `ticketController.js`,
`adminController.js` (orders list + registrations CSV export),
and `socialController.js` (twibbon composition + OG card, used by
`collectibles/frame`). The endpoints above returned 500 before, 200 after.
Rule of thumb going forward: on `tickets`, `orders`, `sponsors`, `partners`,
or `referrals`, always disambiguate profile embeds with `profiles:profile_id`
or `!fkey` hints.

## Known remaining gaps (not regressions)

- **Frontend has no checkout UI yet.** `merch/page.tsx` keeps the cart in
  local state and the dashboard's "Pay now" button links to `/ticket` —
  neither calls `paymentsApi.initiate`. The backend contract is ready and
  verified; the frontend needs to wire the cart/registration flow to
  `POST /api/v1/payments/initiate` then poll `GET /api/v1/payments/verify/:transactionRef`.
- **Event date mismatch — resolved by migration `015`.** The frontend
  (`src/lib/constants.ts`, `src/config/site.ts`) says **1 November 2026**;
  migration `014` had seeded `event_editions.event_date`, `event_config`, and
  volunteer shifts with **18 October 2026**. Migration `015` aligns
  `event_editions.event_date` and `event_config.event_date` to
  `2026-11-01 06:00+03` (and sets `event_day_duration_hours = 12`) so the
  backend phase engine, countdowns, and frontend calendars agree.
- `backend-live.log` in the repo root is the stdout log of the running
  backend process; ignore or add to `.gitignore`.

## What now matches

The frontend repository (`smart01-bot/tourderotary-dsm`, main branch) uses
Supabase directly for its primary data. Migration `006_frontend_contract.sql`
adds its required database contract: `event_config`, `registrations`,
`products`, `shifts`, `volunteer_shifts`, `sponsors`, `sponsor_assets`,
`partners`, `partner_deliverables`, `audit_log`, and the missing frontend
columns on `profiles`, `orders`, and `order_items`.

It also accepts either profile identity convention used by the two projects:
the backend's `profiles.auth_user_id` or the frontend's `profiles.id` equal to
the Supabase Auth user ID. A frontend `hq_admin` profile is authorized as a
backend `admin` for protected API endpoints.

`POST /api/v1/newsletter/subscribe` now matches the one API call that the
frontend actively makes. Set this in the frontend environment:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8800/api/v1
NEXT_PUBLIC_SUPABASE_URL=<same Supabase project as the backend>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same project's anon key>
```

## Current integration boundaries & API status

1. **Direct Supabase vs. Express API**:
   - The registration, merchandise, volunteer, sponsor, partner, and HQ screens call Supabase directly for database reads and writes.
   - Wrappers defined in `src/lib/api.ts` (`smsApi`, `emailApi`, `frameApi`, `collectiblesApi`) are stubbed client helpers ready for when the frontend opts into server-side processing, but are not yet imported or called from UI components.
   - `newsletterApi.subscribe` (`POST /api/v1/newsletter/subscribe`) is currently wired and actively consumed by the frontend footer newsletter form.

2. **Payment contract reconciliation**:
   - `paymentController.js` has been updated to accept both the frontend client contract (`registrationId`, `amountTSh`, `phone`, `provider`) and the backend legacy contract (`order_number`, `amount_tsh`, `phone_number`).
   - If `registrationId` is passed without an `order_number`, the controller automatically resolves or synthesizes the order reference.
   - The response shape returns `{ checkoutUrl, transactionRef }`, matching `paymentsApi.initiate` in `src/lib/api.ts`.
   - **Registration amount sync (paymentController.js `initiatePayment`):** the
     frontend inserts `registrations` with `amount_tsh` NULL, so the
     migration-010 trigger creates the linked order with a **0 total**. The
     controller now prices that linked order, its `activity_ticket` line item,
     and the registration with the client-declared amount, so the PayMe
     webhook's amount cross-check (`reportedAmount === order.total_tsh`) passes.
   - **Registration completion on webhook (paymentController.js
     `handlePayMeWebhook`):** when the paid order carries a
     `source_registration_id`, the webhook backfills the source link on the
     issued ticket and flips the registration to `confirmed` /
     `payment_status = completed` with the real `amount_tsh` and bib. This
     requires migration `016` (the service role must be allowed to write
     protected registration columns) — see that migration file for details.
   - Verification via `GET /api/v1/payments/verify/:transactionRef` accepts either order numbers, payment references, or registration IDs.

3. **CORS configuration**:
   - `ALLOWED_ORIGINS` in `.env` must include `http://localhost:3000` (and `http://127.0.0.1:3000`), otherwise cross-origin browser requests from Next.js will be blocked.

4. **Nested repository notes**:
   - `tourderotary-dsm/` inside the backend directory is a Git submodule/subproject commit. Fresh clones of the backend repo without `--recurse-submodules` will show an empty folder.

## Local test sequence

1. Create a fresh Supabase development project. Apply migrations `001` through
   `016` in order, then the seed. Do not run the seed against production data.
2. In this backend, copy `.env.example` to `.env` and set `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, and:

   ```env
   PORT=8800
   NODE_ENV=development
   ALLOWED_ORIGINS=http://localhost:3000
   ```

3. Run `npm ci`, then `npm start`. Confirm `GET http://localhost:8800/api/v1/health`
   returns HTTP 200. It only reports configured integrations; it does not make
   live payment/SMS/email calls.
4. Run the frontend with the three environment variables above. Sign up a
   participant, then confirm the `profiles` row and a pending `registrations`
   row in Supabase. Test a newsletter signup and confirm a
   `newsletter_subscribers` row.
5. For protected backend routes, sign in in the frontend, retrieve the
   Supabase session `access_token`, and call a route with
   `Authorization: Bearer <access_token>`. Promote the matching profile's role
   to `admin` (or `hq_admin`) only in the development database before testing
   `/api/v1/admin/*`.

## No more controller mock data

`activityController` now returns database results, a 404 for a missing item,
or a 500 for database failure. `communicationController` now reads only the
persisted `communication_templates` table. The former empty-result database
proxy has also been removed, so a direct PostgreSQL consumer fails visibly
when `DATABASE_URL` is missing.
