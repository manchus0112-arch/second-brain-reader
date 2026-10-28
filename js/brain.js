// El "cerebro": encuentra conceptos y conexiones sin que tengas que escribir [[enlaces]].
// - menciones: un subrayado o nota que contiene el nombre de un concepto queda conectado a él.
// - sugerencias: frases clave del texto subrayado, priorizando las que se repiten en tu biblioteca.
// - relacionados: subrayados y notas que comparten palabras poco comunes.
import { parseLinks } from './util.js';

const STOP = new Set(`
a al algo algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui asi aun aunque bajo bien cada casi como con contra cual cuales cualquier cuando cuanto de del desde donde dos e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron ha habia han hasta hay la las le les lo los mas me mi mis mucho muchos muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque pues que quien quienes se sea segun ser si sido siempre sin sino sobre solo son su sus tal tambien tan tanto te tiene tienen todo todos tras tu tus un una unas uno unos usted ya yo cosa cosas forma manera vez veces hace hacer puede pueden debe deben otro mismo misma mismos mismas cual cuya cuyo donde mientras durante luego entonces ademas incluso parte tipo lado
the of and to in is it that for on as with was were be by this are or from at an not but have has had they their them we you he she his her its our your which who whom what when where why how all any both each few more most other some such no nor only own same so than too very can will just should now also into about over after before between through during out up down off again further then once here there these those i me my am do does did doing would could
`.split(/\s+/).filter(Boolean));

export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function words(text) {
  return [...String(text ?? '').matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)].map((m) => m[0]);
}

const CONNECT = new Set(['de', 'del', 'y', 'e', 'la', 'el', 'los', 'las', 'of', 'and']);
// Terminaciones típicas de verbos conjugados o en infinitivo: casi nunca son conceptos.
const VERBISH = /(amos|emos|imos|ando|iendo|aban|ieron|aron|aria|eria|iria|ar|er|ir)$/;
const verbish = (w) => w.length > 4 && VERBISH.test(w);

