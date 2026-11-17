/**
 * kentonagaya.com（Cloudflare Workers）
 * /api/note・お問い合わせフォーム（トップページ・/contact）だけをこのプログラムで処理し、それ以外は静的ファイルをそのまま返す。
 */
import { onRequest as note } from "../functions/api/note.js";
import { renderContactPage, handleContactPost } from "./contact.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/note") {
      return note({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    if (path === "/api/contact") {
      return handleContactPost(request, env);
    }
    // トップページ下部のフォームにも、送信用の確認値（トークン）を差し込む
    if (path === "/" && request.method === "GET") {
      return renderContactPage(request, env, { lang: "ja", page: "/" });
    }
    if ((path === "/contact" || path === "/en-contact") && request.method === "GET") {
      return renderContactPage(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
