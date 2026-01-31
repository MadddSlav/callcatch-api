const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "store.json");

function load() {
  if (!fs.existsSync(FILE)) {
    return { apiKeys: [], numbers: [], callEvents: [], messages: [] };
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

function now() {
  return new Date().toISOString();
}

module.exports = { load, save, now, FILE };
