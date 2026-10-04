import { solveRoom, squareUp, rectangleWalls, normalizeDeg, bounds, turnBetween } from './geometry.js';
import { parseLength, formatLength, formatArea, formatVolume, lengthInputValue } from './units.js';
import { HeadingSensor, FLAT_LIMIT } from './sensors.js';
import {
  listPlans, getPlan, createPlan, savePlan, deletePlan, newRoom, newId, getSettings, saveSettings,
} from './store.js';
import { planSvg, planView, scanPreviewSvg, roomShape, openPath, esc } from './render.js';

const $ = (sel) => document.querySelector(sel);

let settings = getSettings();
let plan = null;          // the plan being edited
let selectedRoom = null;  // id of the highlighted room
let scan = null;          // the room being walked, while on the scan view
let sensor = null;
let sensorState = null;
let sheetKind = null;     // which bottom sheet is open, so unit changes can redraw it

const unit = () => settings.unit;
const SNAP_DISTANCE = 0.3;      // metres: corners this close click together when dragging
const SAME_WALL_WARNING = 12;   // degrees: a "new" wall this close to the last one is suspicious

// ------------------------------------------------------------------ helpers

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 400);
  }, 3400);
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (name !== 'scan') stopSensor();
  window.scrollTo({ top: 0 });
}

function openSheet(kind, html) {
  sheetKind = kind;
  $('#sheet').innerHTML = html;
  $('#sheet-overlay').hidden = false;
  document.body.classList.add('is-locked');
}

function closeSheet() {
  sheetKind = null;
  $('#sheet-overlay').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.classList.remove('is-locked');
}

/** Close whatever sheet is open — keeping a room's typed name and height. */
function dismissSheet() {
  if (sheetKind === 'room') {
    const id = $('[data-room-done]')?.dataset.roomDone;
    if (id) {
      saveRoomFields(id);
      renderPlan();
    }
  }
  closeSheet();
}

function renderUnits() {
  document.querySelectorAll('[data-unit]').forEach((b) => b.classList.toggle('is-on', b.dataset.unit === unit()));
}

function persist() {
  if (plan && !savePlan(plan)) toast("Couldn't save — this browser's storage is full.", 'error');
}

function roomById(id) {
  return plan?.rooms.find((r) => r.id === id) || null;
}

function lengthPlaceholder() {
  return unit() === 'imperial' ? `e.g. 12' 6"` : 'e.g. 3.45';
}

// --------------------------------------------------------------------- home

function renderHome() {
  const plans = listPlans();
  $('#plan-list').innerHTML = plans.length
    ? plans.map((p) => {
      const area = p.rooms.map(roomShape).filter((s) => s.ok).reduce((a, s) => a + s.area, 0);
      const when = new Date(p.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      return `
        <button class="plan-card" data-open-plan="${esc(p.id)}">
          <div class="plan-thumb">${p.rooms.length ? planSvg(p, { unit: unit(), thumb: true }) : '<span class="muted small">No rooms yet</span>'}</div>
          <div class="plan-meta">
            <strong>${esc(p.name)}</strong>
            <span class="muted small">${p.rooms.length} room${p.rooms.length === 1 ? '' : 's'} · ${esc(formatArea(area, unit()))}</span>
            <span class="muted small">${esc(when)}</span>
          </div>
        </button>`;
    }).join('')
    : `<div class="empty">
         <p><strong>No plans yet.</strong></p>
         <p class="muted">Start one, then scan your first room — it takes about a minute.</p>
       </div>`;
}

function openPlan(id) {
  plan = getPlan(id);
  if (!plan) return renderHome();
  selectedRoom = null;
  showView('plan');
  renderPlan();
}

// --------------------------------------------------------------------- plan

function renderPlan() {
  if (!plan) return;
  $('#plan-title').textContent = plan.name;
  renderCanvas();

  const shapes = plan.rooms.map((room) => ({ room, shape: roomShape(room) }));
  const total = shapes.filter((s) => s.shape.ok).reduce((a, s) => a + s.shape.area, 0);

  $('#plan-hint').textContent = plan.rooms.length
    ? `Tap a wall to change its length or add a door or window. Tap a room to rename or turn it.${plan.rooms.length > 1 ? ' Drag rooms to fit them together.' : ''}`
    : '';

  $('#plan-summary').innerHTML = plan.rooms.length ? `
    <div class="total"><span class="muted small">Total floor area</span><strong>${esc(formatArea(total, unit()))}</strong></div>
    <ul class="room-list">
      ${shapes.map(({ room, shape }) => `
        <li>
          <button class="room-row${room.id === selectedRoom ? ' is-on' : ''}" data-room-row="${esc(room.id)}">
            <span>${esc(room.name)}</span>
            ${shape.ok
              ? `<span class="muted small">${esc(formatArea(shape.area, unit()))} · ${esc(formatLength(shape.perimeter, unit()))} around</span>`
              : `<span class="warn small">${esc(shape.reason)}</span>`}
          </button>
        </li>`).join('')}
    </ul>` : '';
}

function renderCanvas(view = null) {
  $('#plan-canvas').innerHTML = plan.rooms.length
    ? planSvg(plan, { unit: unit(), selectedRoom, interactive: true, view })
    : `<div class="canvas-empty">
         <p><strong>No rooms yet</strong></p>
         <p class="muted small">Scan your first room below — or draw one by hand if you're not on a phone.</p>
       </div>`;
}

/** Put a new room to the right of everything already on the plan. */
function placeNewRoom(room) {
  const others = plan.rooms.flatMap((r) => roomShape(r).points);
  if (!others.length) return;
  const mine = roomShape(room).points;
  const b = bounds(others);
  const m = bounds(mine);
  room.x = b.maxX + 1 - m.minX;
  room.y = b.minY - m.minY;
}

function addRoomToPlan(room, note) {
  placeNewRoom(room);
  plan.rooms.push(room);
  selectedRoom = room.id;
  persist();
  showView('plan');
  renderPlan();
  const shape = roomShape(room);
  toast(note || `${room.name} added — ${formatArea(shape.area, unit())}`, 'success');
}

/** Corners within SNAP_DISTANCE of another room's corner click onto it. */
function snapRoom(room) {
  const mine = roomShape(room).points;
  let best = null;
  for (const other of plan.rooms) {
    if (other.id === room.id) continue;
    for (const q of roomShape(other).points) {
      for (const p of mine) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < SNAP_DISTANCE && (!best || d < best.d)) best = { d, dx: q.x - p.x, dy: q.y - p.y };
      }
    }
  }
  if (best) {
    room.x += best.dx;
    room.y += best.dy;
  }
}

