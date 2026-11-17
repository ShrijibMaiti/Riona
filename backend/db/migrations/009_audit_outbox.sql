-- 009 · The write path: the audit log, in-app notifications, and the transactional outbox.
-- Every write goes through db/tx.ts, which records its audit entry and queues its side effects (notifications,
-- email) in the same transaction as the change itself: all of them commit, or none do.

-- Who changed what, when, from where. Append-only (010): no UPDATE, DELETE or TRUNCATE.
CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  -- Insertion order, for a stable sort among entries with the same timestamp.
  seq         bigserial NOT NULL UNIQUE,
  at          timestamptz NOT NULL DEFAULT now(),
  -- The employee who acted; null for the system (jobs, setup) or a portal user.
  actor_id    text,
  -- Their name at the time, so the entry still reads correctly after a rename.
  actor       text NOT NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  -- [{ field, before, after }], values as text.
  changes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ip          text NOT NULL DEFAULT '',
  request_id  text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id);

-- The bell. Written by the dispatcher after commit (engines/notifications/channels/in-app.ts).
CREATE TABLE notifications (
  id            text PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind IN ('Approval','Mention','Payroll','Contracts','System')),
  text          text NOT NULL DEFAULT '',
  href          text NOT NULL DEFAULT '',
  approval_id   text,
  actor_id      text,
  recipient_id  text NOT NULL,
  read          boolean NOT NULL DEFAULT false
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_id, at DESC);

-- Side effects waiting to happen. Inserted inside the writing transaction; the dispatcher delivers each row
-- after commit, at least once, retrying with backoff. A rolled-back write leaves no row, so nothing is sent.
CREATE TABLE outbox (
  id             bigserial PRIMARY KEY,
  topic          text NOT NULL CHECK (topic IN ('notify','email')),
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  available_at   timestamptz NOT NULL DEFAULT now(),
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text,
  dispatched_at  timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE dispatched_at IS NULL;
