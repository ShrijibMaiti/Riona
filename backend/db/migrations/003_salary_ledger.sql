-- 003 · Salary and payroll. The salary ledger is append-only (guard in 010): a hire, revision, promotion, bonus,
-- deduction or correction is a new event, never an edit, so any month's payslip can be rebuilt exactly as it stood.
-- Money is integer paise.

CREATE TABLE salary_events (
  id            text PRIMARY KEY,
  -- Insertion order, to break ties between events with the same dates.
  seq           bigserial NOT NULL UNIQUE,
  employee_id   text NOT NULL REFERENCES employees (id),
  type          text NOT NULL CHECK (type IN ('Hired','Revised','Promotion','Bonus','Correction','Deduction')),
  -- First month the event is effective for (always the 1st).
  effective     date NOT NULL CHECK (extract(day FROM effective) = 1),
  -- When it was written to the ledger. Recorded after a month's lock (the 25th), it reaches that month's payslip
  -- only "as corrected"; "as paid" it arrives in the next run.
  recorded      date NOT NULL,
  -- New annual CTC (Hired, Revised, Promotion).
  ctc_paise     bigint CHECK (ctc_paise > 0),
  -- One-time amount (Bonus, Deduction), or the monthly uplift for each month in applies_to (Correction).
  amount_paise  bigint CHECK (amount_paise > 0),
  -- Correction only: the months (YYYY-MM) it applies to, and the component it corrects.
  applies_to    text[],
  component     text CHECK (component IN ('HRA','Special allowance')),
  actor_id      text,
  note          text NOT NULL DEFAULT '',
  title         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((type IN ('Hired','Revised','Promotion')) = (ctc_paise IS NOT NULL)),
  CHECK ((type IN ('Bonus','Deduction','Correction')) = (amount_paise IS NOT NULL)),
  CHECK ((type = 'Correction') = (applies_to IS NOT NULL AND component IS NOT NULL))
);
CREATE INDEX salary_events_employee_idx ON salary_events (employee_id, effective);
-- One hire per person.
CREATE UNIQUE INDEX salary_events_one_hire ON salary_events (employee_id) WHERE type = 'Hired';

-- One run per month. Its inputs (who, which events, which attendance) are fixed once it leaves Inputs; a
-- Disbursed run is closed and never changes (guard below).
CREATE TABLE payroll_runs (
  id                text PRIMARY KEY,
  month             text NOT NULL UNIQUE CHECK (month ~ '^\d{4}-\d{2}$'),
  stage             text NOT NULL CHECK (stage IN ('Inputs','Review','Approved','Disbursed')),
  lock_date         date NOT NULL,
  disbursed_on      date,
  employee_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,
  salary_event_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  attendance_from   date NOT NULL,
  attendance_to     date NOT NULL,
  bank_file_issues  jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK ((stage = 'Disbursed') = (disbursed_on IS NOT NULL))
);

-- What each person was paid in a disbursed run, frozen at disbursement (append-only, guard in 010). The payslip
-- shown "as paid" for a closed month is this, not a recomputation.
CREATE TABLE payslips (
  run_id       text NOT NULL REFERENCES payroll_runs (id),
  employee_id  text NOT NULL REFERENCES employees (id),
  month        text NOT NULL,
  -- The run line: the payslip plus loss-of-pay days, PF, ESI, PT, TDS and net as paid.
  slip         jsonb NOT NULL,
  net_paise    bigint NOT NULL,
  frozen_at    date NOT NULL,
  PRIMARY KEY (run_id, employee_id)
);
CREATE INDEX payslips_employee_idx ON payslips (employee_id, month);

CREATE TABLE salary_structures (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  applies_to  text NOT NULL DEFAULT '',
  -- [{ id, name, kind, formula, taxable }]
  components  jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE statutory_filings (
  id         text PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('PF','ESI','PT','TDS')),
  period     text NOT NULL,
  due        date NOT NULL,
  filed_on   date,
  reference  text
);

-- A closed (disbursed) run never changes: no edits, no deletes. Moving into Disbursed is the last change allowed.
CREATE FUNCTION riona_closed_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stage = 'Disbursed' THEN
    RAISE EXCEPTION 'Payroll run % is disbursed and closed: % is not allowed', OLD.month, TG_OP
      USING ERRCODE = 'insufficient_privilege', HINT = 'payroll.run_closed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER payroll_runs_closed BEFORE UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION riona_closed_run_guard();
