-- Homi storage (docs/ARCHITECTURE.md "Storage", docs/PRIVACY.md "What Homi stores").
--
-- There is NO column anywhere that can hold message text (test/store/schema.test.ts proves it):
--   * every plaintext TEXT column is an HMAC/SHA-256 hex key, an opaque id without spaces, or an enum,
--     each enforced by a CHECK constraint;
--   * everything personal (settings, the whole plan aggregate, raw handles, raw chat ids, job payloads)
--     is an AES-256-GCM sealed BLOB;
--   * tables are STRICT, so a BLOB column cannot silently store TEXT and vice versa.

CREATE TABLE IF NOT EXISTS spaces (
  space_key       TEXT    PRIMARY KEY
                  CHECK (length(space_key) = 64 AND space_key NOT GLOB '*[^0-9a-f]*'),
  platform        TEXT    NOT NULL
                  CHECK (platform IN ('sim', 'terminal', 'imessage', 'local_imessage', 'telegram')),
  surface         TEXT    NOT NULL
                  CHECK (surface IN ('sim', 'terminal', 'imessage-shared', 'imessage-dedicated', 'imessage-local', 'telegram')),
  settings_blob   BLOB,                       -- sealed JSON: intro_sent, tone, tz, notice, headcount, current plan id
  space_id_sealed BLOB,                       -- sealed raw platform chat id, only for routing scheduled sends
  muted           INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),   -- tombstone after stop where Homi cannot leave
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS plans (
  plan_id   TEXT    PRIMARY KEY
            CHECK (length(plan_id) BETWEEN 1 AND 64 AND plan_id NOT GLOB '*[^!-~]*'),
  space_key TEXT    NOT NULL
            CHECK (length(space_key) = 64 AND space_key NOT GLOB '*[^0-9a-f]*'),
  state     TEXT    NOT NULL
            CHECK (state IN ('idle', 'collecting_dates', 'collecting_availability', 'date_chosen', 'collecting_details',
                             'collecting_place', 'confirmed', 'reminded', 'completed', 'purged')),
  event_at  INTEGER,
  purge_at  INTEGER,
  blob      BLOB    NOT NULL                  -- sealed JSON of the whole plan aggregate
) STRICT;
CREATE INDEX IF NOT EXISTS plans_by_space ON plans (space_key);
CREATE INDEX IF NOT EXISTS plans_by_purge ON plans (purge_at);

CREATE TABLE IF NOT EXISTS delivery (
  member_key    TEXT NOT NULL
                CHECK (length(member_key) = 64 AND member_key NOT GLOB '*[^0-9a-f]*'),
  plan_id       TEXT NOT NULL
                CHECK (length(plan_id) BETWEEN 1 AND 64 AND plan_id NOT GLOB '*[^!-~]*'),
  handle_sealed BLOB NOT NULL,                -- sealed raw phone / handle, for opt-in DMs and calls only
  PRIMARY KEY (member_key, plan_id)
) STRICT;
CREATE INDEX IF NOT EXISTS delivery_by_plan ON delivery (plan_id);

CREATE TABLE IF NOT EXISTS jobs (
  job_key    TEXT    PRIMARY KEY
             CHECK (length(job_key) BETWEEN 1 AND 160 AND job_key NOT GLOB '*[^!-~]*'),
  plan_id    TEXT    NOT NULL
             CHECK (length(plan_id) BETWEEN 1 AND 64 AND plan_id NOT GLOB '*[^!-~]*'),
  kind       TEXT    NOT NULL
             CHECK (kind IN ('availability_nudge', 'availability_escalate', 'availability_deadline', 'bridge_timeout',
                             'dates_nudge', 'dates_abandon', 'details_nudge', 'hungry_deadline', 'remind_day',
                             'remind_hour', 'remind_30', 'complete', 'purge', 'ext')),
  due_at     INTEGER NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'firing', 'done', 'failed')),
  payload    BLOB,                            -- sealed JSON; never personal data
  claimed_at INTEGER                          -- set when pending -> firing (at-most-once recovery)
) STRICT;
CREATE INDEX IF NOT EXISTS jobs_by_due ON jobs (status, due_at);
CREATE INDEX IF NOT EXISTS jobs_by_plan ON jobs (plan_id);

CREATE TABLE IF NOT EXISTS seen (
  msg_hash TEXT    PRIMARY KEY
           CHECK (length(msg_hash) = 64 AND msg_hash NOT GLOB '*[^0-9a-f]*'),   -- SHA-256 of surface+chat+message id
  seen_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS seen_by_time ON seen (seen_at);
