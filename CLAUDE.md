# RouteBook — Daily Ledger

**Product name:** RouteBook (always capital R and B — never "routeBook" or "routebook")
**Built by:** Peartech Solutions
**Client:** AlAwal Transit (internal use)
**Deployed on:** Netlify at a custom domain

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
| Hosting | Netlify (static + functions) |
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
├── index.html          # Main app (daily ledger, dashboard, entry form)
├── login.html          # Sign in page
├── signup.html         # Create account + org setup (step 1: account, step 2: business)
├── settings.html       # Admin-only: business info, logo upload, team management
├── invoice.html        # Invoice generator with clean PDF export
├── superadmin.html     # Platform superadmin panel
├── email.html          # Password reset email template
├── AlawalTransit Logo.png  # Default logo (used before org logo is set)
├── netlify.toml        # Netlify build config
└── netlify/functions/
    ├── config.js       # Returns SUPABASE_URL + SUPABASE_ANON_KEY to frontend
    ├── entries.js      # CRUD for daily ledger entries (scoped to org)
    ├── drivers.js      # CRUD for driver list (scoped to org)
    ├── org-auth.js     # Auth, org management, team/member management
    └── superadmin-api.js # Superadmin-only operations
```

---

## Netlify Environment Variables (required)

Set these in Netlify Dashboard → Site settings → Environment variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase `service_role` key (server-side only, never exposed to browser) |
| `SUPABASE_ANON_KEY` | Supabase `anon` key (safe to expose — returned by config.js) |
| `SITE_URL` | Full site URL e.g. `https://routebook.netlify.app` (used for invite redirect) |

For local dev with Netlify CLI: put these in a `.env` file (gitignored).

---

## Supabase Database Schema

### Tables

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
> Run these if the columns don't exist:
> ```sql
> ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address  TEXT DEFAULT '';
> ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone    TEXT DEFAULT '';
> ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
> ```

**`org_members`**
```sql
id          uuid primary key
org_id      uuid references organizations(id)
user_id     uuid references auth.users(id)
role        text  -- 'admin' | 'editor'
invited_by  uuid
created_at  timestamptz
```

**`entries`**
```sql
id          uuid primary key
org_id      uuid references organizations(id)
data        jsonb   -- full entry JSON (see Entry Data Format below)
created_at  timestamptz
updated_at  timestamptz
```

**`drivers`**
```sql
id          uuid primary key
org_id      uuid references organizations(id)
name        text
created_at  timestamptz
```

**`superadmins`**
```sql
user_id     uuid primary key references auth.users(id)
```

### Supabase Storage

- Bucket name: `org-logos` (must be **Public**)
- Create via Dashboard → Storage → New bucket → enable "Public bucket"
- Storage policy (boolean expression only): `bucket_id = 'org-logos'`
  - Operations: SELECT, INSERT, UPDATE, DELETE
  - Role: authenticated

---

## Auth Model

- All users are Supabase auth users (email + password)
- **Username logins**: plain usernames (no `@`) are stored as `username@routebook.internal` in Supabase Auth. Both `login.html` and `settings.html` / team management auto-append `@routebook.internal` when no `@` is present.
- Multi-tenant: each user belongs to one or more `org_members` rows. The active org is tracked in `localStorage` keyed by `activeOrg_${userId}`.
- JWT token is sent as `Authorization: Bearer <token>` on every API call.
- Active org is sent as `X-Org-Id: <orgId>` header — backend uses this to scope all data.
- Roles:
  - `admin` — full access (entry, daily, dashboard, settings, team management, invoice, export)
  - `editor` — limited (entry form only; admin-only tabs hidden via `.admin-only-tab` CSS class)

---

## Frontend Architecture (index.html)

The entire app lives in one HTML file. Key globals:

```javascript
let _sb          = null;   // Supabase JS client
let _jwtToken    = null;   // Current access token
let currentUser  = null;   // Supabase user object
let currentRole  = null;   // 'admin' | 'editor'
let currentOrg   = null;   // { id, name, address, phone, logo_url, ... }
let activeOrgId  = null;   // currently selected org
let allOrgs      = [];     // all orgs this user belongs to
let appData      = { entries: [], drivers: [] };  // in-memory data
let FS           = null;   // current form state (entry being edited)
```

### Key Functions

| Function | Purpose |
|---|---|
| `initAuth()` | Loads Supabase config, checks session, fetches profile, redirects if needed |
| `applyRoleUI(isSuperAdmin)` | Sets org name, avatar, logo, hides admin-only tabs for editors |
| `apiFetch(path, opts)` | Fetch wrapper that auto-adds JWT + X-Org-Id headers |
| `renderForm()` | Renders the daily entry form from `FS` state |
| `readDOM()` | Reads form DOM back into `FS` (called before any mutation) |
| `calc(entry)` | Pure function: computes all totals from an entry object |
| `renderDaily()` | Renders the daily view (list of past entries) |
| `renderMonthly()` | Renders the monthly dashboard with charts |
| `updateSummary()` | Re-runs `calc()` and updates summary display live |
| `showView(name)` | Switches between 'entry', 'daily', 'monthly' views |

### Entry Data Format (stored as JSON in `entries.data`)

