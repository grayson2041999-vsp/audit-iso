-- =====================================================================
-- Schema khởi tạo cho Neon Postgres
-- Chạy: psql "$DATABASE_URL" -f db/init.sql   (hoặc dán vào Neon SQL Editor)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE severity AS ENUM ('MAJOR','MINOR','OBS','OFI','CONF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_status AS ENUM ('DRAFT','AI_DRAFTED','REVIEWED','ISSUED','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_status AS ENUM ('PLANNED','IN_PROGRESS','REPORTING','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS audits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  title         text NOT NULL,
  scope         text,
  standards     jsonb NOT NULL DEFAULT '[]'::jsonb,
  auditee       text,
  lead_auditor  text,
  start_date    timestamptz,
  end_date      timestamptz,
  status        audit_status NOT NULL DEFAULT 'IN_PROGRESS',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id          uuid REFERENCES audits(id) ON DELETE SET NULL,
  code              text,
  status            finding_status NOT NULL DEFAULT 'DRAFT',

  raw_text          text NOT NULL,
  raw_area          text,
  raw_process       text,
  auditee           text,
  auditor_name      text,
  observed_at       timestamptz,
  due_date          timestamptz,
  standards         jsonb NOT NULL DEFAULT '[]'::jsonb,

  title             text,
  severity          severity,
  requirement       text,
  nonconformity     text,
  evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,
  statement         text,
  clauses           jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_analysis     text,
  suggested_action  text,
  missing_info      jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence        integer,
  ai_model          text,
  ai_raw            jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS findings_audit_idx   ON findings(audit_id);
CREATE INDEX IF NOT EXISTS findings_status_idx  ON findings(status);
CREATE INDEX IF NOT EXISTS findings_created_idx  ON findings(created_at DESC);
CREATE INDEX IF NOT EXISTS findings_due_date_idx ON findings(due_date);

CREATE TABLE IF NOT EXISTS finding_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id   uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  key          text NOT NULL,
  file_name    text,
  content_type text,
  size         integer,
  caption      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finding_images_finding_idx ON finding_images(finding_id);

CREATE TABLE IF NOT EXISTS finding_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  editor      text,
  note        text,
  snapshot    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
