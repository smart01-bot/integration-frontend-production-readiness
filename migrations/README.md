# Tour de Dar 2026 — Database Migrations

The database migrations have been consolidated from 19 incremental patch files into **3 clean, authoritative scripts** matching the live Supabase schema.

---

## Execution Order in Supabase SQL Editor

When setting up a database or updating schema, execute these scripts in exact numerical order:

### 1. `001_schema.sql` (Schema & Tables)
- Defines all 35 production tables with strict constraints, UUID PKs, and foreign keys.
- Covers Core Identity, Registrations, Orders, Payments, Tickets, Merch, Sponsors, Partners, Volunteers, Communications, and all Triathlon & Community features.

### 2. `002_triggers_rls.sql` (Security, Triggers & Sync)
- Helper role-resolution and check functions (`current_profile_id()`, `is_staff()`, etc.).
- `on_auth_user_created` trigger on `auth.users` generating unique `referral_code` and profile linkage.
- `registration_to_order` & `registration_status_sync` automated ticket/order issuance.
- `product_to_variants` & `sync_product_stock` merchandise inventory triggers.
- 3-way phase sync triggers between `event_config` and `event_lifecycle` with recursion protection.
- `audit_log` compatibility view and `INSTEAD OF` insert trigger.
- Full Row-Level Security (RLS) policies protecting participant data and enforcing archive-mode lockout.

### 3. `003_seed.sql` (Baseline Data & Accounts)
- Pre-confirmed test accounts (password `user1234` for all):
  - `user@gmail.com` / `hqadmin@gmail.com` (`hq_admin`)
  - `admin@gmail.com` (`admin`)
  - `participant@gmail.com` (`participant`)
  - `volunteer@gmail.com` (`volunteer`)
  - `sponsor@gmail.com` (`sponsor`)
  - `partner@gmail.com` (`partner`)
- 2026 Event Edition & default config.
- Official Triathlon Stages (Msasani Bay, T1, Peninsula Coastal Ride, T2, Dar Waterfront Run).
- Official Race Categories (`olympic-individual`, `sprint-individual`, `triathlon-relay`).
- Map waypoints, Pre-race challenges, Official Merchandise products, and Rotary Impact projects.

---

## Historical Files
The original incremental patch files (`001` through `019`) are archived in the `legacy/` subfolder for reference.
