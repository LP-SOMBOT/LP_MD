// ╔══════════════════════════════════════════╗
// ║         LP_MD BOT CONFIGURATION          ║
// ╚══════════════════════════════════════════╝

const config = {
  // ── Bot Identity ──────────────────────────
  botName: "LP_MD",
  botVersion: "1.0.0",
  prefix: ".",

  // ── Owner ─────────────────────────────────
  // Your WhatsApp number with country code, NO + sign
  ownerNumber: "252613982172",
  ownerName: "LP",

  // ── Session ───────────────────────────────
  // Paste your session ID here after pairing
  // Leave empty if you are setting up fresh
  sessionId: process.env.SESSION_ID || "",

  // ── Pairing Site Port ─────────────────────
  port: process.env.PORT || 3000,

  // ── Bot Messages ──────────────────────────
  botLiveMessage: `╔═══════════════════════╗
║   LP_MD is now LIVE!   ║
╚═══════════════════════╝

✅ Bot connected successfully.
Type *.menu* to see all commands.`,

  // ── Antilink Settings (stored in memory) ──
  // key = groupJid, value = true/false
  antilinkGroups: {},
};

module.exports = config;
