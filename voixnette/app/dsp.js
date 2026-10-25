// Voixnette — 信号処理モジュール（podcast_clean.py の JavaScript 移植）
// すべて 48kHz・モノラル・Float32Array を前提にする。
// ブラウザの Worker と Node.js（検証用）の両方から import できるよう、外部依存なし。

export const SR = 48000;

export const PRESETS = {
  clear: { // 設定B（おすすめ）
    // AIの除去量の上限。100（無制限）だと言葉の合間が完全な無音に切り落とされ、
    // 雑音の多い録音では「ぶつ切り」に聞こえる。24dB に抑えて、合間はごく静かな背景音として残す。
    attenLimit: 24,
    eq: [
      { type: 'peaking', f: 250, q: 1.0, g: -3 },
      { type: 'peaking', f: 3000, q: 0.8, g: 7 },
      { type: 'highshelf', f: 5000, q: 0.5, g: 9 },
    ],
  },
  natural: { // 設定A相当：ルームトーンを少し残す
    attenLimit: 15,
    eq: [
      { type: 'peaking', f: 250, q: 1.0, g: -2 },
      { type: 'peaking', f: 3000, q: 0.8, g: 5 },
      { type: 'highshelf', f: 5000, q: 0.5, g: 6 },
    ],
  },
};

const dbToLin = (db) => Math.pow(10, db / 20);

// ---------------------------------------------------------------- 1. 音割れ修復
// 波形の頭が切れた（上限に張り付いた）区間を見つけ、前後の傾きからエルミート補間で山を作り直す。
// 先に -6dB 下げているので、作り直した山が再びクリップすることはない。
export function declip(x, preGainDb = -6) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const g = dbToLin(preGainDb);
  let repaired = 0;
  if (peak >= 0.98) {
    const th = peak * 0.995;
    let i = 1;
    while (i < x.length - 1) {
      if (Math.abs(x[i]) >= th) {
        let j = i;
        while (j < x.length - 1 && Math.abs(x[j + 1]) >= th && Math.sign(x[j + 1]) === Math.sign(x[i])) j++;
        const a = i - 1, b = j + 1; // 補間に使う両端（クリップしていないサンプル）
        if (a >= 1 && b < x.length - 1 && j - i + 1 >= 2) {
          const p0 = x[a], p1 = x[b];
          const w = b - a;
          // 端点の傾き（サンプルあたり）× 区間幅
          const m0 = (x[a] - x[a - 1]) * w, m1 = (x[b + 1] - x[b]) * w;
          for (let k = i; k <= j; k++) {
            const t = (k - a) / w, t2 = t * t, t3 = t2 * t;
            let v = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
            // 復元値は元のクリップ値より大きく、上限 2 倍まで（暴れ防止）
            const s = Math.sign(x[i]);
            v = s * Math.min(Math.max(Math.abs(v), Math.abs(x[k])), peak * 2);
            x[k] = v;
          }
          repaired += j - i + 1;
        }
        i = j + 1;
      } else i++;
    }
  }
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return repaired;
}

// ---------------------------------------------------------------- 3. 音量の均一化（ゲート付きレベラー）
// 20ms ごとの音量から「話している区間」だけを見て、前後1.2秒の平均が target になるようにゲインを決める。
// 無音は持ち上げない（前後の発話区間のゲインを補間）。
export function level(x, target = -20, maxCut = -10, maxBoost = 14) {
  const hop = Math.round(0.02 * SR);
  const n = Math.floor(x.length / hop) + 1;
  const p = new Float64Array(n), db = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0; const st = f * hop, en = Math.min(st + hop, x.length);
    for (let i = st; i < en; i++) s += x[i] * x[i];
    p[f] = s / hop + 1e-12; db[f] = 10 * Math.log10(p[f]);
  }
  const sorted = Float64Array.from(db).sort();
  const p97 = sorted[Math.min(n - 1, Math.floor(0.97 * (n - 1)))];
  const thr = Math.max(-50, p97 - 35);
  const voiced = new Uint8Array(n);
  for (let f = 0; f < n; f++) voiced[f] = db[f] > thr ? 1 : 0;

  const W = Math.round(1.2 / 0.02);
  const num = boxFilter(Float64Array.from(p, (v, i) => voiced[i] ? v : 0), W);
  const den = boxFilter(Float64Array.from(voiced), W);
  const g = new Float64Array(n); const ok = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    if (den[f] > 0.08) {
      const lvl = 10 * Math.log10(num[f] / Math.max(den[f], 1e-9));
      g[f] = Math.min(maxBoost, Math.max(maxCut, target - lvl)); ok[f] = 1;
    }
  }
  fillGaps(g, ok);
  const gs = boxFilter(g, Math.round(0.5 / 0.02));
  // フレーム中心ではなくフレーム先頭基準で線形補間（Python版と同じ）
  for (let i = 0; i < x.length; i++) {
    const pos = i / hop; const f0 = Math.floor(pos), f1 = Math.min(n - 1, f0 + 1), t = pos - f0;
    const gd = gs[f0] * (1 - t) + gs[f1] * t;
    x[i] *= Math.pow(10, gd / 20);
  }
}

