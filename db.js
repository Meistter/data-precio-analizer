const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ranking JSONB NOT NULL,
                ignored_stores JSONB,
                ignored_categories JSONB
            );
            CREATE TABLE IF NOT EXISTS facets (
                id SERIAL PRIMARY KEY,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data JSONB NOT NULL
            );
        `);
        console.log("✅ Tablas 'reports' y 'facets' verificadas/creadas en la base de datos.");
    } catch (err) {
        console.error("❌ Error inicializando DB:", err);
    } finally {
        client.release();
    }
};

module.exports = { pool, initDB };
