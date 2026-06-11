'use strict';
// スキーマ作成＋初期ユーザー投入を手動実行するスクリプト。
// 通常はアプリ初回アクセス時に自動実行されるため必須ではない。
// 実行: POSTGRES_URL=... npm run init-db
const { ensureReady, pool, query } = require('../db');

(async () => {
  try {
    await ensureReady();
    const users = await query(`SELECT name, role FROM users ORDER BY role DESC, id`);
    console.log('現在のユーザー:');
    users.forEach((u) => console.log(`  - ${u.name} (${u.role})`));
    console.log('\n完了。初回ログイン後にパスワードを変更してください。');
  } catch (e) {
    console.error('エラー:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
