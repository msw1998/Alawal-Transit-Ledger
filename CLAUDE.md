# RouteBook — Daily Ledger

**Product name:** RouteBook (always capital R and B — never "routeBook" or "routebook")
**Built by:** Peartech Solutions
**Client:** AlAwal Transit (internal use)
**Deployed on:** Netlify → `https://routebook.peartech.org`
**GitHub repo:** connected to Netlify for auto-deploy on push

---

## Project Overview

RouteBook is a multi-tenant daily ledger and invoice system for a trucking/freight business. Each day a driver goes on trips, the dispatcher enters:
- Trip income (amount charged to client), payment mode (cash / credit / partial)
- Per-trip expenses (diesel, toll, commission, etc.) with optional Cubic Feet pricing
- Company-level expenses, miscellaneous expenses, client payments, vendor payments, driver cash transfers

The app calculates daily profit/loss, tracks driver cash balance, and generates professional invoices.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML pages with Tailwind CSS (CDN), Chart.js, SheetJS |
| Auth | Supabase Auth (email+password, JWT) |
| Database | Supabase Postgres |
| Storage | Supabase Storage (bucket: `org-logos`) |
| Backend | Netlify Functions (Node.js serverless, `netlify/functions/`) |
| Hosting | Netlify (static + functions, auto-deploy from GitHub) |
| Build | `npm install` only — no bundler |

### CDN scripts in use (index.html)
- `https://cdn.tailwindcss.com`
- `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js`
- `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`

### CDN scripts in use (invoice.html)
- All of the above except Chart.js and SheetJS
- `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`
- `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`

---

## File Structure

```
/
├── landing.html        # Public marketing/landing page (served at /)
├── index.html          # Main app (daily ledger, dashboard, entry form) — served at /dashboard
├── login.html          # Sign in page — served at /login
├── signup.html         # Create account + org setup — served at /signup
├── settings.html       # Admin-only: business info, logo upload, team management — /settings
├── invoice.html        # Invoice generator with clean PDF export — /invoice
├── superadmin.html     # Platform superadmin panel — /superadmin
├── email.html          # Password reset email template
├── AlawalTransit Logo.png  # Default logo (used before org logo is set)
├── netlify.toml        # Netlify build config + clean URL redirects
├── CLAUDE.md           # This file
├── .env.example        # Template for new project setup
└── netlify/functions/
    ├── config.js       # Returns SUPABASE_URL + SUPABASE_ANON_KEY to frontend
    ├── entries.js      # CRUD for daily ledger entries (scoped to org)
    ├── drivers.js      # CRUD for driver list (scoped to org)
    ├── org-auth.js     # Auth, org management, team/member management
    └── superadmin-api.js # Superadmin-only operations
```

---

## URL Routing (Clean URLs)

All routes use Netlify `status = 200` rewrites — the browser URL stays clean, no `.html` visible.

| URL | Serves | Auth behaviour |
|---|---|---|
| `/` | `landing.html` | Public — no auth check (`force = true` overrides `index.html`) |
| `/login` | `login.html` | If already logged in → redirects to `/dashboard` |
| `/dashboard` | `index.html` | If not logged in → redirects to `/login` |
| `/signup` | `signup.html` | Public |
| `/settings` | `settings.html` | If not logged in → `/login`; if editor role → access denied |
| `/invoice` | `invoice.html` | If not logged in → `/login` |
| `/superadmin` | `superadmin.html` | If not logged in → `/login` |

### Important: `force = true` on root redirect
`index.html` physically exists in the root folder, so Netlify would serve it at `/` by default (overriding the redirect rule). The `force = true` on the `/` redirect rule makes Netlify serve `landing.html` instead.

```toml
[[redirects]]
  from = "/"
  to   = "/landing.html"
  status = 200
  force  = true
```

### All navigation in JS/HTML uses clean URLs
Every `window.location.href` and `href` attribute throughout all pages uses `/login`, `/dashboard`, `/settings`, `/invoice`, `/signup`, `/superadmin` — never the `.html` versions.

---

## Netlify Environment Variables (required)

Set in Netlify Dashboard → Site settings → Environment variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase `service_role` key (server-side only, never exposed to browser) |
| `SUPABASE_ANON_KEY` | Supabase `anon` key (safe to expose — returned by config.js) |
| `SITE_URL` | Full site URL e.g. `https://routebook.peartech.org` (used for invite redirect) |

For local dev with Netlify CLI: put these in a `.env` file (gitignored). See `.env.example`.

---

## Supabase Configuration

