// State
let allMonthsData = {}; // Keyed by "YYYY-MM"
let currentMonthKey = null;
let currentBankFilter = 'ALL';
let categoryChartInstance = null;
let comparisonChartInstance = null;
let topExpensesChartInstance = null;

// Categories for auto-tagging
const CATEGORY_RULES = [
    { name: 'Food & Dining', keywords: ['SWIGGY', 'ZOMATO', 'RESTO', 'HOTEL', 'SNACKS', 'GOKHANA', 'KFC', 'MCDONALDS', 'IB BILLPAY'] },
    { name: 'Groceries', keywords: ['MART', 'SUPERMARKET', 'GROCERY', 'RELIANCE FRESH', 'BASKET', 'AMAZON PAY'] },
    { name: 'Utilities', keywords: ['ELECTRICITY', 'BILL', 'RECHARGE', 'AIRTEL', 'JIO', 'BSNL', 'BESCOM'] },
    { name: 'Transport', keywords: ['UBER', 'OLA', 'RAPIDO', 'METRO', 'IRCTC', 'PETROL', 'FUEL', 'HPCL', 'BPCL', 'INDIAN OIL'] },
    { name: 'Shopping', keywords: ['AMAZON', 'FLIPKART', 'MYNTRA', 'RETAIL'] },
    { name: 'Health', keywords: ['HOSPITAL', 'PHARMACY', 'CLINIC', 'DIAGNOSTIC', 'ASG HOSPITAL'] },
    { name: 'Finance/EMI', keywords: ['EMI', 'LOAN', 'BAJAJFINOTP', 'FIBE', 'EARLYSALARY'] },
];

function categorize(narration) {
    const upperNarration = narration.toUpperCase();
    for (const rule of CATEGORY_RULES) {
        for (const keyword of rule.keywords) {
            if (upperNarration.includes(keyword)) {
                return rule.name;
            }
        }
    }
    return 'Other';
}

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-upload');
const passwordInput = document.getElementById('pdf-password');
const emptyState = document.getElementById('empty-state');
const dashboardContent = document.getElementById('dashboard-content');
const loadingOverlay = document.getElementById('loading-overlay');
const monthSelector = document.getElementById('month-selector');
const bankSelector = document.getElementById('bank-selector');
const categoryFilter = document.getElementById('category-filter');

// Initialization
async function init() {
    initNavigation();
    // In session-first mode, we don't load from a backend. 
    // Data only exists while the page is open.
    renderSettingsView();
}

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // Remove active class from all
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add to clicked
            item.classList.add('active');

            // Hide all sections
            document.getElementById('dashboard-content').classList.add('hidden');
            document.getElementById('categories-view').classList.add('hidden');
            document.getElementById('insights-view').classList.add('hidden');
            document.getElementById('settings-view').classList.add('hidden');
            document.getElementById('empty-state').classList.add('hidden');

            // Show target
            const targetId = item.getAttribute('data-target');
            if (Object.keys(allMonthsData).length === 0 && targetId !== 'settings-view') {
                document.getElementById('empty-state').classList.remove('hidden');
            } else {
                document.getElementById(targetId).classList.remove('hidden');
            }
        });
    });

    // Settings logic
    document.getElementById('clear-data-btn').addEventListener('click', () => {
        if (confirm("Are you sure you want to clear current session data?")) {
            allMonthsData = {};
            currentMonthKey = null;
            location.reload();
        }
    });
}

// Event Listeners
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFiles(Array.from(e.target.files));
});

monthSelector.addEventListener('change', (e) => {
    currentMonthKey = e.target.value;
    renderDashboard();
});

bankSelector.addEventListener('change', (e) => {
    currentBankFilter = e.target.value;
    renderDashboard();
});

categoryFilter.addEventListener('change', (e) => {
    let transactions = allMonthsData[currentMonthKey] || [];
    if (currentBankFilter !== 'ALL') transactions = transactions.filter(t => t.bank === currentBankFilter);
    renderTopExpensesChart(transactions, e.target.value);
});

