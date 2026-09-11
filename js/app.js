import { CARS, CARS_BY_ID, RARITY, displayName } from './cars.js';
import { classifyImage, embedImage, looksLikeVehicle, inferBody, inferCharacter, topLabel, ClassifyError, warmUp } from './classify.js';
import { candidatesForBody } from './match.js';
import { remember, recall, memoryStats, forgetAll } from './memory.js';
import {
  hasPassword, setPassword, checkPassword, teachLogo, recallLogo,
  logoStats, forgetLogos, exportLogos, importLogos, loadSeedLogos,
} from './logos.js';
import { TRAIT_GROUPS, TRAITS_BY_ID, matchesAnswers, answersForBody, usefulTraits } from './traits.js';
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
let traitAnswers = new Map();  // trait id -> true (has it) / false (doesn't)
let traitsOpen = false;
let selectedMake = null;   // the exact make, read off the badge by the player
let makeQuery = '';        // what's typed in the badge box before a make is picked

// --------------------------------------------------------------- logo trainer
//
// Teaching the app what a badge looks like, from close-up photos, gated by a
// password that lives only in this browser (see js/logos.js for what that gate
// actually is and isn't). Session-only: reloading the page re-locks it.

let trainerUnlocked = false;
let trainerCapture = null; // { preview, thumb } for the badge photo being taught
let trainerMake = '';
let trainerNote = '';
let trainerError = '';

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

  // The app only learns when you tell it what it is looking at, so say so up
  // front rather than leaving the confirm step feeling like a failure to guess.
  const { cars: learnedCars } = memoryStats();
  if (shot) {
    $('#scan-note').textContent = 'One photo is all it takes.';
  } else if (learnedCars) {
    $('#scan-note').textContent = `Stand back and fit the whole car in frame. ${learnedCars} ${learnedCars === 1 ? 'car' : 'cars'} learned so far.`;
  } else {
    $('#scan-note').textContent = 'Stand back and fit the whole car in frame. Tell it what each car is and it learns to recognise that one itself.';
  }
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
      <div class="scan-frame">
        <img src="${esc(capture.preview)}" alt="">
        <div class="scan-grid"></div>
        <div class="scan-sweep"></div>
        <span class="scan-corner tl"></span><span class="scan-corner tr"></span>
        <span class="scan-corner bl"></span><span class="scan-corner br"></span>
      </div>
      <h2>Scanning</h2>
      <p class="muted">Reading the shape on this device — nothing leaves your phone.</p>
    </div>`;
}

/** Load a data URL into an <img> the model can read pixels from. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that photo.'));
    img.src = src;
  });
}

async function onIdentify() {
  if (!capture) return;

  openOverlay('result', analysingMarkup());

  let predictions;
  let embedding = null;
  try {
    const img = await loadImage(capture.preview);
    predictions = await classifyImage(img);
    embedding = await embedImage(img);
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
  const character = inferCharacter(predictions);
  const learned = embedding ? recall(embedding) : null;
  // A bonus signal from the logo trainer, if anything has been taught. Trained
  // photos are close-ups of just the badge, so this only really fires when a
  // scan happens to land close to the same framing — worth checking since it's
  // free, but it is not the app reading a logo out of an arbitrary photo.
  const logoMatch = embedding ? recallLogo(embedding) : null;
  // Everything the shape already settles is answered from the model's own guess,
  // but only when it was confident — a shaky guess auto-answered would quietly
  // rule out the right car.
  const trusted = Boolean(body) && confidence >= 0.6;
  traitAnswers = trusted ? answersForBody(body) : new Map();
  traitsOpen = false;
  selectedMake = null;
  makeQuery = '';
  lastResult = { predictions, body, confidence, character, label: topLabel(predictions), embedding, learned, logoMatch };
  renderVerdict();
}

const BODY_LABEL = {
  sedan: 'a sedan', coupe: 'a coupe', convertible: 'a convertible', hatchback: 'a hatchback',
  wagon: 'a wagon', suv: 'an SUV', pickup: 'a pickup truck', van: 'a van', minivan: 'a minivan',
};

/** Cars whose name or country contains the query. */
function searchCars(query, limit) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CARS
    .filter((c) => displayName(c).toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
    .slice(0, limit);
}

/**
 * Read the badge yourself. The model has no idea what a Toyota badge looks
 * like — it only ever guesses a shape — so the exact make comes from the
 * player's own eyes, not a computer-vision guess dressed up as one.
 *
 * Suggestions are drawn from whichever makes are still possible in `pool`, so
 * it can never suggest a make that answers or a picked make have already ruled
 * out, and it narrows the same way the traits do rather than filtering by name.
 */
function badgePicker(pool, logoMatch) {
  if (selectedMake) {
    return `
      <div class="badge-picked">
        <span class="trait-chip is-on">${esc(selectedMake)}</span>
        <button class="btn btn-ghost btn-small" data-clear-make>Not that make</button>
      </div>`;
  }

  const q = makeQuery.trim().toLowerCase();
  const makes = [...new Set(pool.map((c) => c.make))].sort((a, b) => a.localeCompare(b));
  const suggestions = q ? makes.filter((m) => m.toLowerCase().includes(q)).slice(0, 8) : [];

  // A trained-logo guess, offered as a question, never applied on its own —
  // it's only ever confident when a scan happens to frame the badge the way
  // the training photos did, so it's a hint worth a tap, not a claim.
  const logoHint = logoMatch && makes.includes(logoMatch.make)
    ? `<div class="badge-hint">
         <span class="muted small">Trained badge match:</span>
         <button class="trait-chip" data-pick-make="${esc(logoMatch.make)}">${esc(logoMatch.make)}?</button>
       </div>`
    : '';

  return `
    <div class="badge-picker">
      ${logoHint}
      <input class="search" id="badge-search" type="text" inputmode="text"
             placeholder="Read the badge? Type the make…" value="${esc(makeQuery)}" autocomplete="off">
      ${suggestions.length ? `
        <div class="trait-chips badge-suggestions">
          ${suggestions.map((m) => `<button class="trait-chip" data-pick-make="${esc(m)}">${esc(m)}</button>`).join('')}
        </div>` : ''}
    </div>`;
}

/**
 * The thirty things, for when the player can see something the model can't.
 * Shape is already filled in from the guess; the rest is theirs to tick.
 */
function answerPanel(pool) {
  const given = [...traitAnswers].map(([id, yes]) => ({ trait: TRAITS_BY_ID.get(id), yes })).filter((a) => a.trait);
  const offered = usefulTraits(pool, new Set(traitAnswers.keys()));

  const groups = TRAIT_GROUPS
    .map(([key, label]) => {
      const chips = offered.filter((t) => t.group === key);
      if (!chips.length) return '';
      return `
        <div class="trait-group">
          <p class="trait-group-label">${esc(label)}</p>
          <div class="trait-chips">
            ${chips.map((t) => {
              const answer = traitAnswers.get(t.id);
              const state = answer === true ? ' is-on' : answer === false ? ' is-off' : '';
              return `<button class="trait-chip${state}" data-trait="${esc(t.id)}"
                        aria-pressed="${answer === true}">${answer === false ? '✕ ' : ''}${esc(t.label)}</button>`;
            }).join('')}
          </div>
        </div>`;
    })
    .join('');

  const summary = given.length
    ? `<span class="trait-count">${CARS.length} → ${pool.length}</span>`
    : '<span class="trait-count muted">30 things to check</span>';

  return `
    <details class="traits"${traitsOpen ? ' open' : ''}>
      <summary>Narrow it down ${summary}</summary>
      ${groups}
      ${given.length ? '<button class="btn btn-ghost btn-small" data-clear-traits>Clear</button>' : ''}
    </details>`;
}

function renderVerdict(query = '') {
  const { body, label, confidence, character, learned, logoMatch } = lastResult;

  if (!looksLikeVehicle(lastResult.predictions)) {
    openOverlay('result', `
      <button class="sheet-close" data-close aria-label="Close">✕</button>
      <div class="verdict">
        <p class="verdict-kicker">Not sure</p>
        <h2>Couldn't tell if that's a car</h2>
        <p class="muted">A steep angle, a photo from above, or the car mostly hidden behind
          something can all throw it off — it isn't only for empty photos. If you can see the
          car, it's there; the model just couldn't confirm it.</p>
        <button class="btn btn-primary" data-manual>Yes, it's a car — let me pick it</button>
        <button class="btn btn-ghost" data-rescan>Retake instead</button>
      </div>`);
    return;
  }

  // No query means the body-style shortlist; typing searches the whole index,
  // which matters now the index is far too big to scroll.
  const searching = Boolean(query.trim());
  // A shaky body-style guess gets a longer shortlist, since it is likelier the
  // right car sits just outside the top few.
  const learnedCar = learned ? CARS_BY_ID.get(learned.carId) : null;

  // Answers and a read badge narrow the whole index, not just the shortlist —
  // that is what finds a car the body-style guess would never have surfaced.
  const fits = (car) => matchesAnswers(car, traitAnswers) && (!selectedMake || car.make === selectedMake);
  const narrowing = traitAnswers.size > 0 || Boolean(selectedMake);
  const pool = narrowing ? CARS.filter(fits) : CARS;
  const shortlistSize = narrowing ? 24 : (confidence >= 0.6 ? 8 : 12);

  let candidates;
  if (searching) {
    candidates = searchCars(query, 20).filter(fits);
  } else {
    candidates = candidatesForBody(body, shortlistSize, { ...catchHistory(), character: character?.character }, pool);
    // A car you have taught it outranks any guess made from the shape alone.
    if (learnedCar && fits(learnedCar)) {
      candidates = [learnedCar, ...candidates.filter((c) => c.id !== learnedCar.id)].slice(0, shortlistSize);
    }
  }

  const hedge = body && confidence < 0.6 ? ' Not certain, so the list is wider.' : '';
  // The character goes in the sentence because it visibly changes the order of
  // the list, and an unexplained reordering just looks like a bug.
  const CHARACTER_WORD = { sporty: 'sporty', workhorse: 'hard-working', family: 'family-sized' };
  const flavour = character ? `${CHARACTER_WORD[character.character]} ` : '';
  const guess = body
    ? `Looks like ${flavour ? `a ${flavour}${BODY_LABEL[body].replace(/^an? /, '')}` : BODY_LABEL[body]}${capture.color ? `, ${capture.color.toLowerCase()}` : ''}.${hedge}`
    : (capture.color ? `A ${capture.color.toLowerCase()} car — body style unclear.` : 'Body style unclear.');

  const intro = learnedCar
    ? `You taught me this one — it looks like the ${esc(displayName(learnedCar))}. Tap it if that's right, or pick another.`
    : `${esc(guess)} Pick the right one and I'll remember it, so next time I recognise it myself. Or narrow it down below.`;

  openOverlay('result', `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict">
      <p class="verdict-kicker">${learnedCar ? 'Recognised from memory' : esc(label || 'Car detected')}</p>
      <h2>${learnedCar ? 'Is this it?' : 'Which one is it?'}</h2>
      <p class="muted">${intro}</p>
      <input class="search" id="verdict-search" type="search" placeholder="Search all ${CARS.length} cars…"
             value="${esc(query)}" autocomplete="off">
      ${badgePicker(pool, logoMatch)}
      ${answerPanel(pool)}
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
  } else if (makeQuery) {
    const input = $('#badge-search');
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

  // Confirming the car is the training step: file this photo's fingerprint
  // under it so the next one like it is recognised without asking.
  const taught = lastResult?.embedding ? remember(carId, lastResult.embedding) : false;

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
      ${taught ? '<p class="taught">Learned — I\'ll recognise this one next time</p>' : ''}
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
    ['Cars learned', memoryStats().cars],
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

// --------------------------------------------------------------- logo trainer

const MAKES = [...new Set(CARS.map((c) => c.make))].sort((a, b) => a.localeCompare(b));

function trainerSetupMarkup() {
  return `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict trainer">
      <p class="verdict-kicker">Logo trainer</p>
      <h2>Set a password first</h2>
      <p class="muted">Nothing is sent anywhere — this password lives only in this browser and only
        keeps someone else who opens the app from filling the trainer with junk. It will not stop
        someone who opens developer tools, so don't reuse a real password here.</p>
      <input class="search" id="trainer-pw1" type="password" placeholder="New password (4+ characters)" autocomplete="new-password">
      <input class="search" id="trainer-pw2" type="password" placeholder="Type it again" autocomplete="new-password">
      ${trainerError ? `<p class="warn-line">${esc(trainerError)}</p>` : ''}
      <button class="btn btn-primary" data-trainer-setup>Set password</button>
    </div>`;
}

function trainerLockedMarkup() {
  return `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict trainer">
      <p class="verdict-kicker">Logo trainer</p>
      <h2>Enter the password</h2>
      <input class="search" id="trainer-pw" type="password" placeholder="Password" autocomplete="current-password">
      ${trainerError ? `<p class="warn-line">${esc(trainerError)}</p>` : ''}
      <button class="btn btn-primary" data-trainer-unlock>Unlock</button>
    </div>`;
}

function trainerUnlockedMarkup() {
  const { samples, makes } = logoStats();
  return `
    <button class="sheet-close" data-close aria-label="Close">✕</button>
    <div class="verdict trainer">
      <p class="verdict-kicker">Logo trainer</p>
      <h2>Teach a badge</h2>
      <p class="muted">${samples} photo${samples === 1 ? '' : 's'} learned across ${makes} make${makes === 1 ? '' : 's'}.
        Take a close, well-lit photo of just the badge — no need for the rest of the car.</p>

      <select class="search" id="trainer-make">
        <option value="">Which make is this?</option>
        ${MAKES.map((m) => `<option value="${esc(m)}"${m === trainerMake ? ' selected' : ''}>${esc(m)}</option>`).join('')}
      </select>

      ${trainerCapture
        ? `<div class="trainer-shot"><img src="${esc(trainerCapture.preview)}" alt="The badge photo"></div>
           <button class="btn btn-ghost btn-small" data-trainer-retake>Retake</button>`
        : `<button class="btn btn-ghost" data-trainer-upload>Upload a badge photo</button>`}

      ${trainerNote ? `<p class="taught">${esc(trainerNote)}</p>` : ''}

      <button class="btn btn-primary" data-trainer-teach ${trainerMake && trainerCapture ? '' : 'disabled'}>
        Teach this logo
      </button>

      <div class="trainer-tools">
        <button class="btn btn-ghost btn-small" data-trainer-export>Export trained set</button>
        <button class="btn btn-ghost btn-small" data-trainer-import>Import</button>
        <button class="btn btn-danger btn-small" data-trainer-forget>Forget all</button>
      </div>
      <button class="link-btn" data-trainer-lock>Lock trainer</button>
    </div>`;
}

function renderTrainer() {
  const html = !hasPassword() ? trainerSetupMarkup()
    : !trainerUnlocked ? trainerLockedMarkup()
      : trainerUnlockedMarkup();
  openOverlay('detail', html);
}

/** Fresh entry point: start from a clean slate rather than a stale error. */
function openTrainer() {
  trainerError = '';
  renderTrainer();
}

async function onTrainerSetup() {
  const pw1 = $('#trainer-pw1')?.value || '';
  const pw2 = $('#trainer-pw2')?.value || '';
  if (pw1 !== pw2) { trainerError = "Those don't match."; return renderTrainer(); }
  try {
    await setPassword(pw1);
  } catch (err) {
    trainerError = err.message;
    return renderTrainer();
  }
  trainerUnlocked = true;
  renderTrainer();
}

async function onTrainerUnlock() {
  const pw = $('#trainer-pw')?.value || '';
  if (!(await checkPassword(pw))) {
    trainerError = 'Wrong password.';
    return renderTrainer();
  }
  trainerUnlocked = true;
  renderTrainer();
}

async function onTrainerFile(file) {
  try {
    trainerCapture = await captureFromFile(file);
    trainerNote = '';
  } catch (err) {
    toast(err.message, 'error');
  }
  renderTrainer();
}

async function onTrainerTeach() {
  if (!trainerMake || !trainerCapture) return;
  const img = await loadImage(trainerCapture.preview);
  const embedding = await embedImage(img);
  if (!embedding) {
    trainerNote = "Could not read that photo — try again.";
    return renderTrainer();
  }
  teachLogo(trainerMake, embedding);
  const count = logoStats().perMake.get(trainerMake) || 0;
  trainerNote = `Learned ${trainerMake} (${count} photo${count === 1 ? '' : 's'} now).`;
  trainerCapture = null;
  renderTrainer();
}

function onTrainerExport() {
  const blob = new Blob([exportLogos()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'carscan-logos.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function onTrainerImportFile(file) {
  try {
    const added = importLogos(await file.text());
    trainerNote = `Imported ${added} photo${added === 1 ? '' : 's'}.`;
  } catch {
    trainerNote = "That file didn't look like a trained set.";
  }
  renderTrainer();
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

  $('#btn-logo-trainer').addEventListener('click', openTrainer);
  $('#logo-file-input').addEventListener('change', async (e) => {
    if (e.target.files[0]) await onTrainerFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#logo-import-input').addEventListener('change', async (e) => {
    if (e.target.files[0]) await onTrainerImportFile(e.target.files[0]);
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
    forgetAll();
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

    // The panel cycles a trait through yes → no → unanswered.
    const trait = t.closest('[data-trait]');
    if (trait) {
      const id = trait.dataset.trait;
      const current = traitAnswers.get(id);
      if (current === undefined) traitAnswers.set(id, true);
      else if (current === true) traitAnswers.set(id, false);
      else traitAnswers.delete(id);
      traitsOpen = true;
      return renderVerdict($('#verdict-search')?.value || '');
    }
    if (t.closest('[data-clear-traits]')) {
      traitAnswers.clear();
      traitsOpen = true;
      return renderVerdict($('#verdict-search')?.value || '');
    }

    const pickMake = t.closest('[data-pick-make]');
    if (pickMake) {
      selectedMake = pickMake.dataset.pickMake;
      makeQuery = '';
      return renderVerdict($('#verdict-search')?.value || '');
    }
    if (t.closest('[data-clear-make]')) {
      selectedMake = null;
      return renderVerdict($('#verdict-search')?.value || '');
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
      return;
    }

    if (t.closest('[data-trainer-setup]')) return onTrainerSetup();
    if (t.closest('[data-trainer-unlock]')) return onTrainerUnlock();
    if (t.closest('[data-trainer-upload]')) return $('#logo-file-input').click();
    if (t.closest('[data-trainer-retake]')) { trainerCapture = null; return renderTrainer(); }
    if (t.closest('[data-trainer-teach]')) return onTrainerTeach();
    if (t.closest('[data-trainer-export]')) return onTrainerExport();
    if (t.closest('[data-trainer-import]')) return $('#logo-import-input').click();
    if (t.closest('[data-trainer-forget]')) {
      forgetLogos();
      trainerNote = 'Forgot every trained badge.';
      return renderTrainer();
    }
    if (t.closest('[data-trainer-lock]')) {
      trainerUnlocked = false;
      trainerCapture = null;
      trainerNote = '';
      trainerError = '';
      return closeOverlay('detail');
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'manual-search') renderManualPicker(e.target.value);
    if (e.target.id === 'verdict-search') renderVerdict(e.target.value);
    if (e.target.id === 'badge-search') {
      makeQuery = e.target.value;
      renderVerdict($('#verdict-search')?.value || '');
    }
    if (e.target.id === 'trainer-make') {
      trainerMake = e.target.value;
      renderTrainer();
    }
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
  loadSeedLogos(); // badges shipped with the app itself, see data/logos.seed.json
}

init();
