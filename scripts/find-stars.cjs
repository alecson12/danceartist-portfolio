// Finds the small Persona-style stars on every page image and writes their
// positions to src/content/stars.js, so the site can overlay the spinning
// star icon exactly on top of each one.
//
//   npm run find-stars
//
// Run it again whenever a page image changes. The positions are stored as
// percentages of the image, so they stay correct at any screen size.
// You can also hand-edit src/content/stars.js afterwards (add, move, delete).
//
// How it works: 1) finds near-white and near-black blobs that are ring-shaped
// and star-sized, 2) checks each one against a synthetic star (black body,
// white ring, black ring, white core) at several sizes and rotations and
// keeps the ones that match well.
const sharp = require('sharp')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PAGES = path.join(ROOT, 'public/pages')
const OUT = process.env.OUT || path.join(ROOT, 'src/content/stars.js')
const THRESHOLD = Number(process.env.THRESHOLD || 0.66) // match score 0..1; lower finds more (and risks false positives)
const MAX_STAR = Number(process.env.MAX_STAR || 420) // px: skip anything bigger
// The big overlapping stars in the corner clusters are found by their cores (see cores()).
// Only on these pages (filename fragments): elsewhere that pass picks up faces and logos. [] = all pages.
const CLUSTER_PAGES = ['Highlight_01', 'Works_01']

function starPath(cx, cy, R, rot = 0) {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? R : R * 0.5
    const a = -Math.PI / 2 + (i * Math.PI) / 5 + (rot * Math.PI) / 180
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return `<polygon points="${pts.join(' ')}"/>`
}