// Storage (Disabled for Session-First Mode)
function saveTransactions() {
    // No-op: Data is kept in memory (allMonthsData)
}

function loadTransactions() {
    // No-op: Data is ephemeral
}

async function handleFiles(files) {
    loadingOverlay.classList.remove('hidden');

    for (const file of files) {
        if (file.type !== 'application/pdf') continue;

        try {
            const pages = await extractStructuredTextFromPDF(file, passwordInput.value);
            const parsed = parseDynamicStatement(pages);

            if (parsed.length > 0) {
                // Group by Month
                let maxMonthStr = "";
                parsed.forEach(txn => {
                    // Robust month key extraction (DD/MM/YY or DD/MM/YYYY)
                    const parts = txn.date.split('/');
                    let year = parts[2];
                    if (year.length === 2) year = "20" + year;
                    const monthKey = `${year}-${parts[1]}`;

                    if (!allMonthsData[monthKey]) allMonthsData[monthKey] = [];

                    const exists = allMonthsData[monthKey].some(existing =>
                        existing.date === txn.date &&
                        existing.amount === txn.amount &&
                        existing.balance === txn.balance &&
                        existing.bank === txn.bank
                    );

                    if (!exists) {
                        allMonthsData[monthKey].push(txn);
                    }
                    if (monthKey > maxMonthStr) maxMonthStr = monthKey;
                });

                if (!currentMonthKey || maxMonthStr > currentMonthKey) {
                    currentMonthKey = maxMonthStr;
                }
            }
        } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
        }
    }

    if (Object.keys(allMonthsData).length > 0) {
        updateMonthSelector();
        renderDashboard();
    } else {
        alert('No valid transactions found in the uploaded PDFs. Please ensure it is a standard bank statement.');
    }

    loadingOverlay.classList.add('hidden');
}

async function extractStructuredTextFromPDF(file, password) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: password });
    const pdf = await loadingTask.promise;

    let pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        // Group by Y coordinate (rounding to handle slight variations)
        const rows = {};
        textContent.items.forEach(item => {
            const y = Math.round(item.transform[5]);
            if (!rows[y]) rows[y] = [];
            rows[y].push({ x: item.transform[4], text: item.str });
        });

        // Sort rows by Y descending (PDF coordinates: bottom to top)
        const sortedY = Object.keys(rows).sort((a, b) => b - a);
        const pageRows = sortedY.map(y => {
            // Sort items in row by X ascending
            return rows[y].sort((a, b) => a.x - b.x).map(item => item.text);
        });
        pages.push(pageRows);
    }
    return pages;
}

