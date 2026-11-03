import { processPage } from './detect-core.js';

const SIDES = [4200, 2800, 1800];

// A device short of memory can hand back an empty canvas without saying so.
function isEmpty({ data }) {
  const step = 4 * 997;
  for (let p = 3; p < data.length; p += step) if (data[p]) return false;
  return true;
}

async function readPhoto(blob, bitmap, rotate) {
  for (const side of SIDES) {
    try {
      const pixels = await drawPhoto(bitmap || (await createImageBitmap(blob)), side, rotate);
      if (!isEmpty(pixels)) return pixels;
    } catch (err) {
      if (bitmap || side === SIDES.at(-1)) throw err;
    }
    if (bitmap) break;
  }
  throw new Error('This device ran out of memory for that photo. Try a lower camera resolution.');
}

async function drawPhoto(bmp, maxSide, rotate) {
    // Very large camera modes would use too much memory, and detail past this adds nothing.
    const shrink = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
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
    return ctx.getImageData(0, 0, w, h);
}

self.onmessage = async (ev) => {
  const { id, blob, bitmap, corners, quality, autoTurn } = ev.data;
  let rotate = ev.data.rotate || 0;
  try {
    let src = await readPhoto(blob, bitmap, rotate);
    let w = src.width, h = src.height;
    let result = processPage({ data: src.data, w, h }, { corners });
    if (autoTurn && result.upsideDown && !bitmap) {
      rotate = (rotate + 180) % 360;
      src = await readPhoto(blob, bitmap, rotate);
      w = src.width; h = src.height;
      result = processPage({ data: src.data, w, h }, { corners });
    }

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
        rotate,
      },
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
