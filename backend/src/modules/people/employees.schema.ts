/** Request shapes for the employee endpoints. Messages are UI copy. */
import { z } from 'zod';
import { F, opt } from '../../lib/validate';

const DEPTS = ['Leadership', 'Engineering', 'Delivery', 'Design', 'Sales', 'Operations', 'People', 'Finance'] as const;
const TYPES = ['Full-time', 'Contract', 'Intern'] as const;
const STATUSES = ['Active', 'On leave', 'Probation', 'Inactive'] as const;
export const SORTABLE = ['name', 'id', 'title', 'dept', 'location', 'joined', 'status', 'type'] as const;

/** GET /employees?search&dept&location&status&managerId&type&page&pageSize&sort&dir */
export const EmployeeFilter = z.object({
  search: opt(z.string().max(200)),
  dept: opt(z.string().max(40)),
  location: opt(z.string().max(60)),
  status: opt(z.string().max(20)),
  managerId: opt(z.string().max(40)),
  type: opt(z.string().max(20)),
  page: opt(F.page),
  pageSize: opt(F.pageSize),
  sort: opt(z.enum(SORTABLE)),
  dir: opt(z.enum(['asc', 'desc'])),
});

const phone = z.string().trim().regex(/^[+\d][\d\s-]{7,}$/, 'Enter a phone number with at least eight digits.');
const emergency = z.object({ name: F.text(120), relation: F.text(60), phone: z.string().trim().max(30) });

/** PATCH /employees/:id (HR and Admin). Bank details change only through an approved profile change. */
export const EmployeePatch = z
  .object({
    name: F.text(120).min(1, 'Enter a name.'),
    email: z.string().trim().email('Enter a valid work email.'),
    personalEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid personal email.')]),
    phone: z.union([z.literal(''), phone]),
    title: F.text(120).min(1, 'Enter a job title.'),
    dept: z.enum(DEPTS, { errorMap: () => ({ message: 'Choose a department.' }) }),
    managerId: z.string().max(40).nullable(),
    location: F.text(60),
    state: F.text(60),
    type: z.enum(TYPES),
    status: z.enum(STATUSES),
    joined: F.date,
    dob: z.union([z.literal(''), F.date]),
    bloodGroup: F.text(10),
    maritalStatus: z.enum(['Married', 'Single']),
    address: F.text(500),
    emergency,
    pan: F.text(10),
    uan: F.text(12),
    billable: z.boolean(),
    billRate: z.number().min(0, 'Enter a rate of zero or more.').max(1_000_000),
    noticeDays: z.number().int().min(0).max(365),
    confirmationDue: F.date.nullable(),
  })
  .partial()
  .strip();

/** PATCH /me/profile: the fields a person may change themselves, immediately. */
export const SelfServicePatch = z
  .object({ phone, personalEmail: z.string().trim().email('Enter a valid personal email.'), bloodGroup: F.text(10), emergency })
  .partial()
  .strip();
