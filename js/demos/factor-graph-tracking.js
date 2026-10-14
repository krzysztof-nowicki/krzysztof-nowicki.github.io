/*
 * Demo: pedestrian tracking between two frames with a factor graph.
 * Mirrors the SIWR course project (main.py / factorgraphtest.py):
 *   p(prev j -> cur i) = 0.4 * size + 0.1 * distance + 0.5 * centre colour
 *   unary factor per current box:  [0.8 (new object), p_0 ... p_n-1]
 *   pairwise factor per pair of current boxes: 0 when both pick the same previous box
 *   result = MAP assignment, "-1" = new object.
 * pgmpy's BeliefPropagation.map_query is replaced here by an exact exhaustive MAP search
 * over the very same factors (same maximiser, trivially small graph).
 */
(function () {
  "use strict";

  const FW = 400, FH = 260, HORIZON = 128;       // logical size of one frame, horizon line of the street
  const NEW_PRIOR = 0.8;                         // unary value of the "new object" state (code: [[0.8] + probs])
  const PATCH = 10;                              // centre patch half size (code: centre -10 : +10)
  const W0 = { size: 0.4, dist: 0.1, colour: 0.5 };
  const MAX_PEOPLE = 5, TWEEN = 0.7, INTERVAL = 2.8;
  const CAP = 26, WIDE_GAP = 56, STACK_GAP = 48, HANDLE = 14;

  // Clothing colours (rgb). The colour factor uses the *mean over channels*, i.e. brightness only.
  const CLOTHES = [
    [34, 30, 44], [176, 36, 52], [48, 150, 142], [222, 172, 62], [226, 226, 236], [118, 70, 160]
  ];
  const BUILD = [[0, 58, 52], [46, 40, 36], [92, 74, 62], [164, 52, 44], [220, 86, 54], [278, 46, 38], [328, 70, 58], [380, 40, 42]];
  const STOPS = [[0, [22, 20, 30]], [0.5, [92, 22, 40]], [0.8, [168, 34, 52]], [1, [226, 176, 66]]];

  const hOf = y => 70 + (y - 150) * 0.6;           // person height from foot position (perspective)

  PortfolioDemos.register("factor-graph-tracking", {
    title: "Factor-graph pedestrian tracking",
    note: "Browser simulation of my SIWR tracker: the same three weighted factors and 0.8 new-object prior, solved by an exact MAP search instead of pgmpy. Drag or resize boxes in the Current frame, click a matrix cell, move the weight sliders, then press Next frame.",
    mount(host, kit) {
      const h = kit.h, C = kit.colors(), F = kit.fonts, clamp = kit.clamp, lerp = kit.lerp;
      const frame = kit.frame(host);
      frame.root.classList.add("d-factor-graph-tracking");

      const style = document.createElement("style");
      style.textContent = `
.d-factor-graph-tracking .fgt-view { line-height: 0; }
.d-factor-graph-tracking .fgt-view canvas:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: -3px; }
.d-factor-graph-tracking .fgt-matrix { padding: .5rem .7rem .8rem; border-top: 1px solid var(--stone-3); }
.d-factor-graph-tracking .fgt-matrix .demo__caption { padding: .2rem 0 .5rem; border: 0; }
.d-factor-graph-tracking .fgt-scroll { overflow-x: auto; }
.d-factor-graph-tracking table { width: 100%; border-collapse: separate; border-spacing: 3px; table-layout: fixed; font-family: var(--font-mono); font-size: .76rem; }
.d-factor-graph-tracking th { font-weight: 400; color: var(--parchment-dim); text-align: center; padding: 2px 0; overflow: hidden; white-space: nowrap; line-height: 1.25; }
.d-factor-graph-tracking th:first-child { width: 3.3rem; }
.d-factor-graph-tracking th i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 3px; }
.d-factor-graph-tracking th small { display: block; font-size: .66rem; color: var(--blood-bright); min-height: .8em; }
.d-factor-graph-tracking td { padding: 0; }
.d-factor-graph-tracking td button { display: block; width: 100%; height: 30px; padding: 0; font: inherit; color: var(--parchment); border: 2px solid transparent; border-radius: 2px; cursor: pointer; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
.d-factor-graph-tracking td button.is-chosen { font-weight: 700; outline: 2px solid var(--gold-bright); outline-offset: -2px; box-shadow: 0 0 8px rgba(224,178,70,.55); }
.d-factor-graph-tracking td button.is-selected { border-color: var(--parchment); }
.d-factor-graph-tracking td button:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 1px; }
.d-factor-graph-tracking td button.is-light { color: #17121c; text-shadow: none; }
`;
      frame.root.prepend(style);

      /* ------------------------------ state ------------------------------ */
      let seed = 11, pidCounter = 0;
      const S = {
        prevPersons: [], curPersons: [], prevBoxes: [], curBoxes: [], disp: [],
        nextId: 1, step: 1, tween: null, prevMap: {}
      };
      let rand = kit.rng(seed);
      const wts = { ...W0 };
      let sel = null;               // {j, i} explicit matrix selection, j = -1 for the "new" row
      let playing = !kit.reducedMotion();
      let timer = 0, drag = null;
      const dirty = { prev: true, cur: true };
      let R = null;                 // last inference result

      /* ------------------------- offscreen frames (read-back is allowed: procedural) ------------------------- */
      const mkOff = () => { const c = document.createElement("canvas"); c.width = FW; c.height = FH; return { c, x: c.getContext("2d", { willReadFrequently: true }) }; };
      const prevOff = mkOff(), curOff = mkOff();

      /* ------------------------------ scene drawing ------------------------------ */
      function rr(ctx, x, y, w, hh, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh); }

      function drawBackground(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
        sky.addColorStop(0, "#1c1930"); sky.addColorStop(1, "#3a2f48");
        ctx.fillStyle = sky; ctx.fillRect(0, 0, FW, HORIZON);
        ctx.fillStyle = "rgba(236,226,196,.85)"; ctx.beginPath(); ctx.arc(338, 28, 11, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#1a1722";
        BUILD.forEach(([bx, bw, bh]) => {
          ctx.fillRect(bx, HORIZON - bh - 16, bw, bh + 16);
          for (let r = 0; r < Math.floor((bh + 8) / 13); r++) for (let c = 0; c < Math.floor((bw - 6) / 11); c++) {
            const lit = ((bx + r * 7 + c * 13) % 5) === 0;
            ctx.fillStyle = lit ? "rgba(232,180,80,.75)" : "#262232";
            ctx.fillRect(bx + 5 + c * 11, HORIZON - bh - 10 + r * 13, 5, 7);
          }
          ctx.fillStyle = "#1a1722";
        });
        const pav = ctx.createLinearGradient(0, HORIZON, 0, FH);
        pav.addColorStop(0, "#4a4458"); pav.addColorStop(1, "#2c2838");
        ctx.fillStyle = pav; ctx.fillRect(0, HORIZON, FW, FH - HORIZON);
        ctx.fillStyle = "#615a72"; ctx.fillRect(0, HORIZON, FW, 3);
        ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1;
        for (let k = 1; k < 6; k++) { const yy = HORIZON + (FH - HORIZON) * (k * k) / 36; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(FW, yy); ctx.stroke(); }
        [96, 304].forEach(lx => {
          ctx.strokeStyle = "#0f0d14"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lx, HORIZON + 14); ctx.lineTo(lx, 40); ctx.stroke();
          const g = ctx.createRadialGradient(lx, 38, 1, lx, 38, 46);
          g.addColorStop(0, "rgba(240,190,90,.55)"); g.addColorStop(1, "rgba(240,190,90,0)");
          ctx.fillStyle = g; ctx.fillRect(lx - 48, -8, 96, 92);
          ctx.fillStyle = "#f2c566"; ctx.beginPath(); ctx.arc(lx, 38, 3.5, 0, 6.283); ctx.fill();
        });
      }

      function drawPerson(ctx, p, alpha) {
        const H = hOf(p.y), W = H * 0.42, x = p.x, f = p.y;
        const sw = Math.sin(p.x * 0.16) * W * 0.28;
        const col = "rgb(" + p.col.join(",") + ")";
        const dark = "rgb(" + p.col.map(v => Math.round(v * 0.68)).join(",") + ")";
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(x, f + 1, W * 0.62, H * 0.045, 0, 0, 6.283); ctx.fill();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#1f1c2a"; ctx.lineWidth = W * 0.2;               // legs
        ctx.beginPath(); ctx.moveTo(x - W * 0.12, f - H * 0.38); ctx.lineTo(x - W * 0.12 + sw, f - 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + W * 0.12, f - H * 0.38); ctx.lineTo(x + W * 0.12 - sw, f - 2); ctx.stroke();
        ctx.strokeStyle = dark; ctx.lineWidth = W * 0.15;                  // arms
        ctx.beginPath(); ctx.moveTo(x - W * 0.5, f - H * 0.76); ctx.lineTo(x - W * 0.55 - sw * 0.7, f - H * 0.46); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + W * 0.5, f - H * 0.76); ctx.lineTo(x + W * 0.55 + sw * 0.7, f - H * 0.46); ctx.stroke();
        ctx.fillStyle = col; rr(ctx, x - W * 0.46, f - H * 0.8, W * 0.92, H * 0.45, W * 0.16); ctx.fill();   // torso
        ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(x - W * 0.46 + 2, f - H * 0.78, 2, H * 0.4);
        ctx.fillStyle = "#d6b096"; ctx.beginPath(); ctx.arc(x, f - H * 0.9, H * 0.085, 0, 6.283); ctx.fill();   // head
        ctx.fillStyle = "#18141f"; ctx.beginPath(); ctx.arc(x - p.dir * H * 0.012, f - H * 0.915, H * 0.088, Math.PI, 0); ctx.fill();
        ctx.restore();
      }

      function drawScene(ctx, persons) {
        drawBackground(ctx);
        persons.slice().sort((a, b) => a.y - b.y).forEach(p => drawPerson(ctx, p, p.a === undefined ? 1 : p.a));
      }

      /* ------------------------------ people ------------------------------ */
      function pickColour(used) {
        const free = CLOTHES.map((c, k) => k).filter(k => !used.includes(k));
        const pool = free.length ? free : CLOTHES.map((c, k) => k);
        const k = pool[Math.floor(rand() * pool.length)];
        return k;
      }
      function mkPerson(x, y, used) {
        const ci = pickColour(used);
        return { pid: ++pidCounter, x, y, dir: rand() < 0.5 ? -1 : 1, ci, col: CLOTHES[ci],
          jx: (rand() - 0.5) * 5, jy: (rand() - 0.5) * 5, jw: (rand() - 0.5) * 0.12, jh: (rand() - 0.5) * 0.08 };
      }
      function boxOf(p) {
        const H = hOf(p.y), W = H * 0.42;
        const w = W * 1.45 * (1 + p.jw), hh = (H + 10) * (1 + p.jh);
        return { x: clamp(p.x - w / 2 + p.jx, 0, FW - w), y: clamp(p.y + 4 - hh + p.jy, 0, FH - hh), w, h: hh, pid: p.pid };
      }
      function shuffleArr(a) { for (let k = a.length - 1; k > 0; k--) { const r = Math.floor(rand() * (k + 1)); [a[k], a[r]] = [a[r], a[k]]; } return a; }

      /** People take a step; some walk out, some walk in (the code's "new object" / lost cases). */
      function advance(list) {
        const out = [];
        list.forEach(p => {
          const dir = rand() < 0.08 ? -p.dir : p.dir;
          const q = { ...p, dir, x: p.x + dir * (20 + rand() * 20), y: clamp(p.y + (rand() - 0.5) * 16, 165, 243) };
          if (q.x > -6 && q.x < FW + 6) out.push(q);
        });
        if (out.length > 2 && rand() < 0.18) out.splice(Math.floor(rand() * out.length), 1);
        if (out.length < MAX_PEOPLE && (out.length < 3 || rand() < 0.3)) {
          const e = mkPerson(0, 165 + rand() * 78, out.map(p => p.ci));
          for (let t = 0; t < 8; t++) {   // enter at an edge, away from people already standing there
            e.dir = rand() < 0.5 ? -1 : 1;
            e.x = e.dir > 0 ? 24 + rand() * 20 : FW - 24 - rand() * 20;
            if (out.every(p => Math.abs(p.x - e.x) > 60)) break;
          }
          out.push(e);
        }
        return shuffleArr(out);
      }

      function newScene() {
        rand = kit.rng(seed);
        const n = 3 + Math.floor(rand() * 3), used = [], list = [];
        const slots = shuffleArr([...Array(n).keys()]);
        slots.forEach(k => {
          const p = mkPerson(48 + (k + rand() * 0.6) * (300 / n), 168 + rand() * 72, used);
          used.push(p.ci); list.push(p);
        });
        S.prevPersons = list;
        S.prevBoxes = list.map((p, k) => ({ ...boxOf(p), id: k + 1 }));
        S.nextId = n + 1; S.step = 1; S.tween = null;
        S.curPersons = advance(list);
        S.prevMap = {}; list.forEach(p => { S.prevMap[p.pid] = p; });
        refreshCur();
        sel = null; dirty.prev = true;
      }

      function displayPersons() {
        if (!S.tween) return S.curPersons.map(p => ({ ...p, a: 1 }));
        const t = S.tween.t * S.tween.t * (3 - 2 * S.tween.t);
        return S.curPersons.map(p => {
          const f = S.prevMap[p.pid];
          return f ? { ...p, x: lerp(f.x, p.x, t), y: lerp(f.y, p.y, t), a: 1 } : { ...p, a: t };
        });
      }
      function refreshCur() { S.disp = displayPersons(); S.curBoxes = S.disp.map(boxOf); dirty.cur = true; }

      /* ------------------------------ inference (the code's formulas) ------------------------------ */
      function meanColour(off, b) {
        const cx = clamp(Math.round(b.x + b.w / 2), PATCH, FW - PATCH), cy = clamp(Math.round(b.y + b.h / 2), PATCH, FH - PATCH);
        const d = off.x.getImageData(cx - PATCH, cy - PATCH, 2 * PATCH, 2 * PATCH).data;
        let s = 0; const n = d.length / 4;
        for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
        return { v: s / (3 * n), cx, cy };
      }

      function infer() {
        if (dirty.prev) { prevOff.x.clearRect(0, 0, FW, FH); drawScene(prevOff.x, S.prevPersons); dirty.prev = false; }
        if (dirty.cur) { curOff.x.clearRect(0, 0, FW, FH); drawScene(curOff.x, S.disp); dirty.cur = false; }
        const P = S.prevBoxes, Q = S.curBoxes, n = P.length, m = Q.length;
        const pc = P.map(b => meanColour(prevOff, b)), cc = Q.map(b => meanColour(curOff, b));
        const M = [], parts = [];
        for (let j = 0; j < n; j++) {
          M.push([]); parts.push([]);
          for (let i = 0; i < m; i++) {
            const a = ((1 - Math.abs(P[j].w - Q[i].w) / Q[i].w) + (1 - Math.abs(P[j].h - Q[i].h) / Q[i].h)) / 2;   // size
            const b = ((1 - Math.abs(P[j].x - Q[i].x) / FW) + (1 - Math.abs(P[j].y - Q[i].y) / FH)) / 2;           // distance
            const c = 1 - Math.abs(cc[i].v - pc[j].v) / 255;                                                         // colour
            parts[j].push({ a, b, c });
            M[j].push(wts.size * a + wts.dist * b + wts.colour * c);
          }
        }
        // exact MAP of prod_i phi_i(x_i) * prod_{i<k} psi(x_i, x_k); state 0 = new, k>0 = previous k-1
        let best = -Infinity, choice = [];
        const cur = new Array(m), used = new Array(n).fill(false);
        (function rec(i, score) {
          if (i === m) { if (score > best) { best = score; choice = cur.slice(); } return; }
          for (let k = 0; k <= n; k++) {
            if (k > 0 && used[k - 1]) continue;
            cur[i] = k; if (k > 0) used[k - 1] = true;
            rec(i + 1, score * (k === 0 ? NEW_PRIOR : M[k - 1][i]));
            if (k > 0) used[k - 1] = false;
          }
        })(0, 1);
        let fresh = S.nextId;
        const ids = choice.map(k => (k > 0 ? P[k - 1].id : fresh++));
        R = { n, m, pc, cc, M, parts, choice, ids, score: best };
      }

      /* ------------------------------ canvas ------------------------------ */
      const view = h("div", { class: "fgt-view" });
      frame.stage.append(view);
      let wide = null, cv = null, L = null;

      const trackColour = id => [C.goldBright, C.teal, C.moon, C.bloodBright, C.amber, C.text][(id - 1) % 6];

      function layout() {
        const w = frame.stage.clientWidth || host.clientWidth || window.innerWidth;
        const isWide = w >= 600;
        if (isWide === wide) return false;
        wide = isWide;
        L = isWide
          ? { w: 2 * FW + WIDE_GAP, h: CAP + FH, prev: { x: 0, y: CAP }, cur: { x: FW + WIDE_GAP, y: CAP } }
          : { w: FW, h: CAP + FH + STACK_GAP + FH, prev: { x: 0, y: CAP }, cur: { x: 0, y: CAP + FH + STACK_GAP } };
        view.textContent = "";
        cv = kit.canvas(view, L.w, L.h,
          "Two street frames, previous and current, with numbered bounding boxes and lines linking boxes that the factor graph assigns to the same pedestrian. " +
          "Drag a box in the current frame to move it, drag its bottom-right corner to resize it. Keys: 1 to 5 select a box, arrows move it, plus and minus resize it.");
        cv.canvas.tabIndex = 0;
        cv.canvas.style.cursor = "default";
        bindPointer(cv.canvas);
        return true;
      }

      function tag(ctx, text, x, y, color) {
        ctx.font = "bold 12px " + F.mono;
        const w = Math.ceil(ctx.measureText(text).width) + 8;
        const tx = clamp(x, 0, FW - w), ty = y < 2 ? y + 18 : y;
        ctx.fillStyle = color; ctx.fillRect(tx, ty, w, 16);
        ctx.fillStyle = C.bg; ctx.textBaseline = "middle"; ctx.fillText(text, tx + 4, ty + 8.5);
      }

      function drawBox(ctx, b, color, label, o) {
        ctx.save();
        if (o.glow) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(o.dashed ? [5, 4] : []);
        ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.strokeRect(o.cx - PATCH + 0.5, o.cy - PATCH + 0.5, 2 * PATCH - 1, 2 * PATCH - 1);   // colour sample
        ctx.restore();
        tag(ctx, label, b.x, b.y - 16, color);
        if (o.handle) { ctx.fillStyle = color; ctx.fillRect(b.x + b.w - 7, b.y + b.h - 7, 9, 9); ctx.fillStyle = C.bg; ctx.fillRect(b.x + b.w - 4, b.y + b.h - 4, 3, 3); }
      }

      function framed(ctx, o, fn) { ctx.save(); ctx.translate(o.x, o.y); ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip(); fn(); ctx.restore(); }

      function draw() {
        if (!cv || !R) return;
        const ctx = cv.ctx, P = S.prevBoxes, Q = S.curBoxes;
        ctx.clearRect(0, 0, L.w, L.h);
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, L.w, L.h);
        framed(ctx, L.prev, () => drawScene(ctx, S.prevPersons));
        framed(ctx, L.cur, () => drawScene(ctx, S.disp));
        ctx.strokeStyle = C.line; ctx.lineWidth = 1;
        [L.prev, L.cur].forEach(o => ctx.strokeRect(o.x + 0.5, o.y + 0.5, FW - 1, FH - 1));
        ctx.font = "11px " + F.pixel; ctx.textBaseline = "alphabetic"; ctx.fillStyle = C.dim;
        ctx.fillText("PREVIOUS FRAME  t-1", L.prev.x + 2, L.prev.y - 9);
        ctx.fillText("CURRENT FRAME  t", L.cur.x + 2, L.cur.y - 9);

        const taken = new Set(R.choice.filter(k => k > 0));
        const anchor = (o, b) => ({ x: o.x + b.x + b.w / 2, y: o.y + b.y + b.h / 2 });
        const link = (j, i, color, dashed, wd) => {
          const a = anchor(L.prev, P[j]), z = anchor(L.cur, Q[i]);
          const dx = wide ? (z.x - a.x) * 0.5 : 0, dy = wide ? 0 : (z.y - a.y) * 0.5;
          ctx.save(); ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + dx, a.y + dy, z.x - dx, z.y - dy, z.x, z.y);
          ctx.strokeStyle = "rgba(8,6,12,.65)"; ctx.lineWidth = wd + 3; ctx.setLineDash([]); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = wd; ctx.setLineDash(dashed ? [6, 5] : []); ctx.stroke();
          ctx.setLineDash([]); ctx.fillStyle = color;
          [a, z].forEach(pt => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, 6.283); ctx.fill(); });
          ctx.restore();
        };
        R.choice.forEach((k, i) => { if (k > 0) link(k - 1, i, trackColour(R.ids[i]), false, 2.5); });
        if (sel && sel.j >= 0 && R.choice[sel.i] !== sel.j + 1 && Q[sel.i]) link(sel.j, sel.i, C.text, true, 1.5);

        framed(ctx, L.prev, () => P.forEach((b, j) => {
          const lost = !taken.has(j + 1), on = sel && sel.j === j;
          drawBox(ctx, b, lost ? C.ash : trackColour(b.id), "#" + b.id + (lost ? " lost" : ""), { dashed: lost, glow: on, cx: R.pc[j].cx, cy: R.pc[j].cy });
        }));
        framed(ctx, L.cur, () => Q.forEach((b, i) => {
          const isNew = R.choice[i] === 0, on = sel && sel.i === i;
          drawBox(ctx, b, isNew ? C.bloodBright : trackColour(R.ids[i]), "#" + R.ids[i] + (isNew ? " NEW" : ""),
            { dashed: false, glow: on, handle: !S.tween, cx: R.cc[i].cx, cy: R.cc[i].cy });
        }));
      }

      /* ------------------------------ matrix (HTML table of buttons) ------------------------------ */
      const mxWrap = h("div", { class: "fgt-matrix" });
      const table = h("table", { "aria-label": "Probability matrix: rows are previous boxes, columns are current boxes, last row is the new-object prior" });
      mxWrap.append(
        h("div", { class: "demo__caption" }, "p = w1 size + w2 distance + w3 colour  |  rows: previous, columns: current  |  ✓ = chosen by MAP"),
        h("div", { class: "fgt-scroll" }, table));
      frame.stage.append(mxWrap);
      const mx = { sig: "", colHead: [], rowHead: [], cells: [], newCells: [] };

      table.addEventListener("click", e => {
        const b = e.target.closest("button[data-i]");
        if (!b) return;
        sel = { j: +b.dataset.j, i: +b.dataset.i }; timer = 0;
        render();
      });

      function buildMatrix() {
        const { n, m } = R;
        mx.sig = n + "," + m; mx.colHead = []; mx.rowHead = []; mx.cells = []; mx.newCells = [];
        const th = (scope, ...kids) => h("th", { scope }, ...kids);
        const mkBtn = (j, i) => { const b = h("button", { type: "button", "data-j": j, "data-i": i }); return b; };
        const hr = h("tr", {}, h("th", { scope: "col" }, h("span", { class: "sr-only" }, "previous / current")));
        for (let i = 0; i < m; i++) {
          const sw = h("i", {}), t = h("span", {}), s = h("small", {});
          mx.colHead.push({ sw, t, s });
          hr.append(th("col", sw, t, s));
        }
        const body = h("tbody", {});
        for (let j = 0; j < n; j++) {
          const sw = h("i", {}), t = h("span", {});
          mx.rowHead.push({ sw, t });
          const tr = h("tr", {}, th("row", sw, t));
          mx.cells.push([]);
          for (let i = 0; i < m; i++) { const b = mkBtn(j, i); mx.cells[j].push(b); tr.append(h("td", {}, b)); }
          body.append(tr);
        }
        const nr = h("tr", {}, th("row", "new"));
        for (let i = 0; i < m; i++) { const b = mkBtn(-1, i); mx.newCells.push(b); nr.append(h("td", {}, b)); }
        body.append(nr);
        table.replaceChildren(h("thead", {}, hr), body);
      }

      function heat(v) {
        const t = clamp(v, 0, 1);
        for (let k = 1; k < STOPS.length; k++) {
          if (t <= STOPS[k][0]) {
            const [t0, c0] = STOPS[k - 1], [t1, c1] = STOPS[k], u = (t - t0) / (t1 - t0);
            return "rgb(" + c0.map((v0, q) => Math.round(lerp(v0, c1[q], u))).join(",") + ")";
          }
        }
        return "rgb(" + STOPS[STOPS.length - 1][1].join(",") + ")";
      }

      function paintCell(b, v, j, i, label) {
        const chosen = R.choice[i] === j + 1, on = sel && sel.i === i && sel.j === j;
        b.textContent = (chosen ? "✓ " : "") + v.toFixed(2);
        b.style.background = heat(v);
        b.className = (chosen ? "is-chosen " : "") + (on ? "is-selected " : "") + (v >= 0.88 ? "is-light" : "");
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.setAttribute("aria-label", label + ": " + v.toFixed(3) + (chosen ? ", chosen" : ""));
      }

      function updateMatrix() {
        if (mx.sig !== R.n + "," + R.m) buildMatrix();
        const P = S.prevBoxes;
        for (let i = 0; i < R.m; i++) {
          const nw = R.choice[i] === 0, hd = mx.colHead[i];
          hd.sw.style.background = nw ? C.bloodBright : trackColour(R.ids[i]);
          hd.t.textContent = "#" + R.ids[i]; hd.s.textContent = nw ? "new" : "";
        }
        for (let j = 0; j < R.n; j++) {
          mx.rowHead[j].sw.style.background = trackColour(P[j].id);
          mx.rowHead[j].t.textContent = "#" + P[j].id;
          for (let i = 0; i < R.m; i++) paintCell(mx.cells[j][i], R.M[j][i], j, i, "Previous #" + P[j].id + " versus current #" + R.ids[i]);
        }
        for (let i = 0; i < R.m; i++) paintCell(mx.newCells[i], NEW_PRIOR, -1, i, "Current #" + R.ids[i] + " as a new object");
      }

      /* ------------------------------ readout ------------------------------ */
      const f2 = v => v.toFixed(2), f3 = v => v.toFixed(3);
      function describe(j, i) {
        const P = S.prevBoxes, pt = R.parts[j][i];
        const cs = wts.size * pt.a, cd = wts.dist * pt.b, cc = wts.colour * pt.c;
        return "previous #" + P[j].id + " → current #" + R.ids[i] + ": p = " + f3(cs + cd + cc) +
          "\n   size " + f2(wts.size) + "×" + f2(pt.a) + " = " + f3(cs) +
          "  |  distance " + f2(wts.dist) + "×" + f2(pt.b) + " = " + f3(cd) +
          "  |  colour " + f2(wts.colour) + "×" + f2(pt.c) + " = " + f3(cc) +
          "  (centre brightness " + Math.round(R.pc[j].v) + " vs " + Math.round(R.cc[i].v) + ")";
      }

      let lastText = "";
      function updateReadout() {
        const P = S.prevBoxes, lines = [];
        const sum = wts.size + wts.dist + wts.colour;
        lines.push("Step " + S.step + "  |  " + R.n + " previous, " + R.m + " current boxes  |  weights sum " + f2(sum) + "  |  new-object prior " + f2(NEW_PRIOR));
        if (R.m === 0) lines.push("The current frame is empty, nothing to assign.");
        else {
          let top = -1;
          R.choice.forEach((k, i) => { if (k > 0 && (top < 0 || R.M[k - 1][i] > R.M[R.choice[top] - 1][top])) top = i; });
          if (top < 0) lines.push(R.n ? "Top assignment: none. No previous box beats the " + f2(NEW_PRIOR) + " new-object prior, so every box is a new object." : "Previous frame is empty, so every box is a new object.");
          else lines.push("Top assignment: " + describe(R.choice[top] - 1, top) + "\n   beats the " + f2(NEW_PRIOR) + " new-object prior");
          if (sel && sel.i < R.m) {
            if (sel.j < 0) {
              let bj = -1; for (let j = 0; j < R.n; j++) if (bj < 0 || R.M[j][sel.i] > R.M[bj][sel.i]) bj = j;
              lines.push("Selected: current #" + R.ids[sel.i] + " as new object (" + f2(NEW_PRIOR) + ")" + (bj >= 0 ? ", best candidate previous #" + P[bj].id + " at p = " + f3(R.M[bj][sel.i]) : "") + (R.choice[sel.i] === 0 ? " [chosen]" : " [not chosen]"));
            } else lines.push("Selected: " + describe(sel.j, sel.i) + (R.choice[sel.i] === sel.j + 1 ? " [chosen]" : " [not chosen]"));
          }
          // where the one-to-one constraint overrode a column maximum
          R.choice.forEach((k, i) => {
            let bj = -1; for (let j = 0; j < R.n; j++) if (R.M[j][i] > NEW_PRIOR && (bj < 0 || R.M[j][i] > R.M[bj][i])) bj = j;
            if (bj + 1 !== k) lines.push("One-to-one constraint: current #" + R.ids[i] + " gave up " + (bj >= 0 ? "its best candidate #" + P[bj].id : "a match") + " to a better joint assignment.");
          });
          const parts = R.choice.map((k, i) => (k > 0 ? "#" + R.ids[i] + " ← #" + P[k - 1].id + " (" + f2(R.M[k - 1][i]) + ")" : "#" + R.ids[i] + " NEW"));
          const lost = P.map((b, j) => (R.choice.includes(j + 1) ? null : "#" + b.id)).filter(Boolean);
          lines.push("Result: " + parts.join("  ") + (lost.length ? "  |  lost: " + lost.join(" ") : "") + "  |  joint score " + f3(R.score));
        }
        const text = lines.join("\n");
        if (text !== lastText) { frame.readout.textContent = text; lastText = text; }
      }

      function render() { infer(); draw(); updateMatrix(); updateReadout(); }

      /* ------------------------------ interaction ------------------------------ */
      function curLocal(e) {
        const p = cv.toLocal(e);
        return { x: p.x - L.cur.x, y: p.y - L.cur.y };
      }
      function hit(q) {
        for (let i = S.curBoxes.length - 1; i >= 0; i--) {
          const b = S.curBoxes[i];
          if (q.x >= b.x + b.w - HANDLE && q.x <= b.x + b.w + 6 && q.y >= b.y + b.h - HANDLE && q.y <= b.y + b.h + 6) return { i, mode: "resize" };
        }
        for (let i = S.curBoxes.length - 1; i >= 0; i--) {
          const b = S.curBoxes[i];
          if (q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) return { i, mode: "move" };
        }
        return null;
      }
      function selectBox(i) { const k = R.choice[i]; sel = { j: k > 0 ? k - 1 : -1, i }; }

      function bindPointer(canvas) {
        canvas.addEventListener("pointerdown", e => {
          if (S.tween) return;
          const q = curLocal(e), t = hit(q);
          if (!t) return;
          e.preventDefault(); timer = 0;
          try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
          const b = S.curBoxes[t.i];
          drag = { i: t.i, mode: t.mode, dx: q.x - b.x, dy: q.y - b.y, id: e.pointerId };
          selectBox(t.i); canvas.focus({ preventScroll: true }); render();
        });
        canvas.addEventListener("pointermove", e => {
          const q = curLocal(e);
          if (!drag) { const t = !S.tween && hit(q); canvas.style.cursor = t ? (t.mode === "resize" ? "nwse-resize" : "grab") : "default"; return; }
          if (e.pointerId !== drag.id) return;
          timer = 0;
          const b = S.curBoxes[drag.i];
          if (drag.mode === "move") { b.x = clamp(q.x - drag.dx, 0, FW - b.w); b.y = clamp(q.y - drag.dy, 0, FH - b.h); }
          else { b.w = clamp(q.x - b.x, 16, FW - b.x); b.h = clamp(q.y - b.y, 24, FH - b.y); }
          selectBox(drag.i); render();
        });
        const end = e => { if (drag && e.pointerId === drag.id) { drag = null; render(); } };
        canvas.addEventListener("pointerup", end);
        canvas.addEventListener("pointercancel", end);
        canvas.addEventListener("keydown", e => {
          if (S.tween || !S.curBoxes.length) return;
          const d = e.shiftKey ? 16 : 4;
          if (/^[1-9]$/.test(e.key)) { const i = +e.key - 1; if (i < S.curBoxes.length) { selectBox(i); render(); e.preventDefault(); } return; }
          if (!sel) selectBox(0);
          const b = S.curBoxes[sel.i]; if (!b) return;
          const act = {
            ArrowLeft: () => { b.x = clamp(b.x - d, 0, FW - b.w); }, ArrowRight: () => { b.x = clamp(b.x + d, 0, FW - b.w); },
            ArrowUp: () => { b.y = clamp(b.y - d, 0, FH - b.h); }, ArrowDown: () => { b.y = clamp(b.y + d, 0, FH - b.h); },
            "+": () => { b.w = clamp(b.w + d, 16, FW - b.x); b.h = clamp(b.h + d * 1.5, 24, FH - b.y); }, "=": () => { b.w = clamp(b.w + d, 16, FW - b.x); b.h = clamp(b.h + d * 1.5, 24, FH - b.y); },
            "-": () => { b.w = clamp(b.w - d, 16, FW - b.x); b.h = clamp(b.h - d * 1.5, 24, FH - b.y); }
          }[e.key];
          if (!act) return;
          e.preventDefault(); act(); timer = 0; selectBox(sel.i); render();
        });
      }

      /* ------------------------------ controls ------------------------------ */
      const sliders = {};
      const mkSlider = (key, label) => {
        sliders[key] = kit.slider(frame.controls, {
          label, min: 0, max: 1, step: 0.05, value: wts[key], format: v => v.toFixed(2),
          onInput: v => { wts[key] = v; timer = 0; render(); }
        });
      };
      mkSlider("size", "Size weight");
      mkSlider("dist", "Distance weight");
      mkSlider("colour", "Colour weight");

      const btns = h("div", { class: "demo__buttons" });
      frame.controls.append(btns);

      function nextFrame() {
        timer = 0; drag = null;
        if (S.tween) { S.tween = null; refreshCur(); infer(); }
        S.prevPersons = S.curPersons;
        S.prevMap = {}; S.curPersons.forEach(p => { S.prevMap[p.pid] = p; });
        S.prevBoxes = S.curBoxes.map((b, i) => ({ x: b.x, y: b.y, w: b.w, h: b.h, id: R.ids[i] }));
        S.nextId = Math.max(S.nextId, ...R.ids, 0) + 1;
        S.step++; sel = null; dirty.prev = true;
        S.curPersons = advance(S.prevPersons);
        S.tween = kit.reducedMotion() ? null : { t: 0 };
        refreshCur(); render();
        if (S.tween) loop.start();
      }

      kit.button(btns, "Next frame", nextFrame, "blood");
      const playBtn = kit.button(btns, playing ? "Pause" : "Play", () => {
        playing = !playing; timer = 0; playBtn.textContent = playing ? "Pause" : "Play";
        if (playing) loop.start(); else if (!S.tween) loop.stop();
      }, "ghost");
      kit.button(btns, "Shuffle", () => { seed++; timer = 0; drag = null; newScene(); render(); }, "ghost");
      kit.button(btns, "Reset weights", () => {
        Object.keys(W0).forEach(k => { wts[k] = W0[k]; sliders[k].value = W0[k]; sliders[k].dispatchEvent(new Event("input")); });
      }, "ghost");

      kit.legend(frame.root, [
        { color: C.goldBright, label: "assigned: keeps previous ID (colour per ID)" },
        { color: C.bloodBright, label: "NEW: no match beats the 0.8 prior" },
        { color: C.ash, label: "lost previous box" },
        { color: "#ffffff", label: "dashed 20×20 square: centre colour sample" }
      ]);
      frame.root.append(frame.readout);

      /* ------------------------------ loop ------------------------------ */
      const loop = kit.loop(frame.stage, dt => {
        if (S.tween) {
          S.tween.t = Math.min(1, S.tween.t + dt / TWEEN);
          if (S.tween.t >= 1) S.tween = null;
          refreshCur(); render();
        } else if (playing && !drag) {
          timer += dt;
          if (timer >= INTERVAL) nextFrame();
        }
        if (!S.tween && !playing) loop.stop();
      });

      /* ------------------------------ boot ------------------------------ */
      newScene();
      layout();
      render();
      let ro = null;
      const onResize = () => { if (layout()) draw(); };
      if ("ResizeObserver" in window) { ro = new ResizeObserver(onResize); ro.observe(frame.stage); }
      else window.addEventListener("resize", onResize);
      if (playing) loop.start();

      return () => {
        loop.destroy();
        if (ro) ro.disconnect(); else window.removeEventListener("resize", onResize);
        frame.root.remove();
      };
    }
  });
})();
