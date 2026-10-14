/*
 * Demo: Arkanoid with custom 2D physics.
 * Browser port of a university C++ / FreeGLUT project: Figure -> Physics -> Circle / Rectangle,
 * 10 ms timer loop, rebound off the side nearest to the ball centre (Physics::FindNormal + Rebound).
 * World units, object sizes, brick layout and the integration formula are taken from the C++ code.
 */
(function () {
  "use strict";

  /* ================= Physics port (Physics.cpp) ================= */

  const DEG = Math.PI / 180;

  /** Physics base object: position, border (relative to centre), speed v [u/ms], direction alfa_v [deg], g, alfa_g. */
  function makeBody(x, y, halfW, halfH) {
    return {
      x, y, border: { blx: -halfW, bly: -halfH, trx: halfW, try_: halfH },
      prev: 0, v: 0, av: 0, g: 0, ag: 0
    };
  }
  const circleBody = (r) => makeBody(0, 0, r, r);             // Circle: SetBorders(-r,-r,r,r)
  const rectBody = (w, h) => makeBody(0, 0, w / 2, h / 2);    // Rectangle: SetBorders(-w/2,-h/2,w/2,h/2)

  function setInitialParameters(b, t, v, av, g, ag) { b.prev = t; b.v = v; b.av = av; b.g = g; b.ag = ag; }

  /** Physics::Update - x += v*dt + 0.5*g*dt^2, then v += g*dt, recompute |v| and alfa_v. */
  function update(b, t) {
    const dt = t - b.prev;
    let vx = b.v * Math.cos(b.av * DEG), vy = b.v * Math.sin(b.av * DEG);
    b.x += vx * dt + 0.5 * b.g * Math.cos(b.ag * DEG) * dt * dt;
    b.y += vy * dt + 0.5 * b.g * Math.sin(b.ag * DEG) * dt * dt;
    vx += b.g * Math.cos(b.ag * DEG) * dt;
    vy += b.g * Math.sin(b.ag * DEG) * dt;
    b.v = Math.sqrt(vx * vx + vy * vy);
    b.av = Math.atan2(vy, vx) * 180 / Math.PI;
    b.prev = t;
  }

  /** Physics::Rebound - mirror alfa_v about the wall when |alfa_n - alfa_v| > 90 (note: no angle wrapping, as in the C++). */
  function rebound(b, an) {
    if (Math.abs(an - b.av) > 90) { b.av = an - (180 + b.av - an); return true; }
    return false;
  }

  /** Physics::IsInRectangle (strict inequalities). */
  function isInRectangle(px, py, X) {
    return px < X.x + X.border.trx && px > X.x + X.border.blx &&
           py < X.y + X.border.try_ && py > X.y + X.border.bly;
  }

  /** Physics::Distance for the four side lines; vertical lines use |x - x0|, horizontal ones |y - y0|. */
  function distance(px, py, x1, y1, x2, y2) {
    if (x2 !== x1) {
      const A = (y2 - y1) / (x2 - x1), B = y1 - A * x1;
      return Math.abs(A * px - py + B) / Math.sqrt(A * A + 1);
    }
    return Math.abs(px - x2);
  }

  const SIDE_NAMES = ["left", "top", "right", "bottom"];
  const SIDE_NORMALS = [180, 90, 0, -90];

  /** Physics::FindNormal - side whose line is closest to the ball centre; returns index, normal angle, distances. */
  function findNormal(b, X) {
    const l = X.x + X.border.blx, bt = X.y + X.border.bly, r = X.x + X.border.trx, tp = X.y + X.border.try_;
    const d = [
      distance(b.x, b.y, l, bt, l, tp),
      distance(b.x, b.y, l, tp, r, tp),
      distance(b.x, b.y, r, tp, r, bt),
      distance(b.x, b.y, r, bt, l, bt)
    ];
    let min = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[min]) min = i;
    return { idx: min, angle: SIDE_NORMALS[min], d };
  }

  /** Physics::Collision - any bounding-box corner of either object inside the other, then Rebound(FindNormal). */
  function collision(b, X) {
    const corners = (o) => [
      [o.x + o.border.blx, o.y + o.border.bly], [o.x + o.border.blx, o.y + o.border.try_],
      [o.x + o.border.trx, o.y + o.border.try_], [o.x + o.border.trx, o.y + o.border.bly]
    ];
    let hit = corners(b).some(c => isInRectangle(c[0], c[1], X));
    if (!hit) hit = corners(X).some(c => isInRectangle(c[0], c[1], b));
    if (!hit) return null;
    const n = findNormal(b, X);
    const before = b.av;
    const did = rebound(b, n.angle);
    return { X, side: n.idx, nAngle: n.angle, d: n.d, bx: b.x, by: b.y, before, after: b.av, rebounded: did, age: 0 };
  }

  /* ================= Game constants (from the C++ main file) ================= */

  const TICK_MS = 10;                  // GAME_LOGIC_REFRESH_TIME
  const BALL_R = 0.6;                  // ball(0.6, ...)
  const PADDLE_W = 10, PADDLE_H = 1, PADDLE_Y = -16;
  const BLOCK_W = 4, BLOCK_H = 2;      // 4 rows x 10 columns, at (-18 + j*4, 8 + i*2)
  const ROWS = 4, COLS = 10;
  const FIELD_X = 24, FIELD_Y = 20;    // inner faces of the 6-unit thick walls at x=+-27, y=+-23
  const PIT_Y = -FIELD_Y - BALL_R;     // browser change: bottom wall replaced by a pit (lose a ball)
  const START_ANGLES = [45, 135];      // C++ launches at 45 deg

  /* Canvas layout */
  const S = 12;                        // px per world unit
  const W = FIELD_X * 2 * S, HUD = 44, FIELD_H = FIELD_Y * 2 * S, H = HUD + FIELD_H;
  const wx = x => (x + FIELD_X) * S;
  const wy = y => HUD + (FIELD_Y - y) * S;

  const ROW_POINTS = [10, 20, 30, 40];
  const HEART_CHANCE = 0.08, HEART_FALL = 9, KEY_SPEED = 40;

  const norm = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };
  const fmtA = a => Math.round(norm(a)) + "°";

  const CSS = `
.d-arkanoid canvas:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: -3px; }
.d-arkanoid .d-arkanoid__legend[hidden] { display: none; }
.d-arkanoid .demo__buttons { flex: 1 1 100%; }
`;

  PortfolioDemos.register("arkanoid", {
    title: "Arkanoid with custom physics",
    note: "Simulation of my C++/FreeGLUT Arkanoid: a 10 ms fixed-step loop and a rebound off the side nearest the ball centre. Press Start, switch on the physics debug to see the chosen normal, and try the gravity slider (the original had g = 0).",
    mount(host, kit) {
      const h = kit.h;
      const c = kit.colors();
      const rnd = kit.rng((Date.now() & 0xffff) || 1);

      const styleEl = h("style", {}, CSS);
      document.head.append(styleEl);

      const frame = kit.frame(host);
      frame.root.classList.add("d-arkanoid");

      const cv = kit.canvas(frame.stage, W, H,
        "Arkanoid playfield. Focus the canvas, then use the left and right arrow keys or the mouse to move the paddle, and Space or a tap to launch the ball.");
      const { canvas, ctx } = cv;
      canvas.tabIndex = 0;

      /* ---------- state ---------- */
      let phase = "idle";         // idle | serve | play | over | cleared
      let paused = false;
      let debug = false;
      let speedU = 20;            // u/s  (C++: 0.02 u/ms)
      let gravU = 0;              // u/s^2 (C++: g = 0, alfa_g = -90)
      let score = 0, lives = 3;
      let clock = 0, acc = 0;     // game clock in ms (stands in for glutGet(GLUT_ELAPSED_TIME))
      let ball, paddle, walls, blocks, hearts, sparks, floaters, lastHit, brokenCount;
      const keys = { left: false, right: false };
      let note = "";

      function newGame() {
        score = 0; lives = 3;
        paddle = rectBody(PADDLE_W, PADDLE_H); paddle.x = 0; paddle.y = PADDLE_Y;
        ball = circleBody(BALL_R);
        walls = [
          mk(64, 6, 0, 23), mk(64, 6, 0, -23), mk(6, 64, 27, 0), mk(6, 64, -27, 0)
        ];
        blocks = [];
        for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
          const b = rectBody(BLOCK_W, BLOCK_H);
          b.x = -18 + j * BLOCK_W; b.y = 8 + i * BLOCK_H; b.row = i;
          blocks.push(b);
        }
        hearts = []; sparks = []; floaters = []; lastHit = null; brokenCount = 0;
        resetBall();
      }
      function mk(w, hh, x, y) { const r = rectBody(w, hh); r.x = x; r.y = y; return r; }

      function resetBall() {
        ball.v = 0; ball.g = 0; ball.av = 0;
        ball.x = paddle.x; ball.y = PADDLE_Y + PADDLE_H / 2 + BALL_R + 0.05;
        hearts.length = 0;
        phase = "serve";
      }

      function launch() {
        if (phase !== "serve") return;
        const a = START_ANGLES[rnd() < 0.5 ? 0 : 1];
        setInitialParameters(ball, clock, speedU / 1000, a, gravU / 1e6, -90);
        phase = "play";
        say();
      }

      /* ---------- one 10 ms tick, same order as gameLogic() ---------- */
      function tick() {
        clock += TICK_MS;
        if (lastHit) lastHit.age += TICK_MS / 1000;
        update(ball, clock);
        let ev = collision(ball, paddle);
        if (ev) record(ev, "paddle");
        for (const i of [0, 2, 3]) {                    // top, right, left walls (bottom is the pit)
          ev = collision(ball, walls[i]);
          if (ev) record(ev, "wall");
        }
        const before = blocks.length;
        for (let i = 0; i < blocks.length;) {
          ev = collision(ball, blocks[i]);
          if (ev) { breakBlock(blocks[i], ev); blocks.splice(i, 1); } else i++;
        }
        if (blocks.length !== before && blocks.length) say();
        if (blocks.length === 0) { phase = "cleared"; halt(); say(); return; }
        if (ball.y < PIT_Y) {
          lives--;
          if (lives <= 0) { phase = "over"; halt(); } else resetBall();
          say("ball lost");
        }
      }

      // loop.stop() inside the step would be undone by the loop re-scheduling itself, so defer it
      function halt() { queueMicrotask(() => { loop.stop(); draw(); }); }

      function record(ev, kind) {
        ev.kind = kind; lastHit = ev;
        if (debug) say();
      }

      function breakBlock(b, ev) {
        ev.kind = "brick"; lastHit = ev;
        score += ROW_POINTS[b.row]; brokenCount++;
        if (!kit.reducedMotion()) {
          for (let k = 0; k < 7; k++) {
            sparks.push({ x: b.x + (rnd() - 0.5) * BLOCK_W, y: b.y + (rnd() - 0.5) * BLOCK_H,
              vx: (rnd() - 0.5) * 14, vy: rnd() * 8 + 2, life: 0.5, row: b.row });
          }
        }
        if (rnd() < HEART_CHANCE) hearts.push({ x: b.x, y: b.y });
      }

      /* ---------- per-frame update ---------- */
      function step(dt) {
        const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        if (dir) setPaddle(paddle.x + dir * KEY_SPEED * dt);
        if (phase === "play") {
          acc += dt * 1000;
          let n = 0;
          while (acc >= TICK_MS && n++ < 6 && phase === "play") { acc -= TICK_MS; tick(); }
          if (phase !== "play") acc = 0;
        }
        if (phase === "serve") { ball.x = paddle.x; ball.y = PADDLE_Y + PADDLE_H / 2 + BALL_R + 0.05; }
        for (let i = hearts.length - 1; i >= 0; i--) {
          const hr = hearts[i];
          hr.y -= HEART_FALL * dt;
          const caught = Math.abs(hr.x - paddle.x) < PADDLE_W / 2 + 0.6 && hr.y - 0.6 < PADDLE_Y + PADDLE_H / 2 && hr.y + 0.6 > PADDLE_Y - PADDLE_H / 2;
          if (caught) {
            hearts.splice(i, 1);
            const r = canvas.getBoundingClientRect();
            kit.addHearts(1, r.left + wx(hr.x) * r.width / W, r.top + wy(hr.y) * r.height / H);
            floaters.push({ x: hr.x, y: PADDLE_Y + 2, life: 1 });
            say("heart caught");
          } else if (hr.y < PIT_Y) hearts.splice(i, 1);
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i]; p.life -= dt; p.vy -= 30 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.life <= 0) sparks.splice(i, 1);
        }
        for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].life -= dt; floaters[i].y += 3 * dt; if (floaters[i].life <= 0) floaters.splice(i, 1); }
        draw();
      }

      function setPaddle(x) { paddle.x = kit.clamp(x, -FIELD_X + PADDLE_W / 2, FIELD_X - PADDLE_W / 2); }

      /* ---------- readout / aria ---------- */
      function say(extra) {
        sync();
        const state = paused ? "paused" : { idle: "ready", serve: "waiting to launch", play: "playing", over: "game over", cleared: "level cleared" }[phase];
        let t = "State: " + state + (extra ? " (" + extra + ")" : "") + "  |  score " + score + "  |  balls " + lives + "  |  bricks " + blocks.length + "/" + ROWS * COLS;
        t += "\nBall: g = " + gravU.toFixed(1) + " u/s2, launch speed " + speedU + " u/s";
        if (lastHit) {
          const e = lastHit;
          t += "\nLast hit: " + e.kind + ", nearest side " + SIDE_NAMES[e.side] + ", normal n = " + e.nAngle + "°; velocity angle " +
            fmtA(e.before) + (e.rebounded ? " -> " + fmtA(e.after) + " (rebound)" : " unchanged (|n - alfa_v| <= 90, moving away)");
        }
        frame.readout.textContent = t;
        canvas.setAttribute("aria-label", "Arkanoid playfield, " + state + ". Score " + score + ", balls " + lives + ", bricks left " + blocks.length +
          ". Focus the canvas, then use the left and right arrow keys or the mouse to move the paddle, and Space or a tap to launch.");
      }

      /* ---------- drawing ---------- */
      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = W; bgCanvas.height = H;
      (function paintBg() {
        const g = bgCanvas.getContext("2d");
        const grad = g.createLinearGradient(0, HUD, 0, H);
        grad.addColorStop(0, c.bg); grad.addColorStop(1, "#10101a");
        g.fillStyle = grad; g.fillRect(0, 0, W, H);
        g.strokeStyle = c.grid; g.globalAlpha = 0.35; g.lineWidth = 1;
        const bw = 4 * S, bh = 2 * S;
        for (let row = 0, y = HUD; y < H; row++, y += bh) {
          g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
          g.beginPath();
          for (let x = (row % 2) * bw / 2; x < W; x += bw) { g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + bh); }
          g.stroke();
        }
        g.globalAlpha = 1;
        const vg = g.createRadialGradient(W / 2, H * 0.55, H * 0.15, W / 2, H * 0.55, H * 0.8);
        vg.addColorStop(0, "rgba(7,8,12,0)"); vg.addColorStop(1, "rgba(7,8,12,0.85)");
        g.fillStyle = vg; g.fillRect(0, HUD, W, FIELD_H);
      })();

      const rowColor = [c.ash, c.blood, c.bloodBright, c.gold];
      const rowEdge = ["#b7b1c2", c.bloodBright, "#ff6b7d", c.goldBright];

      function brickPath(b) {
        return [wx(b.x - BLOCK_W / 2) + 1, wy(b.y + BLOCK_H / 2) + 1, BLOCK_W * S - 2, BLOCK_H * S - 2];
      }

      function drawHeart(cx, cy, s, col) {
        ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.9);
        ctx.bezierCurveTo(-s * 1.5, -s * 0.1, -s * 0.8, -s * 1.2, 0, -s * 0.4);
        ctx.bezierCurveTo(s * 0.8, -s * 1.2, s * 1.5, -s * 0.1, 0, s * 0.9);
        ctx.fill(); ctx.restore();
      }

      function arrow(x1, y1, x2, y2, col, lw) {
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1), hl = 9;
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(a - 0.4), y2 - hl * Math.sin(a - 0.4));
        ctx.lineTo(x2 - hl * Math.cos(a + 0.4), y2 - hl * Math.sin(a + 0.4));
        ctx.closePath(); ctx.fill();
      }

      function label(text, x, y, col, size, align) {
        ctx.font = size + "px " + kit.fonts.mono; ctx.textAlign = align || "left"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(7,8,12,.9)"; ctx.strokeText(text, x, y);
        ctx.fillStyle = col; ctx.fillText(text, x, y);
      }

      function draw() {
        ctx.drawImage(bgCanvas, 0, 0, W, H);

        // HUD
        ctx.fillStyle = c.panel; ctx.fillRect(0, 0, W, HUD);
        ctx.fillStyle = c.gold; ctx.fillRect(0, HUD - 2, W, 2);
        ctx.font = "20px " + kit.fonts.pixel; ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.fillStyle = c.goldBright; ctx.fillText("SCORE " + String(score).padStart(5, "0"), 14, HUD / 2 - 1);
        ctx.textAlign = "center"; ctx.fillStyle = c.dim; ctx.fillText("BRICKS " + blocks.length, W / 2 + 10, HUD / 2 - 1);
        ctx.textAlign = "right"; ctx.fillStyle = c.dim; ctx.fillText("BALLS", W - 14 - 3 * 22, HUD / 2 - 1);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(W - 14 - 8 - (2 - i) * 22, HUD / 2 - 1, 7, 0, 7);
          if (i < lives) { ctx.fillStyle = c.candle; ctx.fill(); } else { ctx.strokeStyle = c.line; ctx.lineWidth = 2; ctx.stroke(); }
        }

        // side frame
        ctx.strokeStyle = c.line; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(2, HUD); ctx.lineTo(2, H); ctx.moveTo(W - 2, HUD); ctx.lineTo(W - 2, H); ctx.stroke();
        ctx.strokeStyle = c.gold; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(4.5, HUD); ctx.lineTo(4.5, H); ctx.moveTo(W - 4.5, HUD); ctx.lineTo(W - 4.5, H); ctx.stroke();

        // bricks
        for (const b of blocks) {
          const [x, y, w, hh] = brickPath(b);
          ctx.fillStyle = rowColor[b.row]; ctx.fillRect(x, y, w, hh);
          ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.fillRect(x, y, w, 2);
          ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.fillRect(x, y + hh - 3, w, 3);
          ctx.strokeStyle = rowEdge[b.row]; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1); ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x + w / 2 - 1, y + 5, 2, hh - 12);
        }

        // paddle
        const px = wx(paddle.x - PADDLE_W / 2), py = wy(paddle.y + PADDLE_H / 2), pw = PADDLE_W * S, ph = PADDLE_H * S;
        const pg = ctx.createLinearGradient(0, py, 0, py + ph);
        pg.addColorStop(0, c.goldBright); pg.addColorStop(1, c.gold);
        ctx.fillStyle = pg; ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = c.blood; ctx.fillRect(px, py, 10, ph); ctx.fillRect(px + pw - 10, py, 10, ph);
        ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(px + 10, py, pw - 20, 2);
        ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(px, py + ph - 2, pw, 2);

        // falling hearts
        for (const hr of hearts) drawHeart(wx(hr.x), wy(hr.y), 8, c.bloodBright);

        // sparks
        for (const p of sparks) {
          ctx.globalAlpha = Math.max(0, p.life / 0.5); ctx.fillStyle = rowColor[p.row];
          ctx.fillRect(wx(p.x) - 2, wy(p.y) - 2, 4, 4);
        }
        ctx.globalAlpha = 1;

        // debug (under the ball)
        if (debug) drawDebug();

        // ball
        const bx = wx(ball.x), by = wy(ball.y);
        ctx.save();
        ctx.shadowColor = c.candle; ctx.shadowBlur = kit.reducedMotion() ? 0 : 14;
        const bg = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, BALL_R * S);
        bg.addColorStop(0, "#fff4d6"); bg.addColorStop(1, c.candle);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, BALL_R * S, 0, 7); ctx.fill();
        ctx.restore();

        for (const f of floaters) {
          ctx.globalAlpha = Math.min(1, f.life * 2);
          label("+1 heart", wx(f.x), wy(f.y), c.bloodBright, 13, "center");
        }
        ctx.globalAlpha = 1;

        if (debug) {
          // velocity vector on top of the ball
          if (phase === "play") {
            const len = Math.min(10, ball.v * 1000 * 0.35) * S;
            const vx2 = bx + Math.cos(ball.av * DEG) * len, vy2 = by - Math.sin(ball.av * DEG) * len;
            arrow(bx, by, vx2, vy2, c.teal, 2.5);
            label("v " + (ball.v * 1000).toFixed(1) + " u/s @ " + fmtA(ball.av), vx2 + (vx2 > W - 130 ? -8 : 8), vy2 + (vy2 < HUD + 14 ? 12 : -2), c.teal, 12, vx2 > W - 130 ? "right" : "left");
          }
        }

        if (phase === "serve" && !paused) {
          label("SPACE / TAP TO LAUNCH", W / 2, wy(-8), c.dim, 14, "center");
        }

        drawOverlay();
      }

      function drawDebug() {
        // ball bounding box (the square used by the corner test)
        ctx.setLineDash([3, 3]); ctx.strokeStyle = c.dim; ctx.lineWidth = 1;
        ctx.strokeRect(wx(ball.x - BALL_R) + 0.5, wy(ball.y + BALL_R) + 0.5, BALL_R * 2 * S, BALL_R * 2 * S);
        ctx.setLineDash([]);
        const e = lastHit;
        if (!e) return;
        const alpha = e.age < 1.2 ? 1 : Math.max(0.4, 1 - (e.age - 1.2) / 2);
        ctx.globalAlpha = alpha;
        const X = e.X, l = X.x + X.border.blx, bt = X.y + X.border.bly, r = X.x + X.border.trx, tp = X.y + X.border.try_;
        // clip to the playfield so thick walls do not draw over the HUD
        ctx.save(); ctx.beginPath(); ctx.rect(0, HUD, W, FIELD_H); ctx.clip();
        ctx.setLineDash([5, 4]); ctx.strokeStyle = c.goldBright; ctx.lineWidth = 1.5;
        ctx.strokeRect(wx(l), wy(tp), (r - l) * S, (tp - bt) * S);
        ctx.setLineDash([]);
        // perpendicular distances from the ball centre (at the hit) to the four side lines
        const feet = [[l, e.by], [e.bx, tp], [r, e.by], [e.bx, bt]];
        for (let i = 0; i < 4; i++) {
          if (i === e.side) continue;
          ctx.strokeStyle = c.ash; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(wx(e.bx), wy(e.by)); ctx.lineTo(wx(feet[i][0]), wy(feet[i][1])); ctx.stroke();
        }
        ctx.setLineDash([]);
        const f = feet[e.side];
        ctx.strokeStyle = c.bloodBright; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(wx(e.bx), wy(e.by)); ctx.lineTo(wx(f[0]), wy(f[1])); ctx.stroke();
        ctx.beginPath(); ctx.arc(wx(e.bx), wy(e.by), BALL_R * S, 0, 7); ctx.strokeStyle = c.dim; ctx.lineWidth = 1; ctx.stroke();
        // normal arrow, anchored on the chosen face
        const ax = wx(kit.clamp(e.side % 2 === 0 ? f[0] : e.bx, l, r)), ay = wy(kit.clamp(e.side % 2 === 0 ? e.by : f[1], bt, tp));
        const len = 3.6 * S;
        arrow(ax, ay, ax + Math.cos(e.nAngle * DEG) * len, ay - Math.sin(e.nAngle * DEG) * len, c.bloodBright, 2.5);
        ctx.restore();
        const lx = ax + Math.cos(e.nAngle * DEG) * (len + 6), ly = ay - Math.sin(e.nAngle * DEG) * (len + 6);
        const al = Math.cos(e.nAngle * DEG) < -0.5 ? "right" : Math.cos(e.nAngle * DEG) > 0.5 ? "left" : "center";
        label("n = " + e.nAngle + "°", kit.clamp(lx, 40, W - 40), kit.clamp(ly, HUD + 10, H - 10), c.bloodBright, 12, al);
        ctx.globalAlpha = 1;
      }

      function overlay(title, sub, sub2, col) {
        ctx.fillStyle = "rgba(7,8,12,.78)"; ctx.fillRect(0, HUD, W, FIELD_H);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "700 44px " + kit.fonts.display; ctx.fillStyle = col || c.goldBright;
        ctx.shadowColor = col || c.gold; ctx.shadowBlur = kit.reducedMotion() ? 0 : 18;
        ctx.fillText(title, W / 2, HUD + FIELD_H / 2 - 36); ctx.shadowBlur = 0;
        ctx.font = "16px " + kit.fonts.mono; ctx.fillStyle = c.text;
        if (sub) ctx.fillText(sub, W / 2, HUD + FIELD_H / 2 + 12);
        ctx.fillStyle = c.dim; ctx.font = "13px " + kit.fonts.mono;
        if (sub2) ctx.fillText(sub2, W / 2, HUD + FIELD_H / 2 + 42);
      }

      function drawOverlay() {
        if (phase === "idle") overlay("ARKANOID", "Press Start", "Mouse / touch / arrow keys move the paddle");
        else if (phase === "over") overlay("GAME OVER", "Score " + score, "Space, tap or Restart to play again", c.bloodBright);
        else if (phase === "cleared") overlay("LEVEL CLEARED", "Score " + score, "Space, tap or Restart to play again", c.teal);
        else if (paused) overlay("PAUSED", "", "Press Resume to continue");
      }

      /* ---------- controls ---------- */
      kit.slider(frame.controls, {
        label: "Ball speed", min: 10, max: 40, step: 1, value: speedU, format: v => v + " u/s",
        onInput: v => { speedU = v; if (phase === "play") ball.v = v / 1000; say(); draw(); }
      });
      kit.slider(frame.controls, {
        label: "Gravity", min: 0, max: 10, step: 0.5, value: gravU, format: v => v.toFixed(1) + " u/s²",
        onInput: v => { gravU = v; ball.g = v / 1e6; say(); draw(); }
      });

      const buttons = h("div", { class: "demo__buttons" });
      frame.controls.append(buttons);
      const btnStart = kit.button(buttons, "Start", () => {
        if (phase === "idle") { phase = "serve"; paused = false; loop.start(); canvas.focus({ preventScroll: true }); }
        else if (phase === "serve" || phase === "play") {
          paused = !paused;
          if (paused) loop.stop(); else loop.start();
          canvas.focus({ preventScroll: true });
        }
        sync(); say(); draw();
      }, "blood");
      const btnRestart = kit.button(buttons, "Restart", () => { restart(); canvas.focus({ preventScroll: true }); });
      const btnDebug = kit.button(buttons, "Physics debug: off", () => {
        debug = !debug;
        sync(); say(); draw();
      });
      btnDebug.setAttribute("aria-pressed", "false");

      const legendHost = h("div", { class: "d-arkanoid__legend", hidden: true });
      frame.root.insertBefore(legendHost, frame.readout);
      kit.legend(legendHost, [
        { color: c.teal, label: "ball velocity v" },
        { color: c.bloodBright, label: "chosen side + normal n" },
        { color: c.ash, label: "other side distances" },
        { color: c.goldBright, label: "last collided rectangle" }
      ]);

      function sync() {
        btnStart.textContent = phase === "idle" ? "Start" : paused ? "Resume" : "Pause";
        btnStart.disabled = phase === "over" || phase === "cleared";
        btnRestart.disabled = phase === "idle";
        btnDebug.textContent = "Physics debug: " + (debug ? "on" : "off");
        btnDebug.setAttribute("aria-pressed", String(debug));
        legendHost.hidden = !debug;
      }

      function restart() {
        newGame(); paused = false; acc = 0;
        loop.start(); sync(); say(); draw();
      }

      /* ---------- input ---------- */
      let down = null;
      const toWorldX = e => cv.toLocal(e).x / S - FIELD_X;
      canvas.addEventListener("pointermove", e => {
        if ((phase === "serve" || phase === "play") && !paused && (e.pointerType === "mouse" || down)) {
          setPaddle(toWorldX(e));
          if (!loop.running) draw();
        }
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.moved = true;
      });
      canvas.addEventListener("pointerdown", e => {
        canvas.focus({ preventScroll: true });
        down = { x: e.clientX, y: e.clientY, moved: false };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if ((phase === "serve" || phase === "play") && !paused) setPaddle(toWorldX(e));
      });
      canvas.addEventListener("pointerup", () => {
        const tap = down && !down.moved;
        down = null;
        if (!tap || paused) return;
        if (phase === "serve") launch();
        else if (phase === "over" || phase === "cleared") restart();
      });
      canvas.addEventListener("pointercancel", () => { down = null; });

      const keyFlag = e => ({ ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" })[e.code];
      canvas.addEventListener("keydown", e => {
        const k = keyFlag(e);
        if (k) { e.preventDefault(); if (phase === "serve" || phase === "play") keys[k] = true; }
        else if (e.code === "Space") {
          e.preventDefault();
          if (e.repeat || paused) return;
          if (phase === "serve") launch();
          else if (phase === "over" || phase === "cleared") restart();
        }
      });
      canvas.addEventListener("keyup", e => { const k = keyFlag(e); if (k) { e.preventDefault(); keys[k] = false; } });
      canvas.addEventListener("blur", () => { keys.left = keys.right = false; });

      /* ---------- go ---------- */
      const loop = kit.loop(canvas, step);
      newGame();
      phase = "idle";
      sync(); say(); draw();
      // fonts may load after first paint
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!loop.running) draw(); });

      return () => { loop.destroy(); styleEl.remove(); frame.root.remove(); };
    }
  });
})();
