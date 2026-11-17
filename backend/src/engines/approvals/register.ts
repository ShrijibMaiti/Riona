/**
 * Connects each kind of request to the approval engine. Called once by buildApp (and by tests that use the engine
 * directly).
 */
import { registerOutcome } from './outcomes';
import { leaveOutcome } from '../../modules/people/leave.service';
import { regularisationOutcome } from '../../modules/people/regularisations.service';
import { profileChangeOutcome } from '../../modules/people/profile-changes.service';
import { timesheetOutcome } from '../../modules/work/timesheets.service';
import { expenseOutcome } from '../../modules/finance/expenses.service';
import { invoiceOutcome } from '../../modules/finance/invoices.service';

export function registerApprovalOutcomes() {
  registerOutcome('Leave', leaveOutcome);
  registerOutcome('Regularisation', regularisationOutcome);
  registerOutcome('Profile change', profileChangeOutcome);
  registerOutcome('Timesheet', timesheetOutcome);
  registerOutcome('Expense', expenseOutcome);
  registerOutcome('Invoice', invoiceOutcome);
}
