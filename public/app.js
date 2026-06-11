'use strict';

const App = {
  user: null,
  checklist: null,
};

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// 画像を縮小してアップロードサイズを抑える（最大辺1600px / JPEG）。失敗時は元ファイル。
function downscaleImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => { URL.revokeObjectURL(url); resolve(blob && blob.size < file.size ? blob : file); },
          'image/jpeg', quality
        );
      } catch { URL.revokeObjectURL(url); resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || 'エラーが発生しました');
  return data;
}

// 注意点の「キーワード=説明」を強調
function fmtNote(note) {
  if (!note) return '';
  return esc(note).replace(/(注意|確認|単位|スケール|食前薬|血糖|インスリン|誤嚥|むせ|こぼし|放置しない|最優先)/g, '<b>$1</b>');
}

// ================= Auth boot =================
async function boot() {
  try {
    const me = await api('/api/me');
    App.user = me.user;
  } catch {
    App.user = null;
  }
  if (App.user) {
    App.checklist = App.checklist || (await api('/api/checklist'));
    showApp();
  } else {
    renderLogin();
  }
}

function showApp() {
  $('#appHeader').classList.remove('hidden');
  $('#userBadge').textContent =
    App.user.name + (App.user.role === 'admin' ? '（上司）' : '（スタッフ）');
  if (App.user.role === 'admin') renderAdminList();
  else renderStaffHome();
}

// ================= Login =================
async function renderLogin() {
  $('#appHeader').classList.add('hidden');
  const app = $('#app');
  app.innerHTML = '';
  app.className = '';
  const wrap = el('div', 'login-wrap');
  const card = el('div', 'login-card');
  card.innerHTML = `
    <h1>A勤 業務チェックリスト</h1>
    <p class="lead">名前を選び、パスワードを入力してください</p>
    <label>お名前
      <select id="loginName"><option value="">読み込み中…</option></select>
    </label>
    <label>パスワード
      <input type="password" id="loginPw" autocomplete="current-password" />
    </label>
    <button class="btn-primary btn-block" id="loginBtn" type="button">ログイン</button>
  `;
  wrap.appendChild(card);
  app.appendChild(wrap);

  try {
    const users = await api('/api/users');
    const sel = $('#loginName');
    sel.innerHTML = '<option value="">選択してください</option>';
    users.forEach((u) => {
      const o = el('option');
      o.value = u.name;
      o.textContent = u.name + (u.role === 'admin' ? '（上司）' : '');
      sel.appendChild(o);
    });
  } catch (e) {
    toast(e.message, true);
  }

  const doLogin = async () => {
    const name = $('#loginName').value;
    const password = $('#loginPw').value;
    if (!name) return toast('お名前を選んでください', true);
    try {
      const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ name, password }) });
      App.user = r.user;
      App.checklist = App.checklist || (await api('/api/checklist'));
      showApp();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('#loginBtn').onclick = doLogin;
  $('#loginPw').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
}

// ================= Staff home (checklist + my submissions) =================
function renderStaffHome() {
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(el('h1', 'page-title', '本日の業務チェック'));
  app.appendChild(el('p', 'page-sub', esc(App.checklist.subtitle)));

  // タブ：新規入力 / 提出履歴
  const tabs = el('div', 'tabs');
  const tabNew = el('button', 'tab active', '新規チェック入力');
  const tabHist = el('button', 'tab', '提出履歴');
  tabs.append(tabNew, tabHist);
  app.appendChild(tabs);

  const container = el('div');
  app.appendChild(container);

  tabNew.onclick = () => { tabNew.classList.add('active'); tabHist.classList.remove('active'); renderChecklistForm(container); };
  tabHist.onclick = () => { tabHist.classList.add('active'); tabNew.classList.remove('active'); renderMySubmissions(container); };

  renderChecklistForm(container);
}

