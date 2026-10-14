/*
 * Demo: Nightscout glucose on a 32x16 BLE LED panel (ESP32 + iPixel).
 * Port of renderFrame() / drawBigDigitToFb() / drawArrowToFb() / drawCrossToFb() from the sketch,
 * driven by a synthetic CGM series. Colour rules for the TFT variant are offered as an alternative.
 */
(function () {
  "use strict";

  /* ---- Bitmaps copied from the sketch (BIG 8x11 digits, ARROWS 5x5, CROSS 5x5) ---- */
  const W = 32, H = 16;
  const BIG = [
    ["11111111", "11111111", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11000011", "11111111", "11111111"],
    ["00011000", "00011000", "00111000", "00011000", "00011000", "00011000", "00011000", "00011000", "00011000", "00111100", "00111100"],
    ["11111111", "11111111", "00000011", "00000011", "00000011", "11111111", "11000000", "11000000", "11000000", "11111111", "11111111"],
    ["11111111", "11111111", "00000011", "00000011", "00000011", "00111111", "00000011", "00000011", "00000011", "11111111", "11111111"],
    ["11000011", "11000011", "11000011", "11000011", "11000011", "11111111", "00000011", "00000011", "00000011", "00000011", "00000011"],
    ["11111111", "11111111", "11000000", "11000000", "11000000", "11111111", "00000011", "00000011", "00000011", "11111111", "11111111"],
    ["11111111", "11111111", "11000000", "11000000", "11000000", "11111111", "11000011", "11000011", "11000011", "11111111", "11111111"],
    ["11111111", "11111111", "00000011", "00000100", "00000100", "00011000", "00100000", "00100000", "00100000", "00100000", "00100000"],
    ["11111111", "11111111", "11000011", "11000011", "11000011", "11111111", "11000011", "11000011", "11000011", "11111111", "11111111"],
    ["11111111", "11111111", "11000011", "11000011", "11000011", "11111111", "00000011", "00000011", "00000011", "11111111", "11111111"]
  ];
  const ARROWS = {
    up: ["00111", "00011", "00101", "01000", "10000"],
    down: ["10000", "01000", "00101", "00011", "00111"],
    neutral: ["00000", "00010", "11111", "00010", "00000"]
  };
  const CROSS = ["10001", "01010", "00100", "01010", "10001"];
  const STALE_AFTER_S = 5 * 60;   // fresh = (now - timestamp) < 5 min
  const FETCH_EVERY_S = 60;       // sketch polls Nightscout every 60 s
  const CGM_EVERY_S = 5 * 60;     // a CGM delivers a reading every 5 min

  /* ---- Colour rules ---- */
  const RGB = { red: [255, 40, 34], orange: [255, 132, 18], yellow: [255, 214, 24], green: [44, 255, 96], cross: [255, 0, 0] };
  const RULES = {
    panel: {
      label: "iPixel sketch (90 / 180)",
      colour: g => (g < 90 ? "red" : g > 180 ? "orange" : "green"),
      bands: [[0, 90, "red"], [90, 180, "green"], [180, 999, "orange"]],
      legend: [["red", "below 90"], ["green", "90 to 180"], ["orange", "above 180"]]
    },
    tft: {
      label: "TFT sketch (70 / 80 / 160 / 200)",
      colour: g => (g < 70 || g > 200 ? "red" : g < 80 || g > 160 ? "yellow" : "green"),
      bands: [[0, 70, "red"], [70, 80, "yellow"], [80, 160, "green"], [160, 200, "yellow"], [200, 999, "red"]],
      legend: [["red", "below 70 or above 200"], ["yellow", "70 to 80, 160 to 200"], ["green", "80 to 160"]]
    }
  };

  const DIR_LABEL = { up: "up", down: "down", neutral: "neutral" };
  function mapDirection(d) {
    if (d === "DoubleUp" || d === "SingleUp" || d === "FortyFiveUp") return "up";
    if (d === "DoubleDown" || d === "SingleDown" || d === "FortyFiveDown") return "down";
    return "neutral";
  }
  /* Nightscout/Dexcom style trend names from slope in mg/dL per minute. */
  function slopeDirection(delta5) {
    const s = delta5 / 5;
    return s > 3 ? "DoubleUp" : s > 2 ? "SingleUp" : s > 1 ? "FortyFiveUp" : s > -1 ? "Flat" :
      s > -2 ? "FortyFiveDown" : s > -3 ? "SingleDown" : "DoubleDown";
  }

  const STYLE = `
    .d-led-matrix .d-led-matrix__spark { border-top: 1px solid var(--stone-3); }
    .d-led-matrix .d-led-matrix__cap { font-size: .8rem; line-height: 1.45; color: var(--ash); padding: .55rem .75rem; border-top: 1px solid var(--stone-3); }
    .d-led-matrix .d-led-matrix__cap b { color: var(--parchment-dim); font-weight: 600; }
    .d-led-matrix .d-led-matrix__legend { margin-top: .8rem; }
  `;

  const pad = n => String(n).padStart(2, "0");
  const mmss = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + pad(s % 60); };

  window.PortfolioDemos.register("led-matrix", {
    title: "Nightscout LED panel",
    note: "Simulated data: a synthetic glucose series is drawn on a 32x16 LED panel with the sketch's own bitmaps and rules. Pick a scenario, then simulate WiFi loss and wait five simulated minutes for the red stale-data cross.",
    mount(host, kit) {
      const h = kit.h, C = kit.colors(), clamp = kit.clamp;
      const rand = kit.rng(7);
      const f = kit.frame(host);
      f.root.classList.add("d-led-matrix");
      const style = h("style", {}, STYLE);
      document.head.append(style);

      /* ---------------- Simulation state ---------------- */
      let simT = 0, G = 112, V = 0;
      let scenario = "auto", rules = RULES.panel;
      let wifi = true, playing = !kit.reducedMotion(), speed = 1.5; // sim minutes per second
      const readings = [];               // {t, g, dir, seen, brk}
      let cache = null;                   // {g, dir, ts}: cachedGlucose / cachedDirection / cachedTimestamp
      let nextSensor = CGM_EVERY_S, nextFetch = FETCH_EVERY_S;

      function sensorReading(t, forceBreak) {
        let brk = !!forceBreak;
        if (scenario === "rising" && G > 320) { G = 95; brk = true; }
        if (scenario === "falling" && G < 75) { G = 270; brk = true; }
        const prev = G;
        if (scenario === "low") V = (62 - G) * 0.6 + (rand() - 0.5) * 3;
        else if (scenario === "inrange") V = (122 - G) * 0.6 + (rand() - 0.5) * 4;
        else if (scenario === "high") V = (250 - G) * 0.6 + (rand() - 0.5) * 5;
        else if (scenario === "rising") V = 16 + rand() * 4;
        else if (scenario === "falling") V = -(16 + rand() * 4);
        else { // meals push up, insulin pulls down, glucose is pulled back towards ~115
          if (rand() < 0.07) V += 14 + rand() * 10;
          if (rand() < 0.05) V -= 8 + rand() * 7;
          V = V * 0.72 + (115 - G) * 0.035 + (rand() - 0.5) * 3;
        }
        G = clamp(Math.round(G + V), 40, 400);
        readings.push({ t, g: G, dir: slopeDirection(G - prev), seen: false, brk });
        if (readings.length > 90) readings.shift();
      }
      for (let i = -40; i <= 0; i++) sensorReading(i * CGM_EVERY_S);
      readings.forEach(r => { r.seen = true; });
      { const r = readings[readings.length - 1]; cache = { g: r.g, dir: r.dir, ts: r.t }; }

      /* fetchNightscout(): count=1, so only the newest reading is ever received. */
      function fetchNow() {
        if (!wifi) return;
        const r = readings[readings.length - 1];
        cache = { g: r.g, dir: r.dir, ts: r.t };
        r.seen = true;
      }
      function advance(dt) {
        const target = simT + dt;
        for (;;) {
          const t = Math.min(nextSensor, nextFetch);
          if (t > target) break;
          simT = t;
          if (nextSensor <= t) { sensorReading(t); nextSensor += CGM_EVERY_S; }
          if (nextFetch <= t) { fetchNow(); nextFetch += FETCH_EVERY_S; }
        }
        simT = target;
      }

      /* ---------------- Framebuffer, a port of the sketch's renderFrame ---------------- */
      let nextFb = [];
      const clearFrame = () => { nextFb = Array.from({ length: H }, () => new Array(W).fill(null)); };
      const setFbPixel = (x, y, c) => { if (x < 0 || x >= W || y < 0 || y >= H) return; nextFb[y][x] = c; };
      function drawBigDigitToFb(digit, ox, oy, c) {
        const p = BIG[digit];
        for (let y = 0; y < 11; y++) for (let x = 0; x < 8; x++) if (p[y][x] === "1") setFbPixel(ox + x, oy + y, c);
      }
      function drawCrossToFb(c) {
        for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (CROSS[y][x] === "1") setFbPixel(26 + x, 0 + y, c);
      }
      function drawArrowToFb(arrow, c) {
        const p = ARROWS[arrow] || ARROWS.neutral;
        for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (p[y][x] === "1") setFbPixel(26 + x, 11 + y, c);
      }
      function renderFrame(glucose, direction, fresh) {
        clearFrame();
        const colour = rules.colour(glucose), c = RGB[colour];
        const s = String(glucose);
        for (let i = 0; i < s.length; i++) drawBigDigitToFb(+s[i], i * 9, 0, c);
        if (!fresh) drawCrossToFb(RGB.cross);
        drawArrowToFb(mapDirection(direction), c);
        return colour;
      }

      /* ---------------- Panel canvas ---------------- */
      const PITCH = 16, M = 22, R = 6;
      const PW = W * PITCH + 2 * M, PH = H * PITCH + 2 * M;
      const panel = kit.canvas(f.stage, PW, PH, "32 by 16 LED panel showing the current glucose value");
      const pctx = panel.ctx, dpr = panel.dpr;

      const lighten = (c, k) => c.map(v => Math.round(v + (255 - v) * k));
      const sprites = {};
      function sprite(name) {
        if (sprites[name]) return sprites[name];
        const rgb = RGB[name], S = Math.round(PITCH * 2 * dpr), cv = document.createElement("canvas");
        cv.width = cv.height = S;
        const g = cv.getContext("2d"), c = S / 2, r = R * dpr;
        const col = (v, a) => "rgba(" + v[0] + "," + v[1] + "," + v[2] + "," + a + ")";
        let gr = g.createRadialGradient(c, c, 0, c, c, c);
        gr.addColorStop(0, col(rgb, 0.5)); gr.addColorStop(0.45, col(rgb, 0.18)); gr.addColorStop(1, col(rgb, 0));
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
        gr = g.createRadialGradient(c - r * 0.25, c - r * 0.3, 0, c, c, r);
        gr.addColorStop(0, col(lighten(rgb, 0.75), 1)); gr.addColorStop(0.55, col(rgb, 1)); gr.addColorStop(1, col(rgb.map(v => Math.round(v * 0.7)), 1));
        g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
        return (sprites[name] = cv);
      }

      /* static background: bezel, screws, unlit LEDs */
      const bg = document.createElement("canvas");
      bg.width = panel.canvas.width; bg.height = panel.canvas.height;
      (function paintBg() {
        const g = bg.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const lg = g.createLinearGradient(0, 0, 0, PH);
        lg.addColorStop(0, "#1b1417"); lg.addColorStop(1, "#0c0809");
        g.fillStyle = lg; g.fillRect(0, 0, PW, PH);
        g.strokeStyle = C.gold || "#b8913a"; g.globalAlpha = 0.45; g.lineWidth = 1;
        g.strokeRect(5.5, 5.5, PW - 11, PH - 11); g.globalAlpha = 1;
        g.fillStyle = "#040203"; g.fillRect(M - 8, M - 8, PW - 2 * M + 16, PH - 2 * M + 16);
        g.strokeStyle = "rgba(255,255,255,.07)"; g.strokeRect(M - 7.5, M - 7.5, PW - 2 * M + 15, PH - 2 * M + 15);
        [[11, 11], [PW - 11, 11], [11, PH - 11], [PW - 11, PH - 11]].forEach(([x, y]) => {
          g.fillStyle = "#2a2024"; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
          g.strokeStyle = "#0a0607"; g.beginPath(); g.moveTo(x - 2.2, y - 2.2); g.lineTo(x + 2.2, y + 2.2); g.stroke();
        });
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const cx = M + x * PITCH + PITCH / 2, cy = M + y * PITCH + PITCH / 2;
          g.fillStyle = "#130e11"; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
          g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R - 0.5, 0, Math.PI * 2); g.stroke();
        }
      })();

      const cur = Array.from({ length: H }, () => new Float32Array(W));   // LED brightness 0..1
      const tgt = Array.from({ length: H }, () => new Float32Array(W));
      const lit = Array.from({ length: H }, () => new Array(W).fill("green")); // sprite name per LED
      let panelColour = "green", panelFresh = true;

      function refresh() {
        const fresh = (simT - cache.ts) < STALE_AFTER_S;
        panelColour = renderFrame(cache.g, cache.dir, fresh);
        panelFresh = fresh;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const px = nextFb[y][x];
          if (px) {
            tgt[y][x] = 1;
            lit[y][x] = (px === RGB.cross) ? "cross" : panelColour;
          } else tgt[y][x] = 0;
        }
      }
      function snap() { for (let y = 0; y < H; y++) cur[y].set(tgt[y]); }
      function fade(dt) {
        const k = dt / 0.14;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const d = tgt[y][x] - cur[y][x];
          cur[y][x] = Math.abs(d) <= k ? tgt[y][x] : cur[y][x] + Math.sign(d) * k;
        }
      }
      function drawPanel() {
        pctx.globalCompositeOperation = "source-over";
        pctx.globalAlpha = 1;
        pctx.drawImage(bg, 0, 0, PW, PH);
        pctx.globalCompositeOperation = "lighter";
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const a = cur[y][x];
          if (a <= 0.01) continue;
          pctx.globalAlpha = a;
          pctx.drawImage(sprite(lit[y][x]), M + x * PITCH + PITCH / 2 - PITCH, M + y * PITCH + PITCH / 2 - PITCH, PITCH * 2, PITCH * 2);
        }
        pctx.globalAlpha = 1;
        pctx.globalCompositeOperation = "source-over";
      }

      /* ---------------- Sparkline canvas ---------------- */
      const SW = PW, SH = 210;
      const spark = kit.canvas(f.stage, SW, SH, "History of the glucose values the panel received over the last three hours, with range bands");
      spark.canvas.classList.add("d-led-matrix__spark");
      const sctx = spark.ctx;
      const PL = 48, PR = 14, PT = 42, PB = 28, PWd = SW - PL - PR, PHt = SH - PT - PB;
      const YMIN = 40, YMAX = 350, WIN = 3 * 3600;
      const yOf = g => PT + (1 - (clamp(g, YMIN, YMAX) - YMIN) / (YMAX - YMIN)) * PHt;
      const xOf = t => PL + ((t - (simT - WIN)) / WIN) * PWd;
      const rgba = (n, a) => { const v = RGB[n]; return "rgba(" + v[0] + "," + v[1] + "," + v[2] + "," + a + ")"; };

      function drawSpark() {
        const g = sctx, mono = kit.fonts.mono;
        g.clearRect(0, 0, SW, SH);
        g.fillStyle = C.bg || "#0a0809"; g.fillRect(0, 0, SW, SH);

        /* header: WiFi state and the stale-data timer */
        g.textBaseline = "middle"; g.textAlign = "left"; g.font = "600 21px " + mono;
        g.fillStyle = wifi ? RGB.green && rgba("green", 1) : C.bloodBright || "#ff4d5e";
        g.beginPath(); g.arc(PL + 6, 20, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = wifi ? C.dim : C.bloodBright;
        g.fillText(wifi ? "WiFi up" : "WiFi lost", PL + 18, 21);
        const age = simT - cache.ts, barW = 84, bx = SW - PR - barW;
        g.textAlign = "right"; g.fillStyle = panelFresh ? C.dim : C.bloodBright;
        g.fillText("age " + mmss(age) + " / " + mmss(STALE_AFTER_S), bx - 10, 21);
        g.fillStyle = C.grid || "#2a2226"; g.fillRect(bx, 15, barW, 10);
        g.fillStyle = panelFresh ? C.gold : C.bloodBright;
        g.fillRect(bx, 15, barW * clamp(age / STALE_AFTER_S, 0, 1), 10);

        /* range bands */
        g.save();
        g.beginPath(); g.rect(PL, PT, PWd, PHt); g.clip();
        rules.bands.forEach(([lo, hi, n]) => {
          const y1 = yOf(hi), y2 = yOf(lo);
          g.fillStyle = rgba(n, 0.13); g.fillRect(PL, y1, PWd, y2 - y1);
        });
        /* stale span: after cache.ts + 5 min the panel shows the cross */
        const sx = xOf(cache.ts + STALE_AFTER_S);
        if (sx < PL + PWd) {
          g.fillStyle = "rgba(216,38,61,.16)"; g.fillRect(Math.max(sx, PL), PT, PL + PWd - Math.max(sx, PL), PHt);
          g.strokeStyle = C.bloodBright; g.lineWidth = 1; g.beginPath(); g.moveTo(sx + 0.5, PT); g.lineTo(sx + 0.5, PT + PHt); g.stroke();
        }
        /* threshold lines */
        g.setLineDash([3, 4]); g.lineWidth = 1; g.strokeStyle = "rgba(240,230,210,.28)";
        const thresholds = [...new Set(rules.bands.flatMap(b => [b[0], b[1]]).filter(v => v > YMIN && v < YMAX))];
        thresholds.forEach(v => { const y = Math.round(yOf(v)) + 0.5; g.beginPath(); g.moveTo(PL, y); g.lineTo(PL + PWd, y); g.stroke(); });
        g.setLineDash([]);

        /* readings the panel received (solid) and ones it never saw (hollow, dim) */
        let prevSeen = null, prevIdx = -1;
        g.lineWidth = 2; g.lineJoin = "round";
        readings.forEach((r, i) => {
          if (!r.seen) return;
          const x = xOf(r.t), y = yOf(r.g);
          if (prevSeen && !r.brk) {
            g.beginPath(); g.moveTo(xOf(prevSeen.t), yOf(prevSeen.g)); g.lineTo(x, y);
            g.setLineDash(i - prevIdx > 1 ? [4, 5] : []);
            g.strokeStyle = i - prevIdx > 1 ? "rgba(240,230,210,.45)" : (C.goldBright || "#e8c15a");
            g.stroke();
          }
          prevSeen = r; prevIdx = i;
        });
        g.setLineDash([]);
        readings.forEach(r => {
          const x = xOf(r.t), y = yOf(r.g);
          if (x < PL - 4 || x > PL + PWd + 4) return;
          g.beginPath(); g.arc(x, y, r.seen ? 3.4 : 3, 0, Math.PI * 2);
          if (r.seen) { g.fillStyle = rgba(rules.colour(r.g), 1); g.fill(); }
          else { g.strokeStyle = "rgba(240,230,210,.4)"; g.lineWidth = 1.2; g.stroke(); }
        });
        g.restore();

        /* axes */
        g.font = "20px " + mono; g.textAlign = "right"; g.fillStyle = C.dim;
        let lastY = -99;
        thresholds.slice().sort((a, b) => b - a).forEach(v => { const y = yOf(v); if (Math.abs(y - lastY) < 20) return; lastY = y; g.fillText(String(v), PL - 6, y + 1); });
        g.textAlign = "center";
        [[-3, "-3h"], [-2, "-2h"], [-1, "-1h"], [0, "now"]].forEach(([hr, label]) => {
          const x = PL + ((hr + 3) / 3) * PWd;
          g.fillText(label, hr === 0 ? x - 10 : x, SH - 10);
        });
        g.strokeStyle = C.line || "#3a3034"; g.lineWidth = 1; g.strokeRect(PL + 0.5, PT + 0.5, PWd - 1, PHt - 1);
      }

      /* ---------------- Readout ---------------- */
      let lastText = "";
      function updateReadout() {
        const arrow = mapDirection(cache.dir);
        const state = panelFresh ? "Data fresh" : "Data STALE (older than 5 min), red cross drawn";
        const txt = "Panel shows " + cache.g + " mg/dL with a " + DIR_LABEL[arrow] + " arrow in " + panelColour +
          ' (Nightscout direction "' + cache.dir + '"). ' + state + ". " + (wifi ? "WiFi connected." : "WiFi lost, last value kept.");
        if (txt === lastText) return;
        lastText = txt;
        f.readout.textContent = txt;
        panel.canvas.setAttribute("aria-label", "32 by 16 LED panel: " + cache.g + ", " + DIR_LABEL[arrow] + " arrow, " + panelColour + (panelFresh ? "" : ", red cross for stale data"));
      }

      function redrawStatic() { refresh(); snap(); drawPanel(); drawSpark(); updateReadout(); }

      const loop = kit.loop(f.root, dt => {
        advance(dt * speed * 60);
        refresh(); fade(dt); drawPanel(); drawSpark(); updateReadout();
      });

      /* ---------------- Controls ---------------- */
      const playBtn = kit.button(f.controls, playing ? "Pause" : "Play", () => {
        playing = !playing;
        playBtn.textContent = playing ? "Pause" : "Play";
        if (playing) loop.start(); else { loop.stop(); redrawStatic(); }
      }, "blood");

      const buttons = h("div", { class: "demo__buttons" });
      f.controls.append(buttons);
      kit.button(buttons, "Step +5 min", () => { advance(CGM_EVERY_S); redrawStatic(); });
      kit.button(buttons, "Simulate WiFi loss", () => { wifi = false; redrawStatic(); });
      kit.button(buttons, "Reconnect", () => {
        wifi = true;
        nextFetch = simT;      // lastFetchMs is old, so the first loop pass fetches at once
        advance(0);
        redrawStatic();
      });

      kit.slider(f.controls, { label: "Speed (sim min per second)", min: 0.5, max: 10, step: 0.25, value: speed, format: v => v.toFixed(2).replace(/\.?0+$/, ""), onInput: v => { speed = v; } });
      kit.select(f.controls, {
        label: "Scenario", value: scenario,
        options: [
          { value: "auto", label: "Free run (meals and insulin)" },
          { value: "low", label: "Low" },
          { value: "inrange", label: "In range" },
          { value: "high", label: "High" },
          { value: "rising", label: "Rising fast" },
          { value: "falling", label: "Falling fast" }
        ],
        onChange: v => {
          scenario = v;
          sensorReading(simT, false);   // new reading right away so the change is visible
          fetchNow();
          redrawStatic();
        }
      });
      kit.select(f.controls, {
        label: "Colour rules", value: "panel",
        options: [{ value: "panel", label: RULES.panel.label }, { value: "tft", label: RULES.tft.label }],
        onChange: v => { rules = RULES[v]; buildLegend(); redrawStatic(); }
      });

      /* legend + caption */
      const legendHost = h("div", { class: "d-led-matrix__legend" });
      f.root.insertBefore(legendHost, f.readout);
      function buildLegend() {
        legendHost.textContent = "";
        kit.legend(legendHost, rules.legend.map(([n, label]) => ({ color: "rgb(" + RGB[n].join(",") + ")", label })).concat([{ color: "rgb(255,0,0)", label: "red cross: data older than 5 min" }]));
      }
      buildLegend();
      f.stage.append(h("div", { class: "d-led-matrix__cap" },
        h("b", {}, "Same bitmaps as the sketch: "), "8x11 digits every 9 px from the left, 5x5 arrow at (26, 11), 5x5 cross at (26, 0); the arrow collapses seven Nightscout directions to up, down or neutral. ",
        h("b", {}, "Simplified: "), "the sketch freezes the display while WiFi is down, here the redraw keeps running so the stale cross is visible; the history shows only values fetched with count=1 every 60 s, hollow dots were never received."));

      redrawStatic();
      if (playing) loop.start();

      return () => { loop.destroy(); style.remove(); host.textContent = ""; };
    }
  });
})();
