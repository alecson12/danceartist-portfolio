// Small image helpers shared by the extraction scripts.
'use strict'
const path = require('node:path')
const crypto = require('node:crypto')
const sharp = require('sharp')

const sharpRaw = (data, w, h) => sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: w, height: h, channels: 4 }, limitInputPixels: false })

/** Crop a sprite {x, y, w, h, data} to the part that is not transparent. */
function trim(spr) {
  const { w, h, data } = spr
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1
  if (nw === w && nh === h) return spr
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < nh; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + nw) * 4), y * nw * 4)
  return { x: spr.x + x0, y: spr.y + y0, w: nw, h: nh, data: out }
}

const QUALITY = { photo: 84, title: 90, label: 92, deco: 88, sprite: 88, full: 86 }

/** Write a piece at design size and at half size. The file name carries a hash of the pixels. */
async function saveWebp(dir, pageId, slug, rgba, w, h, kind, opts = {}) {
  const hash = crypto.createHash('sha1').update(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)).update(`${w}x${h}`).digest('hex').slice(0, 8)
  const name = `${slug}-${hash}`
  const q = QUALITY[kind] || 86
  await sharpRaw(rgba, w, h).webp({ quality: q, alphaQuality: 100, effort: 5, smartSubsample: true }).toFile(path.join(dir, name + '.webp'))
  const out = { src: `art/${pageId}/${name}.webp`, w, h }
  if (!opts.noHalf && Math.max(w, h) >= 96) {
    await sharpRaw(rgba, w, h).resize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)), { kernel: 'lanczos3' }).webp({ quality: q, alphaQuality: 100, effort: 5, smartSubsample: true }).toFile(path.join(dir, name + '.h.webp'))
    out.half = `art/${pageId}/${name}.h.webp`
  }
  return out
}

/** Grow a 0/1 mask by r px, then soften its edge over f px. */
function growAndFeather(M, w, h, r, f) {
  const tmp = new Float32Array(M.length)
  const pass = (src, dst, horizontal, rad, useMax) => {
    const n = horizontal ? w : h, lines = horizontal ? h : w
    for (let ln = 0; ln < lines; ln++) {
      for (let i = 0; i < n; i++) {
        let v = 0
        const a = Math.max(0, i - rad), b = Math.min(n - 1, i + rad)
        if (useMax) { for (let k = a; k <= b; k++) { const s = horizontal ? src[ln * w + k] : src[k * w + ln]; if (s > v) v = s } } else { for (let k = a; k <= b; k++) v += horizontal ? src[ln * w + k] : src[k * w + ln]; v /= 2 * rad + 1 }
        if (horizontal) dst[ln * w + i] = v
        else dst[i * w + ln] = v
      }
    }
  }
  pass(M, tmp, true, r, true); pass(tmp, M, false, r, true)
  pass(M, tmp, true, f, false); pass(tmp, M, false, f, false)
}

module.exports = { sharpRaw, trim, saveWebp, growAndFeather }