// Pointer handling on the plan: a tap opens a wall or room, a drag moves a room.
let drag = null;

function onCanvasDown(e) {
  const hit = e.target.closest('.wall-hit') || e.target.closest('.room-body');
  if (!hit) return;
  const room = roomById(hit.dataset.room);
  if (!room) return;
  const svg = $('#plan-canvas svg');
  const ctm = svg?.getScreenCTM();
  drag = {
    room,
    wall: hit.classList.contains('wall-hit') ? Number(hit.dataset.wall) : null,
    sx: e.clientX,
    sy: e.clientY,
    ox: room.x,
    oy: room.y,
    scale: ctm ? 1 / ctm.a : 0.01,
    view: planView(plan),
    moved: false,
  };
  $('#plan-canvas').setPointerCapture(e.pointerId);
}

function onCanvasMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 8) return;
  drag.moved = true;
  selectedRoom = drag.room.id;
  drag.room.x = drag.ox + dx * drag.scale;
  drag.room.y = drag.oy + dy * drag.scale;
  snapRoom(drag.room);
  renderCanvas(drag.view);
}

function onCanvasUp() {
  if (!drag) return;
  const { room, wall, moved } = drag;
  drag = null;
  if (moved) {
    persist();
    renderPlan();
    return;
  }
  selectedRoom = room.id;
  renderPlan();
  if (wall != null) openWallSheet(room.id, wall);
  else openRoomSheet(room.id);
}

// ------------------------------------------------------------ wall editing

let wallNote = '';
let openingDraft = null; // { type, width, offset } while adding a door/window

function openWallSheet(roomId, index) {
  wallNote = '';
  openingDraft = null;
  renderWallSheet(roomId, index);
}

