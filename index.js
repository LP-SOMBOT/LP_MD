// ╔══════════════════════════════════════════════╗
// ║              LP_MD WhatsApp Bot              ║
// ║         github.com/LP-SOMBOT/LP_MD           ║
// ╚══════════════════════════════════════════════╝

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const { loadSessionFromId, encodeSessionToId, SESSION_DIR } = require("./lib/session");

// Commands
const menuCommand = require("./commands/menu");
const pingCommand = require("./commands/ping");
const leftCommand = require("./commands/left");
const { antilinkCommand, antilinkFilter } = require("./commands/antilink");

// ─── Express App (Pairing Site + API) ────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "pairing-site")));

// Temporary store: phone → { socket, resolve }
const pairingRequests = {};

/**
 * POST /api/pair
 * Body: { phone: "2521234567" }
 * Returns: { code: "ABCD-1234" }
 */
app.post("/api/pair", async (req, res) => {
  const phone = (req.body.phone || "").replace(/\D/g, "");

  if (!phone || phone.length < 7) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  try {
    const code = await generatePairingCode(phone);
    res.json({ code });
  } catch (err) {
    console.error("[PAIR] Error:", err.message);
    res.status(500).json({ error: "Failed to generate code. Try again." });
  }
});

// ─── Pairing Socket ───────────────────────────────────────────────────────────

let pairingSock = null;

async function generatePairingCode(phone) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 30000);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(
        path.join(__dirname, "session_pair_" + phone)
      );

      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["LP_MD", "Chrome", "1.0.0"],
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (!sock.authState.creds.registered) {
          await sock.waitForSocketOpen();
          const code = await sock.requestPairingCode(phone);
          clearTimeout(timeout);
          resolve(code.match(/.{1,4}/g).join("-")); // Format: XXXX-XXXX
        }
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

// ─── Main Bot Connection ──────────────────────────────────────────────────────

async function startBot() {
  // Load session from env variable if provided
  if (config.sessionId) {
    loadSessionFromId(config.sessionId);
  }

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    browser: ["LP_MD", "Chrome", "1.0.0"],
    getMessage: async () => ({ conversation: "" }),
  });

  // ── Save credentials on update ──
  sock.ev.on("creds.update", saveCreds);

  // ── Connection state handler ──
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("[BOT] ⚠️  No session found. Please use the pairing site to connect.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[BOT] Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("[BOT] ❌ Logged out. Delete the session folder and re-pair.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      console.log("[BOT] ✅ LP_MD is now connected!");

      // Encode and log session ID (for new pairings)
      const sessionId = encodeSessionToId();
      if (sessionId) {
        console.log("\n╔══════════════════════════════════════════╗");
        console.log("║           YOUR SESSION ID BELOW          ║");
        console.log("╚══════════════════════════════════════════╝");
        console.log(sessionId);
        console.log("══════════════════════════════════════════\n");

        // Send session ID + live message to owner's DM
        const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
        await sock.sendMessage(ownerJid, {
          text:
            `🔑 *Your Session ID:*\n\`\`\`${sessionId}\`\`\`\n\n` +
            config.botLiveMessage,
        });
      }
    }
  });

  // ── Message handler ──
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error("[BOT] Message handling error:", err.message);
      }
    }
  });
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleMessage(sock, msg) {
  if (!msg.message) return;
  if (msg.key.fromMe) return; // ignore own messages
  if (isJidBroadcast(msg.key.remoteJid)) return; // ignore broadcast

  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  // ── Antilink filter (runs on all group messages) ──
  if (isGroup) {
    let groupMetadata = null;
    try {
      groupMetadata = await sock.groupMetadata(jid);
    } catch {}
    await antilinkFilter(sock, msg, groupMetadata);
  }

  // ── Command routing ──
  if (!body.startsWith(config.prefix)) return;

  const [rawCommand, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();

  console.log(`[CMD] ${command} | from: ${msg.key.participant || jid}`);

  switch (command) {
    case "menu":
      await menuCommand(sock, msg);
      break;

    case "ping":
      await pingCommand(sock, msg);
      break;

    case "left":
      await leftCommand(sock, msg);
      break;

    case "antilink":
      await antilinkCommand(sock, msg, args);
      break;

    default:
      // Unknown command — silent ignore
      break;
  }
}

// ─── Start Everything ─────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[SERVER] 🌐 Pairing site running at http://localhost:${config.port}`);
});

startBot().catch((err) => {
  console.error("[BOT] Fatal error:", err);
  process.exit(1);
});
