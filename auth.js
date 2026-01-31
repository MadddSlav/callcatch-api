// auth.js
function authMiddleware(db) {
  return (req, res, next) => {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: "Missing Bearer token" });

    const token = m[1].trim();
    const row = db
      .prepare("SELECT id, token, name FROM api_keys WHERE token = ?")
      .get(token);

    if (!row) return res.status(401).json({ error: "Invalid API key" });

    req.apiKey = row;
    next();
  };
}

module.exports = { authMiddleware };