// scipy.ndimage.uniform_filter1d(mode='reflect') 相当
function boxFilter(a, size) {
  const n = a.length, out = new Float64Array(n);
  const left = Math.floor(size / 2), right = size - left - 1;
  const at = (i) => { // reflect: d c b a | a b c d | d c b a
    while (i < 0 || i >= n) { if (i < 0) i = -i - 1; if (i >= n) i = 2 * n - i - 1; }
    return a[i];
  };
  let s = 0;
  for (let k = -left; k <= right; k++) s += at(k);
  for (let i = 0; i < n; i++) {
    out[i] = s / size;
    s += at(i + right + 1) - at(i - left);
  }
  return out;
}

function fillGaps(g, ok) {
  const n = g.length; const idx = [];
  for (let i = 0; i < n; i++) if (ok[i]) idx.push(i);
  if (!idx.length) { g.fill(0); return; }
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (ok[i]) continue;
    while (k < idx.length - 1 && idx[k + 1] < i) k++;
    if (i < idx[0]) g[i] = g[idx[0]];
    else if (i > idx[idx.length - 1]) g[i] = g[idx[idx.length - 1]];
    else { const a = idx[k], b = idx[k + 1]; g[i] = g[a] + (g[b] - g[a]) * (i - a) / (b - a); }
  }
}

// ---------------------------------------------------------------- 4. HPF / EQ（双二次フィルター。FFmpeg と同じ係数式）
function biquadCoeffs(type, f, q, gainDb) {
  const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f / SR;
  const cs = Math.cos(w0), sn = Math.sin(w0), alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
  } else if (type === 'highshelf') {
    const sq = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq);
    a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq;
  } else throw new Error('unknown filter ' + type);
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

export function biquad(x, type, f, q, gainDb = 0) {
  const [b0, b1, b2, a1, a2] = biquadCoeffs(type, f, q, gainDb);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
}

// ---------------------------------------------------------------- 4'. 雑音に合わせて EQ の持ち上げ量を決める
// 雑音の多い帯域を持ち上げると、残った雑音まで大きくなる。そこで帯域ごとに
// 「話している区間」と「合間」の音量差（帯域SNR）を測り、差が小さい帯域ほど持ち上げを控えめにする。
// 静かな録音（帯域SNRが十分）では、設定どおりに持ち上げる。
function bandLevels(x, lo, hi) {
  const y = Float32Array.from(x);
  if (lo) { biquad(y, 'highpass', lo, Math.SQRT1_2); biquad(y, 'highpass', lo, Math.SQRT1_2); }
  if (hi) { biquadLow(y, hi); biquadLow(y, hi); }
  const hop = Math.round(0.05 * SR), n = Math.floor(y.length / hop), d = new Float64Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += y[i] * y[i]; d[f] = 10 * Math.log10(s / hop + 1e-14); }
  return d;
}
function biquadLow(x, f) {
  const w0 = 2 * Math.PI * f / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, b2 = b0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
}
const pct = (a, q) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
export function adaptEq(x, eq, { fullAt = 26, zeroAt = 12 } = {}) {
  const broad = bandLevels(x, 100, 0);
  const hiTh = pct(broad, 0.8), loTh = pct(broad, 0.2);
  const snrOf = (lo, hi) => {
    const b = bandLevels(x, lo, hi); const sp = [], gp = [];
    for (let i = 0; i < b.length; i++) { if (broad[i] >= hiTh) sp.push(b[i]); else if (broad[i] <= loTh) gp.push(b[i]); }
    return sp.length && gp.length ? pct(sp, 0.5) - pct(gp, 0.5) : 99;
  };
  const report = {};
  const out = eq.map((b) => {
    if (b.g <= 0) return b;                       // 下げる EQ はそのまま
    const lo = b.type === 'highshelf' ? b.f : b.f / 1.6, hi = b.type === 'highshelf' ? 12000 : b.f * 1.6;
    const snr = snrOf(lo, hi);
    const k = Math.max(0, Math.min(1, (snr - zeroAt) / (fullAt - zeroAt)));
    report[`${b.type}@${b.f}`] = { snr: +snr.toFixed(1), gain: +(b.g * k).toFixed(1) };
    return { ...b, g: b.g * k };
  });
  return { eq: out, report };
}

