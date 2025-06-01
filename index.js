const axios = require('axios');
const fs = require('fs');

const FILE_PATH = 'stores_stats.json';
const RESULTS_PATH = 'resultados.txt';
const IGNORE_FILE = 'ignore_stores.json';
const IGNORE_CATEGORIES_FILE = 'ignore_categories.json';
const BASE_URL = 'https://dataprecio-com-backend.onrender.com/api/search?q=';
const FACETS_URL = 'https://dataprecio-com-backend.onrender.com/api/facets?';

async function fetchCategories() {
    try {
        console.log("🔎 Consultando categorías...");
        const response = await axios.get(FACETS_URL);
        let categories = response.data.categoria.map(item => item.value);

        // Leer las categorías a ignorar desde el archivo
        const ignoreCategories = JSON.parse(fs.readFileSync(IGNORE_CATEGORIES_FILE));

        // Filtrar categorías que estén en la lista de exclusión
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
                        storesData[query] = [];
                    }

                    item.tiendas.forEach(tienda => {
                        storesData[query].push({
                            tienda: tienda.tienda,
                            precio: tienda.precio
                        });
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
                    storesData[queryKey] = storesData[queryKey].filter(item => !ignoreStores.includes(item.tienda));
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

        let storePricesOverall = {};
        let topStoresPerQuery = {};

        Object.keys(storesData).forEach(query => {
            let storePricesQuery = {};

            storesData[query].forEach(({ tienda, precio }) => {
                if (ignoreStores.includes(tienda)) return;

                if (!storePricesOverall[tienda]) {
                    storePricesOverall[tienda] = { total: 0, count: 0 };
                }
                storePricesOverall[tienda].total += precio;
                storePricesOverall[tienda].count += 1;

                if (!storePricesQuery[tienda]) {
                    storePricesQuery[tienda] = { total: 0, count: 0 };
                }
                storePricesQuery[tienda].total += precio;
                storePricesQuery[tienda].count += 1;
            });

            let sortedStoresQuery = Object.entries(storePricesQuery)
                .map(([tienda, { total, count }]) => ({
                    tienda,
                    precio_promedio: total / count
                }))
                .sort((a, b) => a.precio_promedio - b.precio_promedio)
                .slice(0, 3);

            topStoresPerQuery[query] = sortedStoresQuery;
        });

        let sortedOverallStores = Object.entries(storePricesOverall)
            .map(([tienda, { total, count }]) => ({
                tienda,
                precio_promedio: total / count
            }))
            .sort((a, b) => a.precio_promedio - b.precio_promedio)
            .slice(0, 3);

        let resultsContent = `🏆 Ranking de los 3 mejores supermercados:\n\n`;
        const medals = ["🏅", "🥈", "🥉"];

        sortedOverallStores.forEach((store, index) => {
            resultsContent += `${medals[index]} ${store.tienda}\n`;
        });

        resultsContent += `\n🔎 Top 3 mejores supermercados por cada query:\n\n`;
        Object.keys(topStoresPerQuery).forEach(query => {
            resultsContent += `➡️ ${query}:\n`;
            topStoresPerQuery[query].forEach((store, index) => {
                resultsContent += `${index + 1}. ${store.tienda} - Precio promedio: $${store.precio_promedio.toFixed(2)}\n`;
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