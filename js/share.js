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
    return song.note ? `${song.t}（${song.note.replace(/ short ver\.$/, "")}）` : song.t;
  }

  // 入るだけ順位を載せる
  function buildText(songs, url) {
    const head = `わたしのモンソニ！TOP${songs.length}`;
    const tail = `\n${HASHTAG}`;
    const budget = X_LIMIT - (url ? URL_WEIGHT + 1 : 0);
    let lines = [];
    for (let i = 0; i < songs.length; i++) {
      const next = lines.concat(`${i + 1}. ${shareTitle(songs[i])}`);
      const more = i + 1 < songs.length ? "\n…" : "";
      if (xWeight([head, ...next].join("\n") + more + tail) > budget) {
        lines.push("…");
        break;
      }
      lines = next;
    }
    return [head, ...lines].join("\n") + tail;
  }

  function intentUrl(text, url) {
    const p = new URLSearchParams({ text });
    if (url) p.set("url", url);
    return `https://twitter.com/intent/tweet?${p.toString()}`;
  }

  function plainText(songs, url) {
    const lines = songs.map((s, i) => `${i + 1}. ${shareTitle(s)} / ${s.u}`);
    return [`わたしのモンソニ！TOP${songs.length}`, ...lines, HASHTAG, url || ""].join("\n").trim();
  }

  // ---- 画像 ----
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function fitText(ctx, text, maxWidth, size, minSize, family) {
    let s = size;
    ctx.font = `${s}px ${family}`;
    while (s > minSize && ctx.measureText(text).width > maxWidth) {
      s -= 1;
      ctx.font = `${s}px ${family}`;
    }
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
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

  // 1080x1350（4:5）のセトリ画像。colorOf は1色（文字列）か2色（配列）を返す
  async function drawImage(songs, opts) {
    const { imgUrl, siteLabel, dateLabel } = opts;
    const colorsOf = (s) => [].concat(opts.colorOf(s));
    const W = 1080, H = 1350;
    const hand = '"Yusei Magic", "Zen Kaku Gothic New", sans-serif';
    const body = '"Zen Kaku Gothic New", sans-serif';
    const allText = songs.map((s) => s.t + s.u).join("") + "MONSONI!SETLIST0123456789TOP.#モンソニマイランキング" + (siteLabel || "") + (dateLabel || "");
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load(`40px "Yusei Magic"`, allText),
        document.fonts.load(`500 20px "Zen Kaku Gothic New"`, allText),
        document.fonts.load(`700 20px "Zen Kaku Gothic New"`, allText),
      ]).catch(() => {});
    }
    const arts = await Promise.all(songs.map((s) => loadImage(imgUrl(s, 300))));

    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");

    // 客席
    ctx.fillStyle = "#120e24";
    ctx.fillRect(0, 0, W, H);
    const glow = (x, y, r, c) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, "rgba(18,14,36,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(W / 2, -80, 700, "rgba(242,238,255,0.13)");
    songs.slice(0, 5).forEach((s, i) => glow(120 + i * 210, H + 60, 300, hexA(colorsOf(s)[0], 0.22)));

    // 紙
    const px = 90, py = 92, pw = W - 180, ph = H - 230;
    ctx.save();
    ctx.translate(W / 2, py + ph / 2);
    ctx.rotate(-0.012);
    ctx.translate(-W / 2, -(py + ph / 2));
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 20;
    ctx.fillStyle = "#fbfaf4";
    ctx.fillRect(px, py, pw, ph);
    ctx.shadowColor = "transparent";

    const ink = "#1b1924", soft = "#66626f";
    const left = px + 56, right = px + pw - 56;
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    ctx.font = `56px ${hand}`;
    ctx.fillText("MONSONI!", left, py + 100);
    ctx.font = `28px ${hand}`;
    ctx.fillStyle = soft;
    ctx.textAlign = "right";
    ctx.fillText(`SET LIST ${dateLabel || ""}`.trim(), right, py + 98);
    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.fillRect(left, py + 124, right - left, 5);

    const rowTop = py + 150;
    const rowH = (ph - 150 - 40) / Math.max(songs.length, 10);
    songs.forEach((s, i) => {
      const y = rowTop + i * rowH;
      const mid = y + rowH / 2;
      const art = arts[i];
      const artS = Math.min(rowH - 18, 84);
      const numW = 78;
      ctx.fillStyle = ink;
      ctx.textAlign = "right";
      ctx.font = `${i === 0 ? 60 : 44}px ${hand}`;
      ctx.fillText(String(i + 1), left + numW - 14, mid + (i === 0 ? 20 : 15));
      ctx.textAlign = "left";
      const ax = left + numW;
      if (art) ctx.drawImage(art, ax, mid - artS / 2, artS, artS);
      else {
        ctx.fillStyle = colorsOf(s)[0];
        ctx.fillRect(ax, mid - artS / 2, artS, artS);
      }
      const tx = ax + artS + 22;
      const maxW = right - tx;
      ctx.fillStyle = ink;
      const titleSize = i === 0 ? 46 : i < 3 ? 38 : 33;
      const t = fitText(ctx, s.t, maxW, titleSize, 22, hand);
      ctx.fillText(t, tx, mid + 4);
      // ユニット（2色なら左右に塗り分け）
      const [c1, c2] = colorsOf(s);
      ctx.fillStyle = c1;
      ctx.beginPath();
      if (c2) ctx.arc(tx + 7, mid + 30, 7, Math.PI / 2, Math.PI * 1.5);
      else ctx.arc(tx + 7, mid + 30, 7, 0, Math.PI * 2);
      ctx.fill();
      if (c2) {
        ctx.fillStyle = c2;
        ctx.beginPath();
        ctx.arc(tx + 7, mid + 30, 7, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
      }
      ctx.fillStyle = soft;
      const meta = s.note ? `${s.u} ・ ${s.note}` : s.u;
      ctx.font = `500 21px ${body}`;
      ctx.fillText(fitText(ctx, meta, maxW - 24, 21, 16, body), tx + 22, mid + 37);
      if (i < songs.length - 1) {
        ctx.strokeStyle = "rgba(27,25,36,0.16)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, y + rowH);
        ctx.lineTo(right, y + rowH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.restore();

    drawTape(ctx, px + 10, py + 6, 170, 52, -0.55);
    drawTape(ctx, px + pw - 10, py + 6, 170, 52, 0.5);

    // フッター
    ctx.fillStyle = "#f2eeff";
    ctx.font = `700 30px ${body}`;
    ctx.textAlign = "left";
    ctx.fillText(HASHTAG, 90, H - 62);
    ctx.fillStyle = "#a9a1cf";
    ctx.font = `500 22px ${body}`;
    ctx.textAlign = "right";
    if (siteLabel) ctx.fillText(siteLabel, W - 90, H - 64);

    return new Promise((resolve) => cv.toBlob((b) => resolve(b), "image/png"));
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  global.MonsoniShare = { buildText, intentUrl, plainText, drawImage, xWeight, shareTitle };
})(window);
