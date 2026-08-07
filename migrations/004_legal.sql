-- 004_legal.sql — legal obligations, their per-farm instances, the document archive and the
-- notification centre.
--
-- Covers scenario §22, §23, §24, §53, §54.
--
-- §54 is an architectural requirement, not a feature: "Zakonski rokovi i zahtjevi ne smiju biti
-- hard-coded". Every deadline, reminder interval, legal basis and warning text in this
-- application is a row in legal_obligations that an administrator can edit. Croatian and EU rules
-- change; the source code must not have to.

-- ---------------------------------------------------------------- legal_obligations
-- The RULE. System-wide, no farm_id — one row describes an obligation for everybody it applies to.
CREATE TABLE IF NOT EXISTS legal_obligations (
    id                  CHAR(36)     PRIMARY KEY,

    -- Stable machine name. The forms module (§25) looks up its template by this, so it may be
    -- renamed for display but not repurposed.
    code                VARCHAR(60)  NOT NULL,

    name                VARCHAR(200) NOT NULL,
    legal_basis         VARCHAR(300)     NULL,   -- §54 "pravni temelj"
    description         TEXT             NULL,
    warning_text        TEXT             NULL,   -- §54 "tekst upozorenja"

    -- Two shapes of obligation, because §23 shows both:
    --   deadline   — "Godišnja dojava, rok 1.12."  → a date, a status, a reminder ladder
    --   continuous — "Evidencija VMP, status 🟢 uredno, posljednji unos 12.08." → no deadline at
    --                all; the status is derived from whether records are still being written.
    kind                ENUM('deadline','continuous') NOT NULL DEFAULT 'deadline',

    -- deadline rules ------------------------------------------------
    recurrence          ENUM('annual','once') NOT NULL DEFAULT 'annual',
    -- The window during which it can be filed (§23 "Razdoblje 1.9. – 31.12."). NULL start means
    -- it can be filed any time up to the deadline.
    window_start_month  TINYINT UNSIGNED NULL,
    window_start_day    TINYINT UNSIGNED NULL,
    due_month           TINYINT UNSIGNED NULL,
    due_day             TINYINT UNSIGNED NULL,
    -- For recurrence='once' — a fixed calendar date rather than a repeating month/day.
    fixed_due_on        DATE             NULL,

    -- §24. JSON rather than six columns so an administrator can add or drop a step without a
    -- schema change, which is exactly what §54 asks for.
    reminder_days       JSON             NULL,   -- [60, 30, 14, 7, 3, 0]

    -- continuous rules ----------------------------------------------
    -- Which register has to keep receiving entries, and how long a gap is tolerated before the
    -- status drops from 🟢 to 🟡.
    continuous_source   ENUM('vmp_treatments','varroa_checks','inspections','health_events') NULL,
    continuous_max_days SMALLINT UNSIGNED NULL,

    -- applicability (§54 "skupinu korisnika na koju se odnosi") -------
    applies_to          ENUM('all','registered_epp','migratory','honey_producer','food_business')
                        NOT NULL DEFAULT 'all',
    min_colonies        SMALLINT UNSIGNED NULL,

    -- §25 / §54 — which generated form and attachments belong to it.
    form_code           VARCHAR(60)      NULL,
    required_attachments JSON            NULL,   -- ["Preslika rješenja", …]
    document_category   VARCHAR(60)      NULL,   -- where the filed proof is archived (§22)

    active              BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order          SMALLINT     NOT NULL DEFAULT 100,

    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_obligations_code (code),
    KEY idx_obligations_active (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- user_obligations
-- The INSTANCE: this farm, this obligation, this year. Materialised by the engine in
-- backend/src/lib/obligations.ts.
--
-- The unique key is what makes that engine safe to run on every request and every scheduler tick
-- — a second run collides instead of creating a duplicate row.
CREATE TABLE IF NOT EXISTS user_obligations (
    id               CHAR(36)  PRIMARY KEY,
    farm_id          CHAR(36)  NOT NULL,
    obligation_id    CHAR(36)  NOT NULL,

    period_year      SMALLINT UNSIGNED NOT NULL,
    window_start     DATE          NULL,
    -- Resolved from the rule when the row was created. Kept as a column rather than recomputed on
    -- read so that an administrator moving next year's deadline does not silently rewrite the
    -- history of what this farm was told last year.
    due_on           DATE      NOT NULL,

    status           ENUM('pending','in_progress','submitted','not_applicable') NOT NULL DEFAULT 'pending',
    submitted_on     DATE          NULL,
    reference_number VARCHAR(150)  NULL,
    document_id      CHAR(36)      NULL,   -- FK added after documents exists, see below
    notes            TEXT          NULL,

    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_obligation (farm_id, obligation_id, period_year),
    KEY idx_user_obligations_due (farm_id, status, due_on),
    CONSTRAINT fk_user_obligations_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_user_obligations_rule FOREIGN KEY (obligation_id) REFERENCES legal_obligations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- documents
-- §22. Categories are the ones the scenario lists, as an ENUM rather than free text so the
-- archive stays navigable — a category typed three different ways is three empty folders.
CREATE TABLE IF NOT EXISTS documents (
    id               CHAR(36)     PRIMARY KEY,
    farm_id          CHAR(36)     NOT NULL,

    category         ENUM('registration','annual_report','pasture','veterinary','food_safety',
                          'laboratory','subsidy','other') NOT NULL DEFAULT 'other',
    title            VARCHAR(255) NOT NULL,
    description      TEXT             NULL,

    -- Same rule as photos (§56): a relative path, never a URL, and every read goes through an
    -- authenticated route. A scanned rješenje carries an OIB and a home address.
    file_path        VARCHAR(255)     NULL,
    file_name        VARCHAR(255)     NULL,
    mime_type        VARCHAR(100)     NULL,
    size_bytes       INT UNSIGNED     NULL,

    issued_on        DATE             NULL,
    expires_on       DATE             NULL,   -- drives the "ističe za N dana" warnings
    reference_number VARCHAR(150)     NULL,
    issuer           VARCHAR(200)     NULL,

    -- Optional link to what the document belongs to (an apiary's suglasnost, a treatment's
    -- receipt). Polymorphic for the same reason photos is.
    entity_type      VARCHAR(40)      NULL,
    entity_id        CHAR(36)         NULL,

    created_by       CHAR(36)         NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP        NULL,

    KEY idx_documents_farm (farm_id, category, deleted_at),
    KEY idx_documents_expiry (farm_id, expires_on),
    KEY idx_documents_entity (entity_type, entity_id),
    CONSTRAINT fk_documents_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE user_obligations
    ADD CONSTRAINT fk_user_obligations_document FOREIGN KEY (document_id) REFERENCES documents (id);

-- ---------------------------------------------------------------- notifications
-- §24 and §53.
--
-- dedupe_key is the load-bearing column. The scheduler re-evaluates every farm on every tick, so
-- without it the 14-day warning would be re-created every hour until the deadline passed. The key
-- encodes what the notification is about AND which threshold produced it —
-- "obligation:<id>:14" — so each step of the ladder fires exactly once.
CREATE TABLE IF NOT EXISTS notifications (
    id           CHAR(36)     PRIMARY KEY,
    farm_id      CHAR(36)     NOT NULL,
    -- NULL means "everyone on this farm". Set only for things that concern one person.
    user_id      CHAR(36)         NULL,

    kind         VARCHAR(60)  NOT NULL,   -- obligation_due, varroa_due, withdrawal_end, queen_age …
    severity     ENUM('critical','warning','caution','ok','info') NOT NULL DEFAULT 'info',

    title        VARCHAR(200) NOT NULL,
    body         TEXT             NULL,
    -- In-app route, e.g. /obveze/<id>. Relative on purpose: the app is served under a base path
    -- that differs between development and production.
    link         VARCHAR(255)     NULL,

    entity_type  VARCHAR(40)      NULL,
    entity_id    CHAR(36)         NULL,

    dedupe_key   VARCHAR(190) NOT NULL,

    read_at      TIMESTAMP        NULL,
    -- Set once a channel outside the app has actually taken it (§24: email, push). Left NULL by
    -- the current build — delivery is wired up in the deployment stage, and a column that claimed
    -- otherwise would be a lie in the register.
    delivered_at TIMESTAMP        NULL,

    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_notifications_dedupe (farm_id, dedupe_key),
    KEY idx_notifications_unread (farm_id, read_at, created_at),
    CONSTRAINT fk_notifications_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- seed
-- The obligations named in §23, and nothing beyond them.
--
-- These are starting values, not a legal reference. They are seeded so the module is usable on
-- day one, and every field is editable in the admin screen precisely because the application must
-- not be the authority on what the law currently says (§55).
--
-- UUIDs are fixed literals rather than generated: re-running the migration on a database that
-- already has them must not create a second copy, and the ON DUPLICATE KEY guard below only works
-- against a stable key.
INSERT INTO legal_obligations
    (id, code, name, legal_basis, description, warning_text, kind, recurrence,
     window_start_month, window_start_day, due_month, due_day, reminder_days,
     continuous_source, continuous_max_days, applies_to, form_code, document_category, sort_order)
VALUES
    ('01900000-0000-7000-8000-000000000001', 'annual_colony_report',
     'Godišnja dojava broja pčelinjih zajednica',
     'Pravilnik o držanju pčela i katastru pčelinje paše',
     'Prijava broja pčelinjih zajednica po pčelinjaku za tekuću godinu.',
     'Dojava se podnosi nadležnom tijelu. Provjerite aktualni rok i način podnošenja.',
     'deadline', 'annual', 9, 1, 12, 31, JSON_ARRAY(60, 30, 14, 7, 3, 0),
     NULL, NULL, 'all', 'annual_colony_report', 'annual_report', 10),

    ('01900000-0000-7000-8000-000000000002', 'annual_production_report',
     'Godišnja dojava proizvodnih pokazatelja',
     'Pravilnik o držanju pčela i katastru pčelinje paše',
     'Prijava proizvodnih pokazatelja pčelarskog gospodarstva za tekuću godinu.',
     'Rok je vezan uz kraj godine. Provjerite aktualni rok kod nadležnog tijela.',
     'deadline', 'annual', 9, 1, 12, 1, JSON_ARRAY(60, 30, 14, 7, 3, 0),
     NULL, NULL, 'all', 'annual_production_report', 'annual_report', 20),

    ('01900000-0000-7000-8000-000000000003', 'vmp_register',
     'Evidencija primjene veterinarsko-medicinskih proizvoda',
     'Zakon o veterinarsko-medicinskim proizvodima',
     'Kronološka evidencija svih primijenjenih VMP-a s LOT brojem, dozom i karencom.',
     'Evidencija se čuva i predočava na zahtjev nadležne osobe.',
     'continuous', 'annual', NULL, NULL, NULL, NULL, NULL,
     'vmp_treatments', 365, 'all', NULL, 'veterinary', 30)
ON DUPLICATE KEY UPDATE id = id;
