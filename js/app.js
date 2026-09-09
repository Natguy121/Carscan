import { CARS, CARS_BY_ID, RARITY, displayName } from './cars.js';
import {
  detectCar, analyseDetection, inferBody, looksLikeCar, tokenize,
  getApiKey, setApiKey, hasApiKey, VisionError,
} from './vision.js';
import { rankCandidates, resolve } from './match.js';
import { startCamera, stopCamera, captureFrame, captureFromFile, isRunning, CameraError } from './camera.js';
import {
  getState, entryFor, isDiscovered, discoveredCount, wildIds, wildCount, completion,
  levelInfo, recordCatch, resetProgress, ACHIEVEMENTS, hasAchievement,
} from './state.js';
import { carCard, specSheet, candidateRow, achievementTile, rarityPill, esc } from './ui.js';

const $ = (sel) => document.querySelector(sel);

let capture = null;

// ------------------------------------------------------- wild (unlisted) cars

/** Stable id for a car the index has no entry for, so repeat sightings stack. */
function wildId(name) {
  const slug = tokenize(name).join('-') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `wild:${slug.replace(/^-+|-+$/g, '')}`;
}

/** Google returns one string; the card wants a make and a model. */
function splitName(name) {
  const trimmed = name.trim();
  const i = trimmed.indexOf(' ');
  return i === -1 ? { make: '', model: trimmed } : { make: trimmed.slice(0, i), model: trimmed.slice(i + 1) };
}

function wildCar(id, wild) {
  return { id, ...splitName(wild.name), name: wild.name, body: wild.body || 'sedan', rarity: 'wild', wild: true };
}

function wildCars() {
  return wildIds().map((id) => wildCar(id, entryFor(id)?.wild || { name: id.slice(5), body: 'sedan' }));
}

function nameMarkup(car) {
  return car.wild ? `<strong>${esc(car.name)}</strong>` : `${esc(car.make)} <strong>${esc(car.model)}</strong>`;
}
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

function evidenceChips(reading) {
  return reading.phrases
    .slice(0, 5)
    .map((p) => `<span class="chip">${esc(p.display)}</span>`)
    .join('');
}

function analysingMarkup() {
  return `
    <div class="analysing">
      <div class="radar"><span></span><span></span><span></span></div>
      <h2>Reading the car</h2>
      <p class="muted">Reverse-image searching your photo through Google Vision…</p>
      <div class="analysing-shot"><img src="${esc(capture.thumb)}" alt=""></div>
    </div>`;
}

async function onIdentify() {
  if (!capture) return;

  if (!hasApiKey()) {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict verdict-setup">
        <h2>Add a Google Vision key</h2>
        <p class="muted">
          CARSCAN identifies cars with Google Cloud Vision Web Detection — a reverse-image
          search across the web. Add a key in the Garage tab to start scanning.
        </p>
        <button class="btn btn-primary" data-goto="garage">Open settings</button>
      </div>`);
    return;
  }

  openOverlay('result', analysingMarkup());

  let detection;
  try {
    detection = await detectCar(capture.base64);
  } catch (err) {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict verdict-error">
        <h2>Scan failed</h2>
        <p class="muted">${esc(err instanceof VisionError ? err.message : 'Something went wrong talking to Google Vision.')}</p>
        <button class="btn btn-primary" data-close>Back</button>
      </div>`);
    return;
  }

  const reading = analyseDetection(detection);
  const candidates = rankCandidates(reading);
  lastResult = { ...resolve(reading, candidates), reading, detection };
  renderVerdict();
}

function renderVerdict() {
  const { status, car, candidates, reading, detectedName, detection } = lastResult;

  if (status === 'identified') {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict verdict-hit" data-rarity="${car.rarity}">
        <p class="verdict-kicker">Identified${isDiscovered(car.id) ? '' : ' — new to your index'}</p>
        <h2 class="verdict-name">${esc(car.make)} <strong>${esc(car.model)}</strong></h2>
        ${rarityPill(car.rarity)}
        <p class="verdict-sub">${esc(car.years)} · ${esc(car.engine)} · ${car.power} hp</p>
                <div class="evidence"><span class="muted small">Google saw</span>${evidenceChips(reading)}</div>
        <button class="btn btn-primary btn-lg" data-log="${esc(car.id)}">
          ${isDiscovered(car.id) ? 'Log this sighting' : 'Add to Cardex'}
        </button>
        <button class="btn btn-ghost" data-show-candidates>Not right? Choose another</button>
      </div>`);
    return;
  }

  if (status === 'ambiguous') {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict">
        <p class="verdict-kicker">Narrow it down</p>
        <h2>Close, but not certain</h2>
        <p class="muted">Google matched this to more than one car in the index. Pick the right one.</p>
                <div class="evidence"><span class="muted small">Google saw</span>${evidenceChips(reading)}</div>
        <div class="candidates">${candidates.map(candidateRow).join('')}</div>
        <button class="btn btn-ghost" data-manual>Search the index instead</button>
      </div>`);
    return;
  }

  // Google named something, and the frame really is a car: it still counts.
  if (detectedName && looksLikeCar(detection)) {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict verdict-hit" data-rarity="wild">
        <p class="verdict-kicker">Identified — no spec sheet on file</p>
        <h2 class="verdict-name"><strong>${esc(detectedName)}</strong></h2>
        ${rarityPill('wild')}
        <p class="verdict-sub">Not one of the ${CARS.length} cars the Cardex carries data for, but the catch counts.</p>
        <div class="evidence"><span class="muted small">Google saw</span>${evidenceChips(reading)}</div>
        <button class="btn btn-primary btn-lg" data-log-wild>Add to Cardex</button>
        <button class="btn btn-ghost" data-manual>Not right? Search the index</button>
      </div>`);
    return;
  }

  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict">
      <p class="verdict-kicker">No car found</p>
      <h2>Could not read a car</h2>
      <p class="muted">Try again with the whole car in frame and well lit.</p>
      ${reading.phrases.length ? `<div class="evidence"><span class="muted small">Google saw</span>${evidenceChips(reading)}</div>` : ''}
      <button class="btn btn-ghost" data-manual>Search the index instead</button>
    </div>`);
}

