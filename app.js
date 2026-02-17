/**
 * Ayık Band Sales Dashboard - Main Logic
 * No frameworks. Clean architecture.
 */

// --- State Management ---
const state = {
    rawData: [],        // Full dataset from Excel
    filteredData: [],   // Currently active dataset
    managers: [],       // List of unique managers
    targets: {},        // Manager Name -> Target (EUR)
    filters: {
        month: '',
        manager: '',
        region: '',
        city: '',
        type: '',
        currency: '',
        search: ''
    },
    settings: {
        useNormalized: true, // true = EUR Eqv, false = Original Currency
        rowsPerPage: 25,
        currentPage: 1,
        sortCol: 'date',
        sortAsc: true // Default to Ascending (Earliest first)
    },
    charts: {}, // Store Chart.js instances
    rates: { USD: 1.08, GBP: 0.85, TRY: 35.0 } // Default manual rates (EUR base)
};

// --- Constants & Config ---
const COLORS = ['#1F76AC', '#72B2E2', '#27C485', '#F1C40F', '#E74C3C', '#9B59B6', '#16A085', '#34495E', '#D35400', '#7F8C8D'];
const COLS = {
    NO: "NO",
    FIRM: "FİRMA ÜNVANI",
    DATE: "FAT. TARİHİ",
    INV_NO: "FATURA NO",
    REGION: "BÖLGE",
    CITY: "İL",
    TYPE: "CİNSİ",
    CURRENCY: "DÖVİZ CİNSİ",
    NET_TL: "KDV HARİÇ TL",
    VAT_TL: "K.D.V.",
    TOTAL_TL: "GENEL TOPLAM TL",
    NET_EUR_EQV: "KDV HARİÇ EURO KARŞILIĞI",
    NET_ORIG_EUR: "KDV HARİÇ (EURO)",
    NET_ORIG_USD: "KDV HARİÇ (USD)",
    NET_ORIG_GBP: "KDV HARİÇ (GBP)",
    MANAGER: "SATIŞ TEMSİLCİSİ"
};

const FORMATTER = {
    currency: (val, curr = 'EUR') => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: curr }).format(val),
    number: (val) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(val),
    date: (date) => date ? new Date(date).toLocaleDateString('tr-TR') : '-'
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadTargets();
    loadRates();
});

function initEvents() {
    // File Upload
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);

    // Filters
    ['filterMonth', 'filterManager', 'filterRegion', 'filterCity', 'filterType', 'filterCurrency'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => updateFilter(e.target.id, e.target.value));
    });
    document.getElementById('custSearch').addEventListener('input', (e) => updateFilter('search', e.target.value));
    document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
    document.getElementById('currencyToggle').addEventListener('change', (e) => {
        state.settings.useNormalized = e.target.checked;
        updateDashboard();
    });

    // Targets Modal
    document.getElementById('targetsBtn').addEventListener('click', openTargetsModal);
    document.getElementById('closeTargetsBtn').addEventListener('click', () => toggleModal('targetsModal', false));
    document.getElementById('saveTargetsBtn').addEventListener('click', saveTargets);
    document.getElementById('resetTargetsBtn').addEventListener('click', () => {
        if (confirm('Tüm hedefler sıfırlansın mı?')) { state.targets = {}; saveTargets(); }
    });

    // Rates Modal
    document.getElementById('ratesBtn').addEventListener('click', openRatesModal);
    document.getElementById('closeRatesBtn').addEventListener('click', () => toggleModal('ratesModal', false));
    document.getElementById('saveRatesBtn').addEventListener('click', saveRates);

    // Deal Details Modal
    document.getElementById('closeDealBtn').addEventListener('click', () => toggleModal('dealDetailsModal', false));

    // Pagination
    document.getElementById('prevPageFn').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageFn').addEventListener('click', () => changePage(1));
    document.getElementById('rowsPerPage').addEventListener('change', (e) => {
        state.settings.rowsPerPage = parseInt(e.target.value);
        state.settings.currentPage = 1;
        renderTable();
    });

    // Chart Toggles
    document.getElementById('cumulativeToggle').addEventListener('change', renderCharts);
    document.getElementById('weeklyToggle').addEventListener('change', renderCharts);

    // PDF Export
    document.getElementById('exportPdfBtn').addEventListener('click', exportDashboardToPDF);

    // Table Sort
    document.querySelectorAll('#detailTable th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (state.settings.sortCol === field) {
                state.settings.sortAsc = !state.settings.sortAsc; // toggle
            } else {
                state.settings.sortCol = field;
                state.settings.sortAsc = true;
            }
            sortData();
            renderTable();
        });
    });
}

// --- Data Parsing ---
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('uploadStatus').textContent = "Dosya okunuyor...";

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // Read first sheet
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Convert to JSON with headers
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            processRawData(jsonData);

            // UI Transition
            document.getElementById('uploadOverlay').classList.add('hidden');
            document.getElementById('mainDashboard').classList.remove('hidden');

        } catch (err) {
            console.error(err);
            document.getElementById('uploadStatus').textContent = "Error parsing file: " + err.message;
        }
    };
    reader.readAsArrayBuffer(file);
}

function populateDropdown(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    // Keep first option (All X)
    sel.innerHTML = sel.options[0].outerHTML;
    items.forEach(i => {
        if (!i) return;
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        sel.appendChild(opt);
    });
    sel.value = current;
}

