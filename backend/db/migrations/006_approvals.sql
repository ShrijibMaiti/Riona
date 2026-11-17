-- 006 · The approval engine: versioned workflow definitions, approvals with their resolved chain, and the
-- append-only record of every decision (guarded in 010). Also the records that go through it from Wave 4:
-- attendance regularisations, profile changes, and timesheet entries and weeks.

-- An approval workflow (Admin › Workflows). The definition lives in workflow_versions.
CREATE TABLE workflows (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  module           text NOT NULL CHECK (module IN ('Leave','Expense','Timesheet','Regularisation','Invoice','Profile change','Onboarding')),
  status           text NOT NULL CHECK (status IN ('Active','Paused','Draft')),
  current_version  integer NOT NULL DEFAULT 1,
  updated          date NOT NULL DEFAULT CURRENT_DATE
);
-- At most one active workflow per module drives new requests.
CREATE UNIQUE INDEX workflows_one_active ON workflows (module) WHERE status = 'Active' AND module <> 'Onboarding';

-- Every saved version, append-only. A request keeps the version it started under.
CREATE TABLE workflow_versions (
  workflow_id  text NOT NULL REFERENCES workflows (id),
  version      integer NOT NULL,
  -- { nodes, edges } as the builder draws them.
  definition   jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  PRIMARY KEY (workflow_id, version)
);

CREATE TABLE approvals (
  id                text PRIMARY KEY,
  type              text NOT NULL CHECK (type IN ('Leave','Expense','Timesheet','Regularisation','Invoice','Profile change')),
  source_id         text NOT NULL,
  requester_id      text NOT NULL REFERENCES employees (id),
  submitted         date NOT NULL,
  -- Withdrawn: the requester recalled or cancelled it before a decision (not returned by GET /approvals).
  status            text NOT NULL CHECK (status IN ('Pending','Approved','Rejected','Withdrawn')),
  -- Index into the chain of the step awaiting a decision. Step 0 is the requester.
  current           integer NOT NULL DEFAULT 1 CHECK (current >= 0),
  -- The resolved chain, fixed when the request is made: [{ approverId, role }], excluding the requester.
  plan              jsonb NOT NULL,
  -- Employee ids told when it is approved (the workflow's Notification steps), resolved when the request is made.
  notify            jsonb NOT NULL DEFAULT '[]'::jsonb,
  workflow_id       text,
  workflow_version  integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  -- The step whose approver was last reminded that its SLA had passed (timeouts.job.ts), so it happens once.
  reminded_step     integer,
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions (workflow_id, version)
);
CREATE INDEX approvals_requester_idx ON approvals (requester_id);
CREATE INDEX approvals_source_idx ON approvals (type, source_id);
CREATE INDEX approvals_pending_idx ON approvals (status) WHERE status = 'Pending';

-- One row per decision, append-only (guard in 010). `step` indexes the chain (1 = the first approver).
CREATE TABLE approval_steps (
  approval_id  text NOT NULL REFERENCES approvals (id),
  step         integer NOT NULL CHECK (step >= 1),
  approver_id  text NOT NULL REFERENCES employees (id),
  role         text NOT NULL,
  decision     text NOT NULL CHECK (decision IN ('Approved','Rejected')),
  comment      text,
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, step)
);

-- A correction to a day's attendance, decided through an approval; approved, it rewrites the mark and keeps the
-- original in attendance.regularised_from.
CREATE TABLE regularisations (
  id              text PRIMARY KEY,
  employee_id     text NOT NULL REFERENCES employees (id),
  date            date NOT NULL,
  -- What was on record and what is asked for, as the queue shows them ("Absent", "P · 09:30–18:30").
  recorded        text NOT NULL,
  requested       text NOT NULL,
  reason          text NOT NULL,
  requested_mark  text NOT NULL CHECK (requested_mark IN ('P','Late','Half day','Leave','Absent','Holiday','Weekend','WFH')),
  requested_in    text CHECK (requested_in ~ '^\d{2}:\d{2}$'),
  requested_out   text CHECK (requested_out ~ '^\d{2}:\d{2}$'),
  approval_id     text,
  status          text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Withdrawn'))
);
CREATE INDEX regularisations_employee_idx ON regularisations (employee_id, date);

-- A change to an HR-approved field (legal name, address, marital status, bank account, PAN).
CREATE TABLE profile_changes (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employees (id),
  field        text NOT NULL CHECK (field IN ('Legal name','Address','Marital status','Bank account','PAN')),
  before       text NOT NULL,
  after        text NOT NULL,
  reason       text NOT NULL DEFAULT '',
  submitted    date NOT NULL,
  status       text NOT NULL CHECK (status IN ('Pending','Approved','Rejected')),
  approval_id  text
);
-- Only one pending change per field per person.
CREATE UNIQUE INDEX profile_changes_one_pending ON profile_changes (employee_id, field) WHERE status = 'Pending';

-- Timesheets. An entry is one person's hours on one project on one day; a week groups them for approval and
-- keeps a revision (with the entries as they stood) at every submit, rejection and approval.
CREATE TABLE timesheet_entries (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employees (id),
  project_id   text NOT NULL REFERENCES projects (id),
  client_id    text NOT NULL REFERENCES clients (id),
  task_id      text REFERENCES tasks (id),
  date         date NOT NULL,
  hours        numeric(4,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  billable     boolean NOT NULL DEFAULT false,
  note         text NOT NULL DEFAULT '',
  status       text NOT NULL CHECK (status IN ('Draft','Submitted','Approved','Rejected'))
);
CREATE INDEX timesheet_entries_employee_idx ON timesheet_entries (employee_id, date);
CREATE INDEX timesheet_entries_project_idx ON timesheet_entries (project_id, date);

CREATE TABLE timesheet_weeks (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employees (id),
  -- The Monday.
  week_start   date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status       text NOT NULL CHECK (status IN ('Draft','Submitted','Approved','Rejected')),
  approval_id  text,
  -- [{ at, status, totalHours, billableHours, note, entries }], appended only.
  revisions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (employee_id, week_start)
);
