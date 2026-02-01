const DEFAULT_IGNORED_CATEGORIES = ["Alimentos Para Bebe","Audio","Bebidas De Maquina","Bebidas Relajantes","Cargadores","Cuidado De Los Labios","Cuidado De Uñas","Cuidado Del Bebe","Cuidado Facial","Cuidado Sexual","Deslactosados","Desodorantes Clinicos","Equipos Medicos","Harinas Integrales","Licores","Mascotas","Medicamentos","Outdoor","Reposteria","Snacks Integrales","Tortas","Fumadores","Carnes Blancas De Ave","Carnes De Pescado","Carnes Rojas De Res","Carnes Blancas De Cerdo","Azucares Y Endulzantes","Cuidado Del Hogar"];
const DEFAULT_IGNORED_STORES = ["Ferreterias EPA","Licores Mundiales","Kalea","Alianza Licorera","Bodegon Be Plus Santa Fe","Celicor Boutique","Automercados Emporium"];

let currentStores = [];
let currentCategories = [];

document.addEventListener('DOMContentLoaded', () => {
    loadFacets();
    loadLatestReport();

    document.getElementById('generate-btn').addEventListener('click', generateReport);
    document.getElementById('update-stores-btn').addEventListener('click', updateFacets);
    document.getElementById('update-categories-btn').addEventListener('click', updateFacets);
    
    document.getElementById('clear-stores-btn').addEventListener('click', () => clearSelection('store'));
    document.getElementById('reset-stores-btn').addEventListener('click', () => resetSelection('store'));
    document.getElementById('clear-categories-btn').addEventListener('click', () => clearSelection('category'));
    document.getElementById('reset-categories-btn').addEventListener('click', () => resetSelection('category'));
});

async function loadFacets() {
    try {
        const res = await fetch('/api/facets');
        if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
        
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('El servidor no devolvió JSON válido. ¿Estás en el puerto correcto (3000)?');
        }
        
        if (data.error) throw new Error(data.error);

        currentStores = data.stores || [];
        currentCategories = data.categories || [];
        renderChecklist('stores-list', currentStores, 'store');
        renderChecklist('categories-list', currentCategories, 'category');
    } catch (error) {
        console.error('Error cargando facetas:', error);
        document.getElementById('stores-list').innerHTML = `<div style="color:red; padding:10px;">${error.message}</div>`;
    }
}

