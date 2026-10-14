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

  P.util = { h, store, STATUS_LABEL, KIND_LABEL, projectUrl, reducedMotion, sortedProjects };

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
    initCandles();
    initKonami();
  });
})();
