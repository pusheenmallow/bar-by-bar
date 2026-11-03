import { processPage } from './detect-core.js';

const MAX_SIDE = 4200;

self.onmessage = async (ev) => {
  const { id, blob, bitmap, corners, rotate, quality } = ev.data;
  try {
    let bmp = bitmap || (await createImageBitmap(blob));
    // Very large camera modes would use too much memory, and detail past this adds nothing.
    const shrink = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const bw = Math.round(bmp.width * shrink), bh = Math.round(bmp.height * shrink);
    const w = rotate % 180 ? bh : bw;
    const h = rotate % 180 ? bw : bh;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);
    ctx.rotate(((rotate || 0) * Math.PI) / 180);
    ctx.drawImage(bmp, -bw / 2, -bh / 2, bw, bh);
    bmp.close?.();
    const src = ctx.getImageData(0, 0, w, h);
    const result = processPage({ data: src.data, w, h }, { corners });

    const out = new OffscreenCanvas(result.width, result.height);
    out.getContext('2d').putImageData(new ImageData(result.image.data, result.width, result.height), 0, 0);
    const pageBlob = await out.convertToBlob({ type: 'image/jpeg', quality: quality || 0.86 });

    self.postMessage({
      id,
      ok: true,
      page: {
        blob: pageBlob,
        width: result.width,
        height: result.height,
        rows: result.rows,
        corners: result.corners,
        pageFound: result.pageFound,
        sourceWidth: w,
        sourceHeight: h,
      },
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
