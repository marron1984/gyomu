'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { saveSignature, readSignature } = require('./storage');
const { query, queryOne, ensureReady } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const checklist = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'checklist.json'), 'utf-8')
);
const ALL_ITEM_NOS = checklist.phases.flatMap((p) =>
  p.subsections.flatMap((s) => s.items.map((i) => i.no))
);
const TOTAL_ITEMS = ALL_ITEM_NOS.length;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: 'sess',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 12,
  })
);

// スキーマ・初期データ準備（コールドスタート時に1回）
app.use((req, res, next) => {
  ensureReady().then(() => next()).catch(next);
});

// ---- multipart（サイン写真）はメモリ保持 → Blob へ ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('画像ファイル(JPEG/PNG/WebP/HEIC)を選択してください'), ok);
  },
});

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'ログインが必要です' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'ログインが必要です' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: '上司（管理者）権限が必要です' });
  next();
}

function jstString(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return [];
}
function asObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return {};
}

// ================= API =================
app.get('/api/checklist', (req, res) => res.json(checklist));

app.get('/api/users', ah(async (req, res) => {
  const rows = await query(
    `SELECT name, role FROM users WHERE active = true ORDER BY role DESC, id`
  );
  res.json(rows);
}));

app.get('/api/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

app.post('/api/login', ah(async (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: '名前とパスワードを入力してください' });
  const u = await queryOne(`SELECT * FROM users WHERE name = $1 AND active = true`, [name]);
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: '名前またはパスワードが違います' });
  req.session.user = { id: u.id, name: u.name, role: u.role };
  res.json({ user: req.session.user });
}));

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.post('/api/change-password', requireLogin, ah(async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 6) return res.status(400).json({ error: '新しいパスワードは6文字以上にしてください' });
  const u = await queryOne(`SELECT * FROM users WHERE id = $1`, [req.session.user.id]);
  if (!bcrypt.compareSync(current || '', u.password_hash))
    return res.status(400).json({ error: '現在のパスワードが違います' });
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [bcrypt.hashSync(next, 10), u.id]);
  res.json({ ok: true });
}));

// ---- 提出（スタッフ）----
app.post('/api/submissions', requireLogin, upload.single('signature'), ah(async (req, res) => {
  let payload;
  try { payload = JSON.parse(req.body.payload || '{}'); }
  catch { return res.status(400).json({ error: '送信データが不正です' }); }

  const serviceDate = (payload.serviceDate || '').trim();
  const staffName = (payload.staffName || req.session.user.name || '').trim();
  if (!serviceDate) return res.status(400).json({ error: '実施日を入力してください' });
  if (!req.file) return res.status(400).json({ error: 'サイン済み用紙の写真をアップロードしてください' });

  const checked = Array.isArray(payload.checked)
    ? payload.checked.filter((n) => ALL_ITEM_NOS.includes(n)) : [];

  // サイン写真を保存（Vercel Blob もしくはローカル）。参照はサーバー側のみ保持
  const signatureRef = await saveSignature(req.file.buffer, req.file.mimetype);

  const row = await queryOne(
    `INSERT INTO submissions
       (user_id, staff_name, service_date, staff_count, checked_json,
        item_notes_json, remarks, signature_url, signature_type, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,'submitted')
     RETURNING id`,
    [
      req.session.user.id, staffName, serviceDate, (payload.staffCount || '').trim(),
      JSON.stringify(checked), JSON.stringify(payload.itemNotes || {}),
      (payload.remarks || '').trim(), signatureRef, req.file.mimetype,
    ]
  );
  res.json({ id: row.id, ok: true });
}));

function decorate(row) {
  if (!row) return row;
  const checked = asArray(row.checked_json);
  return {
    id: row.id,
    staffName: row.staff_name,
    serviceDate: row.service_date,
    staffCount: row.staff_count,
    checkedCount: checked.length,
    totalItems: TOTAL_ITEMS,
    checked,
    itemNotes: asObject(row.item_notes_json),
    remarks: row.remarks,
    hasSignature: !!row.signature_url,
    status: row.status,
    approverName: row.approver_name,
    approvalComment: row.approval_comment,
    reviewedAt: jstString(row.reviewed_at),
    createdAt: jstString(row.created_at),
    userId: row.user_id,
  };
}

app.get('/api/submissions', requireLogin, ah(async (req, res) => {
  const me = req.session.user;
  const where = [];
  const params = [];
  if (me.role !== 'admin') { params.push(me.id); where.push(`user_id = $${params.length}`); }
  const status = req.query.status;
  if (status && ['submitted', 'approved', 'rejected'].includes(status)) {
    params.push(status); where.push(`status = $${params.length}`);
  }
  let sql = `SELECT * FROM submissions`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY (status = 'submitted') DESC, created_at DESC`;
  const rows = await query(sql, params);
  res.json(rows.map(decorate));
}));

app.get('/api/submissions/:id', requireLogin, ah(async (req, res) => {
  const row = await queryOne(`SELECT * FROM submissions WHERE id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  if (req.session.user.role !== 'admin' && row.user_id !== req.session.user.id)
    return res.status(403).json({ error: '閲覧権限がありません' });
  res.json(decorate(row));
}));

app.post('/api/submissions/:id/review', requireAdmin, ah(async (req, res) => {
  const { action, comment } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action が不正です' });
  const row = await queryOne(`SELECT * FROM submissions WHERE id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  const status = action === 'approve' ? 'approved' : 'rejected';
  await query(
    `UPDATE submissions
       SET status=$1, approver_id=$2, approver_name=$3, approval_comment=$4,
           reviewed_at=now(), updated_at=now()
     WHERE id=$5`,
    [status, req.session.user.id, req.session.user.name, (comment || '').trim(), row.id]
  );
  res.json({ ok: true, status });
}));

// サイン画像：認証チェック後、Blob から取得してプロキシ配信（URLは外部に出さない）
app.get('/api/submissions/:id/signature', requireLogin, ah(async (req, res) => {
  const row = await queryOne(`SELECT * FROM submissions WHERE id = $1`, [req.params.id]);
  if (!row || !row.signature_url) return res.status(404).send('not found');
  if (req.session.user.role !== 'admin' && row.user_id !== req.session.user.id)
    return res.status(403).send('forbidden');
  const sig = await readSignature(row.signature_url);
  if (!sig) return res.status(404).send('not found');
  res.set('Content-Type', row.signature_type || sig.contentType || 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(sig.buffer);
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error('[error]', err && err.message);
  if (res.headersSent) return next(err);
  res.status(err && err.status ? err.status : 400).json({ error: (err && err.message) || 'エラーが発生しました' });
});

// ローカル実行時のみ listen（Vercel ではモジュールとして読み込まれるため listen しない）
if (require.main === module) {
  app.listen(PORT, () => console.log(`業務チェックリスト Web版 → http://localhost:${PORT}`));
}

module.exports = app;
