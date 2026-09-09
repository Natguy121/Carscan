import { CARS, CARS_BY_ID, RARITY, displayName } from './cars.js';
import { classifyImage, looksLikeVehicle, inferBody, topLabel, ClassifyError, warmUp } from './classify.js';
import { candidatesForBody } from './match.js';
import { startCamera, stopCamera, captureFrame, captureFromFile, isRunning, CameraError } from './camera.js';
import {
  getState, entryFor, isDiscovered, discoveredCount, completion, catchHistory,
  levelInfo, recordCatch, resetProgress, ACHIEVEMENTS, hasAchievement,
} from './state.js';
import { carCard, specSheet, candidateRow, achievementTile, rarityPill, esc } from './ui.js';

const $ = (sel) => document.querySelector(sel);

let capture = null;
let filter = 'all';
let lastResult = null;

// ------------------------------------------------------------------ toasts

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 400);
  }, 3600);
}

// -------------------------------------------------------------- navigation

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  if (name !== 'scan') stopCamera();
  if (name === 'index') renderIndex();
  if (name === 'garage') renderGarage();
  window.scrollTo({ top: 0 });
}

function openOverlay(id, html) {
  const overlay = $(`#${id}-overlay`);
  $(`#${id}-sheet`).innerHTML = html;
  overlay.hidden = false;
  document.body.classList.add('is-locked');
}

function closeOverlay(id) {
  const overlay = $(`#${id}-overlay`);
  if (overlay.hidden) return;
  overlay.hidden = true;
  // Drop the markup too — sheets hold photo data URLs worth releasing.
  $(`#${id}-sheet`).innerHTML = '';
  if ($('#result-overlay').hidden && $('#detail-overlay').hidden) {
    document.body.classList.remove('is-locked');
  }
}

// ------------------------------------------------------------------- header

function renderHeader() {
  const { level, into, needed, progress } = levelInfo();
  $('#level-badge').textContent = `LV ${level}`;
  $('#xp-text').textContent = `${into} / ${needed} XP`;
  $('#xp-fill').style.width = `${Math.min(100, progress * 100)}%`;
}

// --------------------------------------------------------------- scan view

function renderScan() {
  const shot = Boolean(capture);
  $('#shot-preview').innerHTML = shot ? `<img src="${esc(capture.preview)}" alt="The car you photographed">` : '';
  $('#shot-preview').hidden = !shot;

  $('#btn-capture').hidden = shot;
  $('#btn-upload-trigger').hidden = shot;
  $('#btn-retake').hidden = !shot;

  $('#btn-identify').disabled = !shot;
  $('#scan-note').textContent = shot
    ? 'One photo is all it takes.'
    : 'Stand back and fit the whole car in frame.';
}

async function onStartCamera() {
  try {
    $('#stage-empty').hidden = true;
    await startCamera($('#cam'));
    $('#cam').classList.add('is-live');
    renderScan();
  } catch (err) {
    $('#stage-empty').hidden = false;
    $('#stage-empty-sub').textContent = err instanceof CameraError
      ? err.message
      : 'Could not start the camera. You can upload photos instead.';
    $('#btn-start-cam').textContent = 'Try again';
  }
}

