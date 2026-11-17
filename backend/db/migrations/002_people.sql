-- 002 · People: employees, public holidays, attendance, leave types and leave requests.
-- (Regularisations and profile changes arrive with the approval engine in Wave 4, salary in Wave 5.)

CREATE TABLE employees (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  email             text NOT NULL,
  personal_email    text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  title             text NOT NULL,
  dept              text NOT NULL CHECK (dept IN ('Leadership','Engineering','Delivery','Design','Sales','Operations','People','Finance')),
  manager_id        text REFERENCES employees (id),
  location          text NOT NULL DEFAULT '',
  -- Statutory state for Professional Tax.
  state             text NOT NULL DEFAULT 'Karnataka',
  type              text NOT NULL CHECK (type IN ('Full-time','Contract','Intern')),
  status            text NOT NULL CHECK (status IN ('Active','On leave','Probation','Inactive')),
  joined            date NOT NULL,
  dob               date,
  blood_group       text NOT NULL DEFAULT '',
  marital_status    text NOT NULL DEFAULT 'Single' CHECK (marital_status IN ('Married','Single')),
  address           text NOT NULL DEFAULT '',
  emergency         jsonb NOT NULL DEFAULT '{"name":"","relation":"","phone":""}'::jsonb,
  bank_name         text NOT NULL DEFAULT '',
  bank_ifsc         text NOT NULL DEFAULT '',
  -- The full account number; the API shows only the last four unless revealed (audited, Wave 3).
  bank_account      text NOT NULL DEFAULT '',
  pan               text NOT NULL DEFAULT '',
  uan               text NOT NULL DEFAULT '',
  billable          boolean NOT NULL DEFAULT false,
  bill_rate_paise   bigint NOT NULL DEFAULT 0 CHECK (bill_rate_paise >= 0),
  notice_days       integer NOT NULL DEFAULT 30,
  confirmation_due  date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE UNIQUE INDEX employees_email_key ON employees (lower(email));
CREATE INDEX employees_manager_idx ON employees (manager_id);

-- A staff user is linked to one employee record (001 left the column without a foreign key).
ALTER TABLE users ADD CONSTRAINT users_employee_fk FOREIGN KEY (employee_id) REFERENCES employees (id);

-- Public holidays observed by the organisation.
CREATE TABLE holidays (
  date  date PRIMARY KEY,
  name  text NOT NULL
);

-- One mark per person per day. A regularised day keeps the original mark in regularised_from.
CREATE TABLE attendance (
  id                text PRIMARY KEY,
  employee_id       text NOT NULL REFERENCES employees (id),
  date              date NOT NULL,
  mark              text NOT NULL CHECK (mark IN ('P','Late','Half day','Leave','Absent','Holiday','Weekend','WFH')),
  in_time           text CHECK (in_time ~ '^\d{2}:\d{2}$'),
  out_time          text CHECK (out_time ~ '^\d{2}:\d{2}$'),
  regularised_from  text CHECK (regularised_from IN ('P','Late','Half day','Leave','Absent','Holiday','Weekend','WFH')),
  UNIQUE (employee_id, date)
);
CREATE INDEX attendance_date_idx ON attendance (date);

CREATE TABLE leave_types (
  code               text PRIMARY KEY CHECK (code IN ('CL','SL','EL','CO','ML','PL')),
  name               text NOT NULL,
  accrual            text NOT NULL DEFAULT '',
  -- Days per financial year (annualised).
  entitlement        numeric(5,1) NOT NULL DEFAULT 0,
  carry_forward_cap  numeric(5,1),
  encashment         text NOT NULL DEFAULT '',
  applies_to         text NOT NULL DEFAULT ''
);

CREATE TABLE leave_requests (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employees (id),
  type         text NOT NULL REFERENCES leave_types (code),
  "from"       date NOT NULL,
  "to"         date NOT NULL,
  days         numeric(5,1) NOT NULL CHECK (days > 0),
  reason       text NOT NULL DEFAULT '',
  submitted    date NOT NULL,
  status       text NOT NULL CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  -- The approval that decides it (approvals arrive in Wave 4; no foreign key until then).
  approval_id  text,
  CHECK ("to" >= "from")
);
CREATE INDEX leave_requests_employee_idx ON leave_requests (employee_id, "from");
