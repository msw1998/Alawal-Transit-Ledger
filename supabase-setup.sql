-- Run this once in Supabase Dashboard → SQL Editor

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

-- Disable RLS (single-tenant internal app, auth handled at function level)
ALTER TABLE entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE drivers DISABLE ROW LEVEL SECURITY;
