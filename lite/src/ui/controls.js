// Tiny declarative control builders (no framework). Every control reads its
// value through get() and writes through set(value, final) so panels can be
// rebuilt at any time from state. Controls carry a stable data-k key so focus
// can be restored after a rebuild.
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
};
export { el };

export function section(title, children, { action, aside } = {}) {
  const head = title ? el('div', { class: 'sec-h' }, el('span', { class: 'sec-t', text: title }), aside ? el('span', { class: 'sec-a', text: aside }) : null, action ? el('button', { class: 'sec-x', type: 'button', text: action.label, onclick: action.fn }) : null) : null;
  return el('div', { class: 'sec' }, head, ...children);
}

const chevron = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 12 12'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'; return s; };
export function advanced(label, children) {
  return el('details', { class: 'adv' }, el('summary', { 'data-k': 'adv:' + label }, chevron(), el('span', { text: label })), el('div', { class: 'adv-b' }, ...children));
}

// Field label row: name on the left, optional current-value note on the right.
function fieldLabel(label, note) {
  return el('div', { class: 'fl' }, el('span', { class: 'fl-t', text: label }), note ?? null);
}

// Live cues (diagrams) that follow slider input between panel rebuilds.
const cues = new Set();
export function registerCue(node) { cues.add(node); return node; }
function refreshCues() { for (const c of cues) { if (c.isConnected) c.refresh(); else cues.delete(c); } }
// Re-read every slider and cue from state (after an edit made elsewhere, e.g.
// a 3D handle drag). Focused value fields keep what the user is typing.
export function refreshPanel(root = document.getElementById('inspBody')) {
  root?.querySelectorAll('.row').forEach((r) => r.refresh?.());
  refreshCues();
}

// Edit transactions for live (uncommitted) value changes. The app installs
// begin/cancel so a revert restores the whole model state (spec and preset),
// not only the one value; without hooks the start value is written back.
const editHooks = { begin: null, cancel: null };
export function setEditHooks(h) { Object.assign(editHooks, h); }

// A slider row may name the part of a nearby diagram it drives (`hl`); the
// panel body carries it as data-hl while the row is hovered or focused.
function bindHighlight(row, hl) {
  if (!hl) return;
  const host = () => row.closest('.insp-body') || row.parentElement;
  const on = () => { const h = host(); if (h) h.dataset.hl = hl; };
  const off = () => { const h = host(); if (h && h.dataset.hl === hl && !row.contains(document.activeElement)) delete h.dataset.hl; };
  row.addEventListener('pointerenter', on); row.addEventListener('focusin', on);
  row.addEventListener('pointerleave', off); row.addEventListener('focusout', () => setTimeout(off));
}

const decimals = (s) => { const t = String(s); return t.includes('e-') ? +t.split('e-')[1] : (t.split('.')[1] || '').length; };
const TIGHT_UNITS = new Set(['°', '×', '%']);

