/*
 * robot-arena: browser simulation of the ROBOR MkI Arduino sketch (ROBOR_MkI.ino).
 * loop(): RESET motors -> measure HC-SR04 (czas / 58) -> branch on dist -> delay(200).
 *   dist < 10          : attack() x 151 (servo +6 deg per call, 10 ms each), motors stay LOW
 *   10 <= dist < 60    : MotorPin1 HIGH, MotorPin4 HIGH   (drive)
 *   else (SEARCH)      : MotorPin1 HIGH, MotorPin3 HIGH   (spin)
 */
(function () {
  "use strict";

  /* ---- constants taken from the sketch ---- */
  const ATTACK_BELOW = 10;      // dist < 10
  const CHASE_BELOW = 60;       // 10 <= dist < 60, else SEARCH
  const SERVO_STEP = 6;         // zmiana
  const ATTACK_CALLS = 151;     // while (timer < 151)
  const ATTACK_DELAY = 0.010;   // delay(10) inside attack()
  const LOOP_DELAY = 0.200;     // delay(200) at the end of loop()
  /* ---- assumed physical model (not in the sketch) ---- */
  const W = 300, H = 180;       // arena, cm
  const SC = 2.4;               // px per cm
  const WHEEL_V = 10;           // cm/s per wheel
  const TRACK = 11;             // cm between wheels
  const BODY_L = 16, BODY_W = 12, SENSOR_FWD = 8, PIVOT_FWD = 3, ARM_LEN = 18;
  const HALF_BEAM = 15 * Math.PI / 180;   // 30 deg total cone (wider than the datasheet 15 deg)
  const SERVO_SLEW = 600;       // deg/s (6 deg per 10 ms)
  const MAX_OBSTACLES = 6;

  const STATES = {
    SEARCH: { name: "SEARCH", cond: "dist ≥ 60 cm", pins: "D5=H D6=L · D10=H D9=L", what: "spin in place, scan for a target" },
    CHASE:  { name: "CHASE",  cond: "10 ≤ dist < 60 cm", pins: "D5=H D6=L · D10=L D9=H", what: "drive forward in 200 ms bursts" },
    ATTACK: { name: "ATTACK", cond: "dist < 10 cm", pins: "all motor pins LOW", what: "servo arm sweeps 0→174°, 151 × 10 ms" }
  };

  function mount(host, kit) {
    const h = kit.h, C = kit.colors(), F = kit.fonts, rnd = kit.rng(42);
    const stateColor = { SEARCH: C.teal, CHASE: C.amber, ATTACK: C.bloodBright };
    const motorColor = v => (v > 0 ? C.moon : v < 0 ? C.candle : C.ash);

    const style = h("style", {}, `
.d-robot-arena .ra-fsm{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:.4rem;padding:.7rem;border-top:1px solid var(--stone-3);align-items:stretch}
.d-robot-arena .ra-node{position:relative;border:1px solid var(--stone-3);background:var(--night-0);padding:.5rem .6rem;font-size:.78rem;line-height:1.35;color:var(--parchment-dim);overflow:hidden}
.d-robot-arena .ra-node::before{content:"";position:absolute;inset:0;background:var(--c);opacity:0;transition:opacity .15s}
.d-robot-arena .ra-node>*{position:relative}
.d-robot-arena .ra-node b{display:block;font-family:var(--font-pixel);font-size:.78rem;letter-spacing:.05em;color:var(--c);margin-bottom:.15rem}
.d-robot-arena .ra-node code{display:block;font-family:var(--font-mono);font-size:.72rem;color:var(--parchment)}
.d-robot-arena .ra-node.is-active{border-color:var(--c);box-shadow:0 0 14px -2px var(--c);color:var(--parchment)}
.d-robot-arena .ra-node.is-active::before{opacity:.16}
.d-robot-arena .ra-arrow{align-self:center;color:var(--ash);font-family:var(--font-mono)}
.d-robot-arena .ra-arrow .v{display:none}
.d-robot-arena .ra-fsmnote{padding:0 .7rem .6rem;font-size:.75rem;color:var(--ash)}
@media (max-width:620px){.d-robot-arena .ra-fsm{grid-template-columns:1fr}.d-robot-arena .ra-arrow{display:none}.d-robot-arena .ra-node .ra-what{display:none}}
`);
    host.append(style);

    const frame = kit.frame(host);
    frame.root.classList.add("d-robot-arena");
    frame.readout.setAttribute("aria-live", "off");
    const cv = kit.canvas(frame.stage, W * SC, H * SC,
      "Top-down arena with the ROBOR MkI robot, its ultrasonic cone, a target and obstacles. Click or tap to place the target, drag objects to move them, arrow keys nudge the target.");
    const ctx = cv.ctx;
    cv.canvas.tabIndex = 0;

    /* state diagram */
    const nodeEls = {};
    const fsm = h("div", { class: "ra-fsm" });
    ["SEARCH", "CHASE", "ATTACK"].forEach((k, i) => {
      const s = STATES[k];
      const el = h("div", { class: "ra-node", style: "--c:" + stateColor[k] }, h("b", {}, s.name), h("span", {}, s.cond), h("code", {}, s.pins), h("span", { class: "ra-what" }, s.what));
      nodeEls[k] = el;
      if (i) fsm.append(h("span", { class: "ra-arrow", "aria-hidden": "true" }, h("span", { class: "h" }, "↔"), h("span", { class: "v" }, "↕")));
      fsm.append(el);
    });
    frame.stage.append(fsm, h("div", { class: "ra-fsmnote" }, "Every cycle: RESET motors → measure → pick a state from the distance alone → delay(200). Any state can follow any other."));

    /* ---------- simulation state ---------- */
    let robot, target, obstacles, trail, sim;
    let playing = !kit.reducedMotion();
    let speed = 1, noise = 1.5, readoutClock = 0;

    function defaults() {
      robot = { x: W / 2, y: H / 2, th: 0 };
      target = { x: 228, y: 44, r: 6, kind: "target", flash: 0, touch: false };
      obstacles = [{ x: 78, y: 140, r: 7, kind: "obstacle", flash: 0, touch: false }];
      trail = [];
      sim = {
        t: 0, cycle: 0, phase: "delay", phaseT: 0, state: "SEARCH",
        mL: 0, mR: 0, dist: 0, trueDist: 0,
        poz: 0, servoCmd: 0, servoAct: 0, attackIter: 0, attackAcc: 0, hits: 0,
        pingT: 9, trailT: 0
      };
    }
    const allObjs = () => [target].concat(obstacles);
    const clampRobot = () => { robot.x = kit.clamp(robot.x, 10, W - 10); robot.y = kit.clamp(robot.y, 10, H - 10); };

    function gauss() { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); }

    function castRay(ox, oy, ang) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let best = Infinity;
      const tx = dx > 1e-9 ? (W - ox) / dx : dx < -1e-9 ? -ox / dx : Infinity;
      const ty = dy > 1e-9 ? (H - oy) / dy : dy < -1e-9 ? -oy / dy : Infinity;
      best = Math.min(tx, ty);
      for (const o of allObjs()) {
        const cx = o.x - ox, cy = o.y - oy, c2 = cx * cx + cy * cy;
        if (c2 < o.r * o.r) return 0;
        const t = cx * dx + cy * dy;
        if (t < 0) continue;
        const p2 = c2 - t * t;
        if (p2 > o.r * o.r) continue;
        best = Math.min(best, t - Math.sqrt(o.r * o.r - p2));
      }
      return best;
    }

    /* zmierzOdleglosc(): nearest echo inside the cone, integer cm like czas / 58 */
    function measure() {
      const sx = robot.x + Math.cos(robot.th) * SENSOR_FWD, sy = robot.y + Math.sin(robot.th) * SENSOR_FWD;
      let best = Infinity;
      const N = 25;
      for (let k = 0; k < N; k++) best = Math.min(best, castRay(sx, sy, robot.th - HALF_BEAM + 2 * HALF_BEAM * k / (N - 1)));
      sim.trueDist = best;
      return Math.max(0, Math.floor(best + gauss() * noise));
    }

    function classify(d) { return d < ATTACK_BELOW ? "ATTACK" : d < CHASE_BELOW ? "CHASE" : "SEARCH"; }

    /* top of loop() */
    function startCycle() {
      sim.mL = 0; sim.mR = 0;                       // RESET
      sim.dist = measure();
      sim.state = classify(sim.dist);
      sim.cycle++; sim.pingT = 0;
      if (sim.state === "ATTACK") {
        sim.phase = "attack"; sim.attackIter = 0; sim.attackAcc = 0;
      } else {
        sim.phase = "drive"; sim.phaseT = LOOP_DELAY;
        sim.mL = 1;                                  // MotorPin1 HIGH
        sim.mR = sim.state === "CHASE" ? 1 : -1;     // MotorPin4 HIGH (forward) / MotorPin3 HIGH (spin)
      }
    }

    function attackCall() {
      if (sim.poz < 180) sim.servoCmd = sim.poz; else sim.poz = 0;
      sim.poz += SERVO_STEP;
    }

    function armGeom() {
      const px = robot.x + Math.cos(robot.th) * PIVOT_FWD, py = robot.y + Math.sin(robot.th) * PIVOT_FWD;
      const a = robot.th + (90 - sim.servoAct) * Math.PI / 180;
      return { px, py, tx: px + Math.cos(a) * ARM_LEN, ty: py + Math.sin(a) * ARM_LEN };
    }

    function segDist(o, g) {
      const vx = g.tx - g.px, vy = g.ty - g.py;
      const t = kit.clamp(((o.x - g.px) * vx + (o.y - g.py) * vy) / (vx * vx + vy * vy), 0, 1);
      return Math.hypot(o.x - (g.px + vx * t), o.y - (g.py + vy * t));
    }

    function sub(dt) {
      sim.t += dt; sim.pingT += dt;
      const dAng = sim.servoCmd - sim.servoAct, maxMove = SERVO_SLEW * dt;
      sim.servoAct += Math.abs(dAng) <= maxMove ? dAng : Math.sign(dAng) * maxMove;
      const vL = sim.mL * WHEEL_V, vR = sim.mR * WHEEL_V;
      if (vL || vR) {
        const v = (vL + vR) / 2;
        robot.th += (vL - vR) / TRACK * dt;
        robot.x += Math.cos(robot.th) * v * dt; robot.y += Math.sin(robot.th) * v * dt;
        clampRobot();
      }
      for (const o of allObjs()) o.flash = Math.max(0, o.flash - dt);
      sim.trailT += dt;
      if (sim.trailT > 0.1) { sim.trailT = 0; trail.push(robot.x, robot.y); if (trail.length > 600) trail.splice(0, 2); }

      if (sim.phase === "attack") {
        sim.attackAcc += dt;
        while (sim.attackAcc >= ATTACK_DELAY && sim.attackIter < ATTACK_CALLS) {
          sim.attackAcc -= ATTACK_DELAY; attackCall(); sim.attackIter++;
        }
        const g = armGeom();
        for (const o of allObjs()) {
          const hit = segDist(o, g) < o.r;
          if (hit && !o.touch) { o.flash = 0.2; sim.hits++; }
          o.touch = hit;
        }
        if (sim.attackIter >= ATTACK_CALLS) { sim.phase = "delay"; sim.phaseT = LOOP_DELAY; }
      } else {
        sim.phaseT -= dt;
        if (sim.phaseT <= 0) startCycle();
      }
    }

    function advance(dt) {
      while (dt > 1e-9) { const s = Math.min(dt, 0.01); dt -= s; sub(s); }
    }

    /* ---------- drawing ---------- */
    function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

    function draw() {
      const col = stateColor[sim.state];
      ctx.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, cv.w, cv.h);
      ctx.save(); ctx.scale(SC, SC);

      // floor grid (every 20 cm)
      ctx.strokeStyle = C.grid; ctx.globalAlpha = 0.55; ctx.lineWidth = 0.25;
      ctx.beginPath();
      for (let x = 20; x < W; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 20; y < H; y += 20) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke(); ctx.globalAlpha = 1;

      // trail
      if (trail.length > 2) {
        ctx.strokeStyle = C.moon; ctx.globalAlpha = 0.22; ctx.lineWidth = 0.7; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(trail[0], trail[1]);
        for (let i = 2; i < trail.length; i += 2) ctx.lineTo(trail[i], trail[i + 1]);
        ctx.lineTo(robot.x, robot.y); ctx.stroke(); ctx.globalAlpha = 1;
      }

      // obstacles
      for (const o of obstacles) {
        circle(o.x, o.y, o.r); ctx.fillStyle = C.line; ctx.fill();
        ctx.lineWidth = 0.8; ctx.strokeStyle = o.flash > 0 ? C.bloodBright : C.ash; ctx.stroke();
        circle(o.x, o.y, o.r * 0.45); ctx.strokeStyle = C.ash; ctx.lineWidth = 0.5; ctx.stroke();
      }
      // target (candle)
      ctx.save();
      ctx.shadowColor = C.candle; ctx.shadowBlur = 14;
      circle(target.x, target.y, target.r); ctx.fillStyle = target.flash > 0 ? C.bloodBright : C.gold; ctx.fill();
      ctx.restore();
      circle(target.x, target.y, target.r); ctx.lineWidth = 0.9; ctx.strokeStyle = C.goldBright; ctx.stroke();
      circle(target.x, target.y, target.r * 0.4); ctx.fillStyle = C.bg; ctx.fill();

      // sensor cone
      const sx = robot.x + Math.cos(robot.th) * SENSOR_FWD, sy = robot.y + Math.sin(robot.th) * SENSOR_FWD;
      const R = Math.max(3, sim.dist);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, R, robot.th - HALF_BEAM, robot.th + HALF_BEAM); ctx.closePath();
      ctx.fillStyle = col; ctx.globalAlpha = 0.13; ctx.fill();
      ctx.globalAlpha = 0.6; ctx.strokeStyle = col; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.setLineDash([2, 1.6]); ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(robot.th) * R, sy + Math.sin(robot.th) * R); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      circle(sx + Math.cos(robot.th) * R, sy + Math.sin(robot.th) * R, 1.4); ctx.fillStyle = col; ctx.fill();
      // ping ring
      if (sim.pingT < 0.3) {
        const k = sim.pingT / 0.3;
        ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = col; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, R * k), robot.th - HALF_BEAM, robot.th + HALF_BEAM); ctx.stroke(); ctx.globalAlpha = 1;
      }

      // robot (local frame: +x forward, left wheel at -y)
      ctx.save(); ctx.translate(robot.x, robot.y); ctx.rotate(robot.th);
      if (sim.phase === "attack") {
        ctx.globalAlpha = 0.35; ctx.strokeStyle = C.bloodBright; ctx.lineWidth = 0.4; ctx.setLineDash([1.2, 1.2]);
        ctx.beginPath(); ctx.arc(PIVOT_FWD, 0, ARM_LEN, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      [[-1, sim.mL], [1, sim.mR]].forEach(([side, m]) => {
        ctx.fillStyle = motorColor(m); ctx.fillRect(-6, side * 7.6 - 1.7, 9, 3.4);
      });
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-BODY_L / 2, -BODY_W / 2, BODY_L, BODY_W, 2) : ctx.rect(-BODY_L / 2, -BODY_W / 2, BODY_L, BODY_W);
      ctx.fillStyle = C.panel; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = C.gold; ctx.stroke();
      ctx.fillStyle = C.dim;
      circle(SENSOR_FWD - 0.3, -3, 2.3); ctx.fill(); circle(SENSOR_FWD - 0.3, 3, 2.3); ctx.fill();
      ctx.fillStyle = C.bg; circle(SENSOR_FWD - 0.3, -3, 1.1); ctx.fill(); circle(SENSOR_FWD - 0.3, 3, 1.1); ctx.fill();
      // servo arm
      const aa = (90 - sim.servoAct) * Math.PI / 180;
      ctx.strokeStyle = sim.phase === "attack" ? C.bloodBright : C.goldBright; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(PIVOT_FWD, 0); ctx.lineTo(PIVOT_FWD + Math.cos(aa) * ARM_LEN, Math.sin(aa) * ARM_LEN); ctx.stroke(); ctx.lineCap = "butt";
      circle(PIVOT_FWD, 0, 2); ctx.fillStyle = C.gold; ctx.fill();
      ctx.restore();

      // arena walls + scale bar
      ctx.lineWidth = 1.6; ctx.strokeStyle = C.line; ctx.strokeRect(0.8, 0.8, W - 1.6, H - 1.6);
      ctx.lineWidth = 0.4; ctx.strokeStyle = C.gold; ctx.strokeRect(2.4, 2.4, W - 4.8, H - 4.8);
      ctx.restore();

      // HUD (px)
      const bx = 14, by = cv.h - 30;
      ctx.strokeStyle = C.dim; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + 50 * SC, by); ctx.lineTo(bx + 50 * SC, by - 5); ctx.stroke();
      ctx.fillStyle = C.dim; ctx.font = "600 18px " + F.mono; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
      ctx.fillText("50 cm", bx, by - 8);

      ctx.font = "26px " + F.pixel; ctx.textBaseline = "middle";
      const label = sim.state, tw = ctx.measureText(label).width;
      ctx.fillStyle = C.bg; ctx.globalAlpha = 0.8; ctx.fillRect(14, 14, tw + 40, 42); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(14, 14, tw + 40, 42);
      circle2(34, 35, 6, col); ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(label, 50, 36);
      const dt = "d = " + sim.dist + " cm";
      ctx.font = "600 24px " + F.mono; ctx.textAlign = "right";
      const dw = ctx.measureText(dt).width;
      ctx.fillStyle = C.bg; ctx.globalAlpha = 0.8; ctx.fillRect(cv.w - dw - 34, 14, dw + 20, 42); ctx.globalAlpha = 1;
      ctx.fillStyle = C.goldBright; ctx.fillText(dt, cv.w - 24, 36);
    }
    function circle2(x, y, r, color) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }

    /* ---------- readout / diagram ---------- */
    const mName = m => (m > 0 ? "FWD" : m < 0 ? "REV" : "STOP");
    function updateUI() {
      Object.keys(nodeEls).forEach(k => {
        const on = k === sim.state;
        nodeEls[k].classList.toggle("is-active", on);
        if (on) nodeEls[k].setAttribute("aria-current", "true"); else nodeEls[k].removeAttribute("aria-current");
      });
      const pinsL = sim.mL > 0 ? "D5=H D6=L" : "D5=L D6=L", pinsR = sim.mR > 0 ? "D10=L D9=H" : sim.mR < 0 ? "D10=H D9=L" : "D10=L D9=L";
      const phase = sim.phase === "attack" ? "attack() " + sim.attackIter + "/" + ATTACK_CALLS : sim.phase === "drive" ? "delay(200) while driving" : "delay(200)";
      frame.readout.textContent =
        "distance: " + sim.dist + " cm   state: " + sim.state + "   cycle #" + sim.cycle + "\n" +
        "motors: L " + mName(sim.mL) + " (" + pinsL + ")   R " + mName(sim.mR) + " (" + pinsR + ")\n" +
        "servo: " + sim.servoCmd + "°   arm hits: " + sim.hits + "   " + phase;
    }

    /* ---------- controls ---------- */
    const buttons = h("div", { class: "demo__buttons" });
    const playBtn = kit.button(buttons, playing ? "Pause" : "Play", () => { playing ? pause() : play(); }, "blood");
    kit.button(buttons, "Reset", () => { defaults(); startCycle(); refresh(); });
    const addBtn = kit.button(buttons, "Add obstacle", () => {
      for (let tries = 0; tries < 60; tries++) {
        const x = 20 + rnd() * (W - 40), y = 20 + rnd() * (H - 40);
        if (Math.hypot(x - robot.x, y - robot.y) < 75) continue;
        if (allObjs().some(o => Math.hypot(x - o.x, y - o.y) < 30)) continue;
        obstacles.push({ x, y, r: 7, kind: "obstacle", flash: 0, touch: false });
        break;
      }
      refresh();
    });
    const remBtn = kit.button(buttons, "Remove obstacle", () => { obstacles.pop(); refresh(); });
    frame.controls.append(buttons);
    kit.slider(frame.controls, { label: "Sensor noise (σ)", min: 0, max: 10, step: 0.5, value: noise, format: v => v.toFixed(1) + " cm", onInput: v => { noise = v; } });
    kit.slider(frame.controls, { label: "Simulation speed", min: 0.25, max: 4, step: 0.25, value: speed, format: v => v.toFixed(2) + "×", onInput: v => { speed = v; } });
    kit.legend(frame.root, [
      { color: stateColor.SEARCH, label: "SEARCH (spin)" }, { color: stateColor.CHASE, label: "CHASE (drive)" }, { color: stateColor.ATTACK, label: "ATTACK (servo sweep)" },
      { color: C.gold, label: "target" }, { color: C.line, label: "obstacle" }
    ]);

    function refresh() {
      addBtn.disabled = obstacles.length >= MAX_OBSTACLES;
      remBtn.disabled = obstacles.length === 0;
      draw(); updateUI();
    }

    /* ---------- pointer: place / drag ---------- */
    let drag = null;
    const place = (o, p) => { o.x = kit.clamp(p.x / SC, o.r + 3, W - o.r - 3); o.y = kit.clamp(p.y / SC, o.r + 3, H - o.r - 3); };
    cv.canvas.addEventListener("pointerdown", e => {
      const p = cv.toLocal(e), cx = p.x / SC, cy = p.y / SC;
      let hit = null, bestD = 14;
      for (const o of allObjs()) { const d = Math.hypot(o.x - cx, o.y - cy); if (d < bestD) { bestD = d; hit = o; } }
      drag = hit || target;
      place(drag, p);
      try { cv.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); draw();
    });
    cv.canvas.addEventListener("pointermove", e => { if (drag) { place(drag, cv.toLocal(e)); if (!playing) draw(); } });
    const endDrag = () => { drag = null; };
    cv.canvas.addEventListener("pointerup", endDrag);
    cv.canvas.addEventListener("pointercancel", endDrag);
    cv.canvas.addEventListener("keydown", e => {
      const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key];
      if (!d) return;
      e.preventDefault(); place(target, { x: (target.x + d[0]) * SC, y: (target.y + d[1]) * SC }); draw();
    });

    /* ---------- run loop ---------- */
    const loop = kit.loop(frame.stage, dt => {
      advance(dt * speed);
      draw();
      readoutClock += dt;
      if (readoutClock > 0.1) { readoutClock = 0; updateUI(); }
    });
    function play() { playing = true; playBtn.textContent = "Pause"; loop.start(); }
    function pause() { playing = false; playBtn.textContent = "Play"; loop.stop(); updateUI(); }

    defaults(); startCycle(); refresh();
    if (playing) loop.start();
    return () => { loop.destroy(); style.remove(); frame.root.remove(); };
  }

  PortfolioDemos.register("robot-arena", {
    title: "ROBOR MkI arena",
    note: "Simulation of the ROBOR MkI sketch: under 10 cm the servo arm sweeps, 10 to 60 cm it drives forward, otherwise it spins to search. Tap to place the target, drag to move it, add obstacles (the sensor cannot tell them apart); wheel speed, geometry and which motor pattern spins versus drives are my assumptions.",
    mount
  });
})();
