/* Hero background: a procedurally drawn castle at night with moon, stars, fog and bats. */
(function () {
  "use strict";

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function init() {
    const canvas = document.querySelector(".hero__canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, stars = [], castle = null, bats = [], clouds = [];
    const pointer = { x: -1, y: -1 };

    function buildCastle(rand) {
      // Silhouette as a list of rectangles + spires, anchored to the right half on wide screens.
      const base = H * 0.78;
      const cx = W > 900 ? W * 0.72 : W * 0.5;
      const scale = Math.min(1.25, Math.max(0.55, W / 1400)) * (H / 900 + 0.2);
      const parts = [];
      const towers = [
        { dx: -260, w: 46, h: 300 }, { dx: -190, w: 70, h: 210 }, { dx: -110, w: 54, h: 380 },
        { dx: -40, w: 120, h: 260 }, { dx: 70, w: 60, h: 470 }, { dx: 140, w: 90, h: 230 },
        { dx: 220, w: 40, h: 330 }, { dx: 270, w: 80, h: 180 }
      ];
      for (const t of towers) {
        const w = t.w * scale, h = t.h * scale * (0.9 + rand() * 0.2), x = cx + t.dx * scale - w / 2;
        parts.push({ x, y: base - h, w, h, spire: rand() > 0.35, battlement: rand() > 0.4 });
      }
      const windows = [];
      for (const p of parts) {
        const n = Math.floor(p.h / (38 * scale));
        for (let i = 1; i < n; i++) if (rand() > 0.55) windows.push({ x: p.x + p.w * (0.3 + rand() * 0.4), y: p.y + i * 38 * scale, w: 4 * scale + 2, h: 9 * scale + 3, phase: rand() * 6.28, lit: rand() > 0.3 });
      }
      return { parts, windows, base, scale, cx };
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rand = rng(7);
      stars = Array.from({ length: Math.round(W * H / 5000) }, () => ({ x: rand() * W, y: rand() * H * 0.7, r: rand() * 1.3 + 0.2, p: rand() * 6.28, s: 0.5 + rand() * 1.5 }));
      castle = buildCastle(rng(42));
      bats = Array.from({ length: W < 600 ? 5 : 9 }, (_, i) => ({ x: rand() * W, y: H * (0.15 + rand() * 0.4), v: 30 + rand() * 50, a: rand() * 6.28, size: 6 + rand() * 7, wob: rand() * 6.28, dir: i % 3 ? 1 : -1 }));
      clouds = Array.from({ length: 5 }, () => ({ x: rand() * W, y: H * (0.1 + rand() * 0.35), w: 180 + rand() * 260, v: 4 + rand() * 8 }));
    }

    // On narrow screens the moon sits in the top corner, above the title, so it never sits behind text.
    function moonPos() {
      if (W < 700) return { x: W * 0.84, y: 92, r: 26 };
      return { x: W > 900 ? W * 0.8 : W * 0.72, y: H * 0.24, r: Math.max(38, Math.min(W, H) * 0.09) };
    }

    function draw(t) {
      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#05060a"); sky.addColorStop(0.55, "#0e0f1a"); sky.addColorStop(1, "#1a0d14");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

      // Stars
      for (const s of stars) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(s.p + t * s.s * 0.6));
        ctx.fillStyle = `rgba(223, 227, 238, ${a})`;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }

      // Moon with halo
      const m = moonPos();
      const halo = ctx.createRadialGradient(m.x, m.y, m.r * 0.6, m.x, m.y, m.r * 4);
      halo.addColorStop(0, "rgba(255, 220, 200, .28)"); halo.addColorStop(0.4, "rgba(216, 38, 61, .08)"); halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      const disc = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.1, m.x, m.y, m.r);
      disc.addColorStop(0, "#fff6ea"); disc.addColorStop(0.7, "#e9d9cf"); disc.addColorStop(1, "#c7a99d");
      ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(150, 110, 110, .25)";
      [[-0.3, 0.1, 0.18], [0.25, -0.25, 0.12], [0.1, 0.35, 0.09]].forEach(([dx, dy, rr]) => { ctx.beginPath(); ctx.arc(m.x + dx * m.r, m.y + dy * m.r, rr * m.r, 0, 6.283); ctx.fill(); });

      // Clouds drifting over the moon
      for (const c of clouds) {
        const x = ((c.x + t * c.v) % (W + c.w * 2)) - c.w;
        const g = ctx.createRadialGradient(x, c.y, 10, x, c.y, c.w * 0.6);
        g.addColorStop(0, "rgba(40, 36, 52, .55)"); g.addColorStop(1, "rgba(20, 18, 28, 0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, c.y, c.w * 0.6, c.w * 0.14, 0, 0, 6.283); ctx.fill();
      }

      // Distant hills
      ctx.fillStyle = "#0b0a11";
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * 0.8 - Math.sin(x * 0.006) * 30 - Math.sin(x * 0.017) * 12);
      ctx.lineTo(W, H); ctx.fill();

      // Castle
      ctx.fillStyle = "#050509";
      for (const p of castle.parts) {
        ctx.fillRect(p.x, p.y, p.w, p.h + 4);
        if (p.battlement) {
          const n = Math.max(3, Math.floor(p.w / 10)), bw = p.w / (n * 2 - 1);
          for (let i = 0; i < n; i++) ctx.fillRect(p.x + i * bw * 2, p.y - bw * 1.1, bw, bw * 1.1);
        }
        if (p.spire) { ctx.beginPath(); ctx.moveTo(p.x - p.w * 0.08, p.y); ctx.lineTo(p.x + p.w / 2, p.y - p.w * 1.5); ctx.lineTo(p.x + p.w * 1.08, p.y); ctx.fill(); }
      }
      ctx.fillRect(castle.cx - 320 * castle.scale, castle.base - 60 * castle.scale, 640 * castle.scale, 70 * castle.scale);
      for (const w of castle.windows) {
        if (!w.lit) continue;
        const f = 0.65 + 0.35 * Math.sin(t * 3 + w.phase) * Math.sin(t * 1.7 + w.phase * 2);
        ctx.fillStyle = `rgba(255, 181, 71, ${0.5 + 0.5 * f})`;
        ctx.shadowColor = "#ffb547"; ctx.shadowBlur = 10;
        ctx.fillRect(w.x, w.y, w.w, w.h);
      }
      ctx.shadowBlur = 0;

      // Ground
      ctx.fillStyle = "#07070b";
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 30) ctx.lineTo(x, castle.base + 4 + Math.sin(x * 0.01) * 6);
      ctx.lineTo(W, H); ctx.fill();

      // Fog
      for (let i = 0; i < 3; i++) {
        const y = H * (0.8 + i * 0.06), off = (t * (8 + i * 6)) % W;
        const fog = ctx.createLinearGradient(0, y - 40, 0, y + 50);
        fog.addColorStop(0, "rgba(120, 110, 140, 0)"); fog.addColorStop(0.5, `rgba(120, 110, 140, ${0.07 + i * 0.03})`); fog.addColorStop(1, "rgba(120, 110, 140, 0)");
        ctx.fillStyle = fog;
        for (let k = -1; k < 2; k++) { ctx.beginPath(); ctx.ellipse(off + k * W, y, W * 0.6, 40, 0, 0, 6.283); ctx.fill(); }
      }

      // Bats
      ctx.fillStyle = "#020203";
      for (const b of bats) {
        const flap = Math.sin(t * 14 + b.wob);
        const s = b.size;
        ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.dir, 1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-s * 0.6, -s * (0.2 + flap * 0.8), -s * 1.6, -s * flap * 0.5);
        ctx.quadraticCurveTo(-s * 0.9, s * 0.2, -s * 0.3, s * 0.15);
        ctx.lineTo(0, s * 0.35);
        ctx.lineTo(s * 0.3, s * 0.15);
        ctx.quadraticCurveTo(s * 0.9, s * 0.2, s * 1.6, -s * flap * 0.5);
        ctx.quadraticCurveTo(s * 0.6, -s * (0.2 + flap * 0.8), 0, 0);
        ctx.fill(); ctx.restore();
      }
    }

    function step(dt) {
      for (const b of bats) {
        b.a += dt * 0.8;
        b.x += b.dir * b.v * dt;
        b.y += Math.sin(b.a + b.wob) * 18 * dt;
        if (pointer.x >= 0) { // bats scatter away from the cursor
          const dx = b.x - pointer.x, dy = b.y - pointer.y, d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120) { b.y += (dy > 0 ? 1 : -1) * 90 * dt; b.dir = dx > 0 ? 1 : -1; }
        }
        if (b.x > W + 40) b.x = -40; if (b.x < -40) b.x = W + 40;
        b.y = Math.max(H * 0.05, Math.min(H * 0.7, b.y));
      }
    }

    let raf = 0, last = 0, visible = true;
    function frame(ms) {
      const t = ms / 1000;
      step(Math.min(0.05, last ? t - last : 0));
      last = t;
      draw(t);
      raf = requestAnimationFrame(frame);
    }
    function sync() {
      const run = !still && visible && !document.hidden;
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    resize();
    draw(0);
    let resizeTimer;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { resize(); draw(last || 0); }, 120); });
    canvas.parentElement.addEventListener("pointermove", e => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; });
    canvas.parentElement.addEventListener("pointerleave", () => { pointer.x = -1; });
    if ("IntersectionObserver" in window) new IntersectionObserver(e => { visible = e[0].isIntersecting; sync(); }).observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
