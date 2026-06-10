// ╔══════════════════════════════════════════════╗
// ║              LP_MD WhatsApp Bot              ║
// ╚══════════════════════════════════════════════╝

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  Browsers,
  delay,
} = require("@whiskeysockets/baileys");

const pino    = require("pino");
const express = require("express");
const path    = require("path");
const fs      = require("fs");

const config = require("./config");
const { loadSessionFromId, encodeSessionToId, SESSION_DIR } = require("./lib/session");

const menuCommand    = require("./commands/menu");
const pingCommand    = require("./commands/ping");
const leftCommand    = require("./commands/left");
const { antilinkCommand, antilinkFilter } = require("./commands/antilink");

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "pairing-site")));

app.post("/api/pair", async (req, res) => {
  // E.164 without '+': digits only
  const phone = (req.body.phone || "").replace(/[^0-9]/g, "");

  if (!phone || phone.length < 7) {
    return res.status(400).json({ error: "Enter your number with country code, no + sign. Example: 252613982172" });
  }

  res.setTimeout(90000);
  try {
    const code = await generatePairingCode(phone);
    res.json({ code });
  } catch (err) {
    console.error("[PAIR] Failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pairing Code Generator ───────────────────────────────────────────────────
// Based on confirmed working pattern from Baileys issues #2306, #2008, #390

async function generatePairingCode(phone) {
  // Fresh credentials every time — stale creds silently break pairing
  const tmpDir = path.join(__dirname, ".pair_" + phone + "_" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  };

  return new Promise(async (resolve, reject) => {
    let settled       = false;
    let pairingDone   = false;
    let sock          = null;

    const timer = setTimeout(() => {
      finish(reject, new Error("Timeout: WhatsApp servers did not respond. Try again in a moment."));
    }, 60000);

    function finish(fn, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      try { sock?.end(new Error("done")); } catch (_) {}
      fn(val);
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(tmpDir);

      let version;
      try {
        ({ version } = await fetchLatestBaileysVersion());
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
        // Confirmed working browser config (issue #1382 fix)
        browser: ["Windows", "Chrome", "114.0.5735.198"],
        markOnlineOnConnect: false,
        // CRITICAL: undefined removes the timeout that causes Connection Closed on cloud (issue #390)
        defaultQueryTimeoutMs: undefined,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        qrTimeout: undefined,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log("[PAIR] connection.update → connection:", connection, "| qr:", !!qr);

        // ── Correct trigger: request pairing code ONLY when QR fires ──
        // QR firing means the WS is fully open and ready for auth
        if (qr && !pairingDone && !sock.authState.creds.registered) {
          pairingDone = true;
          try {
            // Small delay to ensure socket is stable
            await delay(500);
            console.log("[PAIR] Requesting pairing code for number:", phone);
            const code = await sock.requestPairingCode(phone);
            console.log("[PAIR] Raw code received:", code);

            if (!code) {
              return finish(reject, new Error("WhatsApp returned an empty pairing code. Try again."));
            }

            // Format XXXXXXXX → XXXX-XXXX
            const formatted = String(code)
              .replace(/[^A-Z0-9]/gi, "")
              .toUpperCase()
              .match(/.{1,4}/g)
              ?.join("-") || code;

            console.log("[PAIR] Formatted code:", formatted);
            finish(resolve, formatted);
          } catch (err) {
            console.error("[PAIR] requestPairingCode error:", err.message);
            finish(reject, new Error("Failed to get code from WhatsApp: " + err.message));
          }
        }

        if (connection === "close" && !settled) {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log("[PAIR] Connection closed, status:", statusCode);
          finish(reject, new Error("Connection was closed (status " + statusCode + "). Try again."));
        }
      });

    } catch (err) {
      finish(reject, err);
    }
  });
}

// ─── Main Bot Connection ──────────────────────────────────────────────────────

async function startBot() {
  if (config.sessionId) loadSessionFromId(config.sessionId);
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); }
  catch (_) { version = [2, 3000, 1015901307]; }

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    browser: Browsers.ubuntu("Chrome"),
    getMessage: async () => ({ conversation: "" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log("[BOT] No session. Use the pairing site at your Render URL.");

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log(`[BOT] Disconnected (${code}). Reconnecting: ${reconnect}`);
      if (reconnect) setTimeout(startBot, 5000);
      else { console.log("[BOT] Logged out. Re-pair from the pairing site."); process.exit(1); }
    }

    if (connection === "open") {
      console.log("[BOT] ✅ LP_MD is online!");
      const sessionId = encodeSessionToId();
      if (sessionId) {
        console.log("\n═══════════════════════════════");
        console.log("SESSION ID:\n" + sessionId);
        console.log("═══════════════════════════════\n");
        try {
          await sock.sendMessage(`${config.ownerNumber}@s.whatsapp.net`, {
            text: `🔑 *LP_MD Session ID:*\n\`\`\`${sessionId}\`\`\`\n\n` + config.botLiveMessage,
          });
        } catch (_) {}
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (err) { console.error("[BOT] Message error:", err.message); }
    }
  });
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe || isJidBroadcast(msg.key.remoteJid)) return;

  const jid     = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");
  const body    =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || "";

  if (isGroup) {
    let meta = null;
    try { meta = await sock.groupMetadata(jid); } catch (_) {}
    await antilinkFilter(sock, msg, meta);
  }

  if (!body.startsWith(config.prefix)) return;

  const [rawCmd, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  console.log(`[CMD] "${cmd}" from ${msg.key.participant || jid}`);

  switch (cmd) {
    case "menu":     await menuCommand(sock, msg); break;
    case "ping":     await pingCommand(sock, msg); break;
    case "left":     await leftCommand(sock, msg); break;
    case "antilink": await antilinkCommand(sock, msg, args); break;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[SERVER] Pairing site live at http://localhost:${config.port}`);
});

startBot().catch(err => {
  console.error("[BOT] Fatal:", err.message);
  process.exit(1);
});
