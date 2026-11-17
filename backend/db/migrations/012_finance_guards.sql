-- 012 · Billing guards, in the database so no code path can break them. They need the timesheet tables (006),
-- hence a migration of their own after them.

ALTER TABLE invoice_line_entries ADD CONSTRAINT invoice_line_entries_entry_fk FOREIGN KEY (entry_id) REFERENCES timesheet_entries (id);
ALTER TABLE invoice_line_expenses ADD CONSTRAINT invoice_line_expenses_expense_fk FOREIGN KEY (expense_id) REFERENCES expenses (id);

-- An entry can be billed only if it is approved and belongs to the invoice's client; a time line also needs it to
-- be billable. (A fixed-fee milestone line references every entry in its period, billable or not, for tracing.)
CREATE FUNCTION riona_billable_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timesheet_entries e
    JOIN invoices i ON i.id = NEW.invoice_id
    JOIN invoice_lines l ON l.id = NEW.line_id
    WHERE e.id = NEW.entry_id AND e.status = 'Approved' AND e.client_id = i.client_id AND (e.billable OR l.kind <> 'time')
  ) THEN
    RAISE EXCEPTION 'Entry % is not approved billable time for this client', NEW.entry_id
      USING ERRCODE = 'check_violation', HINT = 'invoice.entry_not_billable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_line_entries_billable BEFORE INSERT ON invoice_line_entries FOR EACH ROW EXECUTE FUNCTION riona_billable_entry_guard();

-- An hour on a live invoice line can't change its hours, project, billability or status, or be deleted.
CREATE FUNCTION riona_billed_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoice_line_entries WHERE entry_id = OLD.id AND live)
     AND (TG_OP = 'DELETE' OR NEW.hours <> OLD.hours OR NEW.project_id <> OLD.project_id OR NEW.billable <> OLD.billable OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'Entry % is on an invoice and can''t change', OLD.id USING ERRCODE = 'restrict_violation', HINT = 'invoice.entry_billed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER timesheet_entries_billed BEFORE UPDATE OR DELETE ON timesheet_entries FOR EACH ROW EXECUTE FUNCTION riona_billed_entry_guard();

-- An invoice's frozen total can never fall below what has been paid against it.
CREATE FUNCTION riona_invoice_paid_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint;
BEGIN
  IF NEW.issued_totals IS NOT NULL THEN
    SELECT COALESCE(sum(amount_paise), 0) INTO paid FROM payments WHERE invoice_id = NEW.id;
    IF (NEW.issued_totals->>'total')::bigint < paid THEN
      RAISE EXCEPTION 'Invoice % total is below what has been paid', NEW.id USING ERRCODE = 'check_violation', HINT = 'invoice.below_paid';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_paid_guard BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION riona_invoice_paid_guard();

-- And a payment can't take the paid amount past the frozen total, nor be recorded against an unissued invoice.
CREATE FUNCTION riona_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; paid bigint;
BEGIN
  SELECT (issued_totals->>'total')::bigint INTO total FROM invoices WHERE id = NEW.invoice_id;
  IF total IS NULL THEN
    RAISE EXCEPTION 'Invoice % has not been issued', NEW.invoice_id USING ERRCODE = 'check_violation', HINT = 'invoice.not_issued';
  END IF;
  SELECT COALESCE(sum(amount_paise), 0) INTO paid FROM payments WHERE invoice_id = NEW.invoice_id;
  IF paid > total THEN
    RAISE EXCEPTION 'Payments on invoice % exceed its total', NEW.invoice_id USING ERRCODE = 'check_violation', HINT = 'invoice.overpaid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_total_guard AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION riona_payment_guard();
