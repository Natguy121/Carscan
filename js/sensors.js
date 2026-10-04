// Reading which way a wall runs from the phone's motion sensors.
//
// The phone is held flat (screen up) with its long edge pressed against the
// wall, so the direction its top points is the direction the wall runs. That
// direction comes from `alpha` — rotation about the axis through the screen —
// which on both iOS and Android is fused from the gyroscope rather than read
// raw off the magnetometer, so the steel and wiring inside walls don't swing
// it the way they swing a compass needle. It is relative to wherever the phone
// started, which is fine: a floor plan only needs the angles between walls.

/** Heading of the phone's top edge, degrees clockwise, from an orientation event. */
export function headingFromEvent(e, screenAngle = 0) {
  if (e == null || e.alpha == null) return null;
  return (((360 - e.alpha + screenAngle) % 360) + 360) % 360;
}

/** How far from flat the phone is held, in degrees (0 = lying flat). */
export function tiltFromEvent(e) {
  if (e == null || e.beta == null || e.gamma == null) return null;
  return Math.max(Math.abs(e.beta), Math.abs(e.gamma));
}

/** Mean of angles that wraps properly — the mean of 359° and 1° is 0°, not 180°. */
export function circularMean(degs) {
  if (!degs.length) return null;
  let x = 0;
  let y = 0;
  for (const d of degs) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  const m = (Math.atan2(y, x) * 180) / Math.PI;
  return (m + 360) % 360;
}

/** Largest gap between any reading and their mean — how shaky the hand is. */
export function circularSpread(degs) {
  const m = circularMean(degs);
  if (m == null) return Infinity;
  let worst = 0;
  for (const d of degs) {
    const diff = Math.abs(((d - m + 540) % 360) - 180);
    worst = Math.max(worst, diff);
  }
  return worst;
}

export const FLAT_LIMIT = 20;   // degrees off level still counted as "flat"
export const STEADY_LIMIT = 3;  // degrees of wobble still counted as "steady"
const WINDOW_MS = 600;

export class SensorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SensorError';
    this.code = code;
  }
}

/**
 * Live heading readings. `start()` must be called from a tap — iOS only grants
 * motion access inside a user gesture. `onUpdate` receives
 * { heading, tilt, beta, gamma, flat, steady } several times a second.
 */
export class HeadingSensor {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.samples = [];
    this.latest = null;
    this.handler = (e) => this.read(e);
  }

  async start() {
    if (!window.isSecureContext) {
      throw new SensorError('insecure', 'Motion sensors need HTTPS. Open the page over https:// and try again.');
    }
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      throw new SensorError('unsupported', "This device doesn't report its orientation.");
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      let answer;
      try {
        answer = await DeviceOrientationEvent.requestPermission();
      } catch {
        answer = 'denied';
      }
      if (answer !== 'granted') {
        throw new SensorError('denied', 'Motion access was denied. Allow it in your browser settings, or measure by hand instead.');
      }
    }
    window.addEventListener('deviceorientation', this.handler);

    // A desktop browser has the API but never fires it — don't wait forever.
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.latest) return resolve();
        if (Date.now() - started > 2000) {
          this.stop();
          return reject(new SensorError('silent', "No motion sensor readings came through — this device may not have one. Measure by hand instead."));
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  stop() {
    window.removeEventListener('deviceorientation', this.handler);
  }

  read(e) {
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    const heading = headingFromEvent(e, angle);
    if (heading == null) return;
    const now = Date.now();
    this.samples.push({ t: now, h: heading });
    while (this.samples.length && now - this.samples[0].t > WINDOW_MS) this.samples.shift();

    const recent = this.samples.map((s) => s.h);
    const tilt = tiltFromEvent(e);
    this.latest = {
      heading: circularMean(recent),
      tilt,
      beta: e.beta,
      gamma: e.gamma,
      flat: tilt != null && tilt <= FLAT_LIMIT,
      steady: recent.length >= 4 && circularSpread(recent) <= STEADY_LIMIT,
    };
    this.onUpdate?.(this.latest);
  }
}
