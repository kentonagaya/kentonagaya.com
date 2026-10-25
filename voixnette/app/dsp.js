// Voixnette — 信号処理モジュール（podcast_clean.py の JavaScript 移植）
// すべて 48kHz・モノラル・Float32Array を前提にする。
// ブラウザの Worker と Node.js（検証用）の両方から import できるよう、外部依存なし。

export const SR = 48000;

export const PRESETS = {
  clear: { // 設定B（おすすめ）
    // AIは上限なしで雑音を取り切り、取り除いた分を「低い帯域だけ」ごく小さく戻す（mixResidual）。
    // 合間が完全な無音にならないので「ぶつ切り」にならず、子音のある高い帯域は雑音に埋もれない。
    attenLimit: 100,
    roomTone: { lowDb: -32, highDb: -50 },
    // 声の音色は録音ごとに測って自動で整える（tonalEq）
    tonal: { strength: 0.8, maxBoost: 14 },
  },
  natural: { // 設定A相当：ルームトーンを少し多めに残し、補正も控えめ
    attenLimit: 100,
    roomTone: { lowDb: -26, highDb: -42 },
    tonal: { strength: 0.6, maxBoost: 10 },
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
  // 合間の雑音を「声」と数えないよう、雑音の床（下位10%）より十分大きい部分だけを声とみなす
  const p10 = sorted[Math.floor(0.1 * (n - 1))];
  const thr = Math.max(-50, p97 - 35, Math.min(p97 - 20, p10 + 10));
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

function biquadLow(x, f) {
  const w0 = 2 * Math.PI * f / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, b2 = b0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
}
const pct = (a, q) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

// ---------------------------------------------------------------- 2'. 除去しきった音に、ごく小さく元の背景音を戻す
// AIで雑音を最大限取り除くと、言葉の合間が完全な無音になり「ぶつ切り」に聞こえる。
// そこで取り除いた分（元の音 − AIの出力）を、低い帯域だけ少し戻して自然な背景音（ルームトーン）にする。
// 子音のある高い帯域にはほとんど戻さないので、声の輪郭は雑音に埋もれない。
export function mixResidual(x, y, { lowDb = -32, highDb = -50, fc = 1500 } = {}) {
  const lo = dbToLin(lowDb), hi = dbToLin(highDb);
  // 4次ローパス（2次バターワース×2）を1サンプルずつ回す。30分の音声でも余分な配列を作らない
  const w0 = 2 * Math.PI * fc / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, b2 = b0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
  let p1 = 0, p2 = 0, q1 = 0, q2 = 0, s1 = 0, s2 = 0; // 1段目の入出力履歴（p, q）と2段目の出力履歴（s）
  for (let i = 0; i < y.length; i++) {
    const r = x[i] - y[i];
    const m = b0 * r + b1 * p1 + b2 * p2 - a1 * q1 - a2 * q2;
    const l = b0 * m + b1 * q1 + b2 * q2 - a1 * s1 - a2 * s2;
    p2 = p1; p1 = r; q2 = q1; q1 = m; s2 = s1; s1 = l;
    y[i] += hi * r + (lo - hi) * l;
  }
  return y;
}

// ---------------------------------------------------------------- 4''. 声の音色を自動で整える（トーンバランス補正）
// 録音ごとに「話している区間」の平均スペクトルを測り、標準的な話し声のスペクトル
// （ANSI S3.5 SII の標準音声スペクトル）との差を、オクターブごとの EQ で埋める。
// こもった録音ほど高域を持ち上げ、低域のこもりを下げる。もともと整った録音ではほとんど何もしない。
// 雑音の多い帯域は、持ち上げると雑音も大きくなるため、帯域SNRに応じて持ち上げ量を制限する。
const TB_CENTERS = [125, 250, 500, 1000, 2000, 4000, 8000];
const TB_TARGET = [-3, 0, -0.5, -9.7, -17.4, -25.4, -33.6]; // 1Hzあたりのレベル（250Hz基準, dB）

function fftPow(re, im) { // 基数2の FFT（その場で計算）→ パワーを re に返す
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  for (let i = 0; i < n; i++) re[i] = re[i] * re[i] + im[i] * im[i];
}

function avgSpectrum(x, starts, N) {
  const acc = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (const s of starts) {
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] || 0) * win[i]; im[i] = 0; }
    fftPow(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k];
  }
  for (let k = 0; k < N / 2; k++) acc[k] /= Math.max(1, starts.length);
  return acc;
}

