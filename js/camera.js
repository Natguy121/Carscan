// Camera access and frame capture. Every captured angle produces both a
// full-size JPEG for the recognition model and a small thumbnail for the Cardex.

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
