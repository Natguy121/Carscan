// Camera access and frame capture. Every captured angle produces both a
// full-size JPEG for Google Vision and a small thumbnail for the Cardex.

const API_MAX_WIDTH = 1024;
const THUMB_MAX_WIDTH = 320;

let stream = null;

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}

function isSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function startCamera(videoEl) {
  if (!window.isSecureContext) {
    throw new CameraError(
      'insecure',
      'Camera access needs HTTPS (or localhost). Open the page over https:// and try again.',
    );
  }
  if (!isSupported()) {
    throw new CameraError('unsupported', 'This browser does not expose a camera API.');
  }

  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new CameraError('denied', 'Camera permission was denied. Allow it in your browser settings to scan.');
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      throw new CameraError('nocam', 'No camera found on this device. You can upload photos instead.');
    }
    throw new CameraError('failed', err.message || 'Could not start the camera.');
  }

  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  return stream;
}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

export function isRunning() {
  return Boolean(stream);
}

function drawScaled(source, sourceW, sourceH, maxWidth) {
  const scale = Math.min(1, maxWidth / sourceW);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceW * scale);
  canvas.height = Math.round(sourceH * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function packageCapture(source, sourceW, sourceH) {
  const full = drawScaled(source, sourceW, sourceH, API_MAX_WIDTH);
  const thumbCanvas = drawScaled(source, sourceW, sourceH, THUMB_MAX_WIDTH);
  const dataUrl = full.toDataURL('image/jpeg', 0.82);
  return {
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    preview: dataUrl,
    thumb: thumbCanvas.toDataURL('image/jpeg', 0.6),
    color: dominantColor(full),
  };
}

export function captureFrame(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new CameraError('notready', 'Camera is still warming up — try again in a moment.');
  return packageCapture(videoEl, w, h);
}

export async function captureFromFile(file) {
  if (!file.type.startsWith('image/')) throw new CameraError('badfile', 'That file is not an image.');
  const bitmap = await createImageBitmap(file);
  const result = packageCapture(bitmap, bitmap.width, bitmap.height);
  bitmap.close?.();
  return result;
}

const HUES = [
  [15, 'Red'],
  [45, 'Orange'],
  [65, 'Yellow'],
  [160, 'Green'],
  [200, 'Teal'],
  [250, 'Blue'],
  [290, 'Purple'],
  [335, 'Pink'],
  [360, 'Red'],
];

/**
 * Colour of the car, read from the middle of the frame where the subject is.
 * Purely descriptive — it is recorded on the Cardex entry, not used to identify.
 */
function dominantColor(canvas) {
  const ctx = canvas.getContext('2d');
  const bx = Math.round(canvas.width * 0.2);
  const by = Math.round(canvas.height * 0.25);
  const bw = Math.max(1, Math.round(canvas.width * 0.6));
  const bh = Math.max(1, Math.round(canvas.height * 0.5));
  const { data } = ctx.getImageData(bx, by, bw, bh);

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return null;
  r /= n;
  g /= n;
  b /= n;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = max / 255;
  const sat = max === 0 ? 0 : (max - min) / max;

  if (sat < 0.18) {
    if (lightness > 0.82) return 'White';
    if (lightness > 0.58) return 'Silver';
    if (lightness > 0.3) return 'Grey';
    return 'Black';
  }

  let hue;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  if (hue < 0) hue += 360;

  const name = HUES.find(([limit]) => hue <= limit)?.[1] || 'Red';
  if (name === 'Orange' && lightness < 0.45) return 'Brown';
  return name;
}
