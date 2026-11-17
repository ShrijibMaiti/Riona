-- 014 · Talent: recruitment (jobs, candidates), onboarding and exit checklists, performance (cycles, reviews,
-- goals) and training (programmes, certifications).

CREATE TABLE jobs (
  id                 text PRIMARY KEY,
  title              text NOT NULL,
  dept               text NOT NULL,
  location           text NOT NULL,
  openings           integer NOT NULL CHECK (openings >= 0),
  status             text NOT NULL CHECK (status IN ('Open', 'On hold', 'Closed')),
  posted             date NOT NULL,
  hiring_manager_id  text NOT NULL REFERENCES employees (id)
);

CREATE TABLE candidates (
  id                 text PRIMARY KEY,
  job_id             text NOT NULL REFERENCES jobs (id),
  name               text NOT NULL,
  email              text NOT NULL,
  source             text NOT NULL,
  stage              text NOT NULL CHECK (stage IN ('Applied', 'Screening', 'Interviewing', 'Offer', 'Hired', 'Rejected')),
  applied            date NOT NULL,
  experience_years   integer NOT NULL DEFAULT 0,
  current_company    text NOT NULL DEFAULT '',
  notes              text NOT NULL DEFAULT '',
  -- [{ id, round, interviewerId, date, outcome }]
  interviews         jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX candidates_job_idx ON candidates (job_id);

CREATE TABLE onboarding_cases (
  id           text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('Joining', 'Leaving')),
  employee_id  text REFERENCES employees (id),
  person_name  text NOT NULL,
  title        text NOT NULL,
  dept         text NOT NULL,
  date         date NOT NULL
);
CREATE TABLE onboarding_items (
  id        text PRIMARY KEY,
  case_id   text NOT NULL REFERENCES onboarding_cases (id),
  position  integer NOT NULL,
  owner     text NOT NULL CHECK (owner IN ('HR', 'IT', 'Manager', 'Finance')),
  label     text NOT NULL,
  done      boolean NOT NULL DEFAULT false,
  done_on   date,
  CHECK (done = (done_on IS NOT NULL))
);
CREATE INDEX onboarding_items_case_idx ON onboarding_items (case_id, position);

CREATE TABLE review_cycles (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  period       text NOT NULL,
  stage        text NOT NULL CHECK (stage IN ('Goal setting', 'Self review', 'Manager review', 'Calibration', 'Closed')),
  self_due     date NOT NULL,
  manager_due  date NOT NULL
);
CREATE TABLE reviews (
  id               text PRIMARY KEY,
  cycle_id         text NOT NULL REFERENCES review_cycles (id),
  employee_id      text NOT NULL REFERENCES employees (id),
  reviewer_id      text NOT NULL REFERENCES employees (id),
  status           text NOT NULL CHECK (status IN ('Not started', 'Self review', 'Manager review', 'Completed')),
  rating           text CHECK (rating IN ('Exceeds expectations', 'Meets expectations', 'Below expectations')),
  self_answers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  manager_answers  jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (cycle_id, employee_id)
);
CREATE TABLE goals (
  id           text PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employees (id),
  cycle_id     text NOT NULL REFERENCES review_cycles (id),
  title        text NOT NULL,
  progress     integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  measure      text NOT NULL DEFAULT ''
);
CREATE INDEX goals_employee_idx ON goals (employee_id);

CREATE TABLE training_programmes (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('Course', 'Certification', 'Compliance')),
  mandatory        boolean NOT NULL DEFAULT false,
  validity_months  integer CHECK (validity_months > 0)
);
CREATE TABLE certifications (
  id            text PRIMARY KEY,
  programme_id  text NOT NULL REFERENCES training_programmes (id),
  employee_id   text NOT NULL REFERENCES employees (id),
  completed     date,
  expires       date,
  status        text NOT NULL CHECK (status IN ('Valid', 'Expiring', 'Expired', 'Assigned'))
);
CREATE INDEX certifications_employee_idx ON certifications (employee_id);
