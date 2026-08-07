-- 006_commerce.sql — sales, customers, expenses, pastures, relocations, subsidies and the
-- seasonal calendar.
--
-- Covers scenario §19-§21, §37-§43 and §50-§51. The analytics (§40-§43), the timeline (§48), the
-- annual report (§49) and the search (§52) add no tables at all: every figure they show is derived
-- from rows that already exist, and a stored copy of a derived figure is a second answer waiting
-- to disagree with the first.
--
-- Three rules shape this file. The first two continue 005; the third is new and is the reason this
-- migration exists at all rather than a few columns bolted onto 005.
--
--   1. A QUANTITY IS STORED IN EXACTLY ONE PLACE. Same rule as 005, applied one level further
--      down: 005 tracked bulk honey (total → packed → available), and this file tracks the jars
--      that packing produced (jar_count → sold → remaining). A sale of jars must NOT touch
--      honey_batches — that honey was already deducted when it was packed, and deducting it again
--      would make the LOT run out at half its real size.
--
--   2. MONEY IS DERIVED, NEVER STORED TWICE. A sale has no `total` column; it is the sum of its
--      lines. A line has no `honey_kg` column; it is the jar count times the run's jar size. Both
--      are one SQL expression each, written once in lib/commerce.ts.
--
--   3. FINANCIAL TABLES ARE OWNER-ONLY AND INVISIBLE TO INSPEKCIJA MOD. §4: a worker "ne može
--      pristupati financijskim izvještajima". §26: the screen handed to an inspector shows
--      documents "bez prikaza osobnih financijskih podataka". Every table below that carries a
--      price, a cost or a customer is served exclusively behind requireOwner, and routes/
--      inspection.ts does not read any of them. That is a property of the SELECT lists, not of the
--      user interface — the same reasoning as the §35 public jar page in 005.

