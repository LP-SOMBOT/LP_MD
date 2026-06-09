const config = require("../config");

// URL detection regex
const LINK_REGEX =
  /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/gi;

/**
 * Toggle antilink on/off for a group.
 * Called by the command handler.
 */
async function antilinkCommand(sock, msg, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return sock.sendMessage(jid, {
      text: "❌ This command only works inside a group.",
    });
  }

  const action = (args[0] || "").toLowerCase();

  if (action === "on") {
    config.antilinkGroups[jid] = true;
    return sock.sendMessage(jid, {
      text: "🔒 *Antilink ENABLED*\nAll links posted in this group will be deleted automatically.",
    });
  }

  if (action === "off") {
    config.antilinkGroups[jid] = false;
    return sock.sendMessage(jid, {
      text: "🔓 *Antilink DISABLED*\nLinks are now allowed in this group.",
    });
  }

  // Status check
  const status = config.antilinkGroups[jid] ? "✅ ON" : "❌ OFF";
  return sock.sendMessage(jid, {
    text: `🔗 Antilink status: *${status}*\n\nUsage:\n*.antilink on* – enable\n*.antilink off* – disable`,
  });
}

/**
 * Called on every group message to check for links.
 * Deletes the message if antilink is ON and the sender is not the owner/admin.
 */
async function antilinkFilter(sock, msg, groupMetadata) {
  const jid = msg.key.remoteJid;

  // Not a group or antilink not active
  if (!jid.endsWith("@g.us")) return;
  if (!config.antilinkGroups[jid]) return;

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  if (!LINK_REGEX.test(body)) return;

  const sender = msg.key.participant || msg.key.remoteJid;
  const senderNumber = sender.replace("@s.whatsapp.net", "").replace("@g.us", "");

  // Don't delete owner's messages
  if (senderNumber === config.ownerNumber) return;

  // Check if sender is a group admin — admins are exempt
  const admins = (groupMetadata?.participants || [])
    .filter((p) => p.admin)
    .map((p) => p.id);

  if (admins.includes(sender)) return;

  // Delete the message
  await sock.sendMessage(jid, {
    delete: msg.key,
  });

  await sock.sendMessage(jid, {
    text: `⚠️ @${senderNumber} Links are not allowed in this group!`,
    mentions: [sender],
  });
}

module.exports = { antilinkCommand, antilinkFilter };
