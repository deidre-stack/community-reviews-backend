// Uses Node's built-in SQLite module (available in Node 22.5+, no native
// build step required - this is why the project targets Node 22.5+ instead
// of using a third-party driver like better-sqlite3).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'reviews.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_slug TEXT NOT NULL,
    community_name TEXT NOT NULL,
    reviewer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    submitted_ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    moderated_at TEXT
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_community_status ON reviews (community_slug, status);`);

module.exports = db;