### Database Tables

**`organizations`**
```sql
id          uuid primary key
name        text
owner_id    uuid
contact_email text
contact_name  text
address     text default ''
phone       text default ''
logo_url    text default ''
```
> If columns missing: `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''; ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''; ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';`

**`org_members`** — `id, org_id, user_id, role ('admin'|'editor'), invited_by, created_at`

**`entries`** — `id, org_id, data (jsonb), created_at, updated_at`

**`drivers`** — `id, org_id, name, created_at`

**`superadmins`** — `user_id (pk)`

### Supabase Storage
- Bucket: `org-logos` (Public)
- Policy expression: `bucket_id = 'org-logos'` — SELECT/INSERT/UPDATE/DELETE for `authenticated`

### Supabase Auth — Redirect URLs
In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, add:
- `https://routebook.peartech.org/login` ← needed for password reset emails

---

## Auth Model

- Email+password via Supabase Auth
- **Username logins**: plain usernames (no `@`) stored as `username@routebook.internal`. Both `login.html` and team management auto-append `@routebook.internal` when no `@` is present.
- Multi-tenant: active org tracked in `localStorage` as `activeOrg_${userId}`
- JWT sent as `Authorization: Bearer <token>` on every API call
- Active org sent as `X-Org-Id: <orgId>` header
- Roles: `admin` (full access) | `editor` (entry form only, admin-only tabs hidden via `.admin-only-tab` CSS class)

---

## Frontend Architecture (index.html / dashboard)

Key globals:
```javascript
let _sb, _jwtToken, currentUser, currentRole, currentOrg, activeOrgId, allOrgs
let appData = { entries: [], drivers: [] }
let FS = null  // current form state
```

### Key Functions

| Function | Purpose |
|---|---|
| `initAuth()` | Load config, check session, fetch profile, redirect if needed |
| `applyRoleUI(isSuperAdmin)` | Set org name, avatar, nav logo (`#nav-logo`), hide admin-only tabs |
| `apiFetch(path, opts)` | Fetch wrapper — auto-adds JWT + X-Org-Id headers |
| `renderForm()` | Render daily entry form from `FS` state |
| `readDOM()` | Read form DOM back into `FS` — call before any `FS` mutation |
| `calc(entry)` | Pure function: compute all totals from entry object |
| `renderDaily()` | Daily view — list of past entries |
| `renderMonthly()` | Monthly dashboard with Chart.js charts |
| `updateSummary()` | Re-runs calc(), updates live summary |
| `showView(name)` | Switch between 'entry', 'daily', 'monthly' |
| `toggleIncCF(ti)` | Toggle CF mode on trip income field |
| `incCfSync(ti)` | Live-update income from CF qty × rate |
| `toggleCF(ti,ei)` | Toggle CF mode on expense field |
| `cfSync(ti,ei)` | Live-update expense amount from CF qty × rate |

### Entry Data Format (stored as JSON in `entries.data`)

```json
{
  "date": "2026-04-18",
  "driver": "Nazir",
  "prevCash": 5000,
  "advance": 0,
  "notes": "",
  "trips": [{
    "dest": "Sohrab Goth",
    "cust": "Abdul Rahim",
    "income": 15000,
    "incCfMode": false, "incCfQty": 0, "incCfRate": 0,
    "pm": "cash",
    "cashAmt": 0,
    "exp": [{
      "desc": "Jhampir Dhakka Loading", "amt": 500,
      "mode": "cash", "vendor": "",
      "cfMode": false, "cfQty": 0, "cfRate": 0
    }]
  }],
  "misc": [{ "desc": "Office Expense", "amt": 200 }],
  "coexp": [{ "desc": "Vehicle Repair", "qty": 0, "rate": 0, "amt": 1500 }],
  "clientPayments": [{ "client": "Rahim", "desc": "Payment received", "amount": 10000, "mode": "cash" }],
  "vendorPayments": [{ "vendor": "Pump Station", "amount": 5000, "mode": "cash" }],
  "driverTransfers": [{ "toDriver": "Sheer Haider", "amt": 2000 }]
}
```

### CF (Cubic Feet) Calculator Pattern
- **Expense**: `cfMode, cfQty, cfRate` on each expense. Toggled by `toggleCF(ti, ei)`.
- **Income**: `incCfMode, incCfQty, incCfRate` on each trip. Toggled by `toggleIncCF(ti)`.
- When CF active: amount = qty × rate, auto-calculated and written to amount field.
- `readDOM()` reads CF wrap div visibility to detect mode and overwrites amt/income.

