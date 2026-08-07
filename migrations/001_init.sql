-- 001_init.sql — baseline schema for "Moj Pčelinjak".
--
-- Covers scenario §4 (user roles), §5 (registration) and §56 (security / audit trail).
-- Later modules add their own numbered files; this one is never edited after it has run.
--
-- Conventions used by every table in this project:
--   * Primary keys are UUIDv7 in CHAR(36) — see backend/src/lib/ids.ts for why v7, not v4.
--   * created_at / updated_at everywhere.
--   * deleted_at (soft delete) on records an inspector may later need to see.
--   * utf8mb4 throughout so č ć š ž đ survive round-tripping.

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
    id                CHAR(36)     PRIMARY KEY,
    email             VARCHAR(255) NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,

    first_name        VARCHAR(100) NOT NULL,
    last_name         VARCHAR(100) NOT NULL,
    phone             VARCHAR(50)      NULL,

    -- System administrator (§4) — manages legal deadlines, forms and regulatory parameters.
    -- Farm-level rights live in farm_members, not here.
    is_admin          BOOLEAN      NOT NULL DEFAULT FALSE,

    email_verified_at TIMESTAMP        NULL,
    last_login_at     TIMESTAMP        NULL,

    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        TIMESTAMP        NULL,

    -- Not partial-unique: MySQL cannot express "unique among non-deleted". GDPR account deletion
    -- (§56) therefore anonymises the address instead of leaving it reserved by a tombstone row.
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- farms
-- One "gospodarstvo" (§5). A user owns one in practice, but the schema allows several so a
-- bookkeeper or association can hold more than one without a second account.
CREATE TABLE IF NOT EXISTS farms (
    id                    CHAR(36)     PRIMARY KEY,
    owner_user_id         CHAR(36)     NOT NULL,

    -- §5 step 1
    entity_type           ENUM('individual','opg','craft','company','other') NOT NULL,

    -- §5 step 2 — identity. Personal names live on users; these are the business fields.
    name                  VARCHAR(255)     NULL,  -- farm / company name (blank for individuals)
    oib                   CHAR(11)         NULL,
    mibpg                 VARCHAR(50)      NULL,
    responsible_person    VARCHAR(200)     NULL,
    address               VARCHAR(255)     NULL,
    city                  VARCHAR(120)     NULL,
    postal_code           VARCHAR(20)      NULL,

    -- §5 step 3 — beekeeping registration
    epp_number            VARCHAR(50)      NULL,
    apiary_count          INT UNSIGNED     NULL,
    colony_count          INT UNSIGNED     NULL,
    association           VARCHAR(200)     NULL,
    pasture_commissioner  VARCHAR(200)     NULL,

    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at            TIMESTAMP        NULL,

    KEY idx_farms_owner (owner_user_id),
    CONSTRAINT fk_farms_owner FOREIGN KEY (owner_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- farm_members
-- §4: the owner may grant a family member or employee access. Per-apiary scoping arrives with the
-- apiaries table in 002; until then membership is farm-wide.
CREATE TABLE IF NOT EXISTS farm_members (
    id           CHAR(36)  PRIMARY KEY,
    farm_id      CHAR(36)  NOT NULL,
    user_id      CHAR(36)  NOT NULL,

    -- owner  — full control, including finances and deletion
    -- worker — may record inspections, treatments, feeding and harvests; no finances, no deletion
    role         ENUM('owner','worker') NOT NULL DEFAULT 'worker',

    invited_at   TIMESTAMP     NULL,
    accepted_at  TIMESTAMP     NULL,

    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at   TIMESTAMP     NULL,

    UNIQUE KEY uq_farm_members (farm_id, user_id),
    KEY idx_farm_members_user (user_id),
    CONSTRAINT fk_farm_members_farm FOREIGN KEY (farm_id) REFERENCES farms (id),
    CONSTRAINT fk_farm_members_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- sessions
-- The session JWT carries this row's id as `sid`. Verifying the signature is not enough — every
-- authenticated request also checks the row, which is what makes "log out everywhere" and
-- server-side revocation possible at all.
CREATE TABLE IF NOT EXISTS sessions (
    id          CHAR(36)     PRIMARY KEY,
    user_id     CHAR(36)     NOT NULL,
    expires_at  TIMESTAMP    NOT NULL,
    revoked_at  TIMESTAMP        NULL,
    user_agent  VARCHAR(255)     NULL,
    ip_address  VARCHAR(45)      NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expiry (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- audit_logs
-- Append-only (§56). No updated_at and no deleted_at on purpose: rows here are never edited and
-- never removed, which is the whole point of keeping them.
CREATE TABLE IF NOT EXISTS audit_logs (
    id           CHAR(36)     PRIMARY KEY,
    user_id      CHAR(36)         NULL,  -- NULL for system/cron actions
    farm_id      CHAR(36)         NULL,
    action       VARCHAR(80)  NOT NULL,  -- e.g. 'user.register', 'treatment.update'
    entity_type  VARCHAR(80)  NOT NULL,
    entity_id    CHAR(36)         NULL,
    before_json  JSON             NULL,
    after_json   JSON             NULL,
    ip_address   VARCHAR(45)      NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_audit_entity (entity_type, entity_id),
    KEY idx_audit_farm_time (farm_id, created_at),
    KEY idx_audit_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
