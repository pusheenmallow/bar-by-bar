let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./detect-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const job = waiting.get(ev.data.id);
    if (!job) return;
    waiting.delete(ev.data.id);
    if (ev.data.ok) job.resolve(ev.data.page); else job.reject(new Error(ev.data.error));
  };
  worker.onerror = (ev) => {
    for (const job of waiting.values()) job.reject(new Error(ev.message || 'Bar finding stopped unexpectedly.'));
    waiting.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

export function findBars(blob, { corners = null, rotate = 0, autoTurn = false } = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, blob, corners, rotate, autoTurn });
  });
}

// Turns each page of a PDF into a picture that the bar finder can read.
export async function pdfToImages(file, onProgress) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(i, doc.numPages);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = 2480 / Math.min(base.width, base.height);
    const vp = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.round(vp.width), Math.round(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    out.push(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
