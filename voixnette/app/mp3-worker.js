// Voixnette — MP3 書き出し用ワーカー（lamejs / LGPL-3.0）
importScripts('lame.min.js');

self.onmessage = (e) => {
  const { id, pcm, sampleRate, kbps } = e.data; // pcm: Int16Array（モノラル）
  try {
    const enc = new lamejs.Mp3Encoder(1, sampleRate, kbps);
    const chunks = [];
    const block = 1152 * 20;
    let last = 0;
    for (let i = 0; i < pcm.length; i += block) {
      const out = enc.encodeBuffer(pcm.subarray(i, Math.min(i + block, pcm.length)));
      if (out.length) chunks.push(new Uint8Array(out));
      const now = Date.now();
      if (now - last > 150) { last = now; self.postMessage({ type: 'progress', id, pct: i / pcm.length }); }
    }
    const end = enc.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    self.postMessage({ type: 'done', id, blob });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err && err.message) || String(err) });
  }
};