function renderWallSheet(roomId, index) {
  const room = roomById(roomId);
  if (!room) return closeSheet();
  const shape = roomShape(room);
  const wall = room.walls[index];
  const worked = shape.ok && shape.solved.includes(index);
  const actual = shape.ok ? shape.lengths[index] : wall.length;
  const unknowns = room.walls.filter((w) => w.length == null).length;
  const openings = (room.openings || []).map((o, i) => ({ o, i })).filter(({ o }) => o.wall === index);

  openSheet('wall', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <p class="kicker">${esc(room.name)}</p>
    <h2>Wall ${index + 1} of ${room.walls.length}</h2>
    ${worked ? `<p class="muted small">Worked out from the other walls: <strong>${esc(formatLength(actual, unit()))}</strong>. Measure it to be exact.</p>` : ''}
    ${!worked && shape.ok && Math.abs(actual - wall.length) > 0.005
      ? `<p class="muted small">Measured ${esc(formatLength(wall.length, unit()))}, adjusted to ${esc(formatLength(actual, unit()))} so the room closes.</p>` : ''}
    <label class="field">
      <span>Length</span>
      <input class="input" id="wall-length" inputmode="text" autocomplete="off"
             value="${esc(lengthInputValue(wall.length, unit()))}" placeholder="${esc(lengthPlaceholder())}">
    </label>
    ${wallNote ? `<p class="warn small">${esc(wallNote)}</p>` : ''}
    <div class="row">
      <button class="btn btn-primary" data-wall-save="${index}" data-room-id="${esc(room.id)}">Save length</button>
      ${wall.length != null && unknowns < 2
        ? `<button class="btn btn-ghost" data-wall-clear="${index}" data-room-id="${esc(room.id)}">Work it out instead</button>` : ''}
    </div>

    <h3>Doors &amp; windows</h3>
    ${openings.length ? `<ul class="openings">
      ${openings.map(({ o, i }) => `
        <li>
          <span>${o.type === 'door' ? 'Door' : 'Window'} · ${esc(formatLength(o.width, unit()))} wide, ${esc(formatLength(o.offset, unit()))} from the corner</span>
          <button class="btn btn-ghost btn-small" data-opening-delete="${i}" data-room-id="${esc(room.id)}" data-wall-index="${index}">Remove</button>
        </li>`).join('')}
    </ul>` : '<p class="muted small">None on this wall.</p>'}
    ${openingDraft ? `
      <div class="opening-form">
        <label class="field"><span>${openingDraft.type === 'door' ? 'Door' : 'Window'} width</span>
          <input class="input" id="opening-width" value="${esc(lengthInputValue(openingDraft.width, unit()))}" autocomplete="off"></label>
        <label class="field"><span>Distance from the corner</span>
          <input class="input" id="opening-offset" value="${esc(lengthInputValue(openingDraft.offset, unit()))}" autocomplete="off"></label>
        <div class="row">
          <button class="btn btn-primary" data-opening-add data-room-id="${esc(room.id)}" data-wall-index="${index}">Add ${openingDraft.type}</button>
          <button class="btn btn-ghost" data-opening-cancel data-room-id="${esc(room.id)}" data-wall-index="${index}">Cancel</button>
        </div>
      </div>` : `
      <div class="row">
        <button class="btn btn-ghost" data-opening-new="door" data-room-id="${esc(room.id)}" data-wall-index="${index}" ${shape.ok ? '' : 'disabled'}>+ Door</button>
        <button class="btn btn-ghost" data-opening-new="window" data-room-id="${esc(room.id)}" data-wall-index="${index}" ${shape.ok ? '' : 'disabled'}>+ Window</button>
      </div>`}
  `);
}

function onWallSave(roomId, index) {
  const room = roomById(roomId);
  const length = parseLength($('#wall-length').value, unit());
  if (!length) {
    wallNote = "That isn't a length I can read.";
    return renderWallSheet(roomId, index);
  }
  const before = room.walls[index].length;
  room.walls[index].length = length;
  const check = solveRoom(room.walls);
  if (!check.ok) {
    room.walls[index].length = before;
    wallNote = check.reason;
    return renderWallSheet(roomId, index);
  }
  persist();
  renderPlan();
  closeSheet();
}

function onWallClear(roomId, index) {
  const room = roomById(roomId);
  const before = room.walls[index].length;
  room.walls[index].length = null;
  const check = solveRoom(room.walls);
  if (!check.ok) {
    room.walls[index].length = before;
    wallNote = check.reason;
    return renderWallSheet(roomId, index);
  }
  persist();
  renderPlan();
  renderWallSheet(roomId, index);
}

function onOpeningNew(type, roomId, index) {
  const shape = roomShape(roomById(roomId));
  const wallLen = shape.lengths[index];
  const width = Math.min(type === 'door' ? 0.8 : 1.2, wallLen * 0.8);
  openingDraft = { type, width, offset: Math.max(0, (wallLen - width) / 2) };
  wallNote = '';
  renderWallSheet(roomId, index);
}

function onOpeningAdd(roomId, index) {
  const room = roomById(roomId);
  const shape = roomShape(room);
  const wallLen = shape.lengths[index];
  const width = parseLength($('#opening-width').value, unit());
  const offsetText = $('#opening-offset').value.trim();
  const offset = /^0+(\.0*)?\s*(m|cm|mm|ft|'|in|")?$/i.test(offsetText) ? 0 : parseLength(offsetText, unit());
  if (!width || offset == null) {
    wallNote = 'Enter a width and a distance from the corner.';
    return renderWallSheet(roomId, index);
  }
  if (offset + width > wallLen + 0.005) {
    wallNote = `That runs past the end of the wall (${formatLength(wallLen, unit())} long).`;
    return renderWallSheet(roomId, index);
  }
  room.openings = room.openings || [];
  room.openings.push({ id: newId(), type: openingDraft.type, wall: index, width, offset });
  openingDraft = null;
  wallNote = '';
  persist();
  renderPlan();
  renderWallSheet(roomId, index);
}

// ------------------------------------------------------------ room editing

let roomNote = '';

function openRoomSheet(roomId) {
  roomNote = '';
  renderRoomSheet(roomId);
}

function renderRoomSheet(roomId) {
  const room = roomById(roomId);
  if (!room) return closeSheet();
  const shape = roomShape(room);
  const h = room.height;
  const openingArea = (room.openings || []).reduce((a, o) => a + o.width * (o.type === 'door' ? 2.0 : 1.2), 0);

  openSheet('room', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <p class="kicker">Room</p>
    <label class="field"><span>Name</span>
      <input class="input" id="room-name" value="${esc(room.name)}" autocomplete="off" maxlength="40"></label>
    <label class="field"><span>Ceiling height <em class="muted">(optional)</em></span>
      <input class="input" id="room-height" value="${esc(lengthInputValue(h, unit()))}" placeholder="${unit() === 'imperial' ? `e.g. 8'` : 'e.g. 2.4'}" autocomplete="off"></label>
    ${shape.ok ? `
      <dl class="stats">
        <div><dt>Floor area</dt><dd>${esc(formatArea(shape.area, unit()))}</dd></div>
        <div><dt>Perimeter</dt><dd>${esc(formatLength(shape.perimeter, unit()))}</dd></div>
        ${h ? `
          <div><dt>Wall area</dt><dd>${esc(formatArea(Math.max(0, shape.perimeter * h - openingArea), unit()))}</dd></div>
          <div><dt>Volume</dt><dd>${esc(formatVolume(shape.area * h, unit()))}</dd></div>` : ''}
      </dl>
      ${h && openingArea ? '<p class="muted small">Wall area leaves out doors (2 m tall) and windows (1.2 m tall) — handy for paint.</p>' : ''}
    ` : `<p class="warn small">${esc(shape.reason)}</p>`}
    ${roomNote ? `<p class="warn small">${esc(roomNote)}</p>` : ''}
    <h3>Turn</h3>
    <div class="row">
      <button class="btn btn-ghost btn-small" data-rotate="-90" data-room-id="${esc(room.id)}">⟲ 90°</button>
      <button class="btn btn-ghost btn-small" data-rotate="-5" data-room-id="${esc(room.id)}">⟲ 5°</button>
      <button class="btn btn-ghost btn-small" data-rotate="5" data-room-id="${esc(room.id)}">⟳ 5°</button>
      <button class="btn btn-ghost btn-small" data-rotate="90" data-room-id="${esc(room.id)}">⟳ 90°</button>
    </div>
    <div class="row">
      <button class="btn btn-ghost" data-square-room="${esc(room.id)}">Square up corners</button>
      <button class="btn btn-danger" data-delete-room="${esc(room.id)}">Delete room</button>
    </div>
    <button class="btn btn-primary btn-wide" data-room-done="${esc(room.id)}">Done</button>
  `);
}

/** Read the name and height fields back into the room, if the sheet is open. */
function saveRoomFields(roomId) {
  const room = roomById(roomId);
  if (!room) return;
  const name = $('#room-name')?.value.trim();
  if (name) room.name = name;
  const heightText = $('#room-height')?.value.trim();
  if (heightText != null) room.height = heightText ? parseLength(heightText, unit()) : null;
  persist();
}

function onRotate(roomId, delta) {
  saveRoomFields(roomId);
  const room = roomById(roomId);
  const before = roomShape(room);
  room.rotation = normalizeDeg((room.rotation || 0) + delta);
  // Turn about the room's middle, not its first corner, so it stays put.
  const after = roomShape(room);
  if (before.ok && after.ok) {
    room.x += before.centre.x - after.centre.x;
    room.y += before.centre.y - after.centre.y;
  }
  persist();
  renderPlan();
  renderRoomSheet(roomId);
}

function onSquareRoom(roomId) {
  saveRoomFields(roomId);
  const room = roomById(roomId);
  const headings = squareUp(room.walls.map((w) => w.heading), 20);
  const candidate = room.walls.map((w, i) => ({ ...w, heading: headings[i] }));
  const check = solveRoom(candidate);
  if (!check.ok) {
    roomNote = check.reason;
    return renderRoomSheet(roomId);
  }
  room.walls = candidate;
  roomNote = '';
  persist();
  renderPlan();
  renderRoomSheet(roomId);
}

// ------------------------------------------------------------------- scanning
//
// Two ways to walk a room. "scan" reads each wall's direction off the phone's
// motion sensors; "manual" builds it from turn buttons, for a computer or a
// phone without sensors. Either way the room is a list of { heading, length }.

function startScan(mode) {
  scan = {
    mode,
    name: `Room ${plan.rooms.length + 1}`,
    walls: [],
    pending: null,   // sensor mode: a captured heading still waiting for its length
    ref: null,       // sensor mode: raw heading that maps to "first wall points right"
    turn: 90,        // manual mode: turn before the next wall, degrees (+ = right)
    error: '',
    status: mode === 'scan' ? 'starting' : 'manual',
    statusMessage: '',
    squareUp: true,
  };
  showView('scan');
  renderScan();
  if (mode === 'scan') startSensor();
}

async function startSensor() {
  sensorState = null;
  sensor = new HeadingSensor((s) => {
    sensorState = s;
    scheduleLive();
  });
  try {
    await sensor.start();
    if (scan) scan.status = 'live';
  } catch (err) {
    sensor = null;
    if (scan) {
      scan.status = 'failed';
      scan.statusMessage = err.message;
    }
  }
  renderScan();
}

function stopSensor() {
  sensor?.stop();
  sensor = null;
  sensorState = null;
}

let liveQueued = false;
function scheduleLive() {
  if (liveQueued) return;
  liveQueued = true;
  requestAnimationFrame(() => {
    liveQueued = false;
    renderScanLive();
  });
}

/** Direction the next wall would run, in the room's own frame. */
function liveHeading() {
  if (!scan) return null;
  if (scan.mode === 'manual') {
    return scan.walls.length ? normalizeDeg(scan.walls[scan.walls.length - 1].heading + scan.turn) : 90;
  }
  if (scan.pending != null || !sensorState) return null;
  return scan.ref == null ? sensorState.heading : normalizeDeg(sensorState.heading - scan.ref);
}

/** The walls as Finish would use them: squared up when that's switched on. */
function squaredWalls() {
  const walls = scan.walls.map((w) => ({ ...w }));
  if (scan.mode !== 'scan' || !scan.squareUp) return walls;
  const sq = squareUp(walls.map((w) => w.heading));
  return walls.map((w, i) => ({ ...w, heading: sq[i] }));
}

/** Once the walk so far closes into a room, show it closed — as Finish would. */
function previewWalls() {
  if (scan.pending != null) return [...scan.walls, { heading: scan.pending, length: null }];
  if (scan.walls.length >= 3) {
    const walls = squaredWalls();
    const solved = solveRoom(walls);
    if (solved.ok) {
      return walls.map((w, i) => ({ heading: w.heading, length: solved.lengths[i], worked: solved.solved.includes(i) }));
    }
  }
  return scan.walls;
}

function renderScanLive() {
  if (!scan) return;
  $('#scan-canvas').innerHTML = scanPreviewSvg(previewWalls(), liveHeading(), unit());

  const s = sensorState;
  const bubble = $('#level-bubble');
  if (!bubble || !s) return;
  const clamp = (v) => Math.max(-1, Math.min(1, v / FLAT_LIMIT));
  bubble.style.transform = `translate(${clamp(s.gamma ?? 0) * 22}px, ${clamp(s.beta ?? 0) * 22}px)`;
  bubble.classList.toggle('is-ok', s.flat && s.steady);
  $('#level-text').textContent = !s.flat ? 'Hold the phone flat' : !s.steady ? 'Hold still…' : 'Ready';
  const capture = $('#btn-capture-wall');
  if (capture) capture.disabled = !(s.flat && s.steady);
}

function renderScan() {
  if (!scan) return;
  $('#scan-title').textContent = scan.name;
  renderScanLive();

  const n = scan.walls.length;
  const unknowns = scan.walls.filter((w) => w.length == null).length;
  const canFinish = n >= 3 || (scan.mode === 'manual' && n >= 2 && unknowns === 0);
  const finish = canFinish && scan.pending == null
    ? `<button class="btn btn-ghost btn-wide" data-scan-finish>Finish room (${n} wall${n === 1 ? '' : 's'})</button>` : '';
  const error = scan.error ? `<p class="warn small">${esc(scan.error)}</p>` : '';
  const nameField = n === 0 && scan.pending == null ? `
    <label class="field"><span>Room name</span>
      <input class="input" id="scan-name" value="${esc(scan.name)}" maxlength="40" autocomplete="off"></label>` : '';

  const lengthStep = (label) => `
    <label class="field"><span>${label}</span>
      <input class="input input-big" id="scan-length" autocomplete="off" placeholder="${esc(lengthPlaceholder())}"></label>
    <div class="row">
      <button class="btn btn-primary" data-scan-add>Add wall</button>
      <button class="btn btn-ghost" data-scan-skip ${unknowns >= 2 ? 'disabled' : ''}>
        ${unknowns >= 2 ? 'Already working out 2' : 'Not measured — work it out'}</button>
    </div>`;

  let body;
  if (scan.mode === 'manual') {
    body = `
      ${nameField}
      ${n ? `
        <p class="step">Wall ${n + 1}: which way does it turn from wall ${n}?</p>
        <div class="row turn-row">
          ${[[-90, '↰ Left'], [90, '↱ Right'], [-45, '↖ 45° left'], [45, '↗ 45° right']].map(([deg, label]) => `
            <button class="btn btn-ghost btn-small${scan.turn === deg ? ' is-on' : ''}" data-scan-turn="${deg}">${label}</button>`).join('')}
        </div>` : '<p class="step">Wall 1 runs left to right along the top of the plan.</p>'}
      ${lengthStep(`Wall ${n + 1} length`)}
      ${n >= 2 && unknowns === 0 ? '<p class="muted small">Finishing adds the last wall back to the start for you.</p>' : ''}
      ${error}
      ${finish}`;
  } else if (scan.status === 'starting') {
    body = '<p class="step">Waiting for the motion sensors…</p>';
  } else if (scan.status === 'failed') {
    body = `
      <p class="warn">${esc(scan.statusMessage)}</p>
      <button class="btn btn-primary btn-wide" data-scan-retry>Try the sensors again</button>
      <button class="btn btn-ghost btn-wide" data-scan-manual>${n ? 'Finish the rest by hand' : 'Draw it by hand instead'}</button>`;
  } else if (scan.pending != null) {
    const prev = scan.walls[n - 1];
    const tooSimilar = prev && Math.abs(turnBetween(prev.heading, scan.pending)) < SAME_WALL_WARNING;
    body = `
      <p class="step">Wall ${n + 1} captured.</p>
      ${tooSimilar ? '<p class="warn small">That runs almost the same way as the last wall. If you meant the next wall, tap Retake and turn to face along it.</p>' : ''}
      ${lengthStep(`How long is wall ${n + 1}?`)}
      <button class="link-btn" data-scan-retake>Retake this wall</button>
      ${error}`;
  } else {
    body = `
      ${nameField}
      <p class="step">${n === 0
        ? "Go to any wall. Lay the phone flat, screen up, and press its long edge against the wall with the top pointing the way you'll walk."
        : `Walk to wall ${n + 1}, keeping the same way round, and press the phone against it the same way.`}</p>
      <div class="level">
        <div class="level-ring"><span class="level-bubble" id="level-bubble"></span></div>
        <strong id="level-text">Hold the phone flat</strong>
      </div>
      <button class="btn btn-primary btn-wide btn-capture" id="btn-capture-wall" data-scan-capture disabled>Capture wall ${n + 1}</button>
      ${n >= 3 ? `
        <label class="check"><input type="checkbox" id="scan-square" ${scan.squareUp ? 'checked' : ''}>
          Square up corners that are nearly 90°</label>` : ''}
      ${error}
      ${finish}`;
  }
  $('#scan-panel').innerHTML = body;
  renderScanLive();
  $('#scan-length')?.focus();
}

function readScanName() {
  const name = $('#scan-name')?.value.trim();
  if (name) scan.name = name;
}

function onScanCapture() {
  const s = sensorState;
  if (!s || !s.flat || !s.steady) return;
  readScanName();
  if (scan.ref == null) scan.ref = normalizeDeg(s.heading - 90);
  scan.pending = normalizeDeg(s.heading - scan.ref);
  scan.error = '';
  navigator.vibrate?.(25);
  renderScan();
}

function onScanAdd(measured) {
  readScanName();
  let length = null;
  if (measured) {
    length = parseLength($('#scan-length')?.value, unit());
    if (!length) {
      scan.error = "Type the wall's length, or tap “work it out” if you didn't measure it.";
      return renderScan();
    }
  }
  const heading = scan.mode === 'manual' ? liveHeading() : scan.pending;
  scan.walls.push({ heading, length });
  scan.pending = null;
  scan.error = '';
  renderScan();
}

function onScanUndo() {
  if (!scan) return;
  if (scan.pending != null) scan.pending = null;
  else scan.walls.pop();
  if (!scan.walls.length && scan.pending == null) scan.ref = null;
  scan.error = '';
  renderScan();
}

function onScanFinish() {
  readScanName();
  const walls = squaredWalls();

  if (scan.mode === 'manual' && walls.every((w) => w.length != null)) {
    const pts = openPath(walls);
    const end = pts[pts.length - 1];
    const gap = Math.hypot(end.x, end.y);
    if (gap > 0.02) {
      walls.push({ heading: normalizeDeg((Math.atan2(-end.x, end.y) * 180) / Math.PI), length: gap });
    }
  }

  const result = solveRoom(walls);
  if (!result.ok) {
    scan.error = result.reason;
    return renderScan();
  }
  const room = newRoom(scan.name, walls);
  const measuredTotal = walls.reduce((a, w) => a + (w.length ?? 0), 0);
  const note = result.error > Math.max(0.15, measuredTotal * 0.03)
    ? `${scan.name} added. The measurements were ${formatLength(result.error, unit())} off closing, so walls were adjusted — tap one to check it.`
    : null;
  scan = null;
  stopSensor();
  addRoomToPlan(room, note);
}

function onScanCancel() {
  if (scan && (scan.walls.length || scan.pending != null) && !confirm('Throw away this room?')) return;
  scan = null;
  stopSensor();
  showView('plan');
  renderPlan();
}

// -------------------------------------------------------------- rectangle

let rectNote = '';

function openRectSheet() {
  rectNote = '';
  renderRectSheet();
}

function renderRectSheet() {
  openSheet('rect', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <p class="kicker">Quick room</p>
    <h2>Rectangle</h2>
    <label class="field"><span>Name</span>
      <input class="input" id="rect-name" value="Room ${plan.rooms.length + 1}" maxlength="40" autocomplete="off"></label>
    <label class="field"><span>Width</span>
      <input class="input" id="rect-w" placeholder="${esc(lengthPlaceholder())}" autocomplete="off"></label>
    <label class="field"><span>Length</span>
      <input class="input" id="rect-d" placeholder="${esc(lengthPlaceholder())}" autocomplete="off"></label>
    ${rectNote ? `<p class="warn small">${esc(rectNote)}</p>` : ''}
    <button class="btn btn-primary btn-wide" data-rect-create>Add room</button>
  `);
  $('#rect-w').focus();
}

