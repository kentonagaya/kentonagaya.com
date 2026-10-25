// Voixnette — 雑音除去（スペクトル・ノイズリダクション）
// Audacity の「ノイズの低減」と同じ考え方（雑音の型を測り、その型より十分大きい成分だけを残す）を、
// 人の聞き心地を優先して作り直したもの。
//  ・雑音の型：ファイル全体のいちばん静かな部分から自動で測る（手で無音部分を選ぶ必要がない）
//  ・判定：0/1 で切り替えず、雑音の型との差に応じてなめらかに下げる（ザラつき・チリチリ音を抑える）
//  ・時間方向：立ち上がりは先回りして上げ（30ms）、下げるときはゆっくり（250ms）→ 語尾が急に切れない
//  ・語尾の保護：直前まで話していた区間は、下げる量を holdDb までに抑える。ただし浅くしすぎると
//    「声が出るたびに雑音（シャカシャカ）が上がる」ポンピングになるため、深め（30dB）にしている
//  ・周波数方向：となりの帯域と平均して、細かな凸凹（金属的な響き）を作らない
// 48kHz・モノラル・Float32Array。巨大な配列を作らないよう、数フレーム先までを持つ流れ作業で処理する。

const SR = 48000;
const N = 2048, H = 512, K = N / 2 + 1;

// ---------- FFT（基数2・複素数・係数表をあらかじめ用意）
const REV = new Uint32Array(N);
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
const COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos(2 * Math.PI * i / N); SIN[i] = Math.sin(2 * Math.PI * i / N); }
function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sg = inverse ? 1 : -1;
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1, step = N / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = COS[t], wi = sg * SIN[t];
        const a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}
const WIN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); // Hann
const OLA = 1.5; // Hann² を 1/4 ずつずらして重ねたときの合計

