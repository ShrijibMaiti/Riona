-- 011 · The client portal's walls, in the database.
--
-- Every portal read runs in a read-only transaction as the role riona_portal, with the client set for that
-- transaction only (http/plugins/portal-scope.ts):
--     SET LOCAL ROLE riona_portal;  SELECT set_config('riona.client_id', 'C-31', true);
-- Under that role:
--   * only client-safe COLUMNS are granted. Hours, assignees, internal notes, entry links, budgets, fees, bill
--     rates, the uploader of a document: none can be selected, even by a query that asks for them.
--   * only the client's ROWS are visible (row-level security). A query that forgets its WHERE clause still sees
--     only that client's projects, issued invoices, tickets, public messages and shared documents.
--   * no other table (employees, timesheets, salaries, sessions, audit…) is granted at all.
-- So a mistake in a portal query can return less, or fail, but can't return another client's data or internal data.
--
-- The application's own role owns these tables and is not subject to these policies; every other role (should the
-- app ever connect as a non-owner) gets the `app_all` policy, which excludes riona_portal.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'riona_portal') THEN
    CREATE ROLE riona_portal NOLOGIN NOINHERIT;
  END IF;
  -- The app connects as its own role and switches to riona_portal for portal reads.
  EXECUTE format('GRANT riona_portal TO %I', current_user);
END $$;

GRANT USAGE ON SCHEMA public TO riona_portal;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM riona_portal;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM riona_portal;

-- The client of the current portal transaction; null outside one, which matches no rows.
CREATE FUNCTION portal_client() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('riona.client_id', true), '')
$$;

-- Column grants: the client-safe columns, nothing else.
GRANT SELECT (name) ON org TO riona_portal;
GRANT SELECT (id, name, state, contacts) ON clients TO riona_portal;
GRANT SELECT (id, client_id, name, start, "end", status, phases, milestones) ON projects TO riona_portal;
-- Progress only: how many tasks, how many done. No titles, assignees, estimates or descriptions.
GRANT SELECT (project_id, status) ON tasks TO riona_portal;
GRANT SELECT (id, number, client_id, issued, due, status, issued_totals) ON invoices TO riona_portal;
GRANT SELECT (id, invoice_id, position, description, quantity, unit, rate_paise, amount_paise) ON invoice_lines TO riona_portal;
GRANT SELECT (id, invoice_id, date, amount_paise, method, reference) ON payments TO riona_portal;
GRANT SELECT (id, invoice_id, at, reason, total_paise) ON invoice_revisions TO riona_portal;
GRANT SELECT (id, client_id, project_id, subject, priority, status, opened, resolved, sla_due) ON tickets TO riona_portal;
GRANT SELECT (id, ticket_id, seq, at, author, from_client, text) ON ticket_messages TO riona_portal;
GRANT SELECT (id, owner_type, owner_id, name, type) ON documents TO riona_portal;
GRANT SELECT (document_id, version, uploaded, size, file_id) ON document_versions TO riona_portal;

-- Row policies. Each table: the portal sees its client's rows; any other non-owner role sees everything.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org', 'clients', 'projects', 'tasks', 'invoices', 'invoice_lines', 'payments', 'invoice_revisions',
                           'tickets', 'ticket_messages', 'documents', 'document_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_all ON %I USING (current_user <> ''riona_portal'') WITH CHECK (current_user <> ''riona_portal'')', t);
  END LOOP;
END $$;

CREATE POLICY portal_read ON org FOR SELECT TO riona_portal USING (true);
CREATE POLICY portal_read ON clients FOR SELECT TO riona_portal USING (id = portal_client());
CREATE POLICY portal_read ON projects FOR SELECT TO riona_portal USING (client_id = portal_client());
CREATE POLICY portal_read ON tasks FOR SELECT TO riona_portal USING (project_id IN (SELECT id FROM projects));
-- Drafts are still being prepared and void invoices were withdrawn: neither reaches the client.
CREATE POLICY portal_read ON invoices FOR SELECT TO riona_portal USING (client_id = portal_client() AND status NOT IN ('Draft', 'Void'));
CREATE POLICY portal_read ON invoice_lines FOR SELECT TO riona_portal USING (invoice_id IN (SELECT id FROM invoices));
CREATE POLICY portal_read ON payments FOR SELECT TO riona_portal USING (invoice_id IN (SELECT id FROM invoices));
CREATE POLICY portal_read ON invoice_revisions FOR SELECT TO riona_portal USING (invoice_id IN (SELECT id FROM invoices));
CREATE POLICY portal_read ON tickets FOR SELECT TO riona_portal USING (client_id = portal_client());
CREATE POLICY portal_read ON ticket_messages FOR SELECT TO riona_portal USING (NOT internal AND ticket_id IN (SELECT id FROM tickets));
CREATE POLICY portal_read ON documents FOR SELECT TO riona_portal USING (
  visible_to_client AND (
    (owner_type = 'client' AND owner_id = portal_client())
    OR (owner_type = 'project' AND owner_id IN (SELECT id FROM projects))
  )
);
CREATE POLICY portal_read ON document_versions FOR SELECT TO riona_portal USING (document_id IN (SELECT id FROM documents));

-- Online payments from the portal. The client starts one (POST /portal/invoices/:id/pay); the payment gateway
-- confirms it by signed webhook (POST /webhooks/payments), and only then is a payment recorded. An intent is
-- settled once: a repeated or late webhook changes nothing.
CREATE TABLE payment_intents (
  id            text PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices (id),
  client_id     text NOT NULL REFERENCES clients (id),
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  method        text NOT NULL CHECK (method IN ('UPI', 'NEFT')),
  status        text NOT NULL DEFAULT 'Created' CHECK (status IN ('Created', 'Captured', 'Failed')),
  -- The gateway's reference, set when it confirms.
  reference     text,
  payment_id    text REFERENCES payments (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz
);
CREATE INDEX payment_intents_invoice_idx ON payment_intents (invoice_id);
