-- ============================================================
-- AlAwal Ledger — Multi-tenant SaaS Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Core entry tables (already exist — keep as-is) ──────────
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT        PRIMARY KEY,
  date        DATE        NOT NULL,
  driver      TEXT        NOT NULL,
  data        JSONB       NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drivers (
  name        TEXT        PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Organizations (one per business) ────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  owner_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_name    TEXT        DEFAULT '',
  contact_email   TEXT        DEFAULT '',
  plan            TEXT        DEFAULT 'free',
  payment_status  TEXT        DEFAULT 'none',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Org Members (role per user per org) ─────────────────────
CREATE TABLE IF NOT EXISTS org_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('admin', 'editor')),
  invited_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

-- ── Superadmins (platform-level; add rows manually via SQL) ─
CREATE TABLE IF NOT EXISTS superadmins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Add org_id to existing tables ───────────────────────────
ALTER TABLE entries ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Rename drivers PK so it's per-org (optional, run only if needed)
-- ALTER TABLE drivers DROP CONSTRAINT drivers_pkey;
-- ALTER TABLE drivers ADD PRIMARY KEY (name, org_id);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entries_org_id ON entries(org_id);
CREATE INDEX IF NOT EXISTS idx_drivers_org_id ON drivers(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org  ON org_members(org_id);

-- ── Disable RLS on entries/drivers (access controlled in functions) ──
ALTER TABLE entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE drivers DISABLE ROW LEVEL SECURITY;
-- organizations + org_members use service_role in functions (bypasses RLS)
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE org_members    DISABLE ROW LEVEL SECURITY;
ALTER TABLE superadmins    DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- AFTER your first signup, run this to attach your existing
-- entries to your new org. Replace <YOUR_ORG_ID> with the
-- UUID shown after you sign up (visible in superadmin page or
-- from: SELECT id FROM organizations LIMIT 1;)
-- ============================================================
-- UPDATE entries SET org_id = '<YOUR_ORG_ID>' WHERE org_id IS NULL;
-- UPDATE drivers SET org_id = '<YOUR_ORG_ID>' WHERE org_id IS NULL;

-- ============================================================
-- TO MOVE ALL ENTRIES FROM ONE ORG TO ANOTHER (future use)
-- Find both org IDs first:
--   SELECT id, name FROM organizations;
-- Then run:
-- UPDATE entries SET org_id = '<TARGET_ORG_ID>' WHERE org_id = '<SOURCE_ORG_ID>';
-- UPDATE drivers SET org_id = '<TARGET_ORG_ID>' WHERE org_id = '<SOURCE_ORG_ID>';
-- ============================================================
