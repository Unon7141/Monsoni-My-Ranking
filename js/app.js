(function () {
  "use strict";

  const SONGS = window.MONSONI_SONGS;
  const N = SONGS.length;
  const K = 10;
  const Share = window.MonsoniShare;

  // ユニットの色（公式バナーから。2色のユニットは配列）
  const UNIT_COLORS = {
    "背徳ピストルズ": "#6b6b70",
    "Two for all": ["#ff1b99", "#71bfff"],
    "デビルズ・パンク・インフェルノ": "#a3302a",
    "Angely Diva": "#fae18e",
    "幕末リザレクション": "#239723",
    "モノノケ少女": "#9b22b8",
    "白雪姫リボン": "#fcb2e3",
    "終末運命共同隊": "#18fafa",
    "骸": "#56655b",
    "えび天娘。": "#e3cb5a",
    "キル×ユア×アイドル": "#e60032c2",
    "さよならグラビティ": "#8acbf0",
    "マジカル☆メルルンず": "#7a645a",
    "ヤバい女子高生たち、": ["#4b4fc8", "#e02a2a"],
    "アンドロイドダイナー": ["#2fbf6a", "#e2e033"],
    "カルマロックスター": ["#b62d3f", "#683ae8"],
    "東方萌萌美人": ["#d53fc7", "#e8d23a"],
    "CALEzMA": ["#2aa9c9", "#d38bc8"],
    "アンダーワールド・トラベラーズ": ["#7a4a86", "#3fa58f"],
  };
  const unitColors = (u) => [].concat(UNIT_COLORS[u] || "#bbb3e0");
  const colorsOf = (s) => unitColors(s.u);
  // --c に1色目、--c2 に2色目（1色のユニットは --c2 なし）
  function setUnitColors(el, u) {
    const [c, c2] = unitColors(u);
    el.style.setProperty("--c", c);
    if (c2) el.style.setProperty("--c2", c2);
    else el.style.removeProperty("--c2");
  }
  const imgUrl = (s, size) =>
    window.MONSONI_IMG_BASE + (size >= 600 ? s.img.replace("00001e02", "0000b273") : s.img);

  const STORE_KEY = "monsoni-sort:v1";
  const FILTER_KEY = "monsoni-sort:filter:v1";
  const SIG = SONGS.map((s) => s.id).join("").length + ":" + SONGS.map((s) => s.id.slice(0, 3)).join("");

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let engine = null;
  let pair = null;
  let deciding = false;
  const filterOut = new Set();

  // ---------- 保存 ----------
  function save() {
    if (!engine) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ sig: SIG, ...engine.serialize(), at: Date.now() }));
    } catch (e) { /* 保存できなくても遊べる */ }
  }
  function loadSaved() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (d && d.sig === SIG && Array.isArray(d.history)) return d;
    } catch (e) { /* noop */ }
    return null;
  }
  function clearSaved() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
  }
  // 途中の結果があれば、新しくはじめる前に確認する
  function confirmDiscard() {
    const saved = loadSaved();
    return !(saved && saved.history.length) || window.confirm("途中の結果は消えます。新しくはじめますか？");
  }

  // 曲をしぼる画面の選択（下書き）
  function saveFilter() {
    try {
      if (filterOut.size) localStorage.setItem(FILTER_KEY, JSON.stringify({ sig: SIG, out: [...filterOut] }));
      else localStorage.removeItem(FILTER_KEY);
    } catch (e) { /* noop */ }
  }
  function loadFilter() {
    try {
      const d = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
      if (d && d.sig === SIG && Array.isArray(d.out))
        d.out.forEach((i) => { if (Number.isInteger(i) && i >= 0 && i < N) filterOut.add(i); });
    } catch (e) { /* noop */ }
  }
  function clearFilter() {
    filterOut.clear();
    try { localStorage.removeItem(FILTER_KEY); } catch (e) { /* noop */ }
  }

  // ---------- URL（#/filter など。スタートはハッシュなし） ----------
  // 履歴は画面が変わるときだけ積む。対戦・幕間・結果のあいだの移動は置き換えるので、
  // ブラウザの「戻る」はひとつ戻るではなく、ゲームに入る前の画面に戻る。
  const ROUTES = { "screen-filter": "filter", "screen-battle": "battle", "screen-interlude": "interlude", "screen-result": "result" };
  const IN_GAME = new Set(["battle", "interlude", "result"]);
  let navReplace = false;
  let shownRoute = null;

  function routeOfHash() {
    const m = /^#\/(\w+)$/.exec(location.hash);
    return m ? m[1] : "";
  }
  function syncRoute(id) {
    const name = ROUTES[id] || "";
    const cur = routeOfHash();
    shownRoute = name;
    if (cur === name && location.hash === (name ? "#/" + name : "")) return;
    const replace = navReplace || (IN_GAME.has(cur) && IN_GAME.has(name));
    try {
      history[replace ? "replaceState" : "pushState"](null, "", name ? "#/" + name : location.pathname + location.search);
    } catch (e) { /* noop */ }
  }
  function replacing(fn) {
    navReplace = true;
    try { return fn(); } finally { navReplace = false; }
  }

  // 保存された進行を正として、ハッシュはその状態で見せられる画面を選ぶだけ
  function route(name) {
    if (name === "filter") return renderFilter();
    if (!engine && IN_GAME.has(name)) {
      const saved = loadSaved();
      if (saved) engine = new SortEngine(N, saved);
    }
    if (!engine || !IN_GAME.has(name)) return renderStart();
    const ph = engine.phase;
    if (name === "interlude" && ph >= 2) return renderInterlude();
    if (ph === 3) return renderResult();
    renderBattle(true);
  }
  function onNav(force) {
    const name = routeOfHash();
    if (force !== true && name === shownRoute) return;
    replacing(() => {
      route(name);
      const cur = $$(".screen").find((s) => !s.hidden);
      if (cur) syncRoute(cur.id);
    });
  }

  // ---------- 画面切替 ----------
  function show(id) {
    $$(".screen").forEach((s) => { s.hidden = s.id !== id; });
    if (id !== "screen-battle") closeListen();
    syncRoute(id);
    window.scrollTo(0, 0);
    const h = $(`#${id} [tabindex="-1"]`);
    if (h) h.focus({ preventScroll: true });
  }

  function toast(msg) {
    const t = $("[data-toast]");
    t.textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("is-shown"), 2600);
  }

  // ---------- スタート ----------
  function renderStart() {
    $$("[data-total]").forEach((el) => (el.textContent = N));
    $("[data-est-all]").textContent = SortEngine.estimateTotal(N, K);
    const rows = $("[data-blank-rows]");
    if (!rows.children.length) {
      for (let i = 1; i <= K; i++) {
        const li = document.createElement("li");
        li.className = "setlist__row" + (i === 1 ? " setlist__row--1" : i <= 3 ? ` setlist__row--${i}` : "");
        li.innerHTML = `<span class="setlist__num">${i}</span><span class="setlist__song">? ? ?</span>`;
        rows.appendChild(li);
      }
    }
    const saved = loadSaved();
    const resume = $('[data-action="resume"]');
    if (saved && saved.history.length) {
      const e = new SortEngine(N, saved);
      resume.hidden = false;
      $("[data-resume-label]").textContent =
        e.phase === 3 ? "結果を見る" : `${e.phase === 1 ? "第1ステージ" : "第2ステージ"}・${e.comparisons + 1}戦目から`;
      $('[data-action="start-all"]').classList.replace("btn--primary", "btn--ghost");
    } else {
      resume.hidden = true;
      $('[data-action="start-all"]').classList.replace("btn--ghost", "btn--primary");
    }
    show("screen-start");
  }

  function startEngine(excluded) {
    const seed = (Math.random() * 2 ** 31) >>> 0 || 7;
    engine = new SortEngine(N, { K, seed, excluded });
    save();
    proceed(false);
  }

  // ---------- 曲をしぼる ----------
  function renderFilter() {
    const root = $("[data-filter-groups]");
    if (!root.children.length) {
      const groups = new Map();
      SONGS.forEach((s, i) => {
        if (!groups.has(s.u)) groups.set(s.u, []);
        groups.get(s.u).push(i);
      });
      for (const [unit, ids] of groups) {
        const g = document.createElement("section");
        g.className = "fgroup";
        setUnitColors(g, unit);
        g.innerHTML = `
          <div class="fgroup__head">
            <h3 class="fgroup__name"><span class="penlight-dot" aria-hidden="true"></span>${esc(unit)} <span class="fgroup__count">${ids.length}曲</span></h3>
            <button type="button" class="chip" data-unit-toggle>まとめて外す</button>
          </div>
          <div class="fgroup__grid"></div>`;
        const grid = $(".fgroup__grid", g);
        ids.forEach((i) => {
          const s = SONGS[i];
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tile";
          b.dataset.song = i;
          b.innerHTML = `
            <span class="tile__art"><img src="${imgUrl(s, 300)}" alt="" loading="lazy" width="300" height="300"><span class="tile__mark">外す</span></span>
            <span class="tile__title">${esc(s.t)}</span>${s.note ? `<span class="tile__note">${esc(s.note)}</span>` : ""}`;
          // タイル全体はワンタップで外す／戻す。試聴はジャケット右上の小さなボタンだけ
          const wrap = document.createElement("div");
          wrap.className = "tile-wrap";
          wrap.appendChild(b);
          wrap.insertAdjacentHTML("beforeend",
            `<button type="button" class="tile__listen" data-listen-song="${i}" aria-label="${esc(s.t)} を試聴">▶</button>`);
          grid.appendChild(wrap);
        });
        $("[data-unit-toggle]", g).addEventListener("click", () => {
          const allOut = ids.every((i) => filterOut.has(i));
          ids.forEach((i) => (allOut ? filterOut.delete(i) : filterOut.add(i)));
          syncFilter();
        });
        root.appendChild(g);
      }
      root.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-listen-song]")) return;
        const t = ev.target.closest(".tile");
        if (!t) return;
        const i = +t.dataset.song;
        filterOut.has(i) ? filterOut.delete(i) : filterOut.add(i);
        syncFilter();
      });
    }
    syncFilter();
    show("screen-filter");
  }

  function syncFilter() {
    $$(".tile").forEach((t) => t.setAttribute("aria-pressed", String(!filterOut.has(+t.dataset.song))));
    $$(".fgroup").forEach((g) => {
      const ids = $$(".tile", g).map((t) => +t.dataset.song);
      $("[data-unit-toggle]", g).textContent = ids.every((i) => filterOut.has(i)) ? "まとめて戻す" : "まとめて外す";
    });
    saveFilter();
    const P = N - filterOut.size;
    $("[data-filter-count]").textContent = P;
    $("[data-filter-est]").textContent = SortEngine.estimateTotal(P, K);
    $('[data-action="start-filtered"]').disabled = P < 2;
  }

  // ---------- 進行 ----------
  // 第1ステージ→第2ステージに移ったら幕間を挟む
  function proceed(fromPhase1) {
    const ph = engine.phase;
    if (fromPhase1 && ph !== 1) return renderInterlude();
    if (ph === 3) return renderResult();
    renderBattle(true);
  }

  function renderBattle(withShow, fromUndo) {
    const st = engine.status();
    pair = engine.nextPair();
    if (!pair) return renderResult();

    const ph = st.phase;
    $("[data-phase-part]").textContent = ph === 1 ? "第1ステージ" : "第2ステージ";
    $("[data-phase-title]").textContent = ph === 1 ? `TOP${st.K}の${st.K}曲をしぼる` : `${st.K}曲の順位を決める`;
    $("[data-round]").textContent = engine.comparisons + 1;
    // 「TOP10確定 n/10」は、選んだ瞬間にTOP入りが分かってしまうので出さない
    const confirmed = $("[data-confirmed]");
    if (confirmed) {
      const sep = confirmed.nextElementSibling;
      if (sep && sep.classList.contains("sep")) sep.remove();
      $("[data-confirm-label]")?.remove();
      confirmed.remove();
    }
    $("[data-remaining]").textContent = engine.remainingEstimate();
    $("[data-candidates]").textContent = ph === 1 ? st.pool.filter((i) => st.state[i] !== -1).length : st.K;
    $('[data-action="remove-both"]').hidden = ph !== 1;
    // 「後に回す」は第1ステージだけ。ほかに出せる組み合わせがないときは押せない見た目にする
    const deferBtn = $('[data-action="defer"]');
    deferBtn.hidden = ph !== 1;
    deferBtn.setAttribute("aria-disabled", String(ph !== 1 || !engine.canDefer(pair[0], pair[1])));
    $("[data-remove-hint]").hidden = ph !== 1;
    $(".bhint--keys").textContent = ph === 1
      ? "キーボード: ← → で選ぶ ／ ↑ で後に回す ／ ↓ で両方候補外 ／ Backspace で戻る"
      : "キーボード: ← → で選ぶ ／ Backspace で戻る";
    $$('#screen-battle [data-action="undo"]').forEach((b) => (b.disabled = !engine.history.length));

    // 対戦画面を見ている途中で増えたときだけ灯す演出（再読み込み・ひとつ戻るでは出さない）
    renderPenlights(st, !fromUndo && !$("#screen-battle").hidden);

    const arena = $("[data-arena]");
    arena.classList.remove("is-deciding");
    $$(".card", arena).forEach((card, side) => {
      const s = SONGS[pair[side]];
      card.classList.remove("is-chosen", "is-lost", "is-out");
      setUnitColors(card, s.u);
      const img = $("img", card);
      img.classList.remove("is-loaded");
      img.onload = () => img.classList.add("is-loaded");
      img.src = imgUrl(s, 640);
      if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
      $(".card__title", card).textContent = s.t;
      $(".card__note", card).textContent = s.note || "";
      $(".card__unit", card).textContent = s.u;
      $(".card__pick", card).setAttribute("aria-label", `${s.t}（${s.u}）を選ぶ`);
      $(".card__listen", card).setAttribute("aria-label", `${s.t} を試聴`);
    });
    arena.classList.remove("is-entering");
    void arena.offsetWidth;
    arena.classList.add("is-entering");

    if (withShow && $("#screen-battle").hidden) show("screen-battle");
    deciding = false;
    preloadNext();
  }

  // ステージごとの進み具合（0〜1）。第2ステージは入ってからの回数で数える
  function stageProgress() {
    const start = engine.phase === 1 ? 0 : engine.phaseStartComparisons() || 0;
    const done = engine.comparisons - start;
    const rest = engine.remainingEstimate();
    return done + rest > 0 ? done / (done + rest) : 1;
  }

  // ペンライト列: 進み具合 10% ごとに1本灯る。色は左から虹色
  const STICKS = 10;
  let litCount = 0;
  function renderPenlights(st, animate) {
    const box = $("[data-penlights]");
    if (box.children.length !== STICKS) {
      box.innerHTML = "";
      box.style.setProperty("--count", STICKS);
      for (let i = 0; i < STICKS; i++) {
        const p = document.createElement("span");
        p.className = "penlight";
        p.style.setProperty("--c", `hsl(${Math.round((i * 285) / (STICKS - 1))}, 100%, 62%)`);
        box.appendChild(p);
      }
    }
    const progress = stageProgress();
    const lit = Math.max(0, Math.min(STICKS, Math.floor(progress * STICKS)));
    $$(".penlight", box).forEach((p, i) => {
      p.classList.remove("is-new");
      p.classList.toggle("is-on", i < lit);
      if (animate && i >= litCount && i < lit) {
        void p.offsetWidth;
        p.classList.add("is-new");
      }
    });
    litCount = lit;
    box.setAttribute("aria-label", `${st.phase === 1 ? "第1ステージ" : "第2ステージ"}の進み具合 ${Math.floor(progress * 100)}%`);
  }

  // ステージを終えた瞬間は、残りのペンライトを全部灯してから次へ進む
  function fillPenlights() {
    const box = $("[data-penlights]");
    $$(".penlight", box).forEach((p, i) => {
      p.classList.add("is-on");
      if (i >= litCount) {
        p.classList.remove("is-new");
        void p.offsetWidth;
        p.classList.add("is-new");
      }
    });
    litCount = STICKS;
    box.setAttribute("aria-label", "進み具合 100%");
  }
  function stageDelay(phaseBefore, base) {
    if (engine.phase === phaseBefore) return reduceMotion() ? 0 : base;
    fillPenlights();
    return reduceMotion() ? 0 : 750;
  }

  // 次に出る可能性のある2組の画像を先読み
  function preloadNext() {
    if (!pair) return;
    const [a, b] = pair;
    const ids = new Set();
    for (const [w, l] of [[a, b], [b, a]]) {
      engine.choose(w, l);
      const nx = engine.nextPair();
      engine.undo();
      if (nx) nx.forEach((i) => ids.add(i));
    }
    ids.forEach((i) => { const im = new Image(); im.src = imgUrl(SONGS[i], 640); });
  }

  function choose(side) {
    if (deciding || !pair || $("#screen-battle").hidden) return;
    deciding = true;
    const w = pair[side], l = pair[1 - side];
    const arena = $("[data-arena]");
    arena.classList.add("is-deciding");
    const cards = $$(".card", arena);
    cards[side].classList.add("is-chosen");
    cards[1 - side].classList.add("is-lost");
    releaseFocus();
    const phaseBefore = engine.phase;
    engine.choose(w, l);
    save();
    setTimeout(() => { if (!$("#screen-battle").hidden) proceed(phaseBefore === 1); }, stageDelay(phaseBefore, 280));
  }

  // 押したボタン（カード・候補外・ひとつ戻る）にフォーカスが残ると、
  // 次にキーを押したとき黄色い枠が出続けるので見出しへ移す
  function releaseFocus() {
    const a = document.activeElement;
    if (a && a !== document.body && $("#screen-battle").contains(a)) $("#battle-title").focus({ preventScroll: true });
  }

  function removeBoth() {
    if (deciding || !pair || engine.phase !== 1) return;
    deciding = true;
    releaseFocus();
    const before = engine.status().P;
    const arena = $("[data-arena]");
    arena.classList.add("is-deciding");
    $$(".card", arena).forEach((c) => c.classList.add("is-out"));
    engine.removeBoth(pair[0], pair[1]);
    save();
    const delay = stageDelay(1, 260);
    const gone = before - engine.status().P;
    toast(gone > 2 ? `いまの2曲と、それより好みでない${gone - 2}曲が候補外になりました` : "2曲が候補外になりました");
    setTimeout(() => { if (!$("#screen-battle").hidden) proceed(true); }, delay);
  }

  function deferPair() {
    if (deciding || !pair || engine.phase !== 1) return;
    releaseFocus();
    if (!engine.canDefer(pair[0], pair[1])) {
      toast("この2曲はいま比べる必要があるため、後に回せません");
      return;
    }
    deciding = true;
    const arena = $("[data-arena]");
    arena.classList.add("is-deciding");
    $$(".card", arena).forEach((c) => c.classList.add("is-lost"));
    engine.defer(pair[0], pair[1]);
    save();
    setTimeout(() => { if (!$("#screen-battle").hidden) renderBattle(true); }, reduceMotion() ? 0 : 220);
  }

  function undo() {
    if (!engine || !engine.history.length) return;
    deciding = false;
    engine.undo();
    save();
    renderBattle(true, true);
    releaseFocus();
    toast("ひとつ戻りました");
  }

  // ---------- 幕間 ----------
  function renderInterlude() {
    const st = engine.status();
    const ul = $("[data-lineup]");
    ul.innerHTML = "";
    // 順位は伏せたまま見せる（曲リスト順）
    st.top.slice().sort((a, b) => a - b).forEach((i, n) => {
      const s = SONGS[i];
      const li = document.createElement("li");
      li.className = "lineup__item";
      setUnitColors(li, s.u);
      li.style.animationDelay = `${n * 60}ms`;
      li.innerHTML = `<span class="lineup__art"><img src="${imgUrl(s, 300)}" alt="" width="300" height="300"><span class="lineup__back" aria-hidden="true">?</span></span><span class="lineup__title"><span class="lineup__name">${esc(s.t)}</span></span>`;
      ul.appendChild(li);
    });
    // 顔ぶれは最初は伏せておき、「覗く」で見せる
    let peek = $("[data-peek]");
    if (!peek) {
      peek = document.createElement("div");
      peek.className = "lineup__peek";
      peek.innerHTML = `<button type="button" class="btn btn--ghost btn--small" data-action="peek-top" data-peek></button>`;
      ul.after(peek);
      peek = $("[data-peek]");
    }
    peek.dataset.k = st.K;
    setLineupHidden(true);
    $("[data-interlude-title]").textContent = `TOP${st.K}の${st.K}曲が決まりました`;
    const btn = $('[data-action="to-phase2"]');
    if (st.phase === 3) {
      $("[data-interlude-lead]").textContent = "第1ステージの結果だけで、順位まで決まりました。";
      btn.innerHTML = "結果を見る";
    } else {
      const rest = engine.remainingEstimate();
      $("[data-interlude-lead]").textContent = `第2ステージでは、この${st.K}曲の順位が決まります。`;
      btn.innerHTML = `第2ステージをはじめる <span class="btn__sub">あと約${rest}回</span>`;
    }
    show("screen-interlude");
  }

  // 一度覗いたら隠し直す必要はないので、ボタンごと消す
  function setLineupHidden(hidden) {
    const ul = $("[data-lineup]");
    const peek = $("[data-peek]");
    ul.classList.toggle("is-hidden", hidden);
    ul.setAttribute("aria-hidden", String(hidden));
    peek.textContent = `TOP${peek.dataset.k}を覗く`;
    peek.parentElement.hidden = !hidden;
    if (!hidden && document.activeElement === peek) $("#interlude-title").focus({ preventScroll: true });
  }

  // ---------- 結果 ----------
  function rankingSongs() {
    return engine.ranking().map((i) => SONGS[i]);
  }

  function siteUrl() {
    if (location.protocol === "file:") return "";
    return location.origin + location.pathname.replace(/index\.html$/, "");
  }

  function dateLabel() {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }

  function renderResult() {
    const songs = rankingSongs();
    $("[data-result-count]").textContent = engine.comparisons;
    $("#result-title").textContent = `あなたのTOP${songs.length}`;
    $("[data-result-date]").textContent = dateLabel();
    const rows = $("[data-result-rows]");
    rows.innerHTML = "";
    songs.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = `setlist__row setlist__row--${i + 1}`;
      li.style.animationDelay = `${(songs.length - 1 - i) * 90 + 150}ms`;
      li.innerHTML = `
        <span class="setlist__num">${i + 1}</span>
        <span class="setlist__song">${esc(s.t)}</span>
        <span class="setlist__meta"><span class="setlist__dot"></span>${esc(s.u)}${s.note ? ` ・ ${esc(s.note)}` : ""}</span>`;
      setUnitColors($(".setlist__dot", li), s.u);
      rows.appendChild(li);
    });
    const list = $("[data-listen-list]");
    list.innerHTML = songs
      .map((s) => `<li><a href="https://open.spotify.com/track/${s.id}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`)
      .join("");
    const details = $("[data-listen-list]").closest("details");
    $("summary", details).textContent = `この${songs.length}曲を Spotify で聴く`;
    // プレイリストづくり（Spotify デスクトップアプリに曲リンクを貼り付ける）
    let pl = $(".playlist", details);
    if (!pl) {
      pl = document.createElement("div");
      pl.className = "playlist";
      pl.innerHTML = `<button type="button" class="btn btn--ghost btn--small" data-action="copy-playlist"></button><p class="playlist__note"></p>`;
      details.appendChild(pl);
    }
    $("button", pl).textContent = `プレイリスト用に${songs.length}曲をコピー`;
    $(".playlist__note", pl).textContent =
      `Spotify のデスクトップアプリで新しいプレイリストを開き、Ctrl+V（Mac は ⌘V）で貼り付けると、この順番で${songs.length}曲が追加されます。スマホのアプリでは貼り付けできません。`;

    const canFileShare = !!(navigator.canShare && navigator.share &&
      navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] }));
    $('[data-action="share-image"]').textContent = canFileShare ? "画像でシェア" : "画像を保存";
    $("[data-share-note]").textContent = canFileShare
      ? "「画像でシェア」からXアプリを選ぶと、画像つきでポストできます。"
      : "画像を添付したいときは、先に「画像を保存」してからポストに追加してください。";
    show("screen-result");
  }

  function shareX() {
    const url = siteUrl();
    const text = Share.buildText(rankingSongs(), url);
    window.open(Share.intentUrl(text, url), "_blank", "noopener");
  }

  async function shareImage() {
    const btn = $('[data-action="share-image"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "画像をつくっています…";
    try {
      const songs = rankingSongs();
      const url = siteUrl();
      const blob = await Share.drawImage(songs, {
        colorOf: colorsOf, imgUrl, dateLabel: dateLabel(),
        siteLabel: url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      });
      if (!blob) throw new Error("no blob");
      const file = new File([blob], "monsoni-top10.png", { type: "image/png" });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: Share.buildText(songs, url) });
        } catch (e) { /* キャンセル */ }
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "monsoni-top10.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("画像を保存しました");
      }
    } catch (e) {
      toast("画像をつくれませんでした。もう一度お試しください");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function copyToClipboard(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(done); } catch (e2) { toast("コピーできませんでした"); }
      ta.remove();
    }
  }

  function copyText() {
    return copyToClipboard(Share.plainText(rankingSongs(), siteUrl()), "テキストをコピーしました");
  }

  function copyPlaylist() {
    const links = rankingSongs().map((s) => `https://open.spotify.com/track/${s.id}`).join("\n");
    return copyToClipboard(links, "曲のリンクをコピーしました。Spotify のプレイリストに貼り付けてください");
  }

  // ---------- 試聴 ----------
  function openListen(songIndex) {
    const s = SONGS[songIndex];
    if (!s) return;
    $("[data-sheet-title]").textContent = `${s.t} ／ ${s.u}`;
    $("[data-sheet-frame]").innerHTML =
      `<iframe title="Spotify: ${esc(s.t)}" src="https://open.spotify.com/embed/track/${s.id}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` +
      `<p class="sheet__note">※ 試聴部分は Spotify 側で決まるため、サビなどの聴きどころが流れるとは限りません。</p>`;
    $("[data-sheet]").hidden = false;
    $(".sheet__close").focus();
  }
  function closeListen() {
    const sh = $("[data-sheet]");
    if (sh.hidden) return;
    sh.hidden = true;
    $("[data-sheet-frame]").innerHTML = "";
  }

  // ---------- util ----------
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function reduceMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---------- イベント ----------
  document.addEventListener("click", (ev) => {
    const pick = ev.target.closest("[data-pick]");
    if (pick) return choose(+pick.dataset.pick);
    const listen = ev.target.closest("[data-listen]");
    if (listen) return pair && openListen(pair[+listen.dataset.listen]);
    const listenSong = ev.target.closest("[data-listen-song]");
    if (listenSong) return openListen(+listenSong.dataset.listenSong);
    const act = ev.target.closest("[data-action]");
    if (!act) return;
    switch (act.dataset.action) {
      case "start-all":
        if (!confirmDiscard()) return;
        return startEngine([]);
      case "open-filter": return renderFilter();
      case "start-filtered": {
        if (!confirmDiscard()) return;
        const excluded = [...filterOut];
        clearFilter();
        // しぼる画面の履歴は対戦に置き換える
        return replacing(() => startEngine(excluded));
      }
      case "filter-all-in": filterOut.clear(); return syncFilter();
      case "filter-all-out": SONGS.forEach((_, i) => filterOut.add(i)); return syncFilter();
      case "resume": {
        const saved = loadSaved();
        if (!saved) return renderStart();
        engine = new SortEngine(N, saved);
        return proceed(false);
      }
      case "home": closeListen(); return renderStart();
      case "remove-both": return removeBoth();
      case "defer": return deferPair();
      case "undo": return undo();
      case "to-phase2": return proceed(false);
      case "peek-top": return setLineupHidden(false);
      case "share-x": return shareX();
      case "share-image": return shareImage();
      case "copy-text": return copyText();
      case "copy-playlist": return copyPlaylist();
      case "restart":
        clearSaved();
        engine = null;
        clearFilter();
        return replacing(renderStart);
      case "close-sheet": return closeListen();
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") return closeListen();
    if ($("#screen-battle").hidden || !$("[data-sheet]").hidden) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "ArrowLeft" || ev.key === "1") { ev.preventDefault(); choose(0); }
    else if (ev.key === "ArrowRight" || ev.key === "2") { ev.preventDefault(); choose(1); }
    else if (ev.key === "ArrowDown" && engine && engine.phase === 1) { ev.preventDefault(); removeBoth(); }
    else if (ev.key === "ArrowUp" && engine && engine.phase === 1) { ev.preventDefault(); deferPair(); }
    else if (ev.key === "Backspace" || ev.key === "z") { ev.preventDefault(); undo(); }
  });

  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  loadFilter();
  onNav(true);
})();
