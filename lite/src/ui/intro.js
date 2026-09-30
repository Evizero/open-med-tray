// Open Med Tray Lite — introduction sheet. Shown on every page load (there is
// no stored "seen" flag) and again from the rail mark. It is a native modal
// <dialog>: the workbench behind it is inert, the sheet traps Tab, and main.js
// ignores its shortcuts while the sheet is open.
//
// Motion: on load the boot lockup flies into the sheet header while the sheet
// unfolds out of it, then an example blueprint (the default tablet) draws
// itself. Closing folds the sheet back into the rail mark that reopens it.
// With reduced motion the sheet simply appears and disappears.

const OUT = 'cubic-bezier(.16, 1, .3, 1)';
const IN_OUT = 'cubic-bezier(.65, 0, .35, 1)';
const NS = 'http://www.w3.org/2000/svg';

export function createIntro({ reduced, getSpec, onClose }) {
  const dlg = document.getElementById('intro');
  const sheet = document.getElementById('introSheet');
  const plate = document.getElementById('introPlate');
  const lockup = dlg.querySelector('.intro-lockup');
  let isOpen = false, closing = null, returnTo = null, anims = [], plateKey = '';

  const focusables = () => [...sheet.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length);
  dlg.addEventListener('keydown', (e) => {
    // Keys never reach the workbench shortcuts behind the sheet.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); hide('close'); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); hide('close'); });
  // A close the page did not request (browser close watchers) still finishes cleanly.
  dlg.addEventListener('close', () => { if (isOpen) finish(closing?.action ?? 'close'); });
  dlg.querySelector('.intro-veil').addEventListener('click', () => hide('close'));
  document.getElementById('introGo').addEventListener('click', () => hide('enter'));
  document.getElementById('introTour').addEventListener('click', () => hide('tour'));
  document.getElementById('introClose').addEventListener('click', () => hide('close'));
  const scroller = sheet.querySelector('.intro-scroll'), main = sheet.querySelector('.intro-main');
  // The actions' rule and shadow appear only while copy is hidden beneath them.
  const updateScroll = () => main.classList.toggle('scrolls', scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 2);
  scroller.addEventListener('scroll', updateScroll, { passive: true });
  addEventListener('resize', () => { if (isOpen) { drawPlate(false); updateScroll(); } });

  function stop() { for (const a of anims) a.cancel(); anims = []; }
  const run = (el, frames, opts) => { const a = el.animate(frames, { fill: 'both', ...opts }); anims.push(a); return a; };

  // Rect of `r` relative to the sheet as a clip-path inset (may extend past the sheet).
  function insetFrom(r, s, round) {
    return `inset(${r.top - s.top}px ${s.right - r.right}px ${s.bottom - r.bottom}px ${r.left - s.left}px round ${round}px)`;
  }

  function show({ from = null, returnFocus = null } = {}) {
    if (isOpen) return;
    isOpen = true; closing = null; returnTo = returnFocus;
    stop();
    dlg.classList.remove('leaving');
    dlg.showModal();
    drawPlate(!reduced);
    // Enter works at once; the ring appears only once the keyboard is used.
    document.getElementById('introGo').focus({ preventScroll: true, focusVisible: !!returnFocus });
    scroller.scrollTop = 0; updateScroll();
    if (reduced || !from) { dlg.classList.add('shown'); return; }
    dlg.classList.add('entering');
    const fr = from.getBoundingClientRect(), sr = sheet.getBoundingClientRect(), lr = lockup.getBoundingClientRect();
    // Sheet unfolds out of the lockup's origin; the frame shadow follows it in.
    run(sheet, [{ clipPath: insetFrom(fr, sr, 8), opacity: .4 }, { clipPath: 'inset(0px 0px 0px 0px round 14px)', opacity: 1 }], { duration: 720, easing: OUT });
    // From the boot cover the veil is already down (the bench never shows unveiled); on reopen it fades in.
    if (returnFocus) run(dlg.querySelector('.intro-veil'), [{ opacity: 0 }, { opacity: 1 }], { duration: 520, easing: 'ease-out' });
    run(dlg.querySelector('.intro-shade'), [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 320, easing: 'ease-out' });
    // The lockup itself travels from where it was.
    const ghost = lockup.cloneNode(true); ghost.classList.add('intro-ghost'); ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { left: lr.left + 'px', top: lr.top + 'px', width: lr.width + 'px', height: lr.height + 'px' });
    dlg.append(ghost);
    const dx = fr.left + fr.width / 2 - (lr.left + lr.width / 2), dy = fr.top + fr.height / 2 - (lr.top + lr.height / 2);
    run(lockup, [{ opacity: 0 }, { opacity: 0, offset: .999 }, { opacity: 1 }], { duration: 640 });
    run(ghost, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 640, easing: IN_OUT }).finished.then(() => ghost.remove(), () => ghost.remove());
    requestAnimationFrame(() => { dlg.classList.add('shown'); dlg.classList.remove('entering'); });
  }

  // action: 'enter' (primary), 'tour', or 'close' (Esc, close button, veil).
  function hide(action) {
    if (!isOpen || closing) return;
    closing = { action };
    if (reduced) { dlg.close(); return; }
    stop();
    dlg.classList.add('leaving');
    const mark = document.getElementById('brandBtn');
    const mr = mark?.getClientRects().length ? mark.getBoundingClientRect() : null;
    const sr = sheet.getBoundingClientRect();
    const target = mr ?? { top: sr.top + sr.height / 2, bottom: sr.top + sr.height / 2, left: sr.left + sr.width / 2, right: sr.left + sr.width / 2 };
    // Veil lifts first, so the workbench (and the camera move) show through at once.
    run(dlg.querySelector('.intro-veil'), [{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'ease-out' });
    run(dlg.querySelector('.intro-shade'), [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' });
    run(sheet, [{ clipPath: 'inset(0px 0px 0px 0px round 14px)', opacity: 1 }, { opacity: 1, offset: .6 }, { clipPath: insetFrom(target, sr, 8), opacity: 0 }], { duration: 460, easing: IN_OUT });
    if (mr) {
      const lr = lockup.querySelector('svg').getBoundingClientRect();
      const ghost = document.createElement('div'); ghost.className = 'intro-ghost mark-only'; ghost.setAttribute('aria-hidden', 'true');
      ghost.append(lockup.querySelector('svg').cloneNode(true));
      Object.assign(ghost.style, { left: lr.left + 'px', top: lr.top + 'px', width: lr.width + 'px', height: lr.height + 'px' });
      dlg.append(ghost);
      const mi = mark.querySelector('svg').getBoundingClientRect();
      const k = mi.width / lr.width;
      run(ghost, [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: .85 }, { transform: `translate(${mi.left - lr.left}px, ${mi.top - lr.top}px) scale(${k})`, opacity: 0 }], { duration: 460, easing: IN_OUT });
      mark.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: .4 }, { transform: 'scale(1)' }], { duration: 360, delay: 380, easing: 'ease-out' });
    }
    // The workbench reacts now (camera pull-back, tour), under the fold.
    closing.notified = true;
    onClose?.(action);
    setTimeout(() => { if (dlg.open) dlg.close(); else finish(action); }, 470);
  }

  function finish(action) {
    if (!isOpen) return;
    isOpen = false;
    stop();
    for (const g of dlg.querySelectorAll('.intro-ghost')) g.remove();
    dlg.classList.remove('shown', 'leaving', 'entering', 'drawn');
    const notify = !closing?.notified;
    closing = null;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    returnTo = null;
    if (notify) onClose?.(action);
  }

  // Blueprint of a fixed example specimen (the default preset), in millimetres.
  function drawPlate(animate) {
    const r = plate.getBoundingClientRect();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (!animate && key === plateKey) return;
    plateKey = key;
    plate.querySelector('svg')?.remove();
    const svg = blueprint(getSpec(), r.width, r.height);
    if (!svg) return;
    svg.classList.toggle('static', !animate);
    plate.append(svg);
    if (animate) { dlg.classList.remove('drawn'); requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('drawn'))); }
  }

  return {
    show, hide,
    get open() { return isOpen; },
    // Immediate close without motion (boot failure, QA).
    abort() { if (!isOpen) return; closing = { action: 'close' }; stop(); if (dlg.open) dlg.close(); else finish('close'); },
  };
}

