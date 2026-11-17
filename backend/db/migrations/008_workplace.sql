-- 008 · Workplace: the asset register with allocations and reported issues, stock (with its movements), meeting
-- rooms and bookings, announcements and acknowledgements, the knowledge base, and visitors.

CREATE TABLE assets (
  id          text PRIMARY KEY,
  tag         text NOT NULL UNIQUE,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('Laptop', 'Monitor', 'Phone', 'Accessory', 'Furniture', 'Licence')),
  serial      text NOT NULL DEFAULT '',
  purchased   date NOT NULL,
  cost_paise  bigint NOT NULL CHECK (cost_paise >= 0),
  status      text NOT NULL CHECK (status IN ('Allocated', 'Available', 'Under repair', 'Retired'))
);

-- Who has held each asset, and when. An open allocation has no end date; an asset has at most one.
CREATE TABLE asset_allocations (
  id           bigserial PRIMARY KEY,
  asset_id     text NOT NULL REFERENCES assets (id),
  employee_id  text NOT NULL REFERENCES employees (id),
  "from"       date NOT NULL,
  "to"         date,
  note         text NOT NULL DEFAULT '',
  CHECK ("to" IS NULL OR "to" >= "from")
);
CREATE UNIQUE INDEX asset_allocations_open_key ON asset_allocations (asset_id) WHERE "to" IS NULL;
CREATE INDEX asset_allocations_employee_idx ON asset_allocations (employee_id) WHERE "to" IS NULL;

-- Problems the holder reported, for IT.
CREATE TABLE asset_issues (
  id              text PRIMARY KEY,
  asset_id        text NOT NULL REFERENCES assets (id),
  at              timestamptz NOT NULL DEFAULT now(),
  reported_by_id  text NOT NULL REFERENCES employees (id),
  text            text NOT NULL CHECK (length(text) BETWEEN 5 AND 2000)
);
CREATE INDEX asset_issues_asset_idx ON asset_issues (asset_id, at);

CREATE TABLE inventory_items (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  unit           text NOT NULL,
  -- Kept equal to Σ movements by the service, in the same transaction; never negative.
  stock          integer NOT NULL CHECK (stock >= 0),
  reorder_level  integer NOT NULL CHECK (reorder_level >= 0),
  location       text NOT NULL
);
-- Stock in and out. Append-only (010): a mistake is corrected by a movement the other way.
CREATE TABLE stock_movements (
  id       text PRIMARY KEY,
  item_id  text NOT NULL REFERENCES inventory_items (id),
  seq      bigserial NOT NULL,
  date     date NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('in', 'out')),
  qty      integer NOT NULL CHECK (qty > 0),
  note     text NOT NULL DEFAULT '',
  by_id    text NOT NULL REFERENCES employees (id)
);
CREATE INDEX stock_movements_item_idx ON stock_movements (item_id, seq);

CREATE TABLE rooms (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  floor      text NOT NULL,
  capacity   integer NOT NULL CHECK (capacity > 0),
  equipment  text[] NOT NULL DEFAULT '{}'
);
-- Times are "HH:MM" on the booking's date. Overlaps are refused by the service under a lock on the room.
CREATE TABLE bookings (
  id             text PRIMARY KEY,
  room_id        text NOT NULL REFERENCES rooms (id),
  date           date NOT NULL,
  start          text NOT NULL CHECK (start ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  "end"          text NOT NULL CHECK ("end" ~ '^([01]\d|2[0-3]):[0-5]\d$|^24:00$'),
  title          text NOT NULL,
  booked_by_id   text NOT NULL REFERENCES employees (id),
  CHECK ("end" > start)
);
CREATE INDEX bookings_room_date_idx ON bookings (room_id, date);

CREATE TABLE announcements (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  body          text NOT NULL,
  author_id     text NOT NULL REFERENCES employees (id),
  posted        date NOT NULL,
  pinned        boolean NOT NULL DEFAULT false,
  audience      text NOT NULL,
  requires_ack  boolean NOT NULL DEFAULT false,
  -- Who must acknowledge (the audience resolved when it was posted).
  audience_ids  text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE announcement_acks (
  announcement_id  text NOT NULL REFERENCES announcements (id),
  employee_id      text NOT NULL REFERENCES employees (id),
  seq              bigserial NOT NULL,
  at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, employee_id)
);

CREATE TABLE kb_articles (
  id         text PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  title      text NOT NULL,
  category   text NOT NULL,
  updated    date NOT NULL,
  author_id  text NOT NULL REFERENCES employees (id),
  -- [{ id, heading, body: [paragraph…] }]
  sections   jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE visitors (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  company      text NOT NULL DEFAULT '',
  host_id      text NOT NULL REFERENCES employees (id),
  date         date NOT NULL,
  expected     text NOT NULL DEFAULT '',
  checked_in   text,
  checked_out  text,
  purpose      text NOT NULL DEFAULT '',
  badge        text
);
CREATE INDEX visitors_date_idx ON visitors (date);
