-- 015 · Admin: notification rules, master lists (departments, locations, leave types…), the system jobs board,
-- and requests for a demo from the public site.

CREATE TABLE notification_rules (
  id        text PRIMARY KEY,
  event     text NOT NULL,
  module    text NOT NULL,
  position  integer NOT NULL,
  in_app    boolean NOT NULL DEFAULT true,
  email     boolean NOT NULL DEFAULT false,
  digest    boolean NOT NULL DEFAULT false
);

CREATE TABLE master_lists (
  id        text PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  position  integer NOT NULL,
  columns   text[] NOT NULL
);
CREATE TABLE master_rows (
  id       text PRIMARY KEY,
  list_id  text NOT NULL REFERENCES master_lists (id),
  seq      bigserial NOT NULL,
  values   text[] NOT NULL,
  active   boolean NOT NULL DEFAULT true
);
CREATE INDEX master_rows_list_idx ON master_rows (list_id, seq);

-- The last run of each background job (jobs/scheduler.ts records its own; imported ones keep their history).
CREATE TABLE system_jobs (
  id        text PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  last_run  timestamptz NOT NULL,
  status    text NOT NULL CHECK (status IN ('Succeeded', 'Failed')),
  detail    text NOT NULL DEFAULT ''
);

-- From the public site's "Book a demo". Anonymous, so rate-limited by IP in the service.
CREATE TABLE demo_requests (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  company     text NOT NULL DEFAULT '',
  size        text NOT NULL DEFAULT '',
  ip          text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_requests_ip_idx ON demo_requests (ip, created_at);