function onCapture() {
  if (!isRunning()) {
    toast('Start the camera first, or upload a photo.', 'warn');
    return;
  }
  try {
    capture = captureFrame($('#cam'));
    renderScan();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onFile(file) {
  try {
    capture = await captureFromFile(file);
    renderScan();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ------------------------------------------------------------ identification

function analysingMarkup() {
  return `
    <div class="analysing">
      <div class="radar"><span></span><span></span><span></span></div>
      <h2>Looking at the photo</h2>
      <p class="muted">Recognising the car on this device — nothing leaves your phone.</p>
      <div class="analysing-shot"><img src="${esc(capture.thumb)}" alt=""></div>
    </div>`;
}

/** Load `capture.preview` into an <img> the model can read pixels from. */
function loadCaptureImage() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the captured photo.'));
    img.src = capture.preview;
  });
}

async function onIdentify() {
  if (!capture) return;

  openOverlay('result', analysingMarkup());

  let predictions;
  try {
    const img = await loadCaptureImage();
    predictions = await classifyImage(img);
  } catch (err) {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict verdict-error">
        <h2>Scan failed</h2>
        <p class="muted">${esc(err instanceof ClassifyError ? err.message : 'Something went wrong reading the photo.')}</p>
        <button class="btn btn-primary" data-close>Back</button>
      </div>`);
    return;
  }

  const { body, confidence } = inferBody(predictions);
  lastResult = { predictions, body, confidence, label: topLabel(predictions) };
  renderVerdict();
}

const BODY_LABEL = {
  sedan: 'sedan', coupe: 'coupe', convertible: 'convertible', hatchback: 'hatchback',
  wagon: 'wagon', suv: 'SUV', pickup: 'pickup truck', van: 'van', minivan: 'minivan',
};

/** Cars whose name or country contains the query. */
function searchCars(query, limit) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CARS
    .filter((c) => displayName(c).toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
    .slice(0, limit);
}

function renderVerdict(query = '') {
  const { body, label, confidence } = lastResult;

  if (!looksLikeVehicle(lastResult.predictions)) {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict">
        <p class="verdict-kicker">No car found</p>
        <h2>Could not spot a car in that photo</h2>
        <p class="muted">Try again with the whole car in frame and well lit.</p>
        <button class="btn btn-ghost" data-manual>Search the index instead</button>
      </div>`);
    return;
  }

  // No query means the body-style shortlist; typing searches the whole index,
  // which matters now the index is far too big to scroll.
  const searching = Boolean(query.trim());
  // A shaky body-style guess gets a longer shortlist, since it is likelier the
  // right car sits just outside the top few.
  const shortlistSize = confidence >= 0.6 ? 8 : 12;
  const candidates = searching
    ? searchCars(query, 20)
    : candidatesForBody(body, shortlistSize, catchHistory());
  const hedge = body && confidence < 0.6 ? ' Not certain, so the list is wider.' : '';
  const guess = body
    ? `Looks like a ${BODY_LABEL[body]}${capture.color ? `, ${capture.color.toLowerCase()}` : ''}.${hedge}`
    : (capture.color ? `A ${capture.color.toLowerCase()} car — body style unclear.` : 'Body style unclear.');

  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict">
      <p class="verdict-kicker">${esc(label || 'Car detected')}</p>
      <h2>Which one is it?</h2>
      <p class="muted">${esc(guess)} Recognition runs on this device, so it can't read the exact make and model — pick the right one, or search all ${CARS.length}.</p>
      <input class="search" id="verdict-search" type="search" placeholder="Search all ${CARS.length} cars…"
             value="${esc(query)}" autocomplete="off">
      <div class="candidates">
        ${candidates.length
          ? candidates.map((car) => candidateRow({ car })).join('')
          : '<p class="muted">Nothing matches that.</p>'}
      </div>
    </div>`);

  if (searching) {
    const input = $('#verdict-search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function renderManualPicker(query = '') {
  const list = query.trim() ? searchCars(query, 40) : candidatesForBody(null, 40, catchHistory());

  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict">
      <p class="verdict-kicker">Log it yourself</p>
      <h2>Search the index</h2>
      <input class="search" id="manual-search" type="search" placeholder="Search all ${CARS.length} cars…" value="${esc(query)}" autocomplete="off">
      <div class="candidates">
        ${list.length
          ? list.map((car) => candidateRow({ car })).join('')
          : '<p class="muted">Nothing matches that.</p>'}
      </div>
    </div>`);
  const input = $('#manual-search');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}


// --------------------------------------------------------------- log a car

