#!/usr/bin/env node
// Parses the Homebrewery source of the BtP rules into a JSON section tree.
//
//   node scripts/parse-rules.mjs <rules.md> <out.json>
//
// Each heading becomes a node with its own body rendered to HTML, plus any
// `**Key** :: value` fields, an italic subtitle line (spell/maneuver type),
// tables, and the `< lvl N >` facet level. Commented-out (unreleased) content
// is dropped. Attribute/AP icons ($[VIG] etc.) become `{VIG}` tokens in plain
// text and <span class="ic ic-VIG"> in HTML.
import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const [, , src = 'rules/BtP-Alpha-Rules.md', out = 'src/content/rules.json'] = process.argv;
const ICONS = ['VIG', 'AGI', 'PER', 'INT', 'PRS', 'AP', 'SL'];

marked.setOptions({ gfm: true, breaks: false });

function preprocess(text) {
  text = text.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^# Beyond the Prism\s*$/.test(l));
  const outLines = [];
  for (let raw of lines.slice(start)) {
    let l = raw.replace(/\s+$/, '');
    const t = l.trim();
    if (t.startsWith('![')) continue;
    if (t.includes('{{pageNumber')) continue;
    if (/^\\(page|pag|column)\b/.test(t)) continue;
    if (/^:+$/.test(t)) { outLines.push(''); continue; }
    if (t.startsWith('{{') && !t.includes('}}')) { outLines.push(''); continue; }
    if (t === '}}') { outLines.push(''); continue; }
    // inline styled spans: {{style text}} -> text
    l = l.replace(/\{\{[^\s}]*\s+([^}]*?)\s*\}\}/g, '$1');
    outLines.push(l);
  }
  return outLines;
}

const iconHtml = (s) =>
  s.replace(/\$\[([A-Z]+)\]/g, (m, k) =>
    ICONS.includes(k) ? `<span class="ic ic-${k}" role="img" aria-label="${k}" title="${k}"></span>` : m,
  );
