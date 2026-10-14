/* Minimal syntax highlighter for the code excerpts (Python, C, C++, Arduino, JavaScript, C#). */
(function () {
  "use strict";

  const KEYWORDS = {
    python: "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self",
    c: "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while uint8_t uint16_t uint32_t int8_t int16_t int32_t bool true false NULL",
    cpp: "auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while std vector string",
    js: "async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof undefined var void while yield",
    csharp: "abstract as base bool break case catch char class const continue decimal default do double else enum false float for foreach if int interface internal is long namespace new null object override private protected public readonly return static string struct switch this throw true try using var virtual void while"
  };
  KEYWORDS.arduino = KEYWORDS.cpp + " HIGH LOW INPUT OUTPUT INPUT_PULLUP setup loop";

  const ALIASES = { py: "python", ino: "arduino", "c++": "cpp", h: "c", javascript: "js", cs: "csharp" };

  function escape(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function highlight(code, language) {
    const lang = ALIASES[language] || language || "text";
    const kw = new Set((KEYWORDS[lang] || "").split(" "));
    const hash = lang === "python";
    const rules = [
      ["c", hash ? /#[^\n]*/y : /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
      ["s", hash ? /("""[\s\S]*?"""|'''[\s\S]*?'''|[rbfu]?"(?:\\.|[^"\\\n])*"|[rbfu]?'(?:\\.|[^'\\\n])*')/y : /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y],
      ["d", hash ? /@[\w.]+/y : /#\s*\w+/y],
      ["n", /\b(?:0x[\da-fA-F]+|\d+\.?\d*(?:e[+-]?\d+)?[fFuUlL]*)\b/y],
      ["w", /[A-Za-z_]\w*/y],
      ["o", /\s+|[^\sA-Za-z_\d"'`#/@]+|./y]
    ];
    let out = "", i = 0;
    while (i < code.length) {
      let matched = false;
      for (const [type, re] of rules) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (!m || !m[0]) continue;
        const text = escape(m[0]);
        if (type === "w") {
          const isCall = /^\s*\(/.test(code.slice(i + m[0].length, i + m[0].length + 3));
          out += kw.has(m[0]) ? `<span class="tok-k">${text}</span>` : isCall ? `<span class="tok-f">${text}</span>` : text;
        } else if (type === "o") out += text;
        else out += `<span class="tok-${type}">${text}</span>`;
        i += m[0].length;
        matched = true;
        break;
      }
      if (!matched) { out += escape(code[i]); i++; }
    }
    return out;
  }

  window.PORTFOLIO = window.PORTFOLIO || {};
  window.PORTFOLIO.highlight = highlight;
})();
