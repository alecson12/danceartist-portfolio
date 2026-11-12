// Side-by-side crop: truth | my render | difference x6. For calibrating the compositor.
// Usage: node scripts/psd/crop.cjs <psd> <x> <y> <w> <h> <out.png> [scale]
'use strict'
const sharp = require('sharp')
const C = require('./compositor.cjs')
const [file, xs, ys, ws, hs, out, sc] = process.argv.slice(2)
;(async () => {
  const doc = C.openPsd(file)
  const r = C.rect(+xs, +ys, +ws, +hs)
  const mine = C.toRGBA8(C.render(doc, r, () => true, [1, 1, 1, 1]))
  const truth = C.compositeImage(doc)
  const t = Buffer.alloc(r.w * r.h * 3), m = Buffer.alloc(r.w * r.h * 3), d = Buffer.alloc(r.w * r.h * 3)
  let sum = 0
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = (y * r.w + x) * 4, j = ((y + r.y) * truth.width + x + r.x) * 4, o = (y * r.w + x) * 3
    for (let k = 0; k < 3; k++) { t[o + k] = truth.data[j + k]; m[o + k] = mine.data[i + k]; const df = Math.abs(truth.data[j + k] - mine.data[i + k]); sum += df; d[o + k] = Math.min(255, df * 6) }
  }
  const scale = +(sc || 1)
  const W = Math.round(r.w * scale), H = Math.round(r.h * scale)
  const mk = (b) => sharp(b, { raw: { width: r.w, height: r.h, channels: 3 } }).resize(W, H, { kernel: scale > 1 ? 'nearest' : 'lanczos3' }).png().toBuffer()
  const [a, b, c] = await Promise.all([mk(t), mk(m), mk(d)])
  await sharp({ create: { width: W * 3 + 16, height: H, channels: 3, background: '#0af' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: W + 8, top: 0 }, { input: c, left: 2 * W + 16, top: 0 }]).png().toFile(out)
  console.log('mean |diff|', (sum / (r.w * r.h * 3)).toFixed(2))
})()
