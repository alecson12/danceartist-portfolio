// Re-render a page from its layers and compare with the composite stored in the PSD.
// Usage: node scripts/psd/check.cjs <psd> <pageIndex> <outPrefix>
'use strict'
const path = require('node:path')
const sharp = require('sharp')
const C = require('./compositor.cjs')

const [file, pageArg, out] = process.argv.slice(2)
const PAGE_H = 1842
;(async () => {
  const t0 = Date.now()
  const doc = C.openPsd(file)
  const page = +pageArg || 0
  const r = C.rect(0, page * PAGE_H, doc.width, PAGE_H)
  const buf = C.render(doc, r, () => true, [1, 1, 1, 1])
  const mine = C.toRGBA8(buf)
  const truth = C.compositeImage(doc)
  let sum = 0, n = 0, big = 0
  const diff = Buffer.alloc(r.w * r.h * 3)
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = (y * r.w + x) * 4, j = ((y + r.y) * truth.width + x) * 4
    let m = 0
    for (let k = 0; k < 3; k++) { const d = Math.abs(mine.data[i + k] - truth.data[j + k]); sum += d; n++; if (d > m) m = d }
    if (m > 12) big++
    const o = (y * r.w + x) * 3
    const v = Math.min(255, m * 4)
    diff[o] = v; diff[o + 1] = v; diff[o + 2] = v
  }
  console.log(path.basename(file), 'page', page, 'mean |diff|', (sum / n).toFixed(2), 'pixels off by >12:', ((100 * big) / (r.w * r.h)).toFixed(2) + '%', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  if (out) {
    await sharp(Buffer.from(mine.data.buffer), { raw: { width: r.w, height: r.h, channels: 4 } }).resize({ width: 1638 }).jpeg({ quality: 82 }).toFile(out + '-mine.jpg')
    await sharp(diff, { raw: { width: r.w, height: r.h, channels: 3 } }).resize({ width: 1638 }).jpeg({ quality: 82 }).toFile(out + '-diff.jpg')
  }
})()