function onRectCreate() {
  const w = parseLength($('#rect-w').value, unit());
  const d = parseLength($('#rect-d').value, unit());
  if (!w || !d) {
    rectNote = 'Enter both a width and a length.';
    const name = $('#rect-name').value;
    renderRectSheet();
    $('#rect-name').value = name;
    return;
  }
  const room = newRoom($('#rect-name').value.trim() || `Room ${plan.rooms.length + 1}`, rectangleWalls(w, d));
  closeSheet();
  addRoomToPlan(room);
}

// ------------------------------------------------------------- plan details

function openRenameSheet() {
  openSheet('rename', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <p class="kicker">Plan</p>
    <label class="field"><span>Name</span>
      <input class="input" id="plan-name" value="${esc(plan.name)}" maxlength="60" autocomplete="off"></label>
    <button class="btn btn-primary btn-wide" data-plan-rename-save>Save</button>
    <button class="btn btn-danger btn-wide" data-plan-delete>Delete this plan</button>
  `);
}

// ------------------------------------------------------------------ export

function exportSheet() {
  openSheet('export', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <p class="kicker">Export</p>
    <h2>${esc(plan.name)}</h2>
    <button class="btn btn-primary btn-wide" data-export-png>Image (PNG)</button>
    <button class="btn btn-ghost btn-wide" data-export-svg>Drawing (SVG)</button>
    <button class="btn btn-ghost btn-wide" data-export-text>Copy room list</button>
    <p class="muted small">Exports are drawn black on white, ready to print or send.</p>
  `);
}