// Frases candidatas (1 a 3 palabras) dentro de un texto, sin cruzar signos de puntuación.
// Se quedan las que parecen sustantivos: "memoria de trabajo", "repetición espaciada", "Zettelkasten".
function candidates(text) {
  const out = [];
  for (const chunk of String(text ?? '').split(/[.,;:!?()«»"“”\n—–]+/)) {
    const w = words(chunk);
    for (let i = 0; i < w.length; i++) {
      for (let n = 1; n <= 3 && i + n <= w.length; n++) {
        const parts = w.slice(i, i + n);
        const first = fold(parts[0]);
        const last = fold(parts[n - 1]);
        if (STOP.has(first) || STOP.has(last) || verbish(first) || verbish(last)) continue;
        if (n === 1 && (first.length < 5 || /^\d+$/.test(first))) continue;
        if (parts.some((p) => /^\d+$/.test(p))) continue;
        const middle = n === 3 ? fold(parts[1]) : null;
        if (middle && STOP.has(middle) && !CONNECT.has(middle)) continue;
        const shape = n === 2 ? 1.5 : n === 3 ? (CONNECT.has(middle) ? 1.6 : -1) : 0.2;
        out.push({ text: parts.join(' '), key: fold(parts.join(' ')), n, shape, caps: parts.every((p) => /^\p{Lu}/u.test(p)) && i > 0 });
      }
    }
  }
  return out;
}

const docText = (item) => `${item.title ? `${item.title}. ` : ''}${item.text || ''} ${item.note || ''} ${item.body || ''}`;

// ¿El texto menciona este concepto? Sin importar mayúsculas ni acentos, admite plural simple.
export function mentions(title, text) {
  const t = fold(title).trim();
  if (t.length < 3) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(s|es)?($|[^\\p{L}\\p{N}])`, 'u').test(fold(text));
}

// Conceptos a los que pertenece un subrayado o nota: enlaces explícitos + menciones.
export function conceptsOf(item, notes) {
  const text = `${item.text || ''} ${item.note || ''} ${item.body || ''}`;
  const explicit = new Set([...(item.links || []), ...parseLinks(item.note || item.body)].map(fold));
  return notes.filter((n) => n.id !== item.id && n.title && (explicit.has(fold(n.title)) || mentions(n.title, text)));
}

export class Brain {
  constructor(notes, highlights) {
    this.notes = notes;
    this.highlights = highlights;
    this.df = new Map(); // frase -> nº de subrayados/notas donde aparece
    this.label = new Map(); // frase -> cómo se escribió
    this.wordDf = new Map();
    this.shape = new Map();
    const docs = [...highlights, ...notes];
    this.N = docs.length || 1;
    for (const d of docs) {
      const seen = new Set();
      for (const c of candidates(docText(d))) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        this.df.set(c.key, (this.df.get(c.key) || 0) + 1);
        if (!this.label.has(c.key) || c.caps) this.label.set(c.key, c.text);
        this.shape.set(c.key, c.shape);
      }
      for (const w of new Set(words(docText(d)).map(fold))) if (!STOP.has(w) && w.length > 3) this.wordDf.set(w, (this.wordDf.get(w) || 0) + 1);
    }
  }

  // Sugerencias de concepto para un texto: primero los conceptos que ya tienes y aparecen, luego frases clave.
  suggest(text, limit = 6) {
    const existing = this.notes.filter((n) => n.title && mentions(n.title, text)).map((n) => ({ title: n.title, note: n }));
    const taken = new Set(existing.map((e) => fold(e.title)));
    const scored = new Map();
    for (const c of candidates(text)) {
      if (taken.has(c.key)) continue;
      const df = this.df.get(c.key) || 1;
      const score = (df >= 2 ? df * 2 : 0.5) + c.shape + (c.caps ? 2 : 0) + Math.min(c.key.length, 20) / 30;
      if (!scored.has(c.key) || scored.get(c.key).score < score) scored.set(c.key, { title: this.label.get(c.key) || c.text, score });
    }
    // evita sugerir "memoria" y "memoria de trabajo" a la vez: se queda con la más larga si puntúa parecido
    const fresh = [...scored.entries()].sort((a, b) => b[1].score - a[1].score);
    const picked = [];
    for (const [key, v] of fresh) {
      if (picked.some((p) => p.key.includes(key) || key.includes(p.key))) continue;
      picked.push({ key, ...v });
      if (picked.length + existing.length >= limit) break;
    }
    return [...existing, ...picked.map((p) => ({ title: cap(p.title) }))].slice(0, limit);
  }

  // Temas que se repiten en varios subrayados y aún no son concepto.
  topics(limit = 12) {
    const have = new Set(this.notes.map((n) => fold(n.title)));
    const list = [...this.df.entries()]
      .filter(([k, df]) => df >= 2 && !have.has(k) && ![...have].some((h) => h && (k.includes(h) || h.includes(k))))
      .filter(([k]) => (this.shape.get(k) ?? 0) > 0)
      .map(([k, df]) => ({ key: k, title: cap(this.label.get(k)), count: df, score: df * 2 + (this.shape.get(k) || 0) }))
      .sort((a, b) => b.score - a.score);
    const out = [];
    for (const t of list) {
      if (out.some((o) => o.key.includes(t.key) || t.key.includes(o.key))) continue;
      out.push(t);
      if (out.length >= limit) break;
    }
    return out;
  }

  // Subrayados y notas parecidos (palabras poco comunes en común).
  related(item, limit = 5) {
    const vec = (d) => {
      const m = new Map();
      for (const w of words(docText(d)).map(fold)) {
        if (STOP.has(w) || w.length <= 3) continue;
        const df = this.wordDf.get(w) || 1;
        if (df > this.N * 0.5) continue;
        m.set(w, Math.log(1 + this.N / df));
      }
      return m;
    };
    const a = vec(item);
    if (!a.size) return [];
    const norm = (m) => Math.sqrt([...m.values()].reduce((s, x) => s + x * x, 0));
    const na = norm(a);
    return [...this.highlights, ...this.notes]
      .filter((d) => d.id !== item.id)
      .map((d) => {
        const b = vec(d);
        let dot = 0;
        for (const [w, x] of a) if (b.has(w)) dot += x * b.get(w);
        return { item: d, score: dot / (na * (norm(b) || 1)) };
      })
      .filter((r) => r.score > 0.12)
      .sort((x, y) => y.score - x.score)
      .slice(0, limit)
      .map((r) => r.item);
  }
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
