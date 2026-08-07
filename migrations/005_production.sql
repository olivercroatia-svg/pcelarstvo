-- 005_production.sql — extraction, honey batches, laboratory results, packaging, products and
-- the warehouse.
--
-- Covers scenario §28-§36, and it is the half of §67 that the health and legal modules cannot
-- deliver on their own: hive → harvest → LOT → laboratory → jar → customer.
--
-- Two rules shape the whole file:
--
--   1. A QUANTITY IS STORED IN EXACTLY ONE PLACE. The kilograms of a harvest live on the batch and
--      nowhere else; what is packed is a running total on that same row; what remains is a
--      generated column. §32 shows honey as warehouse stock, but honey stock is never an editable
--      number here — it is summed from the batches. Two editable copies of the same figure is two
--      truths, and the one an inspector reads would be the wrong one.
--
--   2. THE PUBLIC JAR PAGE IS OPT-IN AND TOKENISED. §35 says "opcijski", and §56 says a
--      beekeeper's GPS and OIB are never publicly reachable. So a packaging run has no public page
--      until the beekeeper asks for one, and when it does, it is reached by an unguessable token
--      rather than by its id.

-- ---------------------------------------------------------------- harvests
-- §28. The extraction event: when, from where, from which hives, into which vessels.
--
-- Deliberately holds no kilograms. The quantity extracted IS the quantity of the resulting LOT,
-- and it is stored once, on honey_batches. See rule 1 above.
CREATE TABLE IF NOT EXISTS harvests (
    id            CHAR(36) PRIMARY KEY,
    farm_id       CHAR(36) NOT NULL,
    apiary_id     CHAR(36) NOT NULL,

    harvested_on  DATE     NOT NULL,

    -- §28 "Paša: Kadulja" — where the bees foraged. What the honey is *sold* as is a separate
    -- field on the batch: a beekeeper may extract from livada and declare it cvjetni med.
    pasture       VARCHAR(120) NOT NULL,

    -- §28 "Košnice: 12–47", kept exactly as typed. The authoritative list is harvest_hives; this
    -- is the human shorthand, reproduced on the printed record so it matches the beekeeper's own
    -- notes.
    hive_range    VARCHAR(120)     NULL,
    frames_count  SMALLINT UNSIGNED NULL,

    notes         TEXT             NULL,

    created_by    CHAR(36)         NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP        NULL,

    KEY idx_harvest_farm_date (farm_id, harvested_on),
    KEY idx_harvest_apiary (apiary_id, harvested_on),
    CONSTRAINT fk_harvest_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_harvest_apiary FOREIGN KEY (apiary_id) REFERENCES apiaries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- harvest_hives
-- §30 asks for traceability all the way back from the jar to the hives. This table is the last
-- link in that chain, and the only reason the chain can be walked at all — without it a LOT knows
-- its apiary but not which colonies actually filled it.
CREATE TABLE IF NOT EXISTS harvest_hives (
    harvest_id  CHAR(36) NOT NULL,
    hive_id     CHAR(36) NOT NULL,
    colony_id   CHAR(36)     NULL,

    PRIMARY KEY (harvest_id, hive_id),
    KEY idx_harvesthive_hive (hive_id),
    CONSTRAINT fk_harvesthive_harvest FOREIGN KEY (harvest_id) REFERENCES harvests (id),
    CONSTRAINT fk_harvesthive_hive FOREIGN KEY (hive_id) REFERENCES hives (id),
    CONSTRAINT fk_harvesthive_colony FOREIGN KEY (colony_id) REFERENCES colonies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- harvest_containers
-- §28 "Posude: INOX 1 — 120 kg, INOX 2 — 166 kg".
--
-- Not validated to sum to the batch total: a beekeeper who itemises two vessels out of three has
-- still recorded something useful, and refusing the entry would just mean they record nothing.
-- The API returns the difference so the screen can point it out.
CREATE TABLE IF NOT EXISTS harvest_containers (
    id          CHAR(36) PRIMARY KEY,
    harvest_id  CHAR(36) NOT NULL,

    name        VARCHAR(80)  NOT NULL,   -- "INOX 1"
    amount_kg   DECIMAL(9,2) NOT NULL,

    KEY idx_container_harvest (harvest_id),
    CONSTRAINT fk_container_harvest FOREIGN KEY (harvest_id) REFERENCES harvests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- honey_batches
-- §29. The LOT, and the object everything downstream hangs off.
--
-- One harvest produces one batch and both are written in the same transaction — the UNIQUE on
-- harvest_id says so. They are separate tables because they have different lifetimes: the harvest
-- is a finished event, the batch keeps changing as honey is packed out of it for years afterwards.
CREATE TABLE IF NOT EXISTS honey_batches (
    id             CHAR(36)    PRIMARY KEY,
    farm_id        CHAR(36)    NOT NULL,
    harvest_id     CHAR(36)    NOT NULL,

    -- §28 "Aplikacija stvara LOT: KAD-260524-01" — assigned by the server, never by the client.
    -- Unique per farm rather than globally: two beekeepers extracting sage on the same day would
    -- otherwise collide, and the code is printed on a jar where the producer is already named.
    lot_code       VARCHAR(40) NOT NULL,

    honey_type     VARCHAR(120) NOT NULL,  -- §29 "Vrsta: Kadulja"

    -- The single authoritative quantity. packed_kg is maintained transactionally by the packaging
    -- routes; available_kg is generated so the warehouse figure cannot be edited to disagree with
    -- the packaging records behind it (§29 "Pakirano 185 kg / Na skladištu 101 kg").
    total_kg       DECIMAL(9,2) NOT NULL,
    packed_kg      DECIMAL(9,2) NOT NULL DEFAULT 0,
    available_kg   DECIMAL(10,2) GENERATED ALWAYS AS (total_kg - packed_kg) STORED,

    moisture_percent DECIMAL(4,1) NULL,    -- §28/§29 "Vlaga: 17,2 %"

    -- §29 "Status: 🟢 spremno". Only the beekeeper sets this; nothing in the application flips a
    -- batch to ready on its own, because "spremno" is a judgement about honey, not about data.
    status         ENUM('open','ready','blocked','closed') NOT NULL DEFAULT 'open',

    best_before    DATE             NULL,  -- §34 "najbolje upotrijebiti do"
    notes          TEXT             NULL,

    created_by     CHAR(36)         NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP        NULL,

    UNIQUE KEY uq_batch_lot (farm_id, lot_code),
    UNIQUE KEY uq_batch_harvest (harvest_id),
    KEY idx_batch_farm (farm_id, deleted_at),
    KEY idx_batch_type (farm_id, honey_type),
    CONSTRAINT fk_batch_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_batch_harvest FOREIGN KEY (harvest_id) REFERENCES harvests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- lab_parameters
-- §31 — the measured parameters and the thresholds they are checked against.
--
-- System-wide and administrator-editable, for the same reason §54 puts legal deadlines in a table:
-- these limits come from the Honey Directive and its Croatian implementation, and they change
-- without asking us. §31 is careful about the wording too — "Parametri odgovaraju **unesenim**
-- kriterijima" — the application compares against what was entered, and says so on screen.
CREATE TABLE IF NOT EXISTS lab_parameters (
    id          CHAR(36)     PRIMARY KEY,
    code        VARCHAR(40)  NOT NULL,
    name        VARCHAR(120) NOT NULL,
    unit        VARCHAR(30)      NULL,

    -- Either bound may be NULL: diastase has a floor and no ceiling, HMF the other way round.
    min_value   DECIMAL(10,3)    NULL,
    max_value   DECIMAL(10,3)    NULL,

    -- Shown next to the verdict. Exists because a blanket threshold is sometimes wrong for a
    -- particular honey — conductivity above 0,8 mS/cm is what *defines* chestnut and honeydew
    -- honey, so flagging it as a failure without saying why would be actively misleading.
    note        VARCHAR(255)     NULL,

    decimals    TINYINT UNSIGNED NOT NULL DEFAULT 1,
    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_labparam_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- laboratory_tests
-- §31 — one report from one laboratory for one batch.
--
-- The verdict is NOT stored. It is recomputed from laboratory_values against lab_parameters every
-- time the card is read, so correcting a threshold re-evaluates the history instead of leaving a
-- frozen tick behind. That would be the wrong call for a legal record, but this is explicitly not
-- one: the binding result is the laboratory's own document, which is attached via document_id.
CREATE TABLE IF NOT EXISTS laboratory_tests (
    id             CHAR(36)     PRIMARY KEY,
    farm_id        CHAR(36)     NOT NULL,
    batch_id       CHAR(36)     NOT NULL,

    laboratory     VARCHAR(200)     NULL,
    report_number  VARCHAR(120)     NULL,
    sampled_on     DATE             NULL,
    tested_on      DATE             NULL,

    -- The scanned finding, filed in the §22 archive so it appears in Inspekcija mod like every
    -- other document rather than in a second parallel store.
    document_id    CHAR(36)         NULL,
    notes          TEXT             NULL,

    created_by     CHAR(36)         NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP        NULL,

    KEY idx_labtest_batch (batch_id, deleted_at),
    KEY idx_labtest_farm (farm_id, tested_on),
    CONSTRAINT fk_labtest_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_labtest_batch FOREIGN KEY (batch_id) REFERENCES honey_batches (id),
    CONSTRAINT fk_labtest_document FOREIGN KEY (document_id) REFERENCES documents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- laboratory_values
-- Key-value rather than one column per parameter, so an administrator adding proline to
-- lab_parameters does not need a schema change to go with it.
CREATE TABLE IF NOT EXISTS laboratory_values (
    test_id        CHAR(36)      NOT NULL,
    parameter_code VARCHAR(40)   NOT NULL,
    value          DECIMAL(12,3) NOT NULL,

    PRIMARY KEY (test_id, parameter_code),
    CONSTRAINT fk_labvalue_test FOREIGN KEY (test_id) REFERENCES laboratory_tests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- products
-- §34 — what a filled jar is called and sold as. One row per article, not per jar.
--
-- No price column: §37 prices belong with sales in 006, and §4 keeps financial figures away from
-- worker accounts. Adding the column early would mean adding the role filter early too, for a
-- number nothing in this stage reads.
CREATE TABLE IF NOT EXISTS products (
    id                 CHAR(36)     PRIMARY KEY,
    farm_id            CHAR(36)     NOT NULL,

    name               VARCHAR(200) NOT NULL,   -- "Kaduljin med 450 g"
    honey_type         VARCHAR(120)     NULL,
    net_weight_g       SMALLINT UNSIGNED NOT NULL,

    -- §34 declaration fields that belong to the article rather than to the batch. Defaults for
    -- these come from declaration_texts and are copied into the form, not silently applied.
    storage_conditions VARCHAR(255)     NULL,
    country_of_origin  VARCHAR(100)     NULL,
    shelf_life_months  SMALLINT UNSIGNED NULL,  -- drives "najbolje upotrijebiti do"

    active             BOOLEAN      NOT NULL DEFAULT TRUE,
    notes              TEXT             NULL,

    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at         TIMESTAMP        NULL,

    KEY idx_product_farm (farm_id, deleted_at),
    CONSTRAINT fk_product_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- packaging_batches
-- §33 "120 × 450 g → 54 kg → nova količina LOT-a 232 kg", and §36's national jar.
CREATE TABLE IF NOT EXISTS packaging_batches (
    id             CHAR(36)     PRIMARY KEY,
    farm_id        CHAR(36)     NOT NULL,
    batch_id       CHAR(36)     NOT NULL,
    product_id     CHAR(36)         NULL,

    packaged_on    DATE         NOT NULL,
    jar_size_g     SMALLINT UNSIGNED NOT NULL,
    jar_count      INT UNSIGNED      NOT NULL,

    -- Generated, because §33's arithmetic is the one number a beekeeper should never have to
    -- check. DECIMAL(11,3) holds the gram-level precision that 450 g × 120 needs.
    total_kg       DECIMAL(11,3) GENERATED ALWAYS AS (jar_size_g * jar_count / 1000) STORED,

    best_before    DATE             NULL,

    -- §36 — "Poseban status proizvoda: Nacionalna staklenka". The flag and the serial range are
    -- stored; whether the run is actually ready to carry the mark is derived from the batch's
    -- laboratory result and declaration, so it cannot be ticked into being true.
    is_national    BOOLEAN      NOT NULL DEFAULT FALSE,
    serial_from    VARCHAR(40)      NULL,
    serial_to      VARCHAR(40)      NULL,

    -- §35 — NULL until the beekeeper publishes the run. Unguessable, and not the row id: the code
    -- is printed on a jar that ends up in a stranger's kitchen.
    public_token   VARCHAR(32)      NULL,

    notes          TEXT             NULL,

    created_by     CHAR(36)         NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP        NULL,

    UNIQUE KEY uq_packaging_token (public_token),
    KEY idx_packaging_batch (batch_id, deleted_at),
    KEY idx_packaging_farm (farm_id, packaged_on),
    CONSTRAINT fk_packaging_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_packaging_batch FOREIGN KEY (batch_id) REFERENCES honey_batches (id),
    CONSTRAINT fk_packaging_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- inventory_items
-- §32, minus the honey.
--
-- §32 lists four groups: med, ambalaža, VMP, prihrana. Three of them are things a beekeeper
-- physically counts on a shelf, so they live here. Honey does not: it is summed from
-- honey_batches.available_kg. A hand-editable honey figure would drift away from the LOTs within
-- a season and there would be no way to tell which one was right.
CREATE TABLE IF NOT EXISTS inventory_items (
    id            CHAR(36)     PRIMARY KEY,
    farm_id       CHAR(36)     NOT NULL,

    category      ENUM('packaging','vmp','feed','equipment','other') NOT NULL DEFAULT 'packaging',
    name          VARCHAR(200) NOT NULL,   -- "Staklenke 450 g"
    unit          VARCHAR(20)  NOT NULL DEFAULT 'kom',

    quantity      DECIMAL(11,2) NOT NULL DEFAULT 0,
    -- Below this the item is flagged low. NULL = do not watch this item.
    min_quantity  DECIMAL(11,2)     NULL,

    -- §32 tracks VMP stock with its LOT and expiry, which is also what §17 needs when a treatment
    -- is recorded from the shelf.
    lot_number    VARCHAR(120)      NULL,
    expires_on    DATE              NULL,

    notes         TEXT              NULL,

    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP         NULL,

    KEY idx_inventory_farm (farm_id, category, deleted_at),
    CONSTRAINT fk_inventory_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- inventory_movements
-- Every change to a quantity, append-only, with what caused it.
--
-- The alternative — letting the screen overwrite `quantity` — makes "why do I have 40 fewer lids
-- than last month" unanswerable. §37 will write rows here too when a sale ships.
CREATE TABLE IF NOT EXISTS inventory_movements (
    id             CHAR(36)      PRIMARY KEY,
    farm_id        CHAR(36)      NOT NULL,
    item_id        CHAR(36)      NOT NULL,

    moved_on       DATE          NOT NULL,
    -- Signed: +200 delivered, −120 consumed by a packaging run.
    delta          DECIMAL(11,2) NOT NULL,
    reason         ENUM('purchase','usage','packaging','correction','loss','sale','other')
                   NOT NULL DEFAULT 'correction',

    reference_type VARCHAR(40)       NULL,   -- 'packaging_batch', 'sale', …
    reference_id   CHAR(36)          NULL,
    note           VARCHAR(255)      NULL,

    created_by     CHAR(36)          NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_movement_item (item_id, moved_on),
    KEY idx_movement_farm (farm_id, moved_on),
    CONSTRAINT fk_movement_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_movement_item FOREIGN KEY (item_id) REFERENCES inventory_items (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- declaration_texts
-- §34 — "Regulatorni tekst deklaracija mora biti administrativno podesiv kako bi se mogao
-- uskladiti s budućim izmjenama propisa."
--
-- System-wide, edit-only: the set of blocks is fixed by what the declaration actually renders, so
-- there is no create or delete. An administrator who could add a block nothing prints would have
-- been given a control that does nothing.
CREATE TABLE IF NOT EXISTS declaration_texts (
    id         CHAR(36)     PRIMARY KEY,
    code       VARCHAR(60)  NOT NULL,
    label      VARCHAR(200) NOT NULL,   -- what the administrator sees
    body       TEXT             NULL,   -- what the declaration prints
    hint       VARCHAR(255)     NULL,

    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100,

    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_dectext_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================================ seed data
--
-- Fixed literal ids so re-running the migration updates nothing and duplicates nothing. Same
-- device as the §23 obligations in 004.

-- §31's seven parameters. The thresholds are the general Honey Directive figures and they are
-- seeded so the feature works out of the box — but they are editable, they are labelled on screen
-- as criteria entered in the application, and every card carries the §55 disclaimer. Where a
-- blanket limit is known to be wrong for a honey type, the note says so rather than the app
-- quietly returning a red cross.
INSERT INTO lab_parameters (id, code, name, unit, min_value, max_value, decimals, sort_order, note) VALUES
  ('01900000-0000-7000-8001-000000000001', 'moisture',     'Vlaga',                 '%',       NULL, 20,   1, 10,
   'Za vrijesak i pekarski med dopuštena je viša vrijednost.'),
  ('01900000-0000-7000-8001-000000000002', 'hmf',          'HMF',                   'mg/kg',   NULL, 40,   0, 20,
   'Za medove tropskog podrijetla granica je viša.'),
  ('01900000-0000-7000-8001-000000000003', 'diastase',     'Dijastaza',             NULL,      8,    NULL, 0, 30,
   'Medovi s prirodno niskim udjelom enzima ocjenjuju se zajedno s HMF-om.'),
  ('01900000-0000-7000-8001-000000000004', 'conductivity', 'Električna vodljivost', 'mS/cm',   NULL, 0.8,  2, 40,
   'Ne primjenjuje se na medljiku i kesten — kod njih je vodljivost iznad 0,8 očekivana.'),
  ('01900000-0000-7000-8001-000000000005', 'sucrose',      'Saharoza',              'g/100 g', NULL, 5,    1, 50,
   'Za bagrem, amorfu i lavandu dopušten je viši udio.'),
  ('01900000-0000-7000-8001-000000000006', 'fructose',     'Fruktoza',              'g/100 g', NULL, NULL, 1, 60,
   'Zbroj fruktoze i glukoze za cvjetni med iznosi najmanje 60 g/100 g.'),
  ('01900000-0000-7000-8001-000000000007', 'glucose',      'Glukoza',               'g/100 g', NULL, NULL, 1, 70,
   'Vrednuje se zajedno s fruktozom.')
ON DUPLICATE KEY UPDATE id = id;

-- §34's regulatory blocks. Left as sensible defaults an administrator overwrites; the declaration
-- prints whatever is in `body` at the time it is generated.
INSERT INTO declaration_texts (id, code, label, body, hint, sort_order) VALUES
  ('01900000-0000-7000-8002-000000000001', 'storage_conditions', 'Uvjeti čuvanja',
   'Čuvati na suhom i tamnom mjestu, na temperaturi do 25 °C. Kristalizacija je prirodna pojava i ne utječe na kakvoću meda.',
   'Ispisuje se na svakoj deklaraciji ako proizvod nema vlastiti tekst.', 10),
  ('01900000-0000-7000-8002-000000000002', 'country_of_origin', 'Zemlja podrijetla',
   'Hrvatska', 'Zadana zemlja podrijetla za nove proizvode.', 20),
  ('01900000-0000-7000-8002-000000000003', 'mandatory_notice', 'Obvezna napomena',
   'Med nije namijenjen prehrani dojenčadi mlađe od godinu dana.',
   'Napomena koja se ispisuje ispod podataka o proizvodu.', 30),
  ('01900000-0000-7000-8002-000000000004', 'national_jar_notice', 'Napomena — nacionalna staklenka',
   'Proizvod se stavlja na tržište u nacionalnoj staklenci s dodijeljenim serijskim brojem.',
   'Ispisuje se samo kada je pakiranje označeno kao nacionalna staklenka (§36).', 40)
ON DUPLICATE KEY UPDATE id = id;