### Org Logo in Navbar
`<img id="nav-logo" src="AlawalTransit Logo.png">` — `applyRoleUI` sets `nav-logo.src = currentOrg.logo_url` when available.

### Admin-Only UI
```javascript
document.querySelectorAll('.admin-only-tab').forEach(el => el.classList.add('hidden'));
```
Applied in `applyRoleUI()` for editor role.

### localStorage Keys
- `alawal_cache_<orgId>` — cached appData for offline use
- `activeOrg_<userId>` — last selected org ID

---

## Netlify Functions API

All functions verify `Authorization: Bearer <JWT>` + `X-Org-Id` header.

### `config.js` — GET `/.netlify/functions/config`
Returns `{ supabaseUrl, supabaseAnonKey }`. No auth required.

### `entries.js` — `/.netlify/functions/entries`
- `GET` — list all entries for the org
- `POST` — create/update entry (`{ id?, data }`)
- `DELETE` — delete entry (`?id=<uuid>`)

### `drivers.js` — `/.netlify/functions/drivers`
- `GET` — list driver names
- `POST` — create driver (`{ name }`)
- `DELETE` — delete driver (`?id=<uuid>`)

### `org-auth.js` — `/.netlify/functions/org-auth?action=<action>`

| Action | Method | Auth | Description |
|---|---|---|---|
| `profile` | GET | any member | Returns `{ org, role, isSuperAdmin, allOrgs }` |
| `create-org` | POST | authenticated | Creates org + admin membership (signup flow) |
| `members` | GET | admin | Lists all members with emails |
| `invite` | POST | admin | Sends invite email, adds membership |
| `remove-member` | DELETE | admin | Removes member (cannot remove self) |
| `create-account` | POST | admin | Creates account directly `{ email/username, password, role }`. Auto-appends `@routebook.internal` to plain usernames. |
| `update-org` | POST | admin | Updates `{ name, address, phone, logoUrl }` |

---

## Landing Page (landing.html — served at `/`)

- Public marketing page, no auth check
- SEO optimised: meta title, description, Open Graph, Twitter Card, JSON-LD `SoftwareApplication` schema, `FAQPage` schema
- Target keywords: freight dispatch software, trucking ledger, transport bookkeeping, freight dispatcher tool, transport business software Pakistan, cubic feet pricing, truck expense tracker, freight invoice generator
- Sections: Navbar → Hero → Stats bar → Who It's For → Features grid → How It Works → Feature deep-dive (expenses + invoice) → CTA → FAQ → Footer
- All CTA buttons link to `/login`
- `force = true` in `netlify.toml` is required for this page to serve at `/`

---

## Invoice Generator (invoice.html — served at `/invoice`)

- Requires business `address` and `phone` set in Settings (prompts otherwise)
- BOM table: description, qty, unit, rate → auto-calculates amount
- Supports tax %
- PDF export via html2canvas + jsPDF (scale 2×, A4, no browser chrome)
- File saved as `{invoiceNumber}.pdf`
- Footer: "Invoice generated using RouteBook by Peartech Solutions"

---

## Settings Page (settings.html — served at `/settings`)

- Admin-only (redirects to `/login` if no session, shows error if editor)
- Business info: name, address, phone, logo upload
- Logo upload: file → Supabase Storage `org-logos` → public URL → `organizations.logo_url`
- Team management: Invite via Email tab + Create Account tab
- `saveBizSettings()` calls `org-auth?action=update-org`

---

## Known Patterns / Conventions

1. **No build step** — vanilla JS only, CDN scripts, no TypeScript, no bundler
2. **Inline HTML generation** — `renderForm()`, `renderDaily()`, `renderMonthly()` use template literals → `innerHTML`
3. **`esc(str)`** — always escape user input before inserting into HTML templates
4. **`readDOM()` before mutations** — always call before modifying `FS.trips` etc.
5. **`INP` / `INPS` constants** — Tailwind input class strings. `INP` = `w-full border rounded-lg px-3 py-2.5 text-sm mt-1 ...`, `INPS` = same without `mt-1 w-full`
6. **Per-org data isolation** — every DB query filters by `org_id`; `X-Org-Id` header sets active org
7. **Urdu/RTL** — `body.lang-ur` class toggles Noto Nastaliq Urdu font; `t('key')` for translations
8. **`@routebook.internal` domain** — fake email domain for username-only accounts

---

## Critical Constraints

**NEVER push or commit directly** — user deploys via GitHub → Netlify auto-deploy pipeline.
