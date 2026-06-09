async function leftCommand(sock, msg) {
  const jid = msg.key.remoteJid;

  // Only works inside a group
  if (!jid.endsWith("@g.us")) {
    return sock.sendMessage(jid, {
      text: "❌ This command only works inside a group.",
    });
  }

  await sock.sendMessage(jid, { text: "👋 Goodbye! LP_MD is leaving..." });

  // Small delay so the message sends before leaving
  setTimeout(async () => {
    await sock.groupLeave(jid);
  }, 1500);
}

module.exports = leftCommand;
