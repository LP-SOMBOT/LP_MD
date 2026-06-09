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
  Browsers,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");
const path = require("path");
const fs = require("fs");

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
  const tmpDir = path.join(__dirname, ".pair_tmp_" + phone);

  // Always start fresh — stale creds cause bad-request errors
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  let sock = null;

  return new Promise(async (resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      finish(reject, new Error("Timeout: WhatsApp did not respond. Try again."));
    }, 60000);

    function finish(fn, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (sock) sock.end(new Error("done")); } catch (_) {}
      try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
      fn(val);
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(tmpDir);

      let version;
      try {
        const r = await fetchLatestBaileysVersion();
        version = r.version;
      } catch (_) {
        version = [2, 3000, 1015901307];
      }

      sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      });

      sock.ev.on("creds.update", saveCreds);

      // ── KEY FIX: request the code OUTSIDE connection.update, right here ──
      // Wait until the socket's WS is open (readyState === 1)
      // then call requestPairingCode immediately
      if (!state.creds.registered) {
        // Poll until WS is open (max 15s)
        let waited = 0;
        const waitForWS = setInterval(async () => {
          waited += 200;
          const wsReady = sock.ws && (sock.ws.readyState === 1 || sock.ws.isOpen === true);

          if (wsReady || waited >= 15000) {
            clearInterval(waitForWS);
            if (!wsReady) {
              return finish(reject, new Error("WebSocket did not open. Check Render logs."));
            }
            try {
              console.log("[PAIR] Requesting code for", phone);
              const code = await sock.requestPairingCode(phone);
              console.log("[PAIR] Code received:", code);
              if (!code) return finish(reject, new Error("WhatsApp returned empty code"));
              const formatted = code.replace(/[^A-Z0-9]/gi,"").toUpperCase().match(/.{1,4}/g).join("-");
              finish(resolve, formatted);
            } catch (err) {
              console.error("[PAIR] requestPairingCode threw:", err.message);
              finish(reject, new Error(err.message));
            }
          }
        }, 200);
      } else {
        finish(reject, new Error("Number already paired. Delete session and retry."));
      }

      sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "close" && !settled) {
          const code = lastDisconnect?.error?.output?.statusCode;
          finish(reject, new Error("Connection closed (status " + code + "). Try again."));
        }
      });

    } catch (err) {
      finish(reject, err);
    }
  });
}

// ─── Main Bot ─────────────────────────────────────────────────────────────────

async function startBot() {
  if (config.sessionId) loadSessionFromId(config.sessionId);
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try { version = (await fetchLatestBaileysVersion()).version; }
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
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log("[BOT] No session. Use the pairing site to connect.");

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log(`[BOT] Closed (${code}). Reconnect: ${reconnect}`);
      if (reconnect) setTimeout(startBot, 5000);
      else { console.log("[BOT] Logged out."); process.exit(1); }
    }

    if (connection === "open") {
      console.log("[BOT] Connected!");
      const sessionId = encodeSessionToId();
      if (sessionId) {
        console.log("\n═══ SESSION ID ═══\n" + sessionId + "\n══════════════════\n");
        const ownerJid = `${config.ownerNumber}@s.whatsapp.net`;
        await sock.sendMessage(ownerJid, {
          text: `🔑 *Session ID:*\n\`\`\`${sessionId}\`\`\`\n\n` + config.botLiveMessage,
        });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (err) { console.error("[BOT]", err.message); }
    }
  });
}

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe || isJidBroadcast(msg.key.remoteJid)) return;

  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || "";

  if (isGroup) {
    let meta = null;
    try { meta = await sock.groupMetadata(jid); } catch {}
    await antilinkFilter(sock, msg, meta);
  }

  if (!body.startsWith(config.prefix)) return;

  const [rawCmd, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  console.log(`[CMD] ${cmd} from ${msg.key.participant || jid}`);

  switch (cmd) {
    case "menu":     await menuCommand(sock, msg); break;
    case "ping":     await pingCommand(sock, msg); break;
    case "left":     await leftCommand(sock, msg); break;
    case "antilink": await antilinkCommand(sock, msg, args); break;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[SERVER] Pairing site at http://localhost:${config.port}`);
});

startBot().catch(err => {
  console.error("[BOT] Fatal:", err);
  process.exit(1);
});
