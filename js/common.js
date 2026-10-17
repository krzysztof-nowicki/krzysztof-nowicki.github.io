/* Shared helpers and page chrome used by every page. */
(function () {
  "use strict";

  const P = (window.PORTFOLIO = window.PORTFOLIO || {});

  /** Create an element: h("a", {href: "#", class: "x"}, "text", childNode). */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "html") el.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key === "dataset") Object.assign(el.dataset, value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("kn:" + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("kn:" + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }
  };

  const STATUS_LABEL = { finished: "Finished", wip: "In progress" };
  const KIND_LABEL = { thesis: "Thesis", personal: "Personal", university: "University", lab: "Lab", work: "Work" };

  function projectUrl(id) { return "project.html?id=" + encodeURIComponent(id); }
  function reducedMotion() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  /** Visible projects: the archive (labs) and showcase entries, sorted featured-first then by `order`/year. */
  function sortedProjects() {
    const list = (P.projects || []).filter(p => !p.hidden);
    return list.slice().sort((a, b) =>
      (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
      (a.order ?? 99) - (b.order ?? 99) ||
      String(b.year || "").localeCompare(String(a.year || "")));
  }

  /** The same text in both site styles: the gothic wording and the professional one (see css/switch.css). */
  function dual(gothic, pro) {
    return [h("span", { class: "only-gothic" }, gothic), h("span", { class: "only-pro" }, pro)];
  }

  P.util = { h, dual, store, STATUS_LABEL, KIND_LABEL, projectUrl, reducedMotion, sortedProjects };

  /* ---------- Nav ---------- */
  function initNav() {
    const brandName = document.querySelector(".nav__name");
    if (brandName && P.profile) brandName.textContent = P.profile.name;

    const toggle = document.querySelector(".nav__toggle");
    const menu = document.querySelector(".nav__menu");
    if (toggle && menu) {
      const setOpen = open => {
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        menu.classList.toggle("is-open", open);
      };
      toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
      menu.addEventListener("click", e => { if (e.target.closest("a")) setOpen(false); });
      document.addEventListener("keydown", e => { if (e.key === "Escape") setOpen(false); });
    }

    const header = document.querySelector(".site-header");
    if (header) {
      const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // Highlight the menu entry of the section in view (index page only).
    const links = [...document.querySelectorAll('.nav__menu a[href^="#"]')];
    const sections = links.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
    if (sections.length && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          links.forEach(a => a.classList.toggle("is-current", a.getAttribute("href") === "#" + entry.target.id));
        }
      }, { rootMargin: "-45% 0px -50% 0px" });
      sections.forEach(s => io.observe(s));
    }
  }

  /* ---------- Gothic / professional style ---------- */
  // <html data-style> is set before the page paints (inline script in the <head>); this button flips it.
  function initStyle() {
    const btn = document.querySelector(".style-switch");
    const root = document.documentElement;
    const apply = style => {
      root.dataset.style = style;
      const gothic = document.getElementById("css-gothic"), pro = document.getElementById("css-pro");
      if (gothic) gothic.disabled = style !== "gothic";
      if (pro) pro.disabled = style !== "pro";
      if (btn) {
        const other = style === "pro" ? "Victorian" : "Professional";
        btn.querySelector(".style-switch__text").textContent = other;
        btn.setAttribute("aria-label", `Switch to the ${other.toLowerCase()} style`);
        btn.title = `Switch to the ${other.toLowerCase()} style`;
      }
    };
    apply(root.dataset.style === "pro" ? "pro" : "gothic");
    if (btn) btn.addEventListener("click", () => {
      const next = root.dataset.style === "pro" ? "gothic" : "pro";
      store.set("style", next);
      const url = new URL(location.href);                 // a ?style= link must not win over the button
      if (url.searchParams.has("style")) { url.searchParams.delete("style"); history.replaceState(null, "", url); }
      // Demos read the colours once when they start, so a page with a running demo is reloaded.
      if (document.querySelector(".demo")) { location.reload(); return; }
      apply(next);
      window.dispatchEvent(new Event("resize"));      // the castle canvas measures itself again
    });
  }

  /* ---------- Light / dark theme ---------- */
  // The page follows the system setting until the visitor picks one; the choice is kept in localStorage.
  // Demos always use the dark tokens (see style.css), so they look the same in both themes.
  function initTheme() {
    const btn = document.querySelector(".theme-toggle");
    const root = document.documentElement;
    const current = () => root.dataset.theme || (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const label = () => { if (btn) btn.setAttribute("aria-label", current() === "dark" ? "Switch to light theme" : "Switch to dark theme"); };
    label();
    if (btn) btn.addEventListener("click", () => {
      root.dataset.theme = current() === "dark" ? "light" : "dark";
      store.set("theme", root.dataset.theme);
      label();
    });
    const year = document.querySelector(".site-footer__year");
    if (year) year.textContent = new Date().getFullYear();
    const name = document.querySelector(".site-footer__name");
    if (name && P.profile) name.textContent = P.profile.name;
  }

  /* ---------- Candles & hearts ---------- */
  function initCandles() {
    const counter = document.querySelector(".hud-hearts__count");
    let hearts = store.get("hearts", 0);
    const render = () => { if (counter) counter.textContent = String(hearts).padStart(2, "0"); };
    render();
    P.addHearts = function (n, x, y) {
      hearts = Math.min(99, hearts + n);
      store.set("hearts", hearts);
      render();
      const hud = document.querySelector(".hud-hearts");
      if (hud) { hud.classList.remove("is-bump"); void hud.offsetWidth; hud.classList.add("is-bump"); }
      if (x !== undefined) {
        const drop = h("span", { class: "heart-drop", "aria-hidden": "true" }, "♥");
        drop.style.left = x + "px";
        drop.style.top = y + "px";
        document.body.append(drop);
        setTimeout(() => drop.remove(), 1100);
      }
    };
    document.querySelectorAll(".candle").forEach(candle => {
      candle.addEventListener("click", () => {
        const r = candle.getBoundingClientRect();
        candle.classList.add("is-broken");
        candle.setAttribute("aria-label", "Broken candle");
        P.addHearts(1, r.left + r.width / 2 - 8, r.top);
      });
    });
  }

  /* ---------- Konami code ---------- */
  function initKonami() {
    const code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let pos = 0;
    document.addEventListener("keydown", e => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      pos = key === code[pos] ? pos + 1 : (key === code[0] ? 1 : 0);
      if (pos === code.length) {
        pos = 0;
        const on = document.body.classList.toggle("is-night-mode");
        if (on && P.addHearts) P.addHearts(30, window.innerWidth / 2, window.innerHeight / 2);
        document.dispatchEvent(new CustomEvent("konami", { detail: { on } }));
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    initStyle();
    initTheme();
    initCandles();
    initKonami();
  });
})();