function findBestColumn(row, candidates) {
    if (!row) return null;
    // Direct match
    for (const c of candidates) {
        if (row[c] !== undefined) return c;
    }
    // Fuzzy match keys
    const keys = Object.keys(row);
    for (const c of candidates) {
        const match = keys.find(k => k.toUpperCase().includes(c.toUpperCase()));
        if (match) return match;
    }
    return null;
}

function processRawData(json) {
    // Detect Columns dynamically if possible
    let tlCol = COLS.NET_TL;
    let usdCol = COLS.NET_ORIG_USD;
    let gbpCol = COLS.NET_ORIG_GBP;
    let eurOrigCol = COLS.NET_ORIG_EUR;

    if (json.length > 0) {
        const row0 = json[0];
        // Candidates
        const candidatesTL = ["KDV HARİÇ TL", "KDV HARİÇ TUTAR", "TUTAR", "NET TUTAR", "TL TUTAR", "TL"];
        const candidatesUSD = ["KDV HARİÇ (USD)", "USD TUTAR", "USD", "DOLAR"];
        const candidatesGBP = ["KDV HARİÇ (GBP)", "GBP TUTAR", "GBP", "STERLİN"];
        const candidatesEUR = ["KDV HARİÇ (EURO)", "EURO TUTAR", "EURO", "EUR", "AVRO"];

        const foundTL = findBestColumn(row0, candidatesTL);
        if (foundTL) tlCol = foundTL;

        const foundUSD = findBestColumn(row0, candidatesUSD);
        if (foundUSD) usdCol = foundUSD;

        const foundGBP = findBestColumn(row0, candidatesGBP);
        if (foundGBP) gbpCol = foundGBP;

        const foundEUR = findBestColumn(row0, candidatesEUR);
        if (foundEUR) eurOrigCol = foundEUR;
    }

    // 1. Normalize Rows
    state.rawData = json.map((row, idx) => {
        // Parse numerics
        // Use detected column or fallbacks
        const netTl = parseNumberTR(row[tlCol]);
        const netEur = parseNumberTR(row[COLS.NET_EUR_EQV]);
        const netOrigEur = parseNumberTR(row[eurOrigCol]);
        const netOrigUsd = parseNumberTR(row[usdCol]);
        const netOrigGbp = parseNumberTR(row[gbpCol]);

        // Parse date
        const dateRaw = row[COLS.DATE];
        let dateObj = null;
        if (typeof dateRaw === 'number') {
            // Excel serial date
            dateObj = new Date(Math.round((dateRaw - 25569) * 86400 * 1000));
        } else if (typeof dateRaw === 'string') {
            const parts = dateRaw.split('.');
            if (parts.length === 3) dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
        }

        return {
            id: idx,
            firm: (row[COLS.FIRM] || "").trim(),
            date: dateObj,
            invNo: row[COLS.INV_NO],
            region: (row[COLS.REGION] || "Unknown").trim(),
            city: (row[COLS.CITY] || "").trim(),
            type: (row[COLS.TYPE] || "Material").trim(), // Default to Material if empty
            currency: (row[COLS.CURRENCY] || "TL").trim(),
            netEur: netEur,
            netTl: netTl,
            netOrigEur: netOrigEur,
            netOrigUsd: netOrigUsd,
            netOrigGbp: netOrigGbp,
            excelNetEur: netEur, // Store original Excel value
            vatTl: parseNumberTR(row[COLS.VAT_TL]),
            manager: (row[COLS.MANAGER] || "Unassigned").trim()
        };
    }).filter(r => r.date && !isNaN(r.netEur)); // Filter invalid rows

    // 2. Extract Quarter info from first row
    if (state.rawData.length > 0) {
        // Detect most common Quarter/Year
        const census = {};
        state.rawData.forEach(r => {
            const y = r.date.getFullYear();
            const q = Math.floor((r.date.getMonth() + 3) / 3);
            const key = `Q${q} ${y}`;
            census[key] = (census[key] || 0) + 1;
        });

        const bestFit = Object.keys(census).reduce((a, b) => census[a] > census[b] ? a : b);
        document.getElementById('quarterLabel').textContent = bestFit;
    }

    // 3. Populate Filter Options
    populateDropdown('filterManager', [...new Set(state.rawData.map(r => r.manager))].sort());
    populateDropdown('filterRegion', [...new Set(state.rawData.map(r => r.region))].sort());
    populateDropdown('filterCity', [...new Set(state.rawData.map(r => r.city))].sort());
    populateDropdown('filterType', [...new Set(state.rawData.map(r => r.type))].sort());
    populateDropdown('filterCurrency', [...new Set(state.rawData.map(r => r.currency))].sort());

    // Months
    const months = [...new Set(state.rawData.map(r => r.date.toLocaleString('default', { month: 'long', year: 'numeric' })))];
    populateDropdown('filterMonth', months);

    // 4. Initial Filter Application
    recalculateNormalizedValues();
    state.managers = [...new Set(state.rawData.map(r => r.manager))].sort();
    applyFilters();
}

function parseNumberTR(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    // Replace dots (thousands) with empty, Replace comma (decimal) with dot
    let clean = val.toString().replace(/\./g, "").replace(",", ".");
    return parseFloat(clean) || 0;
}

