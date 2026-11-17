-- 005 · Finance: invoices with their lines and the hours and claims each line bills, revisions, payments, expense
-- claims with their revisions, and budgets. Money is integer paise. Guards that need the timesheet tables (006) are
-- in 012; append-only guards in 010.

CREATE TABLE invoices (
  id              text PRIMARY KEY,
  number          text NOT NULL UNIQUE,
  client_id       text NOT NULL REFERENCES clients (id),
  issued          date NOT NULL,
  due             date NOT NULL,
  status          text NOT NULL CHECK (status IN ('Draft','Sent','Partially paid','Paid','Overdue','Void')),
  discount_paise  bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  notes           text NOT NULL DEFAULT '',
  approval_id     text,
  -- Frozen when the invoice is issued, and again on each revision: what the client was billed
  -- ({ subtotal, discount, taxable, cgst, sgst, igst, tax, total } in paise). A draft has none.
  issued_totals   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (due >= issued),
  CHECK ((status = 'Draft') OR issued_totals IS NOT NULL)
);
CREATE INDEX invoices_client_idx ON invoices (client_id);

-- The current lines. A revision replaces them; the earlier set is kept in invoice_revisions.
CREATE TABLE invoice_lines (
  id            text PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('time','expense','milestone','manual')),
  project_id    text REFERENCES projects (id),
  description   text NOT NULL,
  quantity      numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit          text NOT NULL CHECK (unit IN ('h','item')),
  rate_paise    bigint NOT NULL CHECK (rate_paise >= 0),
  -- quantity × rate, rounded to the rupee. Pre-tax.
  amount_paise  bigint NOT NULL,
  UNIQUE (invoice_id, position)
);

-- Which timesheet entries a line bills. "Billed" is derived from here, never a flag on the entry; `live` turns
-- false when the invoice is voided or the line revised away, which frees the entries to be billed again.
-- (The foreign key to timesheet_entries and the guards are added in 012.)
CREATE TABLE invoice_line_entries (
  line_id     text NOT NULL REFERENCES invoice_lines (id) ON DELETE CASCADE,
  entry_id    text NOT NULL,
  invoice_id  text NOT NULL REFERENCES invoices (id),
  live        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (line_id, entry_id)
);
-- The invariant: an hour is on at most one live invoice line.
CREATE UNIQUE INDEX invoice_line_entries_once ON invoice_line_entries (entry_id) WHERE live;

CREATE TABLE invoice_line_expenses (
  line_id     text NOT NULL REFERENCES invoice_lines (id) ON DELETE CASCADE,
  expense_id  text NOT NULL,
  invoice_id  text NOT NULL REFERENCES invoices (id),
  live        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (line_id, expense_id)
);
CREATE UNIQUE INDEX invoice_line_expenses_once ON invoice_line_expenses (expense_id) WHERE live;

-- Every issued state of a revised invoice; the first row is the invoice as first issued. Append-only (010).
CREATE TABLE invoice_revisions (
  id              bigserial PRIMARY KEY,
  invoice_id      text NOT NULL REFERENCES invoices (id),
  at              timestamptz NOT NULL DEFAULT now(),
  reason          text NOT NULL,
  -- The lines as they stood, in the API's shape (rupees).
  lines           jsonb NOT NULL,
  discount_paise  bigint NOT NULL,
  -- The invoice total (with tax) in this state: what the client portal shows as "first issued at" without
  -- reading the lines, which link to internal hours.
  total_paise     bigint NOT NULL,
  actor_id        text
);
CREATE INDEX invoice_revisions_invoice_idx ON invoice_revisions (invoice_id, id);

-- Money received. A fact: append-only (010).
CREATE TABLE payments (
  id            text PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices (id),
  date          date NOT NULL,
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  method        text NOT NULL CHECK (method IN ('NEFT','RTGS','Cheque','UPI')),
  reference     text NOT NULL DEFAULT '',
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  actor_id      text
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);

CREATE TABLE expenses (
  id             text PRIMARY KEY,
  employee_id    text NOT NULL REFERENCES employees (id),
  category       text NOT NULL CHECK (category IN ('Travel','Meals','Software','Hardware','Training','Client entertainment','Office')),
  description    text NOT NULL,
  amount_paise   bigint NOT NULL CHECK (amount_paise > 0),
  date           date NOT NULL,
  project_id     text REFERENCES projects (id),
  client_id      text REFERENCES clients (id),
  billable       boolean NOT NULL DEFAULT false,
  receipt        boolean NOT NULL DEFAULT false,
  status         text NOT NULL CHECK (status IN ('Draft','Pending','Approved','Rejected','Reimbursed')),
  submitted      date NOT NULL,
  reimbursed_on  date,
  approval_id    text
);
CREATE INDEX expenses_employee_idx ON expenses (employee_id, date);
CREATE INDEX expenses_project_idx ON expenses (project_id);

-- A reopened claim keeps what was approved before (the first row is the claim as first approved). Append-only.
CREATE TABLE expense_revisions (
  id            bigserial PRIMARY KEY,
  expense_id    text NOT NULL REFERENCES expenses (id),
  at            timestamptz NOT NULL DEFAULT now(),
  amount_paise  bigint NOT NULL,
  description   text NOT NULL,
  status        text NOT NULL,
  reason        text NOT NULL DEFAULT ''
);
CREATE INDEX expense_revisions_expense_idx ON expense_revisions (expense_id, id);

CREATE TABLE budgets (
  id               text PRIMARY KEY,
  dept             text NOT NULL,
  fy               text NOT NULL,
  planned_paise    bigint NOT NULL,
  committed_paise  bigint NOT NULL DEFAULT 0,
  -- [{ category, planned }] in rupees, as the screen shows them.
  lines            jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (dept, fy)
);
