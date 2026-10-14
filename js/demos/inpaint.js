/*
 * Demo "inpaint": advertisement removal from street images.
 * Part A compares the thesis results (DeepFillv2 / OpenCV Telea / Stable Diffusion) on real test images.
 * Part B is an in-browser lab: YOLO-style boxes -> binary mask (return_cut_bbox) -> cv2.dilate(3x3, 5 iterations)
 * -> fast-marching inpainting (simplified Telea, radius 3) running on procedurally drawn canvas pixels.
 */
(function () {
  "use strict";

  const W = 480, H = 320, S = 2, N = W * H;      // working image pixels; canvas logical size is W*S x H*S
  const SCENES = [0, 2, 3, 4];
  const IMG_DIR = "assets/projects/ad-removal/compare/";
  const METHODS = [
    { value: "gan", label: "DeepFillv2 GAN", tag: "DeepFillv2", info: "DeepFillv2 generator (gated convolutions, Places2 weights), image cropped to a multiple of 8." },
    { value: "telea", label: "OpenCV Telea", tag: "Telea", info: "cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA) after a 3x3 dilation, 5 iterations." },
    { value: "diffusion", label: "Stable Diffusion 2", tag: "SD 2", info: "Diffusion inpainting at 512x512, prompt \"Picture of a building, high resolution\"." }
  ];
  // Detector output in YOLO's normalised xyxy format (res.xyxyn rows): x1, y1, x2, y2, confidence. Class 0 = "ad".
  const BOXES = [[160 / W, 31 / H, 322 / W, 154 / H, 0.94], [271 / W, 211 / H, 322 / W, 286 / H, 0.91]];
  const DILATE_ITER = 5, INPAINT_RADIUS = 3;

  const CSS = `
.d-inpaint .d-inpaint__part { margin-bottom: 1.6rem; }
.d-inpaint .d-inpaint__part > .demo__caption, .d-inpaint .d-inpaint__labcap { margin: 0 0 .8rem; padding-left: 0; padding-right: 0; }
.d-inpaint .d-inpaint__cmp { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 1rem 1.4rem; align-items: start; }
@media (max-width: 760px) { .d-inpaint .d-inpaint__cmp { grid-template-columns: minmax(0, 1fr); } }
.d-inpaint .d-inpaint__viewer { aspect-ratio: 1 / 1; width: 100%; max-width: 560px; overflow: hidden; touch-action: pan-y; cursor: ew-resize; user-select: none; -webkit-user-select: none; }
.d-inpaint .d-inpaint__viewer img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; -webkit-user-drag: none; }
.d-inpaint .d-inpaint__line { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--gold-bright); box-shadow: 0 0 10px rgba(240, 207, 122, .55); }
.d-inpaint .d-inpaint__handle { position: absolute; top: 50%; left: 50%; width: 42px; height: 42px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--night-0); border: 2px solid var(--gold); color: var(--gold-bright); display: grid; place-items: center; font-family: var(--font-mono); font-size: 1rem; letter-spacing: -.1em; cursor: ew-resize; box-shadow: 0 2px 10px rgba(0, 0, 0, .6); }
.d-inpaint .d-inpaint__handle:focus-visible { outline: 2px solid var(--candle); outline-offset: 3px; }
.d-inpaint .d-inpaint__tag { position: absolute; top: .5rem; font-family: var(--font-pixel); font-size: .62rem; text-transform: uppercase; padding: .3em .6em; background: rgba(7, 8, 12, .8); border: 1px solid var(--stone-3); color: var(--parchment); transition: opacity .2s; pointer-events: none; }
.d-inpaint .d-inpaint__tag--l { left: .5rem; }
.d-inpaint .d-inpaint__tag--r { right: .5rem; color: var(--gold-bright); border-color: var(--gold); }
.d-inpaint .d-inpaint__thumbs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; }
.d-inpaint .d-inpaint__thumb { padding: 3px 3px 4px; margin: 0; background: var(--night-0); border: 1px solid var(--stone-3); color: var(--parchment-dim); font-family: var(--font-pixel); font-size: .58rem; text-transform: uppercase; cursor: pointer; display: flex; flex-direction: column; gap: 4px; align-items: stretch; min-width: 0; }
.d-inpaint .d-inpaint__thumb img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; opacity: .75; }
.d-inpaint .d-inpaint__thumb[aria-pressed="true"] { border-color: var(--gold); color: var(--gold-bright); box-shadow: 0 0 0 1px var(--gold) inset, 0 0 12px rgba(201, 162, 74, .25); }
.d-inpaint .d-inpaint__thumb[aria-pressed="true"] img { opacity: 1; }
.d-inpaint .d-inpaint__thumb:focus-visible { outline: 2px solid var(--candle); outline-offset: 2px; }
.d-inpaint .d-inpaint__side .demo__control { flex: none; margin-top: 1rem; min-width: 0; }
.d-inpaint .d-inpaint__info { font-size: .88rem; color: var(--parchment-dim); margin: .7rem 0 0; }
.d-inpaint .d-inpaint__credit { font-size: .74rem; color: var(--ash); margin: .5rem 0 0; font-style: italic; }
.d-inpaint .d-inpaint__labstage { max-width: 880px; margin: 0 auto; }
.d-inpaint .d-inpaint__labstage canvas { cursor: crosshair; }
`;

  const rgb = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const v = m ? parseInt(m[1], 16) : 0xffffff;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };

  /* ---------- Image processing (pure functions on W x H buffers) ---------- */

  /** return_cut_bbox(): black image, 255 inside every int(xyxyn * shape) box. */
  function maskFromBoxes(boxes) {
    const m = new Uint8Array(N);
    for (const b of boxes) {
      const x1 = Math.trunc(b[0] * W), y1 = Math.trunc(b[1] * H), x2 = Math.trunc(b[2] * W), y2 = Math.trunc(b[3] * H);
      for (let y = Math.max(0, y1); y < Math.min(H, y2); y++) m.fill(1, y * W + Math.max(0, x1), y * W + Math.min(W, x2));
    }
    return m;
  }

  /** One iteration of cv2.dilate with a 3x3 MORPH_RECT kernel. */
  function dilate(m) {
    const out = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!m[y * W + x]) continue;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) {
          out.fill(1, yy * W + Math.max(0, x - 1), yy * W + Math.min(W - 1, x + 1) + 1);
        }
      }
    }
    return out;
  }

  /**
   * Fast-marching inpainting after Telea (2004), as in cv2.INPAINT_TELEA: pixels are filled in order of their
   * distance T from the mask boundary; each is a weighted average of known pixels within `radius`
   * (weights: direction along grad T, 1/dist^3, level-set closeness). Simplified: no image-gradient correction term.
   */
  function teleaInpaint(src, mask, radius) {
    const KNOWN = 0, BAND = 1, INSIDE = 2, INF = 1e6;
    const T = new Float64Array(N), flag = new Uint8Array(N), out = new Uint8ClampedArray(src);
    let total = 0;
    for (let p = 0; p < N; p++) if (mask[p]) { flag[p] = INSIDE; T[p] = INF; total++; }

    let hk = new Float64Array(4096), hv = new Int32Array(4096), hn = 0, popKey = 0;
    const push = (k, v) => {
      if (hn === hk.length) { const k2 = new Float64Array(hn * 2), v2 = new Int32Array(hn * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; }
      let i = hn++;
      while (i > 0) { const pa = (i - 1) >> 1; if (hk[pa] <= k) break; hk[i] = hk[pa]; hv[i] = hv[pa]; i = pa; }
      hk[i] = k; hv[i] = v;
    };
    const pop = () => {
      const v = hv[0]; popKey = hk[0];
      const k = hk[--hn], last = hv[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = k; hv[i] = last;
      return v;
    };
    const nb = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : y * W + x;
    const solve = (a, b) => {   // FastMarching_solve from OpenCV's Telea implementation
      const fa = a < 0 ? INSIDE : flag[a], fb = b < 0 ? INSIDE : flag[b];
      const ta = a < 0 ? INF : T[a], tb = b < 0 ? INF : T[b];
      if (fa !== INSIDE) {
        if (fb !== INSIDE) return Math.abs(ta - tb) >= 1 ? 1 + Math.min(ta, tb) : (ta + tb + Math.sqrt(2 - (ta - tb) * (ta - tb))) * 0.5;
        return 1 + ta;
      }
      if (fb !== INSIDE) return 1 + tb;
      return 1 + Math.min(ta, tb);
    };
    const arrival = p => {
      const x = p % W, y = (p / W) | 0, u = nb(x, y - 1), d = nb(x, y + 1), l = nb(x - 1, y), r = nb(x + 1, y);
      return Math.min(solve(u, l), solve(d, l), solve(u, r), solve(d, r));
    };
    const r2 = radius * radius;
    const fill = p => {
      const x = p % W, y = (p / W) | 0;
      const fR = x + 1 < W ? flag[p + 1] : INSIDE, fL = x > 0 ? flag[p - 1] : INSIDE;
      const fD = y + 1 < H ? flag[p + W] : INSIDE, fU = y > 0 ? flag[p - W] : INSIDE;
      let gx = 0, gy = 0;
      if (fR !== INSIDE) gx = fL !== INSIDE ? (T[p + 1] - T[p - 1]) * 0.5 : T[p + 1] - T[p];
      else if (fL !== INSIDE) gx = T[p] - T[p - 1];
      if (fD !== INSIDE) gy = fU !== INSIDE ? (T[p + W] - T[p - W]) * 0.5 : T[p + W] - T[p];
      else if (fU !== INSIDE) gy = T[p] - T[p - W];
      let s = 0, cr = 0, cg = 0, cb = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx, L2 = dx * dx + dy * dy;
          if (xx < 0 || xx >= W || L2 === 0 || L2 > r2) continue;
          const q = yy * W + xx;
          if (flag[q] !== KNOWN) continue;
          let dir = -dx * gx - dy * gy;                       // r = p - q, dotted with grad T
          if (Math.abs(dir) <= 0.01) dir = 0.000001;
          const w = Math.abs(dir / (L2 * Math.sqrt(L2)) / (1 + Math.abs(T[q] - T[p])));
          const i4 = q * 4;
          cr += w * out[i4]; cg += w * out[i4 + 1]; cb += w * out[i4 + 2]; s += w;
        }
      }
      if (s > 0) { const i4 = p * 4; out[i4] = cr / s; out[i4 + 1] = cg / s; out[i4 + 2] = cb / s; out[i4 + 3] = 255; }
    };

    // Initial narrow band: masked pixels touching a known pixel.
    const band = [];
    for (let p = 0; p < N; p++) {
      if (flag[p] !== INSIDE) continue;
      const x = p % W, y = (p / W) | 0;
      if ((x > 0 && flag[p - 1] === KNOWN) || (x + 1 < W && flag[p + 1] === KNOWN) || (y > 0 && flag[p - W] === KNOWN) || (y + 1 < H && flag[p + W] === KNOWN)) band.push(p);
    }
    const bandT = band.map(arrival);
    band.forEach((p, i) => { T[p] = bandT[i]; flag[p] = BAND; push(T[p], p); });

    const order = new Int32Array(total), orderT = new Float32Array(total);
    let n = 0;
    while (hn) {
      const p = pop();
      if (flag[p] === KNOWN || popKey > T[p]) continue;
      flag[p] = KNOWN;
      fill(p);
      order[n] = p; orderT[n] = T[p]; n++;
      const x = p % W, y = (p / W) | 0;
      for (const q of [nb(x, y - 1), nb(x, y + 1), nb(x - 1, y), nb(x + 1, y)]) {
        if (q < 0 || flag[q] === KNOWN) continue;
        const t = arrival(q);
        if (t < T[q]) { T[q] = t; flag[q] = BAND; push(t, q); }
      }
    }
    return { out, order, orderT, n, total, maxT: n ? orderT[n - 1] : 0 };
  }

  /* ---------- Procedural street facade ---------- */

  function paintScene(g, kit) {
    const R = kit.rng(7), F = kit.fonts;
    g.save();
    // plaster wall
    const wall = g.createLinearGradient(0, 0, 0, 204);
    wall.addColorStop(0, "#b3a083"); wall.addColorStop(1, "#cdbc9c");
    g.fillStyle = wall; g.fillRect(0, 0, W, 204);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = R() < 0.5 ? `rgba(90,70,50,${0.03 + R() * 0.05})` : `rgba(255,246,228,${0.03 + R() * 0.06})`;
      g.beginPath(); g.ellipse(R() * W, R() * 196, 10 + R() * 40, 5 + R() * 18, R() * 3, 0, Math.PI * 2); g.fill();
    }
    // cornice
    g.fillStyle = "#6a5e50"; g.fillRect(0, 0, W, 11);
    g.fillStyle = "#8d806c"; g.fillRect(0, 11, W, 4);
    g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(0, 15, W, 3);
    // windows
    const windowAt = (x, y, w, hh) => {
      g.fillStyle = "#9e8e73"; g.fillRect(x - 5, y - 8, w + 10, 5);
      g.fillStyle = "#efe7d6"; g.fillRect(x - 2, y - 2, w + 4, hh + 4);
      const gl = g.createLinearGradient(x, y, x + w, y + hh);
      gl.addColorStop(0, "#5d7391"); gl.addColorStop(0.55, "#2c3b53"); gl.addColorStop(1, "#1d2638");
      g.fillStyle = gl; g.fillRect(x, y, w, hh);
      g.fillStyle = "rgba(255,255,255,.14)";
      g.beginPath(); g.moveTo(x + 4, y + hh); g.lineTo(x + 18, y); g.lineTo(x + 26, y); g.lineTo(x + 12, y + hh); g.fill();
      g.fillStyle = "#efe7d6"; g.fillRect(x + w / 2 - 1, y, 2, hh); g.fillRect(x, y + hh * 0.36, w, 2);
      g.fillStyle = "#ddd2bd"; g.fillRect(x - 5, y + hh + 2, w + 10, 4);
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(x - 4, y + hh + 6, w + 8, 3);
    };
    for (const y of [34, 118]) for (const x of [22, 92, 342, 412]) windowAt(x, y, 46, 62);
    // floor ledge
    g.fillStyle = "#8d806c"; g.fillRect(0, 196, W, 6);
    g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(0, 202, W, 3);
    // brick ground floor
    g.fillStyle = "#b5a089"; g.fillRect(0, 205, W, 88);
    for (let r = 0; r * 8 < 88; r++) {
      const y = 205 + r * 8, off = (r % 2) * 8;
      for (let x = -off; x < W; x += 16) {
        const v = R();
        g.fillStyle = `rgb(${118 + v * 34 | 0},${54 + v * 18 + R() * 8 | 0},${42 + R() * 12 | 0})`;
        g.fillRect(x + 1, y + 1, 15, 7);
      }
    }
    // shop windows
    for (const x of [30, 330]) {
      g.fillStyle = "#24242a"; g.fillRect(x - 4, 218, 128, 64);
      const gl = g.createLinearGradient(0, 222, 0, 278);
      gl.addColorStop(0, "#3a3020"); gl.addColorStop(1, "#140f0b");
      g.fillStyle = gl; g.fillRect(x, 222, 120, 56);
      const glow = g.createRadialGradient(x + 60, 262, 4, x + 60, 262, 60);
      glow.addColorStop(0, "rgba(255,181,71,.45)"); glow.addColorStop(1, "rgba(255,181,71,0)");
      g.fillStyle = glow; g.fillRect(x, 222, 120, 56);
      g.fillStyle = "rgba(255,255,255,.08)";
      g.beginPath(); g.moveTo(x + 70, 222); g.lineTo(x + 90, 222); g.lineTo(x + 60, 278); g.lineTo(x + 40, 278); g.fill();
      g.fillStyle = "#24242a"; g.fillRect(x + 59, 222, 2, 56);
    }
    // door
    g.fillStyle = "#3a281c"; g.fillRect(208, 212, 58, 81);
    g.fillStyle = "#5c3b25"; g.fillRect(213, 217, 48, 76);
    g.strokeStyle = "#3f2919"; g.lineWidth = 2;
    g.strokeRect(218, 223, 16, 30); g.strokeRect(240, 223, 16, 30); g.strokeRect(218, 260, 16, 26); g.strokeRect(240, 260, 16, 26);
    g.fillStyle = "#d8b25a"; g.fillRect(254, 254, 4, 4);
    // sidewalk
    g.fillStyle = "#7a7671"; g.fillRect(0, 293, W, 27);
    g.fillStyle = "#9a948b"; g.fillRect(204, 293, 66, 4);
    g.strokeStyle = "rgba(40,38,36,.45)"; g.lineWidth = 1;
    for (let x = 12; x < W; x += 40) { g.beginPath(); g.moveTo(x, 297); g.lineTo(x - 10, 320); g.stroke(); }
    g.beginPath(); g.moveTo(0, 308.5); g.lineTo(W, 308.5); g.stroke();
    g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, 293, W, 2);

    // --- Ad 1: billboard on the plaster wall
    const bx = 162, by = 34, bw = 156, bh = 116;
    g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(bx + 3, by + 4, bw, bh);
    g.fillStyle = "#18181d"; g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    const bg = g.createLinearGradient(bx, by, bx + bw, by + bh);
    bg.addColorStop(0, "#d92a6b"); bg.addColorStop(0.6, "#f2552f"); bg.addColorStop(1, "#ffa72b");
    g.fillStyle = bg; g.fillRect(bx, by, bw, bh);
    g.fillStyle = "rgba(255,255,255,.12)";
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(bx + i * 34, by + bh); g.lineTo(bx + i * 34 + 14, by + bh); g.lineTo(bx + i * 34 + 60, by); g.lineTo(bx + i * 34 + 46, by); g.fill(); }
    g.fillStyle = "#ffe14a"; g.beginPath(); g.arc(bx + bw - 30, by + 30, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#c2124f"; g.font = `700 15px ${F.mono}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("-50%", bx + bw - 30, by + 31);
    g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = `900 36px ${F.display}`; g.fillText("SALE", bx + 12, by + 62);
    g.font = `700 11px ${F.mono}`; g.fillText("NEW COLLECTION", bx + 13, by + 80);
    g.fillStyle = "#1b1030"; g.fillRect(bx, by + bh - 22, bw, 22);
    g.fillStyle = "#ffe14a"; g.font = `10px ${F.pixel}`; g.fillText("ALL WEEK ONLY", bx + 12, by + bh - 8);
    g.fillStyle = "#4a4a50"; g.fillRect(bx + 20, by + bh + 2, 4, 6); g.fillRect(bx + bw - 24, by + bh + 2, 4, 6);

    // --- Ad 2: pasted poster on the bricks
    const px = 274, py = 214, pw = 44, ph = 68;
    g.fillStyle = "#f4f1ea"; g.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    const pg = g.createLinearGradient(px, py, px, py + ph);
    pg.addColorStop(0, "#21b3a4"); pg.addColorStop(1, "#2d47c9");
    g.fillStyle = pg; g.fillRect(px, py, pw, ph);
    g.fillStyle = "#ffe14a"; g.beginPath(); g.arc(px + pw / 2, py + 20, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ff4f7b"; g.beginPath(); g.arc(px + pw / 2 + 6, py + 16, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `800 10px ${F.mono}`;
    g.fillText("CITY", px + pw / 2, py + 46); g.fillText("FEST", px + pw / 2, py + 56);
    g.font = `7px ${F.pixel}`; g.fillStyle = "#ffe14a"; g.fillText("06.11", px + pw / 2, py + 65);
    g.restore();
  }

  PortfolioDemos.register("inpaint", {
    title: "Ad removal: detect, mask, inpaint",
    note: "Drag the divider to compare the three inpainting methods on real test images. In the lab below, press Detect, Mask and Inpaint, or paint over anything with the brush and inpaint it (simplified Telea fast marching, running in your browser).",
    mount(host, kit) {
      const h = kit.h, C = kit.colors(), F = kit.fonts;
      const reduced = kit.reducedMotion();
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);

      const frame = kit.frame(host);
      frame.root.classList.add("d-inpaint");

      /* ================= Part A: compare methods ================= */
      let scene = 0, method = METHODS[0], pos = 50, dragging = false;
      const base = h("img", { class: "d-inpaint__base", alt: "", draggable: "false" });
      const over = h("img", { class: "d-inpaint__over", alt: "", draggable: "false" });
      const tagL = h("span", { class: "d-inpaint__tag d-inpaint__tag--l", "aria-hidden": "true" }, "Original");
      const tagR = h("span", { class: "d-inpaint__tag d-inpaint__tag--r", "aria-hidden": "true" }, "");
      const handle = h("div", { class: "d-inpaint__handle", role: "slider", tabindex: "0", "aria-label": "Before/after divider", "aria-valuemin": "0", "aria-valuemax": "100" }, "‹›");
      const line = h("div", { class: "d-inpaint__line" }, handle);
      const viewer = h("div", { class: "demo__stage d-inpaint__viewer" }, base, over, tagL, tagR, line);
      const thumbs = h("div", { class: "d-inpaint__thumbs", role: "group", "aria-label": "Test image" });
      const thumbBtns = SCENES.map((id, i) => {
        const b = h("button", { type: "button", class: "d-inpaint__thumb", "aria-pressed": "false" },
          h("img", { src: IMG_DIR + id + "_original.webp", alt: "" }), h("span", {}, "Scene " + (i + 1)));
        b.addEventListener("click", () => { scene = i; updateA(); });
        thumbs.append(b);
        return b;
      });
      const side = h("div", { class: "d-inpaint__side" }, thumbs);
      kit.select(side, { label: "Inpainting method", options: METHODS, value: method.value, onChange: v => { method = METHODS.find(m => m.value === v) || METHODS[0]; updateA(); } });
      const info = h("p", { class: "d-inpaint__info" });
      const readoutA = h("div", { class: "demo__readout", "aria-live": "polite" });
      side.append(info, h("p", { class: "d-inpaint__credit" }, "Street-level imagery © Google"), readoutA);
      const partA = h("section", { class: "d-inpaint__part", "aria-label": "Compare methods" },
        h("div", { class: "demo__caption" }, "A · Compare methods (thesis results)"),
        h("div", { class: "d-inpaint__cmp" }, viewer, side));
      frame.root.insertBefore(partA, frame.stage);

      const describeA = () => `Scene ${scene + 1}, ${method.label}: original left of the divider, inpainted right (${Math.round(pos)}% / ${Math.round(100 - pos)}%).`;
      function setPos(v) {
        pos = kit.clamp(v, 0, 100);
        over.style.clipPath = `inset(0 0 0 ${pos}%)`;
        over.style.webkitClipPath = `inset(0 0 0 ${pos}%)`;
        line.style.left = pos + "%";
        handle.setAttribute("aria-valuenow", String(Math.round(pos)));
        handle.setAttribute("aria-valuetext", `${Math.round(pos)}% original, ${Math.round(100 - pos)}% ${method.label}`);
        tagL.style.opacity = pos < 16 ? "0" : "1";
        tagR.style.opacity = pos > 84 ? "0" : "1";
        readoutA.textContent = describeA();
      }
      function updateA() {
        const id = SCENES[scene];
        base.src = IMG_DIR + id + "_original.webp";
        base.alt = `Scene ${scene + 1}: original street photo with advertisement`;
        over.src = IMG_DIR + id + "_" + method.value + ".webp";
        over.alt = `Scene ${scene + 1} after ad removal with ${method.label}`;
        tagR.textContent = method.tag;
        thumbBtns.forEach((b, i) => b.setAttribute("aria-pressed", i === scene ? "true" : "false"));
        info.textContent = method.info;
        setPos(pos);
      }
      const posFromEvent = e => { const r = viewer.getBoundingClientRect(); return r.width ? (e.clientX - r.left) / r.width * 100 : pos; };
      viewer.addEventListener("pointerdown", e => {
        if (e.button > 0) return;
        dragging = true;
        try { viewer.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        setPos(posFromEvent(e));
        handle.focus({ preventScroll: true });
        e.preventDefault();
      });
      viewer.addEventListener("pointermove", e => { if (dragging) setPos(posFromEvent(e)); });
      const endDrag = () => { dragging = false; };
      viewer.addEventListener("pointerup", endDrag);
      viewer.addEventListener("pointercancel", endDrag);
      handle.addEventListener("keydown", e => {
        const step = e.shiftKey ? 10 : 2;
        const map = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -10, PageUp: 10 };
        if (e.key in map) setPos(pos + map[e.key]);
        else if (e.key === "Home") setPos(0);
        else if (e.key === "End") setPos(100);
        else return;
        e.preventDefault();
      });
      updateA();

      /* ================= Part B: inpainting lab ================= */
      frame.root.insertBefore(h("div", { class: "demo__caption d-inpaint__labcap" }, "B · Inpainting lab (in-browser simulation)"), frame.stage);
      frame.stage.classList.add("d-inpaint__labstage");
      const cv = kit.canvas(frame.stage, W * S, H * S, "Inpainting lab: procedurally drawn street facade with two advertisement posters. Drag to paint a mask.");
      const ctx = cv.ctx;
      cv.canvas.tabIndex = -1;
      cv.canvas.style.outline = "none";
      const buf = document.createElement("canvas");
      buf.width = W; buf.height = H;
      const bctx = buf.getContext("2d", { willReadFrequently: true });
      const disp = bctx.createImageData(W, H);

      const GOLD = rgb(C.goldBright), BLOOD = rgb(C.bloodBright), HOLE_A = [34, 12, 18], HOLE_B = [22, 9, 13];
      let orig, img;
      let phase = "idle", at = 0, view = "image", status = "scene", pristine = true;
      let boxes = [], detectP = 0, dilSteps = null, dilShown = 0;
      let job = null, revealed = 0, thr = 0, lastStats = null;
      const userMask = new Uint8Array(N);
      let brush = 12, cursor = null, painting = false, lastPt = null, pending = 0;

      function buildScene() {
        bctx.clearRect(0, 0, W, H);
        paintScene(bctx, kit);
        const id = bctx.getImageData(0, 0, W, H), d = id.data, R = kit.rng(11);
        for (let i = 0; i < d.length; i += 4) {          // sensor grain, so filled regions show their smoothing
          const n = (R() - 0.5) * 14;
          d[i] += n; d[i + 1] += n; d[i + 2] += n;
        }
        orig = new Uint8ClampedArray(d);
        img = new Uint8ClampedArray(d);
      }

      const count = m => { let c = 0; for (let p = 0; p < N; p++) c += m[p]; return c; };
      const hasUser = () => { for (let p = 0; p < N; p++) if (userMask[p]) return true; return false; };
      const fmt = n => n.toLocaleString("en-US");

      function buildDilation() {
        const m0 = maskFromBoxes(boxes);
        for (let p = 0; p < N; p++) if (userMask[p]) m0[p] = 1;
        dilSteps = [m0];
        for (let k = 1; k <= DILATE_ITER; k++) dilSteps.push(dilate(dilSteps[k - 1]));
      }

      /* ---------- rendering ---------- */
      function render() {
        const d = disp.data;
        if (phase === "inpaint" && job) {
          const { out, rank, orderT, mask } = job;
          for (let p = 0, i = 0; p < N; p++, i += 4) {
            let r, g, b;
            if (!mask[p]) { r = img[i]; g = img[i + 1]; b = img[i + 2]; }
            else {
              const k = rank[p];
              if (k >= 0 && k < revealed) {
                r = out[i]; g = out[i + 1]; b = out[i + 2];
                if (orderT[k] > thr - 1.5) { r = (r + GOLD[0]) >> 1; g = (g + GOLD[1]) >> 1; b = (b + GOLD[2]) >> 1; }
              } else {
                const c = (((p % W) + ((p / W) | 0)) >> 2) & 1 ? HOLE_A : HOLE_B;
                r = c[0]; g = c[1]; b = c[2];
              }
            }
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
          }
        } else if (view === "mask") {
          const m = dilSteps ? dilSteps[dilShown] : null;
          const prev = dilSteps && dilShown > 0 && phase === "dilate" ? dilSteps[dilShown - 1] : null;
          for (let p = 0, i = 0; p < N; p++, i += 4) {
            const on = (m && m[p]) || userMask[p];
            let v = on ? 255 : 0;
            if (prev && m[p] && !prev[p] && !userMask[p]) { d[i] = GOLD[0]; d[i + 1] = GOLD[1]; d[i + 2] = GOLD[2]; }
            else { d[i] = v; d[i + 1] = v; d[i + 2] = v; }
            d[i + 3] = 255;
          }
        } else {
          for (let p = 0, i = 0; p < N; p++, i += 4) {
            if (userMask[p]) {
              d[i] = (img[i] * 0.45 + BLOOD[0] * 0.55) | 0; d[i + 1] = (img[i + 1] * 0.45 + BLOOD[1] * 0.55) | 0; d[i + 2] = (img[i + 2] * 0.45 + BLOOD[2] * 0.55) | 0;
            } else { d[i] = img[i]; d[i + 1] = img[i + 1]; d[i + 2] = img[i + 2]; }
            d[i + 3] = 255;
          }
        }
        bctx.putImageData(disp, 0, 0);
        ctx.save();
        ctx.clearRect(0, 0, W * S, H * S);
        ctx.imageSmoothingEnabled = view !== "mask" || phase === "inpaint";
        ctx.drawImage(buf, 0, 0, W * S, H * S);
        drawOverlay();
        ctx.restore();
      }

      function drawOverlay() {
        // YOLO grid + scan line while detecting
        if (phase === "detect") {
          const sy = scanY() * S;
          ctx.strokeStyle = "rgba(240,207,122,.10)"; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = 32 * S; x < W * S; x += 32 * S) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H * S); }
          for (let y = 32 * S; y < H * S; y += 32 * S) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W * S, y + 0.5); }
          ctx.stroke();
          const tr = ctx.createLinearGradient(0, sy - 60, 0, sy);
          tr.addColorStop(0, "rgba(95,179,168,0)"); tr.addColorStop(1, "rgba(95,179,168,.22)");
          ctx.fillStyle = tr; ctx.fillRect(0, sy - 60, W * S, 60);
          ctx.fillStyle = C.teal; ctx.fillRect(0, sy - 1, W * S, 2);
        }
        // detection boxes
        if (boxes.length && phase !== "inpaint") {
          ctx.font = `20px ${F.pixel}`;
          ctx.textBaseline = "middle";
          for (const b of boxes) {
            const a = boxAlpha(b);
            if (a <= 0) continue;
            const x1 = Math.trunc(b[0] * W) * S, y1 = Math.trunc(b[1] * H) * S, x2 = Math.trunc(b[2] * W) * S, y2 = Math.trunc(b[3] * H) * S;
            ctx.globalAlpha = a;
            ctx.strokeStyle = C.bloodBright; ctx.lineWidth = 3;
            if (view === "mask") ctx.setLineDash([10, 6]);
            ctx.shadowColor = C.bloodBright; ctx.shadowBlur = view === "mask" ? 0 : 10;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            ctx.shadowBlur = 0; ctx.setLineDash([]);
            const label = "ad " + (b[4] * Math.min(1, a)).toFixed(2);
            const tw = ctx.measureText(label).width + 14;
            const ly = y1 - 26 < 0 ? y1 : y1 - 26;
            ctx.fillStyle = C.bloodBright; ctx.fillRect(x1 - 1.5, ly, tw, 26);
            ctx.fillStyle = C.text; ctx.fillText(label, x1 + 6, ly + 14);
          }
          ctx.globalAlpha = 1;
        }
        // step badge
        const text = badgeText();
        ctx.font = `20px ${F.pixel}`; ctx.textBaseline = "middle";
        const bw = ctx.measureText(text).width + 24;
        ctx.fillStyle = "rgba(7,8,12,.82)"; ctx.fillRect(12, H * S - 46, bw, 34);
        ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.strokeRect(12.5, H * S - 45.5, bw - 1, 33);
        ctx.fillStyle = C.goldBright; ctx.fillText(text, 24, H * S - 28);
        // brush cursor
        if (cursor && phase !== "inpaint") {
          ctx.strokeStyle = view === "mask" ? C.bloodBright : C.goldBright; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.arc(cursor.x, cursor.y, brush * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      function badgeText() {
        if (phase === "detect") return "1 · DETECT  YOLO";
        if (phase === "dilate" || (view === "mask" && dilSteps)) return `2 · MASK  DILATE ${dilShown}/${DILATE_ITER}`;
        if (phase === "inpaint" && job) return `3 · INPAINT  T ${Math.min(thr, job.maxT).toFixed(0)}/${job.maxT.toFixed(0)}`;
        if (status === "detected") return "1 · DETECTED " + boxes.length + " ADS";
        if (status === "brush") return "BRUSH MASK";
        if (status === "done" && lastStats) return `DONE · ${lastStats.ms.toFixed(1)} MS`;
        return "0 · INPUT IMAGE";
      }

      const ease = t => 1 - Math.pow(1 - kit.clamp(t, 0, 1), 3);
      const scanY = () => ease(at / 0.9) * H;
      function boxAlpha(b) {
        if (phase !== "detect") return 1;
        const cy = (b[1] + b[3]) / 2 * H;
        return kit.clamp((scanY() - cy) / 30, 0, 1);
      }

      const requestRender = () => {
        if (pending || loop.running) return;
        pending = requestAnimationFrame(() => { pending = 0; render(); });
      };

      /* ---------- animation ---------- */
      const DIL_START = 0.45, DIL_STEP = 0.24;
      const loop = kit.loop(cv.canvas, dt => {
        at += dt;
        if (phase === "detect" && at >= 1.1) finishAnim();
        else if (phase === "dilate") {
          const k = at < DIL_START ? 0 : Math.min(DILATE_ITER, 1 + Math.floor((at - DIL_START) / DIL_STEP));
          if (k !== dilShown) { dilShown = k; maskReadout(); }
          if (at >= DIL_START + DILATE_ITER * DIL_STEP + 0.2) finishAnim();
        } else if (phase === "inpaint" && job) {
          const dur = kit.clamp(job.maxT * 0.05, 0.9, 2.2);
          thr = at / dur * job.maxT;
          while (revealed < job.n && job.orderT[revealed] <= thr) revealed++;
          if (at >= dur + 0.3) finishAnim();
        }
        render();
        if (phase === "idle") Promise.resolve().then(() => { if (phase === "idle") loop.stop(); });
      });

      function begin(p) {
        phase = p; at = 0; pristine = false;
        if (reduced) { finishAnim(); render(); }
        else { loop.start(); render(); }
      }

      function finishAnim() {
        if (phase === "detect") { detectP = 1; status = "detected"; }
        else if (phase === "dilate") { dilShown = DILATE_ITER; maskReadout(); }
        else if (phase === "inpaint" && job) commitInpaint();
        phase = "idle";
      }

      /* ---------- steps ---------- */
      function say(t) { frame.readout.textContent = t; }

      function detect() {
        finishAnim();
        boxes = BOXES.map(b => b.slice());
        dilSteps = null; view = "image"; status = "detected";
        say(`Step 1 · YOLO detection: ${boxes.length} boxes of class "ad" (conf ${boxes.map(b => b[4].toFixed(2)).join(", ")}), returned as normalised xyxy like res.xyxyn. Next: Mask.`);
        begin("detect");
      }

      function maskReadout() {
        if (!dilSteps) return;
        const m = dilSteps[dilShown];
        say(`Step 2 · return_cut_bbox(): boxes → binary mask (255 inside). cv2.dilate, 3x3 rect kernel, iteration ${dilShown}/${DILATE_ITER}: ${fmt(count(m))} px masked. Next: Inpaint.`);
      }

      function makeMask() {
        finishAnim();
        if (!boxes.length && !hasUser()) { boxes = BOXES.map(b => b.slice()); detectP = 1; }
        if (!boxes.length) {           // only a brush mask: show it, nothing to dilate from boxes
          view = "mask"; dilSteps = null; status = "brush";
          say(`Mask view: your brush mask, ${fmt(count(userMask))} px. Press Detect to add the ad boxes, or Inpaint.`);
          render();
          return;
        }
        buildDilation();
        dilShown = 0; view = "mask"; status = "mask";
        maskReadout();
        begin("dilate");
      }

      function inpaint() {
        finishAnim();
        if (!dilSteps && !boxes.length && !hasUser()) { boxes = BOXES.map(b => b.slice()); detectP = 1; }
        if (!dilSteps && boxes.length) { buildDilation(); dilShown = DILATE_ITER; }
        const mask = new Uint8Array(N);
        if (dilSteps) { const d = dilSteps[DILATE_ITER]; for (let p = 0; p < N; p++) mask[p] = d[p]; }
        for (let p = 0; p < N; p++) if (userMask[p]) mask[p] = 1;
        const t0 = performance.now();
        const res = teleaInpaint(img, mask, INPAINT_RADIUS);
        const ms = performance.now() - t0;
        const rank = new Int32Array(N).fill(-1);
        for (let k = 0; k < res.n; k++) rank[res.order[k]] = k;
        job = Object.assign(res, { rank, mask, ms });
        revealed = 0; thr = 0; view = "image";
        say(`Step 3 · fast-marching inpaint (radius ${INPAINT_RADIUS}): ${fmt(res.n)} px filled in ${ms.toFixed(1)} ms, from the mask boundary inward, ${Math.ceil(res.maxT)} layers deep.`);
        begin("inpaint");
      }

      function commitInpaint() {
        img = job.out;
        lastStats = { ms: job.ms, n: job.n, total: job.total, layers: Math.ceil(job.maxT) };
        boxes = []; dilSteps = null; userMask.fill(0); job = null; status = "done";
        const missed = lastStats.total - lastStats.n;
        say(`Done · ${fmt(lastStats.n)} px inpainted in ${lastStats.ms.toFixed(1)} ms in your browser (${lastStats.layers} layers).` +
          (missed ? ` ${fmt(missed)} px had no known neighbours and stayed unchanged.` : "") +
          " Telea-style filling smears texture; compare DeepFillv2 and SD 2 above. Paint more, or Reset.");
      }

      function reset() {
        finishAnim();
        img = new Uint8ClampedArray(orig);
        boxes = []; dilSteps = null; userMask.fill(0); job = null; lastStats = null;
        view = "image"; status = "scene"; detectP = 0;
        say("Step 0 · street facade (480x320 px, drawn procedurally). Press Detect, or paint over anything with the brush and press Inpaint.");
        render();
      }

      const btns = h("div", { class: "demo__buttons" });
      frame.controls.append(btns);
      kit.button(btns, "Detect", detect, "ghost");
      kit.button(btns, "Mask", makeMask, "ghost");
      kit.button(btns, "Inpaint", inpaint, "blood");
      kit.button(btns, "Reset", reset, "ghost");
      kit.slider(frame.controls, { label: "Brush size", min: 3, max: 30, value: brush, format: v => v + " px", onInput: v => { brush = v; requestRender(); } });
      const legendHost = h("div");
      frame.root.insertBefore(legendHost, frame.readout);
      kit.legend(legendHost, [
        { color: C.bloodBright, label: "YOLO box / brush mask" },
        { color: "#ffffff", label: "binary mask (255)" },
        { color: C.goldBright, label: "dilation ring / filling front" }
      ]);

      /* ---------- brush ---------- */
      function stamp(x, y) {
        const r = brush, r2 = r * r;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.round(y + dy);
          if (yy < 0 || yy >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.round(x + dx);
            if (xx < 0 || xx >= W || dx * dx + dy * dy > r2) continue;
            userMask[yy * W + xx] = 1;
          }
        }
      }
      function strokeTo(pt) {
        if (!lastPt) { stamp(pt.x, pt.y); lastPt = pt; return; }
        const dx = pt.x - lastPt.x, dy = pt.y - lastPt.y, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, brush / 2)));
        for (let i = 1; i <= steps; i++) stamp(lastPt.x + dx * i / steps, lastPt.y + dy * i / steps);
        lastPt = pt;
      }
      const imgPt = e => { const l = cv.toLocal(e); return { x: l.x / S, y: l.y / S, lx: l.x, ly: l.y }; };
      cv.canvas.addEventListener("pointerdown", e => {
        if (e.button > 0) return;
        if (phase !== "idle") { finishAnim(); }
        painting = true; pristine = false; lastPt = null;
        cv.canvas.focus({ preventScroll: true });   // so a following Space/Enter does not re-press the last button
        try { cv.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const p = imgPt(e);
        cursor = { x: p.lx, y: p.ly };
        strokeTo(p);
        if (status !== "mask") status = "brush";
        e.preventDefault();
        requestRender();
      });
      cv.canvas.addEventListener("pointermove", e => {
        const p = imgPt(e);
        cursor = { x: p.lx, y: p.ly };
        if (painting) strokeTo(p);
        requestRender();
      });
      const endPaint = () => {
        if (!painting) return;
        painting = false; lastPt = null;
        say(`Brush mask: ${fmt(count(userMask))} px painted (crimson). Press Inpaint to fill them from the surrounding pixels, or Mask to see the binary mask.`);
        requestRender();
      };
      cv.canvas.addEventListener("pointerup", endPaint);
      cv.canvas.addEventListener("pointercancel", endPaint);
      cv.canvas.addEventListener("pointerleave", () => { if (!painting) { cursor = null; requestRender(); } });

      buildScene();
      reset();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { if (pristine && orig) { buildScene(); render(); } });
      }

      return () => {
        loop.destroy();
        if (pending) cancelAnimationFrame(pending);
        style.remove();
        frame.root.remove();
      };
    }
  });
})();
