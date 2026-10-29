const { Pool } = require("pg");

// Connection details come entirely from environment variables so the same
// image works locally (docker-compose), and in EKS (values injected via a
// Kubernetes Secret + ConfigMap in the Helm chart) without any code changes.
const embedded = process.env.DB_ENGINE === "pglite";
if (embedded && process.env.NODE_ENV === "production") throw new Error("PGlite is local-only");
const localDb = embedded ? new (require("@electric-sql/pglite").PGlite)(process.env.PGLITE_DATA_DIR || "memory://") : null;
const pool = embedded ? {
  query: (sql, params) => localDb.query(sql, params),
  end: () => localDb.close(),
} : new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "shopstack",
  password: process.env.DB_PASSWORD || "shopstack123",
  database: process.env.DB_NAME || "shopstack",
});

async function initSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      total_amount NUMERIC(10,2) NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cart_state (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      version INTEGER NOT NULL DEFAULT 1,
      last_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expired BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;
  if (localDb) await localDb.exec(schema);
  else await pool.query(schema);

  const { rows } = await pool.query("SELECT COUNT(*) FROM products");
  if (parseInt(rows[0].count, 10) === 0) {
    await pool.query(`
      INSERT INTO products (name, category, price) VALUES
      ('Wireless Mouse', 'Electronics', 24.99),
      ('Mechanical Keyboard', 'Electronics', 89.99),
      ('Running Shoes', 'Sports', 64.99),
      ('Coffee Mug', 'Home & Living', 12.50);
    `);
  }
}

async function transaction(work) {
  if (localDb) return localDb.transaction(work);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
module.exports = { pool, initSchema, transaction };
