(function () {
  "use strict";

  var STORAGE_KEY = "gyomu-checklist-v1";
  var data = window.CHECKLIST_DATA;

  // --- 当日の日付（YYYY-MM-DD、ローカルタイム） ---
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  // --- 状態の読み込み（日付が変わっていればチェックをリセット） ---
  function loadState() {
    var today = todayStr();
    var state = { date: today, staff: "", checks: {} };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        // 担当者名は引き継ぐ。チェックは当日分のみ有効。
        state.staff = saved.staff || "";
        if (saved.date === today && saved.checks) {
          state.checks = saved.checks;
        }
      }
    } catch (e) {
      /* 壊れたデータは無視して初期化 */
    }
    return state;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 保存できない環境では黙って続行 */
    }
  }

  var state = loadState();

  // --- 全項目をフラットに収集（進捗計算用） ---
  function allItems() {
    var list = [];
    data.sections.forEach(function (sec) {
      if (sec.items) list = list.concat(sec.items);
      if (sec.subsections) {
        sec.subsections.forEach(function (sub) {
          list = list.concat(sub.items);
        });
      }
    });
    return list;
  }
  var ITEMS = allItems();
  var TOTAL = ITEMS.length;

  // --- DOM参照 ---
  var elTitle = document.getElementById("appTitle");
  var elSubtitle = document.getElementById("appSubtitle");
  var elDate = document.getElementById("dateBadge");
  var elStaff = document.getElementById("staffInput");
  var elHideDone = document.getElementById("hideDone");
  var elReset = document.getElementById("resetBtn");
  var elFill = document.getElementById("progressFill");
  var elProgText = document.getElementById("progressText");
  var elList = document.getElementById("checklist");

  // --- ヘッダー初期化 ---
  elTitle.textContent = data.title;
  elSubtitle.textContent = data.subtitle;
  var d = new Date();
  var wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  elDate.textContent = d.getMonth() + 1 + "月" + d.getDate() + "日（" + wd + "）";
  elStaff.value = state.staff;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // --- 1項目のDOM生成 ---
  function renderItem(item) {
    var id = "item-" + item.no;
    var div = document.createElement("label");
    div.className = "item kubun-" + item.kubun;
    div.setAttribute("for", id);
    div.dataset.no = item.no;

    var meta = '<div class="meta">';
    meta += '<span class="no">No.' + item.no + "</span>";
    meta += '<span class="badge b-' + item.kubun + '">' + item.kubun + "</span>";
    if (item.room) meta += '<span class="room">' + escapeHtml(item.room) + "</span>";
    if (item.name) meta += '<span class="pname">' + escapeHtml(item.name) + "</span>";
    meta += "</div>";

    var note = item.note
      ? '<span class="note">⚠ ' + escapeHtml(item.note) + "</span>"
      : "";

    div.innerHTML =
      '<span class="check"><input type="checkbox" id="' +
      id +
      '"></span>' +
      '<span class="body">' +
      meta +
      '<div class="action">' +
      escapeHtml(item.action) +
      "</div>" +
      note +
      "</span>";

    var cb = div.querySelector("input");
    cb.checked = !!state.checks[item.no];
    if (cb.checked) div.classList.add("done");

    cb.addEventListener("change", function () {
      if (cb.checked) state.checks[item.no] = true;
      else delete state.checks[item.no];
      div.classList.toggle("done", cb.checked);
      saveState();
      updateProgress();
      applyFilter();
    });

    return div;
  }

  // --- セクション数カウント ---
  function countDone(items) {
    var n = 0;
    items.forEach(function (it) {
      if (state.checks[it.no]) n++;
    });
    return n;
  }

  // --- 全体描画 ---
  function render() {
    elList.innerHTML = "";
    data.sections.forEach(function (sec, idx) {
      var secEl = document.createElement("section");
      secEl.className = "section";
      secEl.dataset.idx = idx;

      var secItems = sec.items
        ? sec.items.slice()
        : sec.subsections.reduce(function (acc, s) {
            return acc.concat(s.items);
          }, []);

      var head = document.createElement("button");
      head.type = "button";
      head.className = "section-head";
      head.innerHTML =
        '<span class="phase-tag">' +
        escapeHtml(sec.phase) +
        "</span>" +
        '<span class="sec-title">' +
        escapeHtml(sec.title) +
        "</span>" +
        '<span class="sec-count" data-count></span>' +
        '<span class="chevron">▼</span>';
      head.addEventListener("click", function () {
        secEl.classList.toggle("collapsed");
      });
      secEl.appendChild(head);

      var body = document.createElement("div");
      body.className = "section-body";

      if (sec.items) {
        sec.items.forEach(function (it) {
          body.appendChild(renderItem(it));
        });
      } else {
        sec.subsections.forEach(function (sub) {
          var st = document.createElement("div");
          st.className = "subsection-title";
          st.textContent = sub.title;
          body.appendChild(st);
          sub.items.forEach(function (it) {
            body.appendChild(renderItem(it));
          });
        });
      }

      secEl.appendChild(body);
      secEl._items = secItems;
      secEl._countEl = head.querySelector("[data-count]");
      elList.appendChild(secEl);
    });
  }

  function updateProgress() {
    var done = 0;
    ITEMS.forEach(function (it) {
      if (state.checks[it.no]) done++;
    });
    var pct = TOTAL ? Math.round((done / TOTAL) * 100) : 0;
    elFill.style.width = pct + "%";
    elProgText.textContent = done + " / " + TOTAL + "（" + pct + "%）";

    // 各セクションのカウント更新
    Array.prototype.forEach.call(
      elList.querySelectorAll(".section"),
      function (secEl) {
        var c = countDone(secEl._items);
        secEl._countEl.textContent = c + "/" + secEl._items.length;
      }
    );
  }

  function applyFilter() {
    var hide = elHideDone.checked;
    Array.prototype.forEach.call(
      elList.querySelectorAll(".item"),
      function (it) {
        var done = it.classList.contains("done");
        it.style.display = hide && done ? "none" : "";
      }
    );
  }

  // --- イベント ---
  elStaff.addEventListener("input", function () {
    state.staff = elStaff.value;
    saveState();
  });

  elHideDone.addEventListener("change", applyFilter);

  elReset.addEventListener("click", function () {
    if (!confirm("本日のチェックをすべてクリアします。よろしいですか？")) return;
    state.checks = {};
    saveState();
    Array.prototype.forEach.call(
      elList.querySelectorAll(".item input"),
      function (cb) {
        cb.checked = false;
        cb.closest(".item").classList.remove("done");
      }
    );
    updateProgress();
    applyFilter();
  });

  // --- 起動 ---
  render();
  updateProgress();
  applyFilter();
})();
