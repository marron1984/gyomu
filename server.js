'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const checklist = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'checklist.json'), 'utf-8')
);
// 全項目No一覧（チェック数の上限把握用）
const ALL_ITEM_NOS = checklist.phases.flatMap((p) =>
  p.subsections.flatMap((s) => s.items.map((i) => i.no))
);
const TOTAL_ITEMS = ALL_ITEM_NOS.length;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 },
  })
);

// ---- ファイルアップロード（サイン写真）----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const safe = crypto.randomBytes(12).toString('hex');
    cb(null, `sign_${Date.now()}_${safe}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'].includes(
      file.mimetype
    );
    cb(ok ? null : new Error('画像ファイル(JPEG/PNG/WebP/HEIC)を選択してください'), ok);
  },
});

// ---- 認証ミドルウェア ----
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'ログインが必要です' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'ログインが必要です' });
  if (req.session.user.role !== 'admin')
    return res.status(403).json({ error: '上司（管理者）権限が必要です' });
  next();
}

// ================= API =================

// チェックリスト定義
app.get('/api/checklist', (req, res) => res.json(checklist));

// ログイン用ユーザー一覧（名前選択用。パスワードは返さない）
app.get('/api/users', (req, res) => {
  const rows = db
    .prepare(`SELECT name, role FROM users WHERE active = 1 ORDER BY role DESC, id`)
    .all();
  res.json(rows);
});

// 現在のログイン状態
app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ログイン
app.post('/api/login', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password)
    return res.status(400).json({ error: '名前とパスワードを入力してください' });
  const u = db.prepare(`SELECT * FROM users WHERE name = ? AND active = 1`).get(name);
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: '名前またはパスワードが違います' });
  req.session.user = { id: u.id, name: u.name, role: u.role };
  res.json({ user: req.session.user });
});

// ログアウト
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// パスワード変更
app.post('/api/change-password', requireLogin, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 6)
    return res.status(400).json({ error: '新しいパスワードは6文字以上にしてください' });
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.session.user.id);
  if (!bcrypt.compareSync(current || '', u.password_hash))
    return res.status(400).json({ error: '現在のパスワードが違います' });
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
    bcrypt.hashSync(next, 10),
    u.id
  );
  res.json({ ok: true });
});

// ---- 提出（スタッフ）----
// multipart/form-data: signature(画像), payload(JSON文字列)
app.post('/api/submissions', requireLogin, upload.single('signature'), (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload || '{}');
  } catch {
    return res.status(400).json({ error: '送信データが不正です' });
  }
  const serviceDate = (payload.serviceDate || '').trim();
  const staffName = (payload.staffName || req.session.user.name || '').trim();
  if (!serviceDate) return res.status(400).json({ error: '実施日を入力してください' });
  if (!req.file) return res.status(400).json({ error: 'サイン済み用紙の写真をアップロードしてください' });

  const checked = Array.isArray(payload.checked)
    ? payload.checked.filter((n) => ALL_ITEM_NOS.includes(n))
    : [];

  const info = db
    .prepare(
      `INSERT INTO submissions
        (user_id, staff_name, service_date, staff_count, checked_json,
         item_notes_json, remarks, signature_file, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`
    )
    .run(
      req.session.user.id,
      staffName,
      serviceDate,
      (payload.staffCount || '').trim(),
      JSON.stringify(checked),
      JSON.stringify(payload.itemNotes || {}),
      (payload.remarks || '').trim(),
      req.file.filename
    );
  res.json({ id: info.lastInsertRowid, ok: true });
});

function decorate(row) {
  if (!row) return row;
  const checked = JSON.parse(row.checked_json || '[]');
  return {
    id: row.id,
    staffName: row.staff_name,
    serviceDate: row.service_date,
    staffCount: row.staff_count,
    checkedCount: checked.length,
    totalItems: TOTAL_ITEMS,
    checked,
    itemNotes: JSON.parse(row.item_notes_json || '{}'),
    remarks: row.remarks,
    signatureFile: row.signature_file,
    status: row.status,
    approverName: row.approver_name,
    approvalComment: row.approval_comment,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

// 一覧（スタッフ＝自分の分のみ / 上司＝全件、status等で絞り込み）
app.get('/api/submissions', requireLogin, (req, res) => {
  const me = req.session.user;
  const status = req.query.status;
  let sql = `SELECT * FROM submissions`;
  const where = [];
  const params = [];
  if (me.role !== 'admin') {
    where.push('user_id = ?');
    params.push(me.id);
  }
  if (status && ['submitted', 'approved', 'rejected'].includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += " ORDER BY (status = 'submitted') DESC, created_at DESC";
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(decorate));
});

// 詳細
app.get('/api/submissions/:id', requireLogin, (req, res) => {
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  if (req.session.user.role !== 'admin' && row.user_id !== req.session.user.id)
    return res.status(403).json({ error: '閲覧権限がありません' });
  res.json(decorate(row));
});

// 承認 / 差し戻し（上司のみ）
app.post('/api/submissions/:id/review', requireAdmin, (req, res) => {
  const { action, comment } = req.body || {};
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ error: 'action が不正です' });
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.prepare(
    `UPDATE submissions
       SET status = ?, approver_id = ?, approver_name = ?, approval_comment = ?,
           reviewed_at = datetime('now','localtime'),
           updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(status, req.session.user.id, req.session.user.name, (comment || '').trim(), row.id);
  res.json({ ok: true, status });
});

// サイン画像（ログイン必須。スタッフは自分の分のみ）
app.get('/api/submissions/:id/signature', requireLogin, (req, res) => {
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(req.params.id);
  if (!row || !row.signature_file) return res.status(404).send('not found');
  if (req.session.user.role !== 'admin' && row.user_id !== req.session.user.id)
    return res.status(403).send('forbidden');
  const file = path.join(UPLOAD_DIR, path.basename(row.signature_file));
  if (!fs.existsSync(file)) return res.status(404).send('not found');
  res.sendFile(file);
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'エラーが発生しました' });
  next();
});

app.listen(PORT, () => {
  console.log(`業務チェックリスト Web版 → http://localhost:${PORT}`);
});
