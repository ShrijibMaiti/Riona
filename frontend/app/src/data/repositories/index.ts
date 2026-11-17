/**
 * The data boundary. Screens import repository functions from here and nothing below it. Each is a request to the
 * API (./http), as listed in ./http/endpoints.ts, with the signature in ./contract.ts.
 */
import { http } from './http';
import type { Repo } from './http/endpoints';

const impl: Repo = http;

export const {
  getEmployees, getEmployee, updateEmployee, revealBankAccount, getSalaryEvents, getAllSalaryEvents,
  appendSalaryEvent, getAttendance, getHolidays, getRegularisations, requestRegularisation, getLeaveTypes,
  getLeaveRequests, applyLeave, cancelLeave, getPayrollRuns, getPayrollRun, advancePayrollRun, getSalaryStructures,
  saveSalaryStructure, getFilings, getJobs, getJob, getCandidates, getCandidate, moveCandidate, getOnboarding,
  getOnboardingCase, setChecklistItem, getReviewCycles, getReviews, getReview, saveReview, getGoals, getProgrammes,
  getCertifications, createEmployee, updateMyProfile, getMyProfileChanges, requestProfileChange, getClients,
  getClient, getProjects, getProject, getTasks, getTask, updateTask, createTask, addComment, getTimesheetEntries,
  getTimesheetWeeks, saveTimesheetWeek, submitTimesheetWeek, recallTimesheetWeek, getInvoices, getInvoice,
  createInvoice, sendInvoice, recordPayment, reviseInvoice, getExpenses, getExpense, submitExpense, reopenExpense,
  getBudgets, getApprovals, decideApproval, approveMany, getNotifications, markAllNotificationsRead, getLeads,
  getLead, moveLead, getContracts, getTickets, getTicket, replyToTicket, setTicketStatus, getDocuments,
  uploadVersion, uploadFile, getDocumentUrl, getAssets, getMyAssets, reportAssetIssue, getAsset, allocateAsset, getInventory,
  moveStock, getRooms, getBookings, createBooking, getAnnouncements, acknowledge, getKbArticles, getKbArticle,
  getVisitors, checkVisitor, registerVisitor, getUsers, inviteUser, resendInvite, updateUser, getRoles, setPermission,
  getWorkflows, getWorkflow, saveWorkflow, getNotificationRules, setNotificationChannel, getAuditEvents, getMasters,
  saveMasterRow, getSystemJobs, getDashboardFacts, getDashboardBlocks, getMe, login, logout, requestPasswordReset, checkSetupToken, checkResetToken, completeReset, completeSetup, requestDemo,
  getPortalSession, getPortalProjects, getPortalProject, getPortalInvoices, getPortalInvoice, payPortalInvoice,
  getPortalTickets, getPortalTicket, raisePortalTicket, replyPortalTicket, getPortalDocuments, getPortalDocumentUrl,
} = impl;

export { ApiError } from './errors';
export type { NewEmployeeInput, SelfServicePatch, WeekRowInput, Me, SetupInput } from './contract';
export type { PortalSession, PortalProject, PortalInvoice, PortalTicket, PortalDocument } from './contract';
