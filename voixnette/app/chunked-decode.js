// Voixnette — 長い m4a / mp4（AAC）を少しずつ読み込む（スマートフォンのメモリ対策）
// ブラウザの decodeAudioData は音声全体を一度に展開するため、30分の録音では 1GB 近いメモリを使い、
// iPhone などでは失敗することがある。そこで AAC のフレームを約20秒ずつ取り出して順に読み込み、
// モノラルにして 1 本の配列へつなぐ。つなぎ目は前後に余分に読んだ部分どうしをなめらかに重ねる。
import { adtsRange } from './qt-aac.js';

/**
 * @param buf     元ファイルの ArrayBuffer
 * @param track   aacTrack(buf) の結果
 * @param decode  (adtsArrayBuffer) => Promise<AudioBuffer 互換 { numberOfChannels, length, getChannelData(c) }>（48kHz）
 */
export async function decodeAacChunked(buf, track, decode, { chunkSec = 20, pad = 8, onProgress = () => {} } = {}) {
  const OUT = 48000;
  const spf = 1024 * OUT / track.sampleRate;           // 1フレームが出力で何サンプルか
  // 区切りの位置が出力でちょうど整数サンプルになるよう、フレーム数を unit の倍数にそろえる
  // （48kHz なら 1、44.1kHz なら 147。半端なずれでつなぎ目の音が揺れないように）
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const unit0 = track.sampleRate / gcd(1024 * OUT, track.sampleRate);
  const unit = unit0 <= 300 ? unit0 : 1;
  if (unit > 1) pad = Math.ceil(pad / unit) * unit;
  const fpc = Math.max(pad * 4, Math.round(chunkSec * track.sampleRate / 1024 / unit) * unit); // 1回に読むフレーム数
  const total = Math.ceil(track.count * spf);
  const out = new Float32Array(total);
  const XF = 2, SKIP = 3;                               // 重ねる長さ・捨てる長さ（フレーム）
  let lag = 0, channels = 1;
  for (let s = 0; s < track.count; s += fpc) {
    const e = Math.min(track.count, s + fpc);
    const f0 = Math.max(0, s - pad), f1 = Math.min(track.count, e + pad);
    const ab = await decode(adtsRange(buf, track, f0, f1));
    channels = ab.numberOfChannels;
    const n = ab.length, mono = new Float32Array(n);
    for (let c = 0; c < channels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / channels; }
    // 復号した長さと本来の長さの差＝先頭で削られた（または足された）サンプル数とみなす
    const D = Math.max(-4096, Math.min(4096, Math.round((f1 - f0) * spf) - n));
    const base = Math.round(f0 * spf) + D;              // mono[0] が全体のどこに当たるか
    if (s > 0) {
      const ov0 = Math.round((s - XF) * spf), ovLen = Math.round(2 * XF * spf);
      lag = bestLag(out, mono, ov0, base, ovLen, lag);
    }
    // 先頭・末尾の数フレームは前後の音がなく不正確なので使わない（ファイルの最初と最後を除く）
    const p0 = s > 0 ? Math.round((f0 + SKIP) * spf) : 0;
    const p1 = e < track.count ? Math.round((f1 - SKIP) * spf) : total;
    const xf0 = Math.round((s - XF) * spf), xf1 = Math.round((s + XF) * spf);
    for (let p = Math.max(p0, s > 0 ? xf0 : 0); p < p1 && p < total; p++) {
      const j = p - base - lag; if (j < 0 || j >= n) continue;
      if (s > 0 && p < xf1) {
        const w = 0.5 - 0.5 * Math.cos(Math.PI * (p - xf0) / (xf1 - xf0)); // 0→1 のなめらかな切り替え
        out[p] = out[p] * (1 - w) + mono[j] * w;
      } else out[p] = mono[j];
    }
    onProgress(e / track.count);
  }
  return { mono: out, duration: total / OUT, channels };
}

// 重なり区間で、相関がいちばん高くなるずれ（サンプル）を探す。音が小さくて判断できないときは前回の値を使う
function bestLag(out, mono, ov0, base, len, prev) {
  const at = (lag) => {
    let xy = 0, xx = 0, yy = 0;
    for (let k = 0; k < len; k += 2) {
      const p = ov0 + k, j = p - base - lag;
      if (p < 0 || p >= out.length || j < 0 || j >= mono.length) continue;
      const a = out[p], b = mono[j]; xy += a * b; xx += a * a; yy += b * b;
    }
    return { r: xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0, e: xx };
  };
  const z = at(prev);
  if (z.e < 1e-6 * len || z.r > 0.995) return prev;
  let best = prev, br = z.r;
  for (let lag = prev - 2400; lag <= prev + 2400; lag += 4) { const q = at(lag); if (q.r > br) { br = q.r; best = lag; } }
  for (let lag = best - 4; lag <= best + 4; lag++) { const q = at(lag); if (q.r > br) { br = q.r; best = lag; } }
  return br > 0.9 && br > z.r + 0.05 ? best : prev;
}
