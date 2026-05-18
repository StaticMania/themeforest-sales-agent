const fs = require('fs');
const path = require('path');

loadEnvFile(path.join(__dirname, '.env'));

const DATA_FILE = path.join(__dirname, 'data.json');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

const ENVATO_API_TOKEN = process.env.ENVATO_API_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;

        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function loadProducts() {
    if (!fs.existsSync(PRODUCTS_FILE)) {
        throw new Error(
            'products.json not found. Add your items with id and name, e.g. [{ "id": "59358848", "name": "NextSaaS" }]'
        );
    }

    const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    if (!Array.isArray(products) || products.length === 0) {
        throw new Error('products.json must be a non-empty array.');
    }

    for (const product of products) {
        if (!product.id || !product.name) {
            throw new Error('Each product in products.json needs "id" and "name".');
        }
        product.id = String(product.id);
    }

    return products;
}

function loadSalesMemory() {
    if (!fs.existsSync(DATA_FILE)) {
        return {};
    }

    const memory = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    if (memory.lastRecordedSales != null && typeof memory === 'object') {
        const legacyId = process.env.ENVATO_ITEM_ID || '59358848';
        return { [legacyId]: memory.lastRecordedSales };
    }

    return memory;
}

function saveSalesMemory(memory) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(memory, null, 2));
}

function extractItem(json) {
    return json?.data ?? json?.item ?? json;
}

function formatNumber(value) {
    return Number(value).toLocaleString('en-US');
}

async function fetchSalesCount(itemId) {
    if (!ENVATO_API_TOKEN) {
        throw new Error(
            'ENVATO_API_TOKEN is required. Create one at https://build.envato.com/create-token/'
        );
    }

    const endpoints = [
        `https://api.envato.com/v3/market/catalog/item?id=${itemId}`,
        `https://api.envato.com/v2/market/catalog/item?id=${itemId}`,
    ];

    let lastError;
    for (const url of endpoints) {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${ENVATO_API_TOKEN}` },
        });

        if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After') || 'unknown';
            throw new Error(`Envato API rate limited. Retry after ${retryAfter} seconds.`);
        }

        if (!res.ok) {
            const body = await res.text();
            lastError = new Error(`Envato API ${res.status} (item ${itemId}): ${body.slice(0, 200)}`);
            continue;
        }

        const json = await res.json();
        const item = extractItem(json);
        const sales = item?.number_of_sales;

        if (sales == null) {
            lastError = new Error(`number_of_sales not found for item ${itemId}`);
            continue;
        }

        return Number(sales);
    }

    throw lastError ?? new Error(`Failed to fetch sales for item ${itemId}`);
}

async function trackSales() {
    try {
        const products = loadProducts();
        const memory = loadSalesMemory();
        const results = [];

        for (const product of products) {
            const currentSales = await fetchSalesCount(product.id);
            const previousSales = memory[product.id] ?? 0;

            if (currentSales < previousSales) {
                console.warn(
                    `${product.name}: sales dropped (${previousSales} -> ${currentSales}). Updating baseline.`
                );
                memory[product.id] = currentSales;
                results.push({ product, newSales: 0, currentSales });
                continue;
            }

            const newSales = currentSales - previousSales;
            results.push({ product, newSales, currentSales });

            if (newSales > 0) {
                memory[product.id] = currentSales;
                console.log(`${product.name}: +${newSales} new (${currentSales} total)`);
            } else {
                console.log(`${product.name}: no new sales (${currentSales} total)`);
                if (memory[product.id] === undefined) {
                    memory[product.id] = currentSales;
                }
            }
        }

        saveSalesMemory(memory);

        const message = buildTelegramMessage(results);
        await sendTelegramMessage(message);
        console.log(`Sent Telegram report for ${results.length} product(s).`);
    } catch (error) {
        console.error('Agent encountered an error:', error.message);
        process.exitCode = 1;
    }
}

function buildTelegramMessage(results) {
    const lines = ['📈 **Daily ThemeForest Report**', ''];

    for (const { product, newSales, currentSales } of results) {
        lines.push(`**${product.name}**`);
        if (newSales > 0) {
            lines.push(`+${formatNumber(newSales)} new · ${formatNumber(currentSales)} total`);
        } else {
            lines.push(`No new sales · ${formatNumber(currentSales)} total`);
        }
        lines.push('');
    }

    return lines.join('\n').trim();
}

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'Markdown',
        }),
    });
}

trackSales();
