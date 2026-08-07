-- 003_health.sql — the health record: disease events, varroa monitoring, veterinary products,
-- treatments and feeding.
--
-- Covers scenario §15-§17.
--
-- This is the part of the register an inspector actually asks to see, so two rules run through
-- the whole file:
--   1. Nothing is ever hard-deleted. Corrections are new rows plus an audit_logs entry (§17).
--   2. A treatment stores its own copy of the product data. See veterinary_treatments below.

-- ---------------------------------------------------------------- health_events
-- §15. One health record per hive AND per apiary, so both scopes are the same table: a nosema
-- suspicion is observed on one colony, a poisoning usually hits the whole yard at once.
-- hive_id NULL means the event concerns the apiary as a whole.
CREATE TABLE IF NOT EXISTS health_events (
    id            CHAR(36) PRIMARY KEY,
    farm_id       CHAR(36) NOT NULL,
    apiary_id     CHAR(36)     NULL,
    hive_id       CHAR(36)     NULL,
    colony_id     CHAR(36)     NULL,

    kind          ENUM('suspicion','diagnosis','symptom','vet_visit','lab_result','mortality','other')
                  NOT NULL DEFAULT 'suspicion',

    -- The diseases §15 names explicitly, plus the ones a Croatian beekeeper realistically meets.
    -- 'other' with a free-text title is always available — an unnamed disease must never be
    -- unrecordable just because our enum is short.
    disease       ENUM('varroa','american_foulbrood','european_foulbrood','nosema','chalkbrood',
                       'sacbrood','small_hive_beetle','tropilaelaps','poisoning','other') NULL,
    severity      ENUM('low','medium','high') NULL,

    observed_on   DATE         NOT NULL,
    title         VARCHAR(200) NOT NULL,
    description   TEXT             NULL,

    -- §15 "veterinarski pregledi" and "laboratorijski nalazi" — who confirmed it and under what
    -- reference. American foulbrood is notifiable in Croatia, so the register has to be able to
    -- show that the report was made and when.
    vet_name      VARCHAR(200)     NULL,
    report_number VARCHAR(120)     NULL,
    reported_on   DATE             NULL,

    -- §15 "mortalitet". Counted rather than derived from colonies.end_reason: a beekeeper reports
    -- "12 zajednica uginulo" the day it happens, and closes the individual colony records later.
    colonies_affected SMALLINT UNSIGNED NULL,
    colonies_lost     SMALLINT UNSIGNED NULL,

    resolved_on   DATE             NULL,

    created_by    CHAR(36)         NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP        NULL,

    KEY idx_health_farm_date (farm_id, observed_on),
    KEY idx_health_hive (hive_id, observed_on),
    KEY idx_health_apiary (apiary_id, observed_on),
    KEY idx_health_open (farm_id, resolved_on),
    CONSTRAINT fk_health_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_health_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_health_hive FOREIGN KEY (hive_id) REFERENCES hives (id),
    CONSTRAINT fk_health_colony FOREIGN KEY (colony_id) REFERENCES colonies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- varroa_checks
-- §16.
--
-- The two result columns are generated rather than stored by the client, so the number on the
-- graph can never drift from the counts it came from.
--
-- They are also kept apart on purpose. A sugar roll or alcohol wash gives mites per 100 bees —
-- a percentage. A natural mite fall gives mites per day, which is a completely different
-- quantity with completely different thresholds. Plotting them on one axis would produce a
-- graph that looks authoritative and means nothing, so each method feeds its own series.
CREATE TABLE IF NOT EXISTS varroa_checks (
    id              CHAR(36) PRIMARY KEY,
    farm_id         CHAR(36) NOT NULL,
    apiary_id       CHAR(36) NOT NULL,
    hive_id         CHAR(36)     NULL,   -- NULL = sample taken across the apiary

    checked_on      DATE     NOT NULL,
    method          ENUM('natural_fall','powdered_sugar','alcohol_wash','co2','other') NOT NULL,

    -- §16 "prije tretmana / nakon tretmana"
    phase           ENUM('before_treatment','after_treatment','routine') NOT NULL DEFAULT 'routine',

    bees_examined   SMALLINT UNSIGNED NULL,   -- wash / roll methods
    days_observed   TINYINT  UNSIGNED NULL,   -- natural fall: how many days the board was in
    mites_found     SMALLINT UNSIGNED NOT NULL,

    infestation_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN bees_examined IS NULL OR bees_examined = 0 THEN NULL
             ELSE ROUND(mites_found * 100.0 / bees_examined, 2) END
    ) STORED,
    mites_per_day       DECIMAL(6,2) GENERATED ALWAYS AS (
        CASE WHEN days_observed IS NULL OR days_observed = 0 THEN NULL
             ELSE ROUND(mites_found * 1.0 / days_observed, 2) END
    ) STORED,

    notes           TEXT         NULL,

    created_by      CHAR(36)     NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP    NULL,

    KEY idx_varroa_apiary_date (apiary_id, checked_on),
    KEY idx_varroa_farm_date (farm_id, checked_on),
    KEY idx_varroa_hive (hive_id, checked_on),
    CONSTRAINT fk_varroa_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_varroa_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_varroa_hive FOREIGN KEY (hive_id) REFERENCES hives (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- vmp_products
-- §17/§18 — the beekeeper's own shelf of veterinary medicinal products, reused across treatments
-- so the details are typed once and the OCR flow in §18 has somewhere to write.
--
-- Scoped per farm rather than shipped as a national catalogue: authorised products and their
-- withdrawal periods change, and a stale built-in list presented as fact would be worse than an
-- empty one the beekeeper fills from the box in their hand.
CREATE TABLE IF NOT EXISTS vmp_products (
    id                CHAR(36)     PRIMARY KEY,
    farm_id           CHAR(36)     NOT NULL,

    name              VARCHAR(200) NOT NULL,
    active_substance  VARCHAR(200)     NULL,
    manufacturer      VARCHAR(200)     NULL,
    form              VARCHAR(100)     NULL,   -- trakice, otopina, gel, dim …

    -- §17 "karenca ako je primjenjiva". NULL genuinely means "not applicable" (oxalic acid out of
    -- season, for instance) and is not the same as 0 days.
    withdrawal_days   SMALLINT UNSIGNED NULL,

    default_dose      VARCHAR(150)     NULL,
    default_method    VARCHAR(150)     NULL,
    notes             TEXT             NULL,

    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        TIMESTAMP        NULL,

    KEY idx_vmp_farm (farm_id, deleted_at),
    CONSTRAINT fk_vmp_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- veterinary_treatments
-- §17. The legally interesting table in the whole application.
--
-- The product name, substance, manufacturer and withdrawal period are COPIED here at the moment
-- of treatment instead of being read through vmp_product_id. If the beekeeper later corrects a
-- typo in the product record, or the manufacturer changes the withdrawal period on a new
-- packaging, the register must still show what was actually applied on that day. Same reasoning
-- as an invoice storing its own prices.
CREATE TABLE IF NOT EXISTS veterinary_treatments (
    id                CHAR(36)     PRIMARY KEY,
    farm_id           CHAR(36)     NOT NULL,
    apiary_id         CHAR(36)     NOT NULL,
    vmp_product_id    CHAR(36)         NULL,   -- provenance only; never read for display

    product_name      VARCHAR(200) NOT NULL,
    active_substance  VARCHAR(200)     NULL,
    manufacturer      VARCHAR(200)     NULL,
    lot_number        VARCHAR(120)     NULL,
    product_expires_on DATE            NULL,

    started_on        DATE         NOT NULL,
    ended_on          DATE             NULL,   -- NULL while the treatment is still running

    dose              VARCHAR(150)     NULL,
    application_method VARCHAR(150)    NULL,
    reason            VARCHAR(255)     NULL,

    withdrawal_days   SMALLINT UNSIGNED NULL,
    -- The date honey may be harvested again. Generated so it cannot be edited to say something
    -- the treatment dates do not support.
    withdrawal_until  DATE GENERATED ALWAYS AS (
        CASE WHEN ended_on IS NULL OR withdrawal_days IS NULL THEN NULL
             ELSE ended_on + INTERVAL withdrawal_days DAY END
    ) STORED,

    colonies_treated  SMALLINT UNSIGNED NULL,
    notes             TEXT             NULL,

    -- §17 "podaci se ne brišu fizički nakon zaključavanja evidencije". Once locked the row is
    -- read-only; a correction is a new row and an audit_logs entry that records the old value.
    locked_at         TIMESTAMP        NULL,

    created_by        CHAR(36)         NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- Present for the soft-delete convention, but the API never sets it: see the lock rule above.
    deleted_at        TIMESTAMP        NULL,

    KEY idx_treat_farm_date (farm_id, started_on),
    KEY idx_treat_apiary (apiary_id, started_on),
    KEY idx_treat_withdrawal (farm_id, withdrawal_until),
    CONSTRAINT fk_treat_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_treat_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_treat_product FOREIGN KEY (vmp_product_id) REFERENCES vmp_products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- treatment_hives
-- §17 asks for "košnice", plural, per treatment. A varroa round covers a whole apiary at once but
-- the individual hive card still has to be able to show it, which is exactly the §60 reasoning
-- applied to treatments.
CREATE TABLE IF NOT EXISTS treatment_hives (
    treatment_id  CHAR(36) NOT NULL,
    hive_id       CHAR(36) NOT NULL,
    colony_id     CHAR(36)     NULL,

    PRIMARY KEY (treatment_id, hive_id),
    KEY idx_treathive_hive (hive_id),
    CONSTRAINT fk_treathive_treatment FOREIGN KEY (treatment_id) REFERENCES veterinary_treatments (id),
    CONSTRAINT fk_treathive_hive FOREIGN KEY (hive_id) REFERENCES hives (id),
    CONSTRAINT fk_treathive_colony FOREIGN KEY (colony_id) REFERENCES colonies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- feedings
-- §12 lists prihrana among the things a worker records in the field, and §32 tracks sugar and
-- syrup as stock. Kept append-only like inspections, and offline-safe the same way: the client
-- supplies `id`, so a replayed entry collides on the primary key instead of doubling.
CREATE TABLE IF NOT EXISTS feedings (
    id            CHAR(36) PRIMARY KEY,
    farm_id       CHAR(36) NOT NULL,
    apiary_id     CHAR(36) NOT NULL,
    hive_id       CHAR(36)     NULL,   -- NULL = the whole apiary was fed

    fed_on        DATE     NOT NULL,
    feed_type     ENUM('syrup','sugar','patty','honey','pollen_substitute','other') NOT NULL,
    amount_kg     DECIMAL(7,2) NULL,
    concentration VARCHAR(60)  NULL,   -- 1:1, 3:2, …
    reason        VARCHAR(200) NULL,
    notes         TEXT         NULL,

    created_by    CHAR(36)     NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_feeding_farm_date (farm_id, fed_on),
    KEY idx_feeding_apiary (apiary_id, fed_on),
    KEY idx_feeding_hive (hive_id, fed_on),
    CONSTRAINT fk_feeding_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_feeding_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_feeding_hive FOREIGN KEY (hive_id) REFERENCES hives (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
