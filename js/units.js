// Lengths are stored in metres and only converted for display and input, so
// switching units never rounds a plan.

const FT = 0.3048;
const IN = 0.0254;

/**
 * Read a length as typed off a tape measure. A bare number means metres in
 * metric mode and feet in imperial; anything with a unit means that unit.
 * Accepts "3.4", "3.4m", "340cm", "3400 mm", "11'6\"", "11' 6", "11ft 6in",
 * "11.5 ft", "138in", "11 6" (imperial: feet then inches).
 *
 * @returns {number|null} metres, or null when it isn't a usable length.
 */
export function parseLength(text, unit = 'metric') {
  const s = String(text ?? '').trim().toLowerCase().replace(/,/g, '.').replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return null;

  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/))) {
    const n = parseFloat(m[1]);
    return positive(m[2] === 'mm' ? n / 1000 : m[2] === 'cm' ? n / 100 : n);
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/))) {
    return positive(parseFloat(m[1]) * FT + (m[2] ? parseFloat(m[2]) * IN : 0));
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/))) {
    return positive(parseFloat(m[1]) * IN);
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
    const n = parseFloat(m[1]);
    return positive(unit === 'imperial' ? n * FT : n);
  }
  if (unit === 'imperial' && (m = s.match(/^(\d+)\s+(\d+(?:\.\d+)?)$/))) {
    return positive(parseFloat(m[1]) * FT + parseFloat(m[2]) * IN);
  }
  return null;
}

function positive(n) {
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatLength(metres, unit = 'metric') {
  if (metres == null || !Number.isFinite(metres)) return '?';
  if (unit === 'imperial') {
    let totalIn = Math.round(metres / IN);
    const ft = Math.floor(totalIn / 12);
    totalIn -= ft * 12;
    return `${ft}′ ${totalIn}″`;
  }
  return `${metres.toFixed(2)} m`;
}

/** The same length as plain editable text, e.g. for pre-filling an input. */
export function lengthInputValue(metres, unit = 'metric') {
  if (metres == null) return '';
  if (unit === 'imperial') {
    let totalIn = Math.round(metres / IN);
    const ft = Math.floor(totalIn / 12);
    totalIn -= ft * 12;
    return totalIn ? `${ft}' ${totalIn}"` : `${ft}'`;
  }
  return String(Math.round(metres * 100) / 100);
}

export function formatArea(m2, unit = 'metric') {
  if (unit === 'imperial') return `${Math.round(m2 / (FT * FT)).toLocaleString('en-US')} ft²`;
  return `${m2.toFixed(m2 < 100 ? 1 : 0)} m²`;
}

export function formatVolume(m3, unit = 'metric') {
  if (unit === 'imperial') return `${Math.round(m3 / (FT * FT * FT)).toLocaleString('en-US')} ft³`;
  return `${m3.toFixed(1)} m³`;
}

/** Grid spacing for the plan background, in metres: 1 m, or 2 ft. */
export function gridStep(unit = 'metric') {
  return unit === 'imperial' ? 2 * FT : 1;
}
