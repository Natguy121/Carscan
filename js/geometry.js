// Turning a walk around a room into a floor plan.
//
// A room is a loop of walls, each with a heading (degrees clockwise from "up"
// on the plan) and a length in metres. Headings come from the phone's motion
// sensors or from turn buttons; lengths come from a tape measure — or are left
// blank, because a closed loop has two equations' worth of slack and can work
// out two missing walls on its own.
//
// Plan coordinates are screen-style: x to the right, y downward.

const EPS = 1e-9;

export function normalizeDeg(d) {
  return ((d % 360) + 360) % 360;
}

/** Signed turn from heading a to heading b, in (-180, 180]. */
export function turnBetween(a, b) {
  const t = normalizeDeg(b - a);
  return t > 180 ? t - 360 : t;
}

export function unitVector(heading) {
  const r = (heading * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

/**
 * Snap headings that are within `tolerance` of a right-angle grid onto it.
 * The grid is aligned to the room's own dominant direction (averaging 4×angle
 * so 0°, 90°, 180° and 270° all count as agreeing), not to north — a room
 * built at 17° to the compass is still a rectangle.
 */
export function squareUp(headings, tolerance = 12) {
  if (!headings.length) return [];
  let sx = 0;
  let sy = 0;
  for (const h of headings) {
    const r = (normalizeDeg(h) * 4 * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const base = normalizeDeg((Math.atan2(sy, sx) * 180) / Math.PI / 4);
  return headings.map((h) => {
    const offset = turnBetween(base, h);
    const snapped = Math.round(offset / 90) * 90;
    return Math.abs(offset - snapped) <= tolerance ? normalizeDeg(base + snapped) : normalizeDeg(h);
  });
}

function sumVectors(walls, lengths) {
  let x = 0;
  let y = 0;
  walls.forEach((w, i) => {
    const u = unitVector(w.heading);
    x += u.x * lengths[i];
    y += u.y * lengths[i];
  });
  return { x, y };
}

/**
 * Close the loop by nudging lengths only, keeping every heading — so a
 * squared-up rectangle measured 4.00 on one side and 4.05 on the other comes
 * out a true 4.025 rectangle rather than a slightly bent one. Weighted least
 * squares: longer walls absorb more of the error, since a tape over 6 m is
 * likelier to be off than one over 1 m.
 */
function adjustLengths(walls, lengths) {
  const err = sumVectors(walls, lengths);
  if (Math.hypot(err.x, err.y) < 1e-6) return lengths.slice();

  const u = walls.map((w) => unitVector(w.heading));
  const wgt = lengths.map((l) => Math.max(l, 0.01));
  let a = 0; let b = 0; let d = 0;
  u.forEach((v, i) => {
    a += wgt[i] * v.x * v.x;
    b += wgt[i] * v.x * v.y;
    d += wgt[i] * v.y * v.y;
  });
  const det = a * d - b * b;
  if (Math.abs(det) < EPS) return null;
  const lx = (d * -err.x - b * -err.y) / det;
  const ly = (a * -err.y - b * -err.x) / det;
  const out = lengths.map((l, i) => l + wgt[i] * (u[i].x * lx + u[i].y * ly));
  return out.every((l) => l > 0) ? out : null;
}

/**
 * Solve a room: fill in up to two missing lengths, close the loop, and return
 * its corners.
 *
 * @param {{heading:number, length:number|null}[]} walls
 * @returns {{ok:true, points:{x,y}[], lengths:number[], solved:number[], error:number}
 *          |{ok:false, reason:string}}
 *   `solved` lists the walls whose length was worked out rather than measured;
 *   `error` is how far the measured loop missed closing before adjustment (m).
 */
export function solveRoom(walls) {
  if (walls.length < 3) return { ok: false, reason: 'A room needs at least 3 walls.' };
  const unknown = walls.map((w, i) => (w.length == null ? i : -1)).filter((i) => i >= 0);
  if (unknown.length > 2) {
    return { ok: false, reason: `Measure at least ${walls.length - 2} of the ${walls.length} walls — only two can be worked out.` };
  }
  if (walls.some((w) => w.length != null && !(w.length > 0))) {
    return { ok: false, reason: 'Every measured wall needs a length above zero.' };
  }

  const lengths = walls.map((w) => w.length ?? 0);
  const known = sumVectors(walls, lengths);
  let error = 0;

  if (unknown.length === 2) {
    const [i, j] = unknown;
    const ui = unitVector(walls[i].heading);
    const uj = unitVector(walls[j].heading);
    const det = ui.x * uj.y - ui.y * uj.x;
    if (Math.abs(det) < 1e-6) {
      return { ok: false, reason: `Walls ${i + 1} and ${j + 1} are parallel, so neither can be worked out from the other — measure one of them.` };
    }
    const a = (-known.x * uj.y + known.y * uj.x) / det;
    const b = (ui.x * -known.y - ui.y * -known.x) / det;
    if (a <= 0.01 || b <= 0.01) {
      return { ok: false, reason: "Those angles and lengths don't make a closed room — check the wall directions." };
    }
    lengths[i] = a;
    lengths[j] = b;
  } else if (unknown.length === 1) {
    const k = unknown[0];
    const u = unitVector(walls[k].heading);
    const l = -(known.x * u.x + known.y * u.y);
    if (l <= 0.01) {
      return { ok: false, reason: `Wall ${k + 1} can't close this room — check the wall directions.` };
    }
    lengths[k] = l;
    const miss = sumVectors(walls, lengths);
    error = Math.hypot(miss.x, miss.y);
  } else {
    error = Math.hypot(known.x, known.y);
  }

  const closed = adjustLengths(walls, lengths);
  if (!closed) return { ok: false, reason: "The walls don't close into a room — check the wall directions." };

  const points = [{ x: 0, y: 0 }];
  for (let i = 0; i < walls.length - 1; i++) {
    const u = unitVector(walls[i].heading);
    const p = points[i];
    points.push({ x: p.x + u.x * closed[i], y: p.y + u.y * closed[i] });
  }
  return { ok: true, points, lengths: closed, solved: unknown, error };
}

/** Shoelace area, always positive whichever way round the walk went. */
export function polygonArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function perimeter(lengths) {
  return lengths.reduce((a, b) => a + b, 0);
}

/** Area-weighted centre, for placing a room's name label. */
export function centroid(points) {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < EPS) {
    const n = points.length || 1;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Rotate then translate a room's local corners into plan space. */
export function placePoints(points, { x = 0, y = 0, rotation = 0 } = {}) {
  const r = (rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return points.map((p) => ({ x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c }));
}

export function bounds(points) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Walls for a plain rectangle, walked clockwise from the top-left corner. */
export function rectangleWalls(width, depth) {
  return [
    { heading: 90, length: width },
    { heading: 180, length: depth },
    { heading: 270, length: width },
    { heading: 0, length: depth },
  ];
}
