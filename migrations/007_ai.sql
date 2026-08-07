-- 007_ai.sql — the AI layer: spend ledger, assistant conversations, and the handful of
-- parameters that decide how much of it a farm is allowed to use.
--
-- Covers scenario §13, §18, §31 (reading), §39 (reading), §44, §45 and §46.
--
-- What is striking about this migration is how little it adds. Voice entry writes a hive
-- inspection; reading a VMP box writes a veterinary treatment; reading a receipt writes an
-- expense; describing a photo writes a caption. Every one of those tables already exists, and the
-- AI layer reaches them through the same routes a thumb does. The three tables below are the only
-- things that are genuinely new: a record of what was spent, a record of what was asked, and the
-- two dials that stop the first from running away.
--
-- Three rules shape this file.
--
--   1. AI OUTPUT IS A DRAFT, NEVER A RECORD. §13 is explicit — "s potvrdom prije spremanja" — and
--      the same rule is applied to every other extraction here, because a veterinary register
--      (§17) that contains a withdrawal date no human ever read is worse than no register at all.
--      There is deliberately no ai_extracted_* table: a draft that survives in the database is a
--      draft someone will eventually mistake for a record. Extractions live in the request that
--      produced them and nowhere else. What lands in a register landed there through the ordinary
--      route, after a person pressed save, with created_by set to that person.
--
--   2. EVERY CALL IS METERED BEFORE IT IS MADE. ai_usage is append-only, and the cap reads it
--      *before* the request rather than after. Etapa 6 puts this application behind a public
--      registration form, and an unmetered model endpoint behind a public registration form is the
--      one defect in this codebase that costs real money per minute while nobody is looking. The
--      §56 rate limiter counts requests, which is the wrong unit: one request can spend a hundred
--      times what another does.
--
--   3. NO TABLE HERE IS READABLE BY INSPEKCIJA MOD (§26), AND NO ANSWER CROSSES A FARM. The
--      assistant runs entirely inside req.farm.id, exactly like every other module — it is given
--      tools rather than a database connection, and each tool applies the farm filter itself. What
--      a conversation may reveal is fixed by those tools, in the same way that what the §35 public
--      jar page may reveal is fixed by its SELECT list.

