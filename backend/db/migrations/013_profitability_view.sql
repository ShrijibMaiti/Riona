-- 013 · The profitability cost view. Its source of truth is db/views/profitability.sql; this copy is what the
-- migration runner applies. To change the view, add a new migration that runs CREATE OR REPLACE VIEW again.

CREATE OR REPLACE VIEW entry_costs AS
SELECT e.id AS entry_id, e.employee_id, e.project_id, e.client_id, e.date, e.hours, e.billable, e.status,
       floor(COALESCE(c.ctc_paise, 0)::float8 / 100 * 1.4 / 12 / 140 + 0.5) AS cost_rate
FROM timesheet_entries e
LEFT JOIN LATERAL (
  -- The CTC in force for the entry's month: the latest CTC event effective in or before it.
  SELECT s.ctc_paise FROM salary_events s
  WHERE s.employee_id = e.employee_id AND s.ctc_paise IS NOT NULL AND to_char(s.effective, 'YYYY-MM') <= to_char(e.date, 'YYYY-MM')
  ORDER BY s.effective DESC, s.seq DESC
  LIMIT 1
) c ON true;