function logCar(carId) {
  const car = CARS_BY_ID.get(carId);
  if (!car) return;

  const result = recordCatch(carId, {
    photo: capture?.thumb || null,
    color: capture?.color || null,
  });

  renderHeader();
  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="reward" data-rarity="${car.rarity}">
      ${result.isNew ? '<p class="new-flag">NEW ENTRY</p>' : ''}
      <div class="reward-art">${capture ? `<img src="${esc(capture.thumb)}" alt="">` : ''}</div>
      <h2 class="verdict-name">${esc(car.make)} <strong>${esc(car.model)}</strong></h2>
      ${rarityPill(car.rarity)}
      <div class="xp-gain">+${result.xp} XP</div>
      <ul class="xp-breakdown">
        ${result.breakdown.map((b) => `<li><span>${esc(b.label)}</span><em>+${b.value}</em></li>`).join('')}
      </ul>
      ${result.levelUp ? `<p class="levelup">Level ${result.levelUp} reached</p>` : ''}
      ${result.unlocked.length
        ? `<div class="unlocks">${result.unlocked.map((a) => `<span class="unlock">★ ${esc(a.name)}</span>`).join('')}</div>`
        : ''}
      <div class="reward-actions">
        <button class="btn btn-primary" data-rescan>Scan another</button>
        <button class="btn btn-ghost" data-view-car="${esc(car.id)}">View entry</button>
      </div>
    </div>`);

  capture = null;
  renderScan();
}

// -------------------------------------------------------------- index view

const RARITY_ORDER = Object.keys(RARITY);
const rarityRank = (car) => RARITY_ORDER.indexOf(car.rarity);

function renderIndex() {
  const found = discoveredCount();
  $('#index-progress').textContent = `${found} of ${CARS.length} discovered`;
  $('#completion-ring').style.setProperty('--pct', `${Math.round(completion() * 100)}%`);
  $('#completion-ring').dataset.label = `${Math.round(completion() * 100)}%`;

  const filters = [
    ['all', 'All'],
    ['found', 'Found'],
    ['missing', 'Missing'],
    ...Object.entries(RARITY).map(([k, v]) => [k, v.label]),
  ];
  $('#filters').innerHTML = filters
    .map(([key, label]) => `<button class="chip-btn${filter === key ? ' is-active' : ''}" data-filter="${key}">${esc(label)}</button>`)
    .join('');

  const visible = CARS
    .filter((car) => {
      if (filter === 'all') return true;
      if (filter === 'found') return isDiscovered(car.id);
      if (filter === 'missing') return !isDiscovered(car.id);
      return car.rarity === filter;
    })
    // Ordered by rarity so the grid reads commonest-first whatever order the
    // database happens to list cars in.
    .sort((a, b) => rarityRank(a) - rarityRank(b) || a.make.localeCompare(b.make));

  $('#grid').innerHTML = visible.length
    ? visible.map((car) => carCard(car, entryFor(car.id))).join('')
    : '<p class="muted empty">Nothing here yet.</p>';
}

// ------------------------------------------------------------- garage view

function renderGarage() {
  const state = getState();
  const { level } = levelInfo();
  const found = discoveredCount();
  const bestRarity = ['legendary', 'epic', 'rare', 'uncommon', 'common']
    .find((r) => Object.keys(state.entries).some((id) => CARS_BY_ID.get(id)?.rarity === r));

  $('#stats').innerHTML = [
    ['Level', level],
    ['Total XP', state.xp.toLocaleString()],
    ['Cars found', `${found} / ${CARS.length}`],
    ['Total scans', state.scans],
    ['Best find', bestRarity ? RARITY[bestRarity].label : '—'],
    ['Completion', `${Math.round(completion() * 100)}%`],
  ].map(([label, value]) => `<div class="stat"><span class="muted small">${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');

  $('#achievements').innerHTML = ACHIEVEMENTS
    .map((a) => achievementTile(a, hasAchievement(a.id)))
    .join('');

  $('#rarity-bars').innerHTML = Object.entries(RARITY).map(([key, meta]) => {
    const total = CARS.filter((c) => c.rarity === key).length;
    const got = CARS.filter((c) => c.rarity === key && isDiscovered(c.id)).length;
    return `
      <div class="rarity-row">
        <span class="pill" data-rarity="${key}">${esc(meta.label)}</span>
        <div class="bar"><div class="bar-fill" data-rarity="${key}" style="width:${total ? (got / total) * 100 : 0}%"></div></div>
        <span class="muted small">${got}/${total}</span>
      </div>`;
  }).join('');
}

// -------------------------------------------------------------- car detail

function openCar(carId) {
  const car = CARS_BY_ID.get(carId);
  if (!car) return;
  openOverlay('detail', specSheet(car, entryFor(carId)));
}

// ----------------------------------------------------------------- wiring

function wire() {
  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => showView(tab.dataset.view)));

  $('#btn-start-cam').addEventListener('click', onStartCamera);
  $('#btn-capture').addEventListener('click', onCapture);
  $('#btn-identify').addEventListener('click', onIdentify);
  $('#btn-retake').addEventListener('click', () => { capture = null; renderScan(); });

  $('#btn-upload-trigger').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    if (e.target.files[0]) await onFile(e.target.files[0]);
    e.target.value = '';
  });

  $('#filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    renderIndex();
  });

  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-car]');
    if (card) openCar(card.dataset.car);
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Erase your whole Cardex — every car, photo and level? This cannot be undone.')) return;
    resetProgress();
    renderHeader();
    renderGarage();
    renderIndex();
    toast('Progress reset.', 'success');
  });

  // Overlay actions are delegated so re-rendered sheets stay live.
  document.addEventListener('click', (e) => {
    const t = e.target;

    if (t.closest('[data-close]')) {
      closeOverlay('result');
      closeOverlay('detail');
      return;
    }
    if (t.closest('[data-goto]')) {
      closeOverlay('result');
      showView(t.closest('[data-goto]').dataset.goto);
      return;
    }
    const pick = t.closest('[data-pick]');
    if (pick) return logCar(pick.dataset.pick);

    if (t.closest('[data-manual]')) return renderManualPicker();

    if (t.closest('[data-rescan]')) {
      closeOverlay('result');
      showView('scan');
      return;
    }
    const viewCar = t.closest('[data-view-car]');
    if (viewCar) {
      closeOverlay('result');
      openCar(viewCar.dataset.viewCar);
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'manual-search') renderManualPicker(e.target.value);
    if (e.target.id === 'verdict-search') renderVerdict(e.target.value);
  });

  // Click the backdrop or press Escape to dismiss.
  ['result', 'detail'].forEach((id) => {
    $(`#${id}-overlay`).addEventListener('click', (e) => {
      if (e.target.id === `${id}-overlay`) closeOverlay(id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeOverlay('result'); closeOverlay('detail'); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
  });
}

function init() {
  wire();
  renderHeader();
  renderScan();
  renderIndex();
  warmUp();
}

init();
