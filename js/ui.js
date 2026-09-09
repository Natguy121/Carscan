// Pure render helpers — every function returns an HTML string.

import { RARITY, BODIES, WILD, displayName } from './cars.js';
import { silhouette } from './silhouettes.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function rarityPill(rarity) {
  const r = RARITY[rarity] || WILD;
  return `<span class="pill" data-rarity="${rarity}">${esc(r.label)}</span>`;
}

export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** One tile in the Cardex grid. Undiscovered cars show a silhouette only. */
export function carCard(car, entry) {
  const found = Boolean(entry);
  const photo = entry?.photos?.[0];

  const art = found && photo
    ? `<img class="card-photo" src="${esc(photo)}" alt="${esc(displayName(car))} as you photographed it" loading="lazy">`
    : `<div class="card-art${found ? '' : ' is-locked'}">${silhouette(car.body, { className: 'sil' })}</div>`;

  return `
    <button class="card${found ? '' : ' is-locked'}" data-rarity="${car.rarity}" data-car="${esc(car.id)}"
            aria-label="${found ? esc(displayName(car)) : 'Undiscovered ' + esc(BODIES[car.body])}">
      <div class="card-media">
        ${art}
        ${found && entry.count > 1 ? `<span class="card-count">×${entry.count}</span>` : ''}
      </div>
      <div class="card-body">
        <span class="card-make">${found ? esc(car.make || 'Wild') : '???'}</span>
        <span class="card-model">${found ? esc(car.model) : esc(BODIES[car.body])}</span>
      </div>
      <span class="card-rarity" data-rarity="${car.rarity}"></span>
    </button>`;
}

function specRows(car) {
  const rows = [
    ['Engine', car.engine],
    ['Power', `${car.power} hp`],
    ['Torque', `${car.torque} lb-ft`],
    ['0–60 mph', `${Number.isInteger(car.zeroToSixty) ? car.zeroToSixty.toFixed(1) : car.zeroToSixty} s`],
    ['Top speed', `${car.topSpeed} mph`],
    ['Drivetrain', car.drivetrain],
    ['Transmission', car.transmission],
    ['Weight', `${car.weight.toLocaleString()} lb`],
    ['Power-to-weight', `${(car.power / (car.weight / 2000)).toFixed(0)} hp/ton`],
    [car.fuel === 'electric' ? 'Range' : 'Economy', car.fuel === 'electric' ? `${car.range} mi` : `${car.mpg} mpg`],
    ['Seats', String(car.seats)],
    ['Body', BODIES[car.body]],
    ['Built', car.years],
    ['Origin', car.country],
  ];
  return rows
    .map(([k, v]) => `<div class="spec"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
}

/** Full spec sheet for a car, including your own photos of it. */
export function specSheet(car, entry, { showClose = true } = {}) {
  const found = Boolean(entry);
  if (car.wild) return wildSheet(car, entry, showClose);
  const gallery = entry?.photos?.length
    ? `<div class="gallery">${entry.photos
        .map((p, i) => `<img src="${esc(p)}" alt="Angle ${i + 1} of your ${esc(displayName(car))}" loading="lazy">`)
        .join('')}</div>`
    : '';

  const caught = found
    ? `<div class="caught">
         <div><span class="muted small">First caught</span><strong>${formatDate(entry.firstSeen)}</strong></div>
         <div><span class="muted small">Sightings</span><strong>${entry.count}</strong></div>
         <div><span class="muted small">Colours seen</span><strong>${entry.colors?.length ? esc(entry.colors.join(', ')) : '—'}</strong></div>
       </div>`
    : `<p class="undiscovered-note">Not yet in your index. Scan one to unlock its full specification.</p>`;

  return `
    ${showClose ? '<button class="sheet-close" data-close aria-label="Close">✕</button>' : ''}
    <div class="sheet-head" data-rarity="${car.rarity}">
      <div class="sheet-art">${silhouette(car.body, { className: 'sil' })}</div>
      <div>
        ${rarityPill(car.rarity)}
        <h2 class="sheet-title">${esc(car.make)} <strong>${esc(car.model)}</strong></h2>
        <p class="sheet-sub">${esc(car.years)} · ${esc(car.country)} · ${esc(BODIES[car.body])}</p>
      </div>
    </div>
    ${gallery}
    <p class="blurb">${esc(car.blurb)}</p>
    ${caught}
    <h3 class="section-title">Specifications</h3>
    <dl class="specs">${specRows(car)}</dl>`;
}

/** A candidate the player can tap to confirm when Vision is not certain. */
export function candidateRow(candidate) {
  const { car, confidence } = candidate;
  return `
    <button class="candidate" data-pick="${esc(car.id)}" data-rarity="${car.rarity}">
      <div class="candidate-art">${silhouette(car.body, { className: 'sil' })}</div>
      <div class="candidate-text">
        <strong>${esc(displayName(car))}</strong>
        <span class="muted small">${esc(car.years)} · ${esc(car.engine)}</span>
      </div>
      <div class="candidate-meta">
        ${rarityPill(car.rarity)}
        <span class="conf" style="--conf:${Math.round(confidence * 100)}%">${Math.round(confidence * 100)}%</span>
      </div>
    </button>`;
}

export function achievementTile(achievement, unlocked) {
  return `
    <div class="achievement${unlocked ? ' is-unlocked' : ''}">
      <span class="achievement-ico">${unlocked ? '★' : '☆'}</span>
      <strong>${esc(achievement.name)}</strong>
      <span class="muted small">${esc(achievement.hint)}</span>
    </div>`;
}

/**
 * A car Google named that the index has no spec sheet for. It still earns a
 * real entry — your photo, the colour, the date — just without the numbers.
 */
function wildSheet(car, entry, showClose) {
  const photo = entry?.photos?.[0];
  return `
    ${showClose ? '<button class="sheet-close" data-close aria-label="Close">✕</button>' : ''}
    <div class="sheet-head" data-rarity="wild">
      <div class="sheet-art">${silhouette(car.body, { className: 'sil' })}</div>
      <div>
        ${rarityPill('wild')}
        <h2 class="sheet-title"><strong>${esc(car.name)}</strong></h2>
        <p class="sheet-sub">${esc(BODIES[car.body])} · identified by Google</p>
      </div>
    </div>
    ${photo ? `<div class="gallery"><img src="${esc(photo)}" alt="Your photo of the ${esc(car.name)}" loading="lazy"></div>` : ''}
    <div class="caught">
      <div><span class="muted small">First caught</span><strong>${formatDate(entry?.firstSeen)}</strong></div>
      <div><span class="muted small">Sightings</span><strong>${entry?.count ?? 0}</strong></div>
      <div><span class="muted small">Colours seen</span><strong>${entry?.colors?.length ? esc(entry.colors.join(', ')) : '—'}</strong></div>
    </div>
    <p class="undiscovered-note">
      Specifications are not on file — this one is not among the cars the Cardex
      carries full data for. The catch still counts.
    </p>`;
}