// --- Filtering & Logic ---
function updateFilter(key, val) {
    if (key === 'filterMonth') state.filters.month = val;
    if (key === 'filterManager') state.filters.manager = val;
    if (key === 'filterRegion') state.filters.region = val;
    if (key === 'filterCity') state.filters.city = val;
    if (key === 'filterType') state.filters.type = val;
    if (key === 'filterCurrency') state.filters.currency = val;
    state.filters.search = key === 'search' ? val.toLowerCase() : state.filters.search;

    state.settings.currentPage = 1;
    applyFilters();
}

function resetFilters() {
    state.filters = { month: '', manager: '', region: '', city: '', type: '', currency: '', search: '' };
    document.querySelectorAll('.filter-bar select').forEach(s => s.value = "");
    document.querySelector('.filter-bar input[type="text"]').value = "";
    applyFilters();
}

function applyFilters() {
    state.filteredData = state.rawData.filter(row => {
        const rowMonth = row.date.toLocaleString('default', { month: 'long', year: 'numeric' });

        return (!state.filters.month || rowMonth === state.filters.month) &&
            (!state.filters.manager || row.manager === state.filters.manager) &&
            (!state.filters.region || row.region === state.filters.region) &&
            (!state.filters.city || row.city === state.filters.city) &&
            (!state.filters.type || row.type === state.filters.type) &&
            (!state.filters.currency || row.currency === state.filters.currency) &&
            (!state.filters.search || row.firm.toLowerCase().includes(state.filters.search));
    });

    state.settings.currentPage = 1; // Reset pagination
    updateDashboard();
}

function updateDashboard() {
    try { renderKPIs(); } catch (e) { console.error("KPI Error:", e); }
    try { renderCharts(); } catch (e) { console.error("Chart Error:", e); }
    try { renderTopManagerCustomers(); } catch (e) { console.error("Top Customers Error:", e); }
    try {
        sortData();
        renderTable();
    } catch (e) { console.error("Table Error:", e); }
}

// --- KPIs ---
function renderKPIs() {
    const d = state.filteredData;
    const isNorm = state.settings.useNormalized;

    // Net Sales Logic (Multi-Currency Support)
    // 1. Calculate Sums per original currency (Robust detection)

    const sums = { EUR: 0, USD: 0, GBP: 0, TRY: 0 };

    d.forEach(r => {
        const curr = (r.currency || "TL").trim().toUpperCase();

        if (curr === 'TL' || curr === 'TRY' || curr === 'TRL') {
            sums.TRY += (r.netTl || 0);
        } else if (curr === 'USD' || curr.includes('DOLAR')) {
            sums.USD += (r.netOrigUsd || 0);
        } else if (curr === 'GBP' || curr.includes('STERLİN')) {
            sums.GBP += (r.netOrigGbp || 0);
        } else if (curr.includes('EUR') || curr === 'EURO') {
            sums.EUR += (r.netOrigEur || r.netEur);
        } else {
            // Default to TL if unknown
            sums.TRY += (r.netTl || 0);
        }
    });

    let displayHtml = "";
    let effectiveTotalEur = 0;

    if (isNorm) {
        // --- NORMALIZED (FROM EXCEL) ---
        // As requested, use 'KDV HARİÇ EURO KARŞILIĞI' directly
        effectiveTotalEur = d.reduce((acc, row) => acc + row.netEur, 0);
        displayHtml = FORMATTER.currency(effectiveTotalEur, 'EUR');
    } else {
        // --- ORIGINAL CURRENCIES (SPLIT) ---
        const rowsHTML = [];
        if (sums.EUR > 0) rowsHTML.push(`<div class="currency-row"><span class="curr-label">EUR</span><span class="curr-value">${FORMATTER.currency(sums.EUR, 'EUR')}</span></div>`);
        if (sums.USD > 0) rowsHTML.push(`<div class="currency-row"><span class="curr-label">USD</span><span class="curr-value">${FORMATTER.currency(sums.USD, 'USD')}</span></div>`);
        if (sums.GBP > 0) rowsHTML.push(`<div class="currency-row"><span class="curr-label">GBP</span><span class="curr-value">${FORMATTER.currency(sums.GBP, 'GBP')}</span></div>`);
        if (sums.TRY > 0) rowsHTML.push(`<div class="currency-row"><span class="curr-label">TL</span><span class="curr-value">${FORMATTER.currency(sums.TRY, 'TRY')}</span></div>`);

        displayHtml = rowsHTML.length ? `<div class="currency-breakdown">${rowsHTML.join('')}</div>` : "0 €";

        // Approx total for internal logic
        effectiveTotalEur = d.reduce((sum, r) => sum + r.netEur, 0);
    }

    // Set HTML instead of TextContent to allow complex structure
    document.getElementById('kpiNetSales').innerHTML = displayHtml;
    // Reset font size since we control inner elements now
    document.getElementById('kpiNetSales').style.fontSize = '';

    // Counts
    document.getElementById('kpiInvoices').textContent = d.length;
    const uniqueCust = new Set(d.map(r => r.firm)).size;
    document.getElementById('kpiCustomers').textContent = uniqueCust;

    // Avg
    const avg = d.length ? effectiveTotalEur / d.length : 0;
    document.getElementById('kpiAvgInv').textContent = FORMATTER.currency(avg, 'EUR');

    // VAT
    // Product vs Service (Robust Logic: "SERVİS" keyword in type -> Service, else Product)
    let serviceTotal = 0;
    let productTotal = 0;

    d.forEach(r => {
        const typeUpper = (r.type || "").toLocaleUpperCase('tr-TR');
        if (typeUpper.includes('SERVİS') || typeUpper.includes('HİZMET')) {
            serviceTotal += r.netEur;
        } else {
            productTotal += r.netEur;
        }
    });

    // Render Mini KPI Chart
    const ctxKpiMix = document.getElementById('kpiChartMix').getContext('2d');
    const mixData = [
        { label: 'Ürün', value: productTotal, color: '#1F76AC' },
        { label: 'Servis', value: serviceTotal, color: '#F1C40F' }
    ];

    createOrUpdateChart('kpiMix', ctxKpiMix, {
        type: 'doughnut',
        data: {
            labels: mixData.map(d => d.label),
            datasets: [{
                data: mixData.map(d => d.value),
                backgroundColor: mixData.map(d => d.color),
                borderWidth: 0
            }]
        },
        options: {
            cutout: '70%',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
        }
    });

    // Generate Mini Legend
    generateLegend('kpiLegendMix', mixData);

    // Target Attainment
    // Sum actuals for managers who HAVE targets
    let targetSum = 0;
    let actualForTarget = 0;

    // Group by manager to check targets
    const mgrs = [...new Set(d.map(r => r.manager))];
    mgrs.forEach(m => {
        if (state.targets[m] > 0) {
            targetSum += state.targets[m];
            actualForTarget += d.filter(r => r.manager === m).reduce((s, x) => s + x.netEur, 0);
        }
    });

    if (targetSum > 0) {
        // User requested: (Total Net Sales / Total Targets) * 100
        // effectiveTotalEur is the total net sales (converted/normalized)
        const attainment = (effectiveTotalEur / targetSum) * 100;
        document.getElementById('kpiTargetAttainment').textContent = `Hedef: %${attainment.toFixed(1)}`;

        // Optional: Colorize based on attainment (e.g. Green if > 100)
        const kpiValEl = document.getElementById('kpiNetSales');
        if (attainment >= 100) kpiValEl.style.color = '#27C485';
        else kpiValEl.style.color = '';

        // Update Progress Bar
        const bar = document.getElementById('globalProgressBar');
        const text = document.getElementById('globalProgressText');
        if (bar && text) {
            bar.style.width = `${Math.min(attainment, 100)}%`;
            text.textContent = `%${attainment.toFixed(1)}`;
        }

    } else {
        document.getElementById('kpiTargetAttainment').textContent = "Hedef: --";
        document.getElementById('kpiNetSales').style.color = '';

        // Reset Progress Bar
        const bar = document.getElementById('globalProgressBar');
        const text = document.getElementById('globalProgressText');
        if (bar && text) {
            bar.style.width = '0%';
            text.textContent = '0%';
        }
    }
}