-- ================================================================ spend ledger (rule 2)
--
-- Money is stored as an integer count of micro-euros (1 € = 1 000 000), never as a float. A token
-- costs on the order of 0,000002 €, and summing a month of those in DECIMAL or DOUBLE is how a
-- ledger ends up disagreeing with itself in the fourth decimal place.
--
-- Rows are written for FAILED calls too, with ok = FALSE. A provider that answers 500 after
-- reading the input has still been paid for the input, and a ledger that only records successes
-- would quietly under-count exactly when something is going wrong.
CREATE TABLE IF NOT EXISTS ai_usage (
    id                 CHAR(36)     PRIMARY KEY,
    farm_id            CHAR(36)     NOT NULL,

    -- Who triggered it. Kept so an owner can see which worker's usage filled the month, and so a
    -- §56 data export can hand a user their own AI history.
    user_id            CHAR(36)         NULL,

    -- Named rather than free text: a typo in a feature string creates a phantom line in the
    -- breakdown that nobody can trace back to a screen.
    feature            ENUM('assistant','summary','voice','ocr_vmp','ocr_lab','ocr_receipt','photo','transcribe') NOT NULL,

    -- The exact model string that served the request, not the tier. When a price changes or a
    -- model is swapped, this is what makes the old rows still explicable.
    model              VARCHAR(80)  NOT NULL,

    input_tokens       INT UNSIGNED NOT NULL DEFAULT 0,
    output_tokens      INT UNSIGNED NOT NULL DEFAULT 0,
    -- Cache reads are billed at a tenth of the input rate and cache writes at rather more than
    -- one; both are counted separately or the cost arithmetic is simply wrong on any conversation
    -- past its first turn.
    cache_read_tokens  INT UNSIGNED NOT NULL DEFAULT 0,
    cache_write_tokens INT UNSIGNED NOT NULL DEFAULT 0,

    -- Transcription is billed per second of audio, not per token, so it carries its own unit.
    audio_seconds      INT UNSIGNED NOT NULL DEFAULT 0,

    cost_micros        BIGINT UNSIGNED NOT NULL DEFAULT 0,

    ok                 BOOLEAN      NOT NULL DEFAULT TRUE,
    error_code         VARCHAR(80)      NULL,

    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The index the cap check runs on, on every single AI request. Farm first, then time, so the
    -- month's slice is a range scan rather than a filter over the farm's whole history.
    KEY idx_ai_usage_farm_time (farm_id, created_at),
    KEY idx_ai_usage_feature (farm_id, feature, created_at),
    CONSTRAINT fk_ai_usage_farm FOREIGN KEY (farm_id) REFERENCES farms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================================ §45 assistant conversations
--
-- Stored rather than kept in the browser for two reasons: a beekeeper who asked "kada sam zadnji
-- put tretirao AN-04" on the phone in the apiary wants to find that answer again at home, and a
-- conversation that only exists client-side cannot be handed over in a §56 data export.
CREATE TABLE IF NOT EXISTS ai_conversations (
    id         CHAR(36)     PRIMARY KEY,
    farm_id    CHAR(36)     NOT NULL,

    -- Conversations are personal, not shared: two people on one farm asking the assistant
    -- different questions should not read as one confused thread.
    user_id    CHAR(36)     NOT NULL,

    -- Generated from the first question rather than asked for, and never by a second model call —
    -- the first 80 characters of what the user typed identify a thread perfectly well.
    title      VARCHAR(200) NOT NULL,

    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP        NULL,

    KEY idx_ai_conv_user (farm_id, user_id, deleted_at, updated_at),
    CONSTRAINT fk_ai_conv_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_ai_conv_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_messages (
    id              CHAR(36)   PRIMARY KEY,
    conversation_id CHAR(36)   NOT NULL,

    role            ENUM('user','assistant') NOT NULL,
    content         MEDIUMTEXT NOT NULL,

    -- Which tools ran and with what arguments, as JSON. Not shown by default, but it is the only
    -- way to answer "where did that number come from" when the assistant says something
    -- surprising — and §55 makes that question the user's to ask.
    tool_trace      JSON           NULL,

    created_at      TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_ai_msg_conv (conversation_id, created_at),
    CONSTRAINT fk_ai_msg_conv FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================================ policy, not secrets
--
-- The split is deliberate. API keys live in .env, because they are secrets and belong on the host.
-- Everything below is *policy* — how much a farm may spend, and whether the layer is on at all —
-- and policy that requires a deploy to change is policy that does not get changed at the moment it
-- needs changing. Same reasoning as §54's legal_obligations, applied to a budget instead of a
-- deadline.
--
-- Prices are NOT here. A price is a fact about a vendor, not a decision this application gets to
-- make; it lives beside the model id in lib/ai.ts, where changing it is a code review rather than
-- a form field.
CREATE TABLE IF NOT EXISTS ai_settings (
    setting_key VARCHAR(60)  PRIMARY KEY,
    value       VARCHAR(200) NOT NULL,
    label       VARCHAR(200) NOT NULL,
    hint        VARCHAR(400)     NULL,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ON DUPLICATE KEY UPDATE setting_key = setting_key: re-running the migration must not reset a cap
-- an administrator has since changed. Same no-op idiom as the 006 season tasks.
INSERT INTO ai_settings (setting_key, value, label, hint) VALUES
  ('monthly_cap_eur', '5.00', 'Mjesečni limit po gospodarstvu (€)',
   'Zbroj svih AI poziva u kalendarskom mjesecu. Kad se dosegne, AI funkcije se isključuju do prvog u mjesecu, a ostatak aplikacije radi normalno. 0 znači bez ograničenja.'),
  ('enabled', 'true', 'AI funkcije uključene',
   'Glavni prekidač. Isključivanje odmah zaustavlja sve pozive prema modelu; već spremljeni zapisi ostaju netaknuti.'),
  ('assistant_enabled', 'true', 'AI asistent (§45)',
   'Razgovor nad vlastitim podacima. Isključivo čitanje — asistent nema alat koji išta mijenja ili briše.'),
  ('daily_summary_enabled', 'true', 'Dnevni sažetak (§46)',
   'Jedna obavijest ujutro sa sažetkom obveza, upozorenja i planiranih radova. Šalje se najviše jednom dnevno po gospodarstvu.')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