export function eqChain(x, eq) {
  biquad(x, 'highpass', 80, Math.SQRT1_2);
  for (const b of eq) biquad(x, b.type, b.f, b.q, b.g);
}

// ---------------------------------------------------------------- 5. コンプレッサー（FFmpeg acompressor の移植・RMS検出）
export function compress(x, { thresholdDb = -24, ratio = 2.5, attackMs = 10, releaseMs = 150, makeup = 1, knee = 2.82843 } = {}) {
  const thresLin = dbToLin(thresholdDb);
  const thres = Math.log(thresLin);
  const attackC = Math.min(1, 1 / (attackMs * SR / 4000));
  const releaseC = Math.min(1, 1 / (releaseMs * SR / 4000));
  const kneeStart = Math.log(thresLin / Math.sqrt(knee));
  const kneeStop = Math.log(thresLin * Math.sqrt(knee));
  const compKneeStop = (kneeStop - thres) / ratio + thres;
  const linKneeStart = Math.pow(thresLin / Math.sqrt(knee), 2); // RMS検出なので2乗
  const delta = 1 / ratio;
  let slopeLin = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] * x[i];
    slopeLin += (a - slopeLin) * (a > slopeLin ? attackC : releaseC);
    let gain = 1;
    if (slopeLin > 0 && slopeLin > linKneeStart) {
      const slope = 0.5 * Math.log(slopeLin);
      let gl = (slope - thres) / ratio + thres;
      if (knee > 1 && slope < kneeStop) gl = hermite(slope, kneeStart, kneeStop, kneeStart, compKneeStop, 1, delta);
      gain = Math.exp(gl - slope);
    }
    x[i] = x[i] * gain * makeup;
  }
}

function hermite(x, x0, x1, p0, p1, m0, m1) {
  const w = x1 - x0, t = (x - x0) / w;
  m0 *= w; m1 *= w;
  const t2 = t * t, t3 = t2 * t;
  return (2 * p0 + m0 - 2 * p1 + m1) * t3 + (-3 * p0 - 2 * m0 + 3 * p1 - m1) * t2 + m0 * t + p0;
}

// ---------------------------------------------------------------- 6. ラウドネス（ITU-R BS.1770-4 / EBU R128）
// 48kHz の K 特性フィルター係数（BS.1770 の規格値）
const KW1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const KW2 = { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] };

export function integratedLoudness(x) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = KW1.b[0] * x[i] + KW1.b[1] * x1 + KW1.b[2] * x2 - KW1.a[0] * y1 - KW1.a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  x1 = x2 = y1 = y2 = 0;
  for (let i = 0; i < y.length; i++) {
    const xi = y[i];
    const v = KW2.b[0] * xi + KW2.b[1] * x1 + KW2.b[2] * x2 - KW2.a[0] * y1 - KW2.a[1] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = v; y[i] = v;
  }
  const block = Math.round(0.4 * SR), step = Math.round(0.1 * SR);
  const powers = [];
  for (let st = 0; st + block <= y.length; st += step) {
    let s = 0; for (let i = st; i < st + block; i++) s += y[i] * y[i];
    powers.push(s / block);
  }
  const L = (p) => -0.691 + 10 * Math.log10(p);
  let g1 = powers.filter((p) => L(p) > -70);
  if (!g1.length) return -Infinity;
  const rel = L(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
  const g2 = g1.filter((p) => L(p) > rel);
  return L(g2.reduce((a, b) => a + b, 0) / g2.length);
}

