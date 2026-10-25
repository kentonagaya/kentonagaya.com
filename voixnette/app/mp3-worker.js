// Voixnette — MP3 書き出し用ワーカー（lamejs / LGPL-3.0）
// 48kHz の Float32 を受け取り、44.1kHz へのサンプルレート変換と MP3 化を少しずつ（流れ作業で）行う。
// 以前はメインスレッドで音声全体を一度に変換していたため、長い音声でスマートフォンのメモリが足りなくなっていた。
importScripts('lame.min.js');

// ---------- 48kHz → 44.1kHz（147/160）の多相フィルター（窓付き sinc、Kaiser 窓）
const L = 147, M = 160, TAPS = 48, HALF = TAPS / 2;
const CUT = 0.9 * (44100 / 48000); // 入力のナイキストに対する通過域の上限（約 19.8kHz）
function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; }
const BETA = 8.0, I0B = bessel0(BETA);
const TABLE = []; // TABLE[phase][m]：入力 floor(t)+m-HALF+1 に掛ける係数
for (let p = 0; p < L; p++) {
  const frac = p / L, row = new Float64Array(TAPS); let sum = 0;
  for (let m = 0; m < TAPS; m++) {
    const d = (m - HALF + 1) - frac; // 入力サンプルと出力位置の距離（入力サンプル単位）
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * CUT * d) / (Math.PI * CUT * d);
    const r = d / HALF; const w = Math.abs(r) <= 1 ? bessel0(BETA * Math.sqrt(1 - r * r)) / I0B : 0;
    row[m] = CUT * sinc * w; sum += row[m];
  }
  for (let m = 0; m < TAPS; m++) row[m] /= sum; // 直流のゲインを 1 に
  TABLE.push(row);
}
// 出力サンプル n0〜n1 を作って Int16 で返す
function resampleBlock(x, n0, n1) {
  const out = new Int16Array(n1 - n0), nIn = x.length;
  for (let n = n0; n < n1; n++) {
    const num = n * M, base = Math.floor(num / L), row = TABLE[num - base * L];
    let s = 0;
    for (let m = 0; m < TAPS; m++) { const i = base + m - HALF + 1; if (i >= 0 && i < nIn) s += row[m] * x[i]; }
    s = Math.max(-1, Math.min(1, s));
    out[n - n0] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}
self.resampleBlock = resampleBlock; // 検証用

self.onmessage = (e) => {
  const { id, samples, kbps } = e.data; // samples: Float32Array（48kHz・モノラル）
  try {
    const enc = new lamejs.Mp3Encoder(1, 44100, kbps);
    const total = Math.floor(samples.length * L / M);
    const chunks = [];
    const block = 1152 * 20;
    let last = 0;
    for (let n = 0; n < total; n += block) {
      const pcm = resampleBlock(samples, n, Math.min(total, n + block));
      const out = enc.encodeBuffer(pcm);
      if (out.length) chunks.push(new Uint8Array(out));
      const now = Date.now();
      if (now - last > 150) { last = now; self.postMessage({ type: 'progress', id, pct: n / total }); }
    }
    const end = enc.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    self.postMessage({ type: 'done', id, blob });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err && err.name ? err.name + ': ' : '') + ((err && err.message) || String(err)) });
  }
};
