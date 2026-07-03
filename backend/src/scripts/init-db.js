require('dotenv').config();
const pool = require('../config/database');

const createTables = async () => {
  const schemaQuery = `
    -- 1. Users Table
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Auth (Step 10): password_hash is nullable so legacy dev users (created via
    -- POST /api/users without a password) remain valid; only /api/auth/register
    -- populates it. Idempotent ALTER upgrades pre-existing databases in place.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

    -- 2. Wallets Table
    CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        balance DECIMAL(15, 4) NOT NULL DEFAULT 100000.0000, 
        CONSTRAINT check_positive_balance CHECK (balance >= 0),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Assets Table
    CREATE TABLE IF NOT EXISTS assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        asset_class VARCHAR(20) NOT NULL
            CHECK (asset_class IN ('EQUITY', 'CRYPTO', 'ETF', 'FOREX')),
        is_active BOOLEAN DEFAULT TRUE
    );

    -- 4. Orders Table
    CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        asset_id UUID REFERENCES assets(id),
        order_type VARCHAR(20) NOT NULL
            CHECK (order_type IN ('MARKET', 'LIMIT')),
        side VARCHAR(10) NOT NULL
            CHECK (side IN ('BUY', 'SELL')),
        quantity DECIMAL(15, 4) NOT NULL CHECK (quantity > 0),
        target_price DECIMAL(15, 4),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
            CHECK (status IN ('PENDING', 'FILLED', 'CANCELLED', 'REJECTED')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        -- LIMIT orders must specify a target price; MARKET orders must not
        CONSTRAINT check_limit_has_target CHECK (
            (order_type = 'LIMIT' AND target_price IS NOT NULL) OR
            (order_type = 'MARKET' AND target_price IS NULL)
        )
    );

    -- 5. Transactions Table (append-only ledger — see trigger below)
    CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        order_id UUID REFERENCES orders(id),
        transaction_type VARCHAR(20) NOT NULL
            CHECK (transaction_type IN ('BUY', 'SELL', 'DEPOSIT', 'RESET')),
        amount DECIMAL(15, 4) NOT NULL,
        price_per_share DECIMAL(15, 4) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Positions Table
    CREATE TABLE IF NOT EXISTS positions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        asset_id UUID REFERENCES assets(id),
        quantity DECIMAL(15, 4) NOT NULL CHECK (quantity >= 0),
        average_buy_price DECIMAL(15, 4) NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, asset_id)
    );

    -- 7. Market Prices Table (latest known price per asset, for valuation
    --    and LIMIT-order triggering)
    CREATE TABLE IF NOT EXISTS market_prices (
        asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        price DECIMAL(15, 4) NOT NULL CHECK (price >= 0),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 8. Price History (raw ticks) — append-only source for candlestick
    --    aggregation. market_prices keeps only the latest; this keeps every tick.
    CREATE TABLE IF NOT EXISTS price_history (
        asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
        price DECIMAL(15, 4) NOT NULL CHECK (price >= 0),
        ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
    );

    -- ---------------------------------------------------------------------
    -- Indexes for the hot read paths (portfolio, order book, leaderboard)
    -- ---------------------------------------------------------------------
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_price_history_asset_ts ON price_history(asset_id, ts);

    -- ---------------------------------------------------------------------
    -- Append-only enforcement: the transactions ledger rejects UPDATE/DELETE
    -- at the database level, regardless of how the application behaves.
    -- ---------------------------------------------------------------------
    CREATE OR REPLACE FUNCTION reject_transaction_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'transactions is an append-only ledger: % is not permitted', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_transactions_append_only ON transactions;
    CREATE TRIGGER trg_transactions_append_only
        BEFORE UPDATE OR DELETE ON transactions
        FOR EACH ROW EXECUTE FUNCTION reject_transaction_mutation();
  `;

  try {
    console.log('Running database schema migration...');
    await pool.query(schemaQuery);
    
    // Insert some default assets for testing
    const seedAssets = `
      INSERT INTO assets (symbol, name, asset_class) 
      VALUES 
        ('AAPL', 'Apple Inc.', 'EQUITY'),
        ('MSFT', 'Microsoft Corporation', 'EQUITY'),
        ('TSLA', 'Tesla, Inc.', 'EQUITY')
      ON CONFLICT (symbol) DO NOTHING;
    `;
    await pool.query(seedAssets);

    // Seed an initial market price for each asset so portfolio valuation and
    // LIMIT-order triggering have a price source before any live feed exists.
    const seedPrices = `
      INSERT INTO market_prices (asset_id, price)
      SELECT id, seed.price
      FROM assets
      JOIN (VALUES
        ('AAPL', 195.0000::DECIMAL),
        ('MSFT', 430.0000::DECIMAL),
        ('TSLA', 250.0000::DECIMAL)
      ) AS seed(symbol, price) ON assets.symbol = seed.symbol
      ON CONFLICT (asset_id) DO NOTHING;
    `;
    await pool.query(seedPrices);

    console.log('Database tables created and seeded successfully.');
  } catch (error) {
    console.error('Error creating database tables:', error.message);
    process.exitCode = 1; // Ensure the script reports failure to the shell/CI
  } finally {
    await pool.end(); // Close the pool so the script exits
  }
};

createTables();