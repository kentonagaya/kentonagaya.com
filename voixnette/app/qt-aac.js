// Voixnette — QuickTime / MP4 から AAC の音声トラックだけを取り出す（予備の読み込み経路）
// iPhone のボイスメモの新しい形式（.qta）は、空間オーディオのトラック（APAC）と、
// 互換用のステレオ AAC トラックの2本が入っている。ブラウザが APAC を読めずに失敗したときは、
// AAC トラックを ADTS 形式（.aac）に並べ直して、もう一度読み込む。外部依存なし。

const fourcc = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

// 箱（atom）を順に読む
function* atoms(v, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = v.getUint32(o), hdr = 8;
    const type = fourcc(v, o + 4);
    if (size === 1) { size = Number(v.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) return;
    yield { type, start: o + hdr, end: o + size };
    o += size;
  }
}
const child = (v, box, type) => { for (const a of atoms(v, box.start, box.end)) if (a.type === type) return a; return null; };
const path = (v, box, ...types) => { let b = box; for (const t of types) { b = b && child(v, b, t); } return b; };

// esds の中の AudioSpecificConfig を探す
function readEsds(v, start, end) {
  let o = start + 4; // version + flags
  const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const b = v.getUint8(o++); n = (n << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return n; };
  while (o < end) {
    const tag = v.getUint8(o++); const l = len(); const body = o;
    if (tag === 0x03) { o += 2; const f = v.getUint8(o++); if (f & 0x80) o += 2; if (f & 0x40) o += 1 + v.getUint8(o); if (f & 0x20) o += 2; continue; }
    if (tag === 0x04) { o += 13; continue; }
    if (tag === 0x05) return new Uint8Array(v.buffer, v.byteOffset + body, l);
    o = body + l;
  }
  return null;
}

function parseAsc(asc) {
  let bit = 0; const rd = (n) => { let x = 0; for (let i = 0; i < n; i++) { x = (x << 1) | ((asc[bit >> 3] >> (7 - (bit & 7))) & 1); bit++; } return x; };
  let aot = rd(5); if (aot === 31) aot = 32 + rd(6);
  const sfi = rd(4); if (sfi === 15) rd(24);
  const ch = rd(4);
  return { aot, sfi, ch };
}

/** AAC トラックを ADTS（.aac）のバイト列にして返す。見つからなければ null。 */
export function extractAacAdts(buf) {
  const v = new DataView(buf);
  let moov = null;
  for (const a of atoms(v, 0, v.byteLength)) if (a.type === 'moov') moov = a;
  if (!moov) return null;
  for (const trak of atoms(v, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(v, trak, 'mdia'); if (!mdia) continue;
    const hdlr = child(v, mdia, 'hdlr'); if (!hdlr || fourcc(v, hdlr.start + 8) !== 'soun') continue;
    const stbl = path(v, mdia, 'minf', 'stbl'); if (!stbl) continue;
    const stsd = child(v, stbl, 'stsd'); if (!stsd) continue;
    const entry = atoms(v, stsd.start + 8, stsd.end).next().value;
    if (!entry || entry.type !== 'mp4a') continue;
    // esds は mp4a の直下、または QuickTime 形式では wave の中にある。中身を走査して探す
    let asc = null;
    for (let o = entry.start; o + 8 <= entry.end && !asc; o++) {
      if (fourcc(v, o + 4) === 'esds') { const sz = v.getUint32(o); if (sz >= 12 && o + sz <= entry.end) asc = readEsds(v, o + 8, o + sz); }
    }
    if (!asc || asc.length < 2) continue;
    const { aot, sfi, ch } = parseAsc(asc);
    if (sfi > 12 || ch < 1 || ch > 7) continue;
    const profile = (aot === 5 || aot === 29 ? 2 : aot) - 1; // HE-AAC は LC として包む（復号側で SBR を自動検出）
    if (profile < 0 || profile > 3) continue;

    // サンプル表：各フレームの位置と大きさ
    const stsz = child(v, stbl, 'stsz'), stsc = child(v, stbl, 'stsc');
    const stco = child(v, stbl, 'stco'), co64 = child(v, stbl, 'co64');
    if (!stsz || !stsc || !(stco || co64)) continue;
    const uni = v.getUint32(stsz.start + 4), count = v.getUint32(stsz.start + 8);
    const sizeOf = (i) => uni || v.getUint32(stsz.start + 12 + i * 4);
    const nChunks = v.getUint32((stco || co64).start + 4);
    const chunkOff = (i) => co64 ? Number(v.getBigUint64(co64.start + 8 + i * 8)) : v.getUint32(stco.start + 8 + i * 4);
    const nRuns = v.getUint32(stsc.start + 4);
    const runs = []; for (let i = 0; i < nRuns; i++) runs.push([v.getUint32(stsc.start + 8 + i * 12) - 1, v.getUint32(stsc.start + 12 + i * 12)]);

    let total = 0; for (let i = 0; i < count; i++) total += sizeOf(i) + 7;
    const out = new Uint8Array(total), src = new Uint8Array(buf);
    let s = 0, w = 0;
    for (let c = 0, r = 0; c < nChunks && s < count; c++) {
      while (r + 1 < runs.length && runs[r + 1][0] <= c) r++;
      let off = chunkOff(c);
      for (let k = 0; k < runs[r][1] && s < count; k++, s++) {
        const n = sizeOf(s), fl = n + 7;
        if (off + n > src.length) return null;
        out[w] = 0xff; out[w + 1] = 0xf1;
        out[w + 2] = (profile << 6) | (sfi << 2) | (ch >> 2);
        out[w + 3] = ((ch & 3) << 6) | (fl >> 11);
        out[w + 4] = (fl >> 3) & 0xff;
        out[w + 5] = ((fl & 7) << 5) | 0x1f;
        out[w + 6] = 0xfc;
        out.set(src.subarray(off, off + n), w + 7);
        w += fl; off += n;
      }
    }
    if (s === 0) continue;
    return out.subarray(0, w).slice().buffer;
  }
  return null;
}
