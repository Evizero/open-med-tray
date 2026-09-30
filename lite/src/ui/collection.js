// Dataset contact sheet: completed scenes as indexed frames on a technical
// canvas, followed by the scenes of the running batch. Queue slots mirror the
// generator's real callbacks (queued → build → render → encode) and the
// active slot develops into the finished tile in place, so nothing already on
// the sheet moves or re-animates when a batch appends.
import { el } from './controls.js';
import { TRAY_STYLES } from '../geo/tray.js';
import { LIGHTING } from '../render/lighting.js';

export const STAGES = [
  ['building', 'Build', 'Building scene'],
  ['rendering', 'Render', 'Rendering beauty and targets'],
  ['encoding', 'Encode', 'Encoding and verifying'],
];
const EASE = 'cubic-bezier(.2,.7,.15,1)';
export const pad4 = (n) => String(n).padStart(4, '0');
export const human = (s) => String(s ?? '').replace(/_/g, ' ');

const SVG = 'http://www.w3.org/2000/svg';
export function icon(path, size = 16) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.innerHTML = path;
  return s;
}
export const ICONS = {
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  expand: '<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function sceneSummary(record) {
  const m = record.manifest?.scenes?.[0] ?? {};
  const style = TRAY_STYLES[m.style]?.label ?? human(m.style);
  const light = LIGHTING[m.lighting]?.label ?? human(m.lighting);
  return { style, light, scenario: m.scenario ?? 'ordinary', pills: record.meta.placed_pills, visible: m.visible_pills };
}
export const sceneResolution = (record) => record.meta?.camera?.resolution_px ?? [2, 1];

