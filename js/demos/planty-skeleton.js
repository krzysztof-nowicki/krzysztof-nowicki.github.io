/*
 * Planty skeleton demo: a JavaScript port of f = skeleton/extract.py (extract_skeleton).
 * Synthetic signal -> windows -> trend / rms / centroid -> blend weight w -> contour + energy.
 * The heatmap and the audio are illustrations driven by the skeleton, not the trained network g.
 */
(function () {
  "use strict";

  /* ---- constants copied from extract.py ---- */
  const FRAME_RATE = 10;          // skeleton frames per second of output music
  const MIN_LOG_CHANGE = 0.7;     // ~one octave / ~6 dB, natural-log units
  const SMOOTH_FRAMES = 3;        // extract_skeleton default
  /* ---- demo-only ---- */
  const SPF = 64;                 // synthetic samples per window (>= MIN_SAMPLES_PER_FRAME = 32, so no stretching)
  const HEAT_COLS = 240, HEAT_ROWS = 48;
  const W = 600, PAD = 10;

  /* ---------------- numpy-like helpers ---------------- */
  const sorted = a => Float64Array.from(a).sort();
  function median(a) {
    const s = sorted(a), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function percentile(a, p) {
    const s = sorted(a), idx = (s.length - 1) * p / 100, lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  }

  /* hann window and DFT tables for SPF-sample windows (np.hanning, np.fft.rfft) */
  const BINS = SPF / 2 + 1;
  const HANN = new Float64Array(SPF), COS = new Float64Array(BINS * SPF), SIN = new Float64Array(BINS * SPF);
  for (let j = 0; j < SPF; j++) HANN[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (SPF - 1));
  for (let k = 0; k < BINS; k++) for (let j = 0; j < SPF; j++) {
    COS[k * SPF + j] = Math.cos(2 * Math.PI * k * j / SPF);
    SIN[k * SPF + j] = Math.sin(2 * Math.PI * k * j / SPF);
  }

  /** frame_features: per-window trend (mean), rms (std) and spectral centroid (cycles per window). */
  function frameFeatures(x, n) {
    const trend = new Float64Array(n), rms = new Float64Array(n), centroid = new Float64Array(n).fill(NaN);
    const d = new Float64Array(SPF);
    for (let k = 0; k < n; k++) {
      const o = k * SPF;                       // equal-size windows: linspace edges are exactly k*SPF
      let m = 0;
      for (let j = 0; j < SPF; j++) m += x[o + j];
      m /= SPF; trend[k] = m;
      let ss = 0;
      for (let j = 0; j < SPF; j++) { d[j] = x[o + j] - m; ss += d[j] * d[j]; }
      rms[k] = Math.sqrt(ss / SPF);
      let total = 0, weighted = 0;
      for (let b = 0; b < BINS; b++) {
        let re = 0, im = 0;
        const base = b * SPF;
        for (let j = 0; j < SPF; j++) { const v = d[j] * HANN[j]; re += v * COS[base + j]; im -= v * SIN[base + j]; }
        const p = re * re + im * im;
        total += p; weighted += b * p;
      }
      if (total > 0) centroid[k] = weighted / total;
    }
    return { trend, rms, centroid };
  }

  /** robust_squash: 0.5 at the median, tanh by a robust scale; NaN -> 0.5. */
  function robustSquash(v, relFloor = 0.05, absFloor = 0) {
    const out = new Float64Array(v.length).fill(0.5);
    const vf = Array.from(v).filter(Number.isFinite);
    if (!vf.length) return out;
    const med = median(vf);
    const mad = 1.4826 * median(vf.map(a => Math.abs(a - med)));
    const range = percentile(vf, 98) - percentile(vf, 2);
    const scale = Math.max(mad, relFloor * range, absFloor, 1e-12);
    for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) out[i] = 0.5 + 0.5 * Math.tanh((v[i] - med) / scale / 2);
    return out;
  }

  /** moving_average: centred, edge padded. */
  function movingAverage(v, k) {
    if (k <= 1 || v.length < 2) return v;
    const n = v.length, left = Math.floor(k / 2), out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += v[Math.min(n - 1, Math.max(0, i - left + j))];
      out[i] = s / k;
    }
    return out;
  }

  /** extract_skeleton(x, n_frames, contour_mode, return_info=True) */
  function extractSkeleton(x, n, mode) {
    const f = frameFeatures(x, n);
    const trend = f.trend;
    const tMed = median(trend);
    const slowVar = Math.pow(1.4826 * median(Array.from(trend, t => Math.abs(t - tMed))), 2);
    const fastVar = median(Array.from(f.rms, r => r * r));
    const wAuto = slowVar + fastVar > 0 ? slowVar / (slowVar + fastVar) : 1;
    const w = mode === "trend" ? 1 : mode === "frequency" ? 0 : wAuto;

    let rmsMax = 0;
    for (const r of f.rms) rmsMax = Math.max(rmsMax, r);
    rmsMax = Math.max(rmsMax, 1e-30);
    const centroid = Float64Array.from(f.centroid, (c, i) => (f.rms[i] > 1e-6 * rmsMax ? c : NaN));
    const pitchCurve = robustSquash(Float64Array.from(centroid, c => Math.log1p(c)), 0.05, MIN_LOG_CHANGE);
    const trendCurve = robustSquash(trend);
    const contour = Float64Array.from(trendCurve, (t, i) => w * t + (1 - w) * pitchCurve[i]);
    const energy = robustSquash(Float64Array.from(f.rms, r => Math.log(r + 1e-6 * rmsMax)), 0.05, MIN_LOG_CHANGE);
    const clip = v => Float64Array.from(v, a => Math.min(1, Math.max(0, a)));
    return {
      contour: clip(movingAverage(contour, SMOOTH_FRAMES)), energy: clip(movingAverage(energy, SMOOTH_FRAMES)),
      trendCurve, pitchCurve, trend, rms: f.rms, centroid: f.centroid, w, wAuto, slowVar, fastVar
    };
  }

  /* ---------------- synthetic signals ---------------- */
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

  function makeComponents(kit, n, seed) {
    const N = n * SPF, rand = kit.rng(seed * 7919 + n);
    const drift = new Float64Array(N), spikes = new Float64Array(N), music = new Float64Array(N), noise = new Float64Array(N);
    const ph = [rand() * 6.283, rand() * 6.283, rand() * 6.283];
    for (let i = 0; i < N; i++) {
      const u = i / N;
      drift[i] = 0.6 * Math.sin(6.283 * 1.1 * u + ph[0]) + 0.3 * Math.sin(6.283 * 2.6 * u + ph[1]) + 0.12 * Math.sin(6.283 * 6 * u + ph[2]);
    }
    for (let k = 0; k < n; k++) {      // action-potential-like spikes: fast rise, exponential decay
      if (rand() > 0.08) continue;
      const start = k * SPF + Math.floor(rand() * 40), amp = 0.6 + 0.4 * rand();
      for (let j = 0; j < 60 && start + j < N; j++) spikes[start + j] += amp * (j < 3 ? (j + 1) / 3 : Math.exp(-(j - 3) / 9));
    }
    // melody: random walk on a pentatonic scale, glide between notes, percussive envelope
    const semi = new Float64Array(n), onset = new Float64Array(n), vel = new Float64Array(n);
    let idx = 6, next = 0, on = 0, v = 1;
    for (let k = 0; k < n; k++) {
      if (k >= next) {
        idx = Math.min(PENT.length - 1, Math.max(0, idx + [-2, -1, -1, 1, 1, 2][Math.floor(rand() * 6)]));
        on = k; v = 0.7 + 0.3 * rand(); next = k + 4 + Math.floor(rand() * 5);
      }
      semi[k] = PENT[idx]; onset[k] = on; vel[k] = v;
    }
    let s = semi[0], phase = 0;
    for (let i = 0; i < N; i++) {
      const k = Math.floor(i / SPF);
      s += (semi[k] - s) / 20;
      phase += 2 * Math.pow(2, s / 12) / SPF;           // 2..16 cycles per window
      const age = i / SPF - onset[k];
      music[i] = (0.25 + 0.55 * vel[k] * Math.exp(-age / 2.5)) * Math.sin(2 * Math.PI * phase);
    }
    for (let i = 0; i < N; i++) noise[i] = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(6.283 * rand());
    return { drift, spikes, music, noise };
  }

  function mixSignal(c, source, noise, spike) {
    const N = c.drift.length, x = new Float64Array(N);
    const plant = source !== "music", mus = plant && source === "plant" ? 0 : 1;
    for (let i = 0; i < N; i++) {
      x[i] = (plant ? c.drift[i] + spike * c.spikes[i] : 0) + mus * c.music[i] + noise * c.noise[i];
    }
    return x;
  }

  /* ---------------- toy spectrogram ---------------- */
  const MAGMA = [[0, 0, 4], [20, 14, 54], [59, 15, 112], [114, 31, 129], [183, 55, 121], [241, 96, 93], [254, 175, 119], [252, 253, 191]];
  function magma(t) {
    const p = Math.min(1, Math.max(0, t)) * (MAGMA.length - 1), i = Math.min(MAGMA.length - 2, Math.floor(p)), f = p - i;
    const a = MAGMA[i], b = MAGMA[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

  function paintHeat(off, contour, energy) {
    const g = off.getContext("2d"), img = g.createImageData(HEAT_COLS, HEAT_ROWS), n = contour.length;
    for (let c = 0; c < HEAT_COLS; c++) {
      const pos = (c + 0.5) / HEAT_COLS * n - 0.5, i0 = Math.max(0, Math.min(n - 1, Math.floor(pos))), i1 = Math.min(n - 1, i0 + 1), f = Math.min(1, Math.max(0, pos - i0));
      const ct = contour[i0] + (contour[i1] - contour[i0]) * f, en = energy[i0] + (energy[i1] - energy[i0]) * f;
      const rc = 2 + ct * 26;                           // fundamental row, 0 = lowest band
      for (let r = 0; r < HEAT_ROWS; r++) {
        let v = 0.22 * Math.exp(-r / 14);               // dim low-frequency body
        for (let k = 1; k <= 5; k++) { const d = r - (rc + 7 * Math.log2(k)); v += Math.pow(k, -1.1) * Math.exp(-d * d / 2.2); }
        v += 0.1 * hash(c, r);
        v *= 1.25 * (0.08 + 0.92 * en * en);
        const col = magma(v), o = ((HEAT_ROWS - 1 - r) * HEAT_COLS + c) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  /* ---------------- the demo ---------------- */
  PortfolioDemos.register("planty-skeleton", {
    title: "Planty: the skeleton function f",
    note: "A browser port of Planty's extract_skeleton on synthetic signals: any signal is cut into windows and reduced to two slow curves, contour and energy. Raise the noise on the plant-like signal and watch the blend weight w hand the contour over from level to pitch, then try each contour_mode.",
    mount(host, kit) {
      const h = kit.h, C = kit.colors();
      const frame = kit.frame(host);
      frame.root.classList.add("d-planty-skeleton");

      const style = document.createElement("style");
      style.textContent =
        ".d-planty-skeleton .demo__stage{display:flex;flex-direction:column}" +
        ".d-planty-skeleton .demo__stage canvas{touch-action:pan-y;cursor:crosshair}" +
        ".d-planty-skeleton .demo__caption{border-top:1px solid " + C.line + "}" +
        ".d-planty-skeleton .demo__caption:first-child{border-top:0}" +
        ".d-planty-skeleton__fine{flex:1 1 100%;margin:0;font-size:.82rem;color:" + C.ash + ";font-style:italic}";
      document.head.append(style);

      const state = { source: "plant", mode: "auto", noise: 0.2, spike: 1.5, n: 100, seed: 1, sel: -1, playhead: -1 };
      let comps = null, compsKey = "", x = null, res = null;
      const heatOff = document.createElement("canvas");
      heatOff.width = HEAT_COLS; heatOff.height = HEAT_ROWS;

      /* panels: caption + canvas */
      const panels = {};
      function panel(key, caption, height, label) {
        frame.stage.append(h("div", { class: "demo__caption" }, caption));
        panels[key] = kit.canvas(frame.stage, W, height, label);
      }
      panel("raw", "1 · Raw signal, cut into windows (axis auto-scaled)", 120, "Raw synthetic signal");
      panel("feat", "2 · Per-window curves, squashed to [0,1] · brightness = weight in contour", 110, "Trend and pitch curves");
      panel("skel", "3 · Skeleton: contour and energy in [0,1]", 120, "Skeleton curves, contour and energy");
      panel("heat", "4 · Toy spectrogram painted from the skeleton (illustration, not the trained model's output)", 150, "Toy spectrogram illustration driven by contour and energy");

      const legendHost = h("div", {});
      kit.legend(legendHost, [
        { color: C.moon, label: "raw signal" }, { color: C.gold, label: "trend curve (w)" }, { color: C.teal, label: "pitch curve (1 - w)" },
        { color: C.bloodBright, label: "contour" }, { color: C.candle, label: "energy" }
      ]);
      frame.root.insertBefore(legendHost, frame.controls);

      /* ---- controls ---- */
      kit.select(frame.controls, {
        label: "Signal source", value: state.source, onChange: v => { state.source = v; spikeInput.disabled = v === "music"; recompute(); },
        options: [{ value: "plant", label: "Plant-like (drift + spikes + noise)" }, { value: "music", label: "Music-like (melody)" }, { value: "mixed", label: "Mixed" }]
      });
      kit.select(frame.controls, {
        label: "contour_mode", value: state.mode, onChange: v => { state.mode = v; recompute(); },
        options: [{ value: "auto", label: "auto (blend by w)" }, { value: "trend", label: "trend (w = 1)" }, { value: "frequency", label: "frequency (w = 0)" }]
      });
      kit.slider(frame.controls, { label: "Noise (std)", min: 0, max: 1.5, step: 0.01, value: state.noise, format: v => v.toFixed(2), onInput: v => { state.noise = v; recompute(); } });
      const spikeInput = kit.slider(frame.controls, { label: "Spike amplitude", min: 0, max: 3, step: 0.05, value: state.spike, format: v => v.toFixed(2), onInput: v => { state.spike = v; recompute(); } });
      kit.slider(frame.controls, { label: "Windows (n_frames)", min: 30, max: 200, step: 1, value: state.n, onInput: v => { state.n = v; recompute(); } });

      const buttons = h("div", { class: "demo__buttons" });
      frame.controls.append(buttons);
      const listenBtn = kit.button(buttons, "Listen", () => play(), "blood");
      const stopBtn = kit.button(buttons, "Stop", () => stopAudio(), "ghost");
      stopBtn.disabled = true;
      kit.button(buttons, "New noise seed", () => { state.seed++; recompute(); }, "ghost");
      frame.controls.append(h("p", { class: "d-planty-skeleton__fine" },
        "Listen is a simple sonification, not the trained model: one oscillator whose pitch follows the contour (3 octaves) and whose loudness follows the energy, at 10 frames per second. Click or drag on a plot to inspect a window."));

      /* ---- audio ---- */
      let ac = null, osc = null, t0 = 0, dur = 0, endTimer = 0;
      const loop = kit.loop(frame.root, () => {
        if (!ac) return;
        const p = (ac.currentTime - t0) / dur;
        if (p >= 1) { stopAudio(); return; }
        state.playhead = Math.max(0, p);
        drawAll();
      });

      function stopAudio() {
        clearTimeout(endTimer);
        const had = !!ac;
        loop.stop();
        if (osc) { try { osc.onended = null; osc.stop(); } catch (e) { /* already stopped */ } osc = null; }
        if (ac) { try { ac.close(); } catch (e) { /* ignore */ } ac = null; }
        state.playhead = -1;
        listenBtn.disabled = false; stopBtn.disabled = true;
        if (had) drawAll();
      }

      function play() {
        if (!res) return;
        stopAudio();
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { frame.readout.textContent += "\nWeb Audio is not available in this browser."; return; }
        try {
          ac = new AC();
          if (ac.resume) ac.resume();
          osc = ac.createOscillator(); osc.type = "triangle";
          const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
          const gain = ac.createGain();
          osc.connect(lp); lp.connect(gain); gain.connect(ac.destination);
          const n = res.contour.length, step = 1 / FRAME_RATE;
          t0 = ac.currentTime + 0.08; dur = n * step;
          gain.gain.setValueAtTime(0, t0);
          for (let k = 0; k < n; k++) {
            const t = t0 + (k + 0.5) * step;
            const f = 130.81 * Math.pow(2, 3 * res.contour[k]);
            if (k === 0) osc.frequency.setValueAtTime(f, t0); else osc.frequency.exponentialRampToValueAtTime(f, t);
            gain.gain.linearRampToValueAtTime(0.01 + 0.22 * res.energy[k] * res.energy[k], t);
          }
          gain.gain.linearRampToValueAtTime(0, t0 + dur);
          osc.start(t0); osc.stop(t0 + dur + 0.05);
          osc.onended = () => stopAudio();
          listenBtn.disabled = true; stopBtn.disabled = false;
          loop.start();
        } catch (e) {
          ac = null; osc = null;
          frame.readout.textContent += "\nCould not start audio: " + e.message;
        }
      }

      /* ---- drawing ---- */
      const X0 = PAD, PW = W - 2 * PAD;
      const xFrame = (k, n) => X0 + (k + 0.5) / n * PW;

      function base(p, top, bottom) {
        const { ctx, w, h: ph } = p;
        ctx.clearRect(0, 0, w, ph);
        ctx.lineWidth = 1; ctx.strokeStyle = C.grid;
        ctx.beginPath();
        for (const v of [0, 0.5, 1]) { const y = Math.round(top + (1 - v) * (bottom - top)) + 0.5; ctx.moveTo(X0, y); ctx.lineTo(X0 + PW, y); }
        ctx.stroke();
      }
      function overlay(p) {
        const { ctx, h: ph } = p, n = state.n;
        if (state.sel >= 0) {
          const half = PW / n / 2;
          ctx.fillStyle = "rgba(255,255,255,.07)";
          ctx.fillRect(xFrame(state.sel, n) - half, 0, half * 2, ph);
          ctx.strokeStyle = C.gold; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(Math.round(xFrame(state.sel, n)) + 0.5, 0); ctx.lineTo(Math.round(xFrame(state.sel, n)) + 0.5, ph); ctx.stroke();
          ctx.setLineDash([]);
        }
        if (state.playhead >= 0) {
          const px = X0 + state.playhead * PW;
          ctx.strokeStyle = C.goldBright; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, ph); ctx.stroke();
        }
      }
      function curve(ctx, arr, top, bottom, color, width, alpha, glow) {
        const n = arr.length;
        ctx.save();
        ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
        if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const px = xFrame(k, n), py = top + (1 - arr[k]) * (bottom - top);
          if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      function drawRaw() {
        const p = panels.raw, { ctx, h: ph } = p, N = x.length, n = state.n;
        const mid = ph / 2;
        let ymax = 1.2;
        const absx = Array.from(x, Math.abs);
        ymax = Math.max(ymax, percentile(absx, 99.5) * 1.05);
        const yOf = v => mid - v / ymax * (ph / 2 - 8);
        ctx.clearRect(0, 0, p.w, ph);
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
        const stride = Math.ceil(4 / (PW / n));
        ctx.beginPath();
        for (let k = 0; k <= n; k += stride) { const px = Math.round(X0 + k / n * PW) + 0.5; ctx.moveTo(px, ph - 7); ctx.lineTo(px, ph); }
        ctx.moveTo(X0, Math.round(mid) + 0.5); ctx.lineTo(X0 + PW, Math.round(mid) + 0.5);
        ctx.stroke();
        ctx.strokeStyle = C.moon; ctx.lineWidth = 1;
        ctx.beginPath();
        const cols = Math.floor(PW);
        for (let c = 0; c < cols; c++) {
          const a = Math.floor(c / cols * N), b = Math.max(a + 1, Math.floor((c + 1) / cols * N));
          let lo = Infinity, hi = -Infinity;
          for (let i = a; i < b; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
          const px = X0 + c + 0.5;
          ctx.moveTo(px, yOf(hi)); ctx.lineTo(px, yOf(lo) + 0.6);
        }
        ctx.stroke();
        overlay(p);
      }
      function drawFeat() {
        const p = panels.feat, T = 8, B = p.h - 8;
        base(p, T, B);
        curve(p.ctx, res.pitchCurve, T, B, C.teal, 2, 0.3 + 0.7 * (1 - res.w), 0);
        curve(p.ctx, res.trendCurve, T, B, C.gold, 2, 0.3 + 0.7 * res.w, 0);
        overlay(p);
      }
      function drawSkel() {
        const p = panels.skel, T = 8, B = p.h - 8;
        base(p, T, B);
        curve(p.ctx, res.energy, T, B, C.candle, 2, 0.95, 0);
        curve(p.ctx, res.contour, T, B, C.bloodBright, 3, 1, 8);
        overlay(p);
      }
      function drawHeat() {
        const p = panels.heat;
        p.ctx.imageSmoothingEnabled = false;
        p.ctx.drawImage(heatOff, 0, 0, HEAT_COLS, HEAT_ROWS, 0, 0, p.w, p.h);
        overlay(p);
      }
      function drawAll() { if (!res) return; drawRaw(); drawFeat(); drawSkel(); drawHeat(); }

      /* ---- compute + readout ---- */
      const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
      function describeW(w) {
        if (state.mode !== "auto") return "forced by contour_mode";
        return w >= 0.67 ? "level-driven: the contour follows the signal's slow level (trend)"
          : w <= 0.33 ? "pitch-driven: the contour follows how fast the signal oscillates (centroid)"
          : "a blend of level and pitch";
      }
      function updateReadout() {
        const n = state.n, secs = n / FRAME_RATE;
        let t = "w = " + fmt(res.w) + (state.mode === "auto" ? "" : " (forced; auto would give " + fmt(res.wAuto) + ")") + " -> " + describeW(res.w) + "\n" +
          "slow var " + fmt(res.slowVar, 3) + " vs fast var " + fmt(res.fastVar, 3) + " | " + n + " windows x " + SPF + " samples, " + FRAME_RATE + " frames/s = " + secs.toFixed(1) + " s of music";
        if (state.sel >= 0) {
          const k = state.sel;
          t += "\nwindow " + (k + 1) + " (" + (k / FRAME_RATE).toFixed(1) + " s): mean " + fmt(res.trend[k]) + ", rms " + fmt(res.rms[k], 3) + ", centroid " + fmt(res.centroid[k], 1) +
            " cycles/window -> contour " + fmt(res.contour[k]) + ", energy " + fmt(res.energy[k]);
        }
        frame.readout.textContent = t;
        panels.skel.canvas.setAttribute("aria-label", "Skeleton curves, contour and energy, " + n + " windows. w = " + fmt(res.w) + ", " + describeW(res.w));
      }

      function recompute() {
        stopAudio();
        const key = state.n + ":" + state.seed;
        if (key !== compsKey) { comps = makeComponents(kit, state.n, state.seed); compsKey = key; }
        x = mixSignal(comps, state.source, state.noise, state.spike);
        res = extractSkeleton(x, state.n, state.mode);
        if (state.sel >= state.n) state.sel = -1;
        paintHeat(heatOff, res.contour, res.energy);
        drawAll();
        updateReadout();
      }

      /* ---- inspect a window by pointer ---- */
      function pick(evt) {
        const p = evt.currentTarget === panels.raw.canvas ? panels.raw : Object.values(panels).find(q => q.canvas === evt.currentTarget);
        const px = p.toLocal(evt).x;
        state.sel = Math.min(state.n - 1, Math.max(0, Math.floor((px - X0) / PW * state.n)));
        drawAll(); updateReadout();
      }
      const cleanups = [];
      Object.values(panels).forEach(p => {
        let down = false;
        const onDown = e => { down = true; try { p.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } pick(e); };
        const onMove = e => { if (down) pick(e); };
        const onUp = () => { down = false; };
        p.canvas.addEventListener("pointerdown", onDown);
        p.canvas.addEventListener("pointermove", onMove);
        p.canvas.addEventListener("pointerup", onUp);
        p.canvas.addEventListener("pointercancel", onUp);
        cleanups.push(() => {
          p.canvas.removeEventListener("pointerdown", onDown); p.canvas.removeEventListener("pointermove", onMove);
          p.canvas.removeEventListener("pointerup", onUp); p.canvas.removeEventListener("pointercancel", onUp);
        });
      });

      recompute();

      return () => {
        stopAudio();
        loop.destroy();
        cleanups.forEach(fn => fn());
        style.remove();
        frame.root.remove();
      };
    }
  });
})();
