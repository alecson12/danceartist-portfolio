// Print what the extraction would do with each layer, and draw it over the page for review.
// Usage: node scripts/psd/report.cjs <docKey> [outDir]
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const sharp = require('sharp')
const C = require('./compositor.cjs')
const U = require('./units.cjs')
const { DESIGN_DIR, DOCS, PAGE_W, PAGE_H } = require('./config.cjs')

const [key, outDir] = process.argv.slice(2)
const cfg = DOCS.find((d) => d.key === key)
;(async () => {
  const t0 = Date.now()
  const doc = C.openPsd(path.join(DESIGN_DIR, cfg.file))
  const frame = C.rect(cfg.offsetX || 0, 0, PAGE_W, cfg.pages.length * PAGE_H)
  const units = U.buildUnits(doc, cfg, frame)
  U.classify(doc, units, cfg)
  U.resolveLayers(doc, units)
  const count = {}
  for (const u of units) count[u.kind] = (count[u.kind] || 0) + 1
  console.log(key, 'units', units.length, JSON.stringify(count), ((Date.now() - t0) / 1000).toFixed(1) + 's')
  const COLORS = { text: '#00e5ff', photo: '#00ff5a', label: '#ffe600', title: '#ff00d4', sprite: '#ff8a00', deco: '#ffffff', attached: '#8080ff' }
  for (const u of units) {
    if (u.kind === 'static' || u.kind === 'none') continue
    const b = u.bbox
    console.log(String(u.z).padStart(3), u.kind.padEnd(8), 'p' + Math.floor((b.y + b.h / 2) / PAGE_H), u.rawKind.padEnd(6), JSON.stringify(u.name.slice(0, 44)).padEnd(48), `[${b.x},${b.y} ${b.w}x${b.h}]`, u.host ? '→ ' + u.host.name.slice(0, 24) : '', u.parentUnit ? '⊂ ' + u.parentUnit.name.slice(0, 20) : '', u.texts.length ? 'texts=' + u.texts.length : '', u.attach.length ? 'attach=' + u.attach.map((a) => a.name.slice(0, 14)).join(',') : '')
  }
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true })
    const truth = cfg.truth ? null : C.compositeImage(doc)
    for (let p = 0; p < cfg.pages.length; p++) {
      const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}">`]
      for (const u of units) {
        if (!COLORS[u.kind]) continue
        const b = C.intersect(u.bbox, C.rect(frame.x, p * PAGE_H, PAGE_W, PAGE_H))
        if (!b) continue
        const x = b.x - frame.x, y = b.y - p * PAGE_H
        svg.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" fill="none" stroke="${COLORS[u.kind]}" stroke-width="5"/><text x="${x + 6}" y="${y + 30}" font-size="30" font-family="sans-serif" fill="${COLORS[u.kind]}" stroke="#000" stroke-width="1">${u.z} ${u.kind}</text>`)
      }
      svg.push('</svg>')
      let base
      if (truth) base = sharp(await sharp(Buffer.from(truth.data.buffer, truth.data.byteOffset, truth.data.byteLength), { raw: { width: truth.width, height: truth.height, channels: 4 }, limitInputPixels: false }).extract({ left: 0, top: p * PAGE_H, width: PAGE_W, height: PAGE_H }).png({ compressionLevel: 1 }).toBuffer())
      else base = sharp(path.join(DESIGN_DIR, cfg.truth))
      const full = await base.composite([{ input: Buffer.from(svg.join('')) }]).png({ compressionLevel: 1 }).toBuffer()
      await sharp(full).resize({ width: 1638 }).jpeg({ quality: 78 }).toFile(path.join(outDir, `${key}-${p}.jpg`))
    }
  }
})()