const tplCache = new Map()
async function template(size, rot) {
  const key = size + ':' + rot
  if (tplCache.has(key)) return tplCache.get(key)
  const R = size / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <g fill="#000">${starPath(R, R, R * 0.98, rot)}</g><g fill="#fff">${starPath(R, R, R * 0.74, rot)}</g>
    <g fill="#000">${starPath(R, R, R * 0.51, rot)}</g><g fill="#fff">${starPath(R, R, R * 0.19, rot)}</g></svg>`
  const buf = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer()
  const n = size * size
  const gray = new Float32Array(n), mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    gray[i] = buf[i * 4]
    mask[i] = buf[i * 4 + 3] > 127 ? 1 : 0
  }
  const t = { size, gray, mask }
  tplCache.set(key, t)
  return t
}

// normalised cross-correlation of the template (only its star-shaped pixels) against a crop
function ncc(crop, cw, ox, oy, tpl) {
  const { size, gray, mask } = tpl
  const A = [], B = []
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = j * size + i
    if (!mask[k]) continue
    const px = ox + i, py = oy + j
    if (px < 0 || py < 0 || px >= cw || py >= cw) continue
    A.push(crop[py * cw + px]); B.push(gray[k])
  }
  const n = A.length
  if (n < 20) return 0
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += A[i]; mb += B[i] }
  ma /= n; mb /= n
  let dot = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) { const a = A[i] - ma, b = B[i] - mb; dot += a * b; va += a * a; vb += b * b }
  if (va < 1e-6 || vb < 1e-6) return 0
  return dot / Math.sqrt(va * vb)
}

// ring-shaped connected components of one colour class
function components(cls, W, H, want) {
  const label = new Int32Array(W * H)
  const stack = new Int32Array(W * H)
  const out = []
  let id = 0
  for (let s = 0; s < W * H; s++) {
    if (cls[s] !== want || label[s]) continue
    id++
    let sp = 0
    stack[sp++] = s; label[s] = id
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    while (sp) {
      const p = stack[--sp]; area++
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
      if (x > 0 && cls[p - 1] === want && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1 }
      if (x < W - 1 && cls[p + 1] === want && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1 }
      if (y > 0 && cls[p - W] === want && !label[p - W]) { label[p - W] = id; stack[sp++] = p - W }
      if (y < H - 1 && cls[p + W] === want && !label[p + W]) { label[p + W] = id; stack[sp++] = p + W }
    }
    const w = maxx - minx + 1, h = maxy - miny + 1
    if (w < 14 || h < 14 || w > MAX_STAR || h > MAX_STAR) continue
    const asp = w / h
    if (asp < 0.7 || asp > 1.43) continue
    const fill = area / (w * h)
    if (fill < 0.1 || fill > 0.6) continue
    // hole test: flood from the bbox border through non-component pixels; what is left is enclosed
    const bw = w + 2, bh = h + 2
    const seen = new Uint8Array(bw * bh)
    const st = []
    const inComp = (bx, by) => { const x = minx - 1 + bx, y = miny - 1 + by; return x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] === id }
    for (let bx = 0; bx < bw; bx++) st.push(bx, (bh - 1) * bw + bx)
    for (let by = 0; by < bh; by++) st.push(by * bw, by * bw + bw - 1)
    let reach = 0
    while (st.length) {
      const q = st.pop(); if (seen[q]) continue
      const bx = q % bw, by = (q / bw) | 0
      if (inComp(bx, by)) continue
      seen[q] = 1; reach++
      if (bx > 0) st.push(q - 1); if (bx < bw - 1) st.push(q + 1); if (by > 0) st.push(q - bw); if (by < bh - 1) st.push(q + bw)
    }
    if (bw * bh - area - reach < 0.03 * w * h) continue
    out.push({ cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w, h })
  }
  return out
}

// solid star-shaped blobs (the white/red cores of the big cluster stars)
function cores(cls, W, H, want, min, max) {
  const label = new Int32Array(W * H), stack = new Int32Array(W * H), out = []
  let id = 0
  for (let s = 0; s < W * H; s++) {
    if (cls[s] !== want || label[s]) continue
    id++
    let sp = 0; stack[sp++] = s; label[s] = id
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    const px = []
    while (sp) {
      const p = stack[--sp]; area++; px.push(p)
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
      if (x > 0 && cls[p - 1] === want && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1 }
      if (x < W - 1 && cls[p + 1] === want && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1 }
      if (y > 0 && cls[p - W] === want && !label[p - W]) { label[p - W] = id; stack[sp++] = p - W }
      if (y < H - 1 && cls[p + W] === want && !label[p + W]) { label[p + W] = id; stack[sp++] = p + W }
    }
    const w = maxx - minx + 1, h = maxy - miny + 1
    if (w < min || h < min || w > max || h > max) continue
    if (minx === 0 || miny === 0 || maxx === W - 1 || maxy === H - 1) continue
    const asp = w / h
    if (asp < 0.72 || asp > 1.4) continue
    const fill = area / (w * h)
    if (fill < 0.3 || fill > 0.65) continue
    // centroid + tip angle (direction of the farthest pixel from the centroid)
    let sx = 0, sy = 0
    for (const p of px) { sx += p % W; sy += (p / W) | 0 }
    const cx = sx / area, cy = sy / area
    let far = 0, ang = 0
    for (const p of px) { const dx = (p % W) - cx, dy = ((p / W) | 0) - cy, d = dx * dx + dy * dy; if (d > far) { far = d; ang = Math.atan2(dy, dx) } }
    const tip = (ang * 180) / Math.PI
    out.push({ cx, cy, w, h, tip, rot: ((Math.round(tip) + 90) % 72 + 72) % 72 })
  }
  return out
}

function cropAt(gray, W, H, cx, cy, half) {
  const cw = half * 2
  const crop = new Float32Array(cw * cw)
  for (let j = 0; j < cw; j++) for (let i = 0; i < cw; i++) {
    const x = Math.round(cx) - half + i, y = Math.round(cy) - half + j
    crop[j * cw + i] = x >= 0 && y >= 0 && x < W && y < H ? gray[y * W + x] : 128
  }
  return { crop, cw }
}

async function detect(file, clusters) {
  const img = sharp(file)
  const { width: W, height: H } = await img.metadata()
  const rgb = await img.removeAlpha().raw().toBuffer()
  const gray = new Float32Array(W * H), cls = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
    if (r >= 232 && g >= 232 && b >= 232) cls[i] = 1
    else if (r <= 60 && g <= 60 && b <= 60) cls[i] = 2
  }
  const cands = []
  for (const c of components(cls, W, H, 1)) cands.push({ ...c, size: Math.max(c.w, c.h) / 0.74 })
  for (const c of components(cls, W, H, 2)) {
    cands.push({ ...c, size: Math.max(c.w, c.h) / 0.98 })
    cands.push({ ...c, size: Math.max(c.w, c.h) / 0.51 })
  }
  const found = []
  for (const c of cands) {
    if (c.size > MAX_STAR) continue
    // coarse search
    let best = 0, bestSize = c.size, bestRot = 0
    for (const sc of [0.8, 0.9, 1, 1.1, 1.25]) {
      const size = Math.round(c.size * sc)
      if (size < 16) continue
      const half = Math.ceil(size * 0.75)
      const { crop, cw } = cropAt(gray, W, H, c.cx, c.cy, half)
      for (let rot = 0; rot < 72; rot += 6) {
        const v = ncc(crop, cw, Math.round(half - size / 2), Math.round(half - size / 2), await template(size, rot))
        if (v > best) { best = v; bestSize = size; bestRot = rot }
      }
    }
    if (best < 0.45) continue
    // fine search: small shifts, sizes and rotations
    let rx = 0, ry = 0
    for (const sc of [0.93, 0.97, 1, 1.03, 1.07]) {
      const size = Math.round(bestSize * sc)
      const half = Math.ceil(size * 0.75) + 4
      const { crop, cw } = cropAt(gray, W, H, c.cx, c.cy, half)
      for (let rot = bestRot - 6; rot <= bestRot + 6; rot += 2) {
        const tpl = await template(size, (rot + 72) % 72)
        for (let dx = -4; dx <= 4; dx += 2) for (let dy = -4; dy <= 4; dy += 2) {
          const v = ncc(crop, cw, Math.round(half - size / 2) + dx, Math.round(half - size / 2) + dy, tpl)
          if (v > best) { best = v; bestSize = size; bestRot = (rot + 72) % 72; rx = dx; ry = dy }
        }
      }
    }
    const x = c.cx + rx, y = c.cy + ry
    const m = bestSize * 0.4
    if (x < m || y < m || x > W - m || y > H - m) continue // cut off by the image edge
    if (best >= THRESHOLD) found.push({ x, y, s: bestSize, rot: bestRot, v: best })
  }
  found.sort((a, b) => b.v - a.v)
  const kept = []
  for (const f of found) if (!kept.some((k) => Math.hypot(k.x - f.x, k.y - f.y) < Math.max(k.s, f.s) * 0.5)) kept.push(f)
  if (clusters) {
    // big overlapping stars in the corner clusters: find their solid white/red cores,
    // check the core is wrapped in black, and size the icon from the core
    const red = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) if (rgb[i * 3] >= 110 && rgb[i * 3 + 1] <= 70 && rgb[i * 3 + 2] <= 70) red[i] = 1
    const cands = [...cores(cls, W, H, 1, 24, 110), ...cores(red, W, H, 1, 24, 110).map((c) => ({ ...c, red: true }))]
    for (const c of cands) {
      const r = Math.max(c.w, c.h) * 0.85
      let dark = 0, n = 0
      for (let a = 0; a < 360; a += 10) {
        const x = Math.round(c.cx + r * Math.cos((a * Math.PI) / 180)), y = Math.round(c.cy + r * Math.sin((a * Math.PI) / 180))
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        n++; if (gray[y * W + x] < 70) dark++
      }
      // and, along the core's five tip directions, the parent star's rings: black, then white, then black
      const cw = Math.max(c.w, c.h)
      let rays = 0
      for (let k = 0; k < 5; k++) {
        const a = ((c.tip + k * 72) * Math.PI) / 180
        let seq = ''
        for (let r = cw * 0.55; r <= cw * 3; r += 2) {
          const x = Math.round(c.cx + r * Math.cos(a)), y = Math.round(c.cy + r * Math.sin(a))
          if (x < 0 || y < 0 || x >= W || y >= H) break
          const g = gray[y * W + x]
          seq += g < 70 ? 'd' : g > 200 ? 'l' : 'o'
        }
        // collapse runs, ignore 1-pixel blips
        const runs = seq.match(/(.)\1*/g) || []
        const compact = runs.filter((r) => r.length >= 2).map((r) => r[0]).join('').replace(/(.)\1+/g, '$1')
        if ((c.red ? /^[lo]?d+[lo]+d/ : /^l?d+l+d/).test(compact)) rays++
      }
      if (process.env.DEBUG_CORES) console.log('core', Math.round(c.cx), Math.round(c.cy), c.w, c.h, 'dark', (dark / n).toFixed(2), 'rays', rays)
      if (!n || dark / n < 0.6) continue
      if (rays < 3) continue
      const size = Math.max(c.w, c.h) * 4.4
      if (kept.some((k) => Math.hypot(k.x - c.cx, k.y - c.cy) < Math.max(k.s, size) * 0.4)) continue
      kept.push({ x: c.cx, y: c.cy, s: size, rot: c.rot, v: 1, k: 1 })
    }
  }
  kept.sort((a, b) => a.y - b.y || a.x - b.x)
  return kept.map((k) => ({
    x: +((k.x / W) * 100).toFixed(2),
    y: +((k.y / H) * 100).toFixed(2),
    s: +((k.s / W) * 100).toFixed(2),
    r: k.rot,
    ...(k.k ? { k: k.k } : {}),
  }))
}

;(async () => {
  const files = fs.readdirSync(PAGES).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && (!process.env.FILTER || f.includes(process.env.FILTER)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const lines = [
    '// GENERATED by `npm run find-stars` — positions of the small stars on each page,',
    '// as percentages of the image: x/y = centre, s = star width, r = rotation in degrees,',
    '// k = icon size relative to the star (optional; default is the scale setting in portfolio.js).',
    '// Safe to hand-edit: delete a line to remove a star, add one to place a new star.',
    'export const STARS = {',
  ]
  for (const f of files) {
    const t0 = Date.now()
    const stars = await detect(path.join(PAGES, f), CLUSTER_PAGES.length === 0 || CLUSTER_PAGES.some((p) => f.includes(p)))
    lines.push(`  ${JSON.stringify(f)}: [`)
    for (const s of stars) lines.push(`    { x: ${s.x}, y: ${s.y}, s: ${s.s}, r: ${s.r}${s.k ? ', k: ' + s.k : ''} },`)
    lines.push('  ],')
    console.log(`${f}: ${stars.length} stars (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  }
  lines.push('}', '')
  fs.writeFileSync(OUT, lines.join('\n'))
  console.log('wrote', path.relative(ROOT, OUT))
})()
