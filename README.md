# RentPay

Rent collection and management for Kenyan landlords. Tenants pay rent with M-Pesa (one-tap STK push from the portal, or Paybill from the M-Pesa menu). Each payment is matched to the right unit, posted to a ledger and receipted by SMS within seconds. The landlord (admin) sees every building, unit and shilling on one dashboard.

Live address: https://rent-pay-six.vercel.app (a custom domain can be added later, see [Custom domain](#custom-domain-later))

---

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [M-Pesa (Daraja) setup](#m-pesa-daraja-setup)
- [Testing payments locally](#testing-payments-locally)
- [Scheduled jobs](#scheduled-jobs)
- [Deployment](#deployment)
- [Going live](#going-live)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)

---

## What it does

**For the landlord (admin)**
- Buildings, units, tenants and leases, with move-in and move-out wizards (prorated rent, deposits, final water bill, deposit refund)
- Monthly invoices generated automatically on the 1st (rent, metered water, fixed charges)
- A live dashboard: collected vs expected, arrears, occupancy, a collections chart, a "Needs attention" list and a colour-coded unit grid per building
- An unmatched-payments queue, bank and cash claims to confirm or reject, payment reversals
- Policies the landlord controls: due day, grace period, late fees, water rate, fixed charges, reminders, allocation order (with a preview before saving)
- Reconciliation against M-Pesa and bank statements, nightly integrity checks and month close
- Reports: collections, arrears aging, occupancy, income and expenses, rental income for KRA, payment log, deposit register
- Import of existing tenants and opening balances from an Excel template

**For tenants**
- Sign in with a phone number and an SMS code (no passwords)
- See the balance, bills, receipts and statement
- Pay now: STK push with a live status screen, or pay from the M-Pesa menu using the Paybill and unit code
- Report bank or cash payments with a photo of the slip
- An SMS at every step (bill, payment received, reminder, overdue, late fee, reversal), each linking to a colour-coded message card or receipt

**Money rules (never broken)**
- Amounts are whole Kenyan shillings stored as integers. Dates use Africa/Nairobi.
- A balance is always the sum of a lease's ledger entries. Entries are never edited or deleted, only reversed.
- Each M-Pesa receipt number is recorded once. Duplicate callbacks are ignored.
- A payment is recorded only when Safaricom confirms it with a receipt number.
- Payments clear the oldest charges first. Overpayments become credit on the next bill.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions), TypeScript, React 19 |
| Styling | Tailwind CSS v4, shadcn/ui; fonts Instrument Serif + Instrument Sans |
| Database | PostgreSQL on Supabase, Drizzle ORM and drizzle-kit migrations |
| Payments | Safaricom Daraja API (STK push, C2B Paybill with validation and confirmation) |
| SMS | BongaTech (production), Africa's Talking, or a console adapter for development |
| Background jobs | Upstash QStash (production) or inline jobs with `after()` (development) |
| File storage | Supabase Storage via its S3-compatible API (production), local folder (development) |
| Hosting | Vercel today; the Dockerfile runs the same app on Google Cloud Run later |

---

## Project structure

```text
src/
├─ app/                     Pages and API routes
│  ├─ admin/                Landlord app (dashboard, buildings, tenants, payments, invoices,
│  │                        meter readings, move-in/out, reports, reconciliation, settings)
│  ├─ tenants/              Tenant portal (login, home, pay, bills, receipts, statement, profile)
│  ├─ bill/[code]/          Colour-coded message card opened from SMS links
│  ├─ receipts/[code]/      Public, printable receipt
│  ├─ pay-link/[token]/     One-tap pay link
│  └─ api/
│     ├─ payments/          Daraja callbacks: stk-result, paybill-validation, paybill-confirmation
│     ├─ jobs/              Scheduled and queued jobs (invoices, reminders, penalties, summary,
│     │                     process-payment, check-stk-status, integrity-checks)
│     ├─ sandbox/           Test endpoints (sandbox only, removed from use in live mode)
│     └─ health/
├─ core/                    Pure money logic: billing, ledger, payment matching, policy, status
├─ services/                Use cases: payments, billing, tenancy, policies, notifications, jobs
├─ adapters/                Outside services: mpesa, sms, queue, storage, pdf
├─ database/                Drizzle schema, migrations, client, seed
├─ authentication/          Sessions, admin 2FA, tenant SMS codes
├─ configuration/           environment.ts: every setting, validated at startup
├─ utilities/               money and date helpers
├─ components/              shared/, admin/, tenants/
└─ proxy.ts                 Guards /admin and /tenants (never /api)
```

How it fits together: pages and Server Actions call `services/`; services use the rules in `core/` and talk to the outside world only through `adapters/`. Changing a provider or a host means changing an adapter and an environment variable, not the business logic.

---

## Getting started

### Requirements

- Node.js 22 or later
- A Supabase project (PostgreSQL)
- A Safaricom Daraja developer account (sandbox app)
- `cloudflared` for testing M-Pesa callbacks locally

### Install and run

```bash
npm install
# create .env (see the next section)
npm run db:generate
npm run db:migrate
npm run db:seed        # sample buildings, units and tenants (development only)
npm run dev            # http://localhost:3000
```

| Script | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Create a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Load sample data (development only) |

Sign in as admin at `/admin/login` with the seeded account. With `SMS_PROVIDER=console`, sign-in codes print in the terminal.

---

## Environment variables

All settings live in one `.env` file (never committed). `src/configuration/environment.ts` is the authoritative list. The app refuses to start if a required value is missing or invalid.

```dotenv
# App
APP_NAME=RentPay
APP_URL=https://rent-pay-six.vercel.app     # public HTTPS address, no trailing slash (a tunnel URL when testing locally)
SESSION_SECRET=                              # 32+ random characters
CRON_SECRET=                                 # 16+ random characters; protects /api/jobs and /api/sandbox (Vercel Cron sends it)
SUPPORT_EMAIL=                               # optional
BANK_NAME=                                   # optional: bank details shown to tenants who pay by transfer
BANK_BRANCH=
BANK_ACCOUNT_NAME=
BANK_ACCOUNT_NUMBER=

# Database (Supabase)
DATABASE_URL=                                # the app: transaction pooler, port 6543
DATABASE_POOL_SIZE=5                         # optional, connections per server instance
DATABASE_URL_MIGRATIONS=                     # optional, npm run db:migrate only: session pooler, port 5432

# M-Pesa (Daraja)
MPESA_ENV=sandbox                            # sandbox | live
MPESA_CONSUMER_KEY=                          # required when live
MPESA_CONSUMER_SECRET=                       # required when live
MPESA_SHORTCODE=                             # Paybill for C2B, 5-7 digits (sandbox: 600xxx test shortcode)
MPESA_STK_SHORTCODE=                         # optional; sandbox: 174379; live: defaults to MPESA_SHORTCODE
MPESA_STK_PASSKEY=                           # Lipa na M-Pesa Online passkey
MPESA_CALLBACK_KEY=                          # 16+ URL-safe characters, added to callback URLs

# SMS (must not be console when MPESA_ENV=live)
SMS_PROVIDER=console                         # console | advanta | bongatech | africastalking
ADVANTA_SMS_URL=                             # advanta: optional API URL
ADVANTA_API_KEY=
ADVANTA_PARTNER_ID=
ADVANTA_SHORTCODE=
BONGATECH_API_URL=https://bulk.bongatech.co.ke/api/v1/send-sms
BONGATECH_API_KEY=
BONGATECH_PARTNER_ID=
BONGATECH_SENDER_ID=
BONGATECH_AUTH_HEADER=                       # optional full Authorization header
AT_USERNAME=                                 # africastalking
AT_API_KEY=
AT_SENDER_ID=

# Background jobs
QUEUE_PROVIDER=inline                        # inline | qstash
QSTASH_TOKEN=                                # required when qstash
QSTASH_URL=https://qstash.upstash.io

# File storage (slip photos, profile photos); must be s3 on Vercel
STORAGE_PROVIDER=local                       # local | s3
STORAGE_LOCAL_DIRECTORY=./storage            # local only
S3_ENDPOINT=                                 # https://<project-ref>.storage.supabase.co/storage/v1/s3
S3_REGION=
S3_BUCKET=                                   # private bucket, no spaces
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# Development only (never add these to Vercel)
SEED_LANDLORD_EMAIL=
SEED_LANDLORD_PASSWORD=
ENABLE_TEST_SIGNIN=                          # true: tenant "Test sign-in" (phone + unit code, no SMS) with npm run dev;
                                             # always off on Vercel (VERCEL_ENV) and with NODE_ENV=production
```

The tenant login shows "Or pay from M-Pesa: Paybill …" only when `MPESA_ENV=live` (the Paybill shown under Settings → Integrations); sandbox test shortcodes are never shown to tenants.

---

## M-Pesa (Daraja) setup

1. Create an app on the Daraja portal and copy the sandbox Consumer Key and Secret.
2. Note the sandbox STK shortcode (174379) and passkey, and the C2B test shortcode (600xxx).
3. Set the values in `.env`. `APP_URL` must be a public HTTPS address.
4. Sign in as admin → **Settings → Integrations → Register URLs** (registers the Paybill validation and confirmation URLs).

Callback routes (Safaricom calls these):

| Route | Purpose |
| --- | --- |
| `/api/payments/stk-result` | Result of a portal (STK) payment |
| `/api/payments/paybill-validation/{key}` | Accepts every payment with a valid amount, any account number (unknown ones land in Unmatched) |
| `/api/payments/paybill-confirmation/{key}` | A completed Paybill payment. Paybill URLs carry the callback key as the last path segment because the Daraja sandbox drops query strings; `?key=` is still accepted |

Every callback is checked against `MPESA_CALLBACK_KEY`, stored raw in `payment_callbacks`, answered at once and processed in the background.

> Daraja rejects callback URLs containing `mpesa`, `safaricom`, `query`, `exe`, `exec`, `cmd` or `sql`. That's why callbacks live under `/api/payments/`.

---

## Testing payments locally

Safaricom cannot reach `localhost`, so expose the dev server with a tunnel:

```bash
# terminal 1
npm run dev

# terminal 2
cloudflared tunnel --url http://localhost:3000
```

1. Set `APP_URL` to the printed `https://….trycloudflare.com` address and restart `npm run dev`.
2. Open the app through the tunnel address (not localhost).
3. Check `/api/health`, then **Register URLs** in admin settings.
4. Sign in as a seeded tenant and pay KES 1.

The tunnel address changes on every restart: update `APP_URL` and register the URLs again. Stop the tunnel when you're done.

Sandbox test endpoints (header `Authorization: Bearer <CRON_SECRET>`, only when `MPESA_ENV=sandbox`) live under `/api/sandbox/`: leases, register-paybill, simulate-paybill, stk-push, payment-requests, payments, sms-test, sms-preview and the billing helpers.

---

## Scheduled jobs

Defined in `vercel.json` (UTC times; Nairobi is UTC+3). Each job is a normal route protected by `CRON_SECRET`, so Google Cloud Scheduler can call the same URLs later.

| Job | `vercel.json` (UTC) | When (Nairobi) |
| --- | --- | --- |
| `integrity-checks` | `30 0 * * *` | Daily 03:30 (reports any table without row level security) |
| `check-stk-status` | `0 3 * * *` | Daily 06:00 sweep (live checks also run from the pay screen) |
| `generate-invoices` | `0 4 * * *` | Daily 07:00; only bills on the 1st of the month |
| `daily-summary` | `15 4 * * *` | Daily 07:15 |
| `apply-penalties` | `0 5 * * *` | Daily 08:00 |
| `send-reminders` | `0 6 * * *` | Daily 09:00 |

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set; every job route returns 401 without it.

---

## Deployment

### Vercel

1. Push to a private GitHub repository and import it in Vercel (Pro plan for commercial use).
2. Add all production environment variables. Use new secrets, `QUEUE_PROVIDER=qstash`, `STORAGE_PROVIDER=s3` and `SMS_PROVIDER=bongatech`.
3. Set the function region next to the Supabase database.
4. Use a **separate, clean Supabase project for production** with daily backups. Run the migrations there; don't seed sample data.

### Custom domain (later)

The app runs on `https://rent-pay-six.vercel.app` until a custom domain exists. `APP_URL` must always be an address that already works: SMS links, receipts and M-Pesa callbacks are built from it, so never set it to a domain that hasn't been created yet.

When the domain is ready (for example a `rentpay` subdomain):

1. Create the subdomain, then Vercel → **Settings → Domains** → add it.
2. At its DNS host, add the `CNAME` record Vercel shows. On Cloudflare, use "DNS only".
3. Wait for "Valid Configuration" (HTTPS is issued automatically) and open the new address to check it works.
4. Only then set `APP_URL` to the new address, redeploy, and press **Register URLs** again.

### Google Cloud (later)

The same code runs on Cloud Run from the `Dockerfile` (`BUILD_STANDALONE=1` produces a standalone server). Move the database with `pg_dump`/restore, schedule the job routes with Cloud Scheduler, keep the same domain, and Daraja needs no changes.

---

## Going live

Real payments need, from Safaricom:

1. The Paybill and Daraja production approval (live keys and passkey).
2. The validation URL enabled for the Paybill.

Then set `MPESA_ENV=live` with the live keys, press **Register URLs**, and make one real KES 10 payment by Paybill and by Pay now before moving tenants over. Sandbox endpoints stop working in live mode. The tenant test sign-in never exists on a deployed site (see `ENABLE_TEST_SIGNIN`).

> Only one system can receive Paybill (C2B) notifications per Paybill. Registering URLs here moves them away from any other app using the same Paybill.

---

## Security notes

- Secrets live only in `.env` and the host's environment settings. Never commit or share them.
- Every file in `services/`, `adapters/`, `database/` and `authentication/` starts with `import 'server-only'`.
- Supabase: Row Level Security on for every table (the app connects as the postgres role); the storage bucket is private and served through short-lived signed links.
- Admin sign-in uses a password + SMS code. Tenants sign in with an SMS code; codes are hashed, expire in 5 minutes and are rate-limited.
- Every manual change (adjustments, waivers, assignments, reversals, policy changes, imports) is written to the audit log.
- All pages are `noindex`. Link previews never contain names, amounts or unit codes.

---

## Troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| STK works from one device but not another | The callback URL was built from localhost. `APP_URL` must be the public HTTPS address, and open the app through that address. |
| Payment stays "pending" | Safaricom can't reach the callback. Check the tunnel or deployment, `APP_URL`, and that Register URLs was pressed. |
| Register URLs fails | The URL contains a forbidden word, isn't HTTPS, or the shortcode doesn't match the keys. |
| No SMS arrives | Check `SMS_PROVIDER`, the provider keys and sender ID; test with `POST /api/sandbox/sms-test`; read `provider_response` in Messages. |
| Pages are slow | Check `latencyMs` on `/api/health`. Keep the database and Vercel functions in the same region. |
| "Rendering…" badge in the corner | The Next.js development indicator; it never appears in production. |
