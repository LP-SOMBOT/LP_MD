const fs = require("fs");
const path = require("path");

const SESSION_DIR = path.join(__dirname, "..", "session");

/**
 * Decodes a base64 session string and writes
 * the auth files to the ./session folder so
 * Baileys can pick them up on startup.
 */
function loadSessionFromId(sessionId) {
  if (!sessionId || sessionId.trim() === "") return false;

  try {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    // Session ID is base64-encoded JSON of the creds file
    const decoded = Buffer.from(sessionId, "base64").toString("utf8");
    const creds = JSON.parse(decoded);

    fs.writeFileSync(
      path.join(SESSION_DIR, "creds.json"),
      JSON.stringify(creds, null, 2)
    );

    console.log("[SESSION] ✅ Session loaded from SESSION_ID");
    return true;
  } catch (err) {
    console.error("[SESSION] ❌ Failed to decode session:", err.message);
    return false;
  }
}

/**
 * Reads the current creds.json and encodes it
 * as a base64 session ID string.
 */
function encodeSessionToId() {
  try {
    const credsPath = path.join(SESSION_DIR, "creds.json");
    if (!fs.existsSync(credsPath)) return null;

    const raw = fs.readFileSync(credsPath, "utf8");
    return Buffer.from(raw).toString("base64");
  } catch (err) {
    console.error("[SESSION] ❌ Failed to encode session:", err.message);
    return null;
  }
}

module.exports = { loadSessionFromId, encodeSessionToId, SESSION_DIR };
