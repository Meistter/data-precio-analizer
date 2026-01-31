require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getFacets, generateStats } = require('./index');
const { pool, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Middleware para ver en consola las peticiones que llegan
app.use((req, res, next) => {
    console.log(`📥 Petición recibida: ${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Servir el logo como archivo estático desde la raíz
app.get('/logo.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'logo.png'));
});

// Inicializar DB al arrancar
initDB();

// Endpoint para obtener metadatos (tiendas y categorías) para los checklists
app.get('/api/facets', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT data FROM facets ORDER BY updated_at DESC LIMIT 1');
        
        if (result.rows.length > 0) {
            res.json(result.rows[0].data);
        } else {
            // Si no hay en DB, obtener de API y guardar
            const data = await getFacets();
            if (data.categories.length > 0) {
                await client.query('INSERT INTO facets (data) VALUES ($1)', [JSON.stringify(data)]);
            }
            res.json(data);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo metadatos' });
    } finally {
        if (client) client.release();
    }
});

// Endpoint para forzar actualización de metadatos (Botones manuales)
app.post('/api/facets/update', async (req, res) => {
    console.log("🔄 Iniciando actualización manual de facetas...");
    let client;
    try {
        client = await pool.connect();
        const data = await getFacets();
        if (data.categories.length > 0) {
            await client.query('INSERT INTO facets (data) VALUES ($1)', [JSON.stringify(data)]);
        }
        console.log("✅ Facetas actualizadas correctamente.");
        res.json({ success: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error actualizando metadatos' });
    } finally {
        if (client) client.release();
    }
});

// Endpoint para generar un nuevo reporte
app.post('/api/generate', async (req, res) => {
    const { ignoredCategories, ignoredStores } = req.body;
    
    try {
        console.log("🚀 Iniciando generación de reporte...");
        const ranking = await generateStats(ignoredCategories || [], ignoredStores || []);
        
        // Guardar en DB
        const client = await pool.connect();
        try {
            await client.query(
                'INSERT INTO reports (ranking, ignored_stores, ignored_categories) VALUES ($1, $2, $3)',
                [JSON.stringify(ranking), JSON.stringify(ignoredStores), JSON.stringify(ignoredCategories)]
            );
        } finally {
            client.release();
        }

        res.json({ success: true, ranking });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error generando el reporte' });
    }
});

// Endpoint para obtener el último reporte
app.get('/api/latest', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM reports ORDER BY created_at DESC LIMIT 1');
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json(null);
        }
    } catch (error) {
        res.status(500).json({ error: 'Error leyendo base de datos' });
    } finally {
        if (client) client.release();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