// 先読み付きピークリミッター（4倍オーバーサンプリングで真のピークを推定）
export function truePeakEstimate(x) {
  // 4点の windowed-sinc 補間で、サンプル間の山（インターサンプルピーク）を近似
  const taps = 8; const phases = [0.25, 0.5, 0.75];
  const kern = phases.map((ph) => {
    const k = []; for (let n = -taps + 1; n <= taps; n++) {
      const t = n - ph; const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos(Math.PI * t / taps); k.push(sinc * w);
    } return k;
  });
  const tp = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let m = Math.abs(x[i]);
    if (m > 0.3) { // 小さい区間は計算を省略（ピークにならない）
      for (const k of kern) {
        let s = 0;
        for (let j = 0; j < k.length; j++) { const idx = i + j - taps + 1; if (idx >= 0 && idx < x.length) s += k[j] * x[idx]; }
        if (Math.abs(s) > m) m = Math.abs(s);
      }
    }
    tp[i] = m;
  }
  return tp;
}

export function limit(x, ceilingDb = -1.5, lookaheadMs = 5, releaseMs = 80) {
  const ceil = dbToLin(ceilingDb);
  const tp = truePeakEstimate(x);
  const la = Math.max(1, Math.round(lookaheadMs * SR / 1000));
  const n = x.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = tp[i] > ceil ? ceil / tp[i] : 1;
  // ① 先読み：これから la サンプル以内に来るピークに必要なゲインの最小値
  const fut = slidingMinFuture(need, la);
  // ② リリース：下げたゲインはゆっくり 1 に戻す（下げるのは即時）
  const rel = Math.exp(-1 / (releaseMs * SR / 1000));
  let g = 1;
  for (let i = 0; i < n; i++) { g = Math.min(fut[i], 1 - (1 - g) * rel); fut[i] = g; }
  // ③ 直近 la サンプルの移動平均でなめらかにする（ピーク位置では必ず必要量以下になる）
  let s = 0; const buf = new Float32Array(la + 1); let bi = 0;
  for (let k = 0; k <= la; k++) { buf[k] = 1; s += 1; }
  for (let i = 0; i < n; i++) {
    s += fut[i] - buf[bi]; buf[bi] = fut[i]; bi = (bi + 1) % (la + 1);
    x[i] *= s / (la + 1);
  }
}

// a[i..i+w] の最小値（単調キュー）
function slidingMinFuture(a, w) {
  const n = a.length, out = new Float32Array(n); const dq = new Int32Array(n); let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && a[dq[t - 1]] >= a[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + w) h++;
    out[i] = a[dq[h]];
  }
  return out;
}

export function normalizeLoudness(x, targetLufs = -16, tpDb = -1.5) {
  const before = integratedLoudness(x);
  if (!isFinite(before)) return { before, after: before };
  // リミッターで少し音量が下がるため、目標との差が 0.1dB 未満になるまで最大3回くり返す
  let now = before;
  for (let it = 0; it < 3 && Math.abs(targetLufs - now) >= 0.1; it++) {
    const g = dbToLin(targetLufs - now);
    for (let i = 0; i < x.length; i++) x[i] *= g;
    limit(x, tpDb);
    now = integratedLoudness(x);
  }
  return { before, after: now };
}

// ---------------------------------------------------------------- 書き出し
export function toWav16(x, sr = SR) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  const pcm = new Int16Array(buf, 44);
  for (let i = 0; i < n; i++) {
    // TPDF ディザ（16bit 化の量子化ノイズを目立たなくする）
    const d = (Math.random() - Math.random()) / 32768;
    const s = Math.max(-1, Math.min(1, x[i] + d));
    pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return buf;
}