// --- Charts ---
function renderCharts() {
    const ctxTrend = document.getElementById('chartTrend').getContext('2d');
    const ctxMgr = document.getElementById('chartManager').getContext('2d');
    const ctxCurr = document.getElementById('chartCurrency').getContext('2d');
    const ctxReg = document.getElementById('chartRegion').getContext('2d');

    Chart.defaults.color = '#4A5568'; // Dark Gray Text
    Chart.defaults.borderColor = '#E2E8F0'; // Light Gray Grid

    // 1. Trend Chart (Dual Mode: Stacked Bar vs Cumulative Line)
    const isCumulative = document.getElementById('cumulativeToggle').checked;
    const isWeekly = document.getElementById('weeklyToggle').checked;

    // Update Header
    document.querySelector('#chartTrend').closest('.card').querySelector('h3').textContent =
        `Satış Trendi (${isWeekly ? 'Haftalık' : 'Günlük'})`;

    // Data Preparation
    const labelsMap = {}; // Key -> Label
    const dateSet = new Set();
    const managerSet = new Set();
    const pivot = {};

    state.filteredData.forEach(r => {
        let key, label;
        if (isWeekly) {
            const [year, week] = getISOWeekNumber(r.date);
            key = `${year}-W${week.toString().padStart(2, '0')}`;
            label = `H${week}, ${year}`;
        } else {
            // Use Local Date components to align with input data (which is local-based)
            const y = r.date.getFullYear();
            const m = String(r.date.getMonth() + 1).padStart(2, '0');
            const d = String(r.date.getDate()).padStart(2, '0');
            key = `${y}-${m}-${d}`;
            label = r.date.toLocaleDateString('tr-TR');
        }

        labelsMap[key] = label;
        dateSet.add(key);
        managerSet.add(r.manager);

        if (!pivot[key]) pivot[key] = {};
        pivot[key][r.manager] = (pivot[key][r.manager] || 0) + r.netEur;
    });

    let sortedDates = [...dateSet].sort();

    // Gap Filling: Ensure the chart displays the full time range (e.g. Full Year)
    // even if specific days have zero sales.
    const boundData = state.filteredData.length > 0 ? state.filteredData : state.rawData;

    if (boundData.length > 0) {
        // Use Local Year for min/max
        const years = [...new Set(boundData.map(r => r.date.getFullYear()))].sort();
        const minYear = years[0];
        const maxYear = years[years.length - 1];

        let startD, endD;
        // Only use month boundary if we have data for it, otherwise fallback to full year
        if (state.filters.month && state.filteredData.length > 0) {
            // Fill current month (Local boundaries)
            const minDate = new Date(Math.min(...state.filteredData.map(r => r.date)));
            startD = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
            endD = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 0);
        } else {
            // Use actual min/max from data
            const timestamps = boundData.map(r => r.date.getTime());
            if (timestamps.length > 0) {
                startD = new Date(Math.min(...timestamps));
                endD = new Date(Math.max(...timestamps));
            } else {
                // Fallback if no data (though boundData check above prevents this)
                startD = new Date(minYear, 0, 1);
                endD = new Date(maxYear, 11, 31);
            }
        }

        const filledDates = [];
        const curr = new Date(startD); // Local copy

        if (isWeekly) {
            while (curr <= endD) {
                const [y, w] = getISOWeekNumber(curr);
                const k = `${y}-W${w.toString().padStart(2, '0')}`;
                if (!filledDates.includes(k)) {
                    filledDates.push(k);
                    if (!labelsMap[k]) labelsMap[k] = `H${w}, ${y}`;
                }
                curr.setDate(curr.getDate() + 1);
            }
        } else {
            while (curr <= endD) {
                const y = curr.getFullYear();
                const m = String(curr.getMonth() + 1).padStart(2, '0');
                const d = String(curr.getDate()).padStart(2, '0');
                const k = `${y}-${m}-${d}`;

                filledDates.push(k);
                if (!labelsMap[k]) labelsMap[k] = curr.toLocaleDateString('tr-TR');

                curr.setDate(curr.getDate() + 1);
            }
        }
        sortedDates = filledDates.sort(); // String sort works well for ISO keys
    }

    const sortedManagers = [...managerSet].sort();

    let datasets = [];
    let chartType = 'bar';
    let scalesConfig = {};

    if (isCumulative) {
        // --- CUMULATIVE LINE CHART ---
        chartType = 'line';

        // Initialize accumulators
        let grandTotalAcc = 0;
        const mgrAcc = {};
        sortedManagers.forEach(m => mgrAcc[m] = 0);

        // Data arrays
        const grandTotalData = [];
        const mgrDataArrays = {}; // { mgrName: [v1, v2...] }
        sortedManagers.forEach(m => mgrDataArrays[m] = []);

        // Calculate running totals
        sortedDates.forEach(dKey => {
            let dayTotal = 0;
            sortedManagers.forEach(m => {
                const val = pivot[dKey] && pivot[dKey][m] ? pivot[dKey][m] : 0;
                mgrAcc[m] += val;
                dayTotal += val;
                mgrDataArrays[m].push(mgrAcc[m]);
            });
            grandTotalAcc += dayTotal;
            grandTotalData.push(grandTotalAcc);
        });

        // 1. Grand Total Line
        datasets.push({
            label: 'TOPLAM Kümülatif',
            data: grandTotalData,
            borderColor: '#CBD5E0', // Darker Gray for Light Mode
            borderWidth: 3,
            borderDash: [],
            pointRadius: 0,
            tension: 0.1,
            fill: false
        });

        // 2. Manager Lines
        sortedManagers.forEach((mgr, idx) => {
            datasets.push({
                label: mgr,
                data: mgrDataArrays[mgr],
                borderColor: COLORS[idx % COLORS.length],
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                fill: false,
                hidden: false // show all by default
            });
        });

        scalesConfig = {
            x: { grid: { color: '#E2E8F0' } },
            y: { grid: { color: '#E2E8F0' } }
        };

    } else {
        // --- DAILY STACKED BAR CHART ---
        chartType = 'bar';
        datasets = sortedManagers.map((mgr, idx) => {
            return {
                label: mgr,
                data: sortedDates.map(dKey => pivot[dKey] ? (pivot[dKey][mgr] || 0) : 0),
                backgroundColor: COLORS[idx % COLORS.length],
                barThickness: 'flex',
                maxBarThickness: 30
            };
        });

        scalesConfig = {
            x: { stacked: true, grid: { color: '#E2E8F0' } },
            y: { stacked: true, grid: { color: '#E2E8F0' } }
        };
    }

    createOrUpdateChart('trend', ctxTrend, {
        type: chartType,
        data: {
            labels: sortedDates.map(d => labelsMap[d]),
            datasets: datasets
        },
        options: {
            maintainAspectRatio: false,
            scales: scalesConfig,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: isCumulative } },
                tooltip: { mode: 'index', intersect: false }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });

    // 2. Manager Performance (Layered Progress Bar)
    const mgrMap = {};
    state.filteredData.forEach(r => {
        mgrMap[r.manager] = (mgrMap[r.manager] || 0) + r.netEur;
    });

    const mgrKeys = Object.keys(mgrMap).sort((a, b) => mgrMap[b] - mgrMap[a]); // Sort by Sales Desc
    const actuals = mgrKeys.map(k => mgrMap[k]);
    const targets = mgrKeys.map(k => state.targets[k] || 0);

    // Conditional Colors for Actuals
    const performanceColors = mgrKeys.map((k, i) => {
        const acc = actuals[i];
        const tgt = targets[i];
        if (!tgt) return '#72B2E2'; // No target = Blue default
        return acc >= tgt ? '#27C485' : '#E74C3C'; // Green if >= Target, Red if <
    });

    // Rich Labels
    const richLabels = mgrKeys.map((k, i) => {
        const acc = actuals[i];
        const tgt = targets[i];
        const pct = tgt > 0 ? Math.round((acc / tgt) * 100) : 0;
        return `${k} (${tgt ? pct + '%' : 'No Target'})`;
    });

    createOrUpdateChart('mgr', ctxMgr, {
        type: 'bar',
        data: {
            labels: richLabels,
            datasets: [
                // Actuals (Foreground)
                {
                    label: 'Gerçekleşen',
                    data: actuals,
                    backgroundColor: performanceColors,
                    borderRadius: 4,
                    barPercentage: 0.6,
                    order: 1, // Draw on top
                    grouped: false // Allow overlap
                },
                // Targets (Background Track)
                {
                    label: 'Hedef',
                    data: targets,
                    backgroundColor: '#CBD5E0', // Light Gray track

                    borderRadius: 4,
                    barPercentage: 0.6,
                    order: 2, // Draw behind
                    grouped: false // Allow overlap
                }
            ]
        },
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: '#E2E8F0' },
                    beginAtZero: true,
                    ticks: { color: '#718096' }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#2D3748',
                        font: { weight: 'bold' }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const raw = ctx.raw;
                            return ` ${ctx.dataset.label}: ${FORMATTER.currency(raw, 'EUR')}`;
                        }
                    }
                },
                legend: {
                    labels: { color: '#718096' }
                }
            }
        }
    });

    // 3. Currency Doughnut
    const currMap = {};
    state.filteredData.forEach(r => {
        currMap[r.currency] = (currMap[r.currency] || 0) + r.netEur;
    });

    const currKeys = Object.keys(currMap).sort((a, b) => currMap[b] - currMap[a]);
    const currLegendData = currKeys.map((k, i) => ({
        label: k,
        value: currMap[k],
        color: ['#1F76AC', '#72B2E2', '#27C485', '#F1C40F', '#E74C3C'][i % 5]
    }));

    createOrUpdateChart('curr', ctxCurr, {
        type: 'doughnut',
        data: {
            labels: currKeys,
            datasets: [{
                data: currLegendData.map(d => d.value),
                backgroundColor: currLegendData.map(d => d.color),
                borderWidth: 0
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            cutout: '65%'
        }
    });
    generateLegend('legendCurrency', currLegendData);

    // 4. Region Bar
    const regMap = {};
    state.filteredData.forEach(r => {
        regMap[r.region] = (regMap[r.region] || 0) + r.netEur;
    });
    const sortedReg = Object.keys(regMap).sort((a, b) => regMap[b] - regMap[a]).slice(0, 10); // Top 10

    createOrUpdateChart('reg', ctxReg, {
        type: 'bar',
        data: {
            labels: sortedReg,
            datasets: [{ label: 'Sales (€)', data: sortedReg.map(k => regMap[k]), backgroundColor: '#1F76AC' }]
        },
        options: { maintainAspectRatio: false }
    });

    // 5. Top 5 Invoices List
    // Sort by Net EUR desc
    const topDeals = [...state.filteredData]
        .sort((a, b) => b.netEur - a.netEur)
        .slice(0, 5);

    const listContainer = document.getElementById('topInvoicesList');
    if (listContainer) {
        listContainer.innerHTML = topDeals.map(r => `
            <div class="invoice-item" onclick="openDealDetails(${r.id})">
                <div class="invoice-info">
                    <div class="invoice-firm" title="${r.firm}">${r.firm.length > 22 ? r.firm.substring(0, 22) + '...' : r.firm}</div>
                    <div class="invoice-meta">${FORMATTER.date(r.date)} • ${r.manager}</div>
                </div>
                <div class="invoice-amount">${FORMATTER.currency(r.netEur, 'EUR')}</div>
            </div>
        `).join('');
    }
}

function renderTopManagerCustomers() {
    const d = state.filteredData;
    const container = document.getElementById('topManagersCustomersContainer');
    if (!container) return;
    container.innerHTML = '';

    // 1. Calculate Manager Totals
    const mgrTotals = {};
    d.forEach(r => {
        mgrTotals[r.manager] = (mgrTotals[r.manager] || 0) + r.netEur;
    });

    // 2. Get Top 3 Managers
    const topManagers = Object.keys(mgrTotals)
        .sort((a, b) => mgrTotals[b] - mgrTotals[a])
        .slice(0, 3);

    if (topManagers.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Veri bulunamadı.</p>';
        return;
    }

    // 3. For each Top Manager, find Top 5 Customers
    topManagers.forEach(mgr => {
        const mgrData = d.filter(r => r.manager === mgr);

        // Group by Customer (Firm)
        const custTotals = {};
        mgrData.forEach(r => {
            custTotals[r.firm] = (custTotals[r.firm] || 0) + r.netEur;
        });

        // Get Top 5 Customers
        const topCusts = Object.keys(custTotals)
            .sort((a, b) => custTotals[b] - custTotals[a])
            .slice(0, 5);

        // Build Card HTML
        const card = document.createElement('div');
        card.className = 'customer-rank-card';

        let listHtml = topCusts.map((c, idx) => `
            <div class="customer-rank-item">
                <div class="rank-info">
                    <span class="rank-number">${idx + 1}</span>
                    <span class="rank-firm" title="${c}">${c.length > 18 ? c.substring(0, 18) + '...' : c}</span>
                </div>
                <span class="rank-value">${FORMATTER.currency(custTotals[c], 'EUR')}</span>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="rank-card-header">
                <div class="rank-manager-name">${mgr}</div>
                <div class="rank-manager-total">Toplam: ${FORMATTER.currency(mgrTotals[mgr], 'EUR')}</div>
            </div>
            <div class="customer-rank-list">
                ${listHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

function createOrUpdateChart(key, ctx, config) {
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = new Chart(ctx, config);
}

function generateLegend(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const total = items.reduce((sum, item) => sum + item.value, 0);

    items.forEach(item => {
        const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;

        const row = document.createElement('div');
        row.className = 'legend-item';
        row.innerHTML = `
            <span class="legend-dot" style="background-color: ${item.color}"></span>
            <span class="legend-label" title="${item.label}">${item.label}</span>
            <span class="legend-val">${percent}%</span>
        `;
        container.appendChild(row);
    });
}

// --- Table & Pagination ---
function sortData() {
    const { sortCol, sortAsc } = state.settings;
    state.filteredData.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        // Custom field mapping for sort
        if (sortCol === 'net') { valA = a.netEur; valB = b.netEur; }
        if (sortCol === 'netOrig') { valA = a.netTl; valB = b.netTl; } // using TL as proxy for raw for now? Or just hide column
        if (sortCol === 'customer') { valA = a.firm; valB = b.firm; }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });
}

function changePage(delta) {
    const totalPages = Math.ceil(state.filteredData.length / state.settings.rowsPerPage);
    const newPage = state.settings.currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        state.settings.currentPage = newPage;
        renderTable();
    }
}

function renderTable() {
    const tbody = document.querySelector('#detailTable tbody');
    tbody.innerHTML = '';

    const { currentPage, rowsPerPage, useNormalized } = state.settings;
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageData = state.filteredData.slice(start, end);

    pageData.forEach(row => {
        let origVal = row.netTl;
        let origCurr = 'TL';

        switch (row.currency) {
            case 'USD': origVal = row.netOrigUsd; origCurr = 'USD'; break;
            case 'GBP': origVal = row.netOrigGbp; origCurr = 'GBP'; break;
            case 'EUR':
            case 'EURO': origVal = row.netOrigEur; origCurr = 'EUR'; break;
            default: origVal = row.netTl; origCurr = 'TL';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${FORMATTER.date(row.date)}</td>
            <td>${row.invNo}</td>
            <td title="${row.firm}">${row.firm.length > 20 ? row.firm.substring(0, 20) + '...' : row.firm}</td>
            <td>${row.manager}</td>
            <td>${row.region}</td>
            <td>${row.city}</td>
            <td>${row.type}</td>
            <td>${row.currency}</td>
            <td class="text-right text-accent">${FORMATTER.number(row.netEur)} €</td>
            <td class="text-right text-muted">${FORMATTER.number(origVal)} ${origCurr}</td>
        `;
        tbody.appendChild(tr);
    });

    // Validations & Info
    const total = state.filteredData.length;
    document.getElementById('pageInfo').textContent = `${start + 1}-${Math.min(end, total)} of ${total}`;

    // Footer total
    const pageTotal = pageData.reduce((s, r) => s + r.netEur, 0);
    // Actually footer usually shows View Total
    const viewTotal = state.filteredData.reduce((s, r) => s + r.netEur, 0);
    document.getElementById('tableTotalNet').textContent = FORMATTER.currency(viewTotal, 'EUR');
}

// --- Utils ---


function toggleModal(id, show) {
    const el = document.getElementById(id);
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

// --- Targets Logic ---
function loadTargets() {
    const saved = localStorage.getItem('ayik_targets');
    if (saved) state.targets = JSON.parse(saved);
}

function openTargetsModal() {
    // Refresh manager list in case file changed
    const list = document.getElementById('targetsList');
    list.innerHTML = '';

    const mgrs = state.managers.length ? state.managers : Object.keys(state.targets); // fallback if no file loaded

    mgrs.forEach(m => {
        const div = document.createElement('div');
        div.className = 'target-item';
        div.innerHTML = `
            <label>${m}</label>
            <input type="number" data-manager="${m}" value="${state.targets[m] || ''}" placeholder="EUR Target">
        `;
        list.appendChild(div);
    });

    toggleModal('targetsModal', true);
}

function saveTargets() {
    const inputs = document.querySelectorAll('#targetsList input');
    inputs.forEach(inp => {
        const val = parseFloat(inp.value);
        const m = inp.dataset.manager;
        if (!isNaN(val)) state.targets[m] = val;
        else delete state.targets[m]; // remove if empty
    });

    localStorage.setItem('ayik_targets', JSON.stringify(state.targets));
    toggleModal('targetsModal', false);
    updateDashboard(); // Re-calc KPI
}

// --- Rates Logic ---
function loadRates() {
    const saved = localStorage.getItem('ayik_rates');
    if (saved) state.rates = JSON.parse(saved);
}

function openRatesModal() {
    document.getElementById('rateUSD').value = state.rates.USD;
    document.getElementById('rateGBP').value = state.rates.GBP;
    document.getElementById('rateTRY').value = state.rates.TRY;
    toggleModal('ratesModal', true);
}

function saveRates() {
    const rUSD = parseFloat(document.getElementById('rateUSD').value);
    const rGBP = parseFloat(document.getElementById('rateGBP').value);
    const rTRY = parseFloat(document.getElementById('rateTRY').value);

    if (rUSD) state.rates.USD = rUSD;
    if (rGBP) state.rates.GBP = rGBP;
    if (rTRY) state.rates.TRY = rTRY;

    localStorage.setItem('ayik_rates', JSON.stringify(state.rates));
    toggleModal('ratesModal', false);

    // Recalculate all normalized values based on new rates
    recalculateNormalizedValues();

    updateDashboard();
}

function recalculateNormalizedValues() {
    state.rawData.forEach(r => {
        // Primary Source: Excel "KDV HARİÇ EURO KARŞILIĞI" column
        if (r.excelNetEur) {
            r.netEur = r.excelNetEur;
        } else {
            // Fallback: Calculate from original currency using Manual Rates
            const curr = (r.currency || "TL").trim().toUpperCase();
            if (curr === 'TL' || curr === 'TRY' || curr === 'TRL') {
                r.netEur = r.netTl / (state.rates.TRY || 1);
            } else if (curr === 'USD' || curr.includes('DOLAR')) {
                r.netEur = r.netOrigUsd / (state.rates.USD || 1);
            } else if (curr === 'GBP' || curr.includes('STERLİN')) {
                r.netEur = r.netOrigGbp / (state.rates.GBP || 1);
            } else if (curr.includes('EUR') || curr === 'EURO') {
                if (r.netOrigEur) r.netEur = r.netOrigEur;
            }
        }
    });

    // Re-apply filters to update state.filteredData
    applyFilters();
}

function openDealDetails(id) {
    const row = state.rawData.find(r => r.id === id);
    if (!row) return;

    let origVal = row.netTl;
    if (row.currency === 'USD') origVal = row.netOrigUsd;
    else if (row.currency === 'GBP') origVal = row.netOrigGbp;
    else if (row.currency === 'EUR' || row.currency === 'EURO') origVal = row.netOrigEur;

    const content = document.getElementById('dealDetailsContent');
    content.innerHTML = `
        <div class="deal-detail-row full">
            <span class="detail-label">Müşteri</span>
            <span class="detail-val">${row.firm}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Tarih</span>
            <span class="detail-val">${FORMATTER.date(row.date)}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Fatura No</span>
            <span class="detail-val">${row.invNo}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Bölge Md.</span>
            <span class="detail-val">${row.manager}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Bölge</span>
            <span class="detail-val">${row.region}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Şehir</span>
            <span class="detail-val">${row.city}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Tip</span>
            <span class="detail-val">${row.type}</span>
        </div>
        <div class="deal-detail-row">
            <span class="detail-label">Orijinal Tutar</span>
            <span class="detail-val">${FORMATTER.number(origVal)} ${row.currency}</span>
        </div>
        <div class="deal-detail-row full">
            <span class="detail-label">Net Tutar (EUR Karşılığı)</span>
            <span class="detail-val" style="color: var(--accent); font-size: 1.2rem;">${FORMATTER.currency(row.netEur, 'EUR')}</span>
        </div>
    `;
    toggleModal('dealDetailsModal', true);
}

function getISOWeekNumber(d) {
    // Copy date so don't modify original
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    // Get first day of year
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    // Calculate full weeks to nearest Thursday
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return [d.getUTCFullYear(), weekNo];

}

// --- Export PDF ---
async function exportDashboardToPDF() {
    const btn = document.getElementById('exportPdfBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Hazırlanıyor...';
    btn.disabled = true;

    try {
        // Elements to hide strictly (display: none) to save space
        const tableSection = document.querySelector('.table-section');
        const originalDisplay = tableSection ? tableSection.style.display : '';
        if (tableSection) tableSection.style.display = 'none';

        // Elements to hide visually (visibility: hidden) to keep layout
        const hiddenElements = [
            document.getElementById('ratesBtn'),
            document.getElementById('targetsBtn'),
            document.getElementById('fileInput').parentElement.parentElement, // Upload overlay if visible
            btn
        ];

        // Hide them
        hiddenElements.forEach(el => { if (el) el.style.visibility = 'hidden'; });

        const element = document.getElementById('mainDashboard');
        // Capture
        const canvas = await html2canvas(element, {
            scale: 2, // High resolution
            useCORS: true,
            logging: false,
            windowWidth: element.scrollWidth,
            windowHeight: element.scrollHeight
        });

        // Restore visibility immediately
        hiddenElements.forEach(el => { if (el) el.style.visibility = 'visible'; });
        if (tableSection) tableSection.style.display = originalDisplay;

        // Generate PDF
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const { jsPDF } = window.jspdf;

        // Calculate dimensions to fit A4 or custom size
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;

        // A4 landscape: 297mm x 210mm
        // We might want a continuous scroll or just fit width
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        const ratio = pdfWidth / imgWidth;
        const finalHeight = imgHeight * ratio;

        // If it's too long, maybe split? For now, we scale to fit width and let height be whatever (single page mainly)
        // If content > page height, we might need custom page size
        if (finalHeight > pdfHeight) {
            // Create custom size PDF matching the content aspect ratio
            const customPdf = new jsPDF('p', 'mm', [finalHeight + 20, pdfWidth]); // +20 padding
            customPdf.addImage(imgData, 'JPEG', 0, 10, pdfWidth, finalHeight);
            customPdf.save("satis-raporu.pdf");
        } else {
            pdf.addImage(imgData, 'JPEG', 0, 10, pdfWidth, finalHeight);
            pdf.save("satis-raporu.pdf");
        }

    } catch (err) {
        console.error("PDF Export Failed:", err);
        alert("PDF oluşturulurken bir hata oluştu.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
