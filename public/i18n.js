/* MOONKATTY AI STUDIO — i18n engine. Source strings are Russian (default UI language);
   translations for EN / UK live in i18n-dict.js (exact phrases + regex patterns). */
(function () {
  const D = window.I18N_DICT || { en: {}, uk: {}, patterns: [] };
  const CYR = /[А-Яа-яЁёІіЇїЄєҐґ]/;
  let LANG = localStorage.getItem('mk-lang') || 'ru';
  const miss = new Set();
  function tr(s) {
    if (LANG === 'ru' || s == null) return s;
    const str = String(s); const m = str.match(/^(\s*)([\s\S]*?)(\s*)$/); const core = m[2];
    if (!core || !CYR.test(core)) return str;
    const exact = D[LANG][core]; if (exact != null) return m[1] + exact + m[3];
    for (const [re, rep] of D.patterns) { const r = new RegExp('^' + re + '$', 's'); const mm = core.match(r);
      if (mm && rep[LANG] != null) { const out = rep[LANG].replace(/\$(\d)/g, (_, i) => tr(mm[+i] || '')); return m[1] + out + m[3]; } }
    miss.add(core); return str;
  }
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function translateNode(root) {
    if (LANG === 'ru' || !root) return;
    if (root.nodeType === 3) { if (CYR.test(root.nodeValue) && !root.parentElement?.closest('[data-notr],textarea,script,style')) { const t = tr(root.nodeValue); if (t !== root.nodeValue) root.nodeValue = t; } return; }
    if (root.nodeType !== 1 || root.closest?.('[data-notr]')) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode); nodes.forEach(translateNode);
    const els = [root, ...root.querySelectorAll('*')];
    for (const el of els) for (const a of ATTRS) { const v = el.getAttribute(a); if (v && CYR.test(v) && !el.closest('[data-notr]')) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
  }
  let obs;
  function start() {
    document.documentElement.lang = LANG === 'uk' ? 'uk' : LANG;
    translateNode(document.body);
    obs = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') translateNode(m.target); else m.addedNodes.forEach(translateNode); if (m.type === 'attributes') translateNode(m.target); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  window.i18n = {
    tr, start, get lang() { return LANG }, miss,
    locale() { return LANG === 'en' ? 'en-GB' : LANG === 'uk' ? 'uk-UA' : 'ru-RU'; },
    set(l) { localStorage.setItem('mk-lang', l); location.reload(); }
  };
})();
