const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/legal.db');

const db = new DatabaseSync(DB_PATH);

module.exports = { db, DB_PATH };
