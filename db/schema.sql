-- =====================================================================
-- Platforma web real-time HoReCa - Meniuri QR Securizate
-- Schema PostgreSQL (Varianta A + suport verificare stare Varianta B)
-- =====================================================================

-- 1. Restaurante
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Mese
CREATE TABLE IF NOT EXISTS tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_number INT NOT NULL,
    qr_static_code VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_restaurant_table_number UNIQUE (restaurant_id, table_number)
);

-- 3. Personal (Staff)
CREATE TABLE IF NOT EXISTS staff_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('waiter', 'kitchen', 'manager')),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Articole Meniu
CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Sesiuni Mese (Varianta A)
CREATE TABLE IF NOT EXISTS table_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    session_token VARCHAR(64) UNIQUE NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'closed')),
    opened_by_staff_id UUID REFERENCES staff_users(id),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours')
);

-- Constrângere unică: O singură sesiune activă pe o masă
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_session_per_table 
ON table_sessions(table_id) 
WHERE state = 'active';

-- 6. Membri sesiune (Dispozitive conectate la masă - max 4 per sesiune)
CREATE TABLE IF NOT EXISTS session_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    device_token VARCHAR(64) UNIQUE NOT NULL,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    nickname VARCHAR(50),
    user_agent TEXT,
    ip_address VARCHAR(45),
    frozen_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_session_id ON session_members(session_id);

-- 7. Invitații sesiune (max 3 invitații active, owner only)
CREATE TABLE IF NOT EXISTS session_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    created_by_member_id UUID NOT NULL REFERENCES session_members(id) ON DELETE CASCADE,
    invite_token VARCHAR(64) UNIQUE NOT NULL,
    used_by_member_id UUID REFERENCES session_members(id),
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Comenzi
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES session_members(id) ON DELETE CASCADE,
    client_request_id VARCHAR(128) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'cancelled', 'dispatched', 'preparing', 'ready', 'served')),
    dispatch_after TIMESTAMPTZ NOT NULL,
    dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_session_client_request_id UNIQUE (session_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_dispatch_queue ON orders(state, dispatch_after) WHERE state = 'queued';

-- 9. Linii de comandă
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    quantity INT NOT NULL CHECK (quantity > 0 AND quantity <= 20),
    unit_price NUMERIC(10, 2) NOT NULL,
    notes TEXT
);

-- 10. Apeluri ospătar
CREATE TABLE IF NOT EXISTS session_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES session_members(id) ON DELETE CASCADE,
    call_type VARCHAR(50) NOT NULL DEFAULT 'service',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by_staff_id UUID REFERENCES staff_users(id)
);

-- 11. Vedere status mese
CREATE OR REPLACE VIEW v_table_status AS
SELECT 
    t.id AS table_id,
    t.restaurant_id,
    t.table_number,
    t.qr_static_code,
    s.id AS active_session_id,
    s.session_token,
    s.opened_at,
    CASE 
        WHEN s.id IS NULL THEN 'LIBERA'
        WHEN s.state = 'active' THEN 'OCUPATA'
        ELSE 'INCHISA'
    END AS status_derivat,
    (SELECT COUNT(*) FROM session_members sm WHERE sm.session_id = s.id) AS active_devices_count,
    (SELECT COUNT(*) FROM orders o WHERE o.session_id = s.id AND o.state IN ('queued', 'dispatched', 'preparing')) AS pending_orders_count
FROM tables t
LEFT JOIN table_sessions s ON t.id = s.table_id AND s.state = 'active';

-- =====================================================================
-- TABELE ȘI FUNCȚII PENTRU TESTAREA DE STARE: VARIANTA B (T00)
-- =====================================================================

CREATE TABLE IF NOT EXISTS candidate_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    badge_code VARCHAR(32) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'active', 'closed', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes')
);

-- Ecuson unic per masă doar cât timp este în starea 'candidate'
-- Când trece în 'active' sau 'closed', ecusonul este eliberat din index!
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_candidate_badge_per_table 
ON candidate_sessions(table_id, badge_code) 
WHERE state = 'candidate';

-- Funcție pentru expirarea candidaților stătăuți
CREATE OR REPLACE FUNCTION expire_stale_candidates()
RETURNS INT AS $$
DECLARE
    affected_rows INT;
BEGIN
    UPDATE candidate_sessions
    SET state = 'expired'
    WHERE state = 'candidate' AND expires_at < NOW();
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;

-- Funcție verificare plafon max 3 candidați activi (ignorând cei expirați)
CREATE OR REPLACE FUNCTION check_candidate_cap()
RETURNS TRIGGER AS $$
DECLARE
    active_cand_count INT;
BEGIN
    -- Ignoră candidații expirați (fie marcați 'expired', fie cu expires_at < NOW())
    SELECT COUNT(*) INTO active_cand_count
    FROM candidate_sessions
    WHERE table_id = NEW.table_id 
      AND state = 'candidate' 
      AND expires_at >= NOW();
      
    IF active_cand_count >= 3 THEN
        RAISE EXCEPTION 'candidate_cap_reached: maximum 3 active candidates allowed per table'
            USING ERRCODE = 'check_violation';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_candidate_cap ON candidate_sessions;
CREATE TRIGGER trg_check_candidate_cap
BEFORE INSERT ON candidate_sessions
FOR EACH ROW
EXECUTE FUNCTION check_candidate_cap();

-- Comandă pe sesiune candidat (doar sesiunile active pot plasa comenzi)
CREATE TABLE IF NOT EXISTS candidate_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES candidate_sessions(id) ON DELETE CASCADE,
    order_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION check_candidate_order_session()
RETURNS TRIGGER AS $$
DECLARE
    s_state VARCHAR(20);
BEGIN
    SELECT state INTO s_state FROM candidate_sessions WHERE id = NEW.session_id;
    IF s_state IS NULL OR s_state != 'active' THEN
        RAISE EXCEPTION 'order_rejected: session is not active'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_candidate_order ON candidate_orders;
CREATE TRIGGER trg_check_candidate_order
BEFORE INSERT ON candidate_orders
FOR EACH ROW
EXECUTE FUNCTION check_candidate_order_session();
