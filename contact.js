/**
 * お問い合わせフォーム
 *   GET  /contact, /en-contact … フォームのページを返す（スパム対策の値を差し込む）
 *   POST /api/contact          … 入力を確認してメールで届ける
 *
 * Cloudflare の管理画面で設定する値（GitHub には書かない）
 *   CONTACT_TO            届け先のメールアドレス（シークレット）
 *   CONTACT_FROM          送信元アドレス（例: form@kentonagaya.com）
 *   FORM_SECRET           フォームの改ざん防止用の合言葉（シークレット。長いランダムな文字列）
 *   TURNSTILE_SITE_KEY    Turnstile のサイトキー
 *   TURNSTILE_SECRET      Turnstile のシークレットキー（シークレット）
 */

const TOPICS = {
  web: { ja: "Webサイト制作", en: "Website" },
  rebuild: { ja: "止まったサイトの立て直し・修正", en: "Fixing or rebuilding a site" },
  marketing: { ja: "アクセス解析・改善", en: "Analytics & improvement" },
  design: { ja: "ロゴ・印刷物", en: "Logo & print" },
  bilingual: { ja: "日本語・英語をまたぐ制作", en: "Japanese / English project" },
  undecided: { ja: "まだ決まっていない", en: "Not sure yet" },
};
const BUDGETS = {
  "u10": { ja: "〜10万円", en: "Under ¥100,000" },
  "10-30": { ja: "10〜30万円", en: "¥100,000–300,000" },
  "30-50": { ja: "30〜50万円", en: "¥300,000–500,000" },
  "50+": { ja: "50万円以上", en: "Over ¥500,000" },
  "undecided": { ja: "まだ決まっていない", en: "Not decided" },
};
const TIMINGS = {
  "1m": { ja: "1ヶ月以内", en: "Within a month" },
  "3m": { ja: "2〜3ヶ月以内", en: "Within 2–3 months" },
  "6m": { ja: "半年以内", en: "Within 6 months" },
  "undecided": { ja: "時期は未定", en: "Not decided" },
};

const MSG = {
  ja: {
    invalid: "入力内容をご確認ください。お名前・メールアドレス・ご相談内容・プライバシーポリシーへの同意が必要です。",
    email: "メールアドレスの形式をご確認ください。",
    expired: "送信を確認できませんでした。お手数ですが、もう一度「送信する」を押してください。",
    robot: "スパム対策の確認ができませんでした。もう一度お試しください。",
    send: "送信に失敗しました。時間をおいてもう一度お試しいただくか、Instagramのメッセージからご連絡ください。",
  },
  en: {
    invalid: "Please check the form. Your name, email, message and agreement to the privacy policy are required.",
    email: "Please check your email address.",
    expired: "We couldn’t confirm your submission. Please press “Send” again.",
    robot: "We couldn't complete the spam check. Please try again.",
    send: "Your message couldn't be sent. Please try again later, or send a message on Instagram.",
  },
};

const enc = new TextEncoder();

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeToken(env) {
  const ts = String(Date.now());
  return ts + "." + (await hmac(env.FORM_SECRET, ts));
}

/** 改ざんされていないか、早すぎ（機械的な送信）・遅すぎないかを確かめる */
async function checkToken(env, token) {
  const [ts, sig] = String(token || "").split(".");
  if (!ts || !sig) return false;
  if (!safeEqual(sig, await hmac(env.FORM_SECRET, ts))) return false;
  const age = Date.now() - Number(ts);
  return age > 3000 && age < 2 * 60 * 60 * 1000;
}

function langOf(path) {
  return path.startsWith("/en") ? "en" : "ja";
}