let uid = 0;
// Range slider. The value readout is an editable field (type an exact number,
// Enter commits, Esc reverts, ↑/↓ step) unless a custom formatter is given.
// Signed ranges fill from zero; short discrete ranges show step ticks; `ref`
// marks a reference value on the track.
export function slider({ label, get, set, min, max, step = .01, unit = 'mm', digits = 2, fmt, hl, ref, refLabel }) {
  const id = 'c' + (++uid);
  const input = el('input', { type: 'range', id, min, max, step, 'aria-label': label, 'data-k': 'range:' + label });
  const bipolar = min < 0 && max > 0;
  const frac = (v) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const editable = !fmt;
  const num = editable
    ? el('input', { class: 'num', type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off', 'aria-label': `${label} value${unit ? ' in ' + unit : ''}`, 'data-k': 'val:' + label, size: Math.max((+min).toFixed(digits).length, (+max).toFixed(digits).length) })
    : el('span', { class: 'num ro' });
  const u = unit && editable ? el('span', { class: 'unit' + (TIGHT_UNITS.has(unit) ? ' tight' : ''), text: unit }) : null;
  const refNote = ref !== undefined ? el('span', { class: 'unit ref', text: refLabel ?? `ref ${ref}` }) : null;
  const val = el('span', { class: 'val' }, num, u, refNote);
  const show = (v) => {
    const t = fmt ? fmt(v) : (+v).toFixed(digits);
    if (editable) { if (document.activeElement !== num) num.value = t; } else { num.textContent = t; num.classList.toggle('word', /[a-z]{3}/i.test(t)); }
    input.style.setProperty('--p', frac(v));
    if (bipolar) input.style.setProperty('--z', frac(0));
  };
  const snap = (v) => { v = Math.max(+min, Math.min(+max, +min + Math.round((v - min) / step) * step)); return +v.toFixed(Math.max(decimals(step), 0)); };
  input.value = get(); show(+input.value);
  input.addEventListener('input', () => { show(+input.value); set(+input.value, false); refreshCues(); });
  input.addEventListener('change', () => set(+input.value, true));
  if (editable) {
    // before: field text at focus; start: model value at focus; live: the
    // model already holds an uncommitted value (arrow keys preview live).
    let before = '', start = 0, live = false, skipBlur = false;
    const revert = () => {
      num.value = before;
      if (!live) return;
      live = false;
      if (!editHooks.cancel?.()) { set(start, false); set(start, true); }
      input.value = start; show(start); refreshCues();
    };
    const commit = () => {
      if (skipBlur) { skipBlur = false; return; }
      const raw = parseFloat(num.value.trim().replace(',', '.'));
      if (!Number.isFinite(raw)) { revert(); return; }
      const v = snap(raw);
      input.value = v; num.value = v.toFixed(digits); show(v);
      if (v !== start || live) { if (!live) set(v, false); live = false; refreshCues(); set(v, true); }
    };
    num.addEventListener('focus', () => { before = num.value; start = +get(); live = false; num.select(); });
    num.addEventListener('blur', commit);
    num.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); num.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); revert(); skipBlur = true; num.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = parseFloat(num.value); const v = snap((Number.isFinite(cur) ? cur : +input.value) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
        if (!live) { live = true; editHooks.begin?.(); }
        num.value = v.toFixed(digits); input.value = v; show(v); set(v, false); refreshCues();
      }
    });
  }
  const track = el('div', { class: 'trk' + (bipolar ? ' bi' : '') }, input);
  const steps = Math.round((max - min) / step);
  if (steps >= 2 && steps <= 12) for (let i = 0; i <= steps; i++) { const t = el('i', { class: 'tick' }); t.style.setProperty('--t', i / steps); track.append(t); }
  if (bipolar) { const t = el('i', { class: 'tick zero' }); t.style.setProperty('--t', frac(0)); track.append(t); }
  if (ref !== undefined) { const t = el('i', { class: 'tick ref', title: refLabel ?? `reference ${ref}` }); t.style.setProperty('--t', frac(ref)); track.append(t); }
  const row = el('div', { class: 'row', 'data-hl': hl }, el('label', { for: id, text: label }), val, track);
  bindHighlight(row, hl);
  row.refresh = () => { input.value = get(); show(+input.value); };
  return row;
}

// Estimated rendered width of a control label (Plex Sans 500 at the seg size).
let mctx = null;
function textW(s, px = 11.5) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `500 ${px}px "IBM Plex Sans", system-ui, sans-serif`;
  return mctx.measureText(String(s)).width;
}
function contentWidth() {
  const b = document.getElementById('inspBody');
  const w = b?.clientWidth ? b.clientWidth - 32 : 0;
  return w > 120 ? w : 268;
}

// Segmented choice: equal cells in one track. Options are [value, text] or
// [value, text, glyph] where glyph() returns an element drawn before (or, with
// stack, above) the text. Columns come from the measured longest label and the
// panel width, balanced so rows are as even as possible; a partial last row
// stretches to the full width. Never depends on the current value.
export function seg({ label, options, get, set, cols, stack = false, note, cls = '' }) {
  const wrap = el('div', { class: 'field' });
  const noteEl = note ? el('span', { class: 'fl-n' }) : null;
  const setNote = (v) => { if (noteEl) noteEl.textContent = note(v); };
  if (label) wrap.append(fieldLabel(label, noteEl));
  const n = options.length;
  const hasGlyph = options.some((o) => o[2]);
  const W = contentWidth() - 4;
  const cell = stack ? Math.max(36, Math.max(...options.map(([, t]) => textW(t) + 1)) + 13) : Math.max(...options.map(([, t]) => textW(t) + 1)) + 18 + (hasGlyph ? 22 : 0);
  let c = cols;
  if (!c) {
    let fit = 1;
    for (let k = Math.min(n, 8); k >= 1; k--) if (k * cell + (k - 1) * 2 <= W) { fit = k; break; }
    const rows = Math.ceil(n / fit);
    c = Math.ceil(n / rows);
  }
  const rem = n % c;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const L = rem ? c * rem / gcd(c, rem) : c;
  const box = el('div', { class: `seg${stack ? ' stack' : ''}${hasGlyph ? ' glyphs' : ''} ${cls}`, role: 'group', 'aria-label': label || '' });
  box.style.setProperty('--cols', L);
  const btns = options.map(([v, text, glyph], i) => {
    const b = el('button', { type: 'button', 'aria-pressed': String(get() === v), title: text, 'data-k': `seg:${label || ''}:${v}` }, glyph ? glyph() : null, el('span', { class: 'sl', text }));
    b.style.gridColumn = `span ${i < n - rem ? L / c : L / rem}`;
    b.addEventListener('click', () => { set(v); for (const o of btns) { o.setAttribute('aria-pressed', String(o === b)); o.tabIndex = o === b ? 0 : -1; } setNote(v); });
    return b;
  });
  // One Tab stop per group (the selected option); arrow keys move the choice.
  const cur = Math.max(0, btns.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
  btns.forEach((b, i) => { b.tabIndex = i === cur ? 0 : -1; });
  box.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    const next = btns[(i + d + n) % n];
    next.focus(); next.click();
  });
  setNote(get());
  box.append(...btns);
  wrap.append(box);
  return wrap;
}