-- ================================================================ jars as stock (§37 × §33)
--
-- The counterpart of honey_batches.packed_kg / available_kg, for the level below it.
--
-- sold_count is a maintained running total rather than SUM(sale_items) computed on demand. That is
-- a deliberate denormalisation and it buys two things: the row that gets SELECT … FOR UPDATE'd
-- during a sale is the same row that carries the counter, so the check and the decrement cannot
-- drift apart under two concurrent sales; and remaining_count can be GENERATED, so "how many jars
-- are left" has exactly one definition that every screen reads.
--
-- Guarded against re-application: MySQL has no ADD COLUMN IF NOT EXISTS, and a migration that
-- fails halfway must stay re-runnable.
SET @has_sold := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packaging_batches' AND COLUMN_NAME = 'sold_count'
);
SET @sql := IF(@has_sold = 0,
    'ALTER TABLE packaging_batches
       ADD COLUMN sold_count      INT UNSIGNED NOT NULL DEFAULT 0 AFTER jar_count,
       ADD COLUMN remaining_count BIGINT GENERATED ALWAYS AS (jar_count - sold_count) STORED AFTER sold_count',
    'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================================ bulk honey leaves the LOT too
--
-- 005 modelled exactly one way for honey to leave a batch: being packed into jars. Selling honey
-- in bulk — a canister to a neighbour, a barrel to a buyer — is the other way, and it is how a
-- large part of a Croatian crop actually moves.
--
-- It gets its own column rather than being added to packed_kg. §29's batch card reads "Pakirano
-- 185 kg / Na skladištu 101 kg"; folding a 50 kg barrel into "pakirano" would make that line claim
-- jars that were never filled. Two different exits from the same pile, two counters, and
-- available_kg subtracts both — which keeps rule 1 intact: the remaining quantity still has
-- exactly one definition.
SET @has_bulk := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'honey_batches' AND COLUMN_NAME = 'sold_bulk_kg'
);
SET @sql := IF(@has_bulk = 0,
    'ALTER TABLE honey_batches
       ADD COLUMN sold_bulk_kg DECIMAL(9,2) NOT NULL DEFAULT 0 AFTER packed_kg,
       MODIFY COLUMN available_kg DECIMAL(10,2)
              GENERATED ALWAYS AS (total_kg - packed_kg - sold_bulk_kg) STORED',
    'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- §51 — "Arhiva računa". Receipts belong in the §22 archive like every other document, so they are
-- reachable from the same screen and covered by the same authenticated file route (§56). They need
-- their own category because filing a fuel receipt under "ostalo" makes the archive unnavigable,
-- which is the exact failure the ENUM in 004 was chosen to prevent.
--
-- MODIFY is naturally idempotent: setting the column to a definition it already has is a no-op.
ALTER TABLE documents
    MODIFY COLUMN category ENUM('registration','annual_report','pasture','veterinary','food_safety',
                                'laboratory','subsidy','receipt','other') NOT NULL DEFAULT 'other';

-- ---------------------------------------------------------------- customers
-- §38 — the address book.
--
-- Holds an OIB and a home address for private buyers, which puts it squarely inside §56's "posebno
-- zaštititi". Owner-only, never joined into an inspection or public query, and it is the reason
-- sale rows reference a customer by id instead of copying a name onto every line.
CREATE TABLE IF NOT EXISTS customers (
    id             CHAR(36)     PRIMARY KEY,
    farm_id        CHAR(36)     NOT NULL,

    -- §38 lists "fizičke osobe, trgovine, restorani, distributeri"; company covers the rest of the
    -- business buyers (a wholesaler, a co-operative) without inventing a category per trade.
    kind           ENUM('person','company','shop','restaurant','distributor') NOT NULL DEFAULT 'person',
    name           VARCHAR(200) NOT NULL,

    -- §38 "Za poslovne kupce: naziv, OIB, adresa, kontakt, email". Not required, because a market
    -- stall sale to a private buyer has none of it and forcing the field would mean the sale goes
    -- unrecorded.
    oib            CHAR(11)         NULL,
    address        VARCHAR(255)     NULL,
    city           VARCHAR(120)     NULL,
    postal_code    VARCHAR(20)      NULL,
    contact_person VARCHAR(200)     NULL,
    phone          VARCHAR(60)      NULL,
    email          VARCHAR(255)     NULL,

    notes          TEXT             NULL,
    active         BOOLEAN      NOT NULL DEFAULT TRUE,

    created_by     CHAR(36)         NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP        NULL,

    KEY idx_customer_farm (farm_id, deleted_at),
    KEY idx_customer_name (farm_id, name),
    CONSTRAINT fk_customer_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- sales
-- §37 — the sale itself: who, when, how paid. What was sold lives in sale_items.
--
-- No total column. §37's "Ukupno: 144 €" is SUM(sale_items.line_total), and a stored copy would be
-- the number that stops matching the moment a line is corrected — on the one screen where a
-- beekeeper is least likely to re-check the arithmetic.
CREATE TABLE IF NOT EXISTS sales (
    id              CHAR(36)     PRIMARY KEY,
    farm_id         CHAR(36)     NOT NULL,
    -- NULL for an anonymous market sale, which is most of them.
    customer_id     CHAR(36)         NULL,

    sold_on         DATE         NOT NULL,
    channel         ENUM('direct','market','shop','restaurant','distributor','online','other')
                    NOT NULL DEFAULT 'direct',

    document_number VARCHAR(60)      NULL,   -- broj računa, when one was issued
    payment         ENUM('cash','transfer','card','other') NOT NULL DEFAULT 'cash',
    paid            BOOLEAN      NOT NULL DEFAULT TRUE,

    notes           TEXT             NULL,

    created_by      CHAR(36)         NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP        NULL,

    KEY idx_sale_farm (farm_id, sold_on),
    KEY idx_sale_customer (customer_id, sold_on),
    CONSTRAINT fk_sale_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_sale_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- sale_items
-- One line of a sale. §37 shows a single-product example; a delivery to a shop is "20 × 450 g
-- kadulja + 10 × 720 g bagrem" on one receipt, and splitting that into two sales would make the
-- receipt total unreproducible and count the buyer twice in §38.
--
-- `kind` decides which stock the line draws from, and there are genuinely three cases:
--
--   jars  — from a packaging run. Draws down packaging_batches.sold_count. This is §37's example.
--   bulk  — rinfuza straight out of a LOT, sold by the kilogram to a wholesaler or a neighbour.
--           Draws down honey_batches.packed_kg, because leaving the barrel counts as packing it
--           out of the batch as surely as filling jars does.
--   other — wax, propolis, a nucleus colony, a queen. No honey stock behind it, so nothing moves.
--
-- There is no honey_kg column: for jars it is quantity × the run's jar_size_g, for bulk it is the
-- quantity itself. Deriving it means editing a run's jar size can never leave a stale figure
-- behind on a sale (rule 2).
CREATE TABLE IF NOT EXISTS sale_items (
    id           CHAR(36)      PRIMARY KEY,
    sale_id      CHAR(36)      NOT NULL,

    kind         ENUM('jars','bulk','other') NOT NULL DEFAULT 'jars',
    packaging_id CHAR(36)          NULL,   -- kind = 'jars'
    batch_id     CHAR(36)          NULL,   -- kind = 'bulk'

    -- What the buyer would recognise on a receipt, snapshotted at the time of sale. A product may
    -- be renamed later; the receipt that was handed over may not change with it.
    description  VARCHAR(200)  NOT NULL,

    -- Jars when kind = 'jars', kilograms when kind = 'bulk', whatever the unit says otherwise.
    quantity     DECIMAL(11,3) NOT NULL,
    unit         VARCHAR(20)   NOT NULL DEFAULT 'kom',
    unit_price   DECIMAL(10,2) NOT NULL,   -- §37 "Cijena: 12 €/kom"
    line_total   DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,

    sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,

    KEY idx_saleitem_sale (sale_id, sort_order),
    KEY idx_saleitem_packaging (packaging_id),
    KEY idx_saleitem_batch (batch_id),
    CONSTRAINT fk_saleitem_sale FOREIGN KEY (sale_id) REFERENCES sales (id),
    CONSTRAINT fk_saleitem_packaging FOREIGN KEY (packaging_id) REFERENCES packaging_batches (id),
    CONSTRAINT fk_saleitem_batch FOREIGN KEY (batch_id) REFERENCES honey_batches (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- expenses
-- §39 — the thirteen categories the scenario lists, as an ENUM for the same reason documents used
-- one: a category typed three ways is three empty columns in the §40 breakdown.
--
-- The OCR half of §39 ("AI prepoznaje: dobavljača, datum, iznos, PDV, kategoriju") is Etapa 5. The
-- columns it will fill are here now, entered by hand in the meantime, so that stage adds a reader
-- rather than a schema.
CREATE TABLE IF NOT EXISTS expenses (
    id          CHAR(36)      PRIMARY KEY,
    farm_id     CHAR(36)      NOT NULL,
    -- §40 is per-apiary economics, and most costs genuinely belong to one: sugar fed at Baćina,
    -- fuel driving there. NULL means a farm-wide cost, shown separately rather than spread evenly
    -- across apiaries — an invented allocation would look like a measurement.
    apiary_id   CHAR(36)          NULL,

    spent_on    DATE          NOT NULL,
    category    ENUM('sugar','medicine','fuel','packaging','foundation','queens','hives',
                     'equipment','transport','laboratory','membership','labour','other')
                NOT NULL DEFAULT 'other',

    supplier    VARCHAR(200)      NULL,
    description VARCHAR(255)      NULL,

    amount      DECIMAL(11,2) NOT NULL,   -- gross, the figure on the receipt
    vat_amount  DECIMAL(11,2)     NULL,   -- §39; most small beekeepers are not in the VAT system

    -- §51 — the photographed receipt, filed in the §22 archive under category 'receipt'.
    document_id CHAR(36)          NULL,

    notes       TEXT              NULL,

    created_by  CHAR(36)          NULL,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at  TIMESTAMP         NULL,

    KEY idx_expense_farm (farm_id, spent_on),
    KEY idx_expense_apiary (apiary_id, spent_on),
    KEY idx_expense_category (farm_id, category),
    CONSTRAINT fk_expense_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_expense_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_expense_document FOREIGN KEY (document_id) REFERENCES documents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- pastures
-- §20 — one row per pasture per season, not a catalogue of plants.
--
-- The eleven species §20 lists are suggestions offered by the form (lib/commerce.ts), not rows:
-- they are botany, not regulation, they never change, and a beekeeper on a pasture the list forgot
-- must still be able to type it. harvests.pasture is already free text for exactly that reason.
--
-- expected_yield_kg is stored because it is a plan. The actual yield is NOT stored — it is summed
-- from the harvests that fall on this apiary, in this pasture, between these dates. A hand-typed
-- "stvarni prinos" next to a list of harvests that add up to something else is rule 1's failure
-- mode with a season's delay before anyone notices.
CREATE TABLE IF NOT EXISTS pastures (
    id                CHAR(36)     PRIMARY KEY,
    farm_id           CHAR(36)     NOT NULL,
    apiary_id         CHAR(36)         NULL,

    name              VARCHAR(120) NOT NULL,   -- "Bagrem", "Kadulja", …
    season_year       SMALLINT UNSIGNED NOT NULL,

    starts_on         DATE             NULL,
    ends_on           DATE             NULL,
    location          VARCHAR(200)     NULL,
    colonies_count    SMALLINT UNSIGNED NULL,
    expected_yield_kg DECIMAL(9,2)     NULL,

    notes             TEXT             NULL,

    created_by        CHAR(36)         NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        TIMESTAMP        NULL,

    KEY idx_pasture_farm (farm_id, season_year, deleted_at),
    KEY idx_pasture_apiary (apiary_id, season_year),
    CONSTRAINT fk_pasture_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_pasture_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- apiary_migrations
-- §21 — "Seleće pčelarenje". A planned move of one apiary to a pasture.
--
-- The checklist §21 draws (lokacija / zajednice / suglasnost / povjerenik / prijevoz) is derived
-- from these columns and from apiary_permissions, never stored: a stored tick survives the fact
-- that made it true. That is the same rule the §36 national-jar checklist follows in 005.
CREATE TABLE IF NOT EXISTS apiary_migrations (
    id                 CHAR(36)     PRIMARY KEY,
    farm_id            CHAR(36)     NOT NULL,
    apiary_id          CHAR(36)     NOT NULL,

    -- §21 "Od: Baćina". Text, not a foreign key: the origin is wherever the apiary stands today,
    -- and by the time the move is recorded as done the apiary row already says the new place.
    from_location      VARCHAR(200)     NULL,
    to_location        VARCHAR(200) NOT NULL,   -- §21 "Na: Slavonija – Suncokret"
    to_latitude        DECIMAL(10,7)    NULL,
    to_longitude       DECIMAL(10,7)    NULL,
    pasture            VARCHAR(120)     NULL,

    planned_on         DATE         NOT NULL,   -- §21 "Datum: 12.07.2026."
    completed_on       DATE             NULL,
    colonies_count     SMALLINT UNSIGNED NULL,  -- §21 "Broj zajednica: 42"

    transport_arranged BOOLEAN      NOT NULL DEFAULT FALSE,
    commissioner       VARCHAR(200)     NULL,   -- §21 "kontakt povjerenika evidentiran"
    commissioner_phone VARCHAR(60)      NULL,

    status             ENUM('planned','done','cancelled') NOT NULL DEFAULT 'planned',
    notes              TEXT             NULL,

    created_by         CHAR(36)         NULL,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at         TIMESTAMP        NULL,

    KEY idx_migration_farm (farm_id, planned_on),
    KEY idx_migration_apiary (apiary_id, planned_on),
    CONSTRAINT fk_migration_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_migration_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- apiary_permissions
-- §21's "⚠ suglasnost za smještaj nije unesena" and its "Dodaj suglasnost" button.
--
-- A consent has a giver, a validity range and a scanned document, which is more than the single
-- permit_number / permit_expires_on pair on `apiaries` can hold. Those two columns predate this
-- table — Etapa 1's apiary form writes them and still does — so this is deliberately additive:
-- new consents are recorded here, and §27's readiness list checks both. Naming the overlap is
-- better than a silent migration that rewrites data Etapa 1's screens would keep overwriting.
CREATE TABLE IF NOT EXISTS apiary_permissions (
    id               CHAR(36)     PRIMARY KEY,
    farm_id          CHAR(36)     NOT NULL,

    -- Exactly one of the two is set: a consent for where an apiary stands, or one obtained for a
    -- planned move. Not enforced by a constraint because MySQL CHECK on nullable pairs is more
    -- trouble than the API-level validation it would duplicate.
    apiary_id        CHAR(36)         NULL,
    migration_id     CHAR(36)         NULL,

    granted_by       VARCHAR(200) NOT NULL,   -- vlasnik zemljišta, općina, šumarija
    reference_number VARCHAR(120)     NULL,
    valid_from       DATE             NULL,
    valid_until      DATE             NULL,

    -- §21 "Dokument se može fotografirati ili učitati kao PDF" — filed in the §22 archive under
    -- category 'pasture', so it appears in Inspekcija mod like any other paper.
    document_id      CHAR(36)         NULL,
    notes            TEXT             NULL,

    created_by       CHAR(36)         NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP        NULL,

    KEY idx_permission_farm (farm_id, deleted_at),
    KEY idx_permission_apiary (apiary_id, valid_until),
    KEY idx_permission_migration (migration_id),
    CONSTRAINT fk_permission_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_permission_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id),
    CONSTRAINT fk_permission_migration FOREIGN KEY (migration_id) REFERENCES apiary_migrations (id),
    CONSTRAINT fk_permission_document FOREIGN KEY (document_id) REFERENCES documents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- subsidy_programs
-- §50 — "Aplikacija prati natječaje i intervencije koje administrator unese u sustav."
--
-- System-wide and administrator-maintained, exactly like legal_obligations in 004: a call for
-- applications is announced by a ministry, not by us, and nobody should need a deploy to add one.
-- Deliberately empty at seed time — a shipped list of fabricated calls would be worse than none,
-- because §50 also says the application "ne smije automatski jamčiti pravo na potporu".
CREATE TABLE IF NOT EXISTS subsidy_programs (
    id          CHAR(36)     PRIMARY KEY,
    code        VARCHAR(60)  NOT NULL,
    name        VARCHAR(200) NOT NULL,   -- §50 "Oprema za pčelarstvo"
    authority   VARCHAR(200)     NULL,   -- Ministarstvo poljoprivrede, APPRRR, …
    description TEXT             NULL,

    year        SMALLINT UNSIGNED NULL,
    opens_on    DATE             NULL,
    closes_on   DATE             NULL,
    url         VARCHAR(255)     NULL,

    -- Same vocabulary as legal_obligations.applies_to, so "potencijalno prihvatljivo" is decided
    -- by the same farm facts that decide which obligations apply.
    applies_to  ENUM('all','registered_epp','migratory','honey_producer','food_business')
                NOT NULL DEFAULT 'all',

    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 100,

    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_subsidy_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- subsidy_requirements
-- What a programme asks for. §50's "Status dokumentacije: 85 % — nedostaje račun za vrcaljku" is
-- attached-required ÷ required, so the percentage means something specific rather than being a
-- progress bar that moves when the user clicks things.
CREATE TABLE IF NOT EXISTS subsidy_requirements (
    id                CHAR(36)     PRIMARY KEY,
    program_id        CHAR(36)     NOT NULL,

    label             VARCHAR(200) NOT NULL,   -- "Račun za vrcaljku"
    -- Which §22 drawer to look in when offering documents to attach.
    document_category VARCHAR(60)      NULL,
    required          BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 100,

    KEY idx_requirement_program (program_id, sort_order),
    CONSTRAINT fk_requirement_program FOREIGN KEY (program_id) REFERENCES subsidy_programs (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- subsidy_applications
CREATE TABLE IF NOT EXISTS subsidy_applications (
    id               CHAR(36)     PRIMARY KEY,
    farm_id          CHAR(36)     NOT NULL,
    program_id       CHAR(36)     NOT NULL,

    status           ENUM('considering','preparing','submitted','approved','rejected','withdrawn')
                     NOT NULL DEFAULT 'considering',
    submitted_on     DATE             NULL,
    decision_on      DATE             NULL,
    amount_requested DECIMAL(11,2)    NULL,
    amount_approved  DECIMAL(11,2)    NULL,

    notes            TEXT             NULL,

    created_by       CHAR(36)         NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP        NULL,

    UNIQUE KEY uq_application_farm_program (farm_id, program_id),
    KEY idx_application_farm (farm_id, deleted_at),
    CONSTRAINT fk_application_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_application_program FOREIGN KEY (program_id) REFERENCES subsidy_programs (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- subsidy_application_documents
-- Which archived document satisfies which requirement. One requirement, one document: a second
-- upload replaces the first rather than quietly counting twice toward the percentage.
CREATE TABLE IF NOT EXISTS subsidy_application_documents (
    application_id CHAR(36) NOT NULL,
    requirement_id CHAR(36) NOT NULL,
    document_id    CHAR(36) NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (application_id, requirement_id),
    KEY idx_appdoc_document (document_id),
    CONSTRAINT fk_appdoc_application FOREIGN KEY (application_id) REFERENCES subsidy_applications (id),
    CONSTRAINT fk_appdoc_requirement FOREIGN KEY (requirement_id) REFERENCES subsidy_requirements (id),
    CONSTRAINT fk_appdoc_document FOREIGN KEY (document_id) REFERENCES documents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- season_tasks
-- §19 — "inteligentni godišnji kalendar".
--
-- Data, not code, for the same reason §54 puts legal deadlines in a table: §19 says the activities
-- "mogu se razlikovati prema regiji, tipu pčelarenja, nadmorskoj visini, selećem/stacionarnom
-- pčelarenju", and none of those variations should require a deploy.
--
-- Two axes are modelled, region and apiary kind, because those are the two the application can
-- actually match against a farm's own data (apiaries.kind exists; the region is chosen on screen).
-- Altitude is not modelled — nothing in the application knows an apiary's elevation, and a filter
-- that silently matches nothing is worse than one that is not offered.
CREATE TABLE IF NOT EXISTS season_tasks (
    id          CHAR(36)     PRIMARY KEY,

    month       TINYINT UNSIGNED NOT NULL,   -- 1-12
    title       VARCHAR(200) NOT NULL,
    detail      VARCHAR(500)     NULL,

    region      ENUM('all','continental','coastal','mountain') NOT NULL DEFAULT 'all',
    apiary_kind ENUM('all','stationary','migratory')           NOT NULL DEFAULT 'all',

    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    KEY idx_season_month (month, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================================ seed data
--
-- Fixed literal ids so re-running updates nothing and duplicates nothing — same device as 004 and
-- 005.
--
-- §19 spells out ožujak, svibanj and kolovoz. The other nine months are filled with the standard
-- Croatian beekeeping year, because a calendar with three months of content and nine empty ones
-- reads as broken rather than as honest. Every row is editable by an administrator, and the screen
-- carries the §55 disclaimer: this is a guide to the season, not an instruction.
INSERT INTO season_tasks (id, month, title, detail, region, apiary_kind, sort_order) VALUES
  -- Siječanj
  ('01900000-0000-7000-8003-000000000101', 1, 'Mirovanje zajednica',
   'Ne otvarati košnice. Provjera se radi slušanjem i vaganjem.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000102', 1, 'Kontrola zaliha vaganjem',
   'Lagana košnica upozorava na glad prije nego što je vidljiva.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000103', 1, 'Popravak i priprema opreme',
   'Okviri, satne osnove, čišćenje i dezinfekcija praznih nastavaka.', 'all', 'all', 30),
  -- Veljača
  ('01900000-0000-7000-8003-000000000201', 2, 'Prvi pročisni izlet',
   'Promatranje leta u toplijem danu — znak da zajednica živi.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000202', 2, 'Procjena zaliha hrane',
   'Po potrebi pogača iznad plodišta.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000203', 2, 'Godišnja dojava broja zajednica',
   'Provjerite rok u modulu Obveze.', 'all', 'all', 30),
  -- Ožujak — §19
  ('01900000-0000-7000-8003-000000000301', 3, 'Kontrola hrane', NULL, 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000302', 3, 'Pregled matice', NULL, 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000303', 3, 'Procjena legla', NULL, 'all', 'all', 30),
  ('01900000-0000-7000-8003-000000000304', 3, 'Proširivanje plodišta', NULL, 'all', 'all', 40),
  ('01900000-0000-7000-8003-000000000305', 3, 'Kontrola varoe', NULL, 'all', 'all', 50),
  -- Travanj
  ('01900000-0000-7000-8003-000000000401', 4, 'Dodavanje satnih osnova',
   'Zajednica u naletu gradi brzo; zakašnjela osnova znači rojenje.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000402', 4, 'Izjednačavanje zajednica',
   'Leglo iz jakih u slabije, prije glavne paše.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000403', 4, 'Priprema za bagremovu pašu',
   'Provjera medišta i matičnih rešetki.', 'continental', 'all', 30),
  ('01900000-0000-7000-8003-000000000404', 4, 'Priprema selidbe na bagrem',
   'Suglasnost, prijevoz i prijava povjereniku.', 'all', 'migratory', 40),
  -- Svibanj — §19
  ('01900000-0000-7000-8003-000000000501', 5, 'Priprema medišta', NULL, 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000502', 5, 'Kontrola rojenja',
   'Pregled na matičnjake svakih 7 do 9 dana.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000503', 5, 'Praćenje bagremove paše', NULL, 'continental', 'all', 30),
  ('01900000-0000-7000-8003-000000000504', 5, 'Praćenje kaduljine paše', NULL, 'coastal', 'all', 35),
  ('01900000-0000-7000-8003-000000000505', 5, 'Priprema za vrcanje', NULL, 'all', 'all', 40),
  -- Lipanj
  ('01900000-0000-7000-8003-000000000601', 6, 'Vrcanje i evidencija LOT-a',
   'Svako vrcanje dobiva svoju seriju i LOT oznaku.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000602', 6, 'Uzgoj i zamjena matica',
   'Zamjena matica starijih od dvije godine.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000603', 6, 'Selidba na lipu ili kesten', NULL, 'all', 'migratory', 30),
  -- Srpanj
  ('01900000-0000-7000-8003-000000000701', 7, 'Završno vrcanje',
   'Med za zimu ostaje u košnici.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000702', 7, 'Kontrola varoe nakon vrcanja',
   'Prirodni pad ili metoda pranja — prije nego što se počne tretirati.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000703', 7, 'Skidanje medišta', NULL, 'all', 'all', 30),
  ('01900000-0000-7000-8003-000000000704', 7, 'Selidba na suncokret ili amorfu', NULL, 'all', 'migratory', 40),
  -- Kolovoz — §19
  ('01900000-0000-7000-8003-000000000801', 8, 'Tretman protiv varoe',
   'Upisuje se u evidenciju VMP s LOT brojem i karencom.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000802', 8, 'Kontrola zaliha', NULL, 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000803', 8, 'Prihrana', NULL, 'all', 'all', 30),
  ('01900000-0000-7000-8003-000000000804', 8, 'Priprema zajednica za zimu', NULL, 'all', 'all', 40),
  -- Rujan
  ('01900000-0000-7000-8003-000000000901', 9, 'Dovršetak prihrane',
   'Zimske zalihe moraju biti poklopljene prije hladnoće.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000000902', 9, 'Sužavanje leta',
   'Zaštita od grabeži i miševa.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000000903', 9, 'Provjera učinka tretmana',
   'Ponovno mjerenje zaraženosti nakon tretmana.', 'all', 'all', 30),
  -- Listopad
  ('01900000-0000-7000-8003-000000001001', 10, 'Zadnji pregled prije zime',
   'Snaga zajednice, matica, zalihe.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000001002', 10, 'Vrijesak i kasne paše', NULL, 'coastal', 'all', 20),
  ('01900000-0000-7000-8003-000000001003', 10, 'Povratak s ljetnih paša', NULL, 'all', 'migratory', 30),
  -- Studeni
  ('01900000-0000-7000-8003-000000001101', 11, 'Zimsko tretiranje bez legla',
   'Oksalna kiselina kad zajednica ostane bez legla.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000001102', 11, 'Zaštita od vjetra i vlage', NULL, 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000001103', 11, 'Godišnji proizvodni pokazatelji',
   'Prinos, gubici i troškovi po pčelinjaku — podloga za sljedeću sezonu.', 'all', 'all', 30),
  -- Prosinac
  ('01900000-0000-7000-8003-000000001201', 12, 'Mir na pčelinjaku',
   'Bez otvaranja košnica.', 'all', 'all', 10),
  ('01900000-0000-7000-8003-000000001202', 12, 'Planiranje sljedeće sezone',
   'Paše, selidbe, nabava opreme i matica.', 'all', 'all', 20),
  ('01900000-0000-7000-8003-000000001203', 12, 'Priprema dokumentacije za potpore',
   'Računi i potvrde na jedno mjesto.', 'all', 'all', 30)
ON DUPLICATE KEY UPDATE id = id;
