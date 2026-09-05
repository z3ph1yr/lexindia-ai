const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/legal.db');

// Serverless sandboxes (AWS Lambda /var/task) mount the function bundle
// read-only, but SQLite needs a writable handle. If the shipped database
// is not writable, copy it once per cold start into the scratch directory
// and open the copy. Regular hosts (local dev, Node hosts) open in place.
function resolveOpenPath() {
  if (!fs.existsSync(DB_PATH)) return DB_PATH; // fresh host: pipeline will create it
  try {
    fs.accessSync(DB_PATH, fs.constants.W_OK);
    return DB_PATH;
  } catch {
    const scratch = path.join(os.tmpdir(), `lexindia-${path.basename(DB_PATH)}`);
    fs.copyFileSync(DB_PATH, scratch);
    return scratch;
  }
}

try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch {
  // read-only bundle mount with the directory already present — nothing to do
}
const db = new DatabaseSync(resolveOpenPath());

module.exports = { db, DB_PATH };
