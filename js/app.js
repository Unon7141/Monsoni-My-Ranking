(function () {
  "use strict";

  const SONGS = window.MONSONI_SONGS;
  const N = SONGS.length;
  const K = 10;
  const Share = window.MonsoniShare;

  // ユニットごとのペンライト色（ファンメイドの割り当て）
  const UNIT_COLORS = {
    "Haitoku Pistols": "#ff4d5e",
    "Two for all": "#ff8ad8",
    "デビルズ・パンク・インフェルノ": "#b26bff",
    "Angely Diva": "#ffd84d",
    "幕末リザレクション": "#4da3ff",
    "モノノケ少女": "#7cf29a",
    "白雪姫リボン": "#f4f2ff",
    "終末運命共同隊": "#ff9a3d",
    "骸": "#9aa4c8",
    "えび天娘。": "#ff7a59",
    "キル×ユア×アイドル": "#ff2e9a",
    "さよならグラビティ": "#5ce1e6",
    "マジカル☆メルルンず": "#e6a3ff",
    "ヤバい女子高生たち、": "#c6f04d",
    "アンドロイドダイナー": "#4dffd2",
    "カルマロックスター": "#7f7bff",
    "東方萌萌美人": "#ffb3c7",
    "CALEzMA": "#3d8bff",
    "アンダーワールド・トラベラーズ": "#6ee7b7",
  };
  const colorOf = (s) => UNIT_COLORS[s.u] || "#bbb3e0";
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
        e.phase === 3 ? "結果を見る" : `${e.phase === 1 ? "第1部" : "第2部"}・${e.comparisons + 1}戦目から`;
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
        g.style.setProperty("--c", UNIT_COLORS[unit] || "#bbb3e0");
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
          grid.appendChild(b);
        });
        $("[data-unit-toggle]", g).addEventListener("click", () => {
          const allOut = ids.every((i) => filterOut.has(i));
          ids.forEach((i) => (allOut ? filterOut.delete(i) : filterOut.add(i)));
          syncFilter();
        });
        root.appendChild(g);
      }
      root.addEventListener("click", (ev) => {
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
  // prevPhase: 直前のフェーズ（第1部→第2部に移ったら幕間を挟む）
  function proceed(fromPhase1) {
    const ph = engine.phase;
    if (fromPhase1 && ph !== 1) return renderInterlude();
    if (ph === 3) return renderResult();
    renderBattle(true);
  }

  function renderBattle(withShow) {
    const st = engine.status();
    pair = engine.nextPair();
    if (!pair) return renderResult();

    const ph = st.phase;
    $("[data-phase-part]").textContent = ph === 1 ? "第1部" : "第2部";
    $("[data-phase-title]").textContent = ph === 1 ? `TOP${st.K}の${st.K}曲をしぼる` : `${st.K}曲の順位を決める`;
    $("[data-round]").textContent = engine.comparisons + 1;
    $("[data-confirm-label]").textContent = `TOP${st.K}確定`;
    $("[data-confirmed]").textContent = `${ph === 1 ? st.inC : st.K}/${st.K}`;
    $("[data-remaining]").textContent = engine.remainingEstimate();
    $("[data-candidates]").textContent = ph === 1 ? st.pool.filter((i) => st.state[i] !== -1).length : st.K;
    $('[data-action="remove-both"]').hidden = ph !== 1;
    $("[data-remove-hint]").hidden = ph !== 1;
    $$('#screen-battle [data-action="undo"]').forEach((b) => (b.disabled = !engine.history.length));

    renderPenlights(st);

    const arena = $("[data-arena]");
    arena.classList.remove("is-deciding");
    $$(".card", arena).forEach((card, side) => {
      const s = SONGS[pair[side]];
      card.classList.remove("is-chosen", "is-lost", "is-out");
      card.style.setProperty("--c", colorOf(s));
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

  let litBefore = new Set();
  function renderPenlights(st) {
    const box = $("[data-penlights]");
    const count = st.K;
    box.style.setProperty("--count", count);
    if (box.children.length !== count) {
      box.innerHTML = "";
      for (let i = 0; i < count; i++) {
        const p = document.createElement("span");
        p.className = "penlight";
        box.appendChild(p);
      }
    }
    const lit = st.phase === 1 ? engine.ranking().filter((i) => st.state[i] === 1) : engine.ranking();
    const sticks = $$(".penlight", box);
    sticks.forEach((p, i) => {
      const id = lit[i];
      p.classList.remove("is-new");
      if (id === undefined) {
        p.classList.remove("is-on");
        p.style.removeProperty("--c");
        return;
      }
      p.classList.add("is-on");
      p.style.setProperty("--c", colorOf(SONGS[id]));
      if (!litBefore.has(id)) {
        void p.offsetWidth;
        p.classList.add("is-new");
      }
    });
    litBefore = new Set(lit);
    box.setAttribute("aria-label", `TOP${count} 確定 ${st.phase === 1 ? st.inC : count}曲`);
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
    const wasPhase1 = engine.phase === 1;
    engine.choose(w, l);
    save();
    setTimeout(() => { if (!$("#screen-battle").hidden) proceed(wasPhase1); }, reduceMotion() ? 0 : 280);
  }

  function removeBoth() {
    if (deciding || !pair || engine.phase !== 1) return;
    deciding = true;
    const before = engine.status().P;
    const arena = $("[data-arena]");
    arena.classList.add("is-deciding");
    $$(".card", arena).forEach((c) => c.classList.add("is-out"));
    engine.removeBoth(pair[0], pair[1]);
    save();
    const gone = before - engine.status().P;
    toast(gone > 2 ? `2曲と、それに負けた${gone - 2}曲を外しました` : "2曲を外しました");
    setTimeout(() => { if (!$("#screen-battle").hidden) proceed(true); }, reduceMotion() ? 0 : 260);
  }

  function undo() {
    if (!engine || !engine.history.length) return;
    deciding = false;
    engine.undo();
    save();
    renderBattle(true);
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
      li.style.setProperty("--c", colorOf(s));
      li.style.animationDelay = `${n * 60}ms`;
      li.innerHTML = `<span class="lineup__art"><img src="${imgUrl(s, 300)}" alt="" width="300" height="300"></span><span class="lineup__title">${esc(s.t)}</span>`;
      ul.appendChild(li);
    });
    $("[data-interlude-title]").textContent = `TOP${st.K}の${st.K}曲が決まりました`;
    const btn = $('[data-action="to-phase2"]');
    if (st.phase === 3) {
      $("[data-interlude-lead]").textContent = "第1部の結果だけで、順位まで決まりました。";
      btn.innerHTML = "結果を見る";
    } else {
      const rest = engine.remainingEstimate();
      $("[data-interlude-lead]").textContent = `第2部では、この${st.K}曲の順位を決めます。第1部の結果を引き継ぐので、あと約${rest}回です。`;
      btn.innerHTML = `第2部をはじめる <span class="btn__sub">あと約${rest}回</span>`;
    }
    show("screen-interlude");
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
        <span class="setlist__meta"><span class="setlist__dot" style="--c:${colorOf(s)}"></span>${esc(s.u)}${s.note ? ` ・ ${esc(s.note)}` : ""}</span>`;
      rows.appendChild(li);
    });
    const list = $("[data-listen-list]");
    list.innerHTML = songs
      .map((s) => `<li><a href="https://open.spotify.com/track/${s.id}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`)
      .join("");
    $("[data-listen-list]").closest("details").querySelector("summary").textContent = `この${songs.length}曲を Spotify で聴く`;

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
        colorOf, imgUrl, dateLabel: dateLabel(),
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

  async function copyText() {
    const text = Share.plainText(rankingSongs(), siteUrl());
    try {
      await navigator.clipboard.writeText(text);
      toast("テキストをコピーしました");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("テキストをコピーしました"); } catch (e2) { toast("コピーできませんでした"); }
      ta.remove();
    }
  }

  // ---------- 試聴 ----------
  function openListen(side) {
    if (!pair) return;
    const s = SONGS[pair[side]];
    $("[data-sheet-title]").textContent = `${s.t} ／ ${s.u}`;
    $("[data-sheet-frame]").innerHTML =
      `<iframe title="Spotify: ${esc(s.t)}" src="https://open.spotify.com/embed/track/${s.id}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
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
    if (listen) return openListen(+listen.dataset.listen);
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
      case "undo": return undo();
      case "to-phase2": return proceed(false);
      case "share-x": return shareX();
      case "share-image": return shareImage();
      case "copy-text": return copyText();
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
    else if (ev.key === "ArrowDown") { ev.preventDefault(); removeBoth(); }
    else if (ev.key === "Backspace" || ev.key === "z") { ev.preventDefault(); undo(); }
  });

  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  loadFilter();
  onNav(true);
})();
