// TOP-K ソートエンジン
// 第1部: 勝ち抜き（トーナメント）方式で TOP-K の顔ぶれを確定する。
//   比較結果は推移律で全体に伝播し、「K曲以上に負けが確定した曲」は自動で脱落する。
// 第2部: 第1部で分かっている上下関係を前提に、残りの順序を最も情報量の多い比較で決める。
// 履歴（比較・除外）から状態を毎回再構築するので、ひとつ戻る・保存・再開が単純になる。
(function (global) {
  "use strict";

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 半順序の線形拡大の数（m <= 12 程度まで）。g[a][b] = a が b より上。
  function countLinearExtensions(m, g) {
    const pred = new Array(m).fill(0);
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (g[j][i]) pred[i] |= 1 << j;
    const N = 1 << m;
    const dp = new Float64Array(N);
    dp[0] = 1;
    for (let S = 0; S < N; S++) {
      const v = dp[S];
      if (!v) continue;
      for (let i = 0; i < m; i++) {
        if (!((S >> i) & 1) && (pred[i] & S) === pred[i]) dp[S | (1 << i)] += v;
      }
    }
    return dp[N - 1];
  }

  class SortEngine {
    constructor(n, opts) {
      opts = opts || {};
      this.n = n;
      this.K = opts.K || 10;
      this.seed = (opts.seed >>> 0) || 1;
      this.excluded = (opts.excluded || []).slice();
      this.history = (opts.history || []).slice();
      this._rebuild();
    }

    // ---- 状態の構築 ----
    _rebuild() {
      const n = this.n;
      this.gt = Array.from({ length: n }, () => new Uint8Array(n));
      this.nc = new Int32Array(n);
      this.removedExplicit = new Set(this.excluded);
      for (const h of this.history) this._apply(h);
      this._status = null;
    }

    _apply(h) {
      if (h.t === "c") {
        this._relate(h.w, h.l);
        this.nc[h.w]++;
        this.nc[h.l]++;
      } else if (h.t === "x") {
        for (const id of h.ids) this.removedExplicit.add(id);
      }
    }

    _relate(w, l) {
      const n = this.n, gt = this.gt;
      if (gt[w][l]) return;
      const A = [w], B = [l];
      for (let j = 0; j < n; j++) {
        if (gt[j][w]) A.push(j);
        if (gt[l][j]) B.push(j);
      }
      for (const y of A) for (const x of B) gt[y][x] = 1;
    }

    status() {
      if (this._status) return this._status;
      const n = this.n, gt = this.gt;
      // 除外した曲より下と分かっている曲も除外扱い
      const removed = new Uint8Array(n);
      for (const r of this.removedExplicit) {
        removed[r] = 1;
        for (let x = 0; x < n; x++) if (gt[r][x]) removed[x] = 1;
      }
      const pool = [];
      for (let i = 0; i < n; i++) if (!removed[i]) pool.push(i);
      const P = pool.length;
      const K = Math.min(this.K, P);
      const ab = new Int32Array(n), be = new Int32Array(n);
      for (const i of pool) for (const j of pool) if (gt[i][j]) { be[i]++; ab[j]++; }
      const state = new Int8Array(n); // 0 = 未定, 1 = TOP入り確定, -1 = 脱落, -2 = 除外
      let inC = 0, outC = 0;
      for (let i = 0; i < n; i++) {
        if (removed[i]) { state[i] = -2; continue; }
        if (be[i] >= P - K) { state[i] = 1; inC++; }
        else if (ab[i] >= K) { state[i] = -1; outC++; }
      }
      if (inC >= K) for (const i of pool) if (state[i] === 0) { state[i] = -1; outC++; }
      if (outC >= P - K) for (const i of pool) if (state[i] === 0) { state[i] = 1; inC++; }
      const top = pool.filter((i) => state[i] === 1);
      let phase = 1, ext = 0;
      if (P < 2) phase = 3;
      else if (inC >= K) {
        ext = countLinearExtensions(top.length, top.map((x) => top.map((y) => gt[x][y])));
        phase = ext <= 1 ? 3 : 2;
      }
      this._status = { removed, pool, P, K, ab, be, state, inC, outC, top, phase, ext };
      return this._status;
    }

    get phase() { return this.status().phase; }

    lastPair() {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const h = this.history[i];
        if (h.t === "c") return i === this.history.length - 1 ? [h.w, h.l] : [];
        if (h.t === "x") return i === this.history.length - 1 ? h.ids.slice() : [];
      }
      return [];
    }

    // ---- 次の対戦カード ----
    nextPair() {
      const st = this.status();
      if (st.phase === 3) return null;
      const rng = mulberry32(this.seed ^ Math.imul(this.history.length + 1, 0x9e3779b1));
      const last = this.lastPair();
      const isFree = (p) => !last.includes(p[0]) && !last.includes(p[1]);
      const pick = (pairs, cost) => {
        let best = null, bc = Infinity;
        for (const p of pairs) {
          const c = cost(p) + rng() * 0.01;
          if (c < bc) { bc = c; best = p; }
        }
        return best;
      };
      const gt = this.gt;
      const incomparable = (a, b) => !gt[a][b] && !gt[b][a];
      const pairsOf = (arr) => {
        const out = [];
        for (let x = 0; x < arr.length; x++)
          for (let y = x + 1; y < arr.length; y++)
            if (incomparable(arr[x], arr[y])) out.push([arr[x], arr[y]]);
        return out;
      };
      // 左右はランダムに入れ替える
      const orient = (p) => (rng() < 0.5 ? [p[0], p[1]] : [p[1], p[0]]);

      if (st.phase === 2) {
        const top = st.top, m = top.length;
        const g = top.map((x) => top.map((y) => gt[x][y]));
        const E = st.ext;
        const scored = [];
        for (let i = 0; i < m; i++)
          for (let j = i + 1; j < m; j++) {
            if (g[i][j] || g[j][i]) continue;
            g[i][j] = 1;
            const e1 = countLinearExtensions(m, g);
            g[i][j] = 0;
            scored.push({ p: [top[i], top[j]], v: Math.max(e1, E - e1) });
          }
        const bestV = Math.min(...scored.map((s) => s.v));
        // ほぼ同等の候補なら、直前に出た曲を避ける
        let cands = scored.filter((s) => s.v <= bestV * 1.15 && isFree(s.p));
        if (!cands.length) cands = scored.filter((s) => s.v === bestV);
        return orient(pick(cands.map((s) => s.p), () => 0));
      }

      const { state, be, ab, pool } = st;
      const und = pool.filter((i) => state[i] === 0);
      const undAbove = (i) => und.some((j) => gt[j][i]);
      const mx = und.filter((i) => !undAbove(i));
      const mset = new Set(mx);
      const cost = (p) =>
        Math.abs(be[p[0]] - be[p[1]]) + 0.1 * (this.nc[p[0]] + this.nc[p[1]]) +
        (mset.has(p[0]) ? 0 : 3) + (mset.has(p[1]) ? 0 : 3);

      const top = pairsOf(mx);
      let free = top.filter(isFree);
      if (!free.length) {
        // 直前の曲を避けるため、勝ち残り直下の曲まで候補を広げる
        const tier2 = und.filter((i) => !mset.has(i) && und.every((j) => !gt[j][i] || mset.has(j)));
        free = pairsOf(mx.concat(tier2)).filter(isFree);
      }
      if (free.length) return orient(pick(free, cost));
      if (top.length) return orient(pick(top, cost));
      // 念のための保険: 未定の曲と脱落曲の比較、それでもなければ未定同士
      const outs = pool.filter((i) => state[i] === -1);
      const cross = [];
      for (const u of und) for (const o of outs) if (incomparable(u, o)) cross.push([u, o]);
      if (cross.length) return orient(pick(cross, (p) => ab[p[1]]));
      const any = pairsOf(und);
      return any.length ? orient(pick(any, cost)) : null;
    }

    // ---- 操作 ----
    choose(winner, loser) {
      this.history.push({ t: "c", w: winner, l: loser });
      this._apply(this.history[this.history.length - 1]);
      this._status = null;
    }

    removeBoth(a, b) {
      this.history.push({ t: "x", ids: [a, b] });
      this._apply(this.history[this.history.length - 1]);
      this._status = null;
    }

    undo() {
      if (!this.history.length) return null;
      const h = this.history.pop();
      this._rebuild();
      return h;
    }

    get comparisons() {
      return this.history.filter((h) => h.t === "c").length;
    }

    // 現時点の順位（第2部完了後は確定順位）
    ranking() {
      const st = this.status();
      const ids = st.phase === 1 ? st.pool.filter((i) => st.state[i] !== -1) : st.top.slice();
      const set = new Set(ids);
      const score = (i) => {
        let s = 0;
        for (const j of set) { if (this.gt[i][j]) s++; if (this.gt[j][i]) s--; }
        return s;
      };
      return ids.sort((a, b) => score(b) - score(a) || a - b);
    }

    // 残り回数の目安
    static estimateTotal(P, K) {
      K = K || 10;
      if (P <= 1) return 0;
      if (P <= K) {
        let bits = 0;
        for (let i = 2; i <= P; i++) bits += Math.log2(i);
        return Math.ceil(bits * 1.02);
      }
      return Math.round(P - 1 + Math.max(0, 13.3 * Math.log2(P) - 30) * (K / 10));
    }

    remainingEstimate() {
      const st = this.status();
      if (st.phase === 3) return 0;
      if (st.phase === 2) return Math.max(1, Math.ceil(Math.log2(st.ext)));
      const inPool = new Set(st.pool);
      let relevant = 0;
      for (const h of this.history) if (h.t === "c" && inPool.has(h.w) && inPool.has(h.l)) relevant++;
      const est = SortEngine.estimateTotal(st.P, this.K) - relevant;
      return Math.max(1, est);
    }

    serialize() {
      return { seed: this.seed, K: this.K, excluded: this.excluded, history: this.history };
    }
  }

  SortEngine.countLinearExtensions = countLinearExtensions;
  global.SortEngine = SortEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = SortEngine;
})(typeof window !== "undefined" ? window : globalThis);
