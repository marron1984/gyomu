'use strict';
// 初期ユーザーを登録するシードスクリプト。
// 実行: npm run init-db
// 既に存在するユーザーはスキップする（パスワードは上書きしない）。
const bcrypt = require('bcryptjs');
const db = require('../db');

// 初期ユーザー（運用に合わせて編集してください）。
// role: 'staff' = スタッフ / 'admin' = 上司（承認者）
const SEED_USERS = [
  { name: '上司（管理者）', role: 'admin', password: 'admin1234' },
  { name: 'スタッフA', role: 'staff', password: 'staff1234' },
  { name: 'スタッフB', role: 'staff', password: 'staff1234' },
];

const insert = db.prepare(
  `INSERT INTO users (name, role, password_hash) VALUES (?, ?, ?)`
);
const findByName = db.prepare(`SELECT id FROM users WHERE name = ?`);

let created = 0;
for (const u of SEED_USERS) {
  if (findByName.get(u.name)) {
    console.log(`スキップ（既存）: ${u.name}`);
    continue;
  }
  const hash = bcrypt.hashSync(u.password, 10);
  insert.run(u.name, u.role, hash);
  created++;
  console.log(`作成: ${u.name} (${u.role}) / 初期パスワード: ${u.password}`);
}

console.log(`\n完了。${created} 件のユーザーを作成しました。`);
console.log('セキュリティのため、初回ログイン後にパスワードを変更してください。');
