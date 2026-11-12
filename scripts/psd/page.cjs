// One page of a document -> background plate, separate pieces, live-text data.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const sharp = require('sharp')
const C = require('./compositor.cjs')
const U = require('./units.cjs')
const T = require('./text.cjs')
const { PAGE_W, PAGE_H, isStar } = require('./config.cjs')
const { trim, saveWebp, sharpRaw, growAndFeather } = require('./images.cjs')
const { photoFull } = require('./photo.cjs')

const gap = (a, b) => Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)))

function unitSprite(doc, u, r) {
  if (u.nested) {
    const n = u.nested
    const live = new Set(n.texts.map((t) => t.id))
    const s = C.renderSprite(n.doc, C.rect(r.x - n.ox, r.y - n.oy, r.w, r.h), (x) => !live.has(x.id))
    return { ...s, x: r.x, y: r.y }
  }
  return C.renderSprite(doc, r, (n) => u.leafIds.has(n.id))
}

/**
 * Make a piece's solid interior identical to the designer's export. Wherever the piece is fully
 * opaque and nothing lies on top of it, its colour is taken from the export itself; for a photo,
 * the parts hidden under other pieces are then matched to it with a fitted tone curve.
 */
function sampleTruth(spr, above, truth, R, kind) {
  const { x, y, w, h, data } = spr
  const sum = [new Float64Array(256), new Float64Array(256), new Float64Array(256)]
  const cnt = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  const hidden = []
  let n = 0, err = 0
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = (yy * w + xx) * 4
    if (data[i + 3] < 253) continue
    const px = x + xx - R.x, py = y + yy - R.y
    if (px < 0 || py < 0 || px >= PAGE_W || py >= PAGE_H) continue
    if (above[py * PAGE_W + px]) { hidden.push(i); continue }
    const ti = ((y + yy) * truth.w + (x + xx - truth.ox)) * 4
    for (let c = 0; c < 3; c++) { const m = data[i + c], t = truth.data[ti + c]; sum[c][m] += t; cnt[c][m]++; err += Math.abs(m - t); data[i + c] = t }
    n++
  }
  const stat = { n, err: n ? err / (n * 3) : 0 }
  if (kind !== 'photo' || n < 4000) return stat
  const lut = []
  for (let c = 0; c < 3; c++) {
    const known = []
    for (let v = 0; v < 256; v++) if (cnt[c][v] >= 12) known.push([v, sum[c][v] / cnt[c][v]])
    if (known.length < 40) return stat
    const t = new Float32Array(256)
    let k = 0
    const first = known[0], last = known[known.length - 1]
    for (let v = 0; v < 256; v++) {
      while (k + 1 < known.length && known[k + 1][0] <= v) k++
      const p = known[k], q = known[Math.min(known.length - 1, k + 1)]
      if (v <= first[0]) t[v] = first[1] + (v - first[0])
      else if (v >= last[0]) t[v] = last[1] + (v - last[0])
      else t[v] = q[0] === p[0] ? p[1] : p[1] + ((q[1] - p[1]) * (v - p[0])) / (q[0] - p[0])
    }
    const sm = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) { let acc = 0, m = 0; for (let d = -3; d <= 3; d++) { const u = v + d; if (u >= 0 && u < 256) { acc += t[u]; m++ } } sm[v] = acc / m }
    lut.push(sm)
  }
  for (const i of hidden) for (let c = 0; c < 3; c++) data[i + c] = lut[c][data[i + c]]
  stat.lut = lut
  return stat
}

