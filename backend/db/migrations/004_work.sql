-- 004 · Work: clients, projects with their team, phases and milestones, and tasks with subtasks and comments.
-- (Timesheet entries and weeks arrive with the approval engine in Wave 4.) Money is integer paise.

CREATE TABLE clients (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  industry            text NOT NULL DEFAULT '',
  city                text NOT NULL DEFAULT '',
  -- Decides CGST+SGST (same state as the organisation) or IGST on invoices.
  state               text NOT NULL,
  gstin               text NOT NULL DEFAULT '',
  -- The account owner (an employee).
  owner_id            text REFERENCES employees (id),
  status              text NOT NULL CHECK (status IN ('Active','Inactive')),
  since               date NOT NULL,
  payment_terms_days  integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  -- [{ id, name, title, email, phone, primary }]
  contacts            jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE projects (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  code          text NOT NULL UNIQUE,
  client_id     text NOT NULL REFERENCES clients (id),
  manager_id    text REFERENCES employees (id),
  start         date NOT NULL,
  "end"         date NOT NULL,
  model         text NOT NULL CHECK (model IN ('T&M','Fixed fee')),
  -- The fixed fee; null for time and materials.
  fee_paise     bigint CHECK (fee_paise >= 0),
  budget_paise  bigint NOT NULL DEFAULT 0 CHECK (budget_paise >= 0),
  health        text NOT NULL CHECK (health IN ('On track','At risk','Off track','Completed')),
  status        text NOT NULL CHECK (status IN ('Active','Completed','On hold')),
  -- [{ id, name, date, done }]
  milestones    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ id, name, start, end, dependsOn: [] }]
  phases        jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK ("end" >= start),
  CHECK ((model = 'Fixed fee') = (fee_paise IS NOT NULL))
);
CREATE INDEX projects_client_idx ON projects (client_id);

-- Who works on a project, in what role, and how much of their time.
CREATE TABLE project_members (
  project_id   text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  employee_id  text NOT NULL REFERENCES employees (id),
  role         text NOT NULL DEFAULT '',
  -- Percent of the person's time.
  allocation   integer NOT NULL DEFAULT 100 CHECK (allocation BETWEEN 0 AND 100),
  position     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, employee_id)
);
CREATE INDEX project_members_employee_idx ON project_members (employee_id);

CREATE TABLE tasks (
  id              text PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects (id),
  title           text NOT NULL,
  status          text NOT NULL CHECK (status IN ('todo','progress','review','done')),
  priority        text NOT NULL CHECK (priority IN ('Urgent','High','Medium','Low')),
  assignee_id     text REFERENCES employees (id),
  due             date NOT NULL,
  estimate_hours  numeric(6,1) NOT NULL DEFAULT 0 CHECK (estimate_hours >= 0),
  phase_id        text,
  created         date NOT NULL,
  -- [{ id, title, done }]
  subtasks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  description     text NOT NULL DEFAULT '',
  -- Board order within a project.
  position        bigserial
);
CREATE INDEX tasks_project_idx ON tasks (project_id, position);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id);

-- Comments only ever append.
CREATE TABLE task_comments (
  id         text PRIMARY KEY,
  task_id    text NOT NULL REFERENCES tasks (id),
  author_id  text REFERENCES employees (id),
  at         timestamptz NOT NULL DEFAULT now(),
  text       text NOT NULL
);
CREATE INDEX task_comments_task_idx ON task_comments (task_id, at);
