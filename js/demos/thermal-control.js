/*
 * Demo: thermal-control
 * Browser simulation of an STM32F7 temperature controller (university team project).
 *
 * Faithful to the firmware (main.c):
 *   - AdjustTemperature(sensor, given): given >= sensor -> TIM3 CH3 compare = 999 (full power, TEST pin 0),
 *     otherwise compare = 0 (heater off, TEST pin 1). Plain bang-bang, no hysteresis.
 *   - setpoint arrives over UART3 as 5 characters ("%f"); 0.0 means "no setpoint yet" (regulation skipped).
 *   - BMP280: filter off, temperature oversampling x1, output data rate 250 ms.
 *   - LCD1602: "Zadane: " / "Czujnik: " with gcvt(value, 5, ...) text at column 10; the display is never cleared.
 * Simulated (NOT from the firmware): the thermal plant, its delay and noise, the loop period (~50 ms).
 */
(function () {
  "use strict";

  /* ---- Firmware constants ---- */
  const PWM_FULL = 999;          // __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_3, 999)
  const SENSOR_ODR = 0.25;       // conf.odr = BMP280_ODR_250_MS
  const SENSOR_RES = 0.005;      // BMP280 temperature resolution at 1x oversampling (16 bit)

  /* ---- Simulation constants (assumptions) ---- */
  const LOOP_DT = 0.05;          // estimated main-loop period: 10 ms delay + SPI + blocking LCD writes
  const T_AMB = 22;              // ambient, deg C
  const TAU = 60;                // thermal time constant, s
  const RISE = 36;               // steady-state rise above ambient at full power, K
  const DELAY = 1.5;              // heater-to-sensor transport delay, s
  const NOISE = 0.01;            // sensor noise sigma, deg C
  const FAN_TIME = 20, FAN_LOSS = 2, FAN_KICK = 2;   // disturbance: window/fan
  const HYST = 0.5;              // hysteresis half-width of the comparison controller
  const SETTLE_BAND = 1.5, SETTLE_DWELL = 10;
  const SP_MIN = 25, SP_MAX = 50, SP_DEFAULT = 35;
  const WINDOW = 240;            // chart time window, s
  const SAMPLE = 0.1;            // history sample period, s

  /* 5x7 HD44780-style glyphs for the characters the firmware prints */
  const FONT = {};
  [
    [" ", "00000 00000 00000 00000 00000 00000 00000"],
    [".", "00000 00000 00000 00000 00000 01100 01100"],
    ["-", "00000 00000 00000 11111 00000 00000 00000"],
    [":", "00000 01100 01100 00000 01100 01100 00000"],
    ["0", "01110 10001 10011 10101 11001 10001 01110"],
    ["1", "00100 01100 00100 00100 00100 00100 01110"],
    ["2", "01110 10001 00001 00010 00100 01000 11111"],
    ["3", "11111 00010 00100 00010 00001 10001 01110"],
    ["4", "00010 00110 01010 10010 11111 00010 00010"],
    ["5", "11111 10000 11110 00001 00001 10001 01110"],
    ["6", "00110 01000 10000 11110 10001 10001 01110"],
    ["7", "11111 00001 00010 00100 01000 01000 01000"],
    ["8", "01110 10001 10001 01110 10001 10001 01110"],
    ["9", "01110 10001 10001 01111 00001 00010 01100"],
    ["Z", "11111 00001 00010 00100 01000 10000 11111"],
    ["C", "01110 10001 10000 10000 10000 10001 01110"],
    ["a", "00000 00000 01110 00001 01111 10001 01111"],
    ["d", "00001 00001 01101 10011 10001 10011 01101"],
    ["n", "00000 00000 10110 11001 10001 10001 10001"],
    ["e", "00000 00000 01110 10001 11111 10000 01110"],
    ["z", "00000 00000 11111 00010 00100 01000 11111"],
    ["u", "00000 00000 10001 10001 10001 10011 01101"],
    ["j", "00010 00000 00110 00010 00010 10010 01100"],
    ["i", "00100 00000 01100 00100 00100 00100 01110"],
    ["k", "10000 10000 10010 10100 11000 10100 10010"]
  ].forEach(([ch, rows]) => { FONT[ch] = rows.split(" "); });

  /* gcvt(value, 5, buf): 5 significant digits, trailing zeros dropped */
  function gcvt5(v) {
    let s = Number(v).toPrecision(5);
    if (s.indexOf("e") >= 0) return s;
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  const mmss = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };

  PortfolioDemos.register("thermal-control", {
    title: "Thermostat Control Loop",
    note: "Browser simulation of my STM32 thermostat: the firmware's own bang-bang law (full PWM while setpoint >= sensor) driving a simulated first-order heater with delay and BMP280-like noise. Drag the setpoint, hit Disturbance, then switch to hysteresis control and compare.",

    mount(host, kit) {
      const h = kit.h, C = kit.colors(), F = kit.fonts;
      const rand = kit.rng(7);
      const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

      /* ---- scoped CSS ---- */
      if (!document.getElementById("d-thermal-control-style")) {
        const st = document.createElement("style");
        st.id = "d-thermal-control-style";
        st.textContent = `
.d-thermal-control .d-thermal-control__hw { display: flex; flex-wrap: wrap; gap: 1rem 1.6rem; align-items: center; margin-top: 1rem; }
.d-thermal-control .d-thermal-control__lcd { flex: 1 1 260px; max-width: 440px; min-width: 0; border: 2px solid var(--stone-3); background: #0b0d06; padding: 6px; box-shadow: inset 0 0 0 1px #000; }
.d-thermal-control .d-thermal-control__lcd canvas { display: block; width: 100%; height: auto; }
.d-thermal-control .d-thermal-control__status { display: flex; flex-direction: column; gap: .5rem; font-family: var(--font-mono); font-size: .8rem; color: var(--parchment-dim); min-width: 0; }
.d-thermal-control .d-thermal-control__status span { display: flex; align-items: center; gap: .55em; }
.d-thermal-control .d-thermal-control__status b { color: var(--parchment); font-weight: 600; }
.d-thermal-control .d-thermal-control__led { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--stone-2); border: 1px solid var(--stone-3); transition: background .12s, box-shadow .12s; }
.d-thermal-control .d-thermal-control__led.is-heat { background: var(--blood-bright); border-color: var(--blood-bright); box-shadow: 0 0 8px var(--blood-bright); }
.d-thermal-control .d-thermal-control__led.is-pin { background: var(--gold-bright); border-color: var(--gold-bright); box-shadow: 0 0 6px var(--gold); }
`;
        document.head.append(st);
      }

      /* ---- simulation state ---- */
      const DELAY_N = Math.round(DELAY / LOOP_DT);
      let S;
      function freshState() {
        const s = {
          t: 0, T: T_AMB, sp: SP_DEFAULT, spCommitted: SP_DEFAULT,
          ccr: 0, testPin: 0, hystOn: false, fanLeft: 0,
          delayBuf: new Array(DELAY_N).fill(0), delayIdx: 0,
          sensor: 0, nextSensor: 0, nextSample: 0, hist: [],
          lcd: [new Array(16).fill(" "), new Array(16).fill(" ")], lcdDirty: true, ev: null
        };
        s.sensor = Math.round(s.T / SENSOR_RES) * SENSOR_RES;
        s.nextSensor = SENSOR_ODR;
        return s;
      }
      S = freshState();

      let ctrl = "firmware", speed = 10, playing = false;
      const startEvent = (kind, label, from, target) => {
        S.ev = { kind, label, from, target, t0: S.t, dir: Math.sign(target - from) || 1, over: 0, dev: 0, inSince: null, settled: null };
      };
      startEvent("step", "Warm-up", T_AMB, SP_DEFAULT);

      function trackEvent() {
        const ev = S.ev; if (!ev) return;
        const dev = S.T - ev.target;
        if (ev.kind === "step") ev.over = Math.max(ev.over, ev.dir * dev); else ev.dev = Math.max(ev.dev, Math.abs(dev));
        if (Math.abs(dev) <= SETTLE_BAND) {
          if (ev.inSince === null) ev.inSince = S.t;
          if (S.t - ev.inSince >= SETTLE_DWELL) ev.settled = ev.inSince - ev.t0;
        } else { ev.inSince = null; ev.settled = null; }
      }

      /* ---- the controllers ---- */
      function control(sensorTemp, givenTemp) {
        if (ctrl === "firmware") {
          // AdjustTemperature() from main.c (its unreachable third branch omitted)
          if (givenTemp >= sensorTemp) { S.ccr = PWM_FULL; S.testPin = 0; }
          else { S.ccr = 0; S.testPin = 1; }
        } else {
          if (sensorTemp < givenTemp - HYST) S.hystOn = true;
          else if (sensorTemp > givenTemp + HYST) S.hystOn = false;
          S.ccr = S.hystOn ? PWM_FULL : 0;
          S.testPin = S.hystOn ? 0 : 1;
        }
      }

      /* ---- LCD: replicate lcd_put_cur + lcd_send_string, no clearing ---- */
      function lcdWrite(row, col, str) {
        for (let i = 0; i < str.length && col + i < 16; i++) {
          const ch = FONT[str[i]] ? str[i] : " ";
          if (S.lcd[row][col + i] !== ch) { S.lcd[row][col + i] = ch; S.lcdDirty = true; }
        }
      }
      function lcdLoop() {
        lcdWrite(0, 0, "Zadane: ");
        lcdWrite(0, 10, gcvt5(S.sp));
        lcdWrite(1, 0, "Czujnik: ");
        lcdWrite(1, 10, gcvt5(Math.fround(S.sensor)));
      }

      /* ---- one firmware loop iteration + plant ---- */
      function step() {
        if (S.t >= S.nextSensor) {
          S.sensor = Math.round((S.T + NOISE * gauss()) / SENSOR_RES) * SENSOR_RES;
          S.nextSensor += SENSOR_ODR;
        }
        if (S.sp !== 0) control(S.sensor, S.sp);           // if(floatingtemp != 0.0)
        lcdLoop();

        const ud = S.delayBuf[S.delayIdx];
        S.delayBuf[S.delayIdx] = S.ccr / PWM_FULL;
        S.delayIdx = (S.delayIdx + 1) % DELAY_N;
        const loss = S.fanLeft > 0 ? FAN_LOSS : 1;
        S.T += LOOP_DT * (loss * (T_AMB - S.T) / TAU + (RISE / TAU) * ud);
        if (S.fanLeft > 0) S.fanLeft = Math.max(0, S.fanLeft - LOOP_DT);
        S.t += LOOP_DT;
        trackEvent();

        if (S.t >= S.nextSample) {
          S.hist.push({ t: S.t, T: S.sensor, sp: S.sp, u: S.ccr / PWM_FULL, fan: S.fanLeft > 0 });
          S.nextSample += SAMPLE;
          if (S.hist.length > 3200) S.hist.splice(0, S.hist.length - 2700);
        }
      }
      function advance(simSeconds) {
        let n = Math.min(400, Math.floor(simSeconds / LOOP_DT));
        for (let i = 0; i < n; i++) step();
      }

      /* ---- DOM ---- */
      const frame = kit.frame(host);
      frame.root.classList.add("d-thermal-control");
      const chartLabel = "Chart of measured temperature and setpoint in degrees Celsius over the last four minutes, with the heater output below";
      let ch = null, stageW = 0;
      function buildChart() {
        const avail = frame.stage.clientWidth || host.clientWidth || 720;
        const w = Math.round(kit.clamp(avail, 300, 760));
        if (ch) ch.canvas.remove();
        ch = kit.canvas(frame.stage, w, w < 500 ? 340 : 380, chartLabel);
        stageW = w;
      }
      buildChart();

      const lcdC = kit.canvas(h("div"), 404, 100, "16 by 2 character LCD showing the setpoint and the sensor temperature");
      const lcdBox = h("div", { class: "d-thermal-control__lcd" });
      lcdBox.append(lcdC.canvas);
      const ledHeat = h("i", { class: "d-thermal-control__led" });
      const ledPin = h("i", { class: "d-thermal-control__led" });
      const valHeat = h("b", {}, "0");
      const valPin = h("b", {}, "0");
      const valUart = h("b", {}, "");
      const status = h("div", { class: "d-thermal-control__status" },
        h("span", {}, ledHeat, "TIM3 CH3 compare ", valHeat),
        h("span", {}, ledPin, "TEST pin ", valPin),
        h("span", {}, "UART3 RX ", valUart));
      frame.root.insertBefore(h("div", { class: "d-thermal-control__hw" }, lcdBox, status), frame.controls);

      const spSlider = kit.slider(frame.controls, {
        label: "Setpoint (UART, 5 chars)", min: SP_MIN, max: SP_MAX, step: 0.5, value: SP_DEFAULT,
        format: v => v.toFixed(2) + " °C",
        onInput: v => { S.sp = v; refresh(true); }
      });
      spSlider.addEventListener("change", () => {
        const v = +spSlider.value;
        if (v !== S.spCommitted) { startEvent("step", "Setpoint", S.spCommitted, v); S.spCommitted = v; }
        refresh(true);
      });
      kit.select(frame.controls, {
        label: "Controller",
        options: [{ value: "firmware", label: "Firmware (bang-bang)" }, { value: "hyst", label: "On/off, hysteresis ±0.5 °C" }],
        value: ctrl,
        onChange: v => { ctrl = v; S.hystOn = S.ccr > 0; refresh(true); }
      });
      kit.slider(frame.controls, {
        label: "Speed", min: 1, max: 60, step: 1, value: speed,
        format: v => "×" + v, onInput: v => { speed = v; }
      });
      const btns = h("div", { class: "demo__buttons" });
      frame.controls.append(btns);
      kit.button(btns, "Disturbance (open window)", () => {
        S.T -= FAN_KICK; S.fanLeft = FAN_TIME;
        startEvent("dist", "Disturbance", S.spCommitted, S.spCommitted);
        refresh(true);
      }, "blood");
      const playBtn = kit.button(btns, "Pause", () => setPlaying(!playing));
      kit.button(btns, "Reset", () => {
        S = freshState();
        spSlider.value = SP_DEFAULT; spSlider.dispatchEvent(new Event("input"));
        startEvent("step", "Warm-up", T_AMB, SP_DEFAULT);
        if (kit.reducedMotion()) advance(150);
        yLo = yHi = null;
        refresh(true);
      });
      kit.legend(frame.root, [
        { color: C.goldBright, label: "Sensor temperature" },
        { color: C.bloodBright, label: "Setpoint (dashed)" },
        { color: C.blood, label: "Heater output" },
        { color: C.teal, label: "Disturbance active" }
      ]);

      /* ---- chart drawing ---- */
      let yLo = null, yHi = null;
      function niceStep(span) {
        const raw = span / 5, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
      }
      function drawChart(snap) {
        const { ctx, w: W, h: H } = ch;
        const small = W < 500;
        const fs = small ? 10 : 11;
        const pl = small ? 34 : 42, pr = 10, pt = 12;
        const sh = small ? 40 : 46, gapS = 22, axisH = 20;
        const plotH = H - pt - axisH - sh - gapS, pw = W - pl - pr;
        const sy0 = pt + plotH + gapS;
        const v0 = Math.max(0, S.t - WINDOW), v1 = v0 + WINDOW;
        const X = t => pl + (t - v0) / WINDOW * pw;

        const vis = S.hist.filter(p => p.t >= v0 - SAMPLE);
        let lo = Infinity, hi = -Infinity;
        vis.forEach(p => { lo = Math.min(lo, p.T, p.sp); hi = Math.max(hi, p.T, p.sp); });
        if (!isFinite(lo)) { lo = T_AMB; hi = SP_DEFAULT; }
        lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
        if (hi - lo < 8) { const m = (hi + lo) / 2; lo = m - 4; hi = m + 4; }
        if (yLo === null || snap) { yLo = lo; yHi = hi; } else { yLo += (lo - yLo) * 0.12; yHi += (hi - yHi) * 0.12; }
        const Y = v => pt + (1 - (v - yLo) / (yHi - yLo)) * plotH;

        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
        ctx.font = fs + "px " + F.mono;
        ctx.lineJoin = "round";

        /* grid + y labels */
        const ys = niceStep(yHi - yLo);
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (let v = Math.ceil(yLo / ys) * ys; v <= yHi; v += ys) {
          const y = Math.round(Y(v)) + 0.5;
          ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + pw, y); ctx.stroke();
          ctx.fillStyle = C.dim; ctx.fillText(String(Math.round(v * 10) / 10), pl - 6, y);
        }
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillStyle = C.ash; ctx.fillText("°C", 2, 0);

        /* time grid + labels */
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        for (let t = Math.ceil(v0 / 30) * 30; t <= v1; t += 30) {
          const x = Math.round(X(t)) + 0.5, major = t % 60 === 0;
          ctx.strokeStyle = major ? C.line : C.grid; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, pt); ctx.lineTo(x, sy0 + sh); ctx.stroke();
          if (major && x > pl + 10 && x < pl + pw - 10) { ctx.fillStyle = C.dim; ctx.fillText(mmss(t), x, sy0 + sh + 5); }
        }

        ctx.save();
        ctx.beginPath(); ctx.rect(pl, pt, pw, plotH); ctx.clip();

        /* fan / window shading */
        ctx.fillStyle = C.teal; ctx.globalAlpha = 0.14;
        let runStart = null;
        vis.forEach((p, i) => {
          if (p.fan && runStart === null) runStart = p.t;
          if ((!p.fan || i === vis.length - 1) && runStart !== null) { ctx.fillRect(X(runStart), pt, Math.max(1, X(p.t) - X(runStart)), plotH); runStart = null; }
        });
        ctx.globalAlpha = 1;

        /* settling band around the (stepped) setpoint */
        if (vis.length > 1) {
          ctx.fillStyle = C.gold; ctx.globalAlpha = 0.09;
          ctx.beginPath();
          let py = 0;
          vis.forEach((p, i) => { const x = X(p.t), y = Y(p.sp + SETTLE_BAND); if (i === 0) ctx.moveTo(x, y); else { ctx.lineTo(x, py); ctx.lineTo(x, y); } py = y; });
          for (let i = vis.length - 1; i >= 0; i--) { const x = X(vis[i].t), y = Y(vis[i].sp - SETTLE_BAND); ctx.lineTo(x, y); }
          ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        }

        /* setpoint */
        ctx.strokeStyle = C.bloodBright; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.beginPath();
        let sy = 0;
        vis.forEach((p, i) => { const x = X(p.t), y = Y(p.sp); if (i === 0) ctx.moveTo(x, y); else { ctx.lineTo(x, sy); ctx.lineTo(x, y); } sy = y; });
        ctx.stroke(); ctx.setLineDash([]);

        /* temperature */
        ctx.strokeStyle = C.goldBright; ctx.lineWidth = 2;
        ctx.shadowColor = C.gold; ctx.shadowBlur = 5;
        ctx.beginPath();
        vis.forEach((p, i) => { const x = X(p.t), y = Y(p.T); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke(); ctx.shadowBlur = 0;
        if (vis.length) {
          const p = vis[vis.length - 1];
          ctx.fillStyle = C.candle; ctx.beginPath(); ctx.arc(X(p.t), Y(p.T), 3.2, 0, 6.2832); ctx.fill();
        }
        ctx.restore();

        ctx.strokeStyle = C.line; ctx.lineWidth = 1;
        ctx.strokeRect(pl + 0.5, pt + 0.5, pw - 1, plotH - 1);

        /* tag when the disturbance is active */
        if (S.fanLeft > 0) {
          ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillStyle = C.teal;
          ctx.fillText("WINDOW OPEN " + Math.ceil(S.fanLeft) + " s", pl + pw - 6, pt + 6);
        }

        /* output strip */
        ctx.fillStyle = C.panel; ctx.fillRect(pl, sy0, pw, sh);
        ctx.save();
        ctx.beginPath(); ctx.rect(pl, sy0, pw, sh); ctx.clip();
        ctx.fillStyle = C.teal; ctx.globalAlpha = 0.14;
        runStart = null;
        vis.forEach((p, i) => {
          if (p.fan && runStart === null) runStart = p.t;
          if ((!p.fan || i === vis.length - 1) && runStart !== null) { ctx.fillRect(X(runStart), sy0, Math.max(1, X(p.t) - X(runStart)), sh); runStart = null; }
        });
        ctx.globalAlpha = 1;
        if (vis.length) {
          ctx.fillStyle = C.blood;
          ctx.beginPath(); ctx.moveTo(X(vis[0].t), sy0 + sh - 2);
          vis.forEach(p => ctx.lineTo(X(p.t), sy0 + sh - 2 - p.u * (sh - 6)));
          ctx.lineTo(X(vis[vis.length - 1].t), sy0 + sh - 2); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = C.bloodBright; ctx.lineWidth = 1; ctx.beginPath();
          vis.forEach((p, i) => { const x = X(p.t), y = sy0 + sh - 2 - p.u * (sh - 6); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = C.line; ctx.strokeRect(pl + 0.5, sy0 + 0.5, pw - 1, sh - 1);
        ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = C.dim;
        ctx.fillText("100%", pl - 6, sy0 + 6); ctx.fillText("0%", pl - 6, sy0 + sh - 6);
        ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillStyle = C.ash;
        ctx.fillText("HEATER OUTPUT (PWM duty)", pl, sy0 - 6);
      }

      /* ---- LCD drawing ---- */
      function drawLcd() {
        const { ctx, w: W, h: H } = lcdC;
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, "#b4cc2e"); g.addColorStop(1, "#8fae1c");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const mx = 12, my = 14, pitch = 4, cw = 24, rowH = 44;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
          const glyph = FONT[S.lcd[r][c]] || FONT[" "];
          const ox = mx + c * cw, oy = my + r * rowH;
          for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
            const on = glyph[gy][gx] === "1";
            ctx.fillStyle = on ? "#1a2606" : "rgba(40,60,0,0.09)";
            ctx.fillRect(ox + gx * pitch, oy + gy * pitch, 3.3, 3.3);
          }
        }
        const gl = ctx.createRadialGradient(W * 0.4, H * 0.3, 10, W * 0.5, H * 0.5, W * 0.7);
        gl.addColorStop(0, "rgba(255,255,200,0.18)"); gl.addColorStop(1, "rgba(0,0,0,0.22)");
        ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
        S.lcdDirty = false;
      }

      /* ---- readout ---- */
      function readoutText() {
        const err = S.sp - S.sensor;
        let duty = 0, n = 0;
        for (let i = S.hist.length - 1; i >= 0 && S.hist[i].t >= S.t - 60; i--) { duty += S.hist[i].u; n++; }
        const lines = [
          (ctrl === "firmware" ? "Firmware bang-bang" : "On/off with hysteresis ±" + HYST) + "  |  t = " + mmss(S.t) +
            "  |  setpoint " + S.sp.toFixed(2) + " °C  |  sensor " + S.sensor.toFixed(3) + " °C",
          "Error " + (err >= 0 ? "+" : "") + err.toFixed(2) + " °C  |  output " + Math.round(S.ccr / PWM_FULL * 100) + " % (compare " + S.ccr + ")  |  duty, last 60 s: " + (n ? Math.round(duty / n * 100) : 0) + " %"
        ];
        const ev = S.ev;
        if (ev) {
          const el = Math.round(S.t - ev.t0);
          const settle = "settling ±" + SETTLE_BAND + " °C: " + (ev.settled !== null ? ev.settled.toFixed(0) + " s" : "not settled (" + el + " s)");
          if (ev.kind === "step") {
            const size = Math.abs(ev.target - ev.from);
            lines.push(ev.label + " " + ev.from.toFixed(1) + " → " + ev.target.toFixed(1) + " °C: " + (ev.dir > 0 ? "overshoot " : "undershoot ") + ev.over.toFixed(2) + " °C" +
              (size >= 0.5 ? " (" + Math.round(ev.over / size * 100) + " % of step)" : "") + ", " + settle);
          } else {
            lines.push("Disturbance: max deviation " + Math.max(ev.dev, 0).toFixed(2) + " °C, recovery " + settle);
          }
        }
        return lines.join("\n");
      }
      let lastText = "";
      function updateReadout(force) {
        const txt = readoutText();
        if (force || txt !== lastText) { frame.readout.textContent = txt; lastText = txt; }
        const heat = S.ccr > 0;
        ledHeat.classList.toggle("is-heat", heat);
        ledPin.classList.toggle("is-pin", S.testPin === 1);
        valHeat.textContent = String(S.ccr);
        valPin.textContent = String(S.testPin);
        valUart.textContent = '"' + S.sp.toFixed(2) + '"';
      }

      let lastRead = -1;
      function refresh(force) {
        drawChart(force);
        if (force) lcdLoop();
        if (S.lcdDirty) drawLcd();
        updateReadout(force);
      }

      /* ---- loop ---- */
      let acc = 0;
      const loop = kit.loop(frame.root, (dt, time) => {
        acc += dt * speed;
        const n = Math.min(400, Math.floor(acc / LOOP_DT));
        for (let i = 0; i < n; i++) step();
        acc -= n * LOOP_DT; if (acc > LOOP_DT * 400) acc = 0;
        drawChart(false);
        if (S.lcdDirty) drawLcd();
        if (time - lastRead > 0.4) { lastRead = time; updateReadout(false); }
      });

      function setPlaying(on) {
        playing = on;
        playBtn.textContent = on ? "Pause" : "Play";
        if (on) loop.start(); else loop.stop();
      }

      /* ---- resize: rebuild the chart canvas when the width changes a lot (keeps text legible) ---- */
      let rzTimer = 0;
      const onResize = () => {
        clearTimeout(rzTimer);
        rzTimer = setTimeout(() => {
          const avail = frame.stage.clientWidth || stageW;
          if (Math.abs(Math.round(kit.clamp(avail, 300, 760)) - stageW) > 24) { buildChart(); refresh(true); }
        }, 150);
      };
      window.addEventListener("resize", onResize);

      /* ---- start ---- */
      lcdLoop();
      if (kit.reducedMotion()) { advance(150); setPlaying(false); } else setPlaying(true);
      refresh(true);

      return () => {
        clearTimeout(rzTimer);
        window.removeEventListener("resize", onResize);
        loop.destroy();
      };
    }
  });
})();
