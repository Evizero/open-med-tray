// Phone bottom sheet gesture: dragging on the grabber or the tab strip moves
// the sheet with the finger between the two fixed states; release snaps by
// fling velocity, else by distance. Direction locks after a small slop: only
// vertical drags are taken, horizontal movement is released to the page. Taps
// fall through to the normal click handlers (toggle, pick a tab), and the click
// a drag would otherwise produce is swallowed, so a drag that starts on a tab
// never switches tabs. The panel body and every control keep their native
// scrolling and input. The app's layout (camera insets, refit) is only updated
// once, through setOpen, when the drag settles.
const SLOP = 7;            // px of vertical travel before the sheet takes the gesture
const FLING = .45;         // px/ms; faster releases snap in their direction
const OVERDRAG = 28;       // px of rubber band past either rest position

export function bindSheetDrag({ panel, surfaces, enabled, isOpen, setOpen, range, onLift }) {
  let drag = null, swallowUntil = 0;
  const rubber = (d) => OVERDRAG * (1 - 1 / (d / OVERDRAG + 1));

  function place(off) {
    panel.style.transform = `translateY(${off}px)`;
    // Lift above the collapsed rest (for chrome that rides on the sheet).
    if (!drag.fromOpen) onLift?.(Math.max(0, drag.max - off));
  }
  function end(open, { animate = true } = {}) {
    const d = drag; drag = null;
    if (!d?.live) return;
    swallowUntil = performance.now() + 450;
    if (!animate) panel.classList.add('snap');
    panel.classList.remove('dragging');
    panel.style.transform = '';
    onLift?.(null);
    // Unchanged state: removing the inline transform lets the CSS transition
    // carry the sheet back from wherever the finger left it.
    setOpen(open);
    if (!animate) requestAnimationFrame(() => panel.classList.remove('snap'));
  }

  function down(e) {
    if (drag || !enabled() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const max = range();
    if (!(max > 0)) return;
    const fromOpen = isOpen();
    drag = { id: e.pointerId, el: e.currentTarget, x: e.clientX, y: e.clientY, max, fromOpen, start: fromOpen ? 0 : max, off: fromOpen ? 0 : max, live: false, trail: [[e.timeStamp, e.clientY]] };
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.live) {
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) { drag = null; return; }
      if (Math.abs(dy) < SLOP) return;
      drag.live = true; drag.y = e.clientY;
      try { drag.el.setPointerCapture(e.pointerId); } catch {}
      panel.classList.add('dragging');
    }
    e.preventDefault();
    const raw = drag.start + (e.clientY - drag.y);
    drag.off = raw < 0 ? -rubber(-raw) : raw > drag.max ? drag.max + rubber(raw - drag.max) : raw;
    drag.trail.push([e.timeStamp, e.clientY]);
    while (drag.trail.length > 2 && e.timeStamp - drag.trail[0][0] > 90) drag.trail.shift();
    place(drag.off);
  }
  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.live) { drag = null; return; }
    const t = drag.trail, [t0, y0] = t[0], [t1, y1] = t[t.length - 1];
    // A pause before lifting the finger is not a fling.
    const v = t1 > t0 && e.timeStamp - t1 < 80 ? (y1 - y0) / (t1 - t0) : 0;
    end(Math.abs(v) > FLING ? v < 0 : drag.off < drag.max / 2);
  }
  // The platform took the gesture (or capture was lost): return to where it began.
  function cancel(e) { if (drag && e.pointerId === drag.id) { if (drag.live) end(drag.fromOpen); else drag = null; } }
  // Touch pointers start implicitly captured by the element under the finger
  // (e.g. the title); moving capture to the surface fires lostpointercapture
  // on that child, which bubbles here and is not a loss of the gesture.
  function lost(e) { if (drag?.live && e.target === drag.el) cancel(e); }

  for (const s of surfaces) {
    s.addEventListener('pointerdown', down);
    s.addEventListener('pointermove', move);
    s.addEventListener('pointerup', up);
    s.addEventListener('pointercancel', cancel);
    s.addEventListener('lostpointercapture', lost);
  }
  panel.addEventListener('click', (e) => { if (performance.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); } }, true);

  return {
    get dragging() { return !!drag?.live; },
    // Resize / orientation change mid-drag: settle in place without motion.
    abort() { if (drag?.live) end(drag.fromOpen, { animate: false }); else drag = null; },
  };
}
