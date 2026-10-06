/* ============================================================
   kentonagaya.com  main.js
   3ページ共通の動き。

   方針
   - 動きは「読む順番を案内する」ためだけに使う
   - JSが動かなくても、全文がそのまま読める（.js クラスが無い時は何も隠さない）
   - OSの「視差効果を減らす」設定がオンなら、動きは全部止める
   ============================================================ */
(function () {
  window.__kn = 1; // head 内の保険スクリプトに「読み込めた」ことを知らせる

  var d = document;
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- メニュー（スマートフォン） ---------- */
  var burger = d.querySelector('.burger');
  if (burger) {
    burger.addEventListener('click', function () {
      var open = d.body.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open);
    });
  }
  $$('.gnav a').forEach(function (a) {
    a.addEventListener('click', function () { d.body.classList.remove('nav-open'); });
  });

  /* ---------- 画像が無いときは枠のグラデーションを見せる ---------- */
  $$('img').forEach(function (im) {
    im.addEventListener('error', function () { im.style.display = 'none'; });
    if (im.complete && im.naturalWidth === 0) im.style.display = 'none';
  });

  /* ---------- なめらかなスクロール（PCのみ） ----------
     マウス操作の端末だけ。タッチ端末は OS 標準のスクロールのまま。 */
  if (motion && fine && window.Lenis) {
    try {
      var lenis = new window.Lenis({ lerp: 0.12, anchors: { offset: -96 } });
      var loop = function (t) { lenis.raf(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    } catch (e) { /* 失敗しても通常スクロールで動く */ }
  }

  /* ---------- ヒーロー見出し：文字ごとに下から立ち上がる ---------- */
  var h1 = d.getElementById('h1');
  if (h1) {
    h1.setAttribute('aria-label', h1.textContent.replace(/\s+/g, ''));
    var i = 0;
    $$('.ph', h1).forEach(function (ph) {
      var text = ph.textContent;
      ph.textContent = '';
      Array.from(text).forEach(function (c) {
        var s = d.createElement('span');
        s.className = 'ch';
        s.setAttribute('aria-hidden', 'true');
        s.style.setProperty('--i', i++);
        s.textContent = c;
        ph.appendChild(s);
      });
    });
    requestAnimationFrame(function () { h1.classList.add('on'); });
  }

  /* ---------- セクションの英字ラベル：1文字ずつ立ち上がる ---------- */
  $$('.sec-en').forEach(function (el) {
    var text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var w = d.createElement('span');
    w.className = 'en-t';
    w.setAttribute('aria-hidden', 'true');
    Array.from(text).forEach(function (c, k) {
      var s = d.createElement('span');
      s.className = 'l';
      s.style.setProperty('--i', k);
      s.textContent = c === ' ' ? ' ' : c;
      w.appendChild(s);
    });
    el.appendChild(w);
  });

  /* ---------- カード群：1枚ずつ順番に現れる ---------- */
  var STAGGER = '.problems,.work-grid,.svc-grid,.plans,.voices,.flow,.faq,.timeline,.note-grid';
  $$(STAGGER).forEach(function (g) {
    g.classList.add('stg');
    Array.prototype.forEach.call(g.children, function (c, k) { c.style.setProperty('--k', k); });
  });

  /* ---------- 画像：下からめくれるように現れる ---------- */
  $$('.work-thumb,.case-shots .ph,.profile-photo').forEach(function (m) { m.classList.add('mask'); });
  $$('.case-shots').forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (c, k) { c.style.setProperty('--k', k); });
  });

  /* ---------- 数字を数え上げる ---------- */
  function countUp(el) {
    var to = +el.getAttribute('data-to');
    if (!motion || !to) { el.textContent = to || el.textContent; return; }
    var t0 = 0, dur = 1400;
    el.textContent = '0';
    setTimeout(function () {
      requestAnimationFrame(function step(t) {
        if (!t0) t0 = t;
        var p = Math.min((t - t0) / dur, 1);
        var e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
        el.textContent = Math.round(to * e);
        if (p < 1) requestAnimationFrame(step);
      });
    }, +el.getAttribute('data-delay') || 0);
  }

  /* ---------- 画面に入ったら .in を付ける ---------- */
  var targets = $$('.rv,.mask,.sec-en,.cnt[data-to]');
  function reveal(el) {
    if (el.classList.contains('in')) return;
    el.classList.add('in');
    if (el.classList.contains('cnt')) countUp(el);
    // 現れ終わったら、ホバー時の動きを通常の速さに戻す
    if (el.classList.contains('mask')) setTimeout(function () { el.classList.add('done'); }, 2600);
  }
  if (!('IntersectionObserver' in window)) {
    targets.forEach(reveal);
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------- ヒーローの図：マウスに合わせてわずかにずれる ----------
     にじみと輪郭が逆方向に動き、重なり方が変わる。最大でも十数px。 */
  var art = d.querySelector('.hero-art');
  var hero = d.querySelector('.hero');
  if (art && hero && motion && fine) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      art.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      art.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    }, { passive: true });
    hero.addEventListener('pointerleave', function () {
      art.style.setProperty('--mx', 0);
      art.style.setProperty('--my', 0);
    });
  }

  /* ---------- noteの最新記事（/api/note 経由。トップページのみ） ---------- */
  var list = d.getElementById('note-list');
  if (list) {
    var hideNote = function () {
      var sec = d.getElementById('note');
      if (sec) sec.style.display = 'none';
    };
    var esc = function (v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    fetch('/api/note').then(function (r) { return r.json(); }).then(function (data) {
      if (!data.items || !data.items.length) { hideNote(); return; }
      list.innerHTML = data.items.map(function (it, k) {
        var thumb = it.image
          ? '<div class="note-thumb"><img src="' + esc(it.image) + '" alt="" loading="lazy"></div>'
          : '<div class="note-thumb"></div>';
        return '<li style="--k:' + k + '"><a class="note-card" href="' + esc(it.link) + '" target="_blank" rel="noopener">'
          + thumb
          + '<span class="note-date">' + esc(it.date) + '</span>'
          + '<h3 class="note-title">' + esc(it.title) + '</h3>'
          + '</a></li>';
      }).join('');
    }).catch(hideNote);
  }

  /* ---------- ヘッダーの線と、読み進み具合のバー ---------- */
  var hd = d.querySelector('.header');
  var pg = d.getElementById('progress');
  var ticking = false;
  function onScroll() {
    var y = window.scrollY || d.documentElement.scrollTop;
    if (hd) hd.classList.toggle('is-scrolled', y > 12);
    if (pg) {
      var h = d.documentElement.scrollHeight - window.innerHeight;
      pg.style.transform = 'scaleX(' + (h > 0 ? Math.min(y / h, 1) : 0) + ')';
    }
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
})();