// ------------------------------------------------------------ blueprint
// Plan view and elevation of a tablet with centre lines, projection lines,
// dimensions and the score callout. Drawn in CSS px from millimetres; stacked
// on tall plates, side by side on wide ones (phone portrait).
function blueprint(spec, w, h) {
  if (!spec || spec.kind !== 'tablet' || w < 80 || h < 80) return null;
  const R = spec.length / 2, Rw = spec.width / 2, H = spec.thickness;
  const sw = spec.score?.count ? spec.score.width : 0, sd = spec.score?.count ? spec.score.depth : 0;
  const wide = w / h > 1.35;
  // Layout in mm: plan centred on the origin; elevation below (tall) or right (wide).
  const ex = wide ? 2 * R + 3.4 : 0, ey = wide ? -H / 2 : Rw + 2.6;
  const dimY = ey + H + 1.5, dimX = ex + R + 1.3;
  const box = { x0: -R - 2.2, x1: dimX + 1.1, y0: -Rw - 2.2, y1: Math.max(Rw + .5, dimY + .9) };
  const padX = Math.max(14, w * .07), padTop = 40, padBottom = Math.max(14, h * .05);
  const s = Math.min((w - 2 * padX) / (box.x1 - box.x0), (h - padTop - padBottom) / (box.y1 - box.y0), 30);
  const ox = padX + ((w - 2 * padX) - (box.x1 - box.x0) * s) / 2 - box.x0 * s;
  const oy = padTop + ((h - padTop - padBottom) - (box.y1 - box.y0) * s) / 2 - box.y0 * s;
  const X = (x) => +(ox + x * s).toFixed(2), Y = (y) => +(oy + y * s).toFixed(2);
  const fs = Math.max(10, Math.min(12, s * .5));

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Example drawing of a scored round tablet: ${(2 * R).toFixed(2)} millimetres across, ${H.toFixed(2)} millimetres thick${sw ? `, score ${sw.toFixed(2)} by ${sd.toFixed(2)} millimetres` : ''}.`);
  const add =(tag, attrs, cls, delay) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (cls) el.setAttribute('class', attrs.pathLength ? cls + ' bp-draw' : cls);
    if (delay !== undefined) el.style.setProperty('--d', delay + 'ms');
    svg.append(el); return el;
  };
  // Outlines and dimensions draw on (pathLength); centre and projection lines keep their dash pattern and fade in.
  const line = (x1, y1, x2, y2, cls, delay) => add('path', { d: `M${X(x1)} ${Y(y1)}L${X(x2)} ${Y(y2)}`, ...(/bp-(cl|pj)/.test(cls) ? {} : { pathLength: 1 }) }, cls, delay);
  const text = (x, y, str, cls, delay, rot = 0, anchor = 'middle') => { const t = add('text', { x: X(x), y: Y(y), 'text-anchor': anchor, 'font-size': fs, ...(rot ? { transform: `rotate(${rot} ${X(x)} ${Y(y)})` } : {}) }, cls, delay); t.textContent = str; return t; };
  const arrow = (x, y, dir, delay) => { const a = .5 * s > 7 ? 7 / s : .5, b = a * .32; const [ux, uy] = dir; add('path', { d: `M${X(x)} ${Y(y)}L${X(x - ux * a - uy * b)} ${Y(y - uy * a + ux * b)}L${X(x - ux * a + uy * b)} ${Y(y - uy * a - ux * b)}Z` }, 'bp-tip', delay); };

  // Centre lines.
  line(-R - 1.2, 0, R + 1.2, 0, 'bp-cl', 120);
  line(0, -Rw - 1.2, 0, Rw + 1.2, 'bp-cl', 160);
  line(ex, ey - 1, ex, ey + H + 1, 'bp-cl', 200);
  // Plan outline, score and imprint.
  add('ellipse', { cx: X(0), cy: Y(0), rx: (R * s).toFixed(2), ry: (Rw * s).toFixed(2), pathLength: 1 }, 'bp-ol', 220);
  if (sw) {
    const c = Rw * Math.sqrt(1 - (sw / 2 / R) ** 2);
    line(-sw / 2, -c, -sw / 2, c, 'bp-ol thin', 520); line(sw / 2, -c, sw / 2, c, 'bp-ol thin', 560);
  }
  const imp = spec.imprint;
  if (imp && imp.layout === 'text' && imp.text) {
    const t = text(imp.offsetX || 0, imp.offsetY || 0, imp.text, 'bp-imp', 760, imp.rotation || 0);
    t.setAttribute('font-size', (imp.span * s / (.62 * imp.text.length + .1)).toFixed(1));
    t.setAttribute('dominant-baseline', 'central');
  }
  // Elevation: straight band, edge radius, score notch.
  const e = Math.max(spec.edgeRadius || 0, 1.2 / s), y0 = ey, y1 = ey + H;
  const notch = sw ? `L${X(ex - sw / 2)} ${Y(y0)}L${X(ex)} ${Y(y0 + sd)}L${X(ex + sw / 2)} ${Y(y0)}` : '';
  const arc = (x, y) => `A${(e * s).toFixed(2)} ${(e * s).toFixed(2)} 0 0 1 ${X(x)} ${Y(y)}`;
  add('path', { d: `M${X(ex - R + e)} ${Y(y0)}${notch}L${X(ex + R - e)} ${Y(y0)}${arc(ex + R, y0 + e)}L${X(ex + R)} ${Y(y1 - e)}${arc(ex + R - e, y1)}L${X(ex - R + e)} ${Y(y1)}${arc(ex - R, y1 - e)}L${X(ex - R)} ${Y(y0 + e)}${arc(ex - R + e, y0)}Z`, pathLength: 1 }, 'bp-ol', 380);
  // Projection lines from plan to elevation (stacked layout).
  if (!wide) { line(-R, 0, -R, y0 - .25, 'bp-pj', 420); line(R, 0, R, y0 - .25, 'bp-pj', 460); }
  // Width dimension below the elevation.
  line(ex - R, y1 + .35, ex - R, dimY + .5, 'bp-ext', 700); line(ex + R, y1 + .35, ex + R, dimY + .5, 'bp-ext', 700);
  line(ex - R, dimY, ex + R, dimY, 'bp-dm', 780); arrow(ex - R, dimY, [-1, 0], 900); arrow(ex + R, dimY, [1, 0], 900);
  text(ex, dimY - .3, `${spec.outline === 'round' ? 'Ø ' : ''}${(2 * R).toFixed(2)}`, 'bp-tx', 960);
  // Thickness dimension right of the elevation.
  line(ex + R + .3, y0, dimX + .45, y0, 'bp-ext', 740); line(ex + R + .3, y1, dimX + .45, y1, 'bp-ext', 740);
  line(dimX, y0, dimX, y1, 'bp-dm', 820); arrow(dimX, y0, [0, -1], 940); arrow(dimX, y1, [0, 1], 940);
  text(dimX + .42, (y0 + y1) / 2, H.toFixed(2), 'bp-tx', 1000, -90).setAttribute('dy', '0.8em');
  // Score callout on the plan.
  if (sw) {
    const kx = -R - 1.6, ky = -Rw - .9;
    add('path', { d: `M${X(-sw / 2 - .05)} ${Y(-Rw * .45)}L${X(-R * .62)} ${Y(ky)}L${X(kx)} ${Y(ky)}`, pathLength: 1 }, 'bp-dm', 860);
    add('circle', { cx: X(-sw / 2 - .05), cy: Y(-Rw * .45), r: 1.8 }, 'bp-tip', 860);
    text(kx, ky - .3, `score ${sw.toFixed(2)} × ${sd.toFixed(2)}`, 'bp-tx', 1040, 0, 'start');
  }
  return svg;
}
