/*
 * Demo kit: the contract every interactive demo follows, plus small shared helpers.
 *
 * A demo lives in js/demos/<name>.js and registers itself:
 *
 *   PortfolioDemos.register("name", {
 *     title: "Shown as the demo heading",
 *     note: "One or two sentences shown above the demo explaining what to try.",
 *     mount(host, kit) { ...build DOM inside host...; return () => {...cleanup...}; }
 *   });
 *
 * project.html loads the file named by a project's `demo` field and calls mount() once.
 * Demos must work when the page is opened from file:// (no fetch, no getImageData on
 * <img> loaded from disk), respect prefers-reduced-motion, and pause when off-screen.
 */
(function () {
  "use strict";

  const registry = {};
  const waiting = {};

  const PortfolioDemos = {
    register(name, demo) {
      registry[name] = demo;
      (waiting[name] || []).forEach(fn => fn(demo));
      delete waiting[name];
    },
    get(name) { return registry[name]; },
    /** Load js/demos/<name>.js once and resolve with the registered demo. */
    load(name) {
      if (registry[name]) return Promise.resolve(registry[name]);
      return new Promise((resolve, reject) => {
        (waiting[name] = waiting[name] || []).push(resolve);
        if (document.querySelector(`script[data-demo="${name}"]`)) return;
        const s = document.createElement("script");
        s.src = "js/demos/" + name + ".js";
        s.dataset.demo = name;
        s.onerror = () => reject(new Error("Could not load demo " + name));
        document.head.append(s);
      });
    }
  };

  /* ---------------- Helpers handed to mount() as `kit` ---------------- */

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const kit = {
    /** Theme colours from the CSS tokens, so demos match the site. */
    colors() {
      return {
        bg: css("--night-0"), panel: css("--stone-1"), grid: css("--stone-2"), line: css("--stone-3"),
        text: css("--parchment"), dim: css("--parchment-dim"), ash: css("--ash"),
        blood: css("--blood"), bloodBright: css("--blood-bright"), gold: css("--gold"), goldBright: css("--gold-bright"),
        candle: css("--candle"), moon: css("--moon"), teal: css("--teal"), amber: css("--amber")
      };
    },
    fonts: { mono: '"JetBrains Mono", Consolas, monospace', pixel: '"Silkscreen", monospace', body: '"Spectral", Georgia, serif', display: '"Cinzel", Georgia, serif' },

    reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; },

    /** Element helper: kit.h("div", {class: "x"}, child...). Same as PORTFOLIO.util.h. */
    h(...args) { return window.PORTFOLIO.util.h(...args); },

    /**
     * Create the standard demo frame inside host:
     *   { root, stage, controls, readout }  — stage is the drawing area, controls a flex row.
     */
    frame(host) {
      const h = kit.h;
      const stage = h("div", { class: "demo__stage" });
      const controls = h("div", { class: "demo__controls" });
      const readout = h("div", { class: "demo__readout", "aria-live": "polite" });
      const root = h("div", { class: "demo" }, stage, controls, readout);
      host.append(root);
      return { root, stage, controls, readout };
    },

    /**
     * A canvas that keeps a fixed logical size (w x h) and scales to its container,
     * sharp on high-DPI screens. Returns { canvas, ctx, w, h, toLocal(evt) }.
     * Draw in logical units; toLocal converts pointer events to logical coordinates.
     */
    canvas(parent, w, h, label) {
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      if (label) canvas.setAttribute("aria-label", label);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.aspectRatio = w + " / " + h;
      parent.append(canvas);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const toLocal = evt => {
        const r = canvas.getBoundingClientRect();
        const p = evt.touches ? evt.touches[0] : evt;
        return { x: (p.clientX - r.left) * (w / r.width), y: (p.clientY - r.top) * (h / r.height) };
      };
      return { canvas, ctx, w, h, dpr, toLocal };
    },

    /** Range slider with label and live value. Returns the <input>. */
    slider(parent, { label, min, max, step = 1, value, format = v => v, onInput }) {
      const h = kit.h;
      const out = h("output", {}, format(value));
      const input = h("input", { type: "range", min, max, step, value, "aria-label": label });
      input.addEventListener("input", () => { out.textContent = format(+input.value); onInput && onInput(+input.value); });
      parent.append(h("label", { class: "demo__control" }, h("span", {}, label, " ", out), input));
      return input;
    },

    /** <select> with label. options: [{value, label}]. Returns the <select>. */
    select(parent, { label, options, value, onChange }) {
      const h = kit.h;
      const sel = h("select", { "aria-label": label }, options.map(o => h("option", { value: o.value }, o.label)));
      if (value !== undefined) sel.value = value;
      sel.addEventListener("change", () => onChange && onChange(sel.value));
      parent.append(h("label", { class: "demo__control" }, h("span", {}, label), sel));
      return sel;
    },

    /** Button styled like the site. variant: "blood" | "ghost". Returns the <button>. */
    button(parent, text, onClick, variant = "ghost") {
      const b = kit.h("button", { type: "button", class: "btn btn--small btn--" + variant }, text);
      b.addEventListener("click", onClick);
      parent.append(b);
      return b;
    },

    /**
     * requestAnimationFrame loop that runs only while `el` is on screen and the tab is visible.
     * step(dtSeconds, timeSeconds) is called each frame. Returns { start, stop, running }.
     */
    loop(el, step) {
      let raf = 0, last = 0, onScreen = true, wanted = false;
      const tick = t => {
        const dt = Math.min(0.05, last ? (t - last) / 1000 : 0);
        last = t;
        raf = 0;
        step(dt, t / 1000);
        // step() may have called stop(); only schedule the next frame if still wanted.
        if (!raf && wanted && onScreen && !document.hidden) raf = requestAnimationFrame(tick);
      };
      const sync = () => {
        const should = wanted && onScreen && !document.hidden;
        if (should && !raf) { last = 0; raf = requestAnimationFrame(tick); }
        if (!should && raf) { cancelAnimationFrame(raf); raf = 0; }
      };
      const io = "IntersectionObserver" in window ? new IntersectionObserver(e => { onScreen = e[0].isIntersecting; sync(); }) : null;
      if (io) io.observe(el);
      document.addEventListener("visibilitychange", sync);
      return {
        start() { wanted = true; sync(); },
        stop() { wanted = false; sync(); },
        get running() { return !!raf; },
        destroy() { wanted = false; sync(); io && io.disconnect(); document.removeEventListener("visibilitychange", sync); }
      };
    },

    /** Legend row: items [{color, label}]. */
    legend(parent, items) {
      const h = kit.h;
      parent.append(h("div", { class: "demo__legend" }, items.map(i => h("span", {}, h("i", { style: "background:" + i.color }), i.label))));
    },

    /** Seeded pseudo-random generator (mulberry32) so demos are reproducible. */
    rng(seed = 1) {
      let a = seed >>> 0;
      return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    },

    clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
    lerp(a, b, t) { return a + (b - a) * t; },

    /** Give hearts in the site HUD (the candle easter egg); x/y in viewport pixels, optional. */
    addHearts(n, x, y) { if (window.PORTFOLIO.addHearts) window.PORTFOLIO.addHearts(n, x, y); }
  };

  PortfolioDemos.kit = kit;
  window.PortfolioDemos = PortfolioDemos;
})();
