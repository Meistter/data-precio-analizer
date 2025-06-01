const axios = require('axios');
const fs = require('fs');

const FILE_PATH = 'stores_statsMediana.json';
const FILE_PATH2 = 'stores_statsMedia.json';
const RESULTS_PATH = 'resultadosMEDIANA.txt';
const RESULTS_PATH2 = 'resultadosMEDIA.txt';
const IGNORE_FILE = 'ignore_stores.json';
const IGNORE_CATEGORIES_FILE = 'ignore_categories.json';
const BASE_URL = 'https://dataprecio-com-backend.onrender.com/api/search?categoria=';
const FACETS_URL = 'https://dataprecio-com-backend.onrender.com/api/facets?';
const MIN_PRODUCT_COUNT = 3;

const fecha = () => {
  const hoy = new Date();
  const dia = hoy.getDate().toString().padStart(2, '0');
  const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
  const año = hoy.getFullYear().toString();
  
  return `${dia}/${mes}/${año}`;
};

// Función para calcular la mediana
const calcularMediana = (arr) => {
  const ordenado = arr.slice().sort((a, b) => a - b);
  const mitad = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 === 0
    ? (ordenado[mitad - 1] + ordenado[mitad]) / 2
    : ordenado[mitad];
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
                            .filter(([tienda, precios]) => precios.length >= MIN_PRODUCT_COUNT)
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
        let bestStoresByCategory = {}; // Nuevo objeto para agrupar supermercados por categoría donde fueron TOP 1

        Object.keys(storesData).forEach(query => {
            let storePricesQuery = {};

            Object.entries(storesData[query]).forEach(([tienda, precios]) => {
                if (ignoreStores.includes(tienda)) return;

                storePricesQuery[tienda] = {
                    precio_mediana: calcularMediana(precios),
                    cantidad_productos: precios.length
                };
            });

            let sortedStoresQuery = Object.entries(storePricesQuery)
                .map(([tienda, stats]) => ({
                    tienda,
                    ...stats
                }))
                .sort((a, b) => a.precio_mediana - b.precio_mediana)
                .slice(0, 3);

            sortedStoresQuery.forEach((store, index) => {
                if (!storeRankings[store.tienda]) {
                    storeRankings[store.tienda] = { first: 0, second: 0, third: 0, total: 0 };
                }
                if (index === 0) {
                    storeRankings[store.tienda].first += 1;
                    if (!bestStoresByCategory[store.tienda]) {
                        bestStoresByCategory[store.tienda] = [];
                    }
                    bestStoresByCategory[store.tienda].push(query);
                }
                storeRankings[store.tienda].total += 1;
            });

            topStoresPerQuery[query] = sortedStoresQuery;
        });

        let sortedOverallStores = Object.entries(storeRankings)
            .map(([tienda, { total }]) => ({
                tienda,
                total
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 3);

        let resultsContent = `🏆 Ranking de los 3 mejores supermercados para comprar (Usando mediana). Generado el: ${fecha()}:\n\n`;
        const medals = ["🥇", "🥈", "🥉"];
        sortedOverallStores.forEach((store, index) => {
            resultsContent += `${medals[index]} ${store.tienda} \n`;
        });

        resultsContent += `\nMejores lugares donde comprar por Rubro:\n\n`;
        Object.entries(bestStoresByCategory).forEach(([store, categories]) => {
            resultsContent += `➡️ ${store}: ${categories.join(", ")}\n`;
        });

        resultsContent += `\nTop 3 mejores supermercados por cada Rubro:\n\n`;
        Object.keys(topStoresPerQuery).forEach(query => {
            resultsContent += `➡️ ${query}:\n`;
            topStoresPerQuery[query].forEach((store, index) => {
                resultsContent += `${index + 1}. ${store.tienda} - Precio mediana: $${store.precio_mediana.toFixed(2)} (Productos analizados: ${store.cantidad_productos})\n`;
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


async function fetchCategories2() {
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

async function fetchAllPages2(query) {
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

async function processQueries2() {
    try {
        const ignoreStores = JSON.parse(fs.readFileSync(IGNORE_FILE));
        const useStoredData = process.argv[2] === "1";

        if (useStoredData) {
            console.log("📂 Leyendo el JSON almacenado...");
            analyzeStoreStats2();
            return;
        }

        const queries = await fetchCategories2();
        if (queries.length === 0) {
            console.error("❌ No se pudieron obtener categorías, abortando ejecución.");
            return;
        }

        let allStoresData = {};

        for (const query of queries) {
            console.log(`🔎 Ejecutando búsqueda para: ${query}`);
            const storesData = await fetchAllPages2(query);

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

        fs.writeFileSync(FILE_PATH2, JSON.stringify(allStoresData, null, 2));
        console.log(`✅ Todos los datos guardados en ${FILE_PATH2}`);
        analyzeStoreStats2();
    } catch (error) {
        console.error('Error al procesar los queries:', error.message);
    }
}

function analyzeStoreStats2() {
    try {
        const rawData = fs.readFileSync(FILE_PATH2);
        const storesData = JSON.parse(rawData);
        const ignoreStores = JSON.parse(fs.readFileSync(IGNORE_FILE));

        let storeRankings = {};
        let topStoresPerQuery = {};
        let bestStoresByCategory = {}; // Nuevo objeto para agrupar supermercados por categoría donde fueron TOP 1

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
                if (index === 0) {
                    storeRankings[store.tienda].first += 1;
                    if (!bestStoresByCategory[store.tienda]) {
                        bestStoresByCategory[store.tienda] = [];
                    }
                    bestStoresByCategory[store.tienda].push(query);
                }
                storeRankings[store.tienda].total += 1;
            });

            topStoresPerQuery[query] = sortedStoresQuery;
        });

        let sortedOverallStores = Object.entries(storeRankings)
            .map(([tienda, { total }]) => ({
                tienda,
                total
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 3);

        let resultsContent = `🏆 Ranking de los 3 mejores supermercados para comprar (Usando promedio). Generado el: ${fecha()}:\n\n`;
        const medals = ["🥇", "🥈", "🥉"];
        sortedOverallStores.forEach((store, index) => {
            resultsContent += `${medals[index]} ${store.tienda} \n`;
        });

        resultsContent += `\nMejores lugares donde comprar por Rubro:\n\n`;
        Object.entries(bestStoresByCategory).forEach(([store, categories]) => {
            resultsContent += `➡️ ${store}: ${categories.join(", ")}\n`;
        });

        resultsContent += `\nTop 3 mejores supermercados por cada Rubro:\n\n`;
        Object.keys(topStoresPerQuery).forEach(query => {
            resultsContent += `➡️ ${query}:\n`;
            topStoresPerQuery[query].forEach((store, index) => {
                resultsContent += `${index + 1}. ${store.tienda} - Precio promedio: $${store.precio_promedio.toFixed(2)} (Productos analizados: ${store.cantidad_productos})\n`;
            });
            resultsContent += `\n`;
        });

        fs.writeFileSync(RESULTS_PATH2, resultsContent);
        console.log(`📊 Resultados generados y guardados en ${RESULTS_PATH2}`);
    } catch (error) {
        console.error('Error al analizar los datos:', error.message);
    }
}

processQueries2();