/** A page exported from a slightly different version of the file: find where a piece really sits. */
function alignToTruth(spr, truth, R) {
  const pts = []
  for (let yy = 2; yy < spr.h; yy += 5) for (let xx = 2; xx < spr.w; xx += 5) { const i = (yy * spr.w + xx) * 4; if (spr.data[i + 3] > 250) pts.push(xx, yy, i) }
  if (pts.length < 600) return [0, 0]
  const score = (dx, dy) => {
    let sum = 0, n = 0
    for (let k = 0; k < pts.length; k += 3) {
      const px = spr.x + pts[k] + dx, py = spr.y + pts[k + 1] + dy
      if (px - R.x < 0 || py - R.y < 0 || px - R.x >= PAGE_W || py - R.y >= PAGE_H) continue
      const ti = (py * truth.w + (px - truth.ox)) * 4, i = pts[k + 2]
      sum += Math.abs(spr.data[i] - truth.data[ti]) + Math.abs(spr.data[i + 1] - truth.data[ti + 1]) + Math.abs(spr.data[i + 2] - truth.data[ti + 2]); n++
    }
    return n > pts.length / 6 ? sum / (n * 3) : 1e9
  }
  const zero = score(0, 0)
  if (zero < 6) return [0, 0]
  let best = [0, 0, zero]
  for (let dy = -72; dy <= 72; dy += 4) for (let dx = -72; dx <= 72; dx += 4) { const v = score(dx, dy); if (v < best[2]) best = [dx, dy, v] }
  const [cx, cy] = best
  for (let dy = cy - 4; dy <= cy + 4; dy++) for (let dx = cx - 4; dx <= cx + 4; dx++) { const v = score(dx, dy); if (v < best[2]) best = [dx, dy, v] }
  return best[2] < zero * 0.6 ? [best[0], best[1]] : [0, 0]
}

/** Split a piece into the separate islands it is made of (several headings drawn on one layer). */
function islands(spr) {
  const CELL = 8, GROW = 6
  const gw = Math.ceil(spr.w / CELL), gh = Math.ceil(spr.h / CELL)
  const occ = new Uint8Array(gw * gh)
  for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) if (spr.data[(y * spr.w + x) * 4 + 3] > 40) occ[((y / CELL) | 0) * gw + ((x / CELL) | 0)] = 1
  const fat = new Uint8Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!occ[y * gw + x]) continue
    for (let dy = -GROW; dy <= GROW; dy++) for (let dx = -GROW; dx <= GROW; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) fat[yy * gw + xx] = 1 }
  }
  const lab = new Int32Array(gw * gh)
  const boxes = []
  for (let s = 0; s < gw * gh; s++) {
    if (!fat[s] || lab[s]) continue
    const id = boxes.length + 1
    const st = [s]
    lab[s] = id
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1
    while (st.length) {
      const p = st.pop(), x = p % gw, y = (p / gw) | 0
      if (occ[p]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      const nb = []
      if (x > 0) nb.push(p - 1)
      if (x < gw - 1) nb.push(p + 1)
      if (y > 0) nb.push(p - gw)
      if (y < gh - 1) nb.push(p + gw)
      for (const q of nb) { if (lab[q] || !fat[q]) continue; lab[q] = id; st.push(q) }
    }
    boxes.push({ id, x: x0 * CELL, y: y0 * CELL, w: Math.min(spr.w, (x1 + 1) * CELL) - x0 * CELL, h: Math.min(spr.h, (y1 + 1) * CELL) - y0 * CELL })
  }
  if (boxes.length < 2) return [spr]
  return boxes
    .map((b) => {
      const d = new Uint8ClampedArray(b.w * b.h * 4)
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        if (lab[(((y + b.y) / CELL) | 0) * gw + (((x + b.x) / CELL) | 0)] !== b.id) continue
        const si = ((y + b.y) * spr.w + x + b.x) * 4, di = (y * b.w + x) * 4
        d[di] = spr.data[si]; d[di + 1] = spr.data[si + 1]; d[di + 2] = spr.data[si + 2]; d[di + 3] = spr.data[si + 3]
      }
      return trim({ x: spr.x + b.x, y: spr.y + b.y, w: b.w, h: b.h, data: d })
    })
    .filter(Boolean)
    .sort((p, q) => Math.round(p.y / 120) - Math.round(q.y / 120) || p.x - q.x)
}

