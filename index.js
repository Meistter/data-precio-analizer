const axios = require('axios');
const fs = require('fs');

const FILE_PATH = 'stores_stats.json';
const RESULTS_PATH = 'resultados.txt';
const IGNORE_FILE = 'ignore_stores.json';
const IGNORE_CATEGORIES_FILE = 'ignore_categories.json';
const BASE_URL = 'https://dataprecio-com-backend.onrender.com/api/search?categoria=';
const FACETS_URL = 'https://dataprecio-com-backend.onrender.com/api/facets?';
const MIN_PRODUCT_COUNT = 5; // Número mínimo de productos analizados por categoría.
const fecha = () => {
  const hoy = new Date();
  const dia = hoy.getDate().toString().padStart(2, '0');
  const mes = (hoy.getMonth() + 1).toString().padStart(2, '0'); // Sumamos 1 porque los meses comienzan en 0
  const año = hoy.getFullYear().toString();
  
  return `${dia}/${mes}/${año}`;
};



async function fetchCategories() {
    try {
        console.log("🔎 Consultando categorías...");
        const response = await axios.get(FACETS_URL);
        let categories = response.data.categoria.map(item => item.value);

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

        let storesData = {};

        for (let page = 1; page <= totalPages; page++) {
            console.log(`Consumiendo página ${page} de '${query}'...`);
            const response = await axios.get(`${BASE_URL}${encodeURIComponent(query)}&page=${page}`);
            const data = response.data.hits;

            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (!storesData[query]) {
                        storesData[query] = {};
                    }

                    item.tiendas.forEach(tienda => {
                        if (!storesData[query][tienda.tienda]) {
                            storesData[query][tienda.tienda] = [];
                        }
                        storesData[query][tienda.tienda].push(tienda.precio);
                    });
                });
            }
        }

        return storesData;
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

        let allStoresData = {};

        for (const query of queries) {
            console.log(`🔎 Ejecutando búsqueda para: ${query}`);
            const storesData = await fetchAllPages(query);

            if (storesData) {
                Object.keys(storesData).forEach(queryKey => {
                    storesData[queryKey] = Object.fromEntries(
                        Object.entries(storesData[queryKey])
                            .filter(([tienda, precios]) => precios.length >= MIN_PRODUCT_COUNT) // Filtrar tiendas con menos de 5 productos analizados
                    );
                });

                allStoresData = { ...allStoresData, ...storesData };
            }
        }

        fs.writeFileSync(FILE_PATH, JSON.stringify(allStoresData, null, 2));
        console.log(`✅ Todos los datos guardados en ${FILE_PATH}`);
        analyzeStoreStats();
    } catch (error) {
        console.error('Error al procesar los queries:', error.message);
    }
}

function analyzeStoreStats() {
    try {
        const rawData = fs.readFileSync(FILE_PATH);
        const storesData = JSON.parse(rawData);
        const ignoreStores = JSON.parse(fs.readFileSync(IGNORE_FILE));

        let storeRankings = {};
        let topStoresPerQuery = {};

        Object.keys(storesData).forEach(query => {
            let storePricesQuery = {};

            Object.entries(storesData[query]).forEach(([tienda, precios]) => {
                if (ignoreStores.includes(tienda)) return;

                storePricesQuery[tienda] = {
                    precio_promedio: precios.reduce((sum, price) => sum + price, 0) / precios.length,
                    cantidad_productos: precios.length
                };
            });

            let sortedStoresQuery = Object.entries(storePricesQuery)
                .map(([tienda, stats]) => ({
                    tienda,
                    ...stats
                }))
                .sort((a, b) => a.precio_promedio - b.precio_promedio)
                .slice(0, 3);

            sortedStoresQuery.forEach((store, index) => {
                if (!storeRankings[store.tienda]) {
                    storeRankings[store.tienda] = { first: 0, second: 0, third: 0, total: 0 };
                }
                if (index === 0) storeRankings[store.tienda].first += 1;
                if (index === 1) storeRankings[store.tienda].second += 1;
                if (index === 2) storeRankings[store.tienda].third += 1;
                storeRankings[store.tienda].total += 1;
            });

            topStoresPerQuery[query] = sortedStoresQuery;
        });

        let sortedOverallStores = Object.entries(storeRankings)
            .map(([tienda, { total }]) => tienda)
            .sort((a, b) => storeRankings[b].total - storeRankings[a].total)
            .slice(0, 3);

        let resultsContent = `🏆 Ranking de los 3 mejores supermercados para comprar. Fecha: ${fecha()}:\n\n`;
        sortedOverallStores.forEach((store, index) => {
            resultsContent += `${index + 1}. ${store}\n`;
        });

        resultsContent += `\n🔎 Top 3 mejores supermercados por cada query:\n\n`;
        Object.keys(topStoresPerQuery).forEach(query => {
            resultsContent += `➡️ ${query}:\n`;
            topStoresPerQuery[query].forEach((store, index) => {
                resultsContent += `${index + 1}. ${store.tienda} - Precio promedio: $${store.precio_promedio.toFixed(2)} (Productos analizados: ${store.cantidad_productos})\n`;
            });
            resultsContent += `\n`;
        });

        fs.writeFileSync(RESULTS_PATH, resultsContent);
        console.log(`📊 Resultados generados y guardados en ${RESULTS_PATH}`);
    } catch (error) {
        console.error('Error al analizar los datos:', error.message);
    }
}

processQueries();
