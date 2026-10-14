/*
 * Gothic platformer: a small browser level built from the user's C++/SFML university game.
 * Ported logic: Kolizja::czyKolizja (AABB overlap + push factor), Animacja::Update (frame timer
 * with the negative-width flip trick), Bohater (predkosc, strona, rzad) and konfiguracja.txt
 * (ZycieBohatera=5, ZycieBossa=5). Art: Gothicvania collection by Luis Zuno (@ansimuz), public domain.
 */
(function () {
  "use strict";

  const NAME = "gothic-platformer";
  const ART = "assets/demos/gothic/";

  /* konfiguracja.txt */
  const ZYCIE_BOHATERA = 5;
  const ZYCIE_BOSSA = 5;

  /* World: the 640x360 canvas shows a 398x224 window of the level (pixel art at ~1.6x). */
  const LW = 640, LH = 360, VH = 224, ZOOM = LH / VH, VW = LW / ZOOM;
  const FLOOR = 196, LEVEL_W = 2400, GATE_X = 1440, ARENA_X = 1990;
  const PREDKOSC = 120, GRAVITY = 1000, JUMP_V = -420, MAX_FALL = 600;
  const DOOR_H = 56;

  /* Sprite sheets: size, frame count, anchor x (body centre) and bottom (feet) inside a frame. */
  const SHEETS = {
    idle: { src: "idle.png", w: 152, h: 48, n: 4, ax: 20, bottom: 48, t: 0.3 },        // Bohater switchtime 0.3 s
    run: { src: "gothic.png", w: 792, h: 48, n: 12, ax: 33, bottom: 48, t: 0.06 },
    attack: { src: "ataku.png", w: 576, h: 48, n: 6, ax: 45, bottom: 48, t: 0.06 },
    jump: { src: "jump.png", w: 305, h: 77, n: 5, ax: 30, bottom: 76, bottoms: [76, 67, 48, 42, 60], t: 0.1 },
    wolf: { src: "wilk.png", w: 224, h: 32, n: 4, ax: 28, bottom: 32, t: 0.1 },
    bossIdle: { src: "bossstoi.png", w: 960, h: 144, n: 6, ax: 64, bottom: 127, t: 0.15 },
    bossAttack: { src: "bossatakuje.png", w: 1536, h: 176, n: 8, ax: 86, bottom: 168, t: 0.1 },
    fire: { src: "ogien.png", w: 800, h: 96, n: 5, ax: 85, bottom: 86, t: 0.07 }
  };
  const BG = { town: "tlo.png", castle: "tlo2.png", floor: "podloga.png" };

  const CSS = `
.d-gothic-platformer .demo__stage { overflow: hidden; }
.d-gothic-platformer canvas:focus { outline: none; }
.d-gothic-platformer canvas:focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }
.d-gothic-platformer .gp-start { position: absolute; left: 50%; bottom: 11%; transform: translateX(-50%); z-index: 2; white-space: nowrap; }
.d-gothic-platformer .gp-start:hover { transform: translateX(-50%) translateY(-1px); }
.d-gothic-platformer .gp-start[hidden] { display: none; }
.d-gothic-platformer .gp-pad { display: none; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .45rem; margin-top: .7rem; }
.d-gothic-platformer .gp-pad .btn { justify-content: center; min-height: 48px; padding: .5em .3em; font-size: .72rem; letter-spacing: .04em;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.d-gothic-platformer .gp-pad .btn:hover { transform: none; background: rgba(7, 8, 12, .5); color: var(--parchment); }
.d-gothic-platformer .gp-pad .btn.is-down { background: var(--blood); color: var(--parchment); }
@media (max-width: 520px) { .d-gothic-platformer .gp-start { font-size: .72rem; padding: .5em 1.1em; bottom: 7%; } }
@media (pointer: coarse), (max-width: 720px) { .d-gothic-platformer .gp-pad { display: grid; } }
.d-gothic-platformer .gp-credit { margin: .5rem 0 0; font-size: .78rem; color: var(--ash); font-style: italic; }
`;

  /* ---------- Port of Animacja (frame timer; negative uv width = mirrored frame) ---------- */
  function Animacja(sheet, switchtime) {
    this.imagecount = { x: sheet.n, y: 1 };
    this.switchtime = switchtime;
    this.totaltime = 0;
    this.currentimage = { x: 0, y: 0 };
    this.uvRect = { left: 0, top: 0, width: sheet.w / sheet.n, height: sheet.h };
  }
  Animacja.prototype.update = function (row, deltatime, strona) {
    this.currentimage.y = row;
    this.totaltime += deltatime;
    if (this.totaltime >= this.switchtime) {
      this.totaltime -= this.switchtime;
      this.currentimage.x++;
      if (this.currentimage.x >= this.imagecount.x) this.currentimage.x = 0;
    }
    const w = Math.abs(this.uvRect.width);
    this.uvRect.top = this.currentimage.y * this.uvRect.height;
    if (strona) { this.uvRect.left = this.currentimage.x * w; this.uvRect.width = w; }
    else { this.uvRect.left = (this.currentimage.x + 1) * w; this.uvRect.width = -w; }
  };
  Animacja.prototype.reset = function () { this.totaltime = 0; this.currentimage.x = 0; };

  /* ---------- Port of Kolizja::czyKolizja (bodies are centre + half size, like SFML origin) ----------
   * push = 0: `ta` absorbs the whole overlap; push = 1: `inna` is pushed out entirely.
   * Returns null or the direction `inna` was pushed ({x, y} with -1/0/1). The original resolved both
   * axes in one branch; here the axis of least overlap is resolved, which is what that code intended. */
  function czyKolizja(ta, inna, push) {
    const deltaX = inna.x - ta.x, deltaY = inna.y - ta.y;
    const przeciecieX = Math.abs(deltaX) - (inna.hw + ta.hw);
    const przeciecieY = Math.abs(deltaY) - (inna.hh + ta.hh);
    if (przeciecieX < 0 && przeciecieY < 0) {
      push = Math.min(Math.max(push, 0), 1);
      if (Math.abs(przeciecieX) < Math.abs(przeciecieY)) {
        if (deltaX > 0) { ta.x += przeciecieX * (1 - push); inna.x -= przeciecieX * push; return { x: 1, y: 0 }; }
        ta.x -= przeciecieX * (1 - push); inna.x += przeciecieX * push; return { x: -1, y: 0 };
      }
      if (deltaY > 0) { ta.y += przeciecieY * (1 - push); inna.y -= przeciecieY * push; return { x: 0, y: 1 }; }
      ta.y -= przeciecieY * (1 - push); inna.y += przeciecieY * push; return { x: 0, y: -1 };
    }
    return null;
  }
  const overlaps = (a, b) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;
  const overlapAxis = (a, b) => {
    const px = a.hw + b.hw - Math.abs(a.x - b.x), py = a.hh + b.hh - Math.abs(a.y - b.y);
    return px > 0 && py > 0 ? (px < py ? "x" : "y") : null;
  };

  const HEART = [" xx xx ", "xxxxxxx", "xxxxxxx", " xxxxx ", "  xxx  ", "   x   "];

  PortfolioDemos.register(NAME, {
    title: "Gothic Escape: playable level",
    note: "Press Start, then run through the town, smash candles for hearts, open the castle gate (L, or attack it) and defeat the boss. The coffin uses the original push-factor collision: drag the slider and shove it.",
    mount(host, kit) {
      const h = kit.h, C = kit.colors(), F = kit.fonts;
      const reduced = kit.reducedMotion();

      let style = document.getElementById("d-" + NAME + "-style");
      if (!style) { style = h("style", { id: "d-" + NAME + "-style" }, CSS); document.head.append(style); }

      const frame = kit.frame(host);
      frame.root.classList.add("d-" + NAME);
      const cv = kit.canvas(frame.stage, LW, LH, "Playable gothic platformer level. Focus it and use W A S D or the arrow keys to move and jump, J or K to attack, L to open doors.");
      const { canvas, ctx, dpr } = cv;
      canvas.tabIndex = 0;
      canvas.setAttribute("role", "application");

      /* ---------- Images ---------- */
      const img = {};
      const onImg = () => { if (state !== "play") render(); };
      Object.keys(SHEETS).forEach(k => { const i = new Image(); i.onload = onImg; i.src = ART + SHEETS[k].src; img[k] = i; });
      Object.keys(BG).forEach(k => { const i = new Image(); i.onload = onImg; i.src = ART + BG[k]; img[k] = i; });
      const ready = i => i && i.complete && i.naturalWidth > 0;

      /* ---------- Controls ---------- */
      const startBtn = h("button", { type: "button", class: "btn btn--blood gp-start" }, "Press Start");
      frame.stage.append(startBtn);
      const pad = h("div", { class: "gp-pad", role: "group", "aria-label": "Touch controls" });
      frame.root.insertBefore(pad, frame.controls);
      const btnRow = h("div", { class: "demo__buttons" });
      frame.controls.append(btnRow);
      const restartBtn = kit.button(btnRow, "Start", () => startGame(), "blood");
      const pauseBtn = kit.button(btnRow, "Pause", () => togglePause());
      const boxBtn = kit.button(btnRow, "Hitboxes: off", () => {
        showBoxes = !showBoxes;
        boxBtn.textContent = "Hitboxes: " + (showBoxes ? "on" : "off");
        boxBtn.setAttribute("aria-pressed", String(showBoxes));
        if (!loop.running) render();
      });
      boxBtn.setAttribute("aria-pressed", "false");
      let pushFactor = 0.5;
      kit.slider(frame.controls, {
        label: "Push factor (coffin)", min: 0, max: 1, step: 0.05, value: pushFactor, format: v => (+v).toFixed(2),
        onInput: v => { pushFactor = v; updateReadout(); }
      });
      kit.legend(frame.controls, [
        { color: C.gold, label: "hero AABB" }, { color: C.teal, label: "solids" },
        { color: C.bloodBright, label: "enemies" }, { color: C.candle, label: "attack box" }
      ]);
      frame.root.append(h("p", { class: "gp-credit" }, "Art: Gothicvania collection by Luis Zuno @ansimuz (public domain)."));

      /* ---------- Input ---------- */
      const keys = { left: false, right: false, jump: false };
      let attackQueued = false, useQueued = false, jumpQueued = false;
      const KEYMAP = {
        KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
        KeyW: "jump", ArrowUp: "jump", Space: "jump", KeyJ: "attack", KeyK: "attack", KeyL: "use",
        KeyS: "down", ArrowDown: "down", KeyP: "pause", Enter: "enter"
      };
      const press = (act, down) => {
        if (act === "left" || act === "right") keys[act] = down;
        else if (act === "jump") { if (down && !keys.jump) jumpQueued = true; keys.jump = down; }
        else if (act === "attack" && down) attackQueued = true;
        else if (act === "use" && down) useQueued = true;
      };
      const onKeyDown = e => {
        const act = KEYMAP[e.code];
        if (!act) return;
        e.preventDefault();
        if (e.repeat && act !== "left" && act !== "right") return;
        if (act === "enter") { if (state !== "play") startGame(); return; }
        if (act === "pause") { if (state === "play") togglePause(); return; }
        if (state === "play" && paused) togglePause();
        press(act, true);
      };
      const onKeyUp = e => { const act = KEYMAP[e.code]; if (!act) return; e.preventDefault(); press(act, false); };
      const clearKeys = () => { keys.left = keys.right = keys.jump = false; pad.querySelectorAll(".is-down").forEach(b => b.classList.remove("is-down")); };
      canvas.addEventListener("keydown", onKeyDown);
      canvas.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("blur", clearKeys);
      canvas.addEventListener("pointerdown", () => { canvas.focus({ preventScroll: true }); if (state === "play" && paused) togglePause(); });

      [["Left", "left", "Move left"], ["Right", "right", "Move right"], ["Jump", "jump", "Jump"], ["Attack", "attack", "Attack"]].forEach(([label, act, aria]) => {
        const b = h("button", { type: "button", class: "btn btn--small btn--ghost", "aria-label": aria }, label);
        const up = () => { b.classList.remove("is-down"); press(act, false); };
        b.addEventListener("pointerdown", e => {
          e.preventDefault();
          try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
          b.classList.add("is-down");
          if (state === "play" && paused) togglePause();
          press(act, true);
        });
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("lostpointercapture", up);
        b.addEventListener("contextmenu", e => e.preventDefault());
        pad.append(b);
      });

      /* ---------- Game state ---------- */
      let state = "title", paused = false, showBoxes = false, shake = 0, clock = 0, playTime = 0;
      let hero, boss, wolves, candles, coffin, gate, fireballs, fx, floaters, hearts, camX = 0, endTimer = 0;

      const platforms = [
        { x: 330, y: 158, w: 96 }, { x: 545, y: 128, w: 80 }, { x: 930, y: 150, w: 112 }, { x: 1170, y: 122, w: 72 },
        { x: 1660, y: 156, w: 96 }, { x: 1855, y: 126, w: 80 }
      ].map(p => ({ x: p.x, y: p.y + 8, hw: p.w / 2, hh: 8, top: p.y, kind: "platform" }));
      const floorBody = { x: LEVEL_W / 2, y: FLOOR + 50, hw: LEVEL_W / 2 + 60, hh: 50, kind: "floor" };
      const wallL = { x: -10, y: VH / 2, hw: 10, hh: VH, kind: "wall" };
      const wallR = { x: LEVEL_W + 10, y: VH / 2, hw: 10, hh: VH, kind: "wall" };
      const gateWall = { x: GATE_X, y: (FLOOR - DOOR_H) / 2 - 40, hw: 14, hh: (FLOOR - DOOR_H) / 2 + 40, kind: "wall" };
      const doorBody = { x: GATE_X, y: FLOOR - DOOR_H / 2, hw: 10, hh: DOOR_H / 2, kind: "door" };
      const braziers = [150, 800, 1395, 1500, 2050, 2370];

      function newGame() {
        hero = { x: 60, y: FLOOR - 19, hw: 8, hh: 19, vy: 0, kx: 0, strona: true, rzad: 0, grounded: true, life: ZYCIE_BOHATERA,
          inv: 0, attacking: false, atkT: 0, hitSet: null, dead: false, deadT: 0,
          anim: { idle: new Animacja(SHEETS.idle, SHEETS.idle.t), run: new Animacja(SHEETS.run, SHEETS.run.t),
            attack: new Animacja(SHEETS.attack, SHEETS.attack.t), jump: new Animacja(SHEETS.jump, SHEETS.jump.t) } };
        boss = { x: 2250, y: FLOOR - 45, hw: 28, hh: 45, life: ZYCIE_BOSSA, state: "stoi", awake: false, timer: 1.2, inv: 0, strona: false,
          atkT: 0, hitDone: false, throws: 0, deadT: 0,
          anim: { stoi: new Animacja(SHEETS.bossIdle, SHEETS.bossIdle.t), atakuje: new Animacja(SHEETS.bossAttack, SHEETS.bossAttack.t) } };
        wolves = [[520, 400, 680], [1180, 1020, 1330], [1760, 1560, 1950]].map(([x, a, b], i) => ({
          x, y: FLOOR - 8, hw: 16, hh: 8, min: a, max: b, dir: i % 2 ? 1 : -1, alive: true, anim: new Animacja(SHEETS.wolf, SHEETS.wolf.t)
        }));
        const cand = [[210, FLOOR], [330, 158], [545, 128], [930, 150], [1170, 122], [1300, FLOOR], [1660, 156], [1855, 126], [2010, FLOOR]];
        candles = cand.map(([x, base]) => ({ x, y: base - 12, hw: 4, hh: 12, base, broken: false, ph: x * 0.37 }));
        coffin = { x: 720, y: FLOOR - 10, hw: 16, hh: 10, vy: 0 };
        gate = { open: 0, opening: false };
        fireballs = []; fx = []; floaters = []; hearts = 0; playTime = 0; endTimer = 0; shake = 0;
        camX = 0;
      }
      newGame();

      function solids() {
        const s = [floorBody, wallL, wallR, gateWall];
        if (gate.open < 0.85) s.push(doorBody);
        return s.concat(platforms);
      }

      function startGame() {
        newGame();
        state = "play"; paused = false;
        clearKeys(); attackQueued = useQueued = jumpQueued = false;
        startBtn.hidden = true;
        restartBtn.textContent = "Restart";
        pauseBtn.textContent = "Pause";
        canvas.focus({ preventScroll: true });
        loop.start();
        updateReadout();
      }
      function togglePause() {
        if (state !== "play") return;
        paused = !paused;
        pauseBtn.textContent = paused ? "Play" : "Pause";
        if (paused) { loop.stop(); clearKeys(); render(); } else loop.start();
        updateReadout();
      }
      function endGame(win) {
        state = win ? "win" : "over";
        startBtn.textContent = win ? "Play again" : "Restart";
        startBtn.hidden = false;
        clearKeys();
        loop.stop();
        render();
        updateReadout();
      }

      /* ---------- Simulation ---------- */
      function hurtHero(fromX) {
        if (hero.inv > 0 || hero.dead) return;
        hero.life--;
        hero.inv = 1.0;
        hero.kx = (hero.x < fromX ? -1 : 1) * 190;
        hero.vy = -220; hero.grounded = false;
        hero.attacking = false;
        if (!reduced) shake = 0.25;
        if (hero.life <= 0) { hero.dead = true; hero.deadT = 0; }
        updateReadout();
      }
      function burst(x, y, scale) { fx.push({ x, y, s: scale, t: 0, anim: new Animacja(SHEETS.fire, SHEETS.fire.t) }); }
      function sparks(x, y, color, n) {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
          floaters.push({ type: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: 0, life: 0.5 + Math.random() * 0.3, color });
        }
      }
      function openGate() { if (gate.open === 0 && !gate.opening) { gate.opening = true; updateReadout(); } }

      function breakCandle(c) {
        c.broken = true;
        sparks(c.x, c.y - 8, C.candle, 10);
        floaters.push({ type: "heart", x: c.x, y: c.y - 6, t: 0, life: 1.2 });
        hearts++;
        const r = canvas.getBoundingClientRect();
        const sx = r.width / LW, sy = r.height / LH;
        kit.addHearts(1, r.left + (c.x - camX) * ZOOM * sx, r.top + (c.y - 6) * ZOOM * sy);
        updateReadout();
      }

      function heroPhysics(dt) {
        let dx = 0;
        if (!hero.dead) {
          if (keys.left) dx -= 1;
          if (keys.right) dx += 1;
          if (hero.attacking && hero.grounded) dx = 0;
        }
        // Bohater::Update: ruch.x = +-predkosc * deltatime, strona from the sign of ruch.x
        if (dx > 0) hero.strona = true; else if (dx < 0) hero.strona = false;
        hero.x += (dx * PREDKOSC + hero.kx) * dt;
        hero.kx *= Math.exp(-7 * dt);
        if (Math.abs(hero.kx) < 2) hero.kx = 0;
        hero.vy = Math.min(MAX_FALL, hero.vy + GRAVITY * dt);
        hero.y += hero.vy * dt;
        hero.grounded = false;
        const s = solids();
        for (const b of s) {
          const d = czyKolizja(b, hero, 1);                // static body: the hero takes the whole overlap
          if (!d) continue;
          if (d.y === -1 && hero.vy >= 0) { hero.vy = 0; hero.grounded = true; }
          if (d.y === 1 && hero.vy < 0) hero.vy = 0;
          if (d.x) hero.kx = 0;
        }
        // Coffin: falls, rests on solids, and is shoved with the user's push factor.
        coffin.vy = Math.min(MAX_FALL, coffin.vy + GRAVITY * dt);
        coffin.y += coffin.vy * dt;
        for (const b of s) { const d = czyKolizja(b, coffin, 1); if (d && d.y === -1) coffin.vy = 0; }
        const axis = overlapAxis(hero, coffin);
        if (axis === "x") {
          czyKolizja(hero, coffin, pushFactor);              // hero moves (1 - push), coffin moves push
          for (const b of s) czyKolizja(b, coffin, 1);
          czyKolizja(coffin, hero, 1);                        // coffin blocked by a wall: hero stops
        } else if (axis === "y") {
          const d = czyKolizja(coffin, hero, 1);
          if (d && d.y === -1 && hero.vy >= 0) { hero.vy = 0; hero.grounded = true; }
          if (d && d.y === 1 && hero.vy < 0) hero.vy = 0;
        }
      }

      function step(dt) {
        clock += dt;
        if (state !== "play" || paused) { render(); return; }
        playTime += dt;
        // fixed sub-steps so fast falls never tunnel through 16 px platforms
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        for (let i = 0; i < n; i++) heroPhysics(dt / n);

        if (hero.inv > 0) hero.inv -= dt;
        if (shake > 0) shake -= dt;

        if (!hero.dead) {
          if (jumpQueued && hero.grounded) { hero.vy = JUMP_V; hero.grounded = false; }
          if (!keys.jump && hero.vy < -150) hero.vy *= 0.6;  // short hop when released early
          if (attackQueued && !hero.attacking) {
            hero.attacking = true; hero.atkT = 0; hero.hitSet = new Set(); hero.anim.attack.reset();
          }
          if (useQueued && Math.abs(hero.x - GATE_X) < 46) openGate();
        }
        jumpQueued = attackQueued = useQueued = false;

        // hero animation state (rzad: 0 idle, 1 run, as in Bohater; 2 attack, 3 jump)
        const moving = keys.left !== keys.right && !hero.dead;
        hero.rzad = hero.attacking ? 2 : !hero.grounded ? 3 : moving ? 1 : 0;
        if (hero.rzad === 0) hero.anim.idle.update(0, dt, hero.strona);
        if (hero.rzad === 1) hero.anim.run.update(0, dt, hero.strona);
        if (hero.rzad === 2) hero.anim.attack.update(0, dt, hero.strona);
        if (hero.rzad === 3) {
          const j = hero.anim.jump, vy = hero.vy;
          j.currentimage.x = vy < -260 ? 1 : vy < -60 ? 2 : vy < 120 ? 3 : 4;
          j.totaltime = 0; j.update(0, 0, hero.strona);
        }

        // attack hit box (active on swing frames 2-3)
        let atk = null;
        if (hero.attacking) {
          hero.atkT += dt;
          const f = Math.floor(hero.atkT / SHEETS.attack.t);
          if (f >= 2 && f <= 3) atk = { x: hero.x + (hero.strona ? 22 : -22), y: hero.y - 4, hw: 22, hh: 13 };
          if (hero.atkT >= SHEETS.attack.n * SHEETS.attack.t) hero.attacking = false;
        }
        hero.atk = atk;
        if (atk) {
          wolves.forEach(w => {
            if (w.alive && overlaps(atk, w)) { w.alive = false; burst(w.x, w.y + 4, 0.45); sparks(w.x, w.y, C.moon, 8); updateReadout(); }
          });
          candles.forEach(c => { if (!c.broken && overlaps(atk, c)) breakCandle(c); });
          if (gate.open === 0 && overlaps(atk, { x: GATE_X, y: FLOOR - DOOR_H / 2, hw: 16, hh: DOOR_H / 2 })) openGate();
          if (boss.state !== "pokonany" && boss.inv <= 0 && !hero.hitSet.has(boss) && overlaps(atk, boss)) {
            hero.hitSet.add(boss);
            boss.life--; boss.inv = 0.6; boss.awake = true;
            sparks(boss.x - (hero.strona ? 20 : -20), boss.y - 10, C.bloodBright, 12);
            if (!reduced) shake = 0.15;
            if (boss.life <= 0) { boss.state = "pokonany"; boss.deadT = 0; fireballs = []; }
            updateReadout();
          }
        }

        // gate opening
        if (gate.opening) { gate.open = Math.min(1, gate.open + dt / 0.9); if (gate.open >= 1) gate.opening = false; }

        // wolves patrol; they speed up when the hero is close on the same level
        wolves.forEach(w => {
          if (!w.alive) return;
          const near = Math.abs(hero.x - w.x) < 130 && Math.abs(hero.y - w.y) < 40 && !hero.dead;
          if (near) w.dir = hero.x < w.x ? -1 : 1;
          w.x += w.dir * (near ? 105 : 55) * dt;
          if (w.x < w.min) { w.x = w.min; w.dir = 1; }
          if (w.x > w.max) { w.x = w.max; w.dir = -1; }
          const d = czyKolizja(coffin, w, 1);
          if (d && d.x) w.dir = d.x;
          w.anim.update(0, dt * (near ? 1.6 : 1), w.dir > 0);
          if (overlaps(hero, w)) hurtHero(w.x);
        });

        updateBoss(dt);

        // fireballs
        fireballs = fireballs.filter(f => {
          f.x += f.vx * dt; f.t += dt;
          f.anim.update(0, 0, f.vx > 0);
          if (overlaps(hero, f)) { hurtHero(f.x); burst(f.x, f.y + 6, 0.3); return false; }
          return f.t < 4 && f.x > ARENA_X - 120 && f.x < LEVEL_W;
        });

        braziers.forEach(b => fireAnim[b].update(0, dt, true));
        // effects, floaters
        fx = fx.filter(e => { e.t += dt; e.anim.update(0, dt, true); return e.t < SHEETS.fire.n * SHEETS.fire.t - 0.001; });
        floaters = floaters.filter(p => {
          p.t += dt;
          if (p.type === "spark") { p.vy += 300 * dt; p.x += p.vx * dt; p.y += p.vy * dt; } else p.y -= 18 * dt;
          return p.t < p.life;
        });

        if (hero.dead) { hero.deadT += dt; if (hero.deadT > 1.3) { endGame(false); return; } }
        if (boss.state === "pokonany" && boss.deadT > 1.8) { endGame(true); return; }

        const target = hero.x - VW * 0.42;
        camX = Math.round(kit.clamp(target, 0, LEVEL_W - VW));
        render();
        updateReadout();
      }

      function updateBoss(dt) {
        if (boss.inv > 0) boss.inv -= dt;
        if (!boss.awake && hero.x > ARENA_X) { boss.awake = true; updateReadout(); }
        const dx = hero.x - boss.x;
        if (boss.state === "pokonany") {
          boss.deadT += dt;
          if (Math.random() < dt * 9) burst(boss.x + (Math.random() - 0.5) * 70, boss.y + (Math.random() - 0.3) * 70, 0.35 + Math.random() * 0.3);
          return;
        }
        if (boss.state === "stoi") {
          boss.anim.stoi.update(0, dt, boss.strona);
          if (!boss.awake) return;
          boss.strona = dx > 0;
          if (Math.abs(dx) > 70) boss.x = kit.clamp(boss.x + Math.sign(dx) * 28 * dt, ARENA_X + 80, LEVEL_W - 95);
          boss.timer -= dt;
          if (boss.timer <= 0 && !hero.dead) {
            if (Math.abs(dx) < 140 || boss.throws >= 2) {
              boss.state = "atakuje"; boss.atkT = 0; boss.hitDone = false; boss.anim.atakuje.reset(); boss.throws = 0;
            } else {
              boss.throws++;
              const dir = dx > 0 ? 1 : -1;
              fireballs.push({ x: boss.x + dir * 30, y: FLOOR - 12, hw: 8, hh: 6, vx: dir * 135, t: 0, anim: new Animacja(SHEETS.fire, 1) });
              boss.timer = 0.8 + 0.15 * boss.life;
            }
          }
        } else if (boss.state === "atakuje") {
          boss.anim.atakuje.update(0, dt, boss.strona);
          boss.atkT += dt;
          const f = Math.floor(boss.atkT / SHEETS.bossAttack.t);
          boss.swing = f >= 3 && f <= 5 ? { x: boss.x + (boss.strona ? 50 : -50), y: FLOOR - 28, hw: 46, hh: 28 } : null;
          if (boss.swing && !boss.hitDone && overlaps(hero, boss.swing)) { boss.hitDone = true; hurtHero(boss.x); }
          if (boss.atkT >= SHEETS.bossAttack.n * SHEETS.bossAttack.t) { boss.state = "stoi"; boss.swing = null; boss.timer = 0.7 + 0.18 * boss.life; }
        }
        if (overlaps(hero, boss) && !hero.dead) { czyKolizja(boss, hero, 1); hurtHero(boss.x); }
      }

      /* ---------- Rendering ---------- */
      function drawFrame(sheetKey, anim, fx0, fy0, opts) {
        const im = img[sheetKey], sh = SHEETS[sheetKey];
        if (!ready(im)) return;
        const o = opts || {};
        const uv = anim.uvRect, fw = Math.abs(uv.width), flipped = uv.width < 0, s = o.scale || 1;
        const sx = (flipped ? uv.left - fw : uv.left) + (o.offset || 0) * fw;
        const bottom = o.bottom !== undefined ? o.bottom : sh.bottoms ? sh.bottoms[anim.currentimage.x] : sh.bottom;
        const ax0 = o.ax !== undefined ? o.ax : sh.ax;
        const ax = flipped ? fw - ax0 : ax0;
        const dx = Math.round(fx0 - camX - ax * s), dy = Math.round(fy0 - bottom * s);
        if (flipped) {
          ctx.save(); ctx.translate(dx + fw * s, dy); ctx.scale(-1, 1);
          ctx.drawImage(im, sx, uv.top, fw, uv.height, 0, 0, fw * s, uv.height * s);
          ctx.restore();
        } else ctx.drawImage(im, sx, uv.top, fw, uv.height, dx, dy, fw * s, uv.height * s);
      }

      function drawBackground() {
        const gx = GATE_X - camX;
        if (gx > 0) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.min(VW, gx), VH); ctx.clip();
          if (ready(img.town)) {
            const off = -((camX * 0.35) % 512);
            for (let x = off; x < VW; x += 512) ctx.drawImage(img.town, Math.round(x), 0);
          } else { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, VW, VH); }
          ctx.restore();
        }
        if (gx < VW) {
          ctx.save(); ctx.beginPath(); ctx.rect(Math.max(0, gx), 0, VW, VH); ctx.clip();
          ctx.fillStyle = "#0f1f24"; ctx.fillRect(0, 0, VW, VH);
          if (ready(img.castle)) {
            const off = -(((camX - GATE_X) * 0.55) % 960) - 960;
            for (let x = off; x < VW; x += 960) ctx.drawImage(img.castle, 0, 70, 960, 224, Math.round(x), 0, 960, 224);
          }
          ctx.restore();
        }
      }

      function drawPlatform(p) {
        const x0 = Math.round(p.x - p.hw - camX), y0 = p.top, w = p.hw * 2;
        if (x0 > VW || x0 + w < 0) return;
        if (ready(img.floor)) {
          ctx.drawImage(img.floor, 0, 2, 12, 22, x0, y0 - 2, 12, 22);
          for (let x = 12; x < w - 12; x += 96) { const cw = Math.min(96, w - 12 - x); ctx.drawImage(img.floor, 40, 2, cw, 22, x0 + x, y0 - 2, cw, 22); }
          ctx.drawImage(img.floor, 244, 2, 12, 22, x0 + w - 12, y0 - 2, 12, 22);
        } else { ctx.fillStyle = C.line; ctx.fillRect(x0, y0, w, 16); }
      }

      function drawFloor() {
        ctx.fillStyle = "rgb(12,29,28)"; ctx.fillRect(0, FLOOR, VW, VH - FLOOR);
        if (!ready(img.floor)) { ctx.fillStyle = C.line; ctx.fillRect(0, FLOOR, VW, 6); return; }
        const off = -(camX % 192);
        for (let x = off; x < VW; x += 192) ctx.drawImage(img.floor, 32, 2, 192, 34, Math.round(x), FLOOR - 1, 192, 34);
      }

      function drawGate() {
        const x = Math.round(GATE_X - camX);
        if (x < -40 || x > VW + 40) return;
        const top = FLOOR - DOOR_H;
        // portcullis (behind the wall)
        const lift = Math.round(gate.open * (DOOR_H - 6));
        ctx.save(); ctx.beginPath(); ctx.rect(x - 12, top, 24, DOOR_H); ctx.clip();
        ctx.fillStyle = "rgba(5,6,10,.85)"; ctx.fillRect(x - 12, top, 24, DOOR_H);
        ctx.fillStyle = "#3a2f1d";
        for (let bx = -10; bx <= 10; bx += 5) ctx.fillRect(x + bx - 1, top - lift, 2, DOOR_H);
        for (let by = 8; by < DOOR_H; by += 12) ctx.fillRect(x - 12, top - lift + by, 24, 2);
        ctx.fillStyle = C.gold;
        for (let bx = -10; bx <= 10; bx += 5) ctx.fillRect(x + bx - 1, top - lift + DOOR_H - 3, 2, 3);
        ctx.restore();
        // stone wall column with an arch
        ctx.fillStyle = "#1d2a2c"; ctx.fillRect(x - 16, 0, 32, top);
        ctx.fillRect(x - 16, top, 4, DOOR_H); ctx.fillRect(x + 12, top, 4, DOOR_H);
        ctx.fillStyle = "#2c3d3f";
        for (let y = 0; y < top; y += 8) {
          const o = (y / 8) % 2 ? 0 : 8;
          for (let bx = -16 + o; bx < 16; bx += 16) ctx.fillRect(x + bx + 1, y + 1, Math.min(14, 15 - bx), 6);
        }
        ctx.fillStyle = C.gold; ctx.fillRect(x - 16, top - 3, 32, 2); ctx.fillRect(x - 2, top - 8, 4, 6);
        // prompt
        if (state === "play" && gate.open === 0 && Math.abs(hero.x - GATE_X) < 70) {
          ctx.font = "8px " + F.pixel; ctx.textAlign = "center"; ctx.fillStyle = C.goldBright;
          ctx.fillText("L / ATTACK: OPEN", x, top - 14);
        }
      }

      function drawBrazier(wx, t) {
        const x = Math.round(wx - camX);
        if (x < -30 || x > VW + 30) return;
        ctx.fillStyle = "#18151b"; ctx.fillRect(x - 1, FLOOR - 22, 3, 22); ctx.fillRect(x - 5, FLOOR - 2, 11, 2);
        ctx.fillStyle = "#4a3a22"; ctx.fillRect(x - 7, FLOOR - 26, 15, 4); ctx.fillStyle = C.gold; ctx.fillRect(x - 7, FLOOR - 26, 15, 1);
        glow(x, FLOOR - 32, 26 + (reduced ? 0 : Math.sin(t * 9 + wx) * 2), "rgba(255,150,60,.28)");
        const a = fireAnim[wx];
        if (a) drawFrame("fire", a, wx, FLOOR - 24, { scale: 0.22, offset: 1 });
      }
      const fireAnim = {};
      braziers.forEach((b, i) => { const a = new Animacja({ w: 640, h: 96, n: 4 }, 0.11); a.currentimage.x = i % 4; a.update(0, 0, i % 2 === 0); fireAnim[b] = a; });

      function glow(x, y, r, color) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
      }

      function drawCandle(c, t) {
        if (c.broken) return;
        const x = Math.round(c.x - camX), b = c.base;
        if (x < -20 || x > VW + 20) return;
        ctx.fillStyle = "#2a2430"; ctx.fillRect(x - 1, b - 16, 2, 16); ctx.fillRect(x - 4, b - 2, 8, 2);
        ctx.fillStyle = C.gold; ctx.fillRect(x - 4, b - 17, 8, 2);
        ctx.fillStyle = C.text; ctx.fillRect(x - 2, b - 23, 4, 6);
        const fl = reduced ? 0 : Math.round(Math.sin(t * 12 + c.ph));
        ctx.fillStyle = C.candle; ctx.fillRect(x - 1, b - 27 + (fl > 0 ? 1 : 0), 2, 4 - (fl > 0 ? 1 : 0));
        ctx.fillStyle = "#fff3c4"; ctx.fillRect(x, b - 25, 1, 2);
        glow(x, b - 25, 14, "rgba(255,181,71,.35)");
      }

      function drawCoffin() {
        const x = Math.round(coffin.x - camX), y = Math.round(coffin.y);
        if (x < -30 || x > VW + 30) return;
        ctx.fillStyle = "#2b1a14"; ctx.fillRect(x - 16, y - 10, 32, 20);
        ctx.fillStyle = "#4a2c1f"; ctx.fillRect(x - 15, y - 9, 30, 3);
        ctx.fillStyle = "#1a0f0c"; ctx.fillRect(x - 16, y + 7, 32, 3);
        ctx.fillStyle = C.gold; ctx.fillRect(x - 1, y - 7, 2, 12); ctx.fillRect(x - 4, y - 4, 8, 2);
      }

      function drawHeart(x, y, s, color) {
        ctx.fillStyle = color;
        HEART.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] === "x") ctx.fillRect(x + rx * s, y + ry * s, s, s); });
      }

      function drawBox(b, color) {
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(b.x - b.hw - camX) + 0.5, Math.round(b.y - b.hh) + 0.5, Math.round(b.hw * 2) - 1, Math.round(b.hh * 2) - 1);
      }

      function drawWorld(t) {
        ctx.setTransform(dpr * ZOOM, 0, 0, dpr * ZOOM, 0, 0);
        ctx.imageSmoothingEnabled = false;
        if (shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 3));
        drawBackground();
        braziers.forEach(b => drawBrazier(b, t));
        platforms.forEach(drawPlatform);
        drawGate();
        drawFloor();
        candles.forEach(c => drawCandle(c, t));
        drawCoffin();
        wolves.forEach(w => { if (w.alive) drawFrame("wolf", w.anim, w.x, FLOOR); });

        // boss
        if (boss.state !== "pokonany" || boss.deadT < 1.1) {
          ctx.save();
          if (boss.state === "pokonany") ctx.globalAlpha = Math.max(0, 1 - boss.deadT / 1.1);
          else if (boss.inv > 0 && Math.floor(boss.inv * 20) % 2) ctx.globalAlpha = 0.45;
          const bob = reduced ? 0 : Math.round(Math.sin(t * 2.2) * 2);
          if (boss.state === "atakuje") drawFrame("bossAttack", boss.anim.atakuje, boss.x, FLOOR + 2 + bob);
          else drawFrame("bossIdle", boss.anim.stoi, boss.x, FLOOR + 2 + bob);
          ctx.restore();
        }
        fireballs.forEach(f => { glow(f.x - camX, f.y, 14, "rgba(255,120,40,.35)"); drawFrame("fire", f.anim, f.x, f.y, { scale: 0.6, ax: 114, bottom: 34 }); });

        // hero
        if (!(hero.inv > 0 && Math.floor(hero.inv * 16) % 2) || hero.dead) {
          ctx.save();
          if (hero.dead) ctx.globalAlpha = Math.max(0, 1 - hero.deadT / 1.2);
          const feet = hero.y + hero.hh;
          const key = ["idle", "run", "attack", "jump"][hero.rzad];
          drawFrame(key, hero.anim[key], hero.x, key === "jump" ? feet + 2 : feet);
          ctx.restore();
        }

        fx.forEach(e => drawFrame("fire", e.anim, e.x, e.y + 40 * e.s, { scale: e.s }));
        floaters.forEach(p => {
          const a = 1 - p.t / p.life;
          ctx.globalAlpha = a;
          if (p.type === "spark") { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x - camX), Math.round(p.y), 2, 2); }
          else drawHeart(Math.round(p.x - camX - 3.5), Math.round(p.y - 3), 1, C.bloodBright);
          ctx.globalAlpha = 1;
        });

        if (showBoxes) {
          solids().forEach(b => drawBox(b, C.teal));
          drawBox(coffin, C.teal);
          wolves.forEach(w => w.alive && drawBox(w, C.bloodBright));
          candles.forEach(c => !c.broken && drawBox(c, C.candle));
          if (boss.state !== "pokonany") drawBox(boss, C.bloodBright);
          if (boss.swing) drawBox(boss.swing, C.bloodBright);
          fireballs.forEach(f => drawBox(f, C.bloodBright));
          drawBox(hero, C.gold);
          if (hero.atk) drawBox(hero.atk, C.candle);
        }

        // vignette
        const v = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VW * 0.65);
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.45)");
        ctx.fillStyle = v; ctx.fillRect(-4, -4, VW + 8, VH + 8);
      }

      function bar(x, y, n, max, segW, fill) {
        for (let i = 0; i < max; i++) {
          const sx = x + i * (segW + 3);
          ctx.fillStyle = "rgba(7,8,12,.85)"; ctx.fillRect(sx - 1, y - 1, segW + 2, 12);
          ctx.fillStyle = i < n ? fill : C.grid; ctx.fillRect(sx, y, segW, 10);
          if (i < n) { ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(sx, y, segW, 2); }
        }
      }

      function drawHUD() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.font = "12px " + F.pixel;
        ctx.fillStyle = "rgba(7,8,12,.6)"; ctx.fillRect(10, 10, 186, 26);
        ctx.strokeStyle = C.gold; ctx.lineWidth = 1; ctx.strokeRect(10.5, 10.5, 185, 25);
        ctx.fillStyle = C.goldBright; ctx.fillText("HERO", 18, 24);
        bar(66, 18, Math.max(0, hero.life), ZYCIE_BOHATERA, 22, C.bloodBright);

        ctx.fillStyle = "rgba(7,8,12,.6)"; ctx.fillRect(LW - 130, 10, 120, 26);
        ctx.strokeRect(LW - 129.5, 10.5, 119, 25);
        drawHeart(LW - 120, 17, 2, C.bloodBright);
        ctx.fillStyle = C.text; ctx.fillText("x " + hearts, LW - 100, 24);
        ctx.fillStyle = C.dim; ctx.textAlign = "right";
        ctx.fillText(fmtTime(playTime), LW - 18, 24);

        if (boss.awake && boss.state !== "pokonany") {
          const w = 5 * 50 + 4 * 3, x = (LW - w) / 2, y = LH - 30;
          ctx.fillStyle = "rgba(7,8,12,.65)"; ctx.fillRect(x - 70, y - 8, w + 80, 26);
          ctx.strokeStyle = C.blood; ctx.strokeRect(x - 69.5, y - 7.5, w + 79, 25);
          ctx.textAlign = "left"; ctx.fillStyle = C.bloodBright; ctx.fillText("BOSS", x - 60, y + 5);
          bar(x, y, Math.max(0, boss.life), ZYCIE_BOSSA, 50, C.blood);
        }
        if (showBoxes) {
          ctx.textAlign = "left"; ctx.font = "11px " + F.mono;
          const dbg = "rzad " + hero.rzad + " (" + ["idle", "run", "attack", "jump"][hero.rzad] + ")  strona " + (hero.strona ? "right" : "left") +
            "  grounded " + hero.grounded + "  boss " + boss.state;
          ctx.fillStyle = "rgba(7,8,12,.7)"; ctx.fillRect(10, 41, ctx.measureText(dbg).width + 8, 18);
          ctx.fillStyle = C.gold; ctx.fillText(dbg, 14, 50);
        }
      }

      const fmtTime = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

      function screen(title, sub, lines, tint) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = tint; ctx.fillRect(0, 0, LW, LH);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "700 40px " + F.display;
        ctx.save(); ctx.shadowColor = "rgba(216,38,61,.7)"; ctx.shadowBlur = 18;
        ctx.fillStyle = C.goldBright; ctx.fillText(title, LW / 2, 104); ctx.restore();
        ctx.fillStyle = C.gold; ctx.fillRect(LW / 2 - 120, 134, 240, 1);
        ctx.fillRect(LW / 2 - 3, 131, 6, 6);
        ctx.font = "italic 18px " + F.body; ctx.fillStyle = C.text; ctx.fillText(sub, LW / 2, 160);
        ctx.font = "12px " + F.pixel; ctx.fillStyle = C.dim;
        lines.forEach((l, i) => ctx.fillText(l, LW / 2, 196 + i * 20));
      }

      function render() {
        if (!hero) return;
        const t = reduced && state !== "play" ? 0 : clock;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, LW, LH);
        drawWorld(t);
        if (state === "play") {
          drawHUD();
          if (paused) screen("PAUSED", "Press Play, a game key or tap the scene to resume", [], "rgba(7,8,12,.55)");
        } else if (state === "title") {
          screen("GOTHIC ESCAPE", "Flee the town, storm the castle, face its master", [
            "A D / ARROWS  MOVE     W / SPACE  JUMP",
            "J / K  ATTACK     L  OPEN DOORS",
            "HERO LIFE " + ZYCIE_BOHATERA + "  ·  BOSS LIFE " + ZYCIE_BOSSA
          ], "rgba(7,8,12,.62)");
        } else if (state === "over") {
          drawHUD();
          screen("GAME OVER", "The night claims another hunter", ["TIME " + fmtTime(playTime) + "   HEARTS " + hearts], "rgba(40,4,10,.6)");
        } else if (state === "win") {
          drawHUD();
          screen("VICTORY", "The castle's master has fallen", ["TIME " + fmtTime(playTime) + "   HEARTS " + hearts + "   LIFE " + hero.life + "/" + ZYCIE_BOHATERA], "rgba(7,8,12,.6)");
        }
      }

      /* ---------- Readout ---------- */
      let lastReadout = "";
      function updateReadout() {
        let s;
        const pf = "Push factor " + pushFactor.toFixed(2) + ": coffin takes " + Math.round(pushFactor * 100) + "% of the overlap, hero " + Math.round((1 - pushFactor) * 100) + "%.";
        if (state === "title") s = "Press Start to play. Hero life " + ZYCIE_BOHATERA + ", boss life " + ZYCIE_BOSSA + " (konfiguracja.txt).\n" + pf;
        else {
          const zone = hero.x < GATE_X ? "town" : hero.x < ARENA_X ? "castle hall" : "boss arena";
          const goal = gate.open === 0 ? "open the castle gate" : boss.state === "pokonany" ? "boss defeated" : "defeat the boss";
          const head = state === "over" ? "Game over" : state === "win" ? "Victory" : paused ? "Paused" : "Playing";
          s = head + " · zone: " + zone + " · goal: " + goal + "\nHero life " + Math.max(0, hero.life) + "/" + ZYCIE_BOHATERA +
            " · boss life " + Math.max(0, boss.life) + "/" + ZYCIE_BOSSA + " (" + boss.state + ") · wolves left " +
            wolves.filter(w => w.alive).length + "/" + wolves.length + " · hearts " + hearts + "/" + candles.length + "\n" + pf;
        }
        if (s !== lastReadout) { lastReadout = s; frame.readout.textContent = s; }
      }

      startBtn.addEventListener("click", startGame);
      const loop = kit.loop(frame.stage, step);
      const onFonts = () => { if (!loop.running) render(); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(onFonts);
      render();
      updateReadout();

      return () => {
        loop.destroy();
        canvas.removeEventListener("keydown", onKeyDown);
        canvas.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("blur", clearKeys);
        frame.root.remove();
        hero = null;
        if (!document.querySelector(".d-" + NAME)) style.remove();
      };
    }
  });
})();
