# ThemeForest Sales Automation Agent

A Node.js application that tracks daily ThemeForest sales for multiple products and sends automated reports via Telegram (and optionally Slack). Runs daily via GitHub Actions.

---

## 🚀 Features

- **Daily Sales Tracking**: Automatically fetches sales counts from Envato API for multiple products
- **Delta Detection**: Compares current sales with historical data to detect *new* sales only
- **Multi-Product Support**: Track multiple ThemeForest items from a single `products.json`
- **Daily Reports**: Sends formatted Telegram messages (Markdown) + optional Slack webhook
- **Data Persistence**: Stores historical sales in `data.json`, auto-committed back to the repo
- **Scheduled Automation**: Runs daily at **8:17 PM Bangladesh time (GMT+6)** via GitHub Actions
- **Manual Trigger**: Can be triggered manually via GitHub Actions "Run workflow"
- **Rate-Limit Handling**: Gracefully handles Envato API rate limits with retry logic
- **Sales Drop Detection**: Handles edge cases where sales count decreases (refunds, data corrections)

---

## 📁 Project Structure

```
themeforest-sales-agent/
├── .github/
│   └── workflows/
│       └── daily-sales.yml      # GitHub Actions workflow (daily at 20:17 Asia/Dhaka)
├── index.js                     # Main application logic
├── products.json                # Products to track (id + name)
├── data.json                    # Historical sales data (productId → totalSales)
├── package.json                 # Dependencies (node-fetch, node ≥18)
└── .gitignore
```

---

## 📦 Products Tracked (products.json)

| Product ID | Product Name |
|------------|--------------|
| `59358848` | NextSaaS Tailwind |
| `61429174` | NextSaaS WordPress |
| `59610421` | NextSaaS NextJS |
| `63201128` | Nexi WordPress |
| `59043079` | BrightHub WP |
| `59880841` | Sasico WP |

> **To add/remove products**: Edit `products.json` with an array of `{ "id": "ITEM_ID", "name": "Display Name" }` objects.

---

## ⚙️ Setup & Configuration

### 1. Prerequisites
- Node.js ≥ 18
- Envato API Personal Token ([create one](https://build.envato.com/create-token/))
- Telegram Bot Token ([BotFather](https://t.me/BotFather)) + Chat ID
- *(Optional)* Slack Incoming Webhook URL

### 2. Local Development

```bash
# Clone and install
git clone <your-repo>
cd themeforest-sales-agent
npm install

# Create .env file (not committed)
cat > .env <<'EOF'
ENVATO_API_TOKEN=your_envato_token
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
# SLACK_WEBHOOK_URL=your_webhook_url  # optional
EOF

# Run locally
npm start
```

### 3. GitHub Actions Setup (Recommended)

Add the following **Repository Secrets** (Settings → Secrets and variables → Actions → New repository secret):

| Secret Name | Required | Description |
|-------------|----------|-------------|
| `ENVATO_API_TOKEN` | ✅ Yes | Your Envato personal API token |
| `TELEGRAM_BOT_TOKEN` | ✅ Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ Yes | Numeric chat ID (e.g., `-1001234567890`) |
| `SLACK_WEBHOOK_URL` | ❌ No | Slack Incoming Webhook URL (optional) |

> **Tip**: Use **Secrets** (not Variables) for sensitive tokens. The workflow also supports Variables as fallback.

The workflow runs automatically **daily at 20:17 Asia/Dhaka** (GMT+6) and commits updated `data.json` back to the repo.

### 4. Manual Trigger

Go to **Actions → Daily ThemeForest Sales → Run workflow** to trigger a manual run.

---

## 📊 Sample Telegram Report

```
📈 **Daily ThemeForest Report**

**NextSaaS Tailwind**
+3 new · 1,360 total

**NextSaaS WordPress**
No new sales · 527 total

**NextSaaS NextJS**
+1 new · 841 total

**Nexi Wordpress**
No new sales · 63 total

**BrightHub WP**
+2 new · 1,372 total

**Sasico WP**
No new sales · 675 total
```

---

## 🔧 How It Works

1. **Load Products** → Reads `products.json`
2. **Load History** → Reads `data.json` (last recorded sales per product)
3. **Fetch Current Sales** → Calls Envato API v3 (falls back to v2) for each product
4. **Calculate Delta** → `newSales = currentSales - previousSales`
5. **Handle Edge Cases** → If sales drop (refunds/data correction), updates baseline
6. **Persist** → Saves new totals to `data.json`
7. **Build Report** → Formats Markdown (Telegram) + Block Kit (Slack)
8. **Send Notifications** → Telegram (required) + Slack (optional)
9. **Commit** → GitHub Action commits `data.json` if changed

---

## 🛠 Local Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run sales tracking once |
| `npm test` | *(Not configured — add tests if needed)* |

---

## 🔐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ENVATO_API_TOKEN` | ✅ | Personal token from [build.envato.com](https://build.envato.com/create-token/) |
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ | Target chat ID (use @userinfobot to find yours) |
| `SLACK_WEBHOOK_URL` | ❌ | Slack Incoming Webhook URL for optional Slack posting |

---

## 📝 License

ISC — feel free to use and modify for your own ThemeForest portfolio.

---

## 💡 Extending the Project

Ideas for enhancements:
- Add **Discord webhook** support (similar to Slack)
- Add **email digest** via SendGrid/Resend
- Store history in a database (SQLite, Supabase) instead of JSON file for richer analytics
- Add a **GitHub Pages dashboard** to visualize sales trends
- Schedule **weekly/monthly summary** reports
- Add **Envato API rate-limit backoff with exponential retry**