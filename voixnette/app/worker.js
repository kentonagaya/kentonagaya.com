// Voixnette — 処理用ワーカー（画面を固まらせないよう、重い処理はすべてここで行う）
import { DeepFilter } from './deepfilter.js';
import * as D from './dsp.js';

// AIエンジン（DeepFilterNet3 の WebAssembly 版）。Cloudflare Pages の 1 ファイル 25MB 制限のため 2 分割して配置。
const ENGINE = {
  parts: ['../engine/df-1.wasm', '../engine/df-2.wasm'],
  size: 34135648,
  sha256: '596034b83a03b546f33daa14b791bcdb59655cb3a07053ac39ddb0ba42c52fa4',
};
const DF_DELAY_FRAMES = 3; // ストリーミング処理による出力の遅れ（実測 1440 サンプル = 3 フレーム）

let engineReady = null;
const post = (m, t) => self.postMessage(m, t || []);

function loadEngine() {
  if (engineReady) return engineReady;
  engineReady = (async () => {
    const bytes = new Uint8Array(ENGINE.size);
    let got = 0;
    for (const p of ENGINE.parts) {
      const res = await fetch(new URL(p, import.meta.url));
      if (!res.ok) throw new Error(`AIエンジンを読み込めませんでした（${res.status}）`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (got + value.length > bytes.length) throw new Error('AIエンジンのサイズが想定と違います');
        bytes.set(value, got); got += value.length;
        post({ type: 'engine', loaded: got, total: ENGINE.size });
      }
    }
    if (got !== ENGINE.size) throw new Error('AIエンジンのダウンロードが途中で切れました。ページを再読み込みしてください');
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== ENGINE.sha256) throw new Error('AIエンジンのファイルが壊れています。ページを再読み込みしてください');
    // 一度初期化すれば、以降のファイルでは WebAssembly を再利用する
    const probe = await DeepFilter.create({ wasmUrl: { module_or_path: bytes }, attenuationLimit: 100 });
    probe.destroy();
    post({ type: 'engine', ready: true });
  })();
  engineReady.catch(() => { engineReady = null; });
  return engineReady;
}

async function denoise(x, attenLimit, onProgress) {
  const df = await DeepFilter.create({ attenuationLimit: attenLimit });
  const N = df.frameLength;
  const frames = Math.ceil(x.length / N) + DF_DELAY_FRAMES;
  const frame = new Float32Array(N);
  const out = new Float32Array(x.length);
  let last = 0;
  for (let f = 0; f < frames; f++) {
    const s = f * N;
    frame.fill(0);
    if (s < x.length) frame.set(x.subarray(s, Math.min(s + N, x.length)));
    const y = df.process(frame);
    const o = (f - DF_DELAY_FRAMES) * N; // 遅れを補正して書き込む
    if (o >= 0 && o < out.length) out.set(y.subarray(0, Math.min(N, out.length - o)), o);
    else if (o < 0 && o + N > 0) out.set(y.subarray(-o), 0);
    const now = Date.now();
    if (now - last > 120) { last = now; onProgress(f / frames); }
  }
  df.destroy();
  return out;
}

async function process({ id, samples, preset }) {
  const P = D.PRESETS[preset] || D.PRESETS.clear;
  const x = samples; // 48kHz モノラル Float32Array（メインスレッドで変換済み）
  const stage = (step, label, pct = 0) => post({ type: 'progress', id, step, label, pct });
  const tick = () => new Promise((r) => setTimeout(r, 0)); // 進捗表示を画面に反映させるための小休止

  stage(1, 'AIエンジンを準備しています'); await loadEngine();
  stage(2, '音割れを修復しています'); await tick();
  const lufsIn = D.integratedLoudness(x); // 処理前の音量（表示用）
  const repaired = D.declip(x);
  stage(3, 'AIでノイズを除去しています');
  const y = await denoise(x, P.attenLimit, (p) => stage(3, 'AIでノイズを除去しています', p));
  stage(4, '話し手ごとの音量差を揃えています'); await tick();
  D.level(y);
  stage(5, 'こもりを取るEQとコンプレッサーをかけています'); await tick();
  // 雑音が残りやすい帯域は持ち上げを控えめにする（静かな録音では設定どおり）
  const { eq, report: eqReport } = D.adaptEq(y, P.eq);
  D.eqChain(y, eq);
  D.compress(y);
  stage(6, '音量をPodcast標準（-16 LUFS）に合わせています'); await tick();
  const loud = D.normalizeLoudness(y, -16, -1.5);
  let peak = 0; for (let i = 0; i < y.length; i++) { const a = Math.abs(y[i]); if (a > peak) peak = a; }
  const wav = D.toWav16(y);
  post({ type: 'done', id, wav, samples: y, stats: {
    lufsBefore: lufsIn, lufsAfter: loud.after, peakDb: 20 * Math.log10(peak || 1e-9), repaired, eq: eqReport,
  } }, [wav, y.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'preload') await loadEngine();
    else if (m.type === 'process') await process(m);
  } catch (err) {
    post({ type: 'error', id: m.id, message: (err && err.message) || String(err) });
  }
};