function renderChecklist(elementId, items, namePrefix) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';
    
    const storageKey = `ignored_${namePrefix}`;
    let ignoredItems = JSON.parse(localStorage.getItem(storageKey));

    if (ignoredItems === null) {
        if (namePrefix === 'category') {
            ignoredItems = DEFAULT_IGNORED_CATEGORIES;
        } else if (namePrefix === 'store') {
            ignoredItems = DEFAULT_IGNORED_STORES;
        } else {
            ignoredItems = [];
        }
        localStorage.setItem(storageKey, JSON.stringify(ignoredItems));
    }

    items.sort().forEach(item => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${namePrefix}-${item}`;
        checkbox.value = item;
        
        // Si el item está en la lista de ignorados, desmarcamos. Si no, marcamos por defecto.
        checkbox.checked = !ignoredItems.includes(item);
        
        checkbox.name = namePrefix; // Para agrupar si fuera form
        
        // Listener para guardar en localStorage
        checkbox.addEventListener('change', () => {
            updateLocalStorage(storageKey, item, checkbox.checked);
        });

        const label = document.createElement('label');
        label.htmlFor = `${namePrefix}-${item}`;
        label.textContent = item;
        
        div.appendChild(checkbox);
        div.appendChild(label);
        container.appendChild(div);
    });
}

function updateLocalStorage(key, item, isChecked) {
    let ignoredItems = JSON.parse(localStorage.getItem(key)) || [];
    
    if (isChecked) {
        // Si se marca, lo sacamos de la lista de ignorados (lo queremos incluir)
        ignoredItems = ignoredItems.filter(i => i !== item);
    } else {
        // Si se desmarca, lo agregamos a la lista de ignorados
        if (!ignoredItems.includes(item)) {
            ignoredItems.push(item);
        }
    }
    
    localStorage.setItem(key, JSON.stringify(ignoredItems));
}

function clearSelection(namePrefix) {
    const items = namePrefix === 'store' ? currentStores : currentCategories;
    const storageKey = `ignored_${namePrefix}`;
    // Si limpiamos la selección (desmarcamos todo), significa que TODO está ignorado.
    localStorage.setItem(storageKey, JSON.stringify(items));
    renderChecklist(namePrefix === 'store' ? 'stores-list' : 'categories-list', items, namePrefix);
}

function resetSelection(namePrefix) {
    const items = namePrefix === 'store' ? currentStores : currentCategories;
    const storageKey = `ignored_${namePrefix}`;
    const defaults = namePrefix === 'store' ? DEFAULT_IGNORED_STORES : DEFAULT_IGNORED_CATEGORIES;
    localStorage.setItem(storageKey, JSON.stringify(defaults));
    renderChecklist(namePrefix === 'store' ? 'stores-list' : 'categories-list', items, namePrefix);
}

async function updateFacets() {
    const btnStores = document.getElementById('update-stores-btn');
    const btnCats = document.getElementById('update-categories-btn');
    
    btnStores.disabled = true;
    btnCats.disabled = true;
    
    try {
        const res = await fetch('/api/facets/update', { method: 'POST' });
        const text = await res.text(); // Leemos como texto primero para ver qué devuelve el servidor
        
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            throw new Error(`Respuesta inválida del servidor: ${text.substring(0, 150)}...`);
        }

        if (result.success) {
            currentStores = result.data.stores;
            currentCategories = result.data.categories;
            renderChecklist('stores-list', currentStores, 'store');
            renderChecklist('categories-list', currentCategories, 'category');
        } else {
            throw new Error(result.error || 'Error desconocido');
        }
    } catch (error) {
        console.error('Error actualizando:', error);
        alert('Error al actualizar listas: ' + error.message);
    } finally {
        btnStores.disabled = false;
        btnCats.disabled = false;
    }
}

async function loadLatestReport() {
    const container = document.getElementById('ranking-container');
    const dateBadge = document.getElementById('last-updated');
    
    try {
        const res = await fetch('/api/latest');
        if (!res.ok) throw new Error(`Error HTTP ${res.status}`);

        const text = await res.text();
        let report;
        try {
            report = JSON.parse(text);
        } catch (e) {
            throw new Error('Respuesta inválida del servidor');
        }
        
        if (!report) {
            container.innerHTML = '<div class="empty-state"><p>No hay reportes generados aún.</p></div>';
            dateBadge.textContent = 'Sin datos';
            return;
        }

        const date = new Date(report.created_at).toLocaleString();
        dateBadge.textContent = `Generado: ${date}`;
        
        renderRanking(report.ranking);
    } catch (error) {
        console.error('Error cargando reporte:', error);
        container.innerHTML = `<p style="color:red">Error cargando datos: ${error.message}</p>`;
    }
}

function renderRanking(ranking) {
    const container = document.getElementById('ranking-container');
    container.innerHTML = '';
    
    const medals = ["🥇", "🥈", "🥉"];
    
    ranking.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'ranking-card';
        
        const percentage = ((item.indiceGlobal - 1) * 100).toFixed(2);
        const isCheaper = item.indiceGlobal < 1;
        const statusText = isCheaper ? 'más barato' : 'más caro';
        const statusClass = isCheaper ? 'cheaper' : 'expensive';
        const medal = medals[index] || `#${index + 1}`;
        
        card.innerHTML = `
            <div class="rank-pos">${medal}</div>
            <div class="store-info">
                <h3 class="store-name">${item.tienda}</h3>
                <p class="store-stats">
                    Índice: <strong>${Number(item.indiceGlobal).toFixed(4)}</strong> 
                    <span class="index-badge ${statusClass}">
                        ${Math.abs(percentage)}% ${statusText}
                    </span>
                    que el promedio
                </p>
                <small style="color: #94a3b8;">Basado en ${item.productosComparados} productos idénticos</small>
            </div>
        `;
        
        container.appendChild(card);
    });
}

async function generateReport() {
    const btn = document.getElementById('generate-btn');
    const loader = btn.querySelector('.loader');
    const btnText = btn.querySelector('.btn-text');
    
    // Obtener seleccionados para ignorar
    // Lógica invertida: Si está marcado = Lo quiero. Si NO está marcado = Ignorar.
    const ignoredStores = Array.from(document.querySelectorAll('#stores-list input:not(:checked)')).map(cb => cb.value);
    const ignoredCategories = Array.from(document.querySelectorAll('#categories-list input:not(:checked)')).map(cb => cb.value);
    
    btn.disabled = true;
    btnText.textContent = 'Analizando... (Esto toma tiempo)';
    loader.classList.remove('hidden');
    
    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ignoredStores, ignoredCategories })
        });
        
        if (!res.ok) throw new Error(`Error HTTP ${res.status}`);

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Respuesta inválida del servidor');
        }
        
        if (data.success) {
            loadLatestReport(); // Recargar la vista
        } else {
            throw new Error(data.error || 'Error generando el reporte');
        }
    } catch (error) {
        console.error(error);
        alert('Error: ' + error.message);
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Generar Análisis';
        loader.classList.add('hidden');
    }
}