function parseDynamicStatement(pages) {
    const transactions = [];
    let bankName = "Detected Bank";

    // 1. Detect Bank Name
    const firstPageText = pages[0].slice(0, 20).map(row => row.join(' ')).join(' ').toUpperCase();
    if (firstPageText.includes('HDFC')) bankName = 'HDFC';
    else if (firstPageText.includes('ICICI')) bankName = 'ICICI';
    else if (firstPageText.includes('AXIS')) bankName = 'AXIS';
    else if (firstPageText.includes('STATE BANK') || firstPageText.includes('SBI')) bankName = 'SBI';
    else if (firstPageText.includes('KOTAK')) bankName = 'KOTAK';
    else {
        const bankMatch = firstPageText.match(/([A-Z\s]{3,20} BANK)/);
        if (bankMatch) bankName = bankMatch[0].trim();
    }

    // 2. Identify Column Mapping
    let columnMap = null;
    let headerRowIndex = -1;
    let headerPageIndex = -1;

    const keywords = {
        date: ['date', 'txn date', 'transaction date', 'value date'],
        narration: ['narration', 'description', 'particulars', 'transaction details', 'remarks'],
        debit: ['debit', 'withdrawal', 'withdrawal amt', 'amount (dr)'],
        credit: ['credit', 'deposit', 'deposit amt', 'amount (cr)'],
        amount: ['amount', 'txn amount', 'transaction amount'],
        balance: ['balance', 'running balance', 'bal']
    };

    // Scan first 2 pages for header
    for (let p = 0; p < Math.min(pages.length, 2) && !columnMap; p++) {
        for (let r = 0; r < pages[p].length; r++) {
            const row = pages[p][r];
            const tempMap = {};
            let matches = 0;

            row.forEach((cell, index) => {
                const cellText = cell.toLowerCase().trim();
                for (const [key, list] of Object.entries(keywords)) {
                    if (list.some(k => cellText === k || (cellText.includes(k) && cellText.length < 20))) {
                        if (tempMap[key] === undefined) {
                            tempMap[key] = index;
                            matches++;
                        }
                    }
                }
            });

            // Need at least Date and Narration/Amount to be useful
            if (tempMap.date !== undefined && (tempMap.narration !== undefined || tempMap.amount !== undefined) && matches >= 3) {
                columnMap = tempMap;
                headerRowIndex = r;
                headerPageIndex = p;
                break;
            }
        }
    }

    if (!columnMap) {
        console.warn("Could not find header row. Falling back to heuristic parsing.");
        return parseHeuristic(pages, bankName);
    }

    // 3. Extract Transactions
    let prevBalance = null;

    for (let p = headerPageIndex; p < pages.length; p++) {
        let startRow = (p === headerPageIndex) ? headerRowIndex + 1 : 0;
        for (let r = startRow; r < pages[p].length; r++) {
            const row = pages[p][r];
            if (row.length < 2) continue;

            const dateStr = row[columnMap.date];
            if (!dateStr || !/\d/.test(dateStr)) {
                // Check if this is a continuation of narration from previous row
                if (transactions.length > 0 && columnMap.narration !== undefined) {
                    const extraNarration = row[columnMap.narration];
                    if (extraNarration && extraNarration.length > 3) {
                        transactions[transactions.length - 1].narration += " " + extraNarration.trim();
                    }
                }
                continue;
            }

            const date = normalizeDate(dateStr);
            if (!date) continue;

            const narration = (row[columnMap.narration] || "").trim();
            const debit = parseAmount(row[columnMap.debit]);
            const credit = parseAmount(row[columnMap.credit]);
            const amount = parseAmount(row[columnMap.amount]);
            const balance = parseAmount(row[columnMap.balance]);

            let txnAmount = 0;
            let type = 'DEBIT';

            if (debit > 0) {
                txnAmount = debit;
                type = 'DEBIT';
            } else if (credit > 0) {
                txnAmount = credit;
                type = 'CREDIT';
            } else if (amount > 0) {
                txnAmount = amount;
                // Infer type from balance if possible
                if (prevBalance !== null && balance > 0) {
                    type = (balance > prevBalance) ? 'CREDIT' : 'DEBIT';
                } else {
                    // Heuristic: check keywords
                    const lowerNarration = narration.toLowerCase();
                    if (lowerNarration.includes('salary') || lowerNarration.includes('interest') || lowerNarration.includes('refund')) {
                        type = 'CREDIT';
                    }
                }
            }

            if (txnAmount > 0) {
                transactions.push({
                    date,
                    narration: narration.substring(0, 200),
                    amount: txnAmount,
                    balance: balance || 0,
                    type,
                    category: categorize(narration),
                    bank: bankName
                });
                if (balance > 0) prevBalance = balance;
            }
        }
    }

    return transactions;
}