function renderManualPicker(query = '') {
  const q = query.trim().toLowerCase();
  const list = CARS
    .filter((c) => !q || displayName(c).toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
    .slice(0, 40);

  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict">
      <p class="verdict-kicker">Log it yourself</p>
      <h2>Search the index</h2>
      <input class="search" id="manual-search" type="search" placeholder="Make or model…" value="${esc(query)}" autocomplete="off">
      <div class="candidates">
        ${list.length
          ? list.map((car) => candidateRow({ car, confidence: 1 })).join('')
          : '<p class="muted">Nothing matches that.</p>'}
      </div>
    </div>`);
  const input = $('#manual-search');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// --------------------------------------------------------------- log a car

function logCar(carId, wild = null) {
  const car = wild ? wildCar(carId, wild) : CARS_BY_ID.get(carId);
  if (!car) return;

  const result = recordCatch(carId, {
    photo: capture?.thumb || null,
    color: capture?.color || null,
    wild,
  });

  renderHeader();
  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="reward" data-rarity="${car.rarity}">
      ${result.isNew ? '<p class="new-flag">NEW ENTRY</p>' : ''}
      <div class="reward-art">${capture ? `<img src="${esc(capture.thumb)}" alt="">` : ''}</div>
      <h2 class="verdict-name">${nameMarkup(car)}</h2>
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

function renderIndex() {
  const found = discoveredCount();
  const wild = wildCount();
  $('#index-progress').textContent =
    `${found} of ${CARS.length} discovered${wild ? ` · ${wild} wild` : ''}`;
  $('#completion-ring').style.setProperty('--pct', `${Math.round(completion() * 100)}%`);
  $('#completion-ring').dataset.label = `${Math.round(completion() * 100)}%`;

  const filters = [
    ['all', 'All'],
    ['found', 'Found'],
    ['missing', 'Missing'],
    ...Object.entries(RARITY).map(([k, v]) => [k, v.label]),
    ...(wild ? [['wild', 'Wild']] : []),
  ];
  $('#filters').innerHTML = filters
    .map(([key, label]) => `<button class="chip-btn${filter === key ? ' is-active' : ''}" data-filter="${key}">${esc(label)}</button>`)
    .join('');

  // Wild catches have no slot in the index, so they follow the known cars.
  const visible = [...CARS, ...wildCars()].filter((car) => {
    if (filter === 'all') return true;
    if (filter === 'found') return isDiscovered(car.id);
    if (filter === 'missing') return !car.wild && !isDiscovered(car.id);
    return car.rarity === filter;
  });

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
    ['Wild catches', wildCount()],
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

  $('#api-key').value = getApiKey();
}

// -------------------------------------------------------------- car detail

function openCar(carId) {
  const entry = entryFor(carId);
  const car = CARS_BY_ID.get(carId) || (entry?.wild && wildCar(carId, entry.wild));
  if (!car) return;
  openOverlay('detail', specSheet(car, entry));
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

  $('#btn-save-key').addEventListener('click', () => {
    const value = $('#api-key').value.trim();
    if (!setApiKey(value)) {
      toast('This browser blocked local storage, so the key cannot be saved.', 'error');
      return;
    }
    toast(value ? 'API key saved to this browser.' : 'API key removed.', 'success');
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
    const log = t.closest('[data-log]');
    if (log) return logCar(log.dataset.log);

    if (t.closest('[data-log-wild]')) {
      const name = lastResult.detectedName;
      const wild = { name, body: inferBody(lastResult.detection) };
      return logCar(wildId(name), wild);
    }

    const pick = t.closest('[data-pick]');
    if (pick) return logCar(pick.dataset.pick);

    if (t.closest('[data-show-candidates]')) {
      const list = lastResult?.candidates || [];
      if (!list.length) return renderManualPicker();
      openOverlay('result', `
        <button class="sheet-close" data-close aria-label="Close">✕</button>
        <div class="verdict">
          <p class="verdict-kicker">Other matches</p>
          <h2>Pick the right car</h2>
          <div class="candidates">${list.map(candidateRow).join('')}</div>
          <button class="btn btn-ghost" data-manual>Search the index instead</button>
        </div>`);
      return;
    }
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
  if (!hasApiKey()) {
    $('#stage-empty-sub').textContent =
      'Add a Google Vision API key in the Garage tab, then point the camera at a car.';
  }
}

init();
