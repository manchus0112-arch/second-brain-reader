// Markdown mínimo: títulos, citas, listas, negrita, cursiva, código,
// enlaces web, [[enlaces a notas]] y #etiquetas.
import { esc } from './util.js';

function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[\[([^\]\n]+)\]\]/g, (_, t) => `<a class="wikilink" href="#/go/${encodeURIComponent(t.trim())}">${t}</a>`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, pre, t) => `${pre}<a class="tag" href="#/tag/${encodeURIComponent(t.toLowerCase())}">#${t}</a>`);
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let quote = [];
  let para = [];

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const line of lines) {
    let m;
    if (!line.trim()) { flushAll(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushAll(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara(); flushQuote();
      if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); flushQuote();
      if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if (/^-{3,}$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join('\n');
}