const iconText = (s) => s.replace(/\$\[([A-Z]+)\]/g, '{$1}');
const inline = (s) => iconHtml(marked.parseInline(s.trim()));
const plain = (s) =>
  iconText(s)
    .replace(/\*\*\*|\*\*|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function slug(s) {
  return plain(s)
    .toLowerCase()
    .replace(/\{[a-z]+\}/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const isTableLine = (l) => l.trim().startsWith('|');
const isDelim = (l) => /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l.trim());
const cells = (l) => {
  let t = l.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
};

// Turns a group of table lines into { headers, rows } and normalised markdown
// (multi-row headers merged so GFM can render them).
function parseTable(group) {
  const d = group.findIndex(isDelim);
  if (d < 0) return null;
  const headRows = group.slice(0, d).map(cells);
  const width = Math.max(...group.map((l) => cells(l).length));
  const headers = Array.from({ length: width }, (_, i) =>
    headRows.map((r) => r[i] || '').filter(Boolean).join(' ').trim(),
  );
  const rows = [];
  for (const l of group.slice(d + 1)) {
    const c = cells(l);
    if (c.every((x) => x === '')) continue;
    rows.push(c);
  }
  const md = [
    '| ' + headers.join(' | ') + ' |',
    group[d].trim(),
    ...rows.map((r) => '| ' + r.join(' | ') + ' |'),
  ].join('\n');
  return {
    headers: headers.map(plain),
    rows: rows.map((r) => r.map(plain)),
    md,
  };
}

function renderBody(bodyLines) {
  // Collect fields, subtitle, tables; build markdown for rendering.
  const fields = [];
  const tables = [];
  let subtitle = null;
  const md = [];
  let defs = [];
  const flushDefs = () => {
    if (!defs.length) return;
    md.push('', '<dl class="defs">' + defs.map(([k, v]) => `<div><dt>${inline(k)}</dt><dd>${inline(v)}</dd></div>`).join('') + '</dl>', '');
    defs = [];
  };
  for (let i = 0; i < bodyLines.length; i++) {
    const l = bodyLines[i];
    const t = l.trim();
    const def = t.match(/^\*\*(.+?)\*\*\s*::\s*(.*)$/);
    if (def) {
      fields.push([plain(def[1]), plain(def[2])]);
      defs.push([def[1], def[2]]);
      continue;
    }
    flushDefs();
    if (subtitle === null && md.every((x) => !x.trim()) && /^\*[^*].*[^*]\*$/.test(t)) {
      subtitle = plain(t);
      md.push(`<p class="subtitle">${inline(t)}</p>`, '');
      continue;
    }
    if (isTableLine(l)) {
      const group = [];
      while (i < bodyLines.length && isTableLine(bodyLines[i])) group.push(bodyLines[i++]);
      i--;
      const tbl = parseTable(group);
      if (tbl) {
        tables.push({ headers: tbl.headers, rows: tbl.rows });
        md.push('', tbl.md, '');
      }
      continue;
    }
    md.push(l);
  }
  flushDefs();
  const html = iconHtml(marked.parse(md.join('\n'))).trim();
  return { html, fields, subtitle, tables, items: collectItems(bodyLines) };
}

// Named lead-in paragraphs such as `***Night Vision.*** You have ...` (used for
// ancestry facets, class sub-benefits, etc.). Continuation lines up to the next
// item, heading-like definition or blank-separated non-list text are included.
function collectItems(bodyLines) {
  const items = [];
  let cur = null;
  const lead = /^(?:[-*]\s+)?\*\*\*(.+?)\*\*\*\s*(.*)$/;
  for (const l of bodyLines) {
    const t = l.trim();
    const m = t.match(lead);
    if (m) {
      cur = { name: plain(m[1]).replace(/[.:]$/, ''), lines: [m[2]] };
      items.push(cur);
    } else if (cur && t && !/^\*\*.+\*\*\s*::/.test(t) && !isTableLine(t)) {
      cur.lines.push(l.replace(/^\s{0,3}/, ''));
    } else if (cur && /^\*\*.+\*\*\s*::/.test(t)) {
      cur = null;
    }
  }
  return items.map(({ name, lines }) => ({
    name,
    html: iconHtml(marked.parse(lines.join('\n'))).trim(),
    text: plain(lines.join(' ')),
  }));
}

function parse(lines) {
  const root = { id: '', title: 'root', depth: 0, children: [], body: [] };
  const stack = [root];
  for (const l of lines) {
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const depth = h[1].length;
      let title = h[2].trim();
      let lvl;
      const lm = title.match(/<\s*lvl\s*(\d+)\s*>\s*$/i);
      if (lm) {
        lvl = Number(lm[1]);
        title = title.slice(0, lm.index).trim();
      }
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      const node = {
        title: plain(title),
        titleHtml: inline(title),
        depth,
        ...(lvl !== undefined ? { lvl } : {}),
        children: [],
        body: [],
      };
      const base = slug(title) || 'section';
      let id = parent.id ? `${parent.id}/${base}` : base;
      const siblings = parent.children.filter((c) => c.id === id || c.id.startsWith(id + '~'));
      if (siblings.length) id += '~' + (siblings.length + 1);
      node.id = id;
      parent.children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].body.push(l);
    }
  }
  const finish = (n) => {
    const { html, fields, subtitle, tables, items } = renderBody(n.body);
    delete n.body;
    if (html) n.html = html;
    if (fields.length) n.fields = Object.fromEntries(fields);
    if (subtitle) n.subtitle = subtitle;
    if (tables.length) n.tables = tables;
    if (items.length) n.items = items;
    n.children.forEach(finish);
    if (!n.children.length) delete n.children;
  };
  finish(root);
  return root.children;
}

const source = readFileSync(src, 'utf8');
const sections = parse(preprocess(source));
writeFileSync(out, JSON.stringify({ source: src.split('/').pop(), sections }, null, 1) + '\n');
let count = 0;
const walk = (ns) => ns.forEach((n) => { count++; n.children && walk(n.children); });
walk(sections);
console.log(`Parsed ${count} sections from ${src} -> ${out}`);
