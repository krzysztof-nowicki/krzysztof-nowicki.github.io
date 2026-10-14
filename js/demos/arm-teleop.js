/*
 * Demo: arm-teleop
 * Browser simulation of the thesis pipeline (teleop.py): two RGB cameras -> keypoints
 * (shoulder, elbow, wrist) -> stereo triangulation (DLT) -> robot workspace -> UR5 arm.
 */
(function () {
  "use strict";

  PortfolioDemos.register("arm-teleop", {
    title: "Arm teleoperation, stereo to UR5",
    note: "Simulation of the thesis pipeline (the real script maps limb angles directly to joints; here the wrist is scaled and solved with IK): drag the wrist or elbow in the left camera, change the depth, or drag in the top-down rig view, and watch disparity, triangulation and the UR5 follow. Raise detector noise to see how depth error grows with distance, or drop the wrist low to trigger the safety reset.",
    mount(host, kit) {
      const c = kit.colors();
      const F = kit.fonts;
      const h = kit.h;
      const clamp = kit.clamp;

      /* ---------------- constants ---------------- */
      // Stereo rig (illustrative values; the real rig was calibrated with a checkerboard)
      const IW = 320, IH = 240;           // logical canvas size of every view
      const FOC = 300, CX = 160, CY = 120; // focal length and principal point in px
      const BASE = 0.30;                   // baseline B in metres
      // Operator arm (metres): shoulder is fixed, bone lengths are enforced
      const L1 = 0.30, L2 = 0.27;
      const SH = [-0.05, -0.12, 2.0];      // right shoulder in left-camera coordinates (X right, Y down, Z forward)
      const E0 = [-0.22, 0.18, -0.08];     // default elbow offset from shoulder
      const W0 = [-0.28, -0.02, -0.25];     // default wrist offset from shoulder
      // UR5 (DH values from robot_move.py) and limits from teleop.py
      const D1 = 0.089159, A2 = 0.425, A3 = 0.39225;
      const MOUNT = [0, -0.25, 1.2];       // assumed arm mount in base_link
      const HEIGHT_LIMIT = 0.9;            // if height_limiter < 0.9 -> go back to start
      const X_LIMIT = 0.1, Y_LIMIT = -0.4; // if x < 0.1 and y > -0.4 -> go back to start
      const Q1_MIN = -1.25, Q1_MAX = 3.5;  // order1 clamp
      const TARGET_OFFSET = [0.15, 0, 0];
      const HOME_Q = [0, 0, 0];
      const SHOULDER_POS = [MOUNT[0], MOUNT[1], MOUNT[2] + D1];
      const REACH = A2 + A3;
      const KP = [
        { key: "S", name: "shoulder", color: c.teal, base: 0.98 },
        { key: "E", name: "elbow", color: c.candle, base: 0.95 },
        { key: "W", name: "wrist", color: c.bloodBright, base: 0.92 }
      ];

      /* ---------------- vector helpers ---------------- */
      const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const len = a => Math.hypot(a[0], a[1], a[2]);
      const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
      const deg = r => r * 180 / Math.PI;
      const wrapPi = a => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
      const rgba = (hex, a) => {
        const n = parseInt(hex.slice(1), 16);
        return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
      };
      const f1 = v => (v >= 0 ? " " : "") + v.toFixed(1);
      const f2 = v => (v >= 0 ? " " : "") + v.toFixed(2);

      /* ---------------- state ---------------- */
      const st = {
        W: add(SH, W0),
        pole: norm(E0),
        sigma: 0.5,
        k: 1.5,
        wave: false,
        wt: 0,
        qCur: HOME_Q.slice(),
        qGoal: HOME_Q.slice(),
        drag: null
      };
      const rand = kit.rng(7);
      const noiseDir = [0, 1].map(() => KP.map(() => { const a = rand() * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; }));
      let calc = null;
      let lastReadout = -1;
      let dirty = true;

      /* ---------------- operator arm model ---------------- */
      function elbowOf(W, pole) {
        const a = sub(W, SH);
        const d = clamp(len(a), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
        const ah = norm(a);
        let p = sub(pole, mul(ah, dot(pole, ah)));
        if (len(p) < 1e-4) p = sub([0, 1, 0], mul(ah, ah[1]));
        if (len(p) < 1e-4) p = sub([0, 0, 1], mul(ah, ah[2]));
        p = norm(p);
        const x = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
        const hh = Math.sqrt(Math.max(0, L1 * L1 - x * x));
        return add(add(SH, mul(ah, x)), mul(p, hh));
      }

      function setWrist(W) {
        let a = sub(W, SH);
        const l = len(a);
        const lo = 0.1, hi = L1 + L2 - 0.012;
        if (l > hi) a = mul(a, hi / l);
        else if (l < lo) a = l < 1e-6 ? [0, 0, -lo] : mul(a, lo / l);
        st.W = add(SH, a);
        const ah = norm(a);
        const p = sub(st.pole, mul(ah, dot(st.pole, ah)));
        if (len(p) > 1e-3) st.pole = norm(p);
        syncDepthSlider();
      }

      /* ---------------- camera model ---------------- */
      const project = (P, cam) => [CX + FOC * (P[0] - cam * BASE) / P[2], CY + FOC * P[1] / P[2]];
      const rayDir = (u, v) => [(u - CX) / FOC, (v - CY) / FOC, 1];

      // DLT as in teleop.py: rows built from P1, P2 and the two pixels. teleop.py takes the
      // SVD null vector; here the same four rows are solved as a 3x3 linear least squares.
      const P1 = [[FOC, 0, CX, 0], [0, FOC, CY, 0], [0, 0, 1, 0]];
      const P2 = [[FOC, 0, CX, -FOC * BASE], [0, FOC, CY, 0], [0, 0, 1, 0]];
      function dlt(p1, p2) {
        const A = [
          P1[2].map((v, i) => p1[1] * v - P1[1][i]),
          P1[0].map((v, i) => v - p1[0] * P1[2][i]),
          P2[2].map((v, i) => p2[1] * v - P2[1][i]),
          P2[0].map((v, i) => v - p2[0] * P2[2][i])
        ];
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
        for (const r of A) {
          for (let i = 0; i < 3; i++) {
            b[i] -= r[i] * r[3];
            for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
          }
        }
        const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        const D = det3(M) || 1e-9;
        return [0, 1, 2].map(col => det3(M.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)))) / D);
      }

      /* ---------------- robot kinematics ---------------- */
      function solveIK(T) {
        const dx = T[0] - SHOULDER_POS[0], dy = T[1] - SHOULDER_POS[1], dz = T[2] - SHOULDER_POS[2];
        let q1 = Math.atan2(dy, dx);
        let clampedPan = false;
        if (q1 < Q1_MIN) { q1 = Q1_MIN; clampedPan = true; }
        if (q1 > Q1_MAX) { q1 = Q1_MAX; clampedPan = true; }
        const rho = dx * Math.cos(q1) + dy * Math.sin(q1);
        let d = Math.hypot(rho, dz);
        const dMax = REACH - 0.005, dMin = Math.abs(A2 - A3) + 0.02;
        const clampedReach = d > dMax || d < dMin;
        const dc = clamp(d, dMin, dMax);
        const alpha = Math.atan2(dz, rho);
        const beta = Math.acos(clamp((A2 * A2 + dc * dc - A3 * A3) / (2 * A2 * dc), -1, 1));
        const gamma = Math.acos(clamp((A2 * A2 + A3 * A3 - dc * dc) / (2 * A2 * A3), -1, 1));
        const q2 = alpha + beta;                // link 1 above horizontal (elbow up)
        const q3 = -(Math.PI - gamma);          // relative elbow joint
        return { q: [wrapPi(q1), wrapPi(q2), wrapPi(q3)], clampedPan, clampedReach };
      }
      function fk(q) {
        const c1 = Math.cos(q[0]), s1 = Math.sin(q[0]);
        const t1 = q[1], t2 = q[1] + q[2];
        const elbow = [SHOULDER_POS[0] + A2 * Math.cos(t1) * c1, SHOULDER_POS[1] + A2 * Math.cos(t1) * s1, SHOULDER_POS[2] + A2 * Math.sin(t1)];
        const tcp = [elbow[0] + A3 * Math.cos(t2) * c1, elbow[1] + A3 * Math.cos(t2) * s1, elbow[2] + A3 * Math.sin(t2)];
        return { shoulder: SHOULDER_POS, elbow, tcp };
      }

      /* ---------------- per-frame computation ---------------- */
      function compute() {
        const E = elbowOf(st.W, st.pole);
        const pts = [SH, E, st.W];
        const det = [0, 1].map(cam => pts.map((P, i) => {
          const [u, v] = project(P, cam);
          const n = noiseDir[cam][i];
          return [u + n[0] * st.sigma, v + n[1] * st.sigma];
        }));
        const conf = pts.map((P, i) => {
          const [u, v] = project(P, 0);
          const edge = clamp(Math.min(u, IW - u, v, IH - v) / 24, 0.3, 1);
          return clamp(KP[i].base * Math.exp(-st.sigma / 8) * (1 - 0.15 * clamp((P[2] - 1.7) / 1.0, 0, 1)) * edge, 0.05, 0.99);
        });
        const tri = [0, 1, 2].map(i => dlt(det[0][i], det[1][i]));
        const disp = det[0][2][0] - det[1][2][0];
        const zFromD = disp > 0.2 ? FOC * BASE / disp : Infinity;

        // limb angles exactly as in teleop.py (camera frame)
        const v1 = sub(tri[1], tri[0]), v2 = sub(tri[2], tri[1]);
        const a1 = -Math.asin(clamp(v1[1] / len(v1), -1, 1));
        const a2 = Math.atan2(v1[2], v1[0]);
        const a3 = -Math.asin(clamp(v2[1] / len(v2), -1, 1));

        // operator wrist relative to shoulder -> robot frame (x forward, y left, z up), then scale
        const r = sub(tri[2], tri[0]);
        const rr = [-r[2], r[0], -r[1]];
        const target = add(add(SHOULDER_POS, mul(rr, st.k)), TARGET_OFFSET);
        const ik = solveIK(target);
        const tcp = fk(ik.q).tcp;
        const lowZ = tcp[2] < HEIGHT_LIMIT;
        const body = tcp[0] < X_LIMIT && tcp[1] > Y_LIMIT;
        let status = "tracking";
        if (lowZ) status = "SAFETY: TCP below " + HEIGHT_LIMIT + " m, returning to start";
        else if (body) status = "SAFETY: TCP too close to the base, returning to start";
        else if (ik.clampedReach) status = "target outside UR5 reach, clamped";
        else if (ik.clampedPan) status = "base yaw clamped to [" + Q1_MIN + ", " + Q1_MAX + "] rad";
        const safety = lowZ || body;
        st.qGoal = safety ? HOME_Q.slice() : ik.q;
        calc = { E, pts, det, conf, tri, disp, zFromD, a1, a2, a3, target, ikq: ik.q, tcp, status, safety };
        return calc;
      }

      /* ---------------- DOM ---------------- */
      if (!document.getElementById("d-arm-teleop-style")) {
        const style = document.createElement("style");
        style.id = "d-arm-teleop-style";
        style.textContent =
          ".d-arm-teleop .at-grid{display:grid;grid-template-columns:1fr;gap:.6rem;padding:.6rem}" +
          "@media (min-width:560px){.d-arm-teleop .at-grid{grid-template-columns:repeat(4,1fr)}.d-arm-teleop .at-cell{grid-column:span 2}.d-arm-teleop .at-cell:last-child{grid-column:2 / span 2}}" +
          "@media (min-width:900px){.d-arm-teleop .at-grid{grid-template-columns:repeat(6,1fr)}.d-arm-teleop .at-cell:nth-child(4){grid-column:2 / span 2}.d-arm-teleop .at-cell:last-child{grid-column:span 2}}" +
          ".d-arm-teleop .at-cell canvas{touch-action:pan-y}" +
          ".d-arm-teleop .at-cell{min-width:0;border:1px solid var(--stone-2);background:var(--night-1)}" +
          ".d-arm-teleop .at-cell canvas{outline-offset:-2px}" +
          ".d-arm-teleop .at-cell canvas:focus-visible{outline:2px solid var(--gold-bright)}" +
          ".d-arm-teleop .demo__readout{overflow-wrap:anywhere}";
        document.head.append(style);
      }

      const frame = kit.frame(host);
      frame.root.classList.add("d-arm-teleop");
      const grid = h("div", { class: "at-grid" });
      frame.stage.append(grid);
      const mkView = (title, label, tabindex) => {
        const cell = h("div", { class: "at-cell" }, h("div", { class: "demo__caption" }, title));
        grid.append(cell);
        const g = kit.canvas(cell, IW, IH, label);
        if (tabindex) g.canvas.tabIndex = 0;
        return g;
      };
      const gL = mkView("Left cam", "Left camera view with the operator arm, keypoint heatmaps and confidences. Drag the wrist or elbow, or focus and use arrow keys to move the wrist.", true);
      const gR = mkView("Right cam", "Right camera view of the same arm, showing the stereo disparity.");
      const gT = mkView("Stereo rig, top-down", "Top-down view of the two cameras, the operator arm and the triangulated wrist. Drag the wrist or elbow to change depth.");
      const gS = mkView("UR5, side view", "Side view of the UR5 following the operator wrist.");
      const gP = mkView("UR5, top view", "Top view of the UR5 with the forbidden zone near the robot base.");

      const wristZSlider = kit.slider(frame.controls, {
        label: "Wrist distance Z (m)", min: 1.45, max: 2.6, step: 0.01, value: st.W[2], format: v => v.toFixed(2),
        onInput(v) {
          stopWave();
          const d = project(st.W, 0);
          const dd = rayDir(d[0], d[1]);
          setWrist([dd[0] * v, dd[1] * v, v]);
          update();
        }
      });
      kit.slider(frame.controls, {
        label: "Detector noise (px)", min: 0, max: 4, step: 0.1, value: st.sigma, format: v => v.toFixed(1),
        onInput(v) { st.sigma = v; update(); }
      });
      kit.slider(frame.controls, {
        label: "Workspace scale k", min: 1, max: 2.2, step: 0.05, value: st.k, format: v => v.toFixed(2),
        onInput(v) { st.k = v; update(); }
      });
      const buttons = h("div", { class: "demo__buttons" });
      frame.controls.append(buttons);
      const waveBtn = kit.button(buttons, "Auto wave", () => { st.wave ? stopWave() : startWave(); }, "blood");
      waveBtn.setAttribute("aria-pressed", "false");
      kit.button(buttons, "Reset", () => {
        stopWave();
        st.W = add(SH, W0); st.pole = norm(E0); st.sigma = 0.5; st.k = 1.5;
        const ins = frame.controls.querySelectorAll("input[type=range]");
        [[ins[1], 0.5, "0.5"], [ins[2], 1.5, "1.50"]].forEach(([el, v, t]) => { el.value = v; el.parentNode.querySelector("output").textContent = t; });
        syncDepthSlider();
        update();
        if (!loop.running) { st.qCur = st.qGoal.slice(); render(); }
      }, "ghost");
      kit.legend(frame.root, [
        { color: c.teal, label: "shoulder" }, { color: c.candle, label: "elbow" }, { color: c.bloodBright, label: "wrist" },
        { color: c.gold, label: "triangulated wrist / robot target" }, { color: c.blood, label: "robot no-go zone" }
      ]);
      frame.root.insertBefore(frame.root.lastChild, frame.readout);

      function syncDepthSlider() {
        wristZSlider.value = st.W[2];
        wristZSlider.parentNode.querySelector("output").textContent = st.W[2].toFixed(2);
      }

      /* ---------------- drawing helpers ---------------- */
      function text(ctx, s, x, y, color, size, align) {
        ctx.font = (size || 10) + "px " + F.mono;
        ctx.fillStyle = color || c.dim;
        ctx.textAlign = align || "left";
        ctx.textBaseline = "middle";
        ctx.fillText(s, x, y);
      }
      function pill(ctx, s, x, y, color, align) {
        ctx.font = "10px " + F.mono;
        const w = ctx.measureText(s).width + 8;
        const x0 = align === "right" ? x - w : x;
        ctx.fillStyle = "rgba(7,8,12,.78)";
        ctx.fillRect(x0, y - 8, w, 16);
        text(ctx, s, x0 + 4, y, color, 10, "left");
      }
      function seg(ctx, a, b, color, w, dash) {
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
        ctx.stroke(); ctx.setLineDash([]);
      }
      function dot2(ctx, p, r, fill, stroke, sw) {
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw || 1.5; ctx.stroke(); }
      }
      function panelBg(g) {
        const ctx = g.ctx;
        ctx.clearRect(0, 0, IW, IH);
        const gr = ctx.createLinearGradient(0, 0, 0, IH);
        gr.addColorStop(0, "#10111a"); gr.addColorStop(1, c.bg);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, IW, IH);
      }

      /* ---------------- camera views ---------------- */
      function drawCam(g, cam) {
        const ctx = g.ctx, d = calc;
        panelBg(g);
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, IW, IH); ctx.clip();
        // candle glow
        const gl = ctx.createRadialGradient(IW * 0.85, 20, 0, IW * 0.85, 20, 150);
        gl.addColorStop(0, rgba(c.candle, 0.13)); gl.addColorStop(1, rgba(c.candle, 0));
        ctx.fillStyle = gl; ctx.fillRect(0, 0, IW, IH);
        // back wall and floor (give the parallax between the two views)
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(c.grid, 0.9);
        for (let X = -4.5; X <= 4.5; X += 0.75) {
          const u = CX + FOCS(X - cam * BASE, 4.5);
          seg(ctx, [u, 0], [u, CY + FOC * 0.9 / 4.5], rgba(c.grid, 0.55), 1);
        }
        [2.6, 3.0, 3.6, 4.5, 7, 12].forEach(Z => { const v = CY + FOC * 0.9 / Z; seg(ctx, [0, v], [IW, v], rgba(c.line, 0.5), 1); });
        for (let X = -3; X <= 3; X += 0.75) {
          const a = [CX + FOCS(X - cam * BASE, 2.4), CY + FOC * 0.9 / 2.4];
          const b = [CX + FOCS(X - cam * BASE, 16), CY + FOC * 0.9 / 16];
          seg(ctx, a, b, rgba(c.line, 0.5), 1);
        }
        // operator body
        const S = SH, LS = add(S, [0.4, 0, 0]);
        const hipL = add(S, [0.34, 0.62, 0]), hipR = add(S, [0.07, 0.62, 0]);
        const P = p => project(p, cam);
        const torso = [P(S), P(LS), P(hipL), P(hipR)];
        ctx.beginPath(); torso.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
        ctx.fillStyle = rgba(c.panel, 0.95); ctx.fill(); ctx.strokeStyle = rgba(c.line, 1); ctx.lineWidth = 1; ctx.stroke();
        const headP = P(add(S, [0.2, -0.27, 0]));
        dot2(ctx, headP, FOC * 0.1 / S[2], rgba(c.panel, 1), c.line, 1);
        seg(ctx, P(add(S, [0.2, -0.17, 0])), P(add(S, [0.2, 0, 0])), c.line, 3);
        const lw = FOC * 0.075 / S[2];
        const lel = add(LS, [0.02, 0.29, 0]), lwr = add(LS, [0.03, 0.56, 0]);
        seg(ctx, P(LS), P(lel), c.line, lw); seg(ctx, P(lel), P(lwr), c.line, lw * 0.85);
        // tracked arm (true pose)
        const [pS, pE, pW] = d.pts.map(P);
        const th = P_ => FOC * 0.075 / P_[2];
        seg(ctx, pS, pE, rgba(c.line, 1), th(d.pts[1]) + 2); seg(ctx, pE, pW, rgba(c.line, 1), th(d.pts[2]));
        dot2(ctx, pW, FOC * 0.05 / d.pts[2][2], rgba(c.line, 1));
        // epipolar row of the wrist
        const dw = d.det[cam][2];
        seg(ctx, [0, dw[1]], [IW, dw[1]], rgba(c.gold, 0.35), 1, [3, 5]);
        // heatmap blobs from the detected keypoints
        ctx.globalCompositeOperation = "lighter";
        d.det[cam].forEach((p, i) => {
          const sig = 5 + st.sigma * 1.5 + (1 - d.conf[i]) * 10;
          const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], sig * 2.6);
          gr.addColorStop(0, rgba(KP[i].color, 0.85 * d.conf[i])); gr.addColorStop(0.45, rgba(KP[i].color, 0.28 * d.conf[i])); gr.addColorStop(1, rgba(KP[i].color, 0));
          ctx.fillStyle = gr; ctx.fillRect(p[0] - sig * 2.6, p[1] - sig * 2.6, sig * 5.2, sig * 5.2);
        });
        ctx.globalCompositeOperation = "source-over";
        // skeleton overlay
        const dS = d.det[cam][0], dE = d.det[cam][1];
        seg(ctx, dS, dE, rgba(c.goldBright, 0.9), 1.6); seg(ctx, dE, dw, rgba(c.goldBright, 0.9), 1.6);
        d.det[cam].forEach((p, i) => {
          dot2(ctx, p, 3, KP[i].color, c.text, 1);
          const lo = [[10, -14], [10, 14], [-64, -14]][i];
          const lx = clamp(p[0] + lo[0], 4, IW - 62), ly = clamp(p[1] + lo[1], 10, IH - 10);
          pill(ctx, KP[i].key + " " + d.conf[i].toFixed(2), lx, ly, KP[i].color);
        });
        if (cam === 0) {
          // draggable handles
          [pE, pW].forEach(p => dot2(ctx, p, 13, null, rgba(c.gold, 0.8), 1.2));
          ctx.setLineDash([]);
          pill(ctx, "drag wrist / elbow", 6, IH - 12, c.dim);
        } else {
          // disparity bracket
          const uL = d.det[0][2][0], uR = dw[0];
          const yb = clamp(dw[1] + 22, 14, IH - 14);
          seg(ctx, [uL, dw[1]], [uL, yb], rgba(c.gold, 0.7), 1, [2, 3]);
          seg(ctx, [uR, dw[1]], [uR, yb], rgba(c.gold, 0.7), 1);
          seg(ctx, [uL, yb], [uR, yb], c.goldBright, 1.5);
          pill(ctx, "d = " + d.disp.toFixed(1) + " px", clamp((uL + uR) / 2 - 36, 4, IW - 80), clamp(yb + 12, 10, IH - 10), c.goldBright);
          dot2(ctx, [uL, dw[1]], 3, null, rgba(c.gold, 0.8), 1);
        }
        text(ctx, cam ? "RIGHT  x=" + dw[0].toFixed(1) + " y=" + dw[1].toFixed(1) : "LEFT  x=" + dw[0].toFixed(1) + " y=" + dw[1].toFixed(1), 6, 10, c.ash, 10);
        ctx.restore();
      }
      function FOCS(X, Z) { return FOC * X / Z; }

      /* ---------------- top-down rig view ---------------- */
      const TS = 76, TX0 = 0.15, TYB = 226;
      const rigPx = (X, Z) => [160 + (X - TX0) * TS, TYB - Z * TS];
      const rigInv = (px, py) => [(px - 160) / TS + TX0, (TYB - py) / TS];
      function drawRig(g) {
        const ctx = g.ctx, d = calc;
        panelBg(g);
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, IW, IH); ctx.clip();
        // range rings and axis
        for (let Z = 1; Z <= 3; Z++) {
          const y = rigPx(0, Z)[1];
          seg(ctx, [0, y], [IW, y], rgba(c.line, 0.55), 1, [2, 5]);
          text(ctx, Z + " m", IW - 6, y - 7, c.ash, 9, "right");
        }
        // fields of view
        const half = CX / FOC;
        [0, 1].forEach(cam => {
          const o = rigPx(cam * BASE, 0);
          [-1, 1].forEach(sg => seg(ctx, o, rigPx(cam * BASE + sg * half * 3.2, 3.2), rgba(cam ? c.moon : c.teal, 0.22), 1));
        });
        // operator
        const S = d.pts[0], E = d.pts[1], Wp = d.pts[2];
        const LSp = rigPx(S[0] + 0.4, S[2]), Sp = rigPx(S[0], S[2]);
        seg(ctx, Sp, LSp, c.line, 5);
        dot2(ctx, rigPx(S[0] + 0.2, S[2] + 0.02), 7, rgba(c.panel, 1), c.line, 1);
        const Ep = rigPx(E[0], E[2]), Wpp = rigPx(Wp[0], Wp[2]);
        seg(ctx, Sp, Ep, rgba(c.gold, 0.95), 3); seg(ctx, Ep, Wpp, rgba(c.gold, 0.95), 3);
        dot2(ctx, Sp, 4, c.teal); dot2(ctx, Ep, 4.5, c.candle, c.text, 1); dot2(ctx, Wpp, 4.5, c.bloodBright, c.text, 1);
        // measured rays and triangulated wrist
        const tw = d.tri[2];
        [0, 1].forEach(cam => {
          const dw = d.det[cam][2];
          const dx = (dw[0] - CX) / FOC;
          const zEnd = Math.max(tw[2], 0.5) + 0.25;
          seg(ctx, rigPx(cam * BASE, 0), rigPx(cam * BASE + dx * zEnd, zEnd), rgba(c.gold, 0.55), 1);
        });
        const tp = rigPx(tw[0], tw[2]);
        dot2(ctx, tp, 8, null, c.goldBright, 1.5); dot2(ctx, tp, 2, c.goldBright);
        // cameras
        [0, 1].forEach(cam => {
          const o = rigPx(cam * BASE, 0);
          ctx.fillStyle = cam ? c.moon : c.teal;
          ctx.fillRect(o[0] - 5, o[1] - 3, 10, 7);
          text(ctx, cam ? "R" : "L", o[0], o[1] - 10, cam ? c.moon : c.teal, 10, "center");
        });
        text(ctx, "B = " + BASE.toFixed(2) + " m", rigPx(BASE / 2, 0)[0], IH - 5, c.dim, 9, "center");
        text(ctx, "Z = f*B/d = " + (isFinite(d.zFromD) ? d.zFromD.toFixed(2) : "inf") + " m", 6, 10, c.goldBright, 10);
        pill(ctx, "drag wrist / elbow", 6, 26, c.dim);
        ctx.restore();
      }

      /* ---------------- robot views ---------------- */
      const SS = 140;
      const sidePx = (x, z) => [(x + 0.4) * SS, IH - (z - 0.25) * SS];
      function drawLinks(ctx, pts, color, w) {
        for (let i = 0; i < pts.length - 1; i++) seg(ctx, pts[i], pts[i + 1], color, w);
      }
      function drawSide(g) {
        const ctx = g.ctx, d = calc;
        panelBg(g);
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, IW, IH); ctx.clip();
        // body and mount
        const b0 = sidePx(-0.4, 2.0), b1 = sidePx(0, 0.25);
        ctx.fillStyle = rgba(c.grid, 0.8); ctx.fillRect(b0[0], b0[1], b1[0] - b0[0], b1[1] - b0[1]);
        ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.strokeRect(b0[0], b0[1], b1[0] - b0[0], b1[1] - b0[1]);
        text(ctx, "base_link", b0[0] + 6, IH - 12, c.ash, 9);
        // limits
        const zl = sidePx(0, HEIGHT_LIMIT)[1];
        seg(ctx, [0, zl], [IW, zl], rgba(c.blood, 0.95), 1.2, [5, 4]);
        text(ctx, "z = " + HEIGHT_LIMIT + " m limit", IW - 6, zl + 9, c.bloodBright, 9, "right");
        const sc = sidePx(SHOULDER_POS[0], SHOULDER_POS[2]);
        ctx.beginPath(); ctx.arc(sc[0], sc[1], REACH * SS, -Math.PI / 2, Math.PI / 2);
        ctx.strokeStyle = rgba(c.line, 0.9); ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        // target and arm
        const k = fk(st.qCur);
        const pts = [sc, sidePx(k.elbow[0], k.elbow[2]), sidePx(k.tcp[0], k.tcp[2])];
        drawLinks(ctx, pts, "rgba(0,0,0,.6)", 9);
        drawLinks(ctx, pts, d.safety ? c.blood : c.gold, 6);
        pts.forEach((p, i) => dot2(ctx, p, i === 2 ? 5 : 6, i === 2 ? c.teal : c.panel, c.text, 1.5));
        const tg = sidePx(d.target[0], d.target[2]);
        const col = d.safety ? c.bloodBright : c.goldBright;
        ctx.beginPath(); ctx.moveTo(tg[0], tg[1] - 7); ctx.lineTo(tg[0] + 7, tg[1]); ctx.lineTo(tg[0], tg[1] + 7); ctx.lineTo(tg[0] - 7, tg[1]); ctx.closePath();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        text(ctx, "x forward", IW - 6, 10, c.ash, 9, "right");
        text(ctx, "q2 " + deg(st.qCur[1]).toFixed(0) + "  q3 " + deg(st.qCur[2]).toFixed(0), 6, 10, c.dim, 10);
        ctx.restore();
      }
      const TPS = 130;
      const topPx = (x, y) => [160 - y * TPS, IH - 16 - (x + 0.3) * TPS];
      function drawTop(g) {
        const ctx = g.ctx, d = calc;
        panelBg(g);
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, IW, IH); ctx.clip();
        // no-go zone: x < X_LIMIT and y > Y_LIMIT
        const nx = topPx(0, Y_LIMIT)[0], ny = topPx(X_LIMIT, 0)[1];
        ctx.fillStyle = rgba(c.blood, 0.22); ctx.fillRect(0, ny, nx, IH - ny);
        seg(ctx, [0, ny], [nx, ny], c.blood, 1.2, [5, 4]);
        seg(ctx, [nx, ny], [nx, IH], c.blood, 1.2, [5, 4]);
        text(ctx, "no-go (x<" + X_LIMIT + ", y>" + Y_LIMIT + ")", 6, IH - 8, c.bloodBright, 9);
        // reach and pan limit
        const m = topPx(MOUNT[0], MOUNT[1]);
        ctx.beginPath(); ctx.arc(m[0], m[1], REACH * TPS, -Math.PI, 0);
        ctx.strokeStyle = rgba(c.line, 0.9); ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        const lim = [MOUNT[0] + Math.cos(Q1_MIN) * REACH, MOUNT[1] + Math.sin(Q1_MIN) * REACH];
        seg(ctx, m, topPx(lim[0], lim[1]), rgba(c.amber, 0.7), 1, [4, 4]);
        text(ctx, "q1 min", topPx(lim[0], lim[1])[0] - 4, topPx(lim[0], lim[1])[1] - 8, c.amber, 9, "right");
        // arm
        const k = fk(st.qCur);
        const pts = [m, topPx(k.elbow[0], k.elbow[1]), topPx(k.tcp[0], k.tcp[1])];
        drawLinks(ctx, pts, "rgba(0,0,0,.6)", 9);
        drawLinks(ctx, pts, d.safety ? c.blood : c.gold, 6);
        pts.forEach((p, i) => dot2(ctx, p, i === 2 ? 5 : 6, i === 2 ? c.teal : c.panel, c.text, 1.5));
        const tg = topPx(d.target[0], d.target[1]);
        const col = d.safety ? c.bloodBright : c.goldBright;
        ctx.beginPath(); ctx.moveTo(tg[0], tg[1] - 7); ctx.lineTo(tg[0] + 7, tg[1]); ctx.lineTo(tg[0], tg[1] + 7); ctx.lineTo(tg[0] - 7, tg[1]); ctx.closePath();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        text(ctx, "x forward", IW - 6, 10, c.ash, 9, "right");
        text(ctx, "q1 " + deg(st.qCur[0]).toFixed(0), 6, 10, c.dim, 10);
        ctx.restore();
      }

      /* ---------------- readout ---------------- */
      function writeReadout() {
        const d = calc, w = d.tri[2], e = d.tri[1], s = d.tri[0];
        const tru = st.W;
        const q = st.qGoal;
        frame.readout.textContent =
          "cam L  S (" + d.det[0][0][0].toFixed(0) + "," + d.det[0][0][1].toFixed(0) + ")  E (" + d.det[0][1][0].toFixed(0) + "," + d.det[0][1][1].toFixed(0) + ")  W (" + d.det[0][2][0].toFixed(1) + "," + d.det[0][2][1].toFixed(1) + ")\n" +
          "cam R  S (" + d.det[1][0][0].toFixed(0) + "," + d.det[1][0][1].toFixed(0) + ")  E (" + d.det[1][1][0].toFixed(0) + "," + d.det[1][1][1].toFixed(0) + ")  W (" + d.det[1][2][0].toFixed(1) + "," + d.det[1][2][1].toFixed(1) + ")\n" +
          "disparity d = " + d.disp.toFixed(1) + " px  ->  Z = f*B/d = " + (isFinite(d.zFromD) ? d.zFromD.toFixed(2) : "inf") + " m   (true " + tru[2].toFixed(2) + " m, error " + (((isFinite(d.zFromD) ? d.zFromD : w[2]) - tru[2]) * 100).toFixed(1) + " cm)\n" +
          "wrist XYZ  " + f2(w[0]) + " " + f2(w[1]) + " " + f2(w[2]) + " m  (cam frame, DLT)\n" +
          "robot target " + f2(d.target[0]) + " " + f2(d.target[1]) + " " + f2(d.target[2]) + " m  TCP " + f2(d.tcp[0]) + " " + f2(d.tcp[1]) + " " + f2(d.tcp[2]) + " m  (base_link)\n" +
          "joints  pan " + f1(deg(q[0])) + "  lift " + f1(deg(q[1])) + "  elbow " + f1(deg(q[2])) + " deg   | teleop.py limb angles " + f1(deg(d.a1)) + " " + f1(deg(d.a2)) + " " + f1(deg(d.a3)) + " deg\n" +
          "status: " + d.status;
      }

      /* ---------------- render / update / loop ---------------- */
      function render() {
        drawCam(gL, 0); drawCam(gR, 1); drawRig(gT); drawSide(gS); drawTop(gP);
        const now = performance.now();
        if (now - lastReadout > (st.wave ? 220 : 40)) { writeReadout(); lastReadout = now; }
        dirty = false;
      }
      function update() {
        compute();
        if (!loop.running) st.qCur = st.qGoal.slice();
        lastReadout = -1;
        render();
      }
      const loop = kit.loop(frame.root, dt => {
        if (st.wave) {
          st.wt += dt;
          const t = st.wt;
          setWrist(add(SH, [-0.26 + 0.10 * Math.sin(2.2 * t), -0.05 + 0.10 * Math.sin(1.1 * t + 1), -0.22 + 0.08 * Math.sin(1.5 * t)]));
          dirty = true;
        }
        const before = st.qCur.join();
        const a = 1 - Math.exp(-dt / 0.22);
        for (let i = 0; i < 3; i++) {
          st.qCur[i] += (st.qGoal[i] - st.qCur[i]) * a;
          if (Math.abs(st.qGoal[i] - st.qCur[i]) < 1e-4) st.qCur[i] = st.qGoal[i];
        }
        if (st.qCur.join() !== before) dirty = true;
        if (dirty) { compute(); render(); }
      });

      function startWave() {
        st.wave = true;
        waveBtn.textContent = "Stop wave";
        waveBtn.setAttribute("aria-pressed", "true");
        frame.readout.setAttribute("aria-live", "off");
        loop.start();
      }
      function stopWave() {
        if (!st.wave) return;
        st.wave = false;
        waveBtn.textContent = "Auto wave";
        waveBtn.setAttribute("aria-pressed", "false");
        frame.readout.setAttribute("aria-live", "polite");
        if (kit.reducedMotion()) loop.stop();
      }

      /* ---------------- pointer input ---------------- */
      function nearest(cands, p, rad) {
        let best = null, bd = rad;
        cands.forEach(cn => { const dd = Math.hypot(cn.p[0] - p.x, cn.p[1] - p.y); if (dd < bd) { bd = dd; best = cn.id; } });
        return best;
      }
      function attach(g, candidates, onMove) {
        const cv = g.canvas;
        cv.addEventListener("pointerdown", e => {
          const p = g.toLocal(e);
          const id = nearest(candidates(), p, 30);
          if (!id) return;
          st.drag = id;
          stopWave();
          try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
          onMove(id, p);
          e.preventDefault();
        });
        cv.addEventListener("pointermove", e => { if (st.drag) { onMove(st.drag, g.toLocal(e)); e.preventDefault(); } });
        // canvases keep touch-action:pan-y so swipes scroll the page; an active drag cancels scrolling here
        cv.addEventListener("touchmove", e => { if (st.drag && e.cancelable) e.preventDefault(); }, { passive: false });
        const end = () => { st.drag = null; };
        cv.addEventListener("pointerup", end);
        cv.addEventListener("pointercancel", end);
      }
      function moveElbowRay(u, v) {
        const dd = rayDir(u, v);
        const a = dot(dd, dd), b = -2 * dot(dd, SH), cc = dot(SH, SH) - L1 * L1;
        const disc = b * b - 4 * a * cc;
        let t;
        if (disc < 0) t = dot(dd, SH) / a;
        else {
          const t1 = (-b - Math.sqrt(disc)) / (2 * a), t2 = (-b + Math.sqrt(disc)) / (2 * a);
          const cur = calc.pts[1][2];
          t = Math.abs(t1 - cur) < Math.abs(t2 - cur) ? t1 : t2;
        }
        const E = mul(dd, t);
        st.pole = norm(sub(E, SH));
        setWrist(st.W);
      }
      attach(gL, () => [{ id: "W", p: project(calc.pts[2], 0) }, { id: "E", p: project(calc.pts[1], 0) }], (id, p) => {
        if (id === "W") { const dd = rayDir(p.x, p.y); const Z = st.W[2]; setWrist([dd[0] * Z, dd[1] * Z, Z]); }
        else moveElbowRay(p.x, p.y);
        update();
      });
      attach(gT, () => [{ id: "W", p: rigPx(calc.pts[2][0], calc.pts[2][2]) }, { id: "E", p: rigPx(calc.pts[1][0], calc.pts[1][2]) }], (id, p) => {
        const [X, Z] = rigInv(p.x, p.y);
        if (id === "W") setWrist([X, st.W[1], Z]);
        else { st.pole = norm([X - SH[0], calc.pts[1][1] - SH[1], Z - SH[2]]); setWrist(st.W); }
        update();
      });
      gL.canvas.addEventListener("keydown", e => {
        const step = 6;
        const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!m) return;
        e.preventDefault();
        stopWave();
        if (e.shiftKey) {
          const p = project(calc.pts[1], 0);
          moveElbowRay(p[0] + m[0], p[1] + m[1]);
        } else {
          const p = project(st.W, 0), Z = st.W[2], dd = rayDir(p[0] + m[0], p[1] + m[1]);
          setWrist([dd[0] * Z, dd[1] * Z, Z]);
        }
        update();
      });

      /* ---------------- start ---------------- */
      compute();
      st.qCur = st.qGoal.slice();
      render();
      if (!kit.reducedMotion()) startWave();

      return () => { loop.destroy(); };
    }
  });
})();
