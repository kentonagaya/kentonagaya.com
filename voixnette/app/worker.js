// Voixnette — 処理用ワーカー（画面を固まらせないよう、重い処理はすべてここで行う）
import * as D from './dsp.js';
import { spectralNR } from './nr.js';

// 雑音除去は nr.js（録音から雑音の型を自動で測る、スペクトル方式のノイズリダクション）。
// 以前のAIエンジン（DeepFilterNet3）は、静かな録音で声の語尾を切ったりザラつかせたりしたため使っていない。
const post = (m, t) => self.postMessage(m, t || []);

async function process({ id, samples, preset }) {
  const P = D.PRESETS[preset] || D.PRESETS.clear;
  const x = samples; // 48kHz モノラル Float32Array（メインスレッドで変換済み）
  const stage = (step, label, pct = 0) => post({ type: 'progress', id, step, label, pct });
  const tick = () => new Promise((r) => setTimeout(r, 0)); // 進捗表示を画面に反映させるための小休止

  stage(2, '音割れを修復しています'); await tick();
  const lufsIn = D.integratedLoudness(x); // 処理前の音量（表示用）
  const repaired = D.declip(x);
  stage(3, '雑音を取り除いています'); await tick();
  const y = spectralNR(x, P.nr, (p) => stage(3, '雑音を取り除いています', p));
  stage(4, '話し手ごとの音量差を揃えています'); await tick();
  D.level(y, ...D.DYNAMICS.level);
  stage(5, 'こもりを取るEQとコンプレッサーをかけています'); await tick();
  // 録音ごとに声のスペクトルを測り、こもりを自動で補正する（雑音の多い帯域は持ち上げを控えめに）
  const { eq, report: eqReport } = D.tonalEq(y, P.tonal);
  D.eqChain(y, eq);
  D.compress(y, D.DYNAMICS.comp);
  stage(6, '音量をPodcast標準（-16 LUFS）に合わせています'); await tick();
  const loud = D.normalizeLoudness(y, D.DYNAMICS.lufs, D.DYNAMICS.truePeakDb);
  let peak = 0; for (let i = 0; i < y.length; i++) { const a = Math.abs(y[i]); if (a > peak) peak = a; }
  const wav = D.toWav16(y);
  post({ type: 'done', id, wav, samples: y, stats: {
    lufsBefore: lufsIn, lufsAfter: loud.after, peakDb: 20 * Math.log10(peak || 1e-9), repaired, eq: eqReport,
  } }, [wav, y.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'preload') post({ type: 'engine', ready: true }); // 読み込むエンジンはもうない（すぐ準備完了）
    else if (m.type === 'process') await process(m);
  } catch (err) {
    post({ type: 'error', id: m.id, message: (err && err.message) || String(err) });
  }
};
