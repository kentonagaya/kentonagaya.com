/**
 * kentonagaya.com（Cloudflare Workers）
 * /api/note だけをこのプログラムで処理し、それ以外は静的ファイルをそのまま返す。
 */
import { onRequest as note } from "../functions/api/note.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/note") {
      return note({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    return env.ASSETS.fetch(request);
  },
};
