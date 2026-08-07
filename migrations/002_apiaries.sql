-- 002_apiaries.sql — the field core: apiaries, hives, colonies, queens, inspections.
--
-- Covers scenario §7-§12, §14, §44, §59-§61.
--
-- The hive/colony split is deliberate and matches §58. A hive is the physical box that carries the
-- code and the QR label; a colony is the bee community living in it, which can die, swarm, be
-- merged or be replaced while the box stays. Collapsing them would make §43 (colony losses) and
-- §42 (queen line performance) impossible to answer honestly.

-- ---------------------------------------------------------------- apiaries
CREATE TABLE IF NOT EXISTS apiaries (
    id                    CHAR(36)     PRIMARY KEY,
    farm_id               CHAR(36)     NOT NULL,

    name                  VARCHAR(150) NOT NULL,
    kind                  ENUM('stationary','migratory') NOT NULL DEFAULT 'stationary',
    status                ENUM('active','planned_move','inactive') NOT NULL DEFAULT 'active',

    -- §9. DECIMAL, not FLOAT: 7 decimal places is ~11 mm, and binary floats would make two
    -- apiaries saved from the same spot compare unequal.
    location_name         VARCHAR(200)     NULL,
    address               VARCHAR(255)     NULL,
    city                  VARCHAR(120)     NULL,
    latitude              DECIMAL(10,7)    NULL,
    longitude             DECIMAL(10,7)    NULL,

    -- Free text rather than an enum: LR, AŽ, DB, nukleus and local variants differ by region, and
    -- a beekeeper must never be blocked because their hive type is not on our list.
    hive_type             VARCHAR(60)      NULL,
    established_on        DATE             NULL,

    -- §8 documentation block
    association           VARCHAR(200)     NULL,
    pasture_commissioner  VARCHAR(200)     NULL,
    permit_number         VARCHAR(100)     NULL,
    permit_expires_on     DATE             NULL,

    notes                 TEXT             NULL,

    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at            TIMESTAMP        NULL,

    KEY idx_apiaries_farm (farm_id, deleted_at),
    CONSTRAINT fk_apiaries_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- queens
-- §14. Created before hives so colonies can reference a queen.
CREATE TABLE IF NOT EXISTS queens (
    id                   CHAR(36)     PRIMARY KEY,
    farm_id              CHAR(36)     NOT NULL,

    code                 VARCHAR(60)  NOT NULL,
    year                 SMALLINT UNSIGNED NULL,
    -- The international five-year marking cycle. Stored rather than derived from the year: a
    -- beekeeper may legitimately have marked a queen off-cycle, and the record should say what is
    -- actually on the bee, not what should have been.
    marking_color        ENUM('white','yellow','red','green','blue') NULL,

    origin               VARCHAR(200)     NULL,
    breeder              VARCHAR(200)     NULL,
    line                 VARCHAR(120)     NULL,
    introduced_on        DATE             NULL,
    mated_on             DATE             NULL,

    -- 1-5 dot scales from the prototype's queen card.
    rating_productivity  TINYINT UNSIGNED NULL,
    rating_calmness      TINYINT UNSIGNED NULL,
    rating_swarming      TINYINT UNSIGNED NULL,

    status               ENUM('good','watch','replace') NOT NULL DEFAULT 'good',
    notes                TEXT             NULL,

    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           TIMESTAMP        NULL,

    UNIQUE KEY uq_queens_code (farm_id, code),
    KEY idx_queens_farm (farm_id, deleted_at),
    CONSTRAINT fk_queens_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- hives
CREATE TABLE IF NOT EXISTS hives (
    id             CHAR(36)     PRIMARY KEY,
    farm_id        CHAR(36)     NOT NULL,
    apiary_id      CHAR(36)         NULL,   -- NULL while a hive is in transit between apiaries

    code           VARCHAR(40)  NOT NULL,   -- B001, B002 …

    -- §11. Random, unguessable, and separate from the id: the QR label is a physical object that
    -- can be photographed by anyone standing near the apiary, so it must not be a key that also
    -- addresses the record in the private API.
    qr_token       CHAR(22)     NOT NULL,

    hive_type      VARCHAR(60)      NULL,
    status         ENUM('active','empty','merged','lost','sold') NOT NULL DEFAULT 'active',
    notes          TEXT             NULL,

    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP        NULL,

    UNIQUE KEY uq_hives_code (farm_id, code),
    UNIQUE KEY uq_hives_qr (qr_token),
    KEY idx_hives_apiary (apiary_id, deleted_at),
    KEY idx_hives_farm (farm_id, deleted_at),
    CONSTRAINT fk_hives_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_hives_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- colonies
-- The bee community occupying a hive over a period. Exactly one row per hive has ended_on IS NULL
-- (the current colony); everything before it is the hive's history.
CREATE TABLE IF NOT EXISTS colonies (
    id          CHAR(36)  PRIMARY KEY,
    farm_id     CHAR(36)  NOT NULL,
    hive_id     CHAR(36)  NOT NULL,
    queen_id    CHAR(36)      NULL,

    started_on  DATE      NOT NULL,
    ended_on    DATE          NULL,
    -- §43 — why the colony ended. Feeds the loss statistics; 'nonexistent' is not an option, an
    -- unexplained loss is recorded as 'unknown' rather than left blank.
    end_reason  ENUM('winter_loss','swarmed','disease','poisoning','weakened','queenless','merged','sold','unknown') NULL,

    source      VARCHAR(120)  NULL,  -- swarm, split, purchased, …
    notes       TEXT          NULL,

    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    KEY idx_colonies_hive (hive_id, ended_on),
    KEY idx_colonies_farm (farm_id),
    KEY idx_colonies_queen (queen_id),
    CONSTRAINT fk_colonies_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_colonies_hive FOREIGN KEY (hive_id) REFERENCES hives (id),
    CONSTRAINT fk_colonies_queen FOREIGN KEY (queen_id) REFERENCES queens (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- apiary_visits
-- §61 "Dan na pčelinjaku" — one round of the apiary, with the inspections recorded during it
-- hanging off it, so the closing summary can say 42/54 and name what still needs a look.
CREATE TABLE IF NOT EXISTS apiary_visits (
    id          CHAR(36)  PRIMARY KEY,
    farm_id     CHAR(36)  NOT NULL,
    apiary_id   CHAR(36)  NOT NULL,
    user_id     CHAR(36)  NOT NULL,

    started_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at    TIMESTAMP     NULL,
    notes       TEXT          NULL,

    KEY idx_visits_apiary (apiary_id, started_at),
    KEY idx_visits_open (farm_id, ended_at),
    CONSTRAINT fk_visits_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_visits_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_visits_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- hive_inspections
-- §12. Append-only: a correction is a new inspection, never an edit, because the register has to
-- show what was observed on the day.
--
-- The client generates `id` (UUIDv7) before the request leaves the phone. That is what makes the
-- offline outbox safe — replaying a queued inspection after the signal returns collides on the
-- primary key instead of creating a second copy of the same visit to the same hive.
CREATE TABLE IF NOT EXISTS hive_inspections (
    id             CHAR(36)  PRIMARY KEY,
    farm_id        CHAR(36)  NOT NULL,
    hive_id        CHAR(36)  NOT NULL,
    colony_id      CHAR(36)      NULL,
    visit_id       CHAR(36)      NULL,
    user_id        CHAR(36)  NOT NULL,

    inspected_at   TIMESTAMP NOT NULL,

    strength       ENUM('weak','medium','strong','very_strong') NULL,
    frames_bees    TINYINT UNSIGNED NULL,
    frames_brood   TINYINT UNSIGNED NULL,
    brood          ENUM('none','little','normal','plenty')      NULL,
    queen_state    ENUM('seen','eggs','not_found')              NULL,
    swarming       ENUM('none','cells','high_risk')             NULL,
    queen_cells    TINYINT UNSIGNED NULL,
    stores         ENUM('poor','good','excellent')              NULL,

    -- Set when the entry came from the §60 batch flow, so a reviewer can tell an individually
    -- observed hive from one covered by a bulk treatment round.
    is_batch       BOOLEAN   NOT NULL DEFAULT FALSE,
    notes          TEXT          NULL,

    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_inspections_hive (hive_id, inspected_at),
    KEY idx_inspections_farm_time (farm_id, inspected_at),
    KEY idx_inspections_visit (visit_id),
    CONSTRAINT fk_inspections_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_inspections_hive FOREIGN KEY (hive_id) REFERENCES hives (id),
    CONSTRAINT fk_inspections_colony FOREIGN KEY (colony_id) REFERENCES colonies (id),
    CONSTRAINT fk_inspections_visit FOREIGN KEY (visit_id) REFERENCES apiary_visits (id),
    CONSTRAINT fk_inspections_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- photos
-- §44. Polymorphic by entity_type/entity_id: photos hang off inspections now and off treatments,
-- documents and harvests in later stages, and a join table per owner would be five tables of the
-- same three columns.
CREATE TABLE IF NOT EXISTS photos (
    id           CHAR(36)     PRIMARY KEY,
    farm_id      CHAR(36)     NOT NULL,
    entity_type  VARCHAR(40)  NOT NULL,   -- 'hive_inspection', 'hive', 'apiary', …
    entity_id    CHAR(36)     NOT NULL,

    -- Path relative to the upload root, never a URL: the storage location changes between local
    -- development and the VPS, and files are served through an authenticated route (§56).
    file_path    VARCHAR(255) NOT NULL,
    mime_type    VARCHAR(80)  NOT NULL,
    size_bytes   INT UNSIGNED NOT NULL,
    width        SMALLINT UNSIGNED NULL,
    height       SMALLINT UNSIGNED NULL,
    caption      VARCHAR(255)     NULL,

    created_by   CHAR(36)         NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at   TIMESTAMP        NULL,

    KEY idx_photos_entity (entity_type, entity_id, deleted_at),
    KEY idx_photos_farm (farm_id),
    CONSTRAINT fk_photos_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