```json
{
  "id": "uuid",
  "date": "2026-04-18",
  "driver": "Nazir",
  "prevCash": 5000,
  "advance": 0,
  "notes": "",
  "trips": [
    {
      "id": "uuid",
      "dest": "Sohrab Goth",
      "cust": "Abdul Rahim",
      "income": 15000,
      "incCfMode": false,
      "incCfQty": 0,
      "incCfRate": 0,
      "pm": "cash",
      "cashAmt": 0,
      "exp": [
        {
          "desc": "Jhampir Dhakka Loading",
          "amt": 500,
          "mode": "cash",
          "vendor": "",
          "cfMode": false,
          "cfQty": 0,
          "cfRate": 0
        }
      ]
    }
  ],
  "misc": [{ "desc": "Office Expense", "amt": 200 }],
  "coexp": [{ "desc": "Vehicle Repair", "qty": 0, "rate": 0, "amt": 1500 }],
  "clientPayments": [{ "client": "Rahim", "desc": "Payment received", "amount": 10000, "mode": "cash" }],
  "vendorPayments": [{ "vendor": "Pump Station", "amount": 5000, "mode": "cash" }],
  "driverTransfers": [{ "toDriver": "Sheer Haider", "amt": 2000 }]
}
```

### CF (Cubic Feet) Calculator Pattern

Both expense items and trip income support a CF toggle:
- **Expense**: `cfMode`, `cfQty`, `cfRate` on each expense object. Toggled by `toggleCF(ti, ei)`.
- **Income**: `incCfMode`, `incCfQty`, `incCfRate` on each trip object. Toggled by `toggleIncCF(ti)`.
- When CF is active: `amt = cfQty * cfRate` (or `income = incCfQty * incCfRate`) is auto-calculated.
- `cfSync(ti, ei)` / `incCfSync(ti)` update the amount field live as user types.
- `readDOM()` reads the CF wrap div visibility to determine if CF mode is active, and overwrites `amt`/`income` if so.

### Admin-Only UI

Elements with class `admin-only-tab` are hidden for `editor` role via:
```javascript
document.querySelectorAll('.admin-only-tab').forEach(el => el.classList.add('hidden'));
```
Applied in `applyRoleUI()`.

### Org Logo in Navbar

`<img id="nav-logo" src="AlawalTransit Logo.png" ...>` — `applyRoleUI` sets `nav-logo.src = currentOrg.logo_url` if available.

### localStorage Keys

- `alawal_cache_<orgId>` — cached `appData` for offline use
- `activeOrg_<userId>` — last selected org ID

---

## Netlify Functions API

All functions use the same auth pattern: verify `Authorization: Bearer <JWT>` + `X-Org-Id` header.

### `config.js` — GET `/.netlify/functions/config`
Returns `{ supabaseUrl, supabaseAnonKey }`. No auth required.

### `entries.js` — `/.netlify/functions/entries`
- `GET` — list all entries for the org
- `POST` — create/update entry (`{ id?, data }`)
- `DELETE` — delete entry (`?id=<uuid>`)

### `drivers.js` — `/.netlify/functions/drivers`
- `GET` — list driver names for the org
- `POST` — create driver (`{ name }`)
- `DELETE` — delete driver (`?id=<uuid>`)

### `org-auth.js` — `/.netlify/functions/org-auth?action=<action>`

| Action | Method | Auth | Description |
|---|---|---|---|
| `profile` | GET | any member | Returns `{ org, role, isSuperAdmin, allOrgs }` |
| `create-org` | POST | authenticated user | Creates org + admin membership (used in signup) |
| `members` | GET | admin | Lists all org members with emails |
| `invite` | POST | admin | Sends invite email via Supabase, adds membership |
| `remove-member` | DELETE | admin | Removes a member (cannot remove self) |
| `create-account` | POST | admin | Creates account directly `{ email/username, password, role }`. Auto-appends `@routebook.internal` to plain usernames. |
| `update-org` | POST | admin | Updates `{ name, address, phone, logoUrl }` |

---

## Invoice Generator (invoice.html)

- Requires business `address` and `phone` to be set in Settings (prompts otherwise)
- BOM table: description, qty, unit, rate → auto-calculates amount
- Supports tax %
- PDF export via html2canvas + jsPDF (scale 2×, A4, no browser chrome)
- File saved as `{invoiceNumber}.pdf`
- Footer: "Invoice generated using RouteBook by Peartech Solutions"

---

## Settings Page (settings.html)

- Admin-only (redirects to login if no session, shows error if editor role)
- Business info: name, address, phone, logo upload
- Logo upload: file → Supabase Storage bucket `org-logos` → public URL stored in `organizations.logo_url`
- Team management: same Invite/Create-Account tabs as old team modal
- `saveBizSettings()` calls `org-auth?action=update-org`

---

## Critical Constraints

**NEVER push or commit to GitHub.** Work locally only. The user will deploy manually via Netlify.

---

## Known Patterns / Conventions

1. **No build step** — all JS is vanilla, no TypeScript, no bundler. CDN scripts only.
2. **Inline HTML generation** — `renderForm()`, `renderDaily()`, `renderMonthly()` use template literals to generate HTML strings set via `innerHTML`.
3. **`esc(str)`** — always escape user input before putting it into HTML templates.
4. **`readDOM()` before mutations** — always call `readDOM()` before modifying `FS.trips` etc., or you'll lose unsaved form state.
5. **`INP` / `INPS` constants** — Tailwind class strings for input styling defined at top of script section. `INP` includes `mt-1 w-full`, `INPS` does not.
6. **Per-org data isolation** — every DB query filters by `org_id`. The `X-Org-Id` header determines which org is active.
7. **Urdu/RTL support** — `body.lang-ur` class toggles Noto Nastaliq Urdu font. `toggleLang()` function. `t('key')` for translations with `en`/`ur` dictionaries.
8. **`@routebook.internal` domain** — fake email domain used for username-only accounts to satisfy Supabase's email format requirement. All username inputs strip this suffix for display.