function parseHeuristic(pages, bankName) {
    const transactions = [];
    const dateRegex = /(\d{1,2}[\/\-\s]\d{1,2}[\/\-\s]\d{2,4})|(\d{1,2}\s+[A-Z]{3}\s+\d{2,4})/i;

    pages.forEach(page => {
        page.forEach(row => {
            const rowText = row.join(' ');
            const dateMatch = rowText.match(dateRegex);
            if (!dateMatch) return;

            const date = normalizeDate(dateMatch[0]);
            if (!date) return;

            // Find numeric values in the row
            const numbers = row
                .map(cell => parseAmount(cell))
                .filter(n => n > 0);

            if (numbers.length >= 2) {
                // Assume last number is balance, second to last is amount
                const balance = numbers[numbers.length - 1];
                const amount = numbers[numbers.length - 2];

                // Try to find narration (longest string that isn't a date or number)
                let narration = "";
                row.forEach(cell => {
                    if (cell.length > narration.length && !dateRegex.test(cell) && isNaN(parseAmount(cell))) {
                        narration = cell;
                    }
                });

                transactions.push({
                    date,
                    narration: narration.trim() || "Transaction",
                    amount: amount,
                    balance: balance,
                    type: 'DEBIT', // Default, difficult to infer without header
                    category: categorize(narration),
                    bank: bankName
                });
            }
        });
    });
    return transactions;
}

function normalizeDate(dateStr) {
    if (!dateStr) return null;
    // Clean up
    dateStr = dateStr.trim().replace(/\s+/g, ' ');

    // Handle DD/MM/YY or DD/MM/YYYY
    let match = dateStr.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (match) {
        let d = match[1].padStart(2, '0');
        let m = match[2].padStart(2, '0');
        let y = match[3];
        if (y.length === 2) y = "20" + y;
        return `${d}/${m}/${y.substring(2)}`;
    }

    // Handle DD-MMM-YYYY (e.g., 01-Jan-2024)
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    match = dateStr.match(/(\d{1,2})[\-\s]([A-Za-z]{3})[\-\s](\d{2,4})/);
    if (match) {
        let d = match[1].padStart(2, '0');
        let m = months[match[2].toLowerCase()] || '01';
        let y = match[3];
        if (y.length === 2) y = "20" + y;
        return `${d}/${m}/${y.substring(2)}`;
    }

    return null;
}

