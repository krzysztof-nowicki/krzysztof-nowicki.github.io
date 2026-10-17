/* Project page: project.html?id=<id> renders one entry of data/projects.js. */
(function () {
  "use strict";

  const P = window.PORTFOLIO;
  const { h, dual, STATUS_LABEL, KIND_LABEL, projectUrl, sortedProjects } = P.util;

  function paragraphs(desc) {
    // description: array of strings, or of { heading, text: [..] | string, list: [..] }
    return (desc || []).map(block => {
      if (typeof block === "string") return h("p", {}, block);
      const text = [].concat(block.text || []);
      return [block.heading ? h("h2", {}, block.heading) : null, ...text.map(t => h("p", {}, t)), block.list ? h("ul", {}, block.list.map(li => h("li", {}, li))) : null];
    }).flat().filter(Boolean);
  }

  function codeBlock(snippet) {
    const pre = h("pre", {}, h("code", { html: P.highlight(snippet.code.replace(/\s+$/, ""), snippet.language) }));
    const status = h("span", { class: "sr-only", "aria-live": "polite" });
    const copy = h("button", { type: "button", class: "code-block__copy" }, "Copy");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(snippet.code); copy.textContent = "Copied"; status.textContent = "Code copied"; }
      catch (e) { copy.textContent = "Select & copy"; }
      setTimeout(() => { copy.textContent = "Copy"; }, 2000);
    });
    return h("div", { class: "code-block" },
      h("div", { class: "code-block__bar" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), h("span", {}, snippet.file || snippet.language), copy, status),
      pre);
  }

  function initLightbox(images) {
    const box = document.querySelector(".lightbox");
    const img = box.querySelector(".lightbox__img");
    const cap = box.querySelector(".lightbox__caption");
    let index = 0, opener = null;
    const show = i => { index = (i + images.length) % images.length; img.src = images[index].src; img.alt = images[index].alt || images[index].caption || ""; cap.textContent = images[index].caption || ""; };
    const close = () => { box.hidden = true; document.body.style.overflow = ""; if (opener) opener.focus(); };
    box.querySelector(".lightbox__close").addEventListener("click", close);
    box.querySelector(".lightbox__prev").addEventListener("click", () => show(index - 1));
    box.querySelector(".lightbox__next").addEventListener("click", () => show(index + 1));
    box.addEventListener("click", e => { if (e.target === box) close(); });
    document.addEventListener("keydown", e => {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(index - 1);
      if (e.key === "ArrowRight") show(index + 1);
      if (e.key === "Tab") { // keep focus inside the dialog
        const f = [...box.querySelectorAll("button")];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });
    const single = images.length < 2;
    box.querySelector(".lightbox__prev").hidden = single;
    box.querySelector(".lightbox__next").hidden = single;
    return (i, from) => { opener = from; show(i); box.hidden = false; document.body.style.overflow = "hidden"; box.querySelector(".lightbox__close").focus(); };
  }

  function render() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const preview = params.has("preview");
    const project = (P.projects || []).find(p => p.id === id && (!p.hidden || preview) && p.page !== false);
    const article = document.querySelector(".project");
    if (!project) { document.querySelector(".not-found").hidden = false; document.title = "Not found — " + P.profile.name; return; }
    const p = project;
    document.title = p.title + " — " + P.profile.name;
    const meta = document.querySelector('meta[name="description"]') || document.head.appendChild(h("meta", { name: "description" }));
    meta.setAttribute("content", p.tagline || p.summary || "");

    // Element.append would print null as text, so skip empty items.
    const put = (sel, ...nodes) => article.querySelector(sel).append(...nodes.flat().filter(Boolean));
    put(".project__badges",
      h("span", { class: "badge badge--" + p.status }, STATUS_LABEL[p.status] || p.status),
      h("span", { class: "badge badge--kind" }, KIND_LABEL[p.category] || p.category),
      p.demo && h("span", { class: "badge badge--demo" }, "Interactive demo"));
    article.querySelector(".project__title").textContent = p.title;
    article.querySelector(".project__tagline").textContent = p.tagline || "";
    put(".project__tech", (p.tech || []).map(t => h("li", { class: "tag" }, t)));
    put(".project__links", (p.links || []).map((l, i) =>
      h("a", { class: "btn btn--small " + (i ? "btn--ghost" : "btn--blood"), href: l.url, target: "_blank", rel: "noopener" }, l.label)),
      p.demo && h("a", { class: "btn btn--small btn--ghost", href: "#demo-title" }, "Jump to demo"));

    if (p.cover && p.coverOnPage !== false) put(".project__cover", h("img", { src: p.cover, alt: p.coverAlt || p.title }), p.coverCaption && h("figcaption", {}, p.coverCaption));
    else article.querySelector(".project__cover").remove();

    put(".project__desc", paragraphs(p.description || [p.summary]),
      p.highlights && h("h2", {}, "Highlights"), p.highlights && h("ul", {}, p.highlights.map(x => h("li", {}, x))));

    const facts = [
      ["Status", STATUS_LABEL[p.status] || p.status], ["Type", KIND_LABEL[p.category] || p.category], ["Year", p.year],
      ["Role", p.role], ["Team", p.team], ["Stack", (p.tech || []).slice(0, 4).join(", ")], ...(p.facts || [])
    ].filter(f => f[1]);
    article.querySelector(".project__facts").append(h("p", { class: "status-window__title" }, dual("Quest log", "Project facts")),
      h("dl", {}, facts.map(([k, v]) => h("div", { class: "stat-row" }, h("dt", {}, k), h("dd", {}, v)))));

    // Demo
    if (p.demo) {
      const section = article.querySelector(".project__demo");
      const host = section.querySelector(".demo-host");
      section.hidden = false;
      PortfolioDemos.load(p.demo).then(demo => {
        section.querySelector(".project__demo-title").textContent = demo.title || "Demo";
        section.querySelector(".project__demo-note").textContent = p.demoNote || demo.note || "";
        demo.mount(host, PortfolioDemos.kit);
      }).catch(err => { host.append(h("p", { class: "demo-error" }, "The demo could not be loaded.")); console.error(err); });
    }

    // Gallery
    if (p.gallery && p.gallery.length) {
      const section = article.querySelector(".project__gallery");
      section.hidden = false;
      const open = initLightbox(p.gallery);
      section.querySelector(".gallery").append(...p.gallery.map((g, i) => {
        const btn = h("button", { type: "button", "aria-label": "Enlarge: " + (g.caption || g.alt || "image") }, h("img", { src: g.src, alt: g.alt || g.caption || "", loading: "lazy" }));
        btn.addEventListener("click", () => open(i, btn));
        return h("figure", {}, btn, g.caption ? h("figcaption", {}, g.caption) : null);
      }));
      if (p.galleryNote) section.append(h("p", { class: "project__code-note", style: "margin-top:1rem" }, p.galleryNote));
    }

    // Code
    const snippets = p.snippets || (p.snippet ? [p.snippet] : []);
    if (snippets.length) {
      const section = article.querySelector(".project__code");
      section.hidden = false;
      if (snippets.length > 1) section.querySelector("h2").textContent = "Pieces of the code";
      section.querySelector(".project__code-note").textContent = snippets[0].note || "";
      section.querySelector(".code-block").remove(); // empty placeholder from the template
      snippets.forEach((s, i) => {
        if (i > 0 && s.note) section.append(h("p", { class: "project__code-note", style: "margin-top:1.6rem" }, s.note));
        section.append(codeBlock(s));
      });
    }

    // Pager among showcase projects
    const list = sortedProjects().filter(x => x.category !== "lab" && !x.compact && x.page !== false);
    const at = list.findIndex(x => x.id === p.id);
    const pager = article.querySelector(".project__pager");
    if (at >= 0 && list.length > 1) {
      const prev = list[(at - 1 + list.length) % list.length], next = list[(at + 1) % list.length];
      pager.append(
        h("a", { class: "prev", href: projectUrl(prev.id) }, h("small", {}, "← Previous"), prev.title),
        h("a", { class: "next", href: projectUrl(next.id) }, h("small", {}, "Next →"), next.title));
    } else pager.remove();

    article.hidden = false;
    if (location.hash) { const target = document.querySelector(location.hash); if (target) setTimeout(() => target.scrollIntoView(), 50); }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