function fileName(ext) {
  return `${(plan.name || 'floor-plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'floor-plan'}.${ext}`;
}

async function deliverFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: plan.name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Some mobile browsers hand downloads off asynchronously; revoking at once
  // can leave them with an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportPng() {
  const view = planView(plan);
  const pxPerM = Math.min(160, 2400 / Math.max(view.w, view.h));
  const w = Math.round(view.w * pxPerM);
  const h = Math.round(view.h * pxPerM);
  const svg = planSvg(plan, { unit: unit(), theme: 'paper' }).replace('<svg ', `<svg width="${w}" height="${h}" `);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();

  const header = 90;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + header;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#111';
  g.font = '700 34px system-ui, sans-serif';
  g.fillText(plan.name, 32, 50);
  const total = plan.rooms.map(roomShape).filter((s) => s.ok).reduce((a, s) => a + s.area, 0);
  g.fillStyle = '#555';
  g.font = '22px system-ui, sans-serif';
  g.fillText(`${plan.rooms.length} room${plan.rooms.length === 1 ? '' : 's'} · ${formatArea(total, unit())}`, 32, 78);
  g.drawImage(img, 0, header, w, h);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  await deliverFile(blob, fileName('png'));
}

async function exportSvg() {
  const blob = new Blob([planSvg(plan, { unit: unit(), theme: 'paper' })], { type: 'image/svg+xml' });
  await deliverFile(blob, fileName('svg'));
}

