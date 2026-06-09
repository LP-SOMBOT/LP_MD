const { config } = require("../config");

async function menuCommand(sock, msg) {
  const jid = msg.key.remoteJid;

  const menuText = `╔══════════════════════════╗
║       *LP_MD BOT*        ║
║    Version ${require("../config").botVersion}         ║
╚══════════════════════════╝

*[ GENERAL ]*
┌─────────────────────────
│ *.menu*  – Show this menu
│ *.ping*  – Check bot speed
└─────────────────────────

*[ GROUP TOOLS ]*
┌─────────────────────────
│ *.left*         – Bot leaves group
│ *.antilink on*  – Enable link filter
│ *.antilink off* – Disable link filter
└─────────────────────────

> Prefix: *.*
> Owner: @${require("../config").ownerNumber}
> Powered by LP_MD 🤖`;

  await sock.sendMessage(jid, {
    text: menuText,
    mentions: [`${require("../config").ownerNumber}@s.whatsapp.net`],
  });
}

module.exports = menuCommand;
