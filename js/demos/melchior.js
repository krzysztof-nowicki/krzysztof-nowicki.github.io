/*
 * Demo: melchior
 * "Inside Melchior: the fact gate" - the decision pipeline of my offline Raspberry Pi voice assistant,
 * re-implemented in JavaScript on a tiny made-up knowledge base (a castle caretaker's notes).
 *
 * Ported from pi_lite (storage.py, assistant.py, tools.py), translated from Polish to English:
 *   - stopwords, crude stemming stem(), key_words(), prefix OR queries ("libra"* OR "open"*)
 *   - BM25 as SQLite FTS5 computes it (k1 = 1.2, b = 0.75, idf floored at 1e-6), all columns of a row
 *     counted as one document; documents keep results scoring >= 0.4 x the best (bm25 <= best * 0.4)
 *   - memory search with a looser second attempt (stems cut by one more letter)
 *   - coverage() with _same_word(), min_coverage 0.6 - the fact gate
 *   - decision order of Assistant.ask(), explicit fact patterns, learn() after "tell me",
 *     a pending question with cancel words, names answered in code, the regex tool router
 *   - prompt layout for llama.cpp KV-cache reuse, history with bare questions, 400-token context budget
 * Simulated (NOT the real assistant): the LLM. When the gate is open the reply is composed from the
 * top retrieved fact; in the real assistant Bielik 1.5B writes it. Small talk replies are canned.
 * English adaptations: stopword list, question detection (auxiliary verb first), number words.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ made-up knowledge base */
  const DOCS = [
    { file: "library.md", text: "The library opens at eight in the morning and closes at sunset. Candles are not allowed between the shelves." },
    { file: "keys.md", text: "The north tower key hangs on a hook in the kitchen, next to the bread oven." },
    { file: "ravens.md", text: "The ravens are fed at noon with scraps from the kitchen. Never feed them after dark." },
    { file: "clock.md", text: "The great clock in the hall is wound every Sunday after the evening bells." },
    { file: "garden.md", text: "The herb garden behind the chapel needs water every second evening. The roses by the gate are pruned in March." },
    { file: "crypt.md", text: "Visitors may enter the crypt only with a lantern and never alone." },
    { file: "kitchen.md", text: "Bread is baked in the kitchen before dawn; the cook leaves the oven to cool at midday." }
  ];
  const START_MEMORIES = [
    ["My name is Ambrose", "user_profile", "User name", "user_profile"],
    ["I keep the spare lantern oil in the stable", "preferences", "Fact about the user", "preferences"],
    ["When do the bells ring — at dawn and at dusk", "knowledge", "When do the bells ring", "taught"]
  ];
  const ASSISTANT_NAME = "Melchior";
  const ROLE = "the castle's voice assistant";
  const INTRODUCTION = "I am Melchior, " + ROLE + ".";

  /* ------------------------------------------------------------------ config.toml */
  const MIN_COVERAGE = 0.6, TOP_K = 3, MAX_RECALLED = 3, CONTEXT_BUDGET = 400, HISTORY_TURNS = 3;
  const MAX_TOKENS = 256, MAX_TOKENS_CHAT = 64, TEMPERATURE = 0.4;
  const STOP_SEQUENCES = ["Question:", "\\nUser:", "Document fragments", "\\n#"];
  const SUGGESTIONS = [
    "When does the library open?",
    "Where is the cellar key?",
    "Under the third stair",
    "Where is the cellar key?",
    "Remember that the gate is painted red",
    "What is 12 times 7?"
  ];

  /* ------------------------------------------------------------------ storage.py */
  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "if", "so", "of", "in", "on", "at", "to", "for", "from", "by", "with",
    "about", "into", "as", "after", "before", "under", "over", "behind", "between", "near", "next", "than", "then", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "has", "have", "had",
    "it", "its", "this", "that", "these", "those", "there", "here", "what", "when", "where", "who", "whom", "which",
    "how", "why", "can", "could", "will", "would", "should", "may", "please", "tell", "explain", "describe",
    // pronouns, question words and numbers carry no searchable fact
    "you", "your", "yours", "me", "my", "mine", "we", "us", "our", "they", "them", "their", "now", "today",
    "know", "remember", "one", "two", "three", "four", "five", "much", "many", "any", "some", "all", "not"
  ]);
  const WORD_RE = /[\p{L}\p{N}_]+/gu;
  const words = text => text.match(WORD_RE) || [];

  /** Crude stemming by cutting inflection endings (written for Polish): "library" -> "libra". */
  function stem(word) {
    if (word.length <= 4) return word;
    if (word.length <= 6) return word.slice(0, -1);
    return word.slice(0, Math.max(5, word.length - 3));
  }

  /** Words of a question that carry a searchable fact (no stopwords, numbers or short words). */
  function keyWords(text, maxTerms = 12) {
    const out = [];
    for (const w of words(text.toLowerCase())) {
      if (STOPWORDS.has(w) || w.length < 3 || /^\d+$/.test(w) || out.includes(w)) continue;
      out.push(w);
      if (out.length >= maxTerms) break;
    }
    return out;
  }
  const uniq = arr => [...new Set(arr)];
  const queryTerms = (text, maxTerms = 12) => uniq(keyWords(text, maxTerms).map(stem));

  /** Prefix terms of the FTS5 OR-query; extraCut shortens stems further (never below 4 letters). */
  function ftsTerms(text, extraCut = 0) {
    let terms = queryTerms(text);
    if (extraCut) terms = uniq(terms.map(t => t.slice(0, Math.max(4, t.length - extraCut))));
    return terms;
  }
  const ftsString = terms => terms.map(t => '"' + t + '"*').join(" OR ");

  /** Lowercase without diacritics, so "kawę" and "kawe" compare equal. */
  const fold = text => text.toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/\p{M}/gu, "");

  /** Same word in another inflection, but not an adjective derived from it (the Polish "-ow" rule). */
  function sameWord(word, asked) {
    const root = fold(stem(asked));
    if (!word.startsWith(root) || word.length > asked.length + 3) return false;
    return !(word.slice(root.length).startsWith("ow") && !asked.slice(root.length).startsWith("ow"));
  }

  /** Share of the question's key terms found in the retrieved texts; also returns each term for display. */
  function coverage(question, texts) {
    const asked = keyWords(question).map(fold);
    if (!asked.length) return { value: 1, terms: [] };
    const found = new Set(words(fold(texts.join(" "))));
    const terms = asked.map(a => ({ word: a, covered: [...found].some(w => sameWord(w, a)) }));
    return { value: terms.filter(t => t.covered).length / asked.length, terms };
  }

  /* BM25 the way FTS5 scores it; tokens as unicode61 with remove_diacritics. Higher = better here
     (FTS5's bm25() returns the negated value). */
  const tokens = text => words(fold(text));
  function bm25(rows, terms) {
    const N = rows.length;
    if (!N || !terms.length) return [];
    const toks = rows.map(r => tokens(r.indexText));
    const avgdl = toks.reduce((s, t) => s + t.length, 0) / N;
    const idf = terms.map(term => {
      const n = toks.filter(t => t.some(w => w.startsWith(term))).length;
      const v = Math.log((N - n + 0.5) / (n + 0.5));
      return v > 0 ? v : 1e-6;
    });
    const out = [];
    rows.forEach((row, i) => {
      let score = 0, hit = false;
      terms.forEach((term, j) => {
        const f = toks[i].filter(w => w.startsWith(term)).length;
        if (!f) return;
        hit = true;
        score += idf[j] * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * toks[i].length / avgdl));
      });
      if (hit) out.push({ row, score });
    });
    return out.sort((a, b) => b.score - a.score);
  }

  function kbSearch(query, k = TOP_K) {
    const terms = ftsTerms(query);
    const rows = bm25(DOCS.map(d => ({ ...d, indexText: d.text })), terms).slice(0, k * 2);
    if (!rows.length) return { terms, kept: [], cut: [] };
    const best = rows[0].score;
    const kept = rows.filter(r => r.score >= best * 0.4);
    return { terms, kept: kept.slice(0, k), cut: rows.filter(r => r.score < best * 0.4).concat(kept.slice(k)) };
  }

  /* MemoryStore: same fields as the SQLite `memories` table */
  const FACT_PATTERNS = [
    [/^(?:please\s+)?(?:remember|note|save)(?:\s+(?:please|this))*,?\s*(?:that)?:?\s+(.+)/i, "preferences", "Fact about the user"],
    [/^(?:hi,?\s+)?my name is\s+(\w+)/i, "user_profile", "User name"],
    [/^call me\s+(\w+)/i, "user_profile", "User name"],
    [/^i live in\s+(.+)/i, "user_profile", "User location"],
    [/^i work as\s+(.+)/i, "user_profile", "User job"],
    [/^i (?:really\s+)?like\s+(.+)/i, "preferences", "User interests"],
    [/^my favou?rite\s+(.+)/i, "preferences", "Favourites"]
  ];
  const SINGLE_VALUE_KEYS = new Set(["User name", "User location", "User job"]);

  function makeMemory() {
    let rows = [], nextId = 1;
    const mem = {
      rows: () => rows,
      add(content, category = "fact", key = "", importance = 3, tags = "") {
        content = content.trim();
        if (!content) return -1;
        if (!key) { const w = content.split(/\s+/); key = w.slice(0, 4).join(" ") + (w.length > 4 ? "..." : ""); }
        const row = { id: nextId++, category, key, content, importance, tags };
        rows.push(row);
        return row.id;
      },
      matchFact(text) {
        const clean = text.trim().replace(/[.!]+$/, "");
        for (let i = 0; i < FACT_PATTERNS.length; i++) {
          const [re, category, key] = FACT_PATTERNS[i];
          const m = clean.match(re);
          // "Remember that X" -> store just X; statements like "My name is X" are kept whole
          if (m) return { fact: i === 0 ? m[1].trim() : clean, category, key };
        }
        return null;
      },
      extractAndSave(text) {
        const f = mem.matchFact(text);
        if (!f) return null;
        if (SINGLE_VALUE_KEYS.has(f.key)) rows = rows.filter(r => r.key !== f.key);
        const id = mem.add(f.fact, f.category, f.key, 4, f.category);
        return { fact: f.fact, id, category: f.category, key: f.key };
      },
      profile(limit = 3) {
        return rows.filter(r => r.category === "user_profile")
          .sort((a, b) => b.importance - a.importance || b.id - a.id).slice(0, limit);
      },
      /** Second, looser attempt for changed word endings, like "furtce" -> "furt"* finding "furtki". */
      search(query, k = MAX_RECALLED) {
        for (const extraCut of [0, 1]) {
          const terms = ftsTerms(query, extraCut);
          if (!terms.length) return { terms, hits: [], extraCut };
          const hits = bm25(rows.map(r => ({ ...r, indexText: r.key + " " + r.content + " " + r.tags })), terms).slice(0, k);
          if (hits.length) return { terms, hits, extraCut };
        }
        return { terms: ftsTerms(query), hits: [], extraCut: 1 };
      },
      learn(question, answer) {
        question = question.trim().replace(/\?+$/, "").trim();
        answer = answer.trim().replace(/\.+$/, "").trim();
        return mem.add(question + " — " + answer, "knowledge", question, 4, "taught");
      },
      remove(id) { rows = rows.filter(r => r.id !== id); },
      reset() { rows = []; nextId = 1; START_MEMORIES.forEach(m => mem.add(m[0], m[1], m[2], 4, m[3])); }
    };
    mem.reset();
    return mem;
  }

  const SECOND = { my: "your", mine: "yours", me: "you", i: "you", am: "are", "i'm": "you're", myself: "yourself", our: "your" };
  /** "my name is X" -> "your name is X": small models answer in the wrong person otherwise. */
  function toSecondPerson(text) {
    return text.replace(/[\p{L}']+/gu, (w, off) => {
      const n = SECOND[w.toLowerCase()];
      if (!n) return w;
      return off === 0 && /[A-Z]/.test(w[0]) ? n[0].toUpperCase() + n.slice(1) : n;
    });
  }
  const formatMemories = ms => ms.map(m => toSecondPerson(m.content.replace(/\.$/, ""))).join("; ") + ".";

  /* ------------------------------------------------------------------ tools.py */
  const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const OPERATORS = [
    [/\bdivided by\b|\bover\b/g, "/"], [/\bmultiplied by\b|\btimes\b|×/g, "*"], [/\bto the power of\b/g, "**"],
    [/\bplus\b|\badd\b/g, "+"], [/\bminus\b|\bsubtract\b/g, "-"]
  ];
  /** "twenty five times three" -> "25 times 3" (speech recognition writes numbers as words). */
  function wordsToNumbers(text) {
    const out = [];
    let total = 0, current = 0, inNumber = false;
    const flush = () => { if (inNumber) out.push(String(total + current)); total = current = 0; inNumber = false; };
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const w = token.toLowerCase().replace(/[,.?!]/g, "");
      if (w in UNITS) { current += UNITS[w]; inNumber = true; }
      else if (w === "hundred" && inNumber) { current = Math.max(current, 1) * 100; }
      else if (w === "thousand" && inNumber) { total += Math.max(current, 1) * 1000; current = 0; }
      else if (w === "and" && inNumber) { /* "two hundred and five" */ }
      else { flush(); out.push(token); }
    }
    flush();
    return out.join(" ");
  }
  function toExpression(text) {
    let e = wordsToNumbers(text.toLowerCase());
    e = e.replace(/(\d+(?:\.\d+)?)\s*(?:percent|%)\s*of\s+/g, "$1/100*");
    OPERATORS.forEach(([re, sym]) => { e = e.replace(re, " " + sym + " "); });
    e = e.replace(/x/g, "*").replace(/:/g, "/").replace(/\^/g, "**").replace(/^[\s?=.!]+|[\s?=.!]+$/g, "").replace(/\s+/g, "");
    if (!/^[\d.+\-*/()%]+$/.test(e) || !/\d/.test(e) || !/[+\-*/%]/.test(e)) return null;
    return e;
  }
  /** + - * / ** % on numbers only (the Python version walks the AST the same way). */
  function safeEval(expr) {
    let i = 0;
    const peek = s => expr.startsWith(s, i);
    const num = () => { const m = /^\d+(?:\.\d+)?/.exec(expr.slice(i)); if (!m) throw new Error("bad"); i += m[0].length; return +m[0]; };
    const atom = () => {
      if (peek("-")) { i++; return -atom(); }
      if (peek("+")) { i++; return atom(); }
      if (peek("(")) { i++; const v = sum(); if (!peek(")")) throw new Error("bad"); i++; return v; }
      return num();
    };
    const power = () => { const b = atom(); if (peek("**")) { i += 2; const x = power(); if (Math.abs(x) > 100) throw new Error("bad"); return Math.pow(b, x); } return b; };
    const prod = () => {
      let v = power();
      while (peek("*") || peek("/") || peek("%")) {
        const op = expr[i++]; const r = power();
        if ((op === "/" || op === "%") && r === 0) throw new RangeError("zero");
        v = op === "*" ? v * r : op === "/" ? v / r : ((v % r) + r) % r;
      }
      return v;
    };
    const sum = () => { let v = prod(); while (peek("+") || peek("-")) { const op = expr[i++]; const r = prod(); v = op === "+" ? v + r : v - r; } return v; };
    const v = sum();
    if (i !== expr.length) throw new Error("bad");
    return v;
  }
  const formatNumber = v => Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function makeTools(memory) {
    const tools = [
      { name: "time", patterns: [/\bwhat time is it\b/i, /\bwhat(?:'s| is) the time\b/i, /\bwhat day is (?:it )?today\b/i, /\bwhat(?:'s| is) (?:the |today's )?date\b/i],
        run() { const d = new Date(); return "It is " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ", " + DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() + "."; } },
      { name: "calculator", patterns: [/^(?:what(?:'s| is)|how much is|calculate:?|compute:?)\s+(?<arg>.+)$/i],
        accepts: arg => toExpression(arg) !== null,
        run(arg) {
          const expr = toExpression(arg);
          if (!expr) return "I do not understand that calculation.";
          let result;
          try { result = formatNumber(safeEval(expr)); } catch (e) { return e instanceof RangeError ? "You cannot divide by zero." : "I do not understand that calculation."; }
          const spoken = arg.replace(/^[\s?=.]+|[\s?=.]+$/g, "");
          return spoken[0].toUpperCase() + spoken.slice(1) + " is " + result + ".";
        } },
      { name: "recall", patterns: [/^what do you (?:remember|know) about me(?<arg>)$/i, /^what do you remember(?: about)?\s*(?<arg>.*)$/i],
        run(arg) {
          const found = arg ? memory.search(arg, 5).hits.map(x => x.row) : memory.rows().slice(-5).reverse();
          if (!found.length) return arg ? "I have nothing written down about that." : "My memory is still empty.";
          return "I remember that: " + found.map(m => toSecondPerson(m.content.replace(/\.$/, ""))).join("; ") + ".";
        } },
      { name: "forget", patterns: [/^forget(?: about| that)?\s+(?<arg>.+)$/i],
        run(arg) {
          const found = memory.search(arg, 1).hits;
          if (!found.length) return "I found no such entry in my memory.";
          memory.remove(found[0].row.id);
          return "Forgotten: " + toSecondPerson(found[0].row.content.replace(/\.$/, "")) + ".";
        } }
    ];
    return {
      list: tools,
      /** Regex router: the first tool whose pattern matches wins. */
      route(text) {
        const clean = text.trim().replace(/[?!.]+$/, "").trim();
        for (const t of tools) for (const re of t.patterns) {
          const m = clean.match(re);
          if (!m) continue;
          const arg = ((m.groups && m.groups.arg) || "").trim();
          if (t.accepts && !t.accepts(arg)) continue;
          return { name: t.name, arg, pattern: re.source };
        }
        return null;
      },
      run(call) { return tools.find(t => t.name === call.name).run(call.arg); }
    };
  }

  /* ------------------------------------------------------------------ assistant.py */
  const SYSTEM_PROMPT =
    "Your name is " + ASSISTANT_NAME + ". Your role: " + ROLE + ". You speak formally and respectfully. " +
    "You answer briefly and to the point (usually 1-3 sentences), without lists or markdown, because the answer is read aloud. " +
    "You take facts only from the given fragments and from what you know about the user; do not add facts from your own knowledge. " +
    "You only reason: you combine, compare and calculate the given facts. " +
    "Answer only the question asked, in your own words; do not copy the fragments. Do not greet again during the conversation.";
  const SMALLTALK = new Set(["hello", "hi", "hey", "good morning", "good evening", "good night", "thanks", "thank you",
    "ok", "okay", "great", "nice", "cool", "fine", "how are you", "what's up", "test", "bye"]);
  const TASK_PREFIXES = ["write", "make up", "compose", "translate", "summarize", "summarise", "correct", "rephrase", "suggest", "tell me a joke", "tell a joke"];
  const NAME_WORDS = new Set(["name", "called"]);
  const INTRO_PHRASES = ["who are you", "introduce yourself", "who am i"];
  const YOU_WORDS = new Set(["you", "your", "yours", "yourself"]);
  const ME_WORDS = new Set(["i", "my", "me", "mine", "am"]);
  const GOODBYE_PATTERNS = [/\bgo to sleep\b/, /\byou can rest\b/, /\b(that's all|that is all|that will be all|we're done|we are done|enough for today)\b/, /^(good night|goodbye|bye|see you|see you tomorrow)$/];
  const INFO_VERBS = new Set(["tell", "explain", "describe", "list", "remind", "check", "find", "name"]);
  const WH_WORDS = new Set(["what", "what's", "who", "whom", "whose", "where", "where's", "when", "why", "how", "which"]);
  const AUX_FIRST = new Set(["is", "are", "do", "does", "did", "can", "could", "will", "would", "was", "were", "have", "has", "should"]);
  const CANCEL_WORDS = new Set(["never mind", "nevermind", "forget it", "leave it", "cancel", "skip", "skip it", "nothing", "no", "i don't know", "i dont know", "don't know"]);

  const clean = text => text.toLowerCase().replace(/[?!.,;:]+/g, "").trim();
  function isSmalltalk(text) {
    const c = clean(text);
    if (SMALLTALK.has(c)) return true;
    const w = c.split(/\s+/);
    return w.length <= 3 && w.some(x => SMALLTALK.has(x));
  }
  /** A question or a request for information. Speech has no "?", so the first words decide. */
  function isQuestion(text) {
    if (text.trim().endsWith("?")) return true;
    const w = clean(text).split(/\s+/).filter(Boolean);
    return w.length > 0 && (INFO_VERBS.has(w[0]) || AUX_FIRST.has(w[0]) || w.slice(0, 3).some(x => WH_WORDS.has(x)));
  }
  function isGoodbye(text) {
    const c = clean(text);
    if (/^(is|why|when|how) /.test(c)) return false; // "Is that all?" is a question
    return GOODBYE_PATTERNS.some(re => re.test(c));
  }
  const isTask = text => TASK_PREFIXES.some(p => clean(text).startsWith(p));
  function nameQuestion(text) {
    const c = clean(text), w = new Set(c.split(/\s+/));
    if (![...w].some(x => NAME_WORDS.has(x)) && !INTRO_PHRASES.some(p => c.includes(p))) return null;
    const you = [...w].some(x => YOU_WORDS.has(x)), me = [...w].some(x => ME_WORDS.has(x));
    if (you && !me) return "assistant";
    if (me && !you) return "user";
    return null;
  }
  const plain = text => text.replace(/^\s*#{1,6}\s*/gm, "").replace(/(\*\*|__|`)/g, "").replace(/\s+/g, " ").trim();

  /** One conversation. ask() returns the reply plus a trace of every decision, for the pipeline panel. */
  function makeAssistant() {
    const memory = makeMemory();
    const tools = makeTools(memory);
    let history = [], pending = null;

    const prefix = () => {
      const m = [
        { role: "system", content: SYSTEM_PROMPT, part: "system" },
        { role: "user", content: "Who are you?", part: "persona" },
        { role: "assistant", content: INTRODUCTION, part: "persona" }
      ];
      const profile = memory.profile(2);
      if (profile.length) m.push(
        { role: "user", content: "What do you know about me?", part: "profile" },
        { role: "assistant", content: "I know that: " + formatMemories(profile), part: "profile" });
      return m;
    };
    const recalledTurn = mems => {
      const ids = new Set(memory.profile(2).map(m => m.id));
      mems = mems.filter(m => !ids.has(m.id));
      if (!mems.length) return [];
      return [{ role: "user", content: "What do you remember about this?", part: "recall" },
        { role: "assistant", content: "I remember that: " + formatMemories(mems), part: "recall" }];
    };
    const buildMessages = (content, mems) =>
      prefix().concat(history.slice(-2 * HISTORY_TURNS).map(x => ({ ...x, part: "history" })), recalledTurn(mems || []), [{ role: "user", content, part: "question" }]);

    /** Joins document passages until the context token budget is used up (~4 characters per token). */
    function fitContext(passages) {
      const kept = [];
      let used = 0;
      for (const p of passages) {
        const block = "[" + p.file + "] " + plain(p.text);
        const cost = Math.floor(block.length / 4);
        if (used + cost > CONTEXT_BUDGET) break;
        kept.push(block); used += cost;
      }
      return { text: kept.join("\n\n"), tokens: used };
    }

    function generate(question, content, maxTokens, mems, reply) {
      const messages = buildMessages(content, mems);
      history.push({ role: "user", content: question }, { role: "assistant", content: reply });
      history = history.slice(-2 * HISTORY_TURNS);
      return { messages, maxTokens };
    }

    function simulatedAnswer(question, mems, passages) {
      const terms = keyWords(question).map(fold);
      const score = s => { const ws = words(fold(s)); return terms.filter(a => ws.some(w => sameWord(w, a))).length; };
      if (mems.length) {
        const best = mems.slice().sort((a, b) => score(b.content) - score(a.content))[0];
        const fact = best.content.includes(" — ") ? best.content.split(" — ").slice(1).join(" — ") : best.content;
        return "From my notes: " + toSecondPerson(fact).replace(/^./, c => c.toLowerCase()).replace(/\.?$/, ".");
      }
      const sentences = passages.flatMap(p => p.text.split(/(?<=[.!?;])\s+/));
      return sentences.sort((a, b) => score(b) - score(a))[0].replace(/;$/, ".");
    }

    function stripAddress(text) {
      const s = text.replace(/^(?:hey\s+)?melchior\b[\s,!.]*/i, "").replace(/[\s,]+melchior([?!.]*)$/i, "$1");
      return s.trim() || text;
    }

    function answerFromFacts(question, t) {
      const searchQ = question.replace(/^[\s,.:?]+|[\s,.:?]+$/g, "") || question;
      let ms = memory.search(searchQ), kb = kbSearch(searchQ);
      if (!ms.hits.length && !kb.kept.length && history.length) {
        // Follow-up ("and when does it close?"): search again together with the previous question
        t.followUp = history[history.length - 2].content;
        ms = memory.search(t.followUp + " " + searchQ); kb = kbSearch(t.followUp + " " + searchQ);
      }
      let memories = ms.hits.map(x => x.row), passages = kb.kept.map(x => x.row);
      t.retrieval = { memTerms: ms.terms, memExtraCut: ms.extraCut, kbTerms: kb.terms, memHits: ms.hits, kept: kb.kept, cut: kb.cut, memoryOnly: false };
      if (passages.length && memories.length && coverage(searchQ, memories.map(m => m.content)).value >= MIN_COVERAGE) {
        // The user's own facts answer it: documents would only distract a small model
        t.retrieval.memoryOnly = true;
        passages = [];
      }
      const cov = coverage(searchQ, memories.map(m => m.content).concat(passages.map(p => p.text)));
      t.coverage = cov;
      if (cov.value < MIN_COVERAGE && !isTask(question)) {
        if (!isQuestion(question)) {
          // A statement asks for no fact: just a short reply
          t.gate = "statement";
          const reply = "Very well.";
          t.llm = generate(question, question, MAX_TOKENS_CHAT, [], reply);
          return { text: reply, kind: "chat" };
        }
        t.gate = "closed";
        pending = question;
        return { text: "I don't have that in my notes. Please tell me, and I will remember.", kind: "ask" };
      }
      t.gate = "open";
      let content = question;
      const ctx = fitContext(passages);
      t.contextTokens = ctx.tokens;
      if (ctx.text) content = "Document fragments:\n" + ctx.text + "\n\nAnswer briefly: " + question;
      const reply = simulatedAnswer(searchQ, memories, passages);
      t.llm = generate(question, content, MAX_TOKENS, memories, reply);
      return { text: reply, kind: "rag" };
    }

    function handlePending(text, t) {
      const question = pending;
      pending = null;
      t.pendingQuestion = question;
      const c = clean(text);
      if (CANCEL_WORDS.has(c)) { t.pending = "cancel"; return { text: "Very well, let us leave it.", kind: "learned" }; }
      // A new question or command is not an answer: forget the pending question
      if (isQuestion(text) || isTask(text) || isSmalltalk(text) || memory.matchFact(text) || tools.route(text)) { t.pending = "skip"; return null; }
      if (nameQuestion(question) === "user") {
        const name = text.trim().replace(/\.$/, "").replace(/^(?:my name is|i am|i'm|it's|call me)\s+/i, "");
        const saved = memory.extractAndSave("My name is " + name);
        t.pending = "name"; t.stored = saved && memory.rows().find(r => r.id === saved.id);
        return { text: "Nice to meet you, " + name + ". I will remember.", kind: "learned" };
      }
      const id = memory.learn(question, text);
      t.pending = "learn"; t.stored = memory.rows().find(r => r.id === id);
      return { text: "Thank you, I have noted: " + toSecondPerson(question.replace(/\?+$/, "") + " — " + text.replace(/\.+$/, "")) + ".", kind: "learned" };
    }

    function ask(raw) {
      const question = stripAddress(raw.trim());
      const t = { question, steps: [], hit: null };
      const finish = (step, res) => { t.hit = step; return Object.assign(res, { trace: t }); };

      if (isGoodbye(question)) { pending = null; return finish("goodbye", { text: "At your service. When you need me, just call.", kind: "goodbye" }); }
      if (pending) {
        const r = handlePending(question, t);
        if (r) return finish("pending", r);
      }
      const saved = memory.extractAndSave(question);
      if (saved) { t.stored = memory.rows().find(r => r.id === saved.id); return finish("fact", { text: "Fine, I will remember: " + toSecondPerson(saved.fact) + ".", kind: "memory" }); }

      const whose = nameQuestion(question);
      if (whose) {
        t.whose = whose;
        if (whose === "assistant") {
          const text = INTRO_PHRASES.some(p => clean(question).includes(p)) ? INTRODUCTION + " At your service." : "My name is " + ASSISTANT_NAME + ". At your service.";
          return finish("name", { text, kind: "persona" });
        }
        let profile = memory.profile(5);
        if (!clean(question).includes("who am i")) profile = profile.filter(m => m.key === "User name");
        if (profile.length) return finish("name", { text: formatMemories(profile.slice(0, 3)), kind: "memory" });
        pending = question;
        return finish("name", { text: "I don't know your name yet. How should I address you?", kind: "ask" });
      }

      const smalltalk = isSmalltalk(question);
      const call = tools.route(question);
      if (call) { t.tool = call; return finish("tool", { text: tools.run(call), kind: "tool" }); }

      if (smalltalk) {
        const c = clean(question);
        const reply = /thank/.test(c) ? "You are most welcome." : /^(hello|hi|hey|good morning|good evening)/.test(c) ? "Good evening. How may I help?" : "Very well.";
        t.llm = generate(question, question, MAX_TOKENS_CHAT, [], reply);
        return finish("smalltalk", { text: reply, kind: "chat" });
      }
      return finish("knowledge", answerFromFacts(question, t));
    }

    return {
      ask, memory,
      get pending() { return pending; },
      reset() { memory.reset(); history = []; pending = null; }
    };
  }

  /* ------------------------------------------------------------------ view */
  const STEPS = [
    ["goodbye", "Goodbye?", "\"go to sleep\", \"that's all\" end the conversation"],
    ["pending", "Answer to \"tell me\"?", "the last turn asked the user for a missing fact"],
    ["fact", "Explicit fact", "\"Remember that ...\", \"My name is ...\" saved without the LLM"],
    ["name", "Name question", "answered in code, never by the model"],
    ["tool", "Tool router", "regex: time, calculator, recall, forget"],
    ["smalltalk", "Small talk", "short LLM reply, no retrieval"],
    ["knowledge", "Knowledge question", "retrieval, then the fact gate"]
  ];
  const KIND_LABEL = { rag: "LLM called (simulated)", chat: "LLM called (simulated)", ask: "LLM not called", memory: "memory, no LLM", tool: "tool, no LLM", learned: "learned, no LLM", persona: "code, no LLM", goodbye: "no LLM" };

  PortfolioDemos.register("melchior", {
    title: "Inside Melchior: the fact gate",
    note: "The decision pipeline of my Raspberry Pi assistant, ported to JavaScript and run on a made-up castle caretaker's notes. Click the suggested prompts in order: a covered question, a missing fact, teaching it, asking again, a remembered fact and a tool. The real assistant speaks Polish and runs Bielik 1.5B locally; here the language model is simulated, everything before it is the real logic.",

    mount(host, kit) {
      const h = kit.h, C = kit.colors();
      const motion = !kit.reducedMotion();
      const A = makeAssistant();

      const style = h("style", {}, `
.d-melchior .mc-wrap{display:grid;grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);gap:0;align-items:stretch}
.d-melchior .mc-col{min-width:0;display:flex;flex-direction:column}
.d-melchior .mc-col+.mc-col{border-left:1px solid var(--stone-3)}
.d-melchior .mc-cap{font-family:var(--font-pixel);font-size:.66rem;color:var(--ash);text-transform:uppercase;letter-spacing:.06em;padding:.4rem .7rem;border-bottom:1px solid var(--stone-3);display:flex;justify-content:space-between;gap:.5rem}
.d-melchior .mc-cap b{color:var(--gold);font-weight:400}
.d-melchior .mc-log{height:340px;overflow-y:auto;padding:.7rem;display:flex;flex-direction:column;gap:.55rem;scroll-behavior:smooth}
.d-melchior .mc-msg{max-width:88%;padding:.45rem .7rem;border:1px solid var(--stone-3);font-size:.93rem;line-height:1.4;overflow-wrap:anywhere}
.d-melchior .mc-msg--user{align-self:flex-end;background:var(--stone-2);color:var(--parchment)}
.d-melchior .mc-msg--bot{align-self:flex-start;background:var(--night-2);color:var(--parchment);border-color:var(--gold)}
.d-melchior .mc-msg small{display:block;margin-top:.25rem;font-family:var(--font-pixel);font-size:.58rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ash)}
.d-melchior .mc-msg small.is-llm{color:var(--amber)}
.d-melchior .mc-msg small.is-free{color:var(--teal)}
.d-melchior .mc-sim{display:block;margin-top:.3rem;font-size:.75rem;font-style:italic;color:var(--amber)}
.d-melchior .mc-sugg{display:flex;flex-wrap:wrap;gap:.4rem;padding:.6rem .7rem;border-top:1px solid var(--stone-3)}
.d-melchior .mc-sugg button{font:inherit;font-size:.8rem;color:var(--parchment-dim);background:var(--night-0);border:1px solid var(--stone-3);border-radius:var(--radius);padding:.3em .6em;cursor:pointer;text-align:left}
.d-melchior .mc-sugg button i{font-style:normal;font-family:var(--font-pixel);font-size:.62rem;color:var(--gold);margin-right:.4em}
.d-melchior .mc-sugg button:hover,.d-melchior .mc-sugg button:focus-visible{border-color:var(--gold);color:var(--parchment)}
.d-melchior .mc-sugg button.is-next{border-color:var(--gold);color:var(--parchment);box-shadow:0 0 10px -3px var(--gold)}
.d-melchior .mc-sugg button.is-done{opacity:.6}
.d-melchior .mc-form{display:flex;gap:.5rem;padding:0 .7rem .7rem}
.d-melchior .mc-form input{flex:1;min-width:0;font:inherit;font-size:.92rem;color:var(--parchment);background:var(--night-0);border:var(--frame);padding:.45em .6em;border-radius:var(--radius)}
.d-melchior .mc-mem{border-top:1px solid var(--stone-3);padding:.5rem .7rem .7rem;font-size:.8rem;color:var(--parchment-dim)}
.d-melchior .mc-mem summary{cursor:pointer;font-family:var(--font-pixel);font-size:.62rem;text-transform:uppercase;color:var(--ash);letter-spacing:.05em;padding:.2rem 0}
.d-melchior .mc-mem ul{list-style:none;margin:.3rem 0 0;padding:0;display:flex;flex-direction:column;gap:.25rem}
.d-melchior .mc-mem li{font-family:var(--font-mono);font-size:.72rem;line-height:1.4;overflow-wrap:anywhere}
.d-melchior .mc-mem li em{font-style:normal;color:var(--ash)}
.d-melchior .mc-mem li.is-new{color:var(--teal)}
.d-melchior .mc-pipe{padding:.7rem;display:flex;flex-direction:column;gap:.7rem;font-size:.85rem;min-width:0}
.d-melchior .mc-steps{list-style:none;margin:0;padding:0;display:grid;gap:.2rem}
.d-melchior .mc-step{display:grid;grid-template-columns:1.2rem minmax(0,1fr) auto;gap:.5rem;align-items:baseline;padding:.2rem .5rem;border:1px solid var(--stone-2);background:var(--night-0);color:var(--ash);transition:border-color .25s,background .25s,color .25s,box-shadow .25s;transition-delay:var(--d,0s)}
.d-melchior .mc-step>span:first-child{font-family:var(--font-pixel);font-size:.62rem;color:var(--stone-3)}
.d-melchior .mc-step b{font-weight:600;font-size:.84rem}
.d-melchior .mc-step span.mc-rule{font-size:.72rem;color:var(--ash);margin-left:.5em}
.d-melchior .mc-step em{font-style:normal;font-family:var(--font-pixel);font-size:.58rem;text-transform:uppercase;white-space:nowrap}
.d-melchior .mc-step.is-pass{color:var(--parchment-dim)}
.d-melchior .mc-step.is-hit{border-color:var(--gold);background:rgba(201,162,74,.1);color:var(--parchment);box-shadow:0 0 12px -4px var(--gold)}
.d-melchior .mc-step.is-hit em{color:var(--gold-bright)}
.d-melchior .mc-step.is-hit>span:first-child{color:var(--gold)}
.d-melchior .mc-sec{border:1px solid var(--stone-3);background:var(--night-0);min-width:0;animation:mc-in .35s both}
.d-melchior .mc-sec h4{margin:0;font-family:var(--font-pixel);font-weight:400;font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ash);padding:.35rem .6rem;border-bottom:1px solid var(--stone-2);display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap}
.d-melchior .mc-sec h4 code{font-family:var(--font-mono);text-transform:none;letter-spacing:0;color:var(--gold-bright);font-size:.7rem;overflow-wrap:anywhere}
.d-melchior .mc-body{padding:.45rem .6rem;display:flex;flex-direction:column;gap:.3rem}
.d-melchior .mc-hit{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.6rem;font-size:.8rem;line-height:1.35;color:var(--parchment-dim)}
.d-melchior .mc-hit span{overflow-wrap:anywhere}
.d-melchior .mc-hit span i{font-style:normal;color:var(--ash);font-family:var(--font-mono);font-size:.7rem}
.d-melchior .mc-hit code{font-family:var(--font-mono);font-size:.72rem;color:var(--gold-bright);white-space:nowrap}
.d-melchior .mc-hit.is-cut{opacity:.45}
.d-melchior .mc-hit.is-cut code{color:var(--ash)}
.d-melchior .mc-none{color:var(--ash);font-style:italic;font-size:.8rem}
.d-melchior .mc-terms{display:flex;flex-wrap:wrap;gap:.35rem}
.d-melchior .mc-term{font-family:var(--font-mono);font-size:.76rem;padding:.12em .5em;border:1px solid currentColor;border-radius:var(--radius)}
.d-melchior .mc-bar{position:relative;height:14px;background:var(--stone-1);border:1px solid var(--stone-3);margin:.3rem 0 .1rem}
.d-melchior .mc-bar i{position:absolute;left:0;top:0;bottom:0;transition:width .45s}
.d-melchior .mc-bar b{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--parchment);left:60%}
.d-melchior .mc-barlbl{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:.72rem;color:var(--ash)}
.d-melchior .mc-gate{font-family:var(--font-pixel);font-size:.82rem;letter-spacing:.06em;padding:.45rem .6rem;border:1px solid currentColor;display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:center}
.d-melchior .mc-gate span{font-family:var(--font-body);font-size:.8rem;letter-spacing:0;color:var(--parchment-dim)}
.d-melchior .mc-prompt{display:flex;flex-direction:column;gap:.3rem}
.d-melchior .mc-group{border:1px dashed var(--stone-3);padding:.35rem;display:flex;flex-direction:column;gap:.3rem}
.d-melchior .mc-group.is-cached{border-color:var(--gold)}
.d-melchior .mc-group>p{margin:0;font-family:var(--font-pixel);font-size:.58rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ash)}
.d-melchior .mc-group.is-cached>p{color:var(--gold)}
.d-melchior .mc-block{font-family:var(--font-mono);font-size:.72rem;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--parchment-dim);background:var(--night-1);border-left:3px solid var(--stone-3);padding:.3rem .5rem}
.d-melchior .mc-block b{color:var(--parchment);font-weight:600}
.d-melchior .mc-block.r-system{border-left-color:var(--blood-bright)}
.d-melchior .mc-block.r-user{border-left-color:var(--moon)}
.d-melchior .mc-block.r-assistant{border-left-color:var(--gold)}
.d-melchior .mc-params{font-family:var(--font-mono);font-size:.7rem;color:var(--ash);overflow-wrap:anywhere}
.d-melchior .mc-idle{color:var(--ash);font-style:italic;padding:.4rem .2rem}
@keyframes mc-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.d-melchior .mc-sec{animation:none}.d-melchior .mc-step,.d-melchior .mc-bar i{transition:none}.d-melchior .mc-log{scroll-behavior:auto}}
@media (max-width:860px){.d-melchior .mc-wrap{grid-template-columns:minmax(0,1fr)}.d-melchior .mc-col+.mc-col{border-left:0;border-top:1px solid var(--stone-3)}.d-melchior .mc-log{height:300px}}
@media (max-width:420px){.d-melchior .mc-step{grid-template-columns:1.2rem minmax(0,1fr) auto;gap:.35rem}.d-melchior .mc-step span.mc-rule{display:none}.d-melchior .mc-msg{max-width:94%}}
`);
      host.append(style);

      const frame = kit.frame(host);
      frame.root.classList.add("d-melchior");

      /* left: chat */
      const log = h("div", { class: "mc-log", role: "log", "aria-live": "polite", "aria-label": "Conversation with Melchior" });
      const sugg = h("div", { class: "mc-sugg", "aria-label": "Suggested prompts" });
      const input = h("input", { type: "text", placeholder: "Ask Melchior something...", "aria-label": "Message to Melchior", maxlength: "160" });
      const form = h("form", { class: "mc-form" }, input,
        h("button", { type: "submit", class: "btn btn--small btn--blood" }, "Send"));
      const memList = h("ul", {});
      const kbList = h("ul", {}, DOCS.map(d => h("li", {}, h("em", {}, d.file + " "), d.text)));
      const memBox = h("div", { class: "mc-mem" },
        h("details", { open: true }, h("summary", {}, "Memories (SQLite table memories)"), memList),
        h("details", {}, h("summary", {}, "Knowledge base (" + DOCS.length + " made-up notes)"), kbList));
      const resetBtn = h("button", { type: "button", class: "btn btn--small btn--ghost" }, "Reset");
      const left = h("div", { class: "mc-col" },
        h("div", { class: "mc-cap" }, h("span", {}, h("b", {}, "Melchior"), " · text mode"), h("span", {}, "English demo · real one speaks Polish")),
        log, sugg, form, memBox);
      /* right: pipeline */
      const steps = {};
      const stepList = h("ol", { class: "mc-steps" }, STEPS.map(([id, name, rule], i) => {
        const em = h("em", {}, "");
        const li = h("li", { class: "mc-step", style: "--d:" + (motion ? i * 0.06 : 0) + "s" },
          h("span", {}, String(i + 1)), h("span", {}, h("b", {}, name), h("span", { class: "mc-rule" }, rule)), em);
        steps[id] = { li, em };
        return li;
      }));
      const details = h("div", { class: "mc-pipe", style: "padding-top:0" });
      const turnLbl = h("span", {}, "waiting");
      const right = h("div", { class: "mc-col" },
        h("div", { class: "mc-cap" }, h("span", {}, h("b", {}, "Pipeline"), " · first match wins"), turnLbl),
        h("div", { class: "mc-pipe" }, stepList), details);
      frame.stage.append(h("div", { class: "mc-wrap" }, left, right));
      frame.controls.append(resetBtn, h("span", { class: "mc-none" }, "Reset restores the starting notes and memories."));

      /* suggestions */
      let nextSugg = 0;
      const suggBtns = SUGGESTIONS.map((s, i) => {
        const b = h("button", { type: "button", title: "Send this prompt" }, h("i", {}, String(i + 1)), s);
        b.addEventListener("click", () => { nextSugg = Math.max(nextSugg, i + 1); send(s); });
        sugg.append(b);
        return b;
      });
      const markSugg = () => suggBtns.forEach((b, i) => { b.classList.toggle("is-done", i < nextSugg); b.classList.toggle("is-next", i === nextSugg); });

      let lastNewId = null, turn = 0;
      function renderMemories() {
        memList.replaceChildren(...A.memory.rows().map(m => h("li", { class: m.id === lastNewId ? "is-new" : "" },
          h("em", {}, "#" + m.id + " " + m.category + " · "), m.content)));
      }
      function addMsg(who, text, tag, sim) {
        const tagCls = tag ? (/LLM called/.test(tag) ? "is-llm" : "is-free") : "";
        log.append(h("div", { class: "mc-msg mc-msg--" + who }, text,
          sim ? h("span", { class: "mc-sim" }, "Simulated - in the real assistant Bielik 1.5B writes this sentence from these facts.") : null,
          tag ? h("small", { class: tagCls }, tag) : null));
        log.scrollTop = log.scrollHeight;
      }

      /* pipeline rendering */
      const sec = (title, extra, ...body) => h("section", { class: "mc-sec" }, h("h4", {}, h("span", {}, title), extra || null), h("div", { class: "mc-body" }, body));
      const hitRow = (text, file, score, cut) => h("div", { class: "mc-hit" + (cut ? " is-cut" : "") }, h("span", {}, file ? h("i", {}, file + " ") : null, text), h("code", {}, score.toFixed(2)));

      function renderSteps(t) {
        const hitIdx = STEPS.findIndex(s => s[0] === t.hit);
        STEPS.forEach(([id], i) => {
          const { li, em } = steps[id];
          li.classList.remove("is-pass", "is-hit");
          void li.offsetWidth;
          if (i < hitIdx) { li.classList.add("is-pass"); em.textContent = id === "pending" && t.pending === "skip" ? "new question" : "no"; }
          else if (i === hitIdx) { li.classList.add("is-hit"); em.textContent = hitLabel(t); }
          else em.textContent = "";
        });
      }
      function hitLabel(t) {
        if (t.hit === "pending") return t.pending === "cancel" ? "cancelled" : "learned";
        if (t.hit === "tool") return t.tool.name;
        if (t.hit === "name") return t.whose === "assistant" ? "assistant" : "user";
        if (t.hit === "knowledge") return t.gate === "open" ? "gate open" : t.gate === "closed" ? "gate closed" : "statement";
        return "match";
      }

      function renderPrompt(llm) {
        const block = m => h("div", { class: "mc-block r-" + m.role }, h("b", {}, "[" + m.role + "] "), m.content);
        const groups = [
          ["system", "persona", "profile"], ["history"], ["recall"], ["question"]
        ];
        const labels = [
          "Static prefix · cached by llama.cpp (KV prefix reuse): system, persona example turn, profile turn",
          "History · " + (llm.messages.filter(m => m.part === "history").length / 2) + " of " + HISTORY_TURNS + " turns, bare questions only so the prefix stays cacheable",
          "Recalled memories turn (the assistant's own words, second person)",
          "This turn · user: fragments + question"
        ];
        const out = h("div", { class: "mc-prompt" });
        groups.forEach((parts, gi) => {
          const ms = llm.messages.filter(m => parts.includes(m.part));
          if (!ms.length) return;
          out.append(h("div", { class: "mc-group" + (gi === 0 ? " is-cached" : "") }, h("p", {}, labels[gi]), ms.map(block)));
        });
        out.append(h("div", { class: "mc-params" }, "chat template: ChatML from the GGUF · max_tokens " + llm.maxTokens + " · temperature " + TEMPERATURE + " · stop " + JSON.stringify(STOP_SEQUENCES).replace(/\\\\/g, "\\")));
        return out;
      }

      function renderDetails(t, res) {
        const parts = [];
        if (t.hit === "knowledge" && t.retrieval) {
          const r = t.retrieval;
          const memRows = r.memHits.length ? r.memHits.map(x => hitRow(x.row.content, "#" + x.row.id, x.score)) : [h("div", { class: "mc-none" }, "no memory matches")];
          parts.push(sec("Memories · BM25, top " + MAX_RECALLED + (r.memExtraCut ? (r.memHits.length ? " · looser retry" : " · looser retry too") : ""), h("code", {}, ftsString(r.memTerms) || "(no key terms)"), memRows));
          const kbRows = r.kept.map(x => hitRow(x.row.text, x.row.file, x.score, r.memoryOnly))
            .concat(r.cut.map(x => hitRow(x.row.text, x.row.file, x.score, true)));
          if (r.cut.length) kbRows.push(h("div", { class: "mc-none" }, "dimmed: below 0.4 × best score or beyond top " + TOP_K));
          if (r.memoryOnly) kbRows.push(h("div", { class: "mc-none" }, "dropped: the memories alone cover the question, documents would only distract a small model"));
          if (!kbRows.length) kbRows.push(h("div", { class: "mc-none" }, "no passage matches"));
          parts.push(sec("Passages · SQLite FTS5 BM25, top " + TOP_K, h("code", {}, ftsString(r.kbTerms) || "(no key terms)"), kbRows));
          if (t.followUp) parts.push(sec("Follow-up", null, h("div", { class: "mc-none" }, "nothing found, searched again with the previous question: " + t.followUp)));

          const cov = t.coverage, pct = Math.round(cov.value * 100), ok = cov.value >= MIN_COVERAGE;
          const fill = h("i", { style: "width:0;background:" + (ok ? C.teal : C.bloodBright) });
          parts.push(sec("Coverage · key terms found in the retrieved facts", null,
            cov.terms.length ? h("div", { class: "mc-terms" }, cov.terms.map(x => h("span", { class: "mc-term", style: "color:" + (x.covered ? C.teal : C.bloodBright) }, (x.covered ? "✓ " : "✗ ") + x.word)))
              : h("div", { class: "mc-none" }, "no key terms: coverage counts as 100 %"),
            h("div", { class: "mc-bar", role: "img", "aria-label": "Coverage " + pct + " percent, threshold 60 percent" }, fill, h("b", {})),
            h("div", { class: "mc-barlbl" }, h("span", {}, "coverage " + pct + " %"), h("span", {}, "min_coverage 60 %"))));
          requestAnimationFrame(() => { fill.style.width = Math.max(pct, 1) + "%"; });

          const open = t.gate === "open";
          const gateText = open ? "GATE OPEN" : t.gate === "closed" ? "GATE CLOSED" : "NOT A QUESTION";
          const gateNote = open ? "the LLM may answer, using only these facts (~" + t.contextTokens + " of " + CONTEXT_BUDGET + " context tokens)"
            : t.gate === "closed" ? "the LLM is NOT called: the assistant asks the user and stores the reply with learn()"
              : "a statement asks for no fact: short chat reply, no facts";
          parts.push(h("div", { class: "mc-gate mc-sec", style: "color:" + (open ? C.teal : t.gate === "closed" ? C.bloodBright : C.amber) }, gateText, h("span", {}, gateNote)));
        }
        if (t.hit === "pending" && t.pendingQuestion) {
          parts.push(sec("Pending question", null, h("div", {}, "\"" + t.pendingQuestion + "\""),
            h("div", { class: "mc-none" }, t.pending === "cancel" ? "cancel word: nothing is stored" : t.pending === "name" ? "stored as the user's name (replaces the old one)" : "the reply is stored with learn(question, answer); the question becomes the key, so later questions with the same words find it")));
        }
        if (t.stored) {
          const m = t.stored;
          parts.push(sec("Memory row written · no LLM", null, h("div", { class: "mc-block" },
            "id: " + m.id + "\ncategory: " + m.category + "\nkey_concept: " + m.key + "\ncontent: " + m.content + "\nimportance: " + m.importance + (m.tags ? "\ntags: " + m.tags : ""))));
        }
        if (t.hit === "tool") parts.push(sec("Tool call · no LLM", null, h("div", { class: "mc-block" }, t.tool.name + "(" + JSON.stringify(t.tool.arg) + ")\nmatched /" + t.tool.pattern + "/\n-> " + res.text)));
        if (t.hit === "name") parts.push(sec("Answered in code", null, h("div", { class: "mc-none" }, "With both names in the prompt a 1.5B model swaps them, so \"What is your name?\" and \"What is my name?\" never reach it.")));
        if (t.llm) parts.push(sec("Prompt sent to the LLM · " + t.llm.messages.length + " messages", null, renderPrompt(t.llm)));
        details.replaceChildren(...parts);
      }

      function readout(t, res) {
        const head = "Turn " + turn + " · ";
        let s;
        switch (t.hit) {
          case "knowledge":
            s = "knowledge question · coverage " + Math.round(t.coverage.value * 100) + " % " + (t.coverage.value >= MIN_COVERAGE ? "≥" : "<") + " 60 % → " +
              (t.gate === "open" ? "gate OPEN → LLM called with " + t.llm.messages.length + " messages (answer simulated)" : t.gate === "closed" ? "gate CLOSED → LLM not called, question kept as pending" : "statement → short chat reply");
            break;
          case "pending": s = t.pending === "cancel" ? "reply to \"tell me\" was a cancel word → nothing stored" : "reply to \"tell me\" → stored in memory without the LLM"; break;
          case "fact": s = "explicit fact → saved to memory without the LLM"; break;
          case "name": s = "name question → answered in code (" + t.whose + ")"; break;
          case "tool": s = "tool router → " + t.tool.name + " → no LLM call"; break;
          case "smalltalk": s = "small talk → short LLM reply (max_tokens " + MAX_TOKENS_CHAT + "), no retrieval"; break;
          default: s = "goodbye → conversation ended, pending question cleared";
        }
        frame.readout.textContent = head + s + (A.pending ? "\nPending: \"" + A.pending + "\" - the next message may be its answer (cancel: \"never mind\")" : "");
      }

      function send(text) {
        text = String(text || "").trim();
        if (!text) return;
        turn++;
        addMsg("user", text);
        const before = A.memory.rows().length ? Math.max(...A.memory.rows().map(m => m.id)) : 0;
        const res = A.ask(text);
        const newest = A.memory.rows().filter(m => m.id > before);
        lastNewId = newest.length ? newest[newest.length - 1].id : null;
        addMsg("bot", res.text, KIND_LABEL[res.kind], res.kind === "rag" || res.kind === "chat");
        turnLbl.textContent = "turn " + turn;
        renderSteps(res.trace);
        renderDetails(res.trace, res);
        renderMemories();
        readout(res.trace, res);
        markSugg();
      }

      function idle() {
        log.replaceChildren();
        addMsg("bot", "Good evening. I am Melchior, the castle's voice assistant. Ask me about the castle.");
        details.replaceChildren(h("p", { class: "mc-idle" }, "Send a message: each step lights up as Melchior decides, from the cheap checks in code to the fact gate in front of the LLM."));
        STEPS.forEach(([id]) => { steps[id].li.classList.remove("is-pass", "is-hit"); steps[id].em.textContent = ""; });
        turnLbl.textContent = "waiting";
        frame.readout.textContent = "Knowledge base: " + DOCS.length + " notes · memories: " + A.memory.rows().length + " · min_coverage " + MIN_COVERAGE + " · top_k " + TOP_K + " · context budget " + CONTEXT_BUDGET + " tokens";
        lastNewId = null; turn = 0; nextSugg = 0;
        renderMemories(); markSugg();
      }

      form.addEventListener("submit", e => { e.preventDefault(); const v = input.value; input.value = ""; send(v); });
      resetBtn.addEventListener("click", () => { A.reset(); idle(); });
      idle();

      return () => { style.remove(); };
    }
  });

  /* exposed for tests in the browser console */
  PortfolioDemos.melchiorInternals = { stem, keyWords, coverage, sameWord, toExpression, safeEval, makeAssistant };
})();