function parseAmount(amtStr) {
    if (!amtStr) return 0;
    // Remove currency symbols and commas, handle (Dr)/(Cr)
    const cleaned = amtStr.replace(/[^\d\.\-]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : Math.abs(val);
}


function updateMonthSelector() {
    monthSelector.innerHTML = '';
    const keys = Object.keys(allMonthsData).sort().reverse();

    if (keys.length > 0) {
        monthSelector.classList.remove('hidden');
        keys.forEach(key => {
            const [year, month] = key.split('-');
            const dateObj = new Date(year, month - 1);
            const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

            const option = document.createElement('option');
            option.value = key;
            option.textContent = monthName;
            if (key === currentMonthKey) option.selected = true;
            monthSelector.appendChild(option);
        });
    }
}

function renderDashboard() {
    emptyState.classList.add('hidden');

    // Ensure only the currently active tab's view is visible
    const activeNav = document.querySelector('.nav-item.active');
    if (activeNav) {
        document.getElementById(activeNav.getAttribute('data-target')).classList.remove('hidden');
    }

    let allTransactions = allMonthsData[currentMonthKey] || [];

    // Populate Bank Selector
    const uniqueBanks = new Set();
    allTransactions.forEach(t => uniqueBanks.add(t.bank));

    bankSelector.innerHTML = '<option value="ALL">All Banks</option>';
    if (uniqueBanks.size > 0) {
        bankSelector.classList.remove('hidden');
        uniqueBanks.forEach(b => {
            const option = document.createElement('option');
            option.value = b;
            option.textContent = b;
            if (b === currentBankFilter) option.selected = true;
            bankSelector.appendChild(option);
        });
    } else {
        bankSelector.classList.add('hidden');
    }

    // Filter transactions by selected bank
    const transactions = currentBankFilter === 'ALL' ? allTransactions : allTransactions.filter(t => t.bank === currentBankFilter);

    // Calculate and display date range
    if (transactions.length > 0) {
        const parseDate = (d) => {
            const [day, month, year] = d.split('/');
            return new Date(`20${year}`, month - 1, day);
        };
        const timestamps = transactions.map(t => parseDate(t.date).getTime());
        const minDate = new Date(Math.min(...timestamps));
        const maxDate = new Date(Math.max(...timestamps));
        const formatDateStr = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

        document.getElementById('date-range').textContent = `Transactions from: ${formatDateStr(minDate)} to ${formatDateStr(maxDate)}`;
    } else {
        document.getElementById('date-range').textContent = '';
    }

    let totalSpend = 0;
    let totalIncome = 0;
    const categoryTotals = {};

    const tbody = document.querySelector('#transactions-table tbody');
    tbody.innerHTML = '';

    const displayTxns = [...transactions].reverse();

    displayTxns.forEach(txn => {
        if (txn.type === 'DEBIT') {
            totalSpend += txn.amount;
            categoryTotals[txn.category] = (categoryTotals[txn.category] || 0) + txn.amount;
        } else {
            totalIncome += txn.amount;
        }

        if (tbody.children.length < 50) {
            const tr = document.createElement('tr');
            const formattedAmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(txn.amount);
            const amtClass = txn.type === 'CREDIT' ? 'amt-income' : 'amt-expense';
            const prefix = txn.type === 'CREDIT' ? '+' : '-';
            let cleanNarration = txn.narration.substring(0, 40) + (txn.narration.length > 40 ? '...' : '');

            tr.innerHTML = `
                <td>${txn.date}</td>
                <td>
                    <span class="tag" style="background-color: var(--sidebar-bg); border: 1px solid var(--border); font-size: 0.7rem; margin-right: 0.5rem;">${txn.bank}</span>
                    ${cleanNarration}
                </td>
                <td><span class="tag">${txn.category}</span></td>
                <td class="align-right ${amtClass}">${prefix}${formattedAmt}</td>
            `;
            tbody.appendChild(tr);
        }
    });

    const formatINR = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
    document.getElementById('total-spend').textContent = formatINR(totalSpend);
    document.getElementById('total-income').textContent = formatINR(totalIncome);
    document.getElementById('net-flow').textContent = formatINR(totalIncome - totalSpend);

    // Update Category Filter Options
    const currentFilterVal = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="ALL">All Categories</option>';
    Object.keys(categoryTotals).sort().forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        if (cat === currentFilterVal) option.selected = true;
        categoryFilter.appendChild(option);
    });

    renderCharts(categoryTotals);
    renderTopExpensesChart(transactions, categoryFilter.value);
    generateInsights(totalSpend, categoryTotals);

    // Render the new views
    renderCategoriesView(categoryTotals, totalSpend);
    renderDeepInsightsView(totalSpend, totalIncome, categoryTotals);
}

