// Drawing plans as SVG. Each SVG carries its own <style>, so the same markup
// works on screen and as an exported file with no stylesheet behind it.

import {
  solveRoom, polygonArea, perimeter, centroid, placePoints, bounds, unitVector,
} from './geometry.js';
import { formatLength, formatArea, gridStep } from './units.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const THEMES = {
  screen: { bg: '#0d1117', grid: 'rgba(255,255,255,.06)', wall: '#e6edf3', fill: 'rgba(56,189,248,.08)',
    fillSel: 'rgba(56,189,248,.2)', text: '#e6edf3', dim: '#8b949e', solved: '#fbbf24', accent: '#38bdf8', bad: '#f87171' },
  paper: { bg: '#ffffff', grid: '#eef1f4', wall: '#111111', fill: '#f6f8fa',
    fillSel: '#f6f8fa', text: '#111111', dim: '#555555', solved: '#555555', accent: '#111111', bad: '#b91c1c' },
};

/**
 * Everything about one room's shape, in plan space.
 * @returns {{ok:true, points, lengths, solved, area, perimeter, centre} | {ok:false, reason, points}}
 */
export function roomShape(room) {
  const solved = solveRoom(room.walls);
  if (!solved.ok) {
    return { ok: false, reason: solved.reason, points: placePoints(openPath(room.walls), room) };
  }
  const points = placePoints(solved.points, room);
  return {
    ok: true,
    points,
    lengths: solved.lengths,
    solved: solved.solved,
    error: solved.error,
    area: polygonArea(points),
    perimeter: perimeter(solved.lengths),
    centre: centroid(points),
  };
}

/** Corners of a not-yet-closed walk, using `fallback` for unmeasured walls. */
export function openPath(walls, fallback = 1) {
  const pts = [{ x: 0, y: 0 }];
  for (const w of walls) {
    const u = unitVector(w.heading);
    const p = pts[pts.length - 1];
    const l = w.length ?? fallback;
    pts.push({ x: p.x + u.x * l, y: p.y + u.y * l });
  }
  return pts;
}

function readableAngle(dx, dy) {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}

function fit(points, minSpan = 2) {
  const b = bounds(points);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, minSpan);
  const pad = span * 0.14 + 0.4;
  return {
    x: b.minX - pad, y: b.minY - pad,
    w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2,
    span,
  };
}

/** The viewBox planSvg would pick for this plan right now. */
export function planView(plan) {
  return fit(plan.rooms.flatMap((room) => roomShape(room).points));
}

function gridLines(view, step, color) {
  const out = [];
  const x0 = Math.floor(view.x / step) * step;
  const y0 = Math.floor(view.y / step) * step;
  for (let x = x0; x <= view.x + view.w; x += step) {
    out.push(`<line x1="${x}" y1="${view.y}" x2="${x}" y2="${view.y + view.h}"/>`);
  }
  for (let y = y0; y <= view.y + view.h; y += step) {
    out.push(`<line x1="${view.x}" y1="${y}" x2="${view.x + view.w}" y2="${y}"/>`);
  }
  // Width in plan units (metres): vector-effect isn't inherited by the lines
  // and is ignored when the SVG is drawn into an image for export anyway.
  return `<g stroke="${color}" stroke-width="${Math.max(view.span * 0.0015, 0.008)}">${out.join('')}</g>`;
}

function openingMarkup(o, a, b, centre, wallW, t) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!len) return '';
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const start = Math.max(0, Math.min(o.offset, len));
  const end = Math.max(start, Math.min(o.offset + o.width, len));
  const p = { x: a.x + ux * start, y: a.y + uy * start };
  const q = { x: a.x + ux * end, y: a.y + uy * end };
  // Inward normal: the side of the wall the room's centre is on.
  let nx = -uy;
  let ny = ux;
  if ((centre.x - p.x) * nx + (centre.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }

  const gap = `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${t.bg}" stroke-width="${wallW * 1.4}"/>`;
  if (o.type === 'window') {
    const h = wallW * 0.35;
    return `${gap}
      <line x1="${p.x + nx * h}" y1="${p.y + ny * h}" x2="${q.x + nx * h}" y2="${q.y + ny * h}" stroke="${t.wall}" stroke-width="${wallW * 0.18}"/>
      <line x1="${p.x - nx * h}" y1="${p.y - ny * h}" x2="${q.x - nx * h}" y2="${q.y - ny * h}" stroke="${t.wall}" stroke-width="${wallW * 0.18}"/>
      <line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${t.wall}" stroke-width="${wallW * 0.12}"/>`;
  }
  const w = end - start;
  const leaf = { x: p.x + nx * w, y: p.y + ny * w };
  const sweep = (ux * ny - uy * nx) > 0 ? 0 : 1;
  return `${gap}
    <line x1="${p.x}" y1="${p.y}" x2="${leaf.x}" y2="${leaf.y}" stroke="${t.wall}" stroke-width="${wallW * 0.25}"/>
    <path d="M ${leaf.x} ${leaf.y} A ${w} ${w} 0 0 ${sweep} ${q.x} ${q.y}" fill="none" stroke="${t.dim}" stroke-width="${wallW * 0.12}" stroke-dasharray="${wallW * 0.5} ${wallW * 0.4}"/>`;
}

