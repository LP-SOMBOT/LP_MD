# LP_MD — WhatsApp Bot

> A powerful Multi-Device WhatsApp bot built with Baileys.

---

## ⚡ Quick Deploy

### Step 1 — Fork this repo
Click **Fork** on GitHub to get your own copy.

### Step 2 — Get your Session ID
1. Go to the pairing site (hosted separately or run locally)
2. Enter your WhatsApp number
3. Enter the code in WhatsApp → Linked Devices → Link with phone number
4. The bot will DM you your **Session ID**

### Step 3 — Deploy on Railway / Render / bot-hosting.net
1. Connect your GitHub repo
2. Set environment variable:
   ```
   SESSION_ID=your_session_id_here
   ```
3. Deploy — bot will start and send you a live confirmation

---

## 🔧 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_ID` | ✅ Yes | Your WhatsApp session (from pairing site) |
| `PORT` | No | Server port (default: 3000) |

---

## 📋 Commands

| Command | Description |
|---|---|
| `.menu` | Show all commands |
| `.ping` | Check bot response speed |
| `.left` | Bot leaves the current group |
| `.antilink on` | Enable link filter in group |
| `.antilink off` | Disable link filter in group |

---

## 🏠 Run Locally

```bash
git clone https://github.com/LP-SOMBOT/LP_MD
cd LP_MD
npm install
SESSION_ID=your_id node index.js
```

Then open `http://localhost:3000` for the pairing site.

---

## 🐳 Docker

```bash
docker build -t lp-md .
docker run -e SESSION_ID=your_id -p 3000:3000 lp-md
```

---

Made with ❤️ by LP
