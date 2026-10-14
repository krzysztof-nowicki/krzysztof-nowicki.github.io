/* Home page: renders every section from data/profile.js and data/projects.js. */
(function () {
  "use strict";

  const P = window.PORTFOLIO;
  const { h, STATUS_LABEL, KIND_LABEL, projectUrl, sortedProjects } = P.util;
  const profile = P.profile;

  /* ---------- Hero, About ---------- */
  function renderHero() {
    document.querySelector(".hero__title").textContent = profile.name;
    document.querySelector(".hero__role").textContent = profile.role;
    document.querySelector(".hero__lead").textContent = profile.lead;
    const sheet = document.querySelector(".hero__status");
    const shown = sortedProjects().filter(p => !p.compact && p.category !== "lab");
    const finished = shown.filter(p => p.status === "finished").length;
    sheet.append(
      h("p", { class: "status-window__title" }, "Character sheet"),
      h("dl", { class: "sheet" }, profile.sheet.map(s => h("div", { class: "stat-row" }, h("dt", {}, s.k), h("dd", {}, s.v)))),
      h("div", { class: "stat-row" }, h("span", { class: "k" }, "Quests"),
        h("span", { class: "v" }, `${finished} completed · ${shown.length - finished} in progress`,
          h("span", { class: "bar", role: "img", "aria-label": `${finished} of ${shown.length} quests completed` }, h("i", { style: `width:${shown.length ? (finished / shown.length) * 100 : 0}%` }))))
    );
  }

  function renderAbout() {
    document.querySelector(".about__text").append(...profile.about.map(p => h("p", {}, p)));
    const facts = document.querySelector(".about__facts");
    facts.append(h("p", { class: "status-window__title" }, "At a glance"), ...profile.facts.map(f => h("div", { class: "stat-row" }, h("dt", {}, f.k), h("dd", {}, f.v))));
  }

  /* ---------- Projects ---------- */
  function card(p) {
    const media = p.cover
      ? h("img", { src: p.cover, alt: p.coverAlt || "", loading: "lazy", width: 640, height: 360 })
      : h("div", { class: "card__fallback", "aria-hidden": "true" }, p.title.split(/\s+/).slice(0, 2).map(w => w[0]).join(""));
    return h("article", { class: "card" + (p.featured ? " card--featured" : ""), dataset: { id: p.id, status: p.status, search: [p.title, p.tagline, p.summary, ...(p.tech || [])].join(" ").toLowerCase(), tech: (p.tech || []).join("|").toLowerCase() } },
      h("div", { class: "card__media" }, media,
        h("div", { class: "card__badges" },
          h("span", { class: "badge badge--" + p.status }, STATUS_LABEL[p.status] || p.status),
          p.demo ? h("span", { class: "badge badge--demo" }, "Demo") : null)),
      h("div", { class: "card__body" },
        h("h3", { class: "card__title" }, h("a", { href: projectUrl(p.id) }, p.title)),
        h("p", { class: "card__summary" }, p.summary),
        h("ul", { class: "tag-list", "aria-label": "Technologies" }, (p.tech || []).slice(0, 5).map(t => h("li", { class: "tag" }, t))),
        h("div", { class: "card__meta" }, h("span", {}, KIND_LABEL[p.category] || p.category), h("span", {}, p.year || ""))));
  }

  function renderProjects() {
    const all = sortedProjects();
    const showcase = all.filter(p => p.category !== "lab" && !p.compact);
    const grid = document.querySelector(".project-grid");
    grid.append(...showcase.map(card));

    // Other projects known only from the resume: compact, not clickable.
    const compact = all.filter(p => p.compact);
    if (compact.length) {
      grid.after(h("div", { class: "more-projects" },
        h("h3", { class: "more-projects__title" }, "More projects"),
        h("p", { class: "more-projects__note" }, "Earlier work without published code or media here."),
        h("ul", { class: "more-projects__list" }, compact.map(p => h("li", { class: "more-projects__item", dataset: { search: [p.title, p.summary, ...(p.tech || [])].join(" ").toLowerCase(), tech: (p.tech || []).join("|").toLowerCase(), status: p.status } },
          h("strong", {}, p.title), h("p", {}, p.summary), h("ul", { class: "tag-list" }, (p.tech || []).map(t => h("li", { class: "tag" }, t))))))));
    }

    // Archive: lab exercises.
    const labs = all.filter(p => p.category === "lab");
    const list = document.querySelector(".archive__list");
    list.append(...labs.map(p => h("li", { class: "archive__item" },
      p.page === false ? h("strong", {}, p.title) : h("a", { href: projectUrl(p.id) }, p.title),
      h("p", {}, p.summary))));
    if (!labs.length) document.querySelector(".archive").hidden = true;

    // Technology chips: the most used technologies across showcase projects.
    const counts = new Map();
    showcase.forEach(p => (p.tech || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14).map(e => e[0]);
    const tagBox = document.querySelector(".filters__tags");
    tagBox.append(...top.map(t => h("button", { type: "button", class: "chip", "aria-pressed": "false", dataset: { tag: t.toLowerCase() } }, t)));

    const state = { status: "all", tag: null, query: "" };
    const empty = document.querySelector(".filters__empty");
    const apply = () => {
      let visible = 0;
      document.querySelectorAll(".project-grid .card, .more-projects__item").forEach(el => {
        const ok = (state.status === "all" || el.dataset.status === state.status) &&
          (!state.tag || el.dataset.tech.split("|").includes(state.tag)) &&
          (!state.query || el.dataset.search.includes(state.query));
        el.classList.toggle("is-hidden", !ok);
        if (ok && el.classList.contains("card")) visible++;
      });
      const more = document.querySelector(".more-projects");
      if (more) more.hidden = !more.querySelector(".more-projects__item:not(.is-hidden)");
      empty.hidden = visible > 0 || (more && !more.hidden);
    };

    document.querySelector('[data-filter="status"]').addEventListener("click", e => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.status = b.dataset.value;
      b.parentElement.querySelectorAll(".chip").forEach(c => { c.classList.toggle("is-active", c === b); c.setAttribute("aria-pressed", String(c === b)); });
      apply();
    });
    tagBox.addEventListener("click", e => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag;
      tagBox.querySelectorAll(".chip").forEach(c => { const on = c.dataset.tag === state.tag; c.classList.toggle("is-active", on); c.setAttribute("aria-pressed", String(on)); });
      apply();
    });
    const search = document.querySelector(".filters__search input");
    search.addEventListener("input", () => { state.query = search.value.trim().toLowerCase(); apply(); });

    // Deep link from a skill: index.html?tech=python#projects
    const fromUrl = new URLSearchParams(location.search).get("tech");
    if (fromUrl) {
      const chip = tagBox.querySelector(`[data-tag="${CSS.escape(fromUrl.toLowerCase())}"]`);
      if (chip) chip.click(); else { search.value = fromUrl; state.query = fromUrl.toLowerCase(); apply(); }
    }
  }

  /* ---------- Skills ---------- */
  function renderSkills() {
    const projects = sortedProjects();
    const wrap = document.querySelector(".skills");
    let max = 1;
    const groups = profile.skillGroups.map(g => ({
      name: g.name,
      skills: g.skills.map(s => {
        const names = [s.name, ...(s.aliases || [])].map(n => n.toLowerCase());
        const used = projects.filter(p => (p.tech || []).some(t => { const tl = t.toLowerCase(); return names.some(n => tl === n || tl.startsWith(n + " ") || tl.startsWith(n + "(")); }));
        max = Math.max(max, used.length);
        return { ...s, used };
      })
    }));
    groups.forEach((g, gi) => {
      wrap.append(h("div", { class: "skill-group status-window" },
        h("h3", {}, g.name),
        g.skills.map((s, si) => {
          const listId = `skill-${gi}-${si}`;
          const list = h("ul", { class: "skill__projects", id: listId, hidden: true },
            s.used.length ? s.used.map(p => h("li", {}, p.page === false ? p.title : h("a", { href: projectUrl(p.id) }, p.title)))
              : h("li", { class: "none" }, "No project on this site uses it yet."));
          const btn = h("button", { type: "button", class: "skill", "aria-expanded": "false", "aria-controls": listId },
            h("span", { class: "skill__line" }, h("span", {}, s.name), h("span", { class: "skill__count" }, s.used.length ? `${s.used.length} project${s.used.length > 1 ? "s" : ""}` : "—")),
            h("span", { class: "bar bar--mp", "aria-hidden": "true" }, h("i", { style: `width:${s.used.length ? Math.max(6, (s.used.length / max) * 100) : 0}%` })));
          btn.addEventListener("click", () => { const open = btn.getAttribute("aria-expanded") !== "true"; btn.setAttribute("aria-expanded", String(open)); list.hidden = !open; });
          return [btn, list];
        })));
    });
  }

  /* ---------- Chronicle ---------- */
  function renderChronicle() {
    document.querySelector(".timeline").append(...profile.chronicle.map(c => h("li", { class: "timeline__item timeline__item--" + c.type },
      h("span", { class: "timeline__when" }, c.when),
      h("h3", {}, c.title),
      h("p", { class: "timeline__where" }, c.where),
      c.points ? h("ul", {}, c.points.map(p => h("li", {}, p))) : null)));
  }

  /* ---------- Contact ---------- */
  function renderContact() {
    const c = profile.contact;
    const email = c.emailUser + "@" + c.emailDomain;
    const status = h("span", { class: "copy-status", "aria-live": "polite" });
    const copy = h("button", { type: "button", class: "btn btn--small btn--ghost" }, "Copy address");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(email); status.textContent = "Copied to clipboard"; }
      catch (e) { status.textContent = email; }
      setTimeout(() => { status.textContent = ""; }, 2500);
    });
    document.querySelector(".contact").append(
      h("div", { class: "contact__card status-window" }, h("h3", {}, "Email"), h("p", {}, email),
        h("div", { class: "demo__buttons", style: "justify-content:center" }, h("a", { class: "btn btn--small btn--blood", href: "mailto:" + email }, "Write"), copy), status),
      h("div", { class: "contact__card status-window" }, h("h3", {}, "GitHub"), h("p", {}, c.github.replace("https://", "")),
        h("a", { class: "btn btn--small btn--ghost", href: c.github, target: "_blank", rel: "noopener" }, "Open profile")),
      h("div", { class: "contact__card status-window" }, h("h3", {}, "LinkedIn"), h("p", {}, "Professional profile and experience"),
        h("a", { class: "btn btn--small btn--ghost", href: c.linkedin, target: "_blank", rel: "noopener" }, "Open profile")));
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderHero();
    renderAbout();
    renderProjects();
    renderSkills();
    renderChronicle();
    renderContact();
  });
})();