function biquadMagDb(type, f, q, g, freq) {
  const [b0, b1, b2, a1, a2] = biquadCoeffs(type, f, q, g);
  const w = 2 * Math.PI * freq / SR, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

export function tonalEq(x, { strength = 0.8, tilt = 0, maxBoost = 10, maxCut = -10, snrMargin = 3 } = {}) {
  const N = 2048, hop = Math.round(0.05 * SR), n = Math.floor((x.length - N) / hop);
  if (n < 40) return { eq: [], report: { skipped: 'short' } };
  const lv = new Float64Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * hop; i < f * hop + N; i++) s += x[i] * x[i]; lv[f] = 10 * Math.log10(s / N + 1e-14); }
  const hiTh = pct(lv, 0.8), loTh = pct(lv, 0.2);
  const pick = (cond) => { const a = []; for (let f = 0; f < n; f++) if (cond(lv[f])) a.push(f * hop); const step = Math.max(1, Math.floor(a.length / 1500)); return a.filter((_, i) => i % step === 0); };
  const Psp = avgSpectrum(x, pick((v) => v >= hiTh), N), Pgp = avgSpectrum(x, pick((v) => v <= loTh), N);
  const binHz = SR / N;
  const S = [], snr = [];
  for (const c of TB_CENTERS) {
    let sp = 0, gp = 0, m = 0;
    for (let k = Math.ceil(c / Math.SQRT2 / binHz); k <= Math.floor(c * Math.SQRT2 / binHz); k++) { sp += Psp[k]; gp += Pgp[k]; m++; }
    sp /= m; gp /= m;
    const clean = Math.max(sp - gp, sp * 0.02); // 話し声だけの推定（雑音の分を差し引く）
    S.push(10 * Math.log10(clean + 1e-30)); snr.push(10 * Math.log10(clean / (gp + 1e-30)));
  }
  // 1kHz を基準に、目標スペクトルとの差を求める
  const i1k = TB_CENTERS.indexOf(1000);
  const want = TB_CENTERS.map((c, i) => {
    const dev = (TB_TARGET[i] - TB_TARGET[i1k]) - (S[i] - S[i1k]) + (c >= 4000 ? tilt : c >= 2000 ? tilt / 2 : 0);
    let g = dev * strength;
    if (c === 125) g = Math.min(0, g); // 最低域は下げるだけ
    const cap = Math.max(0, Math.min(maxBoost, snr[i] - snrMargin));
    return Math.max(maxCut, Math.min(cap, g));
  });
  // オクターブ幅のピーキングEQ 7本の重なりを考慮して、各中心周波数で目標どおりになるゲインを求める
  const Q = 1.41;
  const g = want.slice();
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < TB_CENTERS.length; i++) {
      let h = 0; for (let j = 0; j < TB_CENTERS.length; j++) h += biquadMagDb('peaking', TB_CENTERS[j], Q, g[j], TB_CENTERS[i]);
      g[i] = Math.max(-14, Math.min(14, g[i] + 0.6 * (want[i] - h)));
    }
  }
  const eq = TB_CENTERS.map((f, i) => ({ type: 'peaking', f, q: Q, g: +g[i].toFixed(2) })).filter((b) => Math.abs(b.g) >= 0.2);
  const report = {};
  TB_CENTERS.forEach((c, i) => { report[c] = { snr: +snr[i].toFixed(1), gain: +want[i].toFixed(1) }; });
  return { eq, report };
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
