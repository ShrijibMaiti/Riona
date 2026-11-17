-- 001 · Core: the organisation, users, sessions, roles, and the one-time tokens for setup and password reset.

CREATE TYPE app_role AS ENUM ('Admin', 'HR', 'Manager', 'Employee', 'Client');

-- Single organisation per deployment. The row id is fixed so there is exactly one.
CREATE TABLE org (
  id            text PRIMARY KEY DEFAULT 'ORG' CHECK (id = 'ORG'),
  name          text NOT NULL,
  legal_name    text NOT NULL DEFAULT '',
  state         text NOT NULL DEFAULT 'Karnataka',
  gstin         text NOT NULL DEFAULT '',
  time_zone     text NOT NULL DEFAULT 'Asia/Kolkata',
  -- Earliest date with records; history views (timesheets, attendance, profitability) start here.
  history_from  date NOT NULL DEFAULT CURRENT_DATE,
  modules       text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Custom roles shown on Admin › Roles. `permissions` maps module → none | view | edit | approve.
CREATE TABLE roles (
  id           text PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  seeded       boolean NOT NULL DEFAULT false,
  description  text NOT NULL DEFAULT '',
  permissions  jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE users (
  id               text PRIMARY KEY,
  -- Set for staff; FK added in 002 once employees exist.
  employee_id      text UNIQUE,
  -- Set for client-portal users (Wave 7).
  client_id        text,
  email            text NOT NULL,
  name             text NOT NULL,
  -- What the API authorises against and the UI shows.
  role             app_role NOT NULL,
  -- The role as named on Admin › Users ("Finance", "IT"); display only.
  role_name        text NOT NULL,
  status           text NOT NULL DEFAULT 'Invited' CHECK (status IN ('Active', 'Invited', 'Deactivated')),
  password_hash    text,
  failed_logins    integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_active      timestamptz,
  invited          date NOT NULL DEFAULT CURRENT_DATE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'Client') = (client_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Server-side sessions. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            text,
  user_agent    text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_resets (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- The organisation-setup link (#/setup/:token).
CREATE TABLE setup_tokens (
  token_hash  text PRIMARY KEY,
  org_name    text NOT NULL,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);