/**
 * The whole floor as an SVG string.
 * @param {object} plan
 * @param {object} opts
 * @param {'metric'|'imperial'} [opts.unit]
 * @param {'screen'|'paper'} [opts.theme]
 * @param {string|null} [opts.selectedRoom]
 * @param {boolean} [opts.thumb] small preview: no labels, no grid
 * @param {boolean} [opts.interactive] add tap targets for walls and rooms
 * @param {object} [opts.view] a fixed viewBox (from planView), so the drawing
 *   doesn't rescale under your finger while a room is being dragged
 */
export function planSvg(plan, opts = {}) {
  const { unit = 'metric', theme = 'screen', selectedRoom = null, thumb = false, interactive = false } = opts;
  const t = THEMES[theme];
  const shapes = plan.rooms.map((room) => ({ room, shape: roomShape(room) }));
  const all = shapes.flatMap((s) => s.shape.points);
  if (!all.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6" class="plan-svg"><rect width="10" height="6" fill="${t.bg}"/></svg>`;
  }

  const view = opts.view || fit(all);
  const fs = Math.min(Math.max(view.span * 0.032, 0.16), 0.7);
  const wallW = Math.min(Math.max(view.span * 0.012, 0.08), 0.25);

  const parts = [];
  parts.push(`<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="${t.bg}"/>`);
  if (!thumb) parts.push(gridLines(view, gridStep(unit), t.grid));

  for (const { room, shape } of shapes) {
    const pts = shape.points;
    const sel = room.id === selectedRoom;
    if (!shape.ok) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
      parts.push(`<path d="${d}" fill="none" stroke="${t.bad}" stroke-width="${wallW}" stroke-dasharray="${wallW * 2} ${wallW}" stroke-linecap="round"${interactive ? ` data-room="${esc(room.id)}" class="room-body"` : ''}/>`);
      if (!thumb) {
        parts.push(`<text x="${pts[0].x}" y="${pts[0].y - fs}" font-size="${fs * 0.8}" fill="${t.bad}">${esc(room.name)}: ${esc(shape.reason)}</text>`);
      }
      continue;
    }

    const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
    parts.push(`<polygon points="${poly}" fill="${sel ? t.fillSel : t.fill}"${interactive ? ` data-room="${esc(room.id)}" class="room-body"` : ''}/>`);
    parts.push(`<polygon points="${poly}" fill="none" stroke="${sel ? t.accent : t.wall}" stroke-width="${wallW}" stroke-linejoin="miter" pointer-events="none"/>`);

    for (const o of room.openings || []) {
      const a = pts[o.wall];
      const b = pts[(o.wall + 1) % pts.length];
      if (a && b) parts.push(openingMarkup(o, a, b, shape.centre, wallW, t));
    }

    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (interactive) {
        parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="wall-hit" data-room="${esc(room.id)}" data-wall="${i}" stroke="transparent" stroke-width="${Math.max(wallW * 4, fs * 1.6)}"/>`);
      }
      if (thumb) return;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < fs * 2) return;
      // Label sits just outside the room, away from its centre.
      let nx = -(b.y - a.y) / len;
      let ny = (b.x - a.x) / len;
      if ((shape.centre.x - mx) * nx + (shape.centre.y - my) * ny > 0) { nx = -nx; ny = -ny; }
      const lx = mx + nx * fs * 1.1;
      const ly = my + ny * fs * 1.1;
      const worked = shape.solved.includes(i);
      parts.push(`<text x="${lx}" y="${ly}" font-size="${fs}" fill="${worked ? t.solved : t.dim}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${readableAngle(b.x - a.x, b.y - a.y)} ${lx} ${ly})" pointer-events="none">${worked ? '≈ ' : ''}${esc(formatLength(shape.lengths[i], unit))}</text>`);
    });

    if (!thumb) {
      const c = shape.centre;
      parts.push(`<text x="${c.x}" y="${c.y - fs * 0.35}" font-size="${fs * 1.15}" font-weight="700" fill="${t.text}" text-anchor="middle" pointer-events="none">${esc(room.name)}</text>`);
      parts.push(`<text x="${c.x}" y="${c.y + fs * 0.95}" font-size="${fs * 0.9}" fill="${t.dim}" text-anchor="middle" pointer-events="none">${esc(formatArea(shape.area, unit))}</text>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" class="plan-svg" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${parts.join('')}</svg>`;
}

/**
 * The room as it's being walked: walls captured so far, plus a live ghost
 * wall in whichever direction the phone points right now. A wall flagged
 * `worked` has a length the solver filled in, drawn dashed and marked ≈.
 */
export function scanPreviewSvg(walls, liveHeading, unit = 'metric', { overlay = false } = {}) {
  const t = overlay ? { ...THEMES.screen, bg: 'rgba(13,17,23,.35)', grid: 'rgba(255,255,255,.12)' } : THEMES.screen;
  const pts = openPath(walls);
  const end = pts[pts.length - 1];
  const ghostLen = 1;
  const ghost = liveHeading == null ? null : (() => {
    const u = unitVector(liveHeading);
    return { x: end.x + u.x * ghostLen, y: end.y + u.y * ghostLen };
  })();
  const view = fit(ghost ? [...pts, ghost] : pts, 3);
  const fs = Math.min(Math.max(view.span * 0.05, 0.16), 0.6);
  const wallW = Math.min(Math.max(view.span * 0.018, 0.06), 0.2);

  const parts = [`<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="${t.bg}"/>`];
  parts.push(gridLines(view, gridStep(unit), t.grid));

  walls.forEach((w, i) => {
    const a = pts[i];
    const b = pts[i + 1];
    const measured = w.length != null && !w.worked;
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${measured ? t.wall : t.solved}" stroke-width="${wallW}" stroke-linecap="round"${measured ? '' : ` stroke-dasharray="${wallW * 2} ${wallW * 1.5}"`}/>`);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const label = w.worked ? `≈ ${formatLength(w.length, unit)}` : measured ? formatLength(w.length, unit) : `wall ${i + 1}`;
    parts.push(`<text x="${mx}" y="${my - fs * 0.7}" font-size="${fs}" fill="${w.worked ? t.solved : t.dim}" text-anchor="middle">${esc(label)}</text>`);
  });

  const closes = walls.length >= 3 && Math.hypot(end.x - pts[0].x, end.y - pts[0].y) < 0.01;
  if (walls.length >= 2 && !closes) {
    parts.push(`<line x1="${end.x}" y1="${end.y}" x2="${pts[0].x}" y2="${pts[0].y}" stroke="${t.dim}" stroke-width="${wallW * 0.5}" stroke-dasharray="${wallW} ${wallW}"/>`);
  }
  if (ghost) {
    parts.push(`<line x1="${end.x}" y1="${end.y}" x2="${ghost.x}" y2="${ghost.y}" stroke="${t.accent}" stroke-width="${wallW}" stroke-linecap="round" opacity=".85"/>`);
    const u = unitVector(liveHeading);
    const s = wallW * 2.2;
    const nx = -u.y; const ny = u.x;
    parts.push(`<polygon points="${ghost.x + u.x * s},${ghost.y + u.y * s} ${ghost.x + nx * s},${ghost.y + ny * s} ${ghost.x - nx * s},${ghost.y - ny * s}" fill="${t.accent}"/>`);
  }
  parts.push(`<circle cx="${pts[0].x}" cy="${pts[0].y}" r="${wallW * 1.3}" fill="${t.accent}"/>`);

  const shadow = overlay ? ' style="filter:drop-shadow(0 0 2px rgba(0,0,0,.9))"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" class="plan-svg"${shadow} font-family="system-ui, -apple-system, Segoe UI, sans-serif">${parts.join('')}</svg>`;
}