function renderCategoriesView(categoryTotals, totalSpend) {
    const tbody = document.querySelector('#categories-detailed-table tbody');
    tbody.innerHTML = '';

    const sortedCats = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const formatINR = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

    sortedCats.forEach(cat => {
        const [name, amount] = cat;
        if (amount > 0) {
            const pct = totalSpend > 0 ? ((amount / totalSpend) * 100).toFixed(1) : 0;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="tag">${name}</span></td>
                <td class="align-right">${formatINR(amount)}</td>
                <td class="align-right">${pct}%</td>
            `;
            tbody.appendChild(tr);
        }
    });
}

function renderDeepInsightsView(totalSpend, totalIncome, categoryTotals) {
    const container = document.getElementById('deep-insights-container');
    let html = '';
    const formatINR = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

    if (totalIncome > 0) {
        const spendRatio = (totalSpend / totalIncome) * 100;
        if (spendRatio > 100) {
            html += `<div class="insight-item negative"><div class="insight-icon"><i data-lucide="alert-triangle"></i></div>
            <div class="insight-text"><strong>High Burn Rate:</strong> You spent ${spendRatio.toFixed(0)}% of your income this month. You are drawing from savings. Try to cut back on non-essential categories.</div></div>`;
        } else if (spendRatio < 80) {
            html += `<div class="insight-item positive"><div class="insight-icon"><i data-lucide="award"></i></div>
            <div class="insight-text"><strong>Great Savings Rate:</strong> You saved ${(100 - spendRatio).toFixed(0)}% of your incoming money this month! Standard rules recommend saving at least 20%.</div></div>`;
        }
    }

    const foodSpend = categoryTotals['Food & Dining'] || 0;
    const grocerySpend = categoryTotals['Groceries'] || 0;
    const foodRatio = totalSpend > 0 ? ((foodSpend + grocerySpend) / totalSpend) * 100 : 0;

    if (foodRatio > 30) {
        html += `<div class="insight-item negative"><div class="insight-icon"><i data-lucide="coffee"></i></div>
        <div class="insight-text"><strong>High Food Spend:</strong> ${foodRatio.toFixed(1)}% of your outflows went to food/groceries. Consider meal prepping to bring this below 20%.</div></div>`;
    }

    const transportSpend = categoryTotals['Transport'] || 0;
    const transportRatio = totalSpend > 0 ? (transportSpend / totalSpend) * 100 : 0;

    if (transportRatio > 15) {
        html += `<div class="insight-item"><div class="insight-icon"><i data-lucide="car"></i></div>
        <div class="insight-text"><strong>Commute Costs:</strong> Transport takes up ${transportRatio.toFixed(1)}% of your expenses. </div></div>`;
    }

    if (html === '') {
        html = `<div class="insight-item"><div class="insight-icon"><i data-lucide="check-circle"></i></div>
        <div class="insight-text">Your spending looks very balanced across categories this month. Keep it up!</div></div>`;
    }

    container.innerHTML = html;
    lucide.createIcons();
}

function renderSettingsView() {
    const container = document.getElementById('rules-container');
    container.innerHTML = '';

    CATEGORY_RULES.forEach(rule => {
        const div = document.createElement('div');
        div.style.background = 'rgba(255,255,255,0.05)';
        div.style.padding = '1rem';
        div.style.borderRadius = '8px';
        div.innerHTML = `
            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">${rule.name}</div>
            <div style="color: var(--text-secondary); font-size: 0.85rem;">Keywords: ${rule.keywords.join(', ')}</div>
        `;
        container.appendChild(div);
    });
}

const chartColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

function renderCharts(categoryTotals) {
    const sortedCats = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).filter(c => c[1] > 0);
    const labels = sortedCats.map(c => c[0]);
    const data = sortedCats.map(c => c[1]);

    const topCatsList = document.getElementById('top-categories');
    topCatsList.innerHTML = '';

    sortedCats.slice(0, 6).forEach((cat, index) => {
        const color = chartColors[index % chartColors.length];
        const formattedAmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(cat[1]);
        const li = document.createElement('li');
        li.className = 'category-item';
        li.innerHTML = `
            <div class="cat-name">
                <div class="cat-color" style="background-color: ${color}"></div>
                <span>${cat[0]}</span>
            </div>
            <span class="cat-amount">${formattedAmt}</span>
        `;
        topCatsList.appendChild(li);
    });

    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (categoryChartInstance) categoryChartInstance.destroy();

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: chartColors, borderWidth: 0, hoverOffset: 4 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { color: '#f8fafc' } } },
            cutout: '75%'
        }
    });
}

function generateInsights(currentSpend, currentCategoryTotals) {
    const insightsContainer = document.getElementById('insights-container');
    insightsContainer.innerHTML = '';

    const keys = Object.keys(allMonthsData).sort();
    const currentIndex = keys.indexOf(currentMonthKey);

    if (currentIndex <= 0) {
        insightsContainer.innerHTML = `
            <div class="insight-item">
                <div class="insight-icon"><i data-lucide="info"></i></div>
                <div class="insight-text">Upload another month's statement to see comparative insights.</div>
            </div>`;
        lucide.createIcons();
        if (comparisonChartInstance) {
            comparisonChartInstance.destroy();
            comparisonChartInstance = null;
        }
        return;
    }

    // Previous Month Data
    const prevMonthKey = keys[currentIndex - 1];
    let prevTxns = allMonthsData[prevMonthKey] || [];
    if (currentBankFilter !== 'ALL') {
        prevTxns = prevTxns.filter(t => t.bank === currentBankFilter);
    }
    let prevSpend = 0;
    const prevCategoryTotals = {};

    prevTxns.forEach(txn => {
        if (txn.type === 'DEBIT') {
            prevSpend += txn.amount;
            prevCategoryTotals[txn.category] = (prevCategoryTotals[txn.category] || 0) + txn.amount;
        }
    });

    // 1. Total Spend Insight
    const spendDiff = currentSpend - prevSpend;
    const spendPct = ((Math.abs(spendDiff) / prevSpend) * 100).toFixed(1);

    let html = '';
    const formatINR = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

    if (spendDiff > 0) {
        html += `
            <div class="insight-item negative">
                <div class="insight-icon"><i data-lucide="trending-up"></i></div>
                <div class="insight-text">Your total spend <strong>increased by ${spendPct}%</strong> (${formatINR(spendDiff)}) compared to last month.</div>
            </div>`;
    } else {
        html += `
            <div class="insight-item positive">
                <div class="insight-icon"><i data-lucide="trending-down"></i></div>
                <div class="insight-text">Great job! Your total spend <strong>decreased by ${spendPct}%</strong> (${formatINR(Math.abs(spendDiff))}) compared to last month.</div>
            </div>`;
    }

    // 2. Category Spikes Insight
    let biggestSpikeCat = null;
    let biggestSpikeAmt = 0;

    Object.keys(currentCategoryTotals).forEach(cat => {
        const prev = prevCategoryTotals[cat] || 0;
        const curr = currentCategoryTotals[cat];
        if (curr > prev && (curr - prev) > biggestSpikeAmt) {
            biggestSpikeAmt = curr - prev;
            biggestSpikeCat = cat;
        }
    });

    if (biggestSpikeCat && biggestSpikeAmt > 500) {
        html += `
            <div class="insight-item negative">
                <div class="insight-icon"><i data-lucide="alert-circle"></i></div>
                <div class="insight-text">You spent <strong>${formatINR(biggestSpikeAmt)} more</strong> on ${biggestSpikeCat} this month. Consider tracking this category closer.</div>
            </div>`;
    }

    insightsContainer.innerHTML = html;
    lucide.createIcons();

    // Render Comparison Chart
    renderComparisonChart(currentCategoryTotals, prevCategoryTotals);
}

function renderComparisonChart(currCats, prevCats) {
    const allCategories = new Set([...Object.keys(currCats), ...Object.keys(prevCats)]);
    const labels = Array.from(allCategories).filter(c => c !== 'Other').slice(0, 5); // Top 5

    const currData = labels.map(l => currCats[l] || 0);
    const prevData = labels.map(l => prevCats[l] || 0);

    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (comparisonChartInstance) comparisonChartInstance.destroy();

    comparisonChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'This Month',
                    data: currData,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                },
                {
                    label: 'Last Month',
                    data: prevData,
                    backgroundColor: '#94a3b8',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc' } }
            }
        }
    });
}

function renderTopExpensesChart(transactions, filterCategory = 'ALL') {
    let expenses = transactions.filter(txn => txn.type === 'DEBIT');

    if (filterCategory !== 'ALL') {
        expenses = expenses.filter(txn => txn.category === filterCategory);
    }

    expenses.sort((a, b) => b.amount - a.amount);

    const top10 = expenses.slice(0, 10);

    // Clean up narration labels
    const labels = top10.map(txn => txn.narration.substring(0, 25) + (txn.narration.length > 25 ? '...' : ''));
    const data = top10.map(txn => txn.amount);

    const ctx = document.getElementById('topExpensesChart').getContext('2d');
    if (topExpensesChartInstance) topExpensesChartInstance.destroy();

    topExpensesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Amount (₹)',
                data: data,
                backgroundColor: '#ef4444',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bar chart
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { display: false } // No need for legend
            }
        }
    });
}

// Start
init();
