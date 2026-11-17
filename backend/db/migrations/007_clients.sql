-- 007 · Clients: stored files, support tickets with their message threads, documents with their versions, leads
-- and contracts. Tickets and documents are read by the client portal (Wave 7), through the riona_portal role and
-- its policies (011), so the columns a client may see are kept apart from the internal ones.

-- Uploaded files (storage/files.ts). The bytes live in the file store under storage_key; this row is the record.
-- Downloads go through short-lived signed links, never a public path.
CREATE TABLE files (
  id            text PRIMARY KEY,
  storage_key   text NOT NULL UNIQUE,
  filename      text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        text NOT NULL,
  uploaded_by   text REFERENCES employees (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id          text PRIMARY KEY,
  client_id   text NOT NULL REFERENCES clients (id),
  project_id  text REFERENCES projects (id),
  subject     text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  priority    text NOT NULL CHECK (priority IN ('Urgent', 'High', 'Medium', 'Low')),
  -- Internal: who is working on it. Never shown to the client.
  assignee_id text NOT NULL REFERENCES employees (id),
  status      text NOT NULL CHECK (status IN ('Open', 'In progress', 'Waiting on client', 'Resolved')),
  opened      timestamptz NOT NULL DEFAULT now(),
  resolved    timestamptz,
  -- Due time for resolution, from the contract SLA.
  sla_due     timestamptz NOT NULL
);
CREATE INDEX tickets_client_idx ON tickets (client_id, opened DESC);

CREATE TABLE ticket_messages (
  id          text PRIMARY KEY,
  ticket_id   text NOT NULL REFERENCES tickets (id),
  -- Thread order.
  seq         bigserial NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  author      text NOT NULL,
  -- Staff author; null when the client wrote it.
  author_id   text REFERENCES employees (id),
  -- What the portal shows instead of author_id.
  from_client boolean GENERATED ALWAYS AS (author_id IS NULL) STORED,
  -- Internal notes are for staff only.
  internal    boolean NOT NULL DEFAULT false,
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  -- A client can't write an internal note.
  CHECK (NOT (internal AND author_id IS NULL))
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, seq);

-- Documents belong to an employee, a project or a client. Only those marked visible_to_client, and owned by the
-- client or one of its projects, reach the portal.
CREATE TABLE documents (
  id                 text PRIMARY KEY,
  owner_type         text NOT NULL CHECK (owner_type IN ('employee', 'project', 'client')),
  owner_id           text NOT NULL,
  name               text NOT NULL,
  type               text NOT NULL,
  expires            date,
  visible_to_client  boolean NOT NULL DEFAULT false,
  CHECK (NOT (visible_to_client AND owner_type = 'employee'))
);
CREATE INDEX documents_owner_idx ON documents (owner_type, owner_id);

CREATE TABLE document_versions (
  document_id  text NOT NULL REFERENCES documents (id),
  version      integer NOT NULL CHECK (version >= 1),
  uploaded     date NOT NULL,
  by_id        text REFERENCES employees (id),
  size         text NOT NULL,
  -- Internal note on the change.
  note         text NOT NULL DEFAULT '',
  -- The uploaded file; null for versions recorded before uploads existed (the demo data).
  file_id      text REFERENCES files (id),
  PRIMARY KEY (document_id, version)
);

-- The sales pipeline.
CREATE TABLE leads (
  id           text PRIMARY KEY,
  company      text NOT NULL,
  contact      text NOT NULL,
  value_paise  bigint NOT NULL CHECK (value_paise >= 0),
  stage        text NOT NULL CHECK (stage IN ('New', 'Qualified', 'Proposal sent', 'Negotiation', 'Won', 'Lost')),
  owner_id     text NOT NULL REFERENCES employees (id),
  source       text NOT NULL,
  stage_since  date NOT NULL,
  created      date NOT NULL,
  probability  integer NOT NULL CHECK (probability BETWEEN 0 AND 100),
  notes        text NOT NULL DEFAULT ''
);
-- What happened on a lead, in order. Append-only (010).
CREATE TABLE lead_activity (
  id       bigserial PRIMARY KEY,
  lead_id  text NOT NULL REFERENCES leads (id),
  at       date NOT NULL,
  text     text NOT NULL,
  by_id    text NOT NULL REFERENCES employees (id)
);
CREATE INDEX lead_activity_lead_idx ON lead_activity (lead_id, id);

CREATE TABLE contracts (
  id                    text PRIMARY KEY,
  client_id             text NOT NULL REFERENCES clients (id),
  title                 text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('MSA', 'SOW', 'NDA', 'AMC')),
  start                 date NOT NULL,
  "end"                 date NOT NULL CHECK ("end" >= start),
  value_paise           bigint NOT NULL CHECK (value_paise >= 0),
  auto_renew            boolean NOT NULL DEFAULT false,
  sla_response_hours    integer NOT NULL CHECK (sla_response_hours > 0),
  sla_resolution_hours  integer NOT NULL CHECK (sla_resolution_hours > 0),
  status                text NOT NULL CHECK (status IN ('Active', 'Expired', 'Draft'))
);
