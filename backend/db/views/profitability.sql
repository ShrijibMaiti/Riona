-- The cost side of profitability, as a view (applied by migration 013). Cost rates derive from salaries, so they are
-- computed here, in the database, and only aggregated figures leave the API (Admin only).
--
-- entry_costs: one row per timesheet entry with its estimated cost.
--   cost_rate = round(annual CTC in force that month × 1.4 overhead ÷ 12 ÷ 140 productive hours), in rupees
-- Computed in double precision with round-half-up, exactly as the frontend's selector (selectors/payroll.ts
-- costRate) does in JavaScript, so both give the same rupee. Revenue attribution (an entry's share of the invoice
-- lines that bill it) depends on the period asked for, so modules/finance/profitability.service.ts does that part.

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
