-- The preview's SYNC store: the owner's chip records and automatic error records, per owner.
--
-- The database is SHARED. `tsunagi-m-preview-runs` also holds E46M3 /// MONITORING's tables, which
-- is why everything here is prefixed `m35080_` and why this file is not a bare `0001_*.sql`: wrangler
-- records applied migrations by file name in one `d1_migrations` table per database, so two
-- repositories both shipping `0001_init.sql` would each see the other's as already applied.
-- MONITORING's is `0001_monitoring_sync.sql`. Nothing in this file touches a table it did not create.
--
-- `owner` is the m3 account id the owner gate resolved for the request that wrote the row
-- (web/functions/_owner-gate/owner.ts). It is NOT NULL from the start: these tables are new, so
-- there is no legacy row to adopt and no window in which a row could be written without one. Every
-- query in web/functions/api/ carries `owner = ?`, and the indexes below are the shape they take.

CREATE TABLE m35080_sessions (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    -- When the device made the record, and when it reached here. Both kept: they differ whenever
    -- the bench had no network, and choosing one loses the other.
    created_at  INTEGER NOT NULL,
    synced_at   INTEGER NOT NULL,
    -- backup | rewrite | reset | restore (lib/domain/records.ts RecordKind), as the device says it.
    kind        TEXT NOT NULL,
    -- The short VIN (last seven characters) and the odometer decoded from the image, when readable.
    vin         TEXT,
    km          INTEGER,
    -- PRACTICE. A simulated chip listed beside real ones without saying so is worse than none.
    practice    INTEGER NOT NULL DEFAULT 0,
    parent_id   TEXT,
    note        TEXT,
    -- SHA-256 of `image`, as the device computed it; POST refuses a row whose bytes do not match.
    hash        TEXT NOT NULL,
    app_build   TEXT,
    -- The 1 KB M35080 image, exactly as read or written. The list never reads it.
    image       BLOB NOT NULL
);

CREATE INDEX m35080_sessions_owner_created ON m35080_sessions (owner, created_at DESC);

CREATE TABLE m35080_diagnostics (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    synced_at   INTEGER NOT NULL,
    -- What the link was doing (connecting, reading, writing, verifying, connected), stated by the
    -- caller: a failed connect has no image to infer it from.
    phase       TEXT NOT NULL,
    error       TEXT,
    -- transport | semantic | refused (useM35080Link ErrorKind).
    error_kind  TEXT,
    practice    INTEGER NOT NULL DEFAULT 0,
    vin         TEXT,
    km          INTEGER,
    -- The bridge firmware version, when a bridge answered.
    firmware    TEXT,
    app_build   TEXT,
    -- gzipped JSON: the image hash, the chip status bits and the progress at the moment it failed.
    payload_gz  BLOB
);

CREATE INDEX m35080_diagnostics_owner_created ON m35080_diagnostics (owner, created_at DESC);
