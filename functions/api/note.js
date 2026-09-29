/**
 * Cloudflare Pages Function
 * -------------------------------------------------
 * GET /api/note  →  noteの最新記事をJSONで返す
 *
 * noteのRSSはブラウザから直接取得できない（CORS制限）ため、
 * このサーバー側の処理を挟んで中継している。
 * レスポンスは30分キャッシュされるので、note側への負荷もない。
 *
 * 置き場所: リポジトリ直下の functions/api/note.js
 * -------------------------------------------------
 */

const FEED_URL = "https://note.com/kentonagaya/rss";
const MAX_ITEMS = 3;
const CACHE_SECONDS = 1800; // 30分

export async function onRequest(context) {
  try {
    const res = await fetch(FEED_URL, {
      headers: { "User-Agent": "kentonagaya.com (+https://kentonagaya.com)" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });

    if (!res.ok) throw new Error("upstream status " + res.status);

    const xml = await res.text();
    const items = [];
    const itemRe = /<item[\s>]([\s\S]*?)<\/item>/g;
    let m;

    while ((m = itemRe.exec(xml)) !== null && items.length < MAX_ITEMS) {
      const block = m[1];
      const link = tag(block, "link");
      if (!link) continue;
      items.push({
        title: tag(block, "title"),
        link: link,
        date: formatDate(tag(block, "pubDate")),
        image: findImage(block),
      });
    }

    return json({ items: items });
  } catch (err) {
    // 失敗してもページは壊さない。空配列を返してフロント側で非表示にする。
    return json({ items: [], error: String(err && err.message ? err.message : err) });
  }
}

/* ---------- helpers ---------- */

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=" + CACHE_SECONDS + ", s-maxage=" + CACHE_SECONDS,
    },
  });
}

/** <tag>...</tag> の中身を取り出す（CDATA・実体参照に対応） */
function tag(block, name) {
  const re = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i");
  const m = block.match(re);
  if (!m) return "";
  return decode(m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")).trim();
}

/** 属性値を取り出す（例: <media:thumbnail url="..."/>） */
function attr(block, tagName, attrName) {
  const re = new RegExp("<" + tagName + "[^>]*\\b" + attrName + "\\s*=\\s*[\"']([^\"']+)[\"']", "i");
  const m = block.match(re);
  return m ? decode(m[1]) : "";
}

/** サムネイル画像を、複数の記法から順に探す */
function findImage(block) {
  return (
    attr(block, "media:thumbnail", "url") ||
    attr(block, "media:content", "url") ||
    attr(block, "enclosure", "url") ||
    attr(block, "img", "src") ||
    ""
  );
}

/** RFC822の日付を 2026.09.29 形式に */
function formatDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate());
}

/** XMLの実体参照を戻す */
function decode(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