export function createCollection({ grid, reduced, onOpen, onDownload, onDelete }) {
  let queue = null; // { slots: [el], plan, active, follow }
  const motion = (node, frames, opts) => (reduced || !node.animate ? null : node.animate(frames, { easing: EASE, fill: 'both', ...opts }));

  function tile(record, { develop = false } = {}) {
    const [w, h] = sceneResolution(record);
    const s = sceneSummary(record);
    const n = record.globalIndex + 1;
    const pic = el('button', { class: 'pic', type: 'button', 'aria-label': `Inspect ${record.name}: image and training targets`, title: 'Inspect image and targets', onclick: () => onOpen(record.name) },
      el('img', { class: 'rgb', src: record.thumb, alt: '', draggable: 'false' }),
      el('img', { class: 'lab', src: record.thumbLabels, alt: '', draggable: 'false' }),
      el('span', { class: 'pic-hint', 'aria-hidden': 'true' }, icon(ICONS.expand, 12), 'Inspect'),
      develop ? el('span', { class: 'dev', 'aria-hidden': 'true' }) : null);
    pic.style.aspectRatio = `${w} / ${h}`;
    const t = el('figure', { class: 'tile' + (develop ? ' developing' : ' enter'), 'data-scene': record.name },
      pic,
      el('figcaption', { class: 'cap' },
        el('span', { class: 'ix', text: pad4(n) }),
        el('span', { class: 'sd', text: `seed ${record.seed}` }),
        record.ok ? null : el('span', { class: 'flag', text: 'check failed', title: 'A round-trip or freeze check failed; see the inspector' }),
        el('span', { class: 'tile-actions' },
          el('button', { type: 'button', class: 'act', 'aria-label': `Download ${record.name}`, title: `Download ${record.name}.zip (image, targets, metadata)`, 'data-act': 'download', onclick: () => onDownload(record.name) }, icon(ICONS.download, 14)),
          el('button', { type: 'button', class: 'act del', 'aria-label': `Delete ${record.name}`, title: 'Delete this scene and all of its paired targets', 'data-act': 'delete', onclick: () => onDelete(record.name) }, icon(ICONS.trash, 14)))),
      el('div', { class: 'sub' },
        el('span', { text: `${s.pills} pill${s.pills === 1 ? '' : 's'}` }),
        el('span', { text: s.style }),
        s.scenario !== 'ordinary' ? el('span', { class: 'tag', text: human(s.scenario) }) : el('span', { text: s.light })));
    // Entrance classes are one-shot: later syncs never replay them.
    t.addEventListener('animationend', (e) => {
      if (e.animationName === 'tileIn') t.classList.remove('enter');
      if (e.animationName === 'develop') { t.classList.remove('developing', 'develop'); t.querySelector('.dev')?.remove(); }
    });
    return t;
  }

  function slot(i, plan) {
    const n = plan.startIndex + i + 1;
    const s = el('figure', { class: 'tile slot queued', 'data-slot': String(i), 'aria-label': `scene_${pad4(n)}, queued` },
      el('div', { class: 'pic', style: `aspect-ratio:${plan.width} / ${plan.height}` },
        el('span', { class: 'scan', 'aria-hidden': 'true' }),
        el('span', { class: 'slot-mid' }, el('span', { class: 'slot-state', text: 'Queued' }), el('span', { class: 'slot-spec', text: `${plan.width} × ${plan.height} · ${plan.samples} spp` })),
        el('ol', { class: 'stages', 'aria-hidden': 'true' }, STAGES.map(([id, short]) => el('li', { 'data-stage': id }, el('i'), el('span', { text: short }))))),
      el('figcaption', { class: 'cap' },
        el('span', { class: 'ix', text: pad4(n) }),
        el('span', { class: 'sd', text: `seed ${plan.baseSeed + i}` }),
        el('span', { class: 'st', text: i === 0 ? 'next' : `#${i + 1} in queue` })),
      el('div', { class: 'sub' }, el('span', { text: 'not rendered yet' })));
    return s;
  }

  // FLIP: tiles that reflow after a removal glide to their new cells.
  function flip(mutate) {
    const before = new Map([...grid.children].map((c) => [c, c.getBoundingClientRect()]));
    mutate();
    if (reduced) return;
    for (const c of grid.children) {
      const a = before.get(c); if (!a || c.dataset.leaving) continue;
      const b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) > .5) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 300, easing: EASE });
    }
  }
  function leave(node, done) {
    node.dataset.leaving = '1';
    const a = motion(node, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 170 });
    const finish = () => flip(() => { node.remove(); done?.(); });
    if (a) a.finished.then(finish, finish); else finish();
  }

  function emptyState(running) {
    grid.querySelector('.sheet-empty')?.remove();
    if (grid.querySelector('.tile:not([data-leaving])') || running) return;
    grid.append(el('div', { class: 'sheet-empty' },
      el('span', { class: 'frame', 'aria-hidden': 'true' }, el('span', { text: '0001' })),
      el('p', {}, el('b', { text: 'No scenes yet. ' }), 'Set Scenes to add, then Generate & add. Each scene is rendered with its image and training targets.')));
  }

  return {
    // Reconcile completed tiles with the collection (record order, before queue slots).
    sync(scenes, { running = false } = {}) {
      const existing = new Map([...grid.querySelectorAll('.tile[data-scene]:not([data-leaving])')].map((t) => [t.dataset.scene, t]));
      const firstSlot = grid.querySelector('.slot');
      grid.querySelector('.sheet-empty')?.remove();
      for (const record of scenes) {
        const t = existing.get(record.name);
        if (t) { t.querySelector('[data-act="delete"]').disabled = running; existing.delete(record.name); continue; }
        const nt = tile(record); nt.querySelector('[data-act="delete"]').disabled = running;
        grid.insertBefore(nt, firstSlot);
      }
      for (const stale of existing.values()) leave(stale, () => emptyState(running));
      emptyState(running);
    },
    tileFor: (name) => grid.querySelector(`.tile[data-scene="${CSS.escape(name)}"]:not([data-leaving])`),
    focusTile(name) { this.tileFor(name)?.querySelector('.pic')?.focus({ preventScroll: true }); },

    queueStart(plan) {
      this.queueEnd({ instant: true });
      // Failed slots remain readable until the user starts the next batch.
      grid.querySelectorAll('.slot.failed').forEach((s) => s.remove());
      grid.querySelector('.sheet-empty')?.remove();
      const slots = Array.from({ length: plan.count }, (_, i) => slot(i, plan));
      grid.append(...slots);
      queue = { slots, plan, active: -1, follow: true, t0: 0, marks: {} };
      slots.forEach((s, i) => motion(s, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: Math.min(i, 12) * 35, fill: 'backwards' }));
      const stopFollow = () => { if (queue) queue.follow = false; };
      grid.addEventListener('wheel', stopFollow, { once: true, passive: true });
      grid.addEventListener('touchmove', stopFollow, { once: true, passive: true });
      requestAnimationFrame(() => slots[0]?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
    },
    // Real generator stage for scene `index` of the batch.
    queueProgress({ index, stage, scenario }) {
      if (!queue) return;
      const s = queue.slots[index]; if (!s) return;
      if (queue.active !== index) {
        queue.active = index;
        s.classList.replace('queued', 'active');
        s.setAttribute('aria-label', s.getAttribute('aria-label').replace('queued', 'in progress'));
        queue.slots.forEach((q, j) => { if (j > index) q.querySelector('.st').textContent = j === index + 1 ? 'next' : `#${j - index} in queue`; });
        if (queue.follow) s.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      }
      const k = STAGES.findIndex(([id]) => id === stage);
      if (k < 0) return;
      s.dataset.stage = stage;
      s.querySelector('.slot-state').textContent = STAGES[k][2];
      s.querySelector('.st').textContent = stage;
      s.querySelectorAll('.stages li').forEach((li, j) => { li.classList.toggle('done', j < k); li.classList.toggle('now', j === k); });
      if (scenario && scenario !== 'ordinary') s.querySelector('.sub').replaceChildren(el('span', { class: 'tag', text: human(scenario) }), el('span', { text: 'stress scenario' }));
    },
    // The active slot becomes the finished tile at the same grid cell. The film
    // stays closed until the thumbnail is decoded, then a compositor-only sweep
    // uncovers it (it keeps running while the next scene blocks the main thread).
    // Resolves once the sweep is on screen; the generator awaits onScene.
    async queueComplete(record, index, { running = true } = {}) {
      const s = queue?.slots[index];
      const t = tile(record, { develop: !!s && !reduced });
      t.querySelector('[data-act="delete"]').disabled = running;
      if (s) { s.replaceWith(t); queue.slots[index] = null; }
      else grid.insertBefore(t, grid.querySelector('.slot'));
      if (!t.classList.contains('developing')) return t;
      await Promise.race([t.querySelector('img.rgb').decode().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      t.classList.add('develop');
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return t;
    },
    // Cancel requested: queued scenes will not run; the active one finishes.
    queueCancelling() {
      if (!queue) return;
      for (const s of queue.slots) if (s?.classList.contains('queued')) { s.classList.add('cancelling'); s.querySelector('.st').textContent = 'cancelled'; s.querySelector('.slot-state').textContent = 'Will not run'; }
    },
    // Completed/cancelled slots leave; an error stays available for diagnosis.
    queueEnd({ reason = 'done', instant = false, error = null } = {}) {
      if (!queue) return;
      const left = queue.slots.filter(Boolean);
      queue = null;
      const failedSlot = reason === 'failed' ? left.find((s) => s.classList.contains('active')) ?? left[0] : null;
      for (const s of left) {
        if (instant) { s.remove(); continue; }
        if (s === failedSlot) {
          s.classList.remove('queued'); s.classList.add('active', 'failed');
          s.querySelector('.slot-state').textContent = 'Failed · not added';
          s.querySelector('.st').textContent = 'failed';
          if (error) {
            const detail = `${error.stage} · ${error.name}: ${error.message}`;
            s.querySelector('.sub').textContent = detail;
            s.title = detail;
            s.setAttribute('aria-label', `${s.getAttribute('aria-label')?.split(',')[0]}, ${detail}`);
          }
          continue;
        }
        if (s.classList.contains('active')) {
          s.classList.add('stopped');
          s.querySelector('.slot-state').textContent = 'Stopped · not added';
          s.querySelector('.st').textContent = 'stopped';
          setTimeout(() => leave(s, () => emptyState(false)), reduced ? 600 : 900);
        } else leave(s, () => emptyState(false));
      }
      if (instant) emptyState(false);
    },
    get queued() { return queue ? queue.slots.filter(Boolean).length : 0; },
  };
}
