async function pingCommand(sock, msg) {
  const jid = msg.key.remoteJid;
  const start = Date.now();

  await sock.sendMessage(jid, { text: "🏓 Pinging..." });

  const elapsed = Date.now() - start;
  await sock.sendMessage(jid, {
    text: `✅ *Pong!*\n⚡ Speed: *${elapsed}ms*`,
  });
}

module.exports = pingCommand;
