// 結果の共有: X 投稿テキストとセトリ画像の生成
(function (global) {
  "use strict";

  const HASHTAG = "#モンソニマイランキング";
  const X_LIMIT = 280;
  const URL_WEIGHT = 23;

  // X の文字数カウント（twitter-text 準拠の簡易版: 一部の範囲は1、それ以外は2）
  function xWeight(text) {
    let w = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      const light =
        (c >= 0 && c <= 4351) || (c >= 8192 && c <= 8205) ||
        (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247);
      w += light ? 1 : 2;
    }
    return w;
  }

  function shareTitle(song) {
    const note = song.note ? song.note.replace(/ short ver\.$/, "") : "";
    // 曲名にすでに版の名前が入っているときは重ねない
    return note && !song.t.includes(note) ? `${song.t}（${note}）` : song.t;
  }

  // タイムラインで後半が隠れても伝わるよう、URL とハッシュタグを先頭に置き、順位はその下に並べる
  //   https://… で
  //   #モンソニマイランキング を作ったよ！
  //   👇
  //
  //   1. 曲名 …
  function textHead(url) {
    return [...(url ? [`${url} で`] : []), `${HASHTAG} を作ったよ！`, "👇", ""];
  }

  // 入るだけ順位を載せる
  function buildText(songs, url) {
    const head = textHead(url);
    // URL は X では長さに関係なく 23 と数えられる
    const weight = (t) => xWeight(url ? t.replace(url, "") : t) + (url ? URL_WEIGHT : 0);
    let lines = [];
    for (let i = 0; i < songs.length; i++) {
      const next = lines.concat(`${i + 1}. ${shareTitle(songs[i])}`);
      const more = i + 1 < songs.length ? "\n…" : "";
      if (weight([...head, ...next].join("\n") + more) > X_LIMIT) {
        lines.push("…");
        break;
      }
      lines = next;
    }
    return [...head, ...lines].join("\n");
  }

  // URL は本文に入れてあるので本文だけ渡す（url も渡すと末尾にもう一度付く）
  function intentUrl(text) {
    const p = new URLSearchParams({ text });
    return `https://twitter.com/intent/tweet?${p.toString()}`;
  }

  function plainText(songs, url) {
    const lines = songs.map((s, i) => `${i + 1}. ${shareTitle(s)} / ${s.u}`);
    return [...textHead(url), ...lines].join("\n");
  }

  // ---- 画像 ----
  const HAND = '"Yusei Magic", "Zen Kaku Gothic New", sans-serif';
  const BODY = '"Zen Kaku Gothic New", sans-serif';
  const DISPLAY = '"RocknRoll One", "Zen Kaku Gothic New", sans-serif';
  const MONO = '"Martian Mono", ui-monospace, monospace';
  const HALL = "#120e24", PAPER = "#fbfaf4", INK = "#1b1924", SOFT = "#66626f";
  const TEXT = "#f2eeff", MUTED = "#a9a1cf";

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // #rgb / #rrggbb / #rrggbbaa（透明度は無視）
  function rgb(hex) {
    let h = String(hex).replace("#", "");
    if (h.length <= 4) h = h.replace(/./g, "$&$&");
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexA(hex, a) {
    const [r, g, b] = rgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  // 白に寄せた色（暗いユニット色でも「灯って」見えるように）
  function tint(hex, t, a = 1) {
    const m = (v) => Math.round(v + (255 - v) * t);
    const [r, g, b] = rgb(hex);
    return `rgba(${m(r)},${m(g)},${m(b)},${a})`;
  }

  const chars = (t) => Array.from(t);

  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let c = chars(text);
    while (c.length > 1 && ctx.measureText(c.join("").trimEnd() + "…").width > maxWidth) c = c.slice(0, -1);
    return c.join("").trimEnd() + "…";
  }

  // 1行に収める: 縮めて、それでも入らなければ「…」
  function fitText(ctx, text, maxWidth, size, minSize, font) {
    let s = size;
    ctx.font = font(s);
    while (s > minSize && ctx.measureText(text).width > maxWidth) ctx.font = font(--s);
    return { text: ellipsize(ctx, text, maxWidth), size: s };
  }

  // 折り返し（英単語は切らない。1語が長すぎるときだけ文字で切る）
  // 「〜（」は次の字と、「ー〜、。！」などは前の字と離さない
  const TOKEN = /[\x21-\x7E“”‘’]+[、。」』）！？]*\s?|[〜～（「『][^\s][、。」』）！？ー〜～]*|[^\s][、。」』）！？ー〜～]+|\s|./gu;
  function breakLines(ctx, text, maxWidth) {
    const toks = text.match(TOKEN) || [];
    const lines = [];
    let cur = "";
    const fits = (t) => ctx.measureText(t.trimEnd()).width <= maxWidth;
    for (const tk of toks) {
      if (fits(cur + tk)) { cur += tk; continue; }
      if (cur.trim()) lines.push(cur.trimEnd());
      cur = "";
      const t = tk.trimStart();
      if (fits(t)) { cur = t; continue; }
      for (const ch of chars(t)) {
        if (cur && !fits(cur + ch)) { lines.push(cur); cur = ""; }
        cur += ch;
      }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
  }

  // maxLines 行・高さ maxHeight に収まるまで縮める。最小でも入らなければ最終行を「…」
  function wrapText(ctx, text, maxWidth, maxLines, size, minSize, font, lead, maxHeight = Infinity) {
    for (let s = size; ; s -= 2) {
      const sz = Math.max(s, minSize);
      ctx.font = font(sz);
      const lines = breakLines(ctx, text, maxWidth);
      // 最終行が2文字以下（「へ〜」などが取り残される）なら、もう少し縮める
      const orphan = lines.length > 1 && chars(lines[lines.length - 1]).length <= 2;
      const ok = lines.length <= maxLines && lines.length * sz * lead <= maxHeight && !orphan;
      if (ok || sz === minSize) {
        let n = maxLines;
        while (n > 1 && n * sz * lead > maxHeight) n--;
        if (lines.length > n) {
          const rest = lines.slice(n - 1).join(" ");
          lines.length = n - 1;
          lines.push(ellipsize(ctx, rest, maxWidth));
        }
        return { lines, size: sz, lineH: sz * lead };
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
  }

  function glowAt(ctx, x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexA(color, a));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ジャケット（読み込めなければユニット色の板に音符）
  function drawArt(ctx, img, colors, x, y, size, radius) {
    ctx.save();
    roundRect(ctx, x, y, size, size, radius);
    ctx.clip();
    if (img) ctx.drawImage(img, x, y, size, size);
    else {
      const g = ctx.createLinearGradient(x, y, x + size, y + size);
      g.addColorStop(0, tint(colors[0], 0.1));
      g.addColorStop(1, colors[1] ? tint(colors[1], 0.1) : hexA(colors[0], 0.55));
      ctx.fillStyle = HALL;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `700 ${Math.round(size * 0.42)}px ${BODY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("♪", x + size / 2, y + size / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }

  // ユニットの丸（2色なら左右に塗り分け）
  function drawDot(ctx, x, y, r, colors) {
    const [c1, c2] = colors;
    ctx.fillStyle = c1;
    ctx.beginPath();
    if (c2) ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5);
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (c2) {
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
    }
  }

  // 灯ったペンライト。(x, y) は持ち手の下端。2色なら筒を左右に塗り分け
  function drawPenlight(ctx, x, y, h, w, colors, angle) {
    const [c1, c2] = colors;
    const grip = Math.round(h * 0.28), tube = h - grip;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // 光のにじみ
    ctx.globalCompositeOperation = "lighter";
    glowAt(ctx, c2 ? -w * 0.6 : 0, -grip - tube * 0.55, tube * 1.05, c1, 0.36);
    if (c2) glowAt(ctx, w * 0.6, -grip - tube * 0.55, tube * 1.05, c2, 0.36);
    ctx.globalCompositeOperation = "source-over";
    // 筒
    ctx.shadowColor = hexA(c1, 0.95);
    ctx.shadowBlur = 26;
    roundRect(ctx, -w / 2, -h, w, tube + 6, w / 2);
    ctx.fillStyle = tint(c1, 0.22);
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (c2) {
      ctx.save();
      roundRect(ctx, -w / 2, -h, w, tube + 6, w / 2);
      ctx.clip();
      ctx.fillStyle = tint(c2, 0.22);
      ctx.fillRect(0, -h, w / 2, tube + 6);
      ctx.restore();
    }
    // 芯の白い光
    const core = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.5, "rgba(255,255,255,0.6)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    roundRect(ctx, -w / 2, -h, w, tube + 6, w / 2);
    ctx.fillStyle = core;
    ctx.fill();
    // 持ち手
    roundRect(ctx, -w / 2 - 2, -grip, w + 4, grip, 4);
    ctx.fillStyle = "#0c0918";
    ctx.fill();
    ctx.fillStyle = "#2f2752";
    ctx.fillRect(-w / 2 - 2, -grip, w + 4, 5);
    ctx.restore();
  }

  function drawTape(ctx, x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(150, 210, 136, 0.78)";
    ctx.beginPath();
    // 端をギザギザに
    const teeth = 7;
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    for (let i = 0; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? -4 : 0), -h / 2 + (h * i) / teeth);
    ctx.lineTo(-w / 2, h / 2);
    for (let i = teeth; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? 4 : 0), -h / 2 + (h * i) / teeth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function dashed(ctx, x1, y1, x2, y2) {
    ctx.strokeStyle = "rgba(27,25,36,0.16)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 1080x1350（4:5）の画像。1位を大きく、ペンライト列、2位以下はセトリの紙に。
  // colorOf は1色（文字列）か2色（配列）を返す
  async function drawImage(songs, opts) {
    const { imgUrl, siteLabel, dateLabel } = opts;
    const colorsOf = (s) => [].concat(opts.colorOf(s));
    const W = 1080, H = 1350, M = 64;
    const n = songs.length;
    const head = `わたしのモンソニ！TOP${n}`;
    const allText = songs.map((s) => s.t + s.u + (s.note || "")).join("") + head + HASHTAG + "0123456789…♪・";
    const metaText = (siteLabel || "") + (dateLabel || "") + "0123456789";
    if (document.fonts && document.fonts.load) {
      // 読み込みが間に合わないと、その文字だけ細い代わりの書体で描かれてしまう。
      // 使う書体と文字が本当に読み込まれたかを確かめ、足りなければ少し待って読み直す
      const need = [
        [`40px "Yusei Magic"`, allText],
        [`500 20px "Zen Kaku Gothic New"`, allText],
        [`700 20px "Zen Kaku Gothic New"`, allText],
        [`40px "RocknRoll One"`, head],
        [`400 20px "Martian Mono"`, metaText],
      ];
      for (let tryNo = 0; tryNo < 4; tryNo++) {
        await Promise.all(need.map(([f, t]) => document.fonts.load(f, t))).catch(() => {});
        if (document.fonts.ready) await document.fonts.ready;
        if (need.every(([f, t]) => document.fonts.check(f, t))) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const arts = await Promise.all(songs.map((s, i) => loadImage(imgUrl(s, i === 0 ? 640 : 300))));

    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.textBaseline = "alphabetic";

    // ---- 割り付け: 余った高さは 4位以下の行 → 1位 → 2・3位 の順に配る ----
    const top = 124, bottom = H - 100;
    const rest = Math.max(0, n - 3);
    const hasPaper = n >= 2;
    const BAND = 138, GAP = 22;
    let J = 352, cellJ = 120, rowH = 50;
    const paperH = () => (hasPaper ? 46 + cellJ + (rest ? 24 + rest * rowH : 0) + 34 : 0);
    let spare = bottom - top - (J + GAP + BAND + (hasPaper ? GAP : 0) + paperH());
    const grow = (cur, max, per) => {
      const d = Math.max(0, Math.min(max - cur, Math.floor(spare / per)));
      spare -= d * per;
      return cur + d;
    };
    if (rest) rowH = grow(rowH, rest > 4 ? 66 : 76, rest);
    J = grow(J, rest ? 400 : 440, 1);
    if (hasPaper) cellJ = grow(cellJ, rest ? 168 : 190, 1);
    const gap = Math.max(0, spare) / (hasPaper ? 3 : 2);
    const heroY = top + gap;
    const bandY = heroY + J + GAP + (hasPaper ? gap * 0.5 : 0);
    const paperY = bandY + BAND + GAP + gap * (hasPaper ? 0.5 : 0);

    // ---- 客席 ----
    ctx.fillStyle = HALL;
    ctx.fillRect(0, 0, W, H);
    glowAt(ctx, W / 2, -120, 760, "#f2eeff", 0.1);

    // ---- 1位: ユニット色のスポットライト（2色なら左右から交差） ----
    const s1 = songs[0];
    const hc = colorsOf(s1);
    const jy = heroY;

    // 1位のまとまり（「1」・ジャケット・曲名）を左右中央に置く。
    // 先に曲名を折り返して幅を測り、まとまりの左端（「1」の縁取り）から右端（最も長い行）までを中央へ
    const GAP_T = 44; // ジャケットと曲名の間
    const unitH = 40, noteH = s1 && s1.note ? 34 : 0;
    const tw = W - M - (M + J + GAP_T); // 曲名に使える幅（左寄せのときと同じ）
    let tt = null, ut = null, nt = null, jx = M;
    if (s1) {
      tt = wrapText(ctx, s1.t, tw, 3, 64, 34, (z) => `${z}px ${HAND}`, 1.14, J - 12 - unitH - noteH);
      ctx.font = `${tt.size}px ${HAND}`;
      let textW = Math.max(...tt.lines.map((l) => ctx.measureText(l).width));
      ut = fitText(ctx, s1.u, tw - 32, 26, 18, (z) => `700 ${z}px ${BODY}`);
      textW = Math.max(textW, 32 + ctx.measureText(ut.text).width);
      if (s1.note) {
        nt = fitText(ctx, s1.note, tw, 22, 16, (z) => `500 ${z}px ${BODY}`);
        textW = Math.max(textW, ctx.measureText(nt.text).width);
      }
      const ONE_OUT = 65; // 「1」の縁取りがジャケットの左にはみ出す幅
      const groupW = ONE_OUT + J + GAP_T + textW;
      const centered = (W - groupW) / 2 + ONE_OUT;
      // 右端は余白 M を超えない範囲で中央へ（長い曲名のときは左寄せのまま）
      jx = Math.round(Math.max(M, Math.min(centered, W - M - textW - GAP_T - J)));
    }
    ctx.globalCompositeOperation = "lighter";
    hc.slice(0, 2).forEach((c, k) => {
      const ox = jx + J / 2 + (hc.length > 1 ? (k ? 1 : -1) * 240 : 40);
      const g = ctx.createLinearGradient(0, 0, 0, jy + J + 60);
      g.addColorStop(0, hexA(c, 0.34));
      g.addColorStop(0.7, hexA(c, 0.1));
      g.addColorStop(1, hexA(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ox - 26, 0);
      ctx.lineTo(ox + 26, 0);
      ctx.lineTo(jx + J + 150, jy + J + 60);
      ctx.lineTo(jx - 150, jy + J + 60);
      ctx.closePath();
      ctx.fill();
    });
    glowAt(ctx, jx + J * 0.35, jy + J * 0.45, J * 0.95, hc[0], 0.55);
    if (hc[1]) glowAt(ctx, jx + J * 0.8, jy + J * 0.75, J * 0.85, hc[1], 0.5);
    ctx.globalCompositeOperation = "source-over";

    // ---- 見出し ----
    ctx.fillStyle = TEXT;
    const ht = fitText(ctx, head, W - M * 2 - 200, 50, 34, (z) => `${z}px ${DISPLAY}`);
    ctx.fillText(ht.text, M, 86);
    if (dateLabel) {
      ctx.fillStyle = MUTED;
      ctx.font = `400 22px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(dateLabel, W - M, 84);
      ctx.textAlign = "left";
    }

    // ---- 1位 ----
    if (s1) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 16;
      ctx.fillStyle = HALL;
      ctx.fillRect(jx, jy, J, J);
      ctx.restore();
      drawArt(ctx, arts[0], hc, jx, jy, J, 6);

      // 手書きの「1」（結果画面や2位・3位と同じく、ジャケットの左上の角にかぶせる）
      ctx.save();
      ctx.font = `236px ${HAND}`;
      // 「1」の右端（縁取り込み）がジャケットの左端にわずかにかかる位置。
      // Yusei Magic の「1」は文字幅より細く、線は原点から約 0.06〜0.28em の範囲にある
      const oneX = jx - 70, oneY = jy + 168;
      ctx.lineJoin = "round";
      ctx.lineWidth = 16;
      ctx.strokeStyle = HALL;
      ctx.strokeText("1", oneX, oneY);
      ctx.shadowColor = hexA(hc[0], 0.9);
      ctx.shadowBlur = 36;
      ctx.fillStyle = "#ffffff";
      ctx.fillText("1", oneX, oneY);
      ctx.restore();

      // 曲名・ユニット・注記はジャケットの右に下そろえ（折り返しは上で済ませてある）
      const tx = jx + J + GAP_T;
      let y = jy + J - noteH - unitH - tt.lines.length * tt.lineH;
      ctx.fillStyle = "#ffffff";
      ctx.font = `${tt.size}px ${HAND}`;
      tt.lines.forEach((l) => {
        y += tt.lineH;
        ctx.fillText(l, tx, y - tt.lineH * 0.2);
      });
      y += unitH;
      drawDot(ctx, tx + 10, y - 10, 10, hc);
      ctx.fillStyle = TEXT;
      ctx.font = `700 ${ut.size}px ${BODY}`;
      ctx.fillText(ut.text, tx + 32, y);
      if (nt) {
        ctx.fillStyle = MUTED;
        ctx.font = `500 ${nt.size}px ${BODY}`;
        ctx.fillText(nt.text, tx, y + noteH);
      }
    }

    // ---- ペンライト列: 各順位の曲のユニット色で灯る ----
    {
      const span = Math.min(W - M * 2 - 40, n * 96);
      const step = span / Math.max(n, 1);
      const x0 = W / 2 - span / 2 + step / 2;
      const tilt = [-6, 4, -2, 7, -4, 3, -7, 5, -3, 6];
      songs.forEach((s, i) => {
        const x = x0 + i * step;
        drawPenlight(ctx, x, bandY + 104, 92, 18, colorsOf(s), (tilt[i % tilt.length] * Math.PI) / 180);
        ctx.fillStyle = MUTED;
        ctx.font = `400 16px ${MONO}`;
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), x, bandY + 132);
        ctx.textAlign = "left";
      });
    }

    // ---- セトリの紙（2位以下） ----
    if (hasPaper) {
      const px = 52, pw = W - 104, py = paperY, ph = paperH();
      ctx.save();
      ctx.translate(W / 2, py + ph / 2);
      ctx.rotate(-0.008);
      ctx.translate(-W / 2, -(py + ph / 2));
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 20;
      ctx.fillStyle = PAPER;
      ctx.fillRect(px, py, pw, ph);
      ctx.shadowColor = "transparent";

      const left = px + 46, right = px + pw - 40;
      const cy = py + 46;
      // 2位・3位: 中くらいのジャケット
      const cw = (right - left - 36) / 2;
      songs.slice(1, 3).forEach((s, k) => {
        const i = k + 1;
        const cs = colorsOf(s);
        const cx = left + k * (cw + 36);
        drawArt(ctx, arts[i], cs, cx, cy, cellJ, 4);
        // 順位はジャケットの角に手書き
        ctx.save();
        ctx.font = `84px ${HAND}`;
        ctx.lineJoin = "round";
        ctx.lineWidth = 12;
        ctx.strokeStyle = PAPER;
        ctx.strokeText(String(i + 1), cx - 24, cy + 52);
        ctx.fillStyle = INK;
        ctx.fillText(String(i + 1), cx - 24, cy + 52);
        ctx.restore();

        const tx = cx + cellJ + 20, tw = cx + cw - tx;
        const unitH = 30, noteH = s.note ? 26 : 0;
        const tt = wrapText(ctx, s.t, tw, s.note ? 2 : 3, 36, 22, (z) => `${z}px ${HAND}`, 1.2, cellJ - unitH - noteH);
        const blockH = tt.lines.length * tt.lineH + unitH + noteH;
        let y = cy + Math.max(0, (cellJ - blockH) / 2);
        ctx.fillStyle = INK;
        ctx.font = `${tt.size}px ${HAND}`;
        tt.lines.forEach((l) => {
          y += tt.lineH;
          ctx.fillText(l, tx, y - tt.lineH * 0.2);
        });
        y += unitH;
        drawDot(ctx, tx + 7, y - 7, 7, cs);
        ctx.fillStyle = SOFT;
        const ut = fitText(ctx, s.u, tw - 22, 19, 14, (z) => `500 ${z}px ${BODY}`);
        ctx.fillText(ut.text, tx + 22, y);
        if (s.note) {
          const nt = fitText(ctx, s.note, tw, 16, 13, (z) => `500 ${z}px ${BODY}`);
          ctx.fillText(nt.text, tx, y + noteH);
        }
      });

      // 4位以下: 1行ずつ
      if (rest) {
        const rowsTop = cy + cellJ + 24;
        dashed(ctx, left - 14, rowsTop - 12, right, rowsTop - 12);
        songs.slice(3).forEach((s, k) => {
          const i = k + 3;
          const cs = colorsOf(s);
          const y = rowsTop + k * rowH, mid = y + rowH / 2;
          const art = rowH - 14;
          ctx.fillStyle = INK;
          ctx.font = `38px ${HAND}`;
          ctx.textAlign = "right";
          ctx.fillText(String(i + 1), left + 40, mid + 13);
          ctx.textAlign = "left";
          drawArt(ctx, arts[i], cs, left + 54, mid - art / 2, art, 3);
          const tx = left + 54 + art + 16;
          // ユニットは右寄せ
          ctx.fillStyle = SOFT;
          const ut = fitText(ctx, s.u, 230, 19, 14, (z) => `500 ${z}px ${BODY}`);
          const uw = ctx.measureText(ut.text).width;
          ctx.textAlign = "right";
          ctx.fillText(ut.text, right, mid + 7);
          ctx.textAlign = "left";
          drawDot(ctx, right - uw - 14, mid, 7, cs);
          // 曲名（注記は小さく後ろに）
          const avail = right - uw - 40 - tx;
          let note = "", nw = 0;
          if (s.note) {
            ctx.font = `500 16px ${BODY}`;
            note = ellipsize(ctx, s.note.replace(/ short ver\.$/, ""), avail * 0.4);
            nw = ctx.measureText(note).width + 12;
          }
          ctx.fillStyle = INK;
          const tt = fitText(ctx, s.t, avail - nw, 30, 20, (z) => `${z}px ${HAND}`);
          ctx.fillText(tt.text, tx, mid + 10);
          if (note) {
            const w = ctx.measureText(tt.text).width;
            ctx.fillStyle = SOFT;
            ctx.font = `500 16px ${BODY}`;
            ctx.fillText(note, tx + w + 12, mid + 8);
          }
          if (i < n - 1) dashed(ctx, left - 14, y + rowH, right, y + rowH);
        });
      }
      ctx.restore();
      // テープは角の外寄りに（ペンライトの番号にかからないように）
      drawTape(ctx, px - 2, py + 12, 140, 42, -0.55);
      drawTape(ctx, px + pw + 2, py + 12, 140, 42, 0.5);
    }

    // ---- フッター ----
    ctx.fillStyle = TEXT;
    ctx.font = `700 32px ${BODY}`;
    ctx.fillText(HASHTAG, M, H - 46);
    if (siteLabel) {
      const hw = ctx.measureText(HASHTAG).width;
      ctx.fillStyle = MUTED;
      const st = fitText(ctx, siteLabel, W - M * 2 - hw - 40, 19, 12, (z) => `400 ${z}px ${MONO}`);
      ctx.textAlign = "right";
      ctx.fillText(st.text, W - M, H - 50);
      ctx.textAlign = "left";
    }

    return new Promise((resolve) => cv.toBlob((b) => resolve(b), "image/png"));
  }

  global.MonsoniShare = { buildText, intentUrl, plainText, drawImage, xWeight, shareTitle };
})(window);
