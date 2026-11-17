-- 010 · Append-only tables. History that must never be rewritten refuses UPDATE, DELETE and TRUNCATE in the
-- database itself, so no code path (or a hand-typed query) can edit it. Corrections are new rows.
-- The audit log (Wave 2), approval decisions and workflow versions (Wave 4), the salary ledger and frozen payslips
-- (Wave 5), invoice revisions, payments and expense revisions (Wave 6).

CREATE FUNCTION riona_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege', HINT = 'Record a correction as a new row instead.';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log', 'approval_steps', 'workflow_versions', 'salary_events', 'payslips', 'invoice_revisions', 'payments', 'expense_revisions', 'stock_movements', 'lead_activity'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION riona_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION riona_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;
