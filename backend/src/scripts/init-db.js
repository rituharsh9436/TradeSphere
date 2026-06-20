require('dotenv').config();
const pool = require('../config/database');

const createTables = async () => {
  const schemaQuery = `
    -- 1. Users Table
    CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created._at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Wallets Table
    CREATE TABLE   wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        balance DECIMAL(15, 4) NOT NULL DEFAULT 100000.0000, 
        CONSTRAINT check_positive_balance CHECK (balance >= 0),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Assets Table
    CREATE TABLE   assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        asset_class VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE
    );

    -- 4. Orders Table
    CREATE TABLE   orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        asset_id UUID REFERENCES assets(id),
        order_type VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL,
        quantity DECIMAL(15, 4) NOT NULL CHECK (quantity > 0),
        target_price DECIMAL(15, 4),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 5. Transactions Table
    CREATE TABLE   transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        order_id UUID REFERENCES orders(id),
        transaction_type VARCHAR(20) NOT NULL,
        amount DECIMAL(15, 4) NOT NULL,
        price_per_share DECIMAL(15, 4) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Positions Table
    CREATE TABLE   positions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        asset_id UUID REFERENCES assets(id),
        quantity DECIMAL(15, 4) NOT NULL CHECK (quantity >= 0),
        average_buy_price DECIMAL(15, 4) NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, asset_id)
    );
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
    
    console.log('Database tables created and seeded successfully.');
  } catch (error) {
    console.error('Error creating database tables:', error.message);
  } finally {
    await pool.end(); // Close the pool so the script exits
  }
};

createTables();