/** フォームのページを返す。エラー時は入力内容を残したまま返す */
export async function renderContactPage(request, env, opts = {}) {
  const url = new URL(request.url);
  const lang = opts.lang || langOf(url.pathname);
  const pagePath = lang === "en" ? "/en-contact" : "/contact";
  const asset = await env.ASSETS.fetch(new Request(url.origin + pagePath, { headers: request.headers }));
  if (!asset.ok) return asset;

  const siteKey = env.TURNSTILE_SITE_KEY || "";
  const token = env.FORM_SECRET ? await makeToken(env) : "";
  const v = opts.values || {};

  let rw = new HTMLRewriter()
    .on(".cf-turnstile", { element(e) { siteKey ? e.setAttribute("data-sitekey", siteKey) : e.remove(); } })
    .on("script#ts-api", { element(e) { if (!siteKey) e.remove(); } })
    .on('input[name="token"]', { element(e) { token ? e.setAttribute("value", token) : e.remove(); } });

  if (opts.error) {
    rw = rw.on("#form-error", {
      element(e) { e.removeAttribute("hidden"); e.setInnerContent(MSG[lang][opts.error] || MSG[lang].invalid); },
    });
  }
  if (opts.values) {
    rw = rw
      .on("#form input", {
        element(e) {
          const name = e.getAttribute("name");
          const type = e.getAttribute("type");
          if (!name || ["hidden", "submit"].includes(type) || name === "website") return;
          if (type === "checkbox") {
            const list = v[name] || [];
            if (list.includes(e.getAttribute("value"))) e.setAttribute("checked", "");
          } else if (v[name]) {
            e.setAttribute("value", v[name]);
          }
        },
      })
      .on("#form textarea", { element(e) { const n = e.getAttribute("name"); if (v[n]) e.setInnerContent(v[n]); } })
      .on("#form select option", {
        element(e) {
          const val = e.getAttribute("value");
          if (val && (v.budget === val || v.timing === val)) e.setAttribute("selected", "");
        },
      });
  }

  const res = rw.transform(asset);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: opts.status || 200, headers });
}

function sameSite(request) {
  const host = new URL(request.url).host;
  const src = request.headers.get("Origin") || request.headers.get("Referer");
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

const clean = (s, max) => String(s || "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, " ");

/** 送信を受け付ける */
export async function handleContactPost(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  if (Number(request.headers.get("Content-Length") || 0) > 30000) return new Response("Payload Too Large", { status: 413 });

  let form;
  try { form = await request.formData(); } catch { return new Response("Bad Request", { status: 400 }); }

  const lang = form.get("lang") === "en" ? "en" : "ja";
  const thanks = new URL(lang === "en" ? "/en-thanks" : "/thanks", request.url).toString();

  // 人には見えない入力欄に何か入っていたら機械による送信。成功したように見せて捨てる
  if (clean(form.get("website"), 200)) return Response.redirect(thanks, 303);

  const values = {
    name: oneLine(form.get("name"), 100),
    company: oneLine(form.get("company"), 120),
    email: oneLine(form.get("email"), 254),
    message: clean(form.get("message"), 4000),
    topics: form.getAll("topics").map(String).filter((t) => TOPICS[t]),
    budget: BUDGETS[form.get("budget")] ? String(form.get("budget")) : "",
    timing: TIMINGS[form.get("timing")] ? String(form.get("timing")) : "",
  };
  const fail = (error, status = 400) => renderContactPage(request, env, { lang, error, values, status });

  if (env.FORM_SECRET && !(await checkToken(env, form.get("token")))) return fail("expired");
  if (!values.name || !values.email || !values.message || form.get("privacy") !== "agree") return fail("invalid");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return fail("email");

  if (env.TURNSTILE_SECRET) {
    const body = new FormData();
    body.append("secret", env.TURNSTILE_SECRET);
    body.append("response", String(form.get("cf-turnstile-response") || ""));
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) body.append("remoteip", ip);
    let ok = false;
    try {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
      ok = (await r.json()).success === true;
    } catch { ok = false; }
    if (!ok) return fail("robot");
  }

  if (!env.EMAIL || !env.CONTACT_TO) return fail("send", 500);

  const pick = (table, key) => (key ? table[key].ja : "（未選択）");
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  const text = [
    "kentonagaya.com のフォームからお問い合わせがありました。",
    "",
    "■ お名前：" + values.name,
    "■ 会社名・屋号：" + (values.company || "（未記入）"),
    "■ メールアドレス：" + values.email,
    "■ 相談したいこと：" + (values.topics.length ? values.topics.map((t) => TOPICS[t].ja).join("、") : "（未選択）"),
    "■ ご予算の目安：" + pick(BUDGETS, values.budget),
    "■ ご希望の時期：" + pick(TIMINGS, values.timing),
    "■ 言語：" + (lang === "en" ? "英語ページから" : "日本語ページから"),
    "",
    "■ ご相談内容",
    values.message,
    "",
    "---",
    "受信日時：" + now + "（日本時間）",
    "このメールに返信すると、相手に届きます。",
  ].join("\n");

  try {
    await env.EMAIL.send({
      to: env.CONTACT_TO,
      from: env.CONTACT_FROM || "form@kentonagaya.com",
      replyTo: values.email,
      subject: "【お問い合わせ】" + values.name + " 様（kentonagaya.com）",
      text,
    });
  } catch (err) {
    console.error("contact send failed", err && (err.code || err.message));
    return fail("send", 502);
  }

  return Response.redirect(thanks, 303);
}
