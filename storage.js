'use strict';
// サイン写真の保存先を抽象化する。
// 本番(Vercel): BLOB_READ_WRITE_TOKEN があれば Vercel Blob を使用。
// ローカル/テスト: トークンが無ければ uploads/ にファイル保存。
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

async function saveSignature(buffer, mimetype) {
  const ext = (mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  if (useBlob) {
    const { put } = require('@vercel/blob');
    const blob = await put(`signatures/sign_${Date.now()}.${ext}`, buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: mimetype,
    });
    return blob.url; // https://...
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `sign_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return `local:${name}`;
}

// 保存先URL/参照から画像バイト列を取得
async function readSignature(ref) {
  if (!ref) return null;
  if (ref.startsWith('local:')) {
    const file = path.join(UPLOAD_DIR, path.basename(ref.slice('local:'.length)));
    if (!fs.existsSync(file)) return null;
    return { buffer: fs.readFileSync(file) };
  }
  const r = await fetch(ref);
  if (!r.ok) return null;
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get('content-type'),
  };
}

module.exports = { saveSignature, readSignature, useBlob };