function renderChecklistForm(container) {
  container.innerHTML = '';
  const state = { checked: new Set(), itemNotes: {}, file: null };

  // --- メタ情報 ---
  const metaCard = el('div', 'card');
  metaCard.innerHTML = `
    <h2>基本情報</h2>
    <div class="meta-grid">
      <label>実施日 <input type="date" id="mDate" /></label>
      <label>担当者 <input type="text" id="mStaff" value="${esc(App.user.name)}" /></label>
    </div>
    <label style="margin-top:12px">人員
      <span class="radio-row">
        <label><input type="radio" name="mCount" value="2名" /> 2名</label>
        <label><input type="radio" name="mCount" value="1名" /> 1名</label>
      </span>
    </label>
    <p class="page-sub" style="margin:8px 0 0">${esc(App.checklist.legend)}</p>
  `;
  container.appendChild(metaCard);
  metaCard.querySelector('#mDate').value = new Date().toISOString().slice(0, 10);

  // --- 進捗（sticky） ---
  const prog = el('div', 'sticky-progress');
  prog.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" id="progFill"></div></div>
    <div class="progress-label" id="progLabel"></div>`;
  container.appendChild(prog);

  // --- フェーズ・項目 ---
  const total = App.checklist.phases.reduce(
    (a, p) => a + p.subsections.reduce((b, s) => b + s.items.length, 0), 0
  );
  function updateProgress() {
    const n = state.checked.size;
    $('#progFill').style.width = (total ? (n / total) * 100 : 0) + '%';
    $('#progLabel').textContent = `${n} / ${total} 項目 完了`;
  }

  App.checklist.phases.forEach((phase, pi) => {
    const pd = el('div', 'phase');
    const head = el('div', 'phase-head');
    const totalP = phase.subsections.reduce((b, s) => b + s.items.length, 0);
    head.innerHTML = `
      <span class="phase-toggle">▼</span>
      <h3>${esc(phase.title)}</h3>
      <span class="phase-count" data-pc="${pi}">0 / ${totalP}</span>`;
    const body = el('div', 'phase-body');
    if (phase.desc) body.appendChild(el('div', 'phase-desc', esc(phase.desc)));

    phase.subsections.forEach((sub) => {
      if (sub.title) body.appendChild(el('div', 'sub-title', esc(sub.title)));
      sub.items.forEach((item) => {
        const it = el('div', `item cat-${item.category}`);
        it.dataset.no = item.no;
        const meta = [item.room, item.name].filter((x) => x).join(' ・ ');
        it.innerHTML = `
          <div class="item-check"><input type="checkbox" /></div>
          <div class="item-main">
            <div class="item-top">
              <span class="item-no">No.${item.no}</span>
              <span class="tag ${item.category}">${esc(item.category)}</span>
              ${meta ? `<span class="tag">${esc(meta)}</span>` : ''}
            </div>
            <div class="item-task">${esc(item.task)}</div>
            ${item.note ? `<div class="item-note">${fmtNote(item.note)}</div>` : ''}
            <div class="item-memo"><input type="text" placeholder="メモ・気づき（任意）" /></div>
          </div>`;
        const cb = it.querySelector('input[type=checkbox]');
        cb.onchange = () => {
          if (cb.checked) { state.checked.add(item.no); it.classList.add('done'); }
          else { state.checked.delete(item.no); it.classList.remove('done'); }
          // フェーズ件数
          const done = phase.subsections.reduce(
            (b, s) => b + s.items.filter((x) => state.checked.has(x.no)).length, 0);
          head.querySelector(`[data-pc="${pi}"]`).textContent = `${done} / ${totalP}`;
          updateProgress();
        };
        const memo = it.querySelector('.item-memo input');
        memo.oninput = () => {
          const v = memo.value.trim();
          if (v) state.itemNotes[item.no] = v; else delete state.itemNotes[item.no];
        };
        body.appendChild(it);
      });
    });

    head.onclick = (e) => { if (e.target.closest('input')) return; pd.classList.toggle('collapsed'); };
    pd.append(head, body);
    container.appendChild(pd);
  });

  // --- 送迎表（参考） ---
  if (App.checklist.transport && App.checklist.transport.length) {
    const tcard = el('div', 'card');
    tcard.appendChild(el('h2', null, 'デイサービス送迎（参考・曜日別）'));
    const tbl = el('table', 'transport-table');
    tbl.innerHTML =
      '<tbody>' +
      App.checklist.transport
        .map((t) => `<tr><th>${esc(t.day)}</th><td>${esc(t.detail)}</td></tr>`)
        .join('') +
      '</tbody>';
    tcard.appendChild(tbl);
    container.appendChild(tcard);
  }

  // --- 完了サイン・提出 ---
  const signCard = el('div', 'card');
  signCard.innerHTML = `
    <h2>完了サイン・提出</h2>
    <p class="page-sub">業務完了後、<b>サイン済みの用紙</b>を撮影してアップロードしてください。上司が内容を確認し承認します。</p>
    <label>備考・申し送り（任意）<textarea id="remarks" placeholder="気づいた事項・変更点など"></textarea></label>
    <div class="sign-drop" id="signDrop">📷 サイン済み用紙の写真を撮影 / 選択</div>
    <input type="file" id="signInput" accept="image/*" capture="environment" class="hidden" />
    <div class="sign-preview" id="signPreview"></div>
    <button class="btn-primary btn-block" id="submitBtn" type="button" style="margin-top:16px">提出する（上司へ申請）</button>
  `;
  container.appendChild(signCard);

  const signInput = signCard.querySelector('#signInput');
  signCard.querySelector('#signDrop').onclick = () => signInput.click();
  signInput.onchange = () => {
    const f = signInput.files[0];
    if (!f) return;
    state.file = f;
    const url = URL.createObjectURL(f);
    signCard.querySelector('#signPreview').innerHTML = `<img src="${url}" alt="サイン" />`;
    signCard.querySelector('#signDrop').textContent = '📷 写真を変更する（' + f.name + '）';
  };

  signCard.querySelector('#submitBtn').onclick = async () => {
    const date = metaCard.querySelector('#mDate').value;
    const staffName = metaCard.querySelector('#mStaff').value.trim();
    const countEl = metaCard.querySelector('input[name=mCount]:checked');
    if (!date) return toast('実施日を入力してください', true);
    if (!state.file) return toast('サイン済み用紙の写真をアップロードしてください', true);
    if (state.checked.size < total) {
      if (!confirm(`未チェックの項目が ${total - state.checked.size} 件あります。このまま提出しますか？`)) return;
    }
    const payload = {
      serviceDate: date,
      staffName,
      staffCount: countEl ? countEl.value : '',
      checked: [...state.checked],
      itemNotes: state.itemNotes,
      remarks: signCard.querySelector('#remarks').value,
    };
    const btn = signCard.querySelector('#submitBtn');
    btn.disabled = true; btn.textContent = '送信中…';
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      const signBlob = await downscaleImage(state.file);
      fd.append('signature', signBlob, 'signature.jpg');
      await api('/api/submissions', { method: 'POST', body: fd });
      toast('提出しました。上司の承認をお待ちください。');
      renderStaffHome();
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false; btn.textContent = '提出する（上司へ申請）';
    }
  };

  updateProgress();
}

async function renderMySubmissions(container) {
  container.innerHTML = '<div class="empty">読み込み中…</div>';
  try {
    const rows = await api('/api/submissions');
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el('div', 'empty', 'まだ提出はありません。'));
      return;
    }
    const list = el('div', 'sub-list');
    rows.forEach((r) => list.appendChild(submissionRow(r, () => openDetail(r.id, false))));
    container.appendChild(list);
  } catch (e) {
    container.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function statusLabel(s) {
  return { submitted: '承認待ち', approved: '承認済み', rejected: '差し戻し' }[s] || s;
}

function submissionRow(r, onClick) {
  const row = el('div', 'sub-row');
  row.innerHTML = `
    <div class="grow">
      <div class="sub-date">${esc(r.serviceDate)} <span class="sub-meta">／ ${esc(r.staffName)}${r.staffCount ? '・' + esc(r.staffCount) : ''}</span></div>
      <div class="sub-meta">完了 ${r.checkedCount} / ${r.totalItems} 項目　提出: ${esc(r.createdAt)}</div>
    </div>
    <span class="badge ${r.status}">${statusLabel(r.status)}</span>`;
  row.onclick = onClick;
  return row;
}

// ================= Admin =================
function renderAdminList() {
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(el('h1', 'page-title', '提出一覧・承認'));
  app.appendChild(el('p', 'page-sub', 'スタッフが提出したチェックリストを確認し、承認または差し戻しを行います。'));

  const tabs = el('div', 'tabs');
  const defs = [
    ['submitted', '承認待ち'],
    ['approved', '承認済み'],
    ['rejected', '差し戻し'],
    ['', 'すべて'],
  ];
  const listWrap = el('div');
  defs.forEach(([val, label], idx) => {
    const t = el('button', 'tab' + (idx === 0 ? ' active' : ''), label);
    t.onclick = () => {
      tabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      loadAdmin(val, listWrap);
    };
    tabs.appendChild(t);
  });
  app.append(tabs, listWrap);
  loadAdmin('submitted', listWrap);
}

async function loadAdmin(status, wrap) {
  wrap.innerHTML = '<div class="empty">読み込み中…</div>';
  try {
    const rows = await api('/api/submissions' + (status ? '?status=' + status : ''));
    wrap.innerHTML = '';
    if (!rows.length) {
      wrap.appendChild(el('div', 'empty', '該当する提出はありません。'));
      return;
    }
    const list = el('div', 'sub-list');
    rows.forEach((r) => list.appendChild(submissionRow(r, () => openDetail(r.id, true))));
    wrap.appendChild(list);
  } catch (e) {
    wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ================= Detail (staff view + admin review) =================
async function openDetail(id, isAdmin) {
  const app = $('#app');
  app.innerHTML = '<div class="empty">読み込み中…</div>';
  let r;
  try {
    r = await api('/api/submissions/' + id);
  } catch (e) {
    app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  app.innerHTML = '';
  const back = el('button', 'back-link', '← 一覧へ戻る');
  back.onclick = () => (isAdmin ? renderAdminList() : renderStaffHome());
  app.appendChild(back);

  const head = el('div', 'card');
  head.innerHTML = `
    <h2>${esc(r.serviceDate)} の提出 <span class="badge ${r.status}">${statusLabel(r.status)}</span></h2>
    <div class="detail-grid">
      <div class="kv"><span class="k">担当者</span><span>${esc(r.staffName)}</span></div>
      <div class="kv"><span class="k">人員</span><span>${esc(r.staffCount || '—')}</span></div>
      <div class="kv"><span class="k">完了項目</span><span>${r.checkedCount} / ${r.totalItems}</span></div>
      <div class="kv"><span class="k">提出日時</span><span>${esc(r.createdAt)}</span></div>
      ${r.remarks ? `<div class="kv"><span class="k">備考</span><span>${esc(r.remarks)}</span></div>` : ''}
    </div>`;
  app.appendChild(head);

  // 状態コールアウト
  if (r.status !== 'submitted') {
    const c = el('div', 'callout ' + r.status);
    c.innerHTML = `<b>${r.status === 'approved' ? '承認済み' : '差し戻し'}</b>　${esc(r.approverName || '')} ／ ${esc(r.reviewedAt || '')}`
      + (r.approvalComment ? `<br>コメント: ${esc(r.approvalComment)}` : '');
    app.appendChild(c);
  }

  // サイン写真
  const signCard = el('div', 'card');
  signCard.innerHTML = `<h2>完了サイン（アップロード写真）</h2>`;
  if (r.hasSignature) {
    const img = el('img');
    img.src = '/api/submissions/' + id + '/signature';
    img.alt = 'サイン写真';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '10px';
    img.style.border = '1px solid var(--border)';
    signCard.appendChild(img);
  } else {
    signCard.appendChild(el('p', 'page-sub', '写真がありません。'));
  }
  app.appendChild(signCard);

  // チェック項目の内訳
  const itemsCard = el('div', 'card');
  itemsCard.appendChild(el('h2', null, 'チェック項目の内訳'));
  const checkedSet = new Set(r.checked);
  App.checklist.phases.forEach((phase) => {
    const ph = el('div', 'detail-items');
    ph.appendChild(el('div', 'sub-title', esc(phase.title)));
    phase.subsections.forEach((sub) => {
      sub.items.forEach((item) => {
        const done = checkedSet.has(item.no);
        const di = el('div', 'detail-item ' + (done ? 'done' : 'undone'));
        const memo = r.itemNotes && r.itemNotes[item.no];
        di.innerHTML = `<span class="mark">${done ? '✓' : '○'}</span>
          <span>No.${item.no} ${esc(item.task)}${item.name ? '（' + esc(item.name) + '）' : ''}
          ${memo ? `<br><span class="item-note">メモ: ${esc(memo)}</span>` : ''}</span>`;
        ph.appendChild(di);
      });
    });
    itemsCard.appendChild(ph);
  });
  app.appendChild(itemsCard);

  // 承認操作（上司かつ承認待ちのみ）
  if (isAdmin && App.user.role === 'admin' && r.status === 'submitted') {
    const rev = el('div', 'card');
    rev.innerHTML = `
      <h2>承認・差し戻し</h2>
      <label>コメント（任意 / 差し戻し時は理由を記入）<textarea id="revComment" placeholder="例: No.35 のインスリン単位を確認してください"></textarea></label>
      <div class="review-box">
        <button class="btn-approve" id="approveBtn" type="button">承認する</button>
        <button class="btn-reject" id="rejectBtn" type="button">差し戻す</button>
      </div>`;
    app.appendChild(rev);
    const doReview = async (action) => {
      const comment = rev.querySelector('#revComment').value;
      if (action === 'reject' && !comment.trim()) {
        if (!confirm('コメントなしで差し戻しますか？')) return;
      }
      try {
        await api('/api/submissions/' + id + '/review', {
          method: 'POST',
          body: JSON.stringify({ action, comment }),
        });
        toast(action === 'approve' ? '承認しました' : '差し戻しました');
        renderAdminList();
      } catch (e) {
        toast(e.message, true);
      }
    };
    rev.querySelector('#approveBtn').onclick = () => doReview('approve');
    rev.querySelector('#rejectBtn').onclick = () => doReview('reject');
  }
}

// ================= Header actions =================
$('#logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  App.user = null;
  renderLogin();
};
$('#pwBtn').onclick = () => $('#pwModal').classList.remove('hidden');
document.querySelector('[data-close-pw]').onclick = () => $('#pwModal').classList.add('hidden');
$('#pwSave').onclick = async () => {
  const current = $('#pwCurrent').value;
  const next = $('#pwNext').value;
  try {
    await api('/api/change-password', { method: 'POST', body: JSON.stringify({ current, next }) });
    toast('パスワードを変更しました');
    $('#pwModal').classList.add('hidden');
    $('#pwCurrent').value = ''; $('#pwNext').value = '';
  } catch (e) {
    toast(e.message, true);
  }
};

boot();