export function spectralNR(x, opts = {}, onProgress = () => {}) {
  const {
    reductionDb = 36, // 雑音を下げる最大量
    holdDb = 30,      // 話の直後（語尾）で下げてよい最大量
    lo = 3, hi = 12,  // 雑音の型より lo dB 上までは雑音、hi dB 上からは声とみなし、その間はなめらかに
    freqBins = 6,     // 周波数方向の平滑化（± ビン数。1ビン ≈ 23Hz）
    attackMs = 30, releaseMs = 250, holdReleaseMs = 350,
    releaseDbPerSec = 0, // 0 以外なら、下げる速さを「1秒あたり何dBまで」で決める（深く下げても急に落ちない）
    quietFrac = 0.12, // 雑音の型を測るのに使う「静かなフレーム」の割合
  } = opts;
  const n = x.length;
  const nF = Math.ceil((n + N - H) / H);
  const start = (f) => f * H - (N - H);
  const re = new Float64Array(N), im = new Float64Array(N);
  const load = (f) => { const s = start(f); for (let i = 0; i < N; i++) { const idx = s + i; re[i] = idx >= 0 && idx < n ? x[idx] * WIN[i] : 0; im[i] = 0; } };

  // ① フレームごとのエネルギー → 静かなフレームを選ぶ
  const e = new Float64Array(nF);
  for (let f = 0; f < nF; f++) { const s = start(f); let acc = 0; for (let i = 0; i < N; i++) { const idx = s + i; if (idx >= 0 && idx < n) { const v = x[idx] * WIN[i]; acc += v * v; } } e[f] = acc; }
  const valid = []; for (let f = 0; f < nF; f++) if (e[f] > 1e-10 * N) valid.push(e[f]); // 完全な無音は除く
  valid.sort((a, b) => a - b);
  const thr = valid.length ? valid[Math.min(valid.length - 1, Math.floor(quietFrac * (valid.length - 1)))] : 0;

  // ② 静かなフレームの平均スペクトル＝雑音の型
  const M = new Float64Array(K); let cnt = 0;
  for (let f = 0; f < nF; f++) {
    if (!(e[f] > 1e-10 * N && e[f] <= thr)) continue;
    load(f); fft(re, im, false);
    for (let k = 0; k < K; k++) M[k] += re[k] * re[k] + im[k] * im[k];
    cnt++;
  }
  for (let k = 0; k < K; k++) M[k] = cnt ? M[k] / cnt : 0;
  const Mmin = 1e-14; for (let k = 0; k < K; k++) M[k] = Math.max(M[k], Mmin);
  onProgress(0.08);

  // ③ 本処理（数フレーム先まで見ながら流れ作業で）
  const logf = Math.log(Math.pow(10, -reductionDb / 20));
  const logh = Math.log(Math.pow(10, -holdDb / 20));
  const relStep = releaseDbPerSec > 0 ? (releaseDbPerSec / 20 * Math.LN10) * H / SR : -logf / Math.max(1, releaseMs / 1000 * SR / H);
  const attStep = -logf / Math.max(1, attackMs / 1000 * SR / H);
  const A = Math.ceil(-logf / attStep); // 先回りで見るフレーム数
  const holdC = Math.exp(-H / (holdReleaseMs / 1000 * SR));
  const binHz = SR / N, bLo = Math.ceil(150 / binHz), bHi = Math.floor(4000 / binHz);
  const R = A + 4; // リングバッファの長さ
  const Xr = Array.from({ length: R }, () => new Float64Array(K)), Xi = Array.from({ length: R }, () => new Float64Array(K));
  const Pw = Array.from({ length: R }, () => new Float64Array(K)), LG = Array.from({ length: R }, () => new Float64Array(K));
  const prevLG = new Float64Array(K).fill(logf);
  // 出力先：inPlace なら入力の配列にそのまま書き戻す（30分の音声で約350MBの節約。スマートフォン対策）。
  // 書き戻すのは「もう読み込まない位置」だけなので、入力を壊さずに処理できる
  const y = opts.inPlace ? x : new Float32Array(n);
  const ola = new Float64Array(N); // 重ね合わせ中のサンプル（start(i) から N 個）
  const gl = new Float64Array(K), gs = new Float64Array(K), cum = new Float64Array(K + 1);
  let holdAct = 0, lastPct = 0, prevBB = 0;
  const maxDrop = opts.maxDropDb ?? 1.0; // 1フレーム（約10.7ms）あたりの下げ幅の上限（dB）
  const bHi6 = Math.floor(6000 / binHz);

  const ring = (f) => ((f % R) + R) % R;
  // フレーム j を読み込んで FFT
  const analyze = (j) => {
    const r = ring(j);
    if (j < nF) { load(j); fft(re, im, false); for (let k = 0; k < K; k++) { Xr[r][k] = re[k]; Xi[r][k] = im[k]; Pw[r][k] = re[k] * re[k] + im[k] * im[k]; } }
    else { Xr[r].fill(0); Xi[r].fill(0); Pw[r].fill(0); }
  };
  // フレーム c のゲイン（リリース適用済みの対数ゲイン）を計算。c-1, c, c+1 の 3 フレームが必要
  const decide = (c) => {
    const P0 = Pw[ring(Math.max(0, c - 1))], P1 = Pw[ring(c)], P2 = Pw[ring(Math.min(nF - 1, c + 1))];
    const L = LG[ring(c)];
    // 話している度合い（150Hz〜4kHz の「声らしさ」の平均）
    let ps = 0, es = 0, ms = 0;
    for (let k = 0; k < K; k++) {
      const a = P0[k], b = P1[k], d = P2[k];
      const second = Math.max(Math.min(a, b), Math.min(Math.max(a, b), d)); // 3つの中央値＝2番目に大きい値
      const snr = 10 * Math.log10(second / M[k] + 1e-20);
      const p = Math.min(1, Math.max(0, (snr - lo) / (hi - lo)));
      L[k] = p; // いったん「声らしさ」を入れておく
      if (k >= bLo && k <= bHi) { ps += p; es += b; ms += M[k]; }
    }
    // 話している度合い：150Hz〜4kHz の合計が雑音の型より何dB大きいか（小さくなった語尾も拾えるよう、帯域全体で見る）
    const actMode = opts.actMode || 'energy';
    const act = actMode === 'energy'
      ? Math.min(1, Math.max(0, (10 * Math.log10(es / ms + 1e-20) - (opts.actLo ?? 3)) / (opts.actSpan ?? 6)))
      : Math.min(1, Math.max(0, (ps / (bHi - bLo + 1) - 0.15) / 0.35));
    holdAct = act > holdAct ? act : holdAct * holdC + act * (1 - holdC);
    const floorT = logf + (logh - logf) * holdAct; // 話の近くでは下げ幅を浅く
    for (let k = 0; k < K; k++) {
      let v = floorT * (1 - L[k]);
      v = Math.max(v, prevLG[k] - relStep); // ゆっくり下げる（リリース）
      L[k] = v; prevLG[k] = v;
    }
  };
  // フレーム i の最終ゲインを決めて、音に戻す
  const synth = (i) => {
    for (let k = 0; k < K; k++) {
      let v = LG[ring(i)][k];
      for (let a = 1; a <= A && i + a < nF + A; a++) { const w = LG[ring(i + a)][k] - a * attStep; if (w > v) v = w; } // 先回りして上げる（アタック）
      gl[k] = v;
    }
    // 周波数方向の平滑化（対数ゲインの移動平均）
    cum[0] = 0; for (let k = 0; k < K; k++) cum[k + 1] = cum[k] + gl[k];
    for (let k = 0; k < K; k++) {
      const a = Math.max(0, k - freqBins), b = Math.min(K - 1, k + freqBins);
      gs[k] = Math.exp(Math.max(logf, (cum[b + 1] - cum[a]) / (b - a + 1)));
    }
    const r = ring(i);
    // 急な切れの防止：このフレーム全体（150Hz〜6kHz）の下がり方が、直前のフレームより maxDrop dB を超えないようにする
    if (maxDrop > 0) {
      let ex = 0, ey = 0;
      for (let k = bLo; k <= bHi6; k++) { const p = Xr[r][k] * Xr[r][k] + Xi[r][k] * Xi[r][k]; ex += p; ey += p * gs[k] * gs[k]; }
      if (ex > 0) {
        let gdb = 10 * Math.log10(ey / ex + 1e-30);
        if (gdb < prevBB - maxDrop) {
          const lift = Math.pow(10, (prevBB - maxDrop - gdb) / 20);
          for (let k = 0; k < K; k++) gs[k] = Math.min(1, gs[k] * lift);
          gdb = prevBB - maxDrop;
        }
        prevBB = gdb;
      }
    }
    for (let k = 0; k < K; k++) { re[k] = Xr[r][k] * gs[k]; im[k] = Xi[r][k] * gs[k]; }
    for (let k = 1; k < K - 1; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    fft(re, im, true);
    const s = start(i);
    for (let t = 0; t < N; t++) ola[t] += re[t] / N * WIN[t] / OLA;
    // 先頭の H サンプルはこれ以降のフレームと重ならないので確定。書き出して、窓を H 進める
    for (let t = 0; t < H; t++) { const idx = s + t; if (idx >= 0 && idx < n) y[idx] = ola[t]; }
    ola.copyWithin(0, H); ola.fill(0, N - H);
  };

  // 先読み：フレーム 0..A+1 を解析し、0..A を判定
  for (let j = 0; j <= A + 1; j++) analyze(j);
  for (let c = 0; c <= A; c++) decide(c);
  for (let i = 0; i < nF; i++) {
    // フレーム i を出力する前に、i+A+1 まで判定済み・i+A+2 まで解析済みにしておく
    const c = i + A + 1;
    analyze(c + 1);
    if (c < nF) decide(c); else LG[ring(c)].fill(logf);
    synth(i);
    const pctNow = 0.08 + 0.92 * i / nF;
    if (pctNow - lastPct > 0.01) { lastPct = pctNow; onProgress(pctNow); }
  }
  return y;
}