function roomListText() {
  const lines = [plan.name, ''];
  let total = 0;
  for (const room of plan.rooms) {
    const s = roomShape(room);
    if (!s.ok) {
      lines.push(`${room.name}: incomplete`);
      continue;
    }
    total += s.area;
    lines.push(`${room.name}: ${formatArea(s.area, unit())} (${s.lengths.map((l) => formatLength(l, unit())).join(' × ')})`);
  }
  lines.push('', `Total: ${formatArea(total, unit())}`);
  return lines.join('\n');
}

async function exportText() {
  const text = roomListText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Room list copied.', 'success');
  } catch {
    openSheet('export-text', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <p class="kicker">Room list</p>
      <textarea class="input export-text" readonly rows="8" onclick="this.select()">${esc(text)}</textarea>
      <p class="muted small">Select all and copy.</p>`);
  }
}

// ------------------------------------------------------------------ wiring

function rerenderForUnits() {
  renderUnits();
  if (!$('#view-home').hidden) renderHome();
  if (!$('#view-plan').hidden) renderPlan();
  if (!$('#view-scan').hidden) renderScan();
  if (sheetKind) closeSheet();
}

function wire() {
  $('#btn-home').addEventListener('click', () => { showView('home'); renderHome(); });
  document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    settings = { ...settings, unit: b.dataset.unit };
    saveSettings(settings);
    rerenderForUnits();
  }));

  $('#btn-new-plan').addEventListener('click', () => {
    const p = createPlan(`Floor plan ${listPlans().length + 1}`);
    openPlan(p.id);
  });

  const canvas = $('#plan-canvas');
  canvas.addEventListener('pointerdown', onCanvasDown);
  canvas.addEventListener('pointermove', onCanvasMove);
  canvas.addEventListener('pointerup', onCanvasUp);
  canvas.addEventListener('pointercancel', () => { drag = null; renderPlan(); });

  document.addEventListener('click', (e) => {
    const t = e.target;
    const on = (sel) => t.closest(sel);
    let el;

    if (on('[data-close]')) return dismissSheet();
    if ((el = on('[data-open-plan]'))) return openPlan(el.dataset.openPlan);
    if (on('[data-go-home]')) { plan = null; showView('home'); return renderHome(); }
    if (on('[data-rename-plan]')) return openRenameSheet();
    if (on('[data-plan-rename-save]')) {
      plan.name = $('#plan-name').value.trim() || plan.name;
      persist();
      closeSheet();
      return renderPlan();
    }
    if (on('[data-plan-delete]')) {
      if (!confirm(`Delete “${plan.name}” and all its rooms? This can't be undone.`)) return;
      deletePlan(plan.id);
      plan = null;
      closeSheet();
      showView('home');
      return renderHome();
    }
    if (on('[data-export]')) {
      if (!plan.rooms.length) return toast('Add a room first.', 'warn');
      return exportSheet();
    }
    if (on('[data-export-png]')) {
      return exportPng().then(closeSheet, () => toast("Couldn't make the image.", 'error'));
    }
    if (on('[data-export-svg]')) return exportSvg().then(closeSheet);
    if (on('[data-export-text]')) return exportText();

    if ((el = on('[data-add-room]'))) {
      const kind = el.dataset.addRoom;
      if (kind === 'rect') return openRectSheet();
      return startScan(kind);
    }
    if (on('[data-rect-create]')) return onRectCreate();
    if ((el = on('[data-room-row]'))) {
      selectedRoom = el.dataset.roomRow;
      renderPlan();
      return openRoomSheet(selectedRoom);
    }

    // Wall sheet
    if ((el = on('[data-wall-save]'))) return onWallSave(el.dataset.roomId, Number(el.dataset.wallSave));
    if ((el = on('[data-wall-clear]'))) return onWallClear(el.dataset.roomId, Number(el.dataset.wallClear));
    if ((el = on('[data-opening-new]'))) return onOpeningNew(el.dataset.openingNew, el.dataset.roomId, Number(el.dataset.wallIndex));
    if ((el = on('[data-opening-add]'))) return onOpeningAdd(el.dataset.roomId, Number(el.dataset.wallIndex));
    if ((el = on('[data-opening-cancel]'))) {
      openingDraft = null;
      return renderWallSheet(el.dataset.roomId, Number(el.dataset.wallIndex));
    }
    if ((el = on('[data-opening-delete]'))) {
      const room = roomById(el.dataset.roomId);
      room.openings.splice(Number(el.dataset.openingDelete), 1);
      persist();
      renderPlan();
      return renderWallSheet(room.id, Number(el.dataset.wallIndex));
    }

    // Room sheet
    if ((el = on('[data-rotate]'))) return onRotate(el.dataset.roomId, Number(el.dataset.rotate));
    if ((el = on('[data-square-room]'))) return onSquareRoom(el.dataset.squareRoom);
    if ((el = on('[data-delete-room]'))) {
      const room = roomById(el.dataset.deleteRoom);
      if (!confirm(`Delete ${room.name}?`)) return;
      plan.rooms = plan.rooms.filter((r) => r.id !== room.id);
      selectedRoom = null;
      persist();
      closeSheet();
      return renderPlan();
    }
    if ((el = on('[data-room-done]'))) {
      saveRoomFields(el.dataset.roomDone);
      closeSheet();
      return renderPlan();
    }

    // Scanning
    if (on('[data-scan-capture]')) return onScanCapture();
    if (on('[data-scan-add]')) return onScanAdd(true);
    if (on('[data-scan-skip]')) return onScanAdd(false);
    if (on('[data-scan-retake]')) { scan.pending = null; return renderScan(); }
    if (on('[data-scan-undo]')) return onScanUndo();
    if (on('[data-scan-finish]')) return onScanFinish();
    if (on('[data-scan-cancel]')) return onScanCancel();
    if (on('[data-scan-retry]')) {
      scan.status = 'starting';
      renderScan();
      return startSensor();
    }
    if (on('[data-scan-manual]')) {
      // Walls already captured keep their angles; the rest continue by turns.
      stopSensor();
      scan.mode = 'manual';
      scan.status = 'manual';
      scan.pending = null;
      return renderScan();
    }
    if ((el = on('[data-scan-turn]'))) {
      readScanName();
      const typed = $('#scan-length')?.value;
      scan.turn = Number(el.dataset.scanTurn);
      renderScan();
      if (typed) $('#scan-length').value = typed;
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'scan-square' && scan) {
      scan.squareUp = e.target.checked;
      renderScanLive();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetKind) dismissSheet();
    if (e.key === 'Enter' && e.target.matches?.('input')) {
      const map = {
        'scan-length': '[data-scan-add]',
        'wall-length': '[data-wall-save]',
        'rect-d': '[data-rect-create]',
        'plan-name': '[data-plan-rename-save]',
        'opening-offset': '[data-opening-add]',
      };
      const btn = map[e.target.id] && $(map[e.target.id]);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  $('#sheet-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheet-overlay') dismissSheet();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSensor();
    else if (scan && scan.mode === 'scan' && scan.status === 'live') startSensor();
  });
}

wire();
renderUnits();
renderHome();
