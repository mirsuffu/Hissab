// Safe, zero-dependency Markdown & CSV engine for Hisaab chat & statements.
import { esc } from '../ui.js';

export function csvToMarkdown(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return '';
  const parseLine = line => {
    const res = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if ((c === ',' || c === '\t') && !inQ) {
        res.push(cur.trim()); cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const rows = lines.map(parseLine);
  if (!rows.length) return '';
  const colCount = Math.max(...rows.map(r => r.length));
  const pad = r => [...r, ...Array(Math.max(0, colCount - r.length)).fill('')];
  const header = pad(rows[0]);
  const sep = Array(colCount).fill('---');
  const body = rows.slice(1).map(pad);

  return [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map(r => `| ${r.join(' | ')} |`)
  ].join('\n');
}

export function markdownToCSV(mdText) {
  const lines = mdText.split(/\r?\n/).filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return mdText;
  const q = s => `"${String(s || '').replace(/"/g, '""')}"`;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // Skip separator line (| --- | --- |)
    if (/^\|\s*:?-+:?\s*\|/.test(lines[i])) continue;
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    out.push(cells.map(q).join(','));
  }
  return '\ufeff' + out.join('\r\n');
}

export function renderMarkdown(raw = '') {
  if (!raw) return '';
  // 1. Process code blocks first to protect code content
  const codeBlocks = [];
  let text = raw.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi, (_, lang, code) => {
    const id = `__CB_${codeBlocks.length}__`;
    codeBlocks.push(`<pre class="md-pre"><code class="md-code">${esc(code.trim())}</code></pre>`);
    return id;
  });

  const lines = text.split(/\r?\n/);
  const out = [];
  let inTable = false, tableHeaders = [], tableRows = [], inList = false;

  const flushTable = () => {
    if (!inTable) return;
    let html = '<div class="md-table-wrap"><table class="md-table">';
    if (tableHeaders.length) {
      html += '<thead><tr>' + tableHeaders.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    }
    if (tableRows.length) {
      html += '<tbody>' + tableRows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
    }
    html += '</table></div>';
    out.push(html);
    inTable = false; tableHeaders = []; tableRows = [];
  };

  const flushList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  const formatInline = s => {
    let res = esc(s);
    // Inline code: `code`
    res = res.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    // Bold: **text** or __text__
    res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    res = res.replace(/(^|[\s(])__([^_]+)__([\s).,!?]|$)/g, '$1<strong>$2</strong>$3');
    // Italic: *text* or _text_ (word/boundary sensitive to avoid mangling snake_case & handles)
    res = res.replace(/(^|[\s(])\*([^*]+)\*([\s).,!?]|$)/g, '$1<em>$2</em>$3');
    res = res.replace(/(^|[\s(])_([^_]+)_([\s).,!?]|$)/g, '$1<em>$2</em>$3');
    // Links: [text](url)
    res = res.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Autolink bare URLs
    res = res.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return res;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Table line
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      const cells = line.split('|').slice(1, -1).map(c => formatInline(c.trim()));
      // Is separator row?
      if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) {
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else {
      flushTable();
    }

    // Code block placeholder
    if (/^__CB_\d+__$/.test(line)) {
      flushList();
      const idx = Number(line.replace(/\D/g, ''));
      out.push(codeBlocks[idx] || '');
      continue;
    }

    // Empty line
    if (!line) {
      flushList();
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      flushList();
      out.push(`<h4 class="md-h4">${formatInline(line.slice(4))}</h4>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      out.push(`<h3 class="md-h3">${formatInline(line.slice(3))}</h3>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      out.push(`<h2 class="md-h2">${formatInline(line.slice(2))}</h2>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      out.push(`<blockquote class="md-quote">${formatInline(line.slice(2))}</blockquote>`);
      continue;
    }

    // Bullet list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { out.push('<ul class="md-list">'); inList = true; }
      out.push(`<li>${formatInline(line.slice(2))}</li>`);
      continue;
    }

    // Normal paragraph
    flushList();
    out.push(`<p class="md-p">${formatInline(line)}</p>`);
  }

  flushTable();
  flushList();

  return out.join('');
}
