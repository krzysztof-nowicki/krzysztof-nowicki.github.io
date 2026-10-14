# krzysztof-nowicki.github.io

Personal portfolio: robotics, computer vision and AI projects, with interactive demos. Plain HTML, CSS and JavaScript. No build step, no dependencies.

## Run it locally

Double-click `index.html`. Everything works from `file://`, demos included.

If you prefer a local server (closer to how GitHub Pages serves it):

```
python -m http.server 8000
```

then open http://localhost:8000.

## Layout

```
index.html            home page (hero, about, projects, skills, experience, contact)
project.html          one template for every project: project.html?id=<id>
data/profile.js       everything about you: about text, skills, experience, contact
data/projects.js      the project list (one object per project)
css/style.css         all styles; colours and fonts are tokens at the top
js/common.js          shared helpers, navigation, candles easter egg
js/main.js            renders the home page from the data files
js/project.js         renders a project page
js/hero.js            the animated castle in the hero
js/highlight.js       small syntax highlighter for code excerpts
js/demos/             one file per interactive demo + demo-kit.js (the demo contract)
assets/projects/<id>/ images per project
assets/demos/<name>/  files used by a demo
tools/                demo-test.html (opens one demo alone)
```

## Adding a project

Add an object to `data/projects.js`. Only `id`, `title`, `status`, `category` and `summary` are required:

```js
{
  id: "kalman-tracker",                 // used in the URL: project.html?id=kalman-tracker
  title: "Kalman multi-object tracker",
  tagline: "One sentence under the title.",
  status: "wip",                         // "finished" | "wip"
  category: "personal",                  // "thesis" | "personal" | "university" | "lab"
  year: "2026",
  tech: ["Python", "NumPy"],             // also feeds the skill meters on the home page
  summary: "Two sentences for the card.",
  cover: "assets/projects/kalman-tracker/cover.webp",
  description: [
    { heading: "How it works", text: ["Paragraph one.", "Paragraph two."] }
  ],
  highlights: ["Short bullet", "Another bullet"],
  gallery: [{ src: "assets/projects/kalman-tracker/result.webp", caption: "What the image shows." }],
  snippets: [{ language: "python", file: "tracker.py", note: "Why this piece is interesting.", code: `...` }],
  links: [{ label: "Code on GitHub", url: "https://github.com/..." }]
}
```

Useful flags:

| Field | Effect |
|---|---|
| `status: "finished"` / `"wip"` | Badge, filter and the quest counter in the hero. **Finishing Planty = change its `status` to `"finished"`.** |
| `featured: true` | Wide card, shown first |
| `order: 3` | Sort position (lower first) |
| `category: "lab"` | Listed compactly in "The Archive" instead of a card |
| `compact: true, page: false` | Listed under "More projects", no page (for work without code or media) |
| `hidden: true` | Not shown anywhere; preview with `project.html?id=<id>&preview` |
| `demo: "<name>"` | Loads `js/demos/<name>.js` on the project page |
| `cardCover: "<path>"` | A different image for the card than the page cover |
| `coverOnPage: false` | Use `cover` on the card only (e.g. when the cover is a screenshot of the demo shown on the page) |

Images: put them in `assets/projects/<id>/` (WebP or JPG, around 1400 px wide is plenty). The existing ones were copied and resized by an import script kept outside this repository (it lists local paths).

Skills on the home page are listed in `data/profile.js` (`skillGroups`). Their meters count the projects whose `tech` contains the skill name or one of its `aliases`, so they update by themselves when you add projects.

## Adding a demo

1. Create `js/demos/<name>.js` and register it, following the contract at the top of `js/demos/demo-kit.js`:

   ```js
   PortfolioDemos.register("<name>", {
     title: "Demo title",
     note: "What to try.",
     mount(host, kit) { const f = kit.frame(host); /* build inside f.stage / f.controls */ return () => {}; }
   });
   ```

2. Open `tools/demo-test.html?demo=<name>` to develop it alone.
3. Set `demo: "<name>"` on the project in `data/projects.js`.

Demos must work from `file://`: no `fetch`, no ES modules, no reading pixels back from canvases that drew image files.

## Publishing on GitHub Pages

This repository is `krzysztof-nowicki.github.io`, so GitHub serves the root of the `main` branch at https://krzysztof-nowicki.github.io. Push to `main`, then check **Settings → Pages** (source: "Deploy from a branch", branch `main`, folder `/ (root)`). The site is live a minute later.

## Credits

- Pixel art in the game demo: Gothicvania collection by Luis Zuno ([@ansimuz](https://www.patreon.com/ansimuz)), public domain.
- Street-level imagery in the thesis results: © Google.
- Fonts: Cinzel, Spectral, JetBrains Mono and Silkscreen from Google Fonts.