async function extractPage(ctx, p) {
  const { doc, cfg, frame, units, truth, extractedLeaf, ART, QA_DIR } = ctx
  const t0 = Date.now()
  const pageId = cfg.pages[p]
  const R = C.rect(frame.x, p * PAGE_H, PAGE_W, PAGE_H)
  const org = { x: R.x, y: R.y }
  const dir = path.join(ART, pageId)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const warn = (m) => console.warn('  ! ' + pageId + ': ' + m)
  const centreOnPage = (u) => { const b = u.node.bounds; const cy = b.y + b.h / 2; return cy >= R.y && cy < R.y + R.h }

  // ---- 1. every separate piece on this page
  const pieces = []
  for (const u of units) {
    if (!U.isExtracted(u) || !u.bbox) continue
    const r = C.intersect(u.bbox, R)
    if (!r) continue
    if (u.kind === 'text') {
      const a = C.render(doc, r, (n) => u.leafIds.has(n.id), null)
      pieces.push({ u, text: true, x: a.x, y: a.y, w: a.w, h: a.h, alpha: (i) => a.d[i * 4 + 3] })
      continue
    }
    const raw = unitSprite(doc, u, r)
    let fp = raw, fpAlpha = (i) => raw.data[i * 4 + 3] / 255
    if (u.nested) { const a = C.render(doc, r, (n) => u.leafIds.has(n.id), null); fp = a; fpAlpha = (i) => a.d[i * 4 + 3] }
    let shift = [0, 0]
    if (cfg.truth) {
      shift = alignToTruth(raw, truth, R)
      if (shift[0] || shift[1]) { raw.x += shift[0]; raw.y += shift[1]; console.log('  ' + pageId + ': "' + u.name + '" sits ' + shift[0] + ',' + shift[1] + ' px from where the PSD has it; following the export') }
    }
    const moved = fp === raw // raw has already been moved by the shift
    pieces.push({ u, raw, shift, x: moved ? raw.x : fp.x + shift[0], y: moved ? raw.y : fp.y + shift[1], w: fp.w, h: fp.h, alpha: fpAlpha })
  }

  // ---- 2. the background plate: the export, with those pieces taken out
  const M = new Float32Array(PAGE_W * PAGE_H)
  for (const pc of pieces) {
    for (let y = 0; y < pc.h; y++) {
      const py = pc.y + y - R.y
      if (py < 0 || py >= PAGE_H) continue
      for (let x = 0; x < pc.w; x++) { const px = pc.x + x - R.x; if (px < 0 || px >= PAGE_W) continue; if (pc.alpha(y * pc.w + x) > 0.008) M[py * PAGE_W + px] = 1 }
    }
  }
  growAndFeather(M, PAGE_W, PAGE_H, 3, 2)
  const bg = C.toRGBA8(C.render(doc, R, (n) => !extractedLeaf.has(n.id) && !(cfg.bgExclude && cfg.bgExclude(n)), [1, 1, 1, 1]))
  const plate = new Uint8ClampedArray(PAGE_W * PAGE_H * 4)
  let seam = 0, seamN = 0, covered = 0
  for (let y = 0; y < PAGE_H; y++) for (let x = 0; x < PAGE_W; x++) {
    const i = y * PAGE_W + x, o = i * 4
    const ti = ((y + R.y) * truth.w + (x + R.x - truth.ox)) * 4
    const m = M[i]
    if (m > 0.5) covered++
    for (let c = 0; c < 3; c++) {
      const tv = truth.data[ti + c], bv = bg.data[o + c]
      plate[o + c] = tv + (bv - tv) * m
      if (m > 0.02 && m < 0.5) { seam += Math.abs(tv - bv); seamN++ }
    }
    plate[o + 3] = 255
  }

  // ---- 3. from the top piece down: copy solid interiors from the export
  const above = new Uint8Array(PAGE_W * PAGE_H)
  let toneN = 0, toneErr = 0
  for (const pc of [...pieces].sort((a, b) => b.u.z - a.u.z)) {
    if (!pc.text) {
      const st = sampleTruth(pc.raw, above, truth, R, pc.u.kind)
      if (pc.u.kind === 'photo' && st.n) { toneN++; toneErr += st.err }
      if (st.lut) pc.u.lut = st.lut
    }
    for (let y = 0; y < pc.h; y++) {
      const py = pc.y + y - R.y
      if (py < 0 || py >= PAGE_H) continue
      for (let x = 0; x < pc.w; x++) {
        const px = pc.x + x - R.x
        if (px < 0 || px >= PAGE_W) continue
        if (pc.alpha(y * pc.w + x) > 0.004) { const q = py * PAGE_W + px; above[q] = 1; if (px > 0) above[q - 1] = 1; if (px < PAGE_W - 1) above[q + 1] = 1; if (py > 0) above[q - PAGE_W] = 1; if (py < PAGE_H - 1) above[q + PAGE_W] = 1 }
      }
    }
  }

  // ---- 4. write the pieces and describe them
  const items = []
  const qa = []
  for (const pc of pieces) {
    const u = pc.u
    if (pc.text) {
      if (QA_DIR) qa.push({ z: u.z + 0.5, spr: C.renderSprite(doc, C.intersect(u.bbox, R), (n) => u.leafIds.has(n.id)) })
      if (u.parentUnit || !centreOnPage(u)) continue
      items.push({ z: u.z, id: 'text-' + u.z, ...T.textItem(u.node, org, u.inherit, warn) })
      continue
    }
    const whole = trim(pc.raw)
    if (!whole) continue
    if (QA_DIR) qa.push({ z: u.z, spr: whole })
    const rule = u.rule || {}
    const parts = rule.split ? islands(whole) : [whole]
    const alts = Array.isArray(rule.alts) ? rule.alts : rule.alts ? rule.alts[pageId] || [] : null
    for (let k = 0; k < parts.length; k++) {
      const spr = parts[k]
      const id = u.kind + '-' + u.z + (parts.length > 1 ? '-' + (k + 1) : '')
      const img = await saveWebp(dir, pageId, id, spr.data, spr.w, spr.h, u.kind)
      const item = { t: 'img', kind: u.kind, id, z: u.z + k / 100, x: spr.x - org.x, y: spr.y - org.y, w: spr.w, h: spr.h, src: img.src }
      if (img.half) item.half = img.half
      if (rule.id) item.role = rule.id
      else if (isStar(u)) item.role = 'star'
      if (u.shown < 0.7) item.shown = Math.round(u.shown * 100) / 100
      const alt = alts ? alts[k] : rule.alt != null ? rule.alt : u.alt
      if (alt) item.alt = alt
      const nb = parts.length > 1 ? spr : u.core || u.bbox
      const sh = parts.length > 1 ? [0, 0] : pc.shift
      item.core = [nb.x + sh[0] - org.x, nb.y + sh[1] - org.y, nb.w, nb.h]
      if (parts.length === 1) {
        const torg = { x: org.x - pc.shift[0], y: org.y - pc.shift[1] }
        const kids = []
        if (u.nested) for (const t of u.nested.texts) kids.push({ id: 'text-' + u.z + '-' + t.id, ...T.textItem(t, { x: torg.x - u.nested.ox, y: torg.y - u.nested.oy }, null, warn) })
        for (const t of u.texts) if (centreOnPage(t)) kids.push({ id: 'text-' + t.z, ...T.textItem(t.node, torg, t.inherit, warn) })
        if (kids.length) item.texts = kids
        if (u.kind === 'photo' && centreOnPage(u)) {
          const full = await photoFull(doc, u, dir, pageId)
          if (full) item.full = { src: full.src, w: full.w, h: full.h }
        }
      }
      items.push(item)
    }
  }

  // captions: the nearest label describes a photo
  const labels = items.filter((i) => i.kind === 'label' && i.texts)
  for (const it of items) {
    if (it.kind !== 'photo' || it.alt) continue // a photo with a description of its own needs no borrowed caption
    const own = (it.texts || []).map((t) => t.plain.replace(/\n/g, ' '))
    let best = null, bd = 1e9
    const a = C.rect(...it.core)
    for (const lb of labels) { const d = gap(a, C.rect(...lb.core)); if (d < bd) { bd = d; best = lb } }
    const near = best && bd < 260 ? best.texts.map((t) => t.plain) : []
    const lines = [...own, ...near.join('\n').split('\n')].map((s) => s.trim()).filter(Boolean)
    if (lines.length) it.caption = lines
    if (best && bd < 260) it.label = best.id
  }

  const plateOut = { w: PAGE_W, h: PAGE_H, srcs: [] }
  const phash = crypto.createHash('sha1').update(Buffer.from(plate.buffer)).digest('hex').slice(0, 8)
  for (const w of [PAGE_W, 2456, 1638, 1024]) {
    const name = 'plate-' + w + '-' + phash + '.webp'
    let img = sharpRaw(plate, PAGE_W, PAGE_H)
    if (w !== PAGE_W) img = img.resize(w, Math.round((PAGE_H * w) / PAGE_W), { kernel: 'lanczos3' })
    await img.webp({ quality: 82, effort: 5, smartSubsample: true }).toFile(path.join(dir, name))
    plateOut.srcs.push({ w, src: 'art/' + pageId + '/' + name })
  }
  const tiny = await sharpRaw(plate, PAGE_W, PAGE_H).resize(32, 18).webp({ quality: 50 }).toBuffer()
  plateOut.tiny = 'data:image/webp;base64,' + tiny.toString('base64')
  const avg = await sharpRaw(plate, PAGE_W, PAGE_H).resize(1, 1).raw().toBuffer()
  plateOut.color = '#' + [avg[0], avg[1], avg[2]].map((v) => v.toString(16).padStart(2, '0')).join('')

  // self-check: put the pieces back together and compare with the designer's export
  let check = ''
  if (QA_DIR) {
    const acc = new Float32Array(PAGE_W * PAGE_H * 3)
    for (let i = 0; i < PAGE_W * PAGE_H; i++) { acc[i * 3] = plate[i * 4]; acc[i * 3 + 1] = plate[i * 4 + 1]; acc[i * 3 + 2] = plate[i * 4 + 2] }
    qa.sort((a, b) => a.z - b.z)
    for (const { spr } of qa) {
      for (let y = 0; y < spr.h; y++) {
        const py = spr.y + y - R.y
        if (py < 0 || py >= PAGE_H) continue
        for (let x = 0; x < spr.w; x++) {
          const px = spr.x + x - R.x
          if (px < 0 || px >= PAGE_W) continue
          const si = (y * spr.w + x) * 4, a = spr.data[si + 3] / 255
          if (a <= 0) continue
          const di = (py * PAGE_W + px) * 3
          for (let c = 0; c < 3; c++) acc[di + c] += (spr.data[si + c] - acc[di + c]) * a
        }
      }
    }
    let sum = 0, big = 0
    const diff = Buffer.alloc(PAGE_W * PAGE_H * 3), mine = Buffer.alloc(PAGE_W * PAGE_H * 3)
    for (let y = 0; y < PAGE_H; y++) for (let x = 0; x < PAGE_W; x++) {
      const i = y * PAGE_W + x, ti = ((y + R.y) * truth.w + (x + R.x - truth.ox)) * 4
      let mx = 0
      for (let c = 0; c < 3; c++) { const d = Math.abs(acc[i * 3 + c] - truth.data[ti + c]); sum += d; if (d > mx) mx = d; mine[i * 3 + c] = acc[i * 3 + c] }
      if (mx > 12) big++
      const v = Math.min(255, mx * 4)
      diff[i * 3] = v; diff[i * 3 + 1] = v; diff[i * 3 + 2] = v
    }
    check = '  rebuild: mean ' + (sum / (PAGE_W * PAGE_H * 3)).toFixed(2) + ', >12: ' + ((100 * big) / (PAGE_W * PAGE_H)).toFixed(2) + '%'
    fs.mkdirSync(QA_DIR, { recursive: true })
    await sharp(diff, { raw: { width: PAGE_W, height: PAGE_H, channels: 3 } }).resize({ width: 1638 }).jpeg({ quality: 80 }).toFile(path.join(QA_DIR, pageId + '-diff.jpg'))
    await sharp(mine, { raw: { width: PAGE_W, height: PAGE_H, channels: 3 } }).resize({ width: 1638 }).jpeg({ quality: 80 }).toFile(path.join(QA_DIR, pageId + '-rebuilt.jpg'))
    await sharpRaw(plate, PAGE_W, PAGE_H).resize({ width: 1638 }).jpeg({ quality: 80 }).toFile(path.join(QA_DIR, pageId + '-plate.jpg'))
  }

  const n = (k) => items.filter((i) => i.kind === k).length
  const texts = items.reduce((s, i) => s + (i.t === 'text' ? 1 : 0) + (i.texts ? i.texts.length : 0), 0)
  console.log(pageId.padEnd(22) + ' photos ' + String(n('photo')).padStart(2) + '  labels ' + String(n('label')).padStart(2) + '  titles ' + n('title') + '  other ' + String(n('deco') + n('sprite')).padStart(2) + '  live text ' + String(texts).padStart(2) + '  removed ' + ((100 * covered) / (PAGE_W * PAGE_H)).toFixed(0).padStart(2) + '%  seam ' + (seamN ? seam / seamN : 0).toFixed(2) + '  photo tone fix ' + (toneN ? toneErr / toneN : 0).toFixed(1) + check + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
  return { id: pageId, doc: cfg.key, index: p, w: PAGE_W, h: PAGE_H, plate: plateOut, items: items.sort((a, b) => a.z - b.z) }
}

module.exports = { extractPage }
