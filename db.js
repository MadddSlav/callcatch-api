// db.js
const Database = require("better-sqlite3");

function initDb(dbFile) {
  const db = new Database(dbFile);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      fallback_sms TEXT NOT NULL,
      reply_webhook_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(api_key_id, phone),
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );

    CREATE TABLE IF NOT EXISTS call_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL,
      to_number TEXT NOT NULL,
      from_number TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_call_sid TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL,
      to_number TEXT NOT NULL,
      from_number TEXT NOT NULL,
      last_message TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(api_key_id, to_number, from_number),
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL,
      direction TEXT NOT NULL, -- inbound | outbound
      to_number TEXT NOT NULL,
      from_number TEXT NOT NULL,
      body TEXT NOT NULL,
      provider_message_sid TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
  `);

  return db;
}

module.exports = { initDb };
