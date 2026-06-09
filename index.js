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

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "pairing-site")));

// POST /api/pair  →  { code: "XXXX-XXXX" }
app.post("/api/pair", async (req, res) => {
  const phone = (req.body.phone || "").replace(/\D/g, "");

  if (!phone || phone.length < 7) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  res.setTimeout(90000);

  try {
    const code = await generatePairingCode(phone);
    res.json({ code });
  } catch (err) {
    console.error("[PAIR] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pairing Code Generator ───────────────────────────────────────────────────

async function generatePairingCode(phone) {
  return new Promise(async (resolve, reject) => {
    let settled = false;
    let sock = null;

    const timeout = setTimeout(() => {
      done(reject, new Error("Timeout: WhatsApp did not respond in 60 seconds. Please try again."));
    }, 60000);

    function done(fn, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { if (sock) sock.end(new Error("pairing-done")); } catch (_) {}
      fn(val);
    }

    try {
      // Fresh credentials every time — stale creds break pairing silently
      const tmpDir = path.join(__dirname, ".pair_tmp_" + phone);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
      fs.mkdirSync(tmpDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(tmpDir);

      // Fetch latest WA version; fall back to known-good if fetch fails
      let version;
      try {
        const r = await fetchLatestBaileysVersion();
        version = r.version;
        console.log("[PAIR] WA version:", version);
      } catch (_) {
        version = [2, 3000, 1015901307];
        console.log("[PAIR] Using fallback WA version");
      }

      sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Chrome (Linux)", "", ""],
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
      });

      sock.ev.on("creds.update", saveCreds);

      let codeRequested = false;

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        console.log("[PAIR] connection.update:", connection);

        // Request pairing code on first "connecting" or "open" event
        if (!codeRequested && !sock.authState.creds.registered) {
          if (connection === "connecting" || connection === "open") {
            codeRequested = true;
            try {
              // Give WS handshake 1.5s to settle before requesting
              await new Promise(r => setTimeout(r, 1500));
              console.log("[PAIR] Requesting pairing code for", phone);
              const code = await sock.requestPairingCode(phone);
              console.log("[PAIR] Raw code:", code);
              if (!code) return done(reject, new Error("WhatsApp returned an empty code"));
              const clean = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
              const formatted = clean.match(/.{1,4}/g).join("-");
              done(resolve, formatted);
            } catch (err) {
              console.error("[PAIR] requestPairingCode error:", err.message);
              done(reject, new Error("WhatsApp rejected the request: " + err.message));
            }
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log("[PAIR] Connection closed, status:", statusCode);
          if (!settled) {
            done(reject, new Error("Connection closed (status " + statusCode + "). Try again."));
          }
          // Clean up tmp dir
          const tmpDir = path.join(__dirname, ".pair_tmp_" + phone);
          try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
        }
      });

    } catch (err) {
      done(reject, err);
    }
  });
}

// ─── Main Bot Connection ──────────────────────────────────────────────────────

async function startBot() {
  if (config.sessionId) {
    loadSessionFromId(config.sessionId);
  }

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try {
    const r = await fetchLatestBaileysVersion();
    version = r.version;
  } catch (_) {
    version = [2, 3000, 1015901307];
  }

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    browser: ["Chrome (Linux)", "", ""],
    getMessage: async () => ({ conversation: "" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("[BOT] No session found. Use the pairing site to connect.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[BOT] Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("[BOT] Logged out. Delete session folder and re-pair.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      console.log("[BOT] LP_MD is now connected!");

      const sessionId = encodeSessionToId();
      if (sessionId) {
        console.log("\n╔══════════════════════════════════════════╗");
        console.log("║           YOUR SESSION ID BELOW          ║");
        console.log("╚══════════════════════════════════════════╝");
        console.log(sessionId);
        console.log("══════════════════════════════════════════\n");

        const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
        await sock.sendMessage(ownerJid, {
          text:
            `🔑 *Your Session ID:*\n\`\`\`${sessionId}\`\`\`\n\n` +
            config.botLiveMessage,
        });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error("[BOT] Message error:", err.message);
      }
    }
  });
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleMessage(sock, msg) {
  if (!msg.message) return;
  if (msg.key.fromMe) return;
  if (isJidBroadcast(msg.key.remoteJid)) return;

  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  if (isGroup) {
    let groupMetadata = null;
    try { groupMetadata = await sock.groupMetadata(jid); } catch {}
    await antilinkFilter(sock, msg, groupMetadata);
  }

  if (!body.startsWith(config.prefix)) return;

  const [rawCommand, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();

  console.log(`[CMD] ${command} | from: ${msg.key.participant || jid}`);

  switch (command) {
    case "menu":   await menuCommand(sock, msg); break;
    case "ping":   await pingCommand(sock, msg); break;
    case "left":   await leftCommand(sock, msg); break;
    case "antilink": await antilinkCommand(sock, msg, args); break;
    default: break;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[SERVER] Pairing site running at http://localhost:${config.port}`);
});

startBot().catch((err) => {
  console.error("[BOT] Fatal error:", err);
  process.exit(1);
});
