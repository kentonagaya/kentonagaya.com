/* kentonagaya.com トップのFV「人生のタータン」
   - 柄の設計図（色＝やっていたこと／帯の中の細い縞＝その役割をした場所）
   - ポスター（Canvas2D）：three.js 読み込み前・WebGLなし・動きを減らす設定のときの絵
   - 布（three.js）：上から吊り下ろし、カーソルで重い幕を押す、スクロールで幕が上がる
   - ヘッダー：FVの上にいる間だけ html.fvt-hd（プラムのヘッダー）
   - スマホの凡例：バッジをタップで開閉
   head の小さなスクリプトが html に fvt-page / fvt-hd / fvt-drop を先に付けている */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const html = document.documentElement;
const fv = document.getElementById('fv');
window.__fvt = 1; // head の保険スクリプト用（読み込めなかったときはヘッダーを元に戻す）

if (fv) init();

function init() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('.header');
  const headH = () => (header ? header.offsetHeight : 72);

  /* ---------- ヘッダー：FVの上にいる間はプラム ---------- */
  let hdTick = false;
  function hdUpdate() {
    hdTick = false;
    html.classList.toggle('fvt-hd', fv.getBoundingClientRect().bottom > headH());
    // 吊り輪は布がレールに掛かっている（ほぼスクロール前の）間だけ。スクロール後は札の上に重ならないよう隠す
    html.classList.toggle('fvt-moved', (window.scrollY || 0) > 24);
  }
  addEventListener('scroll', () => { if (!hdTick) { hdTick = true; requestAnimationFrame(hdUpdate); } }, { passive: true });
  addEventListener('resize', hdUpdate, { passive: true });
  hdUpdate();

  /* ---------- スマホの凡例：開閉 ---------- */
  const sett = fv.querySelector('.fvt-sett');
  const toggle = fv.querySelector('.fvt-sett-toggle');
  if (sett && toggle) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      sett.classList.toggle('is-open', open);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && sett.classList.contains('is-open')) { toggle.click(); toggle.focus(); }
    });
  }

  /* ==== 柄の設計図（ポスター・GLで共有）====
     色＝やっていたこと（役割）／帯の中の細い縞＝その役割をした場所（1場所＝1本）
     縞と縞の間＝K（深いインク）の細いガード／地のプラム P＝自分自身
     ピボット（/）で折り返す対称のsett。経糸と緯糸に同じ設計図。
     凡例（index.html）の色見本・場所の数・スレッドカウントはこの並びと一致させること */
  const ROLES = [ // 並び＝ピボット1（中心）から外へ
    { code: 'R', role: 'Web designer', col: '#E4689B', w: 14, places: ['Osaka, Japan', 'Tbilisi, Georgia', 'Saint-Rémy-de-Provence, France', 'Paris, France'] },
    { code: 'LV', role: 'Restaurant staff', col: '#A08FC6', w: 6, places: ['Saint-Rémy-de-Provence, France', 'Paris, France'] },
    { code: 'DB', role: 'Server engineer', col: '#2B89B0', cap: '#4FA6CC', w: 10, places: ['Tokyo, Japan', 'Manila, Philippines'] },
    { code: 'W', role: 'Student', col: '#F1ECE2', w: 3, places: ['Tokyo, Japan', 'Cebu, Philippines', 'Lyon, France'] },
    { code: 'LB', role: 'IT consultant', col: '#80CBE1', w: 10, places: ['Tokyo, Japan'] },
    { code: 'PK', role: 'Guesthouse staff', col: '#ECB4C8', w: 4, places: ['Osaka, Japan', 'Okinawa, Japan'] }
  ];
  const PG = { code: 'P', col: '#2A1430' }, KG = { code: 'K', col: '#22102A' };
  const PIVOT = 16, GAP = 8, GUARD = 2;
  const half = [{ c: PG, n: PIVOT, r: -1, p: -1, pv: 1 }];
  ROLES.forEach((r, ri) => {
    r.places.forEach((pl, pi) => {
      if (pi > 0) half.push({ c: KG, n: GUARD, r: -1, p: -1 });
      half.push({ c: r, n: r.w, r: ri, p: pi });
    });
    half.push(ri < ROLES.length - 1 ? { c: PG, n: GAP, r: -1, p: -1 } : { c: PG, n: PIVOT, r: -1, p: -1, pv: 1 });
  });
  const blocks = half.concat(half.slice(1, -1).reverse());
  const thread = [];
  blocks.forEach(b => { for (let k = 0; k < b.n; k++) thread.push({ r: b.r, p: b.p, col: b.c.col }); });
  const hex = c => [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
  const S = { roles: ROLES, thread, rgb: thread.map(t => hex(t.col)), N: thread.length };
  const tcText = half.map(b => b.c.code + (b.pv ? '/' : '') + b.n).join(' ');
  const tcEl = fv.querySelector('.fvt-tc');
  if (tcEl && !tcEl.textContent.trim()) tcEl.textContent = tcText;

  // 布の座標 → 糸の番号（GL・Canvasで共通の写像）。ピボット1の中心が画面の 62% / 42%（スマホ 16% / 30%）付近
  S.map = function (W, H, mobile) {
    const head = headH();
    const tp = mobile ? 2.2 : 3.6, clothW = W * (mobile ? 1.22 : 1.3), gather = mobile ? 0.94 : 0.95;
    const clothH = mobile ? innerHeight * 0.55 - head + 44 : H - head + 96;
    const top = head - 4, px = PIVOT / 2;
    const u0 = (W * (mobile ? 0.16 : 0.62) - W / 2 + clothW * gather / 2) / (clothW * gather);
    const offX = px - u0 * clothW / tp;
    const offY = px - (H * (mobile ? 0.3 : 0.42) - top) / tp;
    const PINN = mobile ? 7 : 11, BAY = mobile ? 7 : 9;
    return { sag: mobile ? 4 : 9, tp, clothW, clothH, gather, top, offX, offY, nx: clothW / tp, ny: clothH / tp, PINN, BAY,
      // 吊り点の間のゆったりした縦ひだの深さ（px）。ギャザーぶんの長さを前後に逃がした量
      fold: Math.sqrt(1 - gather) * (clothW / ((PINN - 1) * BAY)) * BAY * 0.9 };
  };
  const idx = t => ((Math.floor(t) % S.N) + S.N) % S.N;

  /* ---------- 吊り輪（ヘッダーの下端＝レール）---------- */
  let rail = null;
  function placeRings(W, M) {
    if (!header) return;
    if (!rail) {
      rail = document.createElement('div');
      rail.className = 'fvt-rail';
      rail.setAttribute('aria-hidden', 'true');
      header.appendChild(rail);
    }
    rail.textContent = '';
    for (let p = 0; p < M.PINN; p++) {
      const r = document.createElement('i');
      r.className = 'fvt-ring';
      r.style.left = (W / 2 + M.gather * M.clothW * (-0.5 + p / (M.PINN - 1))).toFixed(1) + 'px';
      rail.appendChild(r);
    }
  }

  /* ---------- ポスター（Canvas2D）：降り切った状態の布 ---------- */
  const cv = fv.querySelector('.fvt-poster');
  // 光の向きと陰影（GLのシェーダーと同じ式。ひだの谷を暗く、光の側を明るく）
  const L = (() => { const v = [-0.86, 0.3, 0.42], n = Math.hypot(...v); return v.map(x => x / n); })();
  function drawPoster() {
    const W = fv.clientWidth, H = fv.clientHeight, s = Math.min(devicePixelRatio || 1, 1.25), mobile = W <= 768;
    const M = S.map(W, H, mobile);
    cv.width = Math.round(W * s); cv.height = Math.round(H * s);
    const ctx = cv.getContext('2d'), img = ctx.createImageData(cv.width, cv.height), d = img.data;
    const bottom = M.top + M.clothH, zoneB = mobile ? innerHeight * 0.55 + 40 : H;
    // 縦ひだ：吊り点の間（1ベイ）で手前にふくらむ。x方向の傾きから法線を作り、GLと同じ光で陰影をつける
    const bayW = M.gather * M.clothW / (M.PINN - 1), x0 = W / 2 - M.gather * M.clothW / 2;
    const foldShade = new Float32Array(Math.ceil(W) + 2);
    for (let x = 0; x < foldShade.length; x++) {
      const t = (x - x0) / bayW, b = Math.floor(t), f = t - b, amp = M.fold * (((b % 2) + 2) % 2 ? 0.8 : 1.15);
      const z = Math.sin(Math.PI * f) ** 2 * amp, dz = Math.PI / bayW * Math.sin(2 * Math.PI * f) * amp;
      const nl = Math.hypot(dz, 1), nx = -dz / nl, nz = 1 / nl;
      const w = Math.min(1, Math.max(0, (nx * L[0] + nz * L[2] + 0.12) / 1.12));
      const sheen = Math.pow(1 - Math.min(1, Math.max(0, nz)), 2.2);
      const ao = Math.min(1.12, Math.max(0.4, 1 + (z - 20) * 0.009));
      foldShade[x] = (0.24 + 1.22 * w) * ao + sheen * 0.55;
    }
    // 平均の明るさは元の平らな布と同じに（陰影の差だけを足す）
    let mean = 0; for (let x = 0; x < foldShade.length; x++) mean += foldShade[x];
    mean /= foldShade.length;
    // 平らな絵は動かない分だけ強く見えるので、差は8割に
    for (let x = 0; x < foldShade.length; x++) foldShade[x] = 1 + (foldShade[x] / mean - 1) * 0.8;
    for (let py = 0; py < cv.height; py++) {
      const y = py / s;
      const ty = (y - M.top - M.sag) / M.tp + M.offY, cy = Math.floor(ty), fy = ty - cy, wy = idx(ty);
      const hy = bottom - y;
      for (let px = 0; px < cv.width; px++) {
        const o = (py * cv.width + px) * 4, x = px / s;
        if (y > zoneB) { d[o] = 42; d[o + 1] = 20; d[o + 2] = 48; d[o + 3] = 255; continue; }
        const u = (x - W / 2 + M.clothW * M.gather / 2) / (M.clothW * M.gather);
        const tx = u * M.nx + M.offX, cx = Math.floor(tx), fx = tx - cx, wx = idx(tx);
        const up = ((cx + cy) % 4 + 4) % 4 < 2, a = S.rgb[up ? wx : wy], b = S.rgb[up ? wy : wx];
        const sh = 0.8 + 0.2 * Math.sin(Math.PI * (up ? fx : fy));
        const n = 0.95 + ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.08;
        let k = 0.82 * sh * n * foldShade[Math.min(foldShade.length - 1, Math.max(0, Math.round(x)))];
        if (hy < 28) { k *= 0.5 + 0.5 * hy / 28; if (hy < 4) k *= 0.55 + 0.45 * hy / 4; }
        const r = a[0] * 0.9 + b[0] * 0.1, g = a[1] * 0.9 + b[1] * 0.1, bl = a[2] * 0.9 + b[2] * 0.1, l = r * 0.299 + g * 0.587 + bl * 0.114;
        d[o] = (l + (r - l) * 0.93) * k; d[o + 1] = (l + (g - l) * 0.93) * k; d[o + 2] = (l + (bl - l) * 0.93) * k; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    placeRings(W, M);
    return M.top + M.clothH + 10;
  }
  const dropDist = drawPoster();

  /* 吊り下ろしの時間軸（GL側と共有）：cubic-bezier(.45,0,.12,1) で終わりをゆっくり */
  function bez(x1, y1, x2, y2) {
    const cb = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
    return x => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (cb(x1, x2, t) < x) lo = t; else hi = t; } return cb(y1, y2, t); };
  }
  const ease = bez(0.45, 0, 0.12, 1);
  const DROP = { on: html.classList.contains('fvt-drop'), t0: performance.now() + 150, dur: 1700, D: dropDist,
    e(now) { if (!this.on) return 1; const p = (now - this.t0) / this.dur; return p <= 0 ? 0 : p >= 1 ? 1 : ease(p); } };
  if (DROP.on) {
    (function tick(now) {
      if (html.classList.contains('fvt-ready')) return; // GLが引き継いだら止める
      const e = DROP.e(now);
      cv.style.transform = 'translateY(' + (-(1 - e) * DROP.D).toFixed(1) + 'px)';
      if (e < 1) requestAnimationFrame(tick); else html.classList.add('fvt-landed');
    })(performance.now());
  } else {
    html.classList.add('fvt-landed');
  }

  /* ---------- 糸 → キャプション（GL・Canvas共通）---------- */
  const cap = document.getElementById('fvt-cap');
  const lis = fv.querySelectorAll('.fvt-roles li');
  let last = -2;
  function caption(tw, tf) {
    if (!cap) return;
    const a = S.thread[idx(tw)], b = S.thread[idx(tf)], t = (a.r >= 0) ? a : b; // 経糸を優先、地なら緯糸
    const key = t.r < 0 ? -1 : t.r * 10 + t.p; if (key === last) return; last = key;
    lis.forEach((li, i) => li.classList.toggle('on', t.r === i));
    if (t.r < 0) { cap.innerHTML = '<b>Ground</b> · Kento Nagaya'; cap.style.color = '#c9a6d2'; return; }
    const r = S.roles[t.r]; cap.innerHTML = '<b>' + r.role + '</b> · ' + r.places[t.p]; cap.style.color = r.cap || r.col; // 深い水色は文字だとAA未満なので明るい版
  }
  // WebGLなし・読み込み前：平らな布の上でもキャプションを出す
  fv.addEventListener('pointermove', e => {
    if (html.classList.contains('fvt-ready')) return;
    const W = fv.clientWidth, H = fv.clientHeight, M = S.map(W, H, W <= 768), rc = fv.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    if (y < M.top || y > M.top + M.clothH) return;
    const u = (x - W / 2 + M.clothW * M.gather / 2) / (M.clothW * M.gather);
    caption(u * M.nx + M.offX, (y - M.top - M.sag) / M.tp + M.offY);
  }, { passive: true });

  /* ---------- 画面サイズの変化：描き直す（スマホは幅が変わったときだけ。アドレスバーの出入りでは描き直さない）---------- */
  let sizeW = fv.clientWidth, sizeH = innerHeight, rz = 0, gl = null;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const W = fv.clientWidth, mobile = W <= 768;
      if (W === sizeW && (mobile || Math.abs(innerHeight - sizeH) < 40)) return;
      sizeW = W; sizeH = innerHeight;
      DROP.on = false; html.classList.remove('fvt-drop'); html.classList.add('fvt-landed'); cv.style.transform = 'none';
      drawPoster();
      if (gl) { gl.destroy(); gl = null; }
      if (window.__fvtGL) launch(false);
    }, 250);
  }, { passive: true });

  function fail(e) { console.warn('[fv-tartan]', e); html.classList.remove('fvt-has-gl', 'fvt-ready'); }
  // 作り直しが重なったときは、最後に始めたものだけを残す
  let gen = 0;
  function launch(first) {
    const my = ++gen;
    start(first).then(g => { if (my !== gen) { g.destroy(); return; } gl = g; }).catch(fail);
  }
  if (window.__fvtGL) launch(true);

  /* ==== 布（three.js）==== */
  async function start(first) {
    const THREE = await import(THREE_URL);
    const W = fv.clientWidth, H = fv.clientHeight;
    const mobile = W <= 768;
    const DPR = Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    const M = S.map(W, H, mobile);
    const ac = new AbortController(), sig = { passive: true, signal: ac.signal };
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DPR); renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const host = fv.querySelector('.fvt-gl');
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -3000, 3000);
    cam.position.z = 1000;

    // ---- 布の寸法（px単位）----
    // 吊り点：PC 11点・スマホ 7点。吊り点の間隔＝布幅の95%（スマホ94%）→ ギャザーは浅く
    const PINN = M.PINN, BAY = M.BAY;
    const NX = (PINN - 1) * BAY + 1, NY = mobile ? 26 : 50;
    const clothW = M.clothW, clothH = M.clothH;
    const top = H / 2 - M.top;
    const dx = clothW / (NX - 1), dy = clothH / (NY - 1);
    const n = NX * NY;
    const P = new Float32Array(n * 3), Q = new Float32Array(n * 3), R0 = new Float32Array(n * 3);
    const pin = new Uint8Array(n), pinT = new Float32Array(n * 3);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = (j * NX + i) * 3;
      P[k] = (-clothW / 2 + i * dx) * M.gather; P[k + 1] = top - j * dy; P[k + 2] = 0;
    }
    // 拘束：構造（1）＋せん断（.5）＋曲げ（2つ先との距離、.55）＝細かいシワを出さず、大きなひだだけ
    const C = [];
    const rest = (a, b) => Math.hypot((a % NX - b % NX) * dx, (Math.floor(a / NX) - Math.floor(b / NX)) * dy);
    const add = (a, b, s) => C.push(a, b, rest(a, b), s);
    const BEND = 0.55;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = j * NX + i;
      if (i < NX - 1) add(a, a + 1, 1); if (j < NY - 1) add(a, a + NX, 1);
      if (i < NX - 1 && j < NY - 1) { add(a, a + NX + 1, 0.5); add(a + 1, a + NX, 0.5); }
      if (i < NX - 2) add(a, a + 2, BEND); if (j < NY - 2) add(a, a + 2 * NX, BEND);
    }
    const CA = new Float32Array(C);
    const FOLD = M.fold;
    const PINS = [...Array(PINN)].map((_, p) => p * BAY);
    PINS.forEach(i => { pin[i] = 1; pinT[i * 3] = P[i * 3]; pinT[i * 3 + 1] = top; pinT[i * 3 + 2] = 0; });
    // ギャザーのたるみは前後（z）に逃がす：上から裾まで続く、ゆったりした縦ひだ
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = (j * NX + i) * 3, s = Math.sin(Math.PI * (i % BAY) / BAY), b = Math.floor(i / BAY);
      P[k + 2] = s * s * FOLD * (b % 2 ? 0.8 : 1.15) * (1 - 0.25 * j / NY);
    }
    Q.set(P);

    // ---- メッシュ ----
    const geo = new THREE.PlaneGeometry(clothW, clothH, NX - 1, NY - 1);
    const pos = geo.attributes.position;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(clothW, clothH) * 2);
    const N = S.N, tex = new Uint8Array(N * 4);
    S.rgb.forEach((c, i) => { tex[i * 4] = c[0]; tex[i * 4 + 1] = c[1]; tex[i * 4 + 2] = c[2]; tex[i * 4 + 3] = 255; });
    const settTex = new THREE.DataTexture(tex, N, 1, THREE.RGBAFormat);
    settTex.magFilter = settTex.minFilter = THREE.NearestFilter; settTex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uSett: { value: settTex }, uN: { value: N }, uThreads: { value: new THREE.Vector2(M.nx, M.ny) },
        uOff: { value: new THREE.Vector2(M.offX, M.offY) }, uCloth: { value: new THREE.Vector2(clothW, clothH) },
        uL: { value: new THREE.Vector3(L[0], L[1], L[2]) } },
      vertexShader: `
        varying vec2 vUv; varying vec3 vN; varying float vZ;
        void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vZ=position.z;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uSett; uniform float uN; uniform vec2 uThreads; uniform vec2 uOff; uniform vec2 uCloth; uniform vec3 uL;
        varying vec2 vUv; varying vec3 vN; varying float vZ;
        float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
        vec3 col(float i){return texture2D(uSett,vec2((mod(i,uN)+.5)/uN,.5)).rgb;}
        void main(){
          vec2 t=vec2(vUv.x*uThreads.x+uOff.x,(1.-vUv.y)*uThreads.y+uOff.y);
          vec2 c=floor(t), f=fract(t);
          vec3 warp=col(c.x), weft=col(c.y);
          bool up=mod(c.x+c.y,4.)<2.;            // 2/2の綾織り
          vec3 base=up?warp:weft, other=up?weft:warp;
          float across=up?f.x:f.y;
          float prof=.80+.20*sin(3.14159*across);
          // 繊維：糸の向きに伸びたノイズ（起毛のムラ）
          vec2 fp=up?vec2(t.x*5.,t.y*1.2):vec2(t.x*1.2,t.y*5.);
          float fib=.93+.14*vn(fp*2.);
          // ウールのにじみ：交差する糸の色が少し混ざる／ほんの少しくすませる
          base=mix(base,other,.10);
          float lum=dot(base,vec3(.299,.587,.114));
          base=mix(vec3(lum),base,.93);
          vec3 c0=base*prof*fib;
          // 光：横から低く当てる回り込み拡散＋ベルベット風シーン＋ひだの谷の陰
          // （静止していても縦のひだが読めるよう、光の角度を寝かせ、谷を深めに）
          vec3 Nn=normalize(vN); if(!gl_FrontFacing) Nn=-Nn;
          float w=clamp((dot(Nn,uL)+.12)/1.12,0.,1.);
          float sheen=pow(1.-clamp(Nn.z,0.,1.),2.2);
          float ao=clamp(1.+(vZ-20.)*.009,.4,1.12);
          vec3 lit=c0*(.24+1.22*w)*ao + sheen*(c0*.55+vec3(.05,.04,.06));
          // 裾：厚みのある三つ折りの影
          float hy=vUv.y*uCloth.y;
          lit*=.5+.5*smoothstep(0.,28.,hy);
          lit+=c0*.16*exp(-pow((hy-13.)/4.,2.));
          lit*=mix(.5,1.,smoothstep(0.,4.,hy));
          gl_FragColor=vec4(lit,1.);
        }`
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // ---- 物理（Verlet＋位置拘束、固定時間刻み 1/60秒）----
    const G = 900, H_STEP = 1 / 60, ITER = mobile ? 8 : 12;
    const DAMP = 0.95, DAMP_CALM = 0.9;
    let damp = DAMP;
    const g = G * H_STEP * H_STEP;
    // 形の記憶：厚手のウールは押されても吊られた形にゆっくり戻る（跳ね返らない）
    const MEM = 0.02; let mem = false;
    let scrollP = 0, press = 0;
    function step() {
      for (let k = 0; k < n; k++) {
        const i = k * 3;
        if (pin[k]) { P[i] = pinT[i]; P[i + 1] = pinT[i + 1]; P[i + 2] = pinT[i + 2]; Q[i] = P[i]; Q[i + 1] = P[i + 1]; Q[i + 2] = P[i + 2]; continue; }
        const x = P[i], y = P[i + 1], z = P[i + 2];
        P[i] += (x - Q[i]) * damp; P[i + 1] += (y - Q[i + 1]) * damp - g; P[i + 2] += (z - Q[i + 2]) * damp;
        Q[i] = x; Q[i + 1] = y; Q[i + 2] = z;
      }
      if (press > 0.002) applyPalm();
      if (mem && scrollP <= 0.001) {
        const km = MEM * (1 - 0.85 * press);
        for (let k = NX; k < n; k++) { if (pin[k]) continue; const i = k * 3; P[i] += (R0[i] - P[i]) * km; P[i + 1] += (R0[i + 1] - P[i + 1]) * km; P[i + 2] += (R0[i + 2] - P[i + 2]) * km; }
      }
      for (let it = 0; it < ITER; it++) {
        for (let c = 0; c < CA.length; c += 4) {
          const ia = CA[c], ib = CA[c + 1], pa = pin[ia], pb = pin[ib];
          if (pa && pb) continue;
          const a = ia * 3, b = ib * 3, rl = CA[c + 2], s = CA[c + 3];
          const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
          const dd = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-6;
          const diff = (dd - rl) / dd * 0.5 * s;
          const ka = pa ? 0 : (pb ? 2 : 1), kb = pb ? 0 : (pa ? 2 : 1);
          P[a] += ex * diff * ka; P[a + 1] += ey * diff * ka; P[a + 2] += ez * diff * ka;
          P[b] -= ex * diff * kb; P[b + 1] -= ey * diff * kb; P[b + 2] -= ez * diff * kb;
        }
        // 上端（芯の入ったヘッダーテープ）：縦にはほとんど垂れない＝スカラップごく浅く
        for (let i = 0; i < NX; i++) { if (!pin[i]) P[i * 3 + 1] += (top - P[i * 3 + 1]) * 0.5; }
      }
      for (let k = 0; k < n; k++) { const i = k * 3 + 2; if (P[i] < -160) P[i] = -160; }
    }
    function energy() { let e = 0; for (let i = 0; i < n * 3; i++) { const v = P[i] - Q[i]; e += v * v; } return e / n; }
    function upload() { pos.array.set(P); pos.needsUpdate = true; geo.computeVertexNormals(); }

    // ---- 手のひらで重い幕を押す：平滑化したカーソル・ガウス分布の柔らかい範囲・上限のある力 ----
    const ptr = { x: 0, y: 0, on: false, touch: false, t: 0, vx: 0, vy: 0 };
    const palm = { x: 0, y: 0, vx: 0, vy: 0, init: false };
    const SIG = mobile ? W * 0.2 : Math.min(W * 0.1, 150), SIG2 = 2 * SIG * SIG, RCUT2 = 9 * SIG * SIG;
    const DEPTH = mobile ? 0 : 80;
    function updatePalm() {
      if (ptr.on) {
        if (!palm.init) { palm.x = ptr.x; palm.y = ptr.y; palm.init = true; }
        palm.x += (ptr.x - palm.x) * 0.11; palm.y += (ptr.y - palm.y) * 0.11;
      }
      palm.vx += (ptr.vx - palm.vx) * 0.07; palm.vy += (ptr.vy - palm.vy) * 0.07;
      ptr.vx *= 0.86; ptr.vy *= 0.86;
      const sp = Math.hypot(palm.vx, palm.vy);
      const target = ptr.on ? Math.min(1, 0.3 + sp / 14) : 0;
      press += (target - press) * (target > press ? 0.05 : 0.018);
    }
    function applyPalm() {
      const svx = Math.max(-6, Math.min(6, palm.vx)), svy = Math.max(-4, Math.min(4, palm.vy));
      for (let k = NX; k < n; k++) {
        if (pin[k]) continue;
        const i = k * 3, ex = P[i] - palm.x, ey = P[i + 1] - palm.y, d2 = ex * ex + ey * ey;
        if (d2 > RCUT2) continue;
        const w = Math.exp(-d2 / SIG2) * press;
        if (ptr.touch || mobile) { P[i] += svx * w * 0.12; continue; } // タッチは横方向だけ
        const tz = -DEPTH * w;
        if (P[i + 2] > tz) P[i + 2] += (tz - P[i + 2]) * Math.min(0.06, 0.1 * w);
        P[i] += svx * w * 0.05; P[i + 1] += svy * w * 0.025;
      }
    }

    // ---- 降り切った形を先に計算（最初から完成した布）。8msごとに手放して、ポスターの降下をカクつかせない ----
    damp = 0.86;
    let tb = performance.now();
    for (let s = 0, S_ = mobile ? 140 : 170; s < S_; s++) { step(); if (performance.now() - tb > 8) { await new Promise(r => setTimeout(r, 0)); tb = performance.now(); } }
    damp = DAMP;
    for (let i = 0; i < n * 3; i++) Q[i] = P[i];
    R0.set(P); mem = true;
    upload();

    // ---- 入力 ----
    let awake = true, calm = 0, visible = true, raf = 0, landed = false, landT = 0, lastInput = 0, hoverQ = false, dead = false;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function wake() { calm = 0; lastInput = performance.now(); if (reduce || dead) return; if (!awake) { awake = true; loop(); } }
    fv.addEventListener('pointermove', e => {
      const r = fv.getBoundingClientRect(), x = e.clientX - r.left - W / 2, y = H / 2 - (e.clientY - r.top);
      const now = performance.now(), dt = Math.max(8, now - ptr.t);
      if (ptr.on && now - ptr.t < 120) { ptr.vx = (x - ptr.x) / dt * 16.7; ptr.vy = (y - ptr.y) / dt * 16.7; }
      ptr.x = x; ptr.y = y; ptr.t = now; ptr.on = true; ptr.touch = e.pointerType === 'touch';
      ndc.set((e.clientX - r.left) / W * 2 - 1, -((e.clientY - r.top) / H * 2 - 1)); hoverQ = true;
      if (landed) wake(); if (!awake || reduce) pickCaption();
    }, sig);
    fv.addEventListener('pointerleave', () => { ptr.on = false; if (landed) wake(); }, sig);
    function pickCaption() {
      hoverQ = false;
      if (!ptr.on) return;
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit || !hit.uv) return;
      caption(hit.uv.x * M.nx + M.offX, (1 - hit.uv.y) * M.ny + M.offY);
    }
    // スクロール：布の下端の両角が持ち上がって幕が上がる
    const BL = (NY - 1) * NX, BR = n - 1;
    function applyScroll() {
      if (scrollP <= 0.001) { if (pin[BL]) { pin[BL] = 0; pin[BR] = 0; } return; }
      const lift = scrollP * clothH * 1.05;
      [BL, BR].forEach(k => { pin[k] = 1; const i = k * 3; pinT[i] = R0[i]; pinT[i + 1] = R0[i + 1] + lift; pinT[i + 2] = 40 * scrollP; });
    }
    const onScroll = () => { scrollP = Math.min(1, Math.max(0, scrollY / (H * 0.9))); if (landed && !reduce) wake(); };
    addEventListener('scroll', onScroll, sig); onScroll();
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && awake) loop(); });
    io.observe(fv);

    html.classList.add('fvt-has-gl');
    // ポスターからの引き継ぎ：GLの1コマ目が描けてからポスターを隠す
    const handoff = () => requestAnimationFrame(() => { if (!dead) html.classList.add('fvt-ready'); });

    const api = {
      destroy() {
        dead = true; cancelAnimationFrame(raf); ac.abort(); io.disconnect();
        html.classList.remove('fvt-ready');
        geo.dispose(); mat.dispose(); settTex.dispose(); renderer.dispose();
        renderer.domElement.remove();
      }
    };

    // ---- 動きを減らす：降り切った状態の1コマ（スクロールで幕も上げない）----
    if (reduce) {
      renderer.render(scene, cam); handoff(); html.classList.add('fvt-landed');
      awake = false; landed = true;
      return api;
    }

    // ---- 吊り下ろし：吊り点ごと布を上から降ろす（GL読み込み時点の進み具合から合流）----
    function placeDrop(now) {
      const e = DROP.e(now), e2 = DROP.e(now + 16.7), off = (1 - e) * DROP.D, spd = (e2 - e) * DROP.D;
      for (let j = 0; j < NY; j++) {
        const jf = j / (NY - 1), bz = -spd * 2.2 * jf * jf; // 降りる速さに応じて裾が少し後ろへなびく
        for (let i = 0; i < NX; i++) { const k = (j * NX + i) * 3; P[k] = R0[k]; P[k + 1] = R0[k + 1] + off; P[k + 2] = R0[k + 2] + bz; }
      }
      Q.set(P);
      return e;
    }
    function land(swing) {
      landed = true; landT = performance.now();
      for (let i = 0; i < n * 3; i++) P[i] = R0[i];
      Q.set(P);
      // 重さで裾が一度だけゆったり前へ振れる。ポスターが先に着地していたら揺らさない
      if (swing) for (let j = 1; j < NY; j++) {
        const jf = j / (NY - 1), v = 3.2 * Math.pow(jf, 1.6);
        for (let i = 0; i < NX; i++) { const k = (j * NX + i) * 3 + 2; Q[k] = P[k] - v; }
      }
      html.classList.add('fvt-landed');
    }

    function loop() { if (dead) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
    let lastNow = performance.now(), acc = 0;
    function frame(now) {
      if (dead) return;
      if (!visible) { awake = true; return; }
      const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
      if (!landed) {
        const e = placeDrop(now);
        upload();
        if (e >= 1) land(true);
      } else {
        acc += dt; let steps = 0;
        updatePalm();
        applyScroll();
        // 操作がなく、着地から2.4秒経ったら空気抵抗を上げて静める
        damp = (now - landT > 2400 && now - lastInput > 1500) ? DAMP_CALM : DAMP;
        while (acc >= H_STEP && steps < 3) { step(); acc -= H_STEP; steps++; if (steps > 1) updatePalm(); }
        if (steps === 3) acc = 0;
        if (steps) upload();
        if (hoverQ) pickCaption();
        const e = energy();
        const settling = Math.abs(press - (ptr.on ? Math.min(1, 0.3 + Math.hypot(palm.vx, palm.vy) / 14) : 0)) > 0.01 || (ptr.on && Math.abs(palm.x - ptr.x) + Math.abs(palm.y - ptr.y) > 1);
        if (e < 0.004 && now - landT > 1500 && !settling) calm += dt; else calm = 0;
      }
      renderer.render(scene, cam);
      if (calm > 1.2) { awake = false; return; } // 落ち着いたら止める
      raf = requestAnimationFrame(frame);
    }
    if (!first) DROP.on = false;
    const nowT = performance.now();
    if (DROP.e(nowT) >= 1) land(first && DROP.on && DROP.e(nowT - 300) < 1); else placeDrop(nowT);
    upload(); renderer.render(scene, cam); handoff();
    loop();
    return api;
  }
}
