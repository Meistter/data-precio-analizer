const axios = require('axios');
const fs = require('fs');

const FILE_PATH = 'products_db.json';
const RESULTS_PATH = 'ranking_supermercados.txt';
const IGNORE_FILE = 'ignore_stores.json';
const IGNORE_CATEGORIES_FILE = 'ignore_categories.json';
const BASE_URL = 'https://www.dataprecio.com/api/search?categoria=';
const FACETS_URL = 'https://www.dataprecio.com/api/search?&t=1769885378814';
const MIN_SHARED_PRODUCTS = 5; // Mínimo de productos comparables para incluir tienda en el ranking

const fecha = () => {
  const hoy = new Date();
  const dia = hoy.getDate().toString().padStart(2, '0');
  const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
  const año = hoy.getFullYear().toString();
  
  return `${dia}/${mes}/${año}`;
};

async function fetchCategories() {
    try {
        console.log("🔎 Consultando categorías...");
        const response = await axios.get(FACETS_URL);
        const facets = response.data.facets || {};
        const rawCategories = facets.categoria || [];
        let categories = rawCategories.map(item => item.value);
        const ignoreCategories = JSON.parse(fs.readFileSync(IGNORE_CATEGORIES_FILE));
        categories = categories.filter(category => !ignoreCategories.includes(category));
        console.log(`✅ Categorías obtenidas después de filtrar: ${categories.length}`);
        return categories;
    } catch (error) {
        console.error("❌ Error al obtener categorías:", error.message);
        return [];
    }
}

async function fetchAllPages(query) {
    try {
        const firstResponse = await axios.get(`${BASE_URL}${encodeURIComponent(query)}&page=1`);
        const totalPages = firstResponse.data.totalPages || 1;

        console.log(`Total de páginas encontradas para '${query}': ${totalPages}`);

        let products = [];

        for (let page = 1; page <= totalPages; page++) {
            console.log(`Consumiendo página ${page} de '${query}'...`);
            const response = await axios.get(`${BASE_URL}${encodeURIComponent(query)}&page=${page}`);
            const data = response.data.hits;

            if (Array.isArray(data)) {
                // Guardamos los productos tal cual vienen, sin agrupar por tienda todavía
                // para no perder la referencia de qué producto es.
                products.push(...data);
            }
        }

        return products;
    } catch (error) {
        console.error(`Error al obtener datos para '${query}':`, error.message);
        return null;
    }
}

async function processQueries() {
    try {
        const ignoreStores = JSON.parse(fs.readFileSync(IGNORE_FILE));
        const useStoredData = process.argv[2] === "1";

        if (useStoredData) {
            console.log("📂 Leyendo el JSON almacenado...");
            analyzeStoreStats();
            return;
        }

        const queries = await fetchCategories();
        if (queries.length === 0) {
            console.error("❌ No se pudieron obtener categorías, abortando ejecución.");
            return;
        }

        let allProductsMap = {};

        for (const query of queries) {
            console.log(`🔎 Ejecutando búsqueda para: ${query}`);
            const products = await fetchAllPages(query);

            if (products) {
                products.forEach(product => {
                    // Usamos productID como clave para evitar duplicados si un producto sale en varias categorías
                    if (!allProductsMap[product.productID]) {
                        allProductsMap[product.productID] = product;
                    }
                });
            }
        }

        fs.writeFileSync(FILE_PATH, JSON.stringify(allProductsMap, null, 2));
        console.log(`✅ Base de datos de productos guardada en ${FILE_PATH}`);
        analyzeStoreStats();
    } catch (error) {
        console.error('Error al procesar los queries:', error.message);
    }
}

function analyzeStoreStats() {
    try {
        const rawData = fs.readFileSync(FILE_PATH);
        const productsMap = JSON.parse(rawData);
        const ignoreStores = JSON.parse(fs.readFileSync(IGNORE_FILE));

        let storeStats = {}; // { StoreName: { sumStorePrice: 0, sumMarketPrice: 0, count: 0 } }

        // 1. Iterar productos para calcular el Índice de Precios
        Object.values(productsMap).forEach(product => {
            if (!product.tiendas || product.tiendas.length < 2) return; // Solo productos que estén en al menos 2 tiendas para comparar

            // Filtrar tiendas ignoradas
            const validStores = product.tiendas.filter(t => !ignoreStores.includes(t.tienda));
            if (validStores.length < 2) return;

            // Calcular precio promedio del producto en el mercado actual
            const avgPrice = validStores.reduce((sum, t) => sum + t.precio, 0) / validStores.length;

            // Calcular totales para cada tienda (Suma de precios vs Suma de promedios)
            validStores.forEach(t => {
                const storeName = t.tienda;

                if (!storeStats[storeName]) {
                    storeStats[storeName] = { sumStorePrice: 0, sumMarketPrice: 0, count: 0 };
                }
                storeStats[storeName].sumStorePrice += t.precio;
                storeStats[storeName].sumMarketPrice += avgPrice;
                storeStats[storeName].count++;
            });
        });

        // 2. Calcular el Índice Global por tienda (Cesta Agregada)
        let rankings = Object.entries(storeStats)
            .map(([store, data]) => ({
                tienda: store,
                indiceGlobal: (data.sumStorePrice / data.sumMarketPrice),
                productosComparados: data.count
            }))
            .filter(r => r.productosComparados >= MIN_SHARED_PRODUCTS) // Filtrar tiendas con poca data comparable
            .sort((a, b) => a.indiceGlobal - b.indiceGlobal); // Menor índice es mejor

        // 3. Generar Reporte
        let resultsContent = `🏆 Ranking de Supermercados por Costo de Cesta (Impacto real en el bolsillo). Generado el: ${fecha()}:\n`;
        resultsContent += `(Comparación de la suma de precios de productos idénticos vs el promedio del mercado)\n\n`;
        
        const medals = ["🥇", "🥈", "🥉"];
        
        rankings.forEach((r, index) => {
            const medal = medals[index] || `${index + 1}.`;
            const percentage = ((r.indiceGlobal - 1) * 100).toFixed(2);
            const status = r.indiceGlobal < 1 ? "más barato" : "más caro";
            resultsContent += `${medal} ${r.tienda}\n   Índice: ${r.indiceGlobal.toFixed(4)} (${Math.abs(percentage)}% ${status} que el promedio)\n   Productos comparados: ${r.productosComparados}\n\n`;
        });

        fs.writeFileSync(RESULTS_PATH, resultsContent);
        console.log(`📊 Resultados generados y guardados en ${RESULTS_PATH}`);
    } catch (error) {
        console.error('Error al analizar los datos:', error.message);
    }
}

processQueries();
