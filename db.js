'use strict';
// Postgres データアクセス層（Vercel Postgres / Neon と互換、ローカルは通常の Postgres）。
// 接続文字列は POSTGRES_URL（Vercel 連携で自動設定）または DATABASE_URL を使用。
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.warn('[db] POSTGRES_URL / DATABASE_URL が未設定です。');
}

// localhost 以外（Neon等）は SSL を有効化
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || '');
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 3,
});

async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}
async function queryOne(text, params = []) {
  return (await query(text, params))[0];
}

// 初回アクセス時にスキーマ作成＋初期ユーザー投入（サーバーレスのコールドスタート対策）
let readyPromise = null;
function ensureReady() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      role          TEXT NOT NULL CHECK (role IN ('staff','admin')),
      password_hash TEXT NOT NULL,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES users(id),
      staff_name        TEXT NOT NULL,
      service_date      TEXT NOT NULL,
      staff_count       TEXT,
      checked_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
      item_notes_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
      remarks           TEXT,
      signature_url     TEXT,
      signature_type    TEXT,
      status            TEXT NOT NULL DEFAULT 'submitted'
                          CHECK (status IN ('submitted','approved','rejected')),
      approver_id       INTEGER REFERENCES users(id),
      approver_name     TEXT,
      approval_comment  TEXT,
      reviewed_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id);`);
  await seedUsers();
}

// 初期ユーザー投入（既に1件でもいればスキップ）。SEED_USERS(JSON) で上書き可。
async function seedUsers() {
  const existing = await queryOne(`SELECT count(*)::int AS c FROM users`);
  if (existing && existing.c > 0) return;

  let seed;
  try {
    seed = process.env.SEED_USERS ? JSON.parse(process.env.SEED_USERS) : null;
  } catch {
    seed = null;
  }
  if (!seed) {
    seed = [
      { name: '上司（管理者）', role: 'admin', password: process.env.ADMIN_PASSWORD || 'admin1234' },
      { name: 'スタッフA', role: 'staff', password: 'staff1234' },
      { name: 'スタッフB', role: 'staff', password: 'staff1234' },
    ];
  }
  for (const u of seed) {
    const hash = bcrypt.hashSync(u.password, 10);
    await query(
      `INSERT INTO users (name, role, password_hash) VALUES ($1,$2,$3)
         ON CONFLICT (name) DO NOTHING`,
      [u.name, u.role, hash]
    );
  }
  console.log(`[db] 初期ユーザーを ${seed.length} 件投入しました。`);
}

module.exports = { pool, query, queryOne, ensureReady, init };