const nice = (name) => name.replace(/_/g, ' ').replace(/\bpolypropylene\b/, 'PP');
export function swatches({ label, colors, get, set }) {
  const wrap = el('div', { class: 'field' });
  const noteEl = el('span', { class: 'fl-n' });
  if (label) wrap.append(fieldLabel(label, noteEl));
  const box = el('div', { class: 'swatches', role: 'group', 'aria-label': label || 'colour' });
  const toCss = (c) => `rgb(${c.map((v) => Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255)).join(',')})`;
  const btns = Object.entries(colors).map(([name, c]) => {
    const b = el('button', { type: 'button', title: name.replace(/_/g, ' '), 'aria-label': name.replace(/_/g, ' '), 'aria-pressed': String(get() === name), 'data-k': `sw:${label || ''}:${name}` });
    b.style.setProperty('--c', toCss(c));
    b.addEventListener('click', () => { set(name); for (const o of btns) { o.setAttribute('aria-pressed', String(o === b)); o.tabIndex = o === b ? 0 : -1; } noteEl.textContent = nice(name); });
    return b;
  });
  const cur = Math.max(0, btns.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
  btns.forEach((b, i) => { b.tabIndex = i === cur ? 0 : -1; });
  box.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 9, ArrowUp: -9 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement), j = Math.max(0, Math.min(btns.length - 1, i + d));
    btns[j].focus(); btns[j].click();
  });
  noteEl.textContent = get() ? nice(get()) : '';
  box.append(...btns);
  wrap.append(box);
  return wrap;
}

export function toggle({ label, get, set }) {
  const id = 'c' + (++uid);
  const sw = el('button', { id, class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!get()), 'aria-label': label, 'data-k': 'sw:' + label });
  sw.addEventListener('click', () => { const v = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(v)); set(v); });
  const lab = el('label', { for: id, text: label });
  return el('div', { class: 'toggle' }, lab, sw);
}

export function text({ label, get, set, maxLength = 12 }) {
  const id = 'c' + (++uid);
  const input = el('input', { id, type: 'text', maxlength: maxLength, value: get(), spellcheck: 'false', autocomplete: 'off', 'data-k': 'text:' + label });
  const count = el('span', { class: 'txt-n', text: `${input.value.length}/${maxLength}` });
  let t = null;
  input.addEventListener('input', () => { count.textContent = `${input.value.length}/${maxLength}`; clearTimeout(t); t = setTimeout(() => set(input.value), 260); });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  return el('div', { class: 'txt' }, el('label', { for: id, text: label }), el('span', { class: 'txt-f' }, input, count));
}

// Read-only facts. Default: key / value table (values wrap, never truncate).
// 'files': name over description. 'ids': narrow numeric key column.
export function kv(pairs, { variant = 'table' } = {}) {
  const g = el('div', { class: `kv kv-${variant}` });
  for (const [k, v] of pairs) g.append(el('div', { class: 'kv-r' }, el('span', { class: 'kv-k', text: k }), el('span', { class: 'kv-v', text: String(v) })));
  return g;
}

// Tab strip: equal-width buttons, one selected; caller handles the indicator.
export function tabStrip(strip, tabs, activeId, onPick) {
  strip.replaceChildren();
  for (const t of tabs) {
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === activeId), 'data-tab': t.id, text: t.label, tabindex: t.id === activeId ? '0' : '-1' });
    b.addEventListener('click', () => onPick(t.id));
    strip.append(b);
  }
}

// Arrow-key navigation for a role=tablist (horizontal strips answer ←/→, the
// vertical rail also ↑/↓); returns the id to select or null.
export function tabArrow(strip, e, attr = 'data-tab') {
  const next = e.key === 'ArrowRight' || e.key === 'ArrowDown', prev = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  if (!next && !prev) return null;
  const btns = [...strip.querySelectorAll('[role=tab]')];
  const i = btns.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const j = (i + (next ? 1 : btns.length - 1)) % btns.length;
  e.preventDefault();
  btns[j].focus();
  return btns[j].getAttribute(attr);
}

export function placeIndicator(strip) {
  const b = strip.querySelector('[aria-selected="true"]');
  if (!b) { strip.style.setProperty('--iw', '0px'); return; }
  strip.style.setProperty('--ix', `${b.offsetLeft + 8}px`);
  strip.style.setProperty('--iw', `${Math.max(0, b.offsetWidth - 16)}px`);
}
