const fs = require("fs");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const DATA_FILE = path.join(__dirname, "data.json");
const PRODUCTS_FILE = path.join(__dirname, "products.json");
const DASHBOARD_DIR = path.join(__dirname, "dashboard");
const DASHBOARD_DATA_FILE = path.join(DASHBOARD_DIR, "sales-history.json");

const ENVATO_API_TOKEN = process.env.ENVATO_API_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
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
      'products.json not found. Add your items with id and name, e.g. [{ "id": "59358848", "name": "NextSaaS" }]',
    );
  }

  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("products.json must be a non-empty array.");
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

  const memory = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  // Handle legacy format: { "itemId": salesNumber }
  // New format: { "itemId": [{ date, sales }, ...] }
  const result = {};
  for (const [key, value] of Object.entries(memory)) {
    if (Array.isArray(value)) {
      // New format: get latest sales from history
      const latest = value[value.length - 1];
      result[key] = latest?.sales ?? 0;
    } else if (typeof value === "number") {
      // Legacy format: single number
      result[key] = value;
    }
  }

  // Handle very old legacy format
  if (
    memory.lastRecordedSales != null &&
    typeof memory === "object" &&
    Object.keys(result).length === 0
  ) {
    const legacyId = process.env.ENVATO_ITEM_ID || "59358848";
    return { [legacyId]: memory.lastRecordedSales };
  }

  return result;
}

function loadSalesHistory() {
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }

  const memory = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const history = {};

  for (const [key, value] of Object.entries(memory)) {
    if (Array.isArray(value)) {
      history[key] = value;
    } else if (typeof value === "number") {
      // Legacy: convert to history with today's date
      const today = new Date().toISOString().split("T")[0];
      history[key] = [{ date: today, sales: value }];
    }
  }

  return history;
}

function saveSalesMemory(currentSales) {
  // currentSales: { itemId: currentTotalSales }
  // Load existing history
  const history = loadSalesHistory();
  const today = new Date().toISOString().split("T")[0];

  for (const [itemId, sales] of Object.entries(currentSales)) {
    if (!history[itemId]) {
      history[itemId] = [];
    }
    const entries = history[itemId];
    const lastEntry = entries[entries.length - 1];

    // Avoid duplicate entries for same day
    if (lastEntry && lastEntry.date === today) {
      lastEntry.sales = sales;
    } else {
      entries.push({ date: today, sales });
    }

    // Keep last 365 days only
    if (entries.length > 365) {
      history[itemId] = entries.slice(-365);
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
  return history;
}

function saveDashboardData(history) {
  // Ensure dashboard directory exists
  if (!fs.existsSync(DASHBOARD_DIR)) {
    fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
  }
  // Write sales history for dashboard
  fs.writeFileSync(DASHBOARD_DATA_FILE, JSON.stringify(history, null, 2));
}

function extractItem(json) {
  return json?.data ?? json?.item ?? json;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

async function fetchSalesCount(itemId) {
  if (!ENVATO_API_TOKEN) {
    throw new Error(
      "ENVATO_API_TOKEN is required. Create one at https://build.envato.com/create-token/",
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
      const retryAfter = res.headers.get("Retry-After") || "unknown";
      throw new Error(
        `Envato API rate limited. Retry after ${retryAfter} seconds.`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      lastError = new Error(
        `Envato API ${res.status} (item ${itemId}): ${body.slice(0, 200)}`,
      );
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
          `${product.name}: sales dropped (${previousSales} -> ${currentSales}). Updating baseline.`,
        );
        memory[product.id] = currentSales;
        results.push({ product, newSales: 0, currentSales });
        continue;
      }

      const newSales = currentSales - previousSales;
      results.push({ product, newSales, currentSales });

      if (newSales > 0) {
        memory[product.id] = currentSales;
        console.log(
          `${product.name}: +${newSales} new (${currentSales} total)`,
        );
      } else {
        console.log(`${product.name}: no new sales (${currentSales} total)`);
        if (memory[product.id] === undefined) {
          memory[product.id] = currentSales;
        }
      }
    }

    const history = saveSalesMemory(memory);
    saveDashboardData(history);

    const report = buildReport(results);
    const outcomes = await Promise.allSettled([
      sendTelegramMessage(buildTelegramMessage(report)),
      sendSlackMessage(buildSlackPayload(report)),
    ]);

    logNotificationOutcome("Telegram", outcomes[0]);
    logNotificationOutcome("Slack", outcomes[1]);
  } catch (error) {
    console.error("Agent encountered an error:", error.message);
    process.exitCode = 1;
  }
}

function formatProductStatus(newSales, currentSales) {
  if (newSales > 0) {
    return `+${formatNumber(newSales)} new · ${formatNumber(currentSales)} total`;
  }
  return `No new sales · ${formatNumber(currentSales)} total`;
}

function buildReport(results) {
  return { results };
}

function buildTelegramMessage(report) {
  const lines = ["📈 **Daily ThemeForest Report**", ""];

  for (const { product, newSales, currentSales } of report.results) {
    lines.push(`**${product.name}**`);
    lines.push(formatProductStatus(newSales, currentSales));
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildSlackPayload(report) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Daily ThemeForest Report",
        emoji: true,
      },
    },
  ];

  const fallbackLines = ["Daily ThemeForest Report"];

  for (let i = 0; i < report.results.length; i++) {
    const { product, newSales, currentSales } = report.results[i];
    const status = formatProductStatus(newSales, currentSales);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${product.name}*\n${status}`,
      },
    });

    fallbackLines.push(`${product.name}: ${status}`);

    if (i < report.results.length - 1) {
      blocks.push({ type: "divider" });
    }
  }

  return {
    text: fallbackLines.join("\n"),
    blocks,
  };
}

function logNotificationOutcome(channel, outcome) {
  if (outcome.status === "fulfilled") {
    if (outcome.value === "skipped") {
      console.log(`${channel}: skipped (not configured).`);
    } else {
      console.log(`${channel}: report sent.`);
    }
    return;
  }

  console.error(
    `${channel}: failed — ${outcome.reason?.message ?? outcome.reason}`,
  );
  process.exitCode = 1;
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendSlackMessage(payload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return "skipped";
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 200)}`);
  }
}

trackSales();
