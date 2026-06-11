'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('staff','admin')),
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  staff_name       TEXT NOT NULL,
  service_date     TEXT NOT NULL,
  staff_count      TEXT,
  checked_json     TEXT NOT NULL DEFAULT '[]',
  item_notes_json  TEXT NOT NULL DEFAULT '{}',
  remarks          TEXT,
  signature_file   TEXT,
  status           TEXT NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted','approved','rejected')),
  approver_id      INTEGER REFERENCES users(id),
  approver_name    TEXT,
  approval_comment TEXT,
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id);
`);

module.exports = db;
