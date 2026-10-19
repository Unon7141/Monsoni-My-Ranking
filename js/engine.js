// TOP-K ソートエンジン
// 第1部: 勝ち抜き（トーナメント）方式で TOP-K の顔ぶれを確定する。
//   比較結果は推移律で全体に伝播し、「K曲以上に負けが確定した曲」は自動で脱落する。
// 第2部: 第1部で分かっている上下関係を前提に、残りの順序を最も情報量の多い比較で決める。
//   第2部の比較をはじめる前なら、TOP-K に入らなかった曲を5曲まで「復活」させられる。
//   復活後は TOP-K ＋ 復活曲の中から、上位 K 曲とその順位を決める。
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

  // TOP-K に入る見込み（おおよそ）。上にいる曲数 = ab + X、
  // X ~ BetaBinomial(f, ab+1, be+1)（f = まだ上下が分かっていない曲数）。LF[k] = log(k!)
  function pInTop(ab, be, f, K, LF) {
    const need = K - 1 - ab;
    if (need < 0) return 0;
    if (need >= f) return 1;
    const al = ab + 1, bt = be + 1;
    const c = LF[f] - LF[f + al + bt - 1] + LF[al + bt - 1] - LF[al - 1] - LF[bt - 1];
    let s = 0;
    for (let x = 0; x <= need; x++) s += Math.exp(c - LF[x] - LF[f - x] + LF[x + al - 1] + LF[f - x + bt - 1]);
    return Math.min(1, s);
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

  // 上位 K 曲の並び（上からの並べ方）を数える（m <= 15 程度まで）。pred[i] = i より上と分かっている曲のビット集合。
  // f[S] = S の曲を上から並べる並べ方の数、g[S] = S の続きを K 曲目まで並べる並べ方の数、E = 並びの総数
  function prefixCounts(m, pred, K) {
    const N = 1 << m;
    const f = new Float64Array(N), g = new Float64Array(N), pc = new Uint8Array(N);
    for (let S = 1; S < N; S++) pc[S] = pc[S >> 1] + (S & 1);
    f[0] = 1;
    for (let S = 0; S < N; S++) {
      const v = f[S];
      if (!v || pc[S] >= K) continue;
      for (let i = 0; i < m; i++)
        if (!((S >> i) & 1) && (pred[i] & S) === pred[i]) f[S | (1 << i)] += v;
    }
    for (let S = N - 1; S >= 0; S--) {
      if (!f[S]) continue;
      if (pc[S] === K) { g[S] = 1; continue; }
      let s = 0;
      for (let i = 0; i < m; i++)
        if (!((S >> i) & 1) && (pred[i] & S) === pred[i]) s += g[S | (1 << i)];
      g[S] = s;
    }
    return { m, K, pred, f, g, pc, E: g[0] };
  }

  // a[i*m+j] = j が i より先に（または i なしで）並ぶ並びの数。
  // 「i が j より上」と答えると、残る並びは E - a[i*m+j]
  function prefixSplits(dp) {
    const { m, K, pred, f, g, pc } = dp;
    const N = 1 << m, a = new Float64Array(m * m);
    for (let S = 0; S < N; S++) {
      const v = f[S];
      if (!v || pc[S] >= K) continue;
      for (let j = 0; j < m; j++) {
        if ((S >> j) & 1 || (pred[j] & S) !== pred[j]) continue;
        const w = v * g[S | (1 << j)];
        if (!w) continue;
        let rest = (N - 1) & ~S & ~(1 << j);
        while (rest) {
          const b = rest & -rest;
          a[(31 - Math.clz32(b)) * m + j] += w;
          rest ^= b;
        }
      }
    }
    return a;
  }

  const MAX_REVIVE = 5;

  class SortEngine {
    constructor(n, opts) {
      opts = opts || {};
      this.n = n;
      this.K = opts.K || 10;
      this.seed = (opts.seed >>> 0) || 1;
      this.excluded = (opts.excluded || []).slice();
      this.history = (opts.history || []).slice();
      this._p2 = null; // 第2部に入った位置の覚え書き { len, at }
      this._rebuild();
    }

    // ---- 状態の構築 ----
    _rebuild() {
      const n = this.n;
      this.gt = Array.from({ length: n }, () => new Uint8Array(n));
      this.nc = new Int32Array(n);
      this.removedExplicit = new Set(this.excluded);
      this.final = null; // 復活させた後の候補 { at, base, revived, C }
      this._status = null;
      this.history.forEach((h, k) => this._apply(h, k));
      this._status = null;
    }

    _apply(h, k) {
      if (h.t === "c") {
        this._relate(h.w, h.l);
        this.nc[h.w]++;
        this.nc[h.l]++;
      } else if (h.t === "x") {
        for (const id of h.ids) this.removedExplicit.add(id);
      } else if (h.t === "v") {
        this._enterFinal(h.ids, k);
      }
    }

    // 復活: 候補を「その時点の TOP-K ＋ 復活させた曲」だけにする。
    // 上下関係は、候補どうしの直接の比較だけから組み直す（復活曲と TOP-K の曲の比較は白紙に戻す）。
    _enterFinal(ids, k) {
      if (this.final) return;
      const n = this.n;
      this._status = null;
      const st = this.status();
      if (st.phase < 2) return;
      const base = st.top.slice();
      const inTop = new Set(base), ex = new Set(this.excluded);
      const revived = [];
      for (const id of ids || []) {
        if (revived.length >= MAX_REVIVE) break;
        if (Number.isInteger(id) && id >= 0 && id < n && !inTop.has(id) && !ex.has(id) && !revived.includes(id)) revived.push(id);
      }
      if (!revived.length) return;
      const C = base.concat(revived).sort((a, b) => a - b);
      const inC = new Uint8Array(n), isRev = new Uint8Array(n);
      for (const i of C) inC[i] = 1;
      for (const i of revived) isRev[i] = 1;
      this.gt = Array.from({ length: n }, () => new Uint8Array(n));
      for (let x = 0; x < k; x++) {
        const c = this.history[x];
        if (c.t !== "c" || !inC[c.w] || !inC[c.l] || isRev[c.w] !== isRev[c.l]) continue;
        this._relate(c.w, c.l);
      }
      this.final = { at: k, base, revived, C };
      this._status = null;
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
      if (this.final) return (this._status = this._finalStatus());
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

    // 復活後: 候補 C の中で上位 K 曲の並びがひとつに決まれば完了
    _finalStatus() {
      const n = this.n, gt = this.gt;
      const pool = this.final.C.slice();
      const removed = new Uint8Array(n).fill(1);
      for (const i of pool) removed[i] = 0;
      const P = pool.length;
      const K = Math.min(this.K, P);
      const ab = new Int32Array(n), be = new Int32Array(n);
      for (const i of pool) for (const j of pool) if (gt[i][j]) { be[i]++; ab[j]++; }
      const state = new Int8Array(n);
      let inC = 0, outC = 0;
      for (let i = 0; i < n; i++) {
        if (removed[i]) { state[i] = -2; continue; }
        if (be[i] >= P - K) { state[i] = 1; inC++; }
        else if (ab[i] >= K) { state[i] = -1; outC++; }
      }
      const top = pool.filter((i) => state[i] === 1);
      // 上に K 曲以上いる曲は並びに出てこないので数えない
      const R = pool.filter((i) => ab[i] < K);
      const pred = R.map((i) => R.reduce((b, j, k) => (gt[j][i] ? b | (1 << k) : b), 0));
      const dp = prefixCounts(R.length, pred, K);
      const ext = dp.E;
      const phase = P < 2 || ext <= 1 ? 3 : 2;
      return { removed, pool, P, K, ab, be, state, inC, outC, top, phase, ext, final: true, R, dp };
    }

    get phase() { return this.status().phase; }

    lastPair() {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const h = this.history[i];
        if (h.t === "c") return i === this.history.length - 1 ? [h.w, h.l] : [];
        if (h.t === "x" || h.t === "s") return i === this.history.length - 1 ? h.ids.slice() : [];
      }
      return [];
    }

    // 「後に回す」にした組み合わせ（まだ比べていないものだけ）
    _deferredKeys() {
      const keys = new Set();
      for (const h of this.history) {
        if (h.t !== "s") continue;
        const [a, b] = h.ids;
        if (!this.gt[a][b] && !this.gt[b][a]) keys.add(a < b ? a * this.n + b : b * this.n + a);
      }
      return keys;
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
        const E = st.ext;
        const scored = [];
        if (st.final) {
          // 復活後: 上位 K 曲の並びの数をもっとも半分に近く分ける組み合わせ
          const R = st.R, m = R.length, a = prefixSplits(st.dp);
          for (let i = 0; i < m; i++)
            for (let j = i + 1; j < m; j++) {
              if (gt[R[i]][R[j]] || gt[R[j]][R[i]]) continue;
              scored.push({ p: [R[i], R[j]], v: Math.max(E - a[i * m + j], E - a[j * m + i]) });
            }
        } else {
          const top = st.top, m = top.length;
          const g = top.map((x) => top.map((y) => gt[x][y]));
          for (let i = 0; i < m; i++)
            for (let j = i + 1; j < m; j++) {
              if (g[i][j] || g[j][i]) continue;
              g[i][j] = 1;
              const e1 = countLinearExtensions(m, g);
              g[i][j] = 0;
              scored.push({ p: [top[i], top[j]], v: Math.max(e1, E - e1) });
            }
        }
        const bestV = Math.min(...scored.map((s) => s.v));
        // ほぼ同等の候補なら、直前に出た曲を避ける
        let cands = scored.filter((s) => s.v <= bestV * 1.15 && isFree(s.p));
        if (!cands.length) cands = scored.filter((s) => s.v === bestV);
        return orient(pick(cands.map((s) => s.p), () => 0));
      }

      // 第1ステージは顔ぶれ（入る/入らない）だけを決める。上位候補どうしは比べない
      if (st.P - st.K > 3) {
        const p = this._setFirstPair(st, rng);
        if (p) return orient(p);
      }
      const { state, be, ab, pool } = st;
      const und = pool.filter((i) => state[i] === 0);
      const undAbove = (i) => und.some((j) => gt[j][i]);
      const mx = und.filter((i) => !undAbove(i));
      const mset = new Set(mx);
      const cost = (p) =>
        Math.abs(be[p[0]] - be[p[1]]) + 0.1 * (this.nc[p[0]] + this.nc[p[1]]) +
        (mset.has(p[0]) ? 0 : 3) + (mset.has(p[1]) ? 0 : 3);

      // 後に回した組み合わせは、ほかに同じくらい役立つ組み合わせがある間は出さない
      const deferred = this._deferredKeys();
      const notDeferred = (p) => !deferred.has(p[0] < p[1] ? p[0] * this.n + p[1] : p[1] * this.n + p[0]);
      const allTop = pairsOf(mx);
      const tier2 = und.filter((i) => !mset.has(i) && und.every((j) => !gt[j][i] || mset.has(j)));
      for (const filt of [notDeferred, () => true]) {
        const top = allTop.filter(filt);
        let free = top.filter(isFree);
        // 直前の曲を避けるため、勝ち残り直下の曲まで候補を広げる
        if (!free.length) free = pairsOf(mx.concat(tier2)).filter((p) => isFree(p) && filt(p));
        if (free.length) return orient(pick(free, cost));
        if (top.length) return orient(pick(top, cost));
      }
      // 念のための保険: 未定の曲と脱落曲の比較、それでもなければ未定同士
      const outs = pool.filter((i) => state[i] === -1);
      const cross = [];
      for (const u of und) for (const o of outs) if (incomparable(u, o)) cross.push([u, o]);
      if (cross.length) return orient(pick(cross, (p) => ab[p[1]]));
      const any = pairsOf(und);
      return any.length ? orient(pick(any, cost)) : null;
    }

    // 第1ステージの対戦カード（顔ぶれ優先）
    // ・TOP-K に入る見込みが五分以上の未定曲を、見込みの高い順に残り枠の数まで「上位候補」とする
    // ・上位候補どうしの組み合わせは、ほかに出せる組み合わせがない場合だけ（大きな減点）
    // ・上位候補に負けた曲は勝ち残りと同じ扱いで、上位候補以外どうしの勝ち抜きを続ける
    //   （上位候補は、勝ち残った強い曲との1戦で多くの曲より上と分かる）
    // ・同じ曲が続かないよう、出た回数（後に回した分も含む）と直近3件の登場を減点する
    _setFirstPair(st, rng) {
      const n = this.n, gt = this.gt;
      const { state, ab, be, pool, P, K, inC } = st;
      const und = pool.filter((i) => state[i] === 0);
      const app = new Int32Array(n), rec = new Int32Array(n);
      for (const h of this.history) {
        if (h.t === "c") { app[h.w]++; app[h.l]++; }
        else if (h.t === "s") { app[h.ids[0]]++; app[h.ids[1]]++; }
      }
      for (let i = this.history.length - 1, k = 3; i >= 0 && k > 0; i--, k--) {
        const h = this.history[i];
        for (const x of h.t === "c" ? [h.w, h.l] : h.ids) if (!rec[x]) rec[x] = k;
      }
      const LF = new Float64Array(P + 2);
      for (let k = 2; k < LF.length; k++) LF[k] = LF[k - 1] + Math.log(k);
      const q = new Float64Array(n);
      for (const i of und) q[i] = pInTop(ab[i], be[i], P - 1 - ab[i] - be[i], K, LF);
      const top = new Uint8Array(n);
      und.filter((i) => q[i] >= 0.5).sort((a, b) => q[b] - q[a] || a - b)
        .slice(0, Math.max(0, K - inC)).forEach((i) => (top[i] = 1));
      // 上位候補以外の未定曲に負けている数（0 = 勝ち残り、1 = そのすぐ下）
      const dep = new Int32Array(n);
      for (const i of und) for (const j of und) if (gt[j][i] && !top[j]) dep[i]++;
      const deferred = this._deferredKeys();
      const arr = und.filter((i) => dep[i] <= 1);
      let best = null, bc = Infinity;
      for (let x = 0; x < arr.length; x++)
        for (let y = x + 1; y < arr.length; y++) {
          const a = arr[x], b = arr[y];
          if (gt[a][b] || gt[b][a]) continue;
          let c = Math.abs(be[a] - be[b]) + 0.1 * (app[a] + app[b]) + 3 * (dep[a] + dep[b]) + rec[a] + rec[b];
          if (top[a] && top[b]) c += 1000;
          if (deferred.has(a < b ? a * n + b : b * n + a)) c += 1e6;
          c += rng() * 0.01;
          if (c < bc) { bc = c; best = [a, b]; }
        }
      return best;
    }

    // ---- 操作 ----
    choose(winner, loser) {
      this._push({ t: "c", w: winner, l: loser });
    }

    removeBoth(a, b) {
      this._push({ t: "x", ids: [a, b] });
    }

    // 第1ステージだけ: この組み合わせを後に回す（比較の結果には影響しない）
    defer(a, b) {
      this._push({ t: "s", ids: [a, b] });
    }

    // 後に回したら別の組み合わせが出せるか（出せないなら今比べる必要がある）
    canDefer(a, b) {
      if (this.phase !== 1) return false;
      // "s" は状態を変えないので、履歴に一時的に積んで次の組み合わせを見るだけでよい
      this.history.push({ t: "s", ids: [a, b] });
      const next = this.nextPair();
      this.history.pop();
      return !!next && !(next.includes(a) && next.includes(b));
    }

    _push(h) {
      this.history.push(h);
      this._apply(h, this.history.length - 1);
      this._status = null;
      // 覚え書きは差分だけ更新する
      const c = this._p2;
      if (!c) return;
      if (c.len !== this.history.length - 1) { this._p2 = null; return; }
      c.len++;
      if (c.at < 0 && this.status().phase >= 2) c.at = c.len;
    }

    undo() {
      if (!this.history.length) return null;
      const h = this.history.pop();
      const c = this._p2;
      this._rebuild();
      if (c) {
        const L = this.history.length;
        // 取り消した1件で第2部に入っていたなら、まだ第1部に戻る
        this._p2 = c.len === L + 1 ? { len: L, at: c.at > L ? -1 : c.at } : null;
      }
      return h;
    }

    get comparisons() {
      return this.history.filter((h) => h.t === "c").length;
    }

    // 第2部に入った時点までの比較回数（まだ第1部なら null）
    phaseStartComparisons() {
      const at = this._phase2At();
      if (at < 0) return null;
      let c = 0;
      for (let i = 0; i < at; i++) if (this.history[i].t === "c") c++;
      return c;
    }

    // 何件目の履歴で phase >= 2 になったか（まだなら -1）。
    // 覚え書きがなければ履歴を頭から1件ずつ別のエンジンで再生して求める
    _phase2At() {
      const L = this.history.length;
      if (this._p2 && this._p2.len === L) return this._p2.at;
      const e = new SortEngine(this.n, { K: this.K, seed: this.seed, excluded: this.excluded });
      let at = e.phase >= 2 ? 0 : -1;
      for (let i = 0; at < 0 && i < L; i++) {
        e._push(this.history[i]);
        if (e.phase >= 2) at = i + 1;
      }
      this._p2 = { len: L, at };
      return at;
    }

    // 現時点の順位（第2部完了後は確定順位）
    ranking() {
      const st = this.status();
      if (this.final) return this.finalCandidates().slice(0, st.K);
      const ids = st.phase === 1 ? st.pool.filter((i) => st.state[i] !== -1) : st.top.slice();
      return this._byScore(ids);
    }

    // 上下関係の勝ち越し数の多い順（同点は曲順）
    _byScore(ids) {
      const set = new Set(ids);
      const score = new Map();
      for (const i of set) {
        let s = 0;
        for (const j of set) { if (this.gt[i][j]) s++; if (this.gt[j][i]) s--; }
        score.set(i, s);
      }
      return ids.slice().sort((a, b) => score.get(b) - score.get(a) || a - b);
    }

    // ---- 復活 ----
    get revived() {
      return this.final ? this.final.revived.slice() : [];
    }

    // 復活させる前の TOP-K（第1ステージで決まった顔ぶれ）
    reviveBase() {
      if (this.final) return this.final.base.slice();
      const st = this.status();
      return st.phase >= 2 ? st.top.slice() : [];
    }

    // 最終候補: 上位 K 曲を順位どおりに並べ、続けて残りの候補（復活させていなければ TOP-K だけ）
    finalCandidates() {
      if (!this.final) return this.ranking();
      return this._byScore(this.final.C);
    }

    // 復活できるのは、第1ステージが終わってから第2ステージの比較をまだしていない間だけ
    canRevive() {
      if (this.phase < 2) return false;
      const L = this.history.length;
      for (let i = Math.max(0, this._phase2At()); i < L; i++) if (this.history[i].t === "c") return false;
      return true;
    }

    // 復活させる曲を選ぶ（選び直すときは前の選択を置き換える。空なら復活なし）
    revive(ids) {
      if (!this.canRevive()) return false;
      const L = this.history.length;
      if (L && this.history[L - 1].t === "v") this.undo();
      const ok = new Set(this.reviveCandidates().map((c) => c.id));
      const list = [];
      for (const id of ids || []) if (ok.has(id) && !list.includes(id) && list.length < MAX_REVIVE) list.push(id);
      if (list.length) this._push({ t: "v", ids: list });
      return true;
    }

    // 復活の候補: TOP-K に入らなかった曲を「あと一歩」の順に。
    // 候補外にした曲（とそれより下の曲）は後ろにまとめる（removed: true）。最初に外した曲は出さない
    reviveCandidates() {
      const base = this._baseEngine();
      const st = base.status();
      if (st.phase < 2) return [];
      const top = new Set(st.top);
      const { ab, be } = base._counts(base.gt);
      const out = [];
      for (let i = 0; i < this.n; i++)
        if (!top.has(i) && !this.excluded.includes(i)) out.push({ id: i, removed: !!st.removed[i] });
      return out.sort((x, y) => x.removed - y.removed || ab[x.id] - ab[y.id] || be[y.id] - be[x.id] || x.id - y.id);
    }

    // ほかにも好きな曲: 最終候補に入らなかった曲を、履歴全体の上下関係で「あと一歩」の順に
    nearMisses(limit) {
      const { gt, removed } = this._fullView();
      const keep = new Set(this.finalCandidates());
      const { ab, be } = this._counts(gt);
      const out = [];
      for (let i = 0; i < this.n; i++) if (!keep.has(i) && !removed[i]) out.push(i);
      out.sort((x, y) => ab[x] - ab[y] || be[y] - be[x] || x - y);
      return out.slice(0, limit == null ? 10 : limit);
    }

    // 最初に外した曲を除いた全曲の中で、上・下と分かっている曲数
    _counts(gt) {
      const n = this.n, ex = new Set(this.excluded);
      const ab = new Int32Array(n), be = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        if (ex.has(i)) continue;
        for (let j = 0; j < n; j++) if (!ex.has(j) && gt[i][j]) { be[i]++; ab[j]++; }
      }
      return { ab, be };
    }

    // 復活させる前の状態のエンジン
    _baseEngine() {
      if (!this.final) return this;
      return new SortEngine(this.n, { K: this.K, seed: this.seed, excluded: this.excluded, history: this.history.slice(0, this.final.at) });
    }

    // 履歴全体の上下関係と、候補外（とそれより下）の曲。最初に外した曲も removed
    _fullView() {
      const n = this.n;
      let gt = this.gt;
      if (this.final) {
        const e = new SortEngine(n, { K: this.K, seed: this.seed, excluded: this.excluded });
        for (const h of this.history) if (h.t !== "v") e._apply(h);
        gt = e.gt;
      }
      const removed = new Uint8Array(n);
      for (const r of this.removedExplicit) {
        removed[r] = 1;
        for (let x = 0; x < n; x++) if (gt[r][x]) removed[x] = 1;
      }
      return { gt, removed };
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
      if (P - K <= 3) return Math.round(P - 1 + Math.max(0, 13.3 * Math.log2(P) - 30) * (K / 10));
      return Math.round(P - 1 + Math.max(0, 16.2 * Math.log2(P) - 34) * (K / 10));
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

    // 今のステージだけの残り回数の目安（ペンライトの進み具合用）。
    // 第1ステージの長さは顔ぶれ優先にしても従来の式とほぼ同じ
    stageRemainingEstimate() {
      const st = this.status();
      if (st.phase !== 1) return this.remainingEstimate();
      const P = st.P, K = Math.min(this.K, P);
      if (P <= K) return 0;
      const inPool = new Set(st.pool);
      let relevant = 0;
      for (const h of this.history) if (h.t === "c" && inPool.has(h.w) && inPool.has(h.l)) relevant++;
      const stage1 = Math.round(P - 1 + Math.max(0, 13.3 * Math.log2(P) - 30) * (K / 10));
      return Math.max(1, stage1 - relevant);
    }

    serialize() {
      return { seed: this.seed, K: this.K, excluded: this.excluded, history: this.history };
    }
  }

  SortEngine.countLinearExtensions = countLinearExtensions;
  SortEngine.prefixCounts = prefixCounts;
  SortEngine.prefixSplits = prefixSplits;
  SortEngine.MAX_REVIVE = MAX_REVIVE;
  global.SortEngine = SortEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = SortEngine;
})(typeof window !== "undefined" ? window : globalThis);
