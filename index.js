const axios = require('axios');
const fs = require('fs');

const FILE_PATH = 'products_db.json';
const BASE_URL = 'https://www.dataprecio.com/api/search?categoria=';
const MIN_SHARED_PRODUCTS = 5; // Mínimo de productos comparables para incluir tienda en el ranking

const fecha = () => {
  const hoy = new Date();
  const dia = hoy.getDate().toString().padStart(2, '0');
  const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
  const año = hoy.getFullYear().toString();
  
  return `${dia}/${mes}/${año}`;
};

async function getFacets() {
    try {
        console.log("🔎 Consultando metadatos (categorías y tiendas)...");
        const timestamp = Date.now();
        const response = await axios.get(`https://www.dataprecio.com/api/search?&t=${timestamp}`, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        const facets = data.facets || {};
        
        const categories = (facets.categoria || []).map(item => item.value);
        const stores = (facets.tienda || []).map(item => item.value);
        console.log(`✅ Metadatos obtenidos: ${categories.length} categorías, ${stores.length} tiendas.`);
        return { categories, stores };
    } catch (error) {
        console.error("❌ Error al obtener facetas:", error.message);
        return { categories: [], stores: [] };
    }
}

async function fetchAllPages(query) {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
        };

        const firstResponse = await axios.get(`${BASE_URL}${encodeURIComponent(query)}&page=1`, { headers, timeout: 15000 });
        const totalPages = firstResponse.data.totalPages || 1;

        console.log(`Total de páginas encontradas para '${query}': ${totalPages}`);

        let products = [];

        for (let page = 1; page <= totalPages; page++) {
            console.log(`Consumiendo página ${page} de '${query}'...`);
            const response = await axios.get(`${BASE_URL}${encodeURIComponent(query)}&page=${page}`, { headers, timeout: 15000 });
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

async function generateStats(ignoredCategories = [], ignoredStores = []) {
    try {
        const facets = await getFacets();
        const allCategories = facets.categories;
        
        // Filtrar categorías a procesar
        const queries = allCategories.filter(cat => !ignoredCategories.includes(cat));
        
        if (queries.length === 0) {
            throw new Error("No hay categorías seleccionadas para analizar.");
        }

        let allProductsMap = {};

        for (const query of queries) {
            console.log(`🔎 Ejecutando búsqueda para: ${query}`);
            const products = await fetchAllPages(query);

            if (products) {
                products.forEach(product => {
                    // Usamos productID como clave para evitar duplicados si un producto sale en varias categorías
                    if (!allProductsMap[product.productID]) {
                        product.category = query; // Guardamos la categoría para el análisis
                        allProductsMap[product.productID] = product;
                    }
                });
            }
        }

        // Opcional: Guardar cache local si se desea, pero para web no es estrictamente necesario
        // fs.writeFileSync(FILE_PATH, JSON.stringify(allProductsMap, null, 2));
        
        return analyzeStoreStats(allProductsMap, ignoredStores);
    } catch (error) {
        console.error('Error al procesar los queries:', error.message);
        throw error;
    }
}

function analyzeStoreStats(productsMap, ignoredStores) {
    try {
        let storeStats = {}; // { StoreName: { sumStorePrice: 0, sumMarketPrice: 0, count: 0, categories: {} } }

        // 1. Iterar productos para calcular el Índice de Precios
        Object.values(productsMap).forEach(product => {
            if (!product.tiendas || product.tiendas.length < 2) return; // Solo productos que estén en al menos 2 tiendas para comparar

            // Filtrar tiendas ignoradas
            const validStores = product.tiendas.filter(t => !ignoredStores.includes(t.tienda));
            if (validStores.length < 2) return;

            // Calcular precio promedio del producto en el mercado actual
            const avgPrice = validStores.reduce((sum, t) => sum + t.precio, 0) / validStores.length;
            const category = product.category || 'Otros';

            // Calcular totales para cada tienda (Suma de precios vs Suma de promedios)
            validStores.forEach(t => {
                const storeName = t.tienda;

                if (!storeStats[storeName]) {
                    storeStats[storeName] = { sumStorePrice: 0, sumMarketPrice: 0, count: 0, categories: {} };
                }
                storeStats[storeName].sumStorePrice += t.precio;
                storeStats[storeName].sumMarketPrice += avgPrice;
                storeStats[storeName].count++;

                // Estadísticas por categoría
                if (!storeStats[storeName].categories[category]) {
                    storeStats[storeName].categories[category] = { sumStorePrice: 0, sumMarketPrice: 0, count: 0 };
                }
                storeStats[storeName].categories[category].sumStorePrice += t.precio;
                storeStats[storeName].categories[category].sumMarketPrice += avgPrice;
                storeStats[storeName].categories[category].count++;
            });
        });

        // 2. Calcular el Índice Global por tienda (Cesta Agregada)
        let rankings = Object.entries(storeStats)
            .map(([store, data]) => {
                // Calcular top categorías más económicas
                const topCategories = Object.entries(data.categories)
                    .map(([cat, catData]) => ({
                        category: cat,
                        indice: catData.sumStorePrice / catData.sumMarketPrice,
                        count: catData.count
                    }))
                    .filter(c => c.count >= 3) // Mínimo 3 productos para considerar la categoría relevante
                    .sort((a, b) => a.indice - b.indice)
                    .slice(0, 5);

                return {
                    tienda: store,
                    indiceGlobal: (data.sumStorePrice / data.sumMarketPrice),
                    productosComparados: data.count,
                    topCategories
                };
            })
            .filter(r => r.productosComparados >= MIN_SHARED_PRODUCTS) // Filtrar tiendas con poca data comparable
            .sort((a, b) => a.indiceGlobal - b.indiceGlobal); // Menor índice es mejor

        return rankings;
    } catch (error) {
        console.error('Error al analizar los datos:', error.message);
        return [];
    }
}

module.exports = { getFacets, generateStats };
