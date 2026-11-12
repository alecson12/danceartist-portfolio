// The picture inside a photo frame, upright and as large as its source allows, for the viewer.
// The crop is the designer's: only what shows inside the frame.
'use strict'
const sharp = require('sharp')
const C = require('./compositor.cjs')
const U = require('./units.cjs')
const { sharpRaw, saveWebp } = require('./images.cjs')

const MAX = 1800
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** The four corners of a frame shape, in the order top-left, top-right, bottom-right, bottom-left. */
function frameCorners(node) {
  const l = node.l
  const kd = l.vectorOrigination && l.vectorOrigination.keyDescriptorList && l.vectorOrigination.keyDescriptorList[0]
  let pts = kd && !kd.keyShapeInvalidated && kd.keyOriginBoxCorners && kd.keyOriginBoxCorners.length === 4 ? kd.keyOriginBoxCorners.map((p) => [p.x, p.y]) : null
  if (!pts && l.vectorMask && l.vectorMask.paths && l.vectorMask.paths.length) { const k = l.vectorMask.paths[0].knots; if (k && k.length === 4) pts = k.map((q) => [q.points[2], q.points[3]]) }
  if (!pts) { const b = node.bounds; pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] }
  const pick = (fn) => pts.reduce((m, p) => (fn(p) < fn(m) ? p : m))
  return [pick((p) => p[0] + p[1]), pick((p) => -(p[0] - p[1])), pick((p) => -(p[0] + p[1])), pick((p) => p[0] - p[1])]
}

/** A flattened copy that is one flat colour holds no picture. */
function isBlank(img) {
  const { data } = img
  const step = Math.max(4, Math.floor(data.length / 4 / 20000) * 4)
  let lo = 255, hi = 0
  for (let i = 0; i < data.length; i += step) { const v = data[i + 1]; if (v < lo) lo = v; if (v > hi) hi = v }
  return hi - lo < 6
}

/** The original file a smart object was placed from (it is stored inside the PSD). */
async function decodeLinked(doc, node) {
  const pl = node.l.placedLayer
  const lf = pl && (doc.psd.linkedFiles || []).find((f) => f.id === pl.id)
  if (!lf || !lf.data) return null
  const nm = (lf.name || '').toLowerCase()
  try {
    if (/\.(jpe?g|png|webp|tiff?)$/.test(nm)) {
      const meta = await sharp(lf.data).metadata()
      let img = sharp(lf.data)
      if (meta.width !== Math.round(pl.width) && meta.height === Math.round(pl.width)) img = img.rotate() // honour the camera's orientation flag
      const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return { w: info.width, h: info.height, data, pl }
    }
    if (/\.psb?$/.test(nm)) {
      const nested = C.ag.readPsd(lf.data, { useRawData: true, useRawThumbnail: true, skipLayerImageData: true })
      const c = C.ag.getCompositeImageData(nested)
      if (c && !isBlank(c)) return { w: c.width, h: c.height, data: c.data, pl }
      // saved without a flattened copy: render its layers instead
      const nd = C.openPsdBuffer(lf.data, lf.name)
      if (nd.width * nd.height <= 40e6) {
        const img = C.toRGBA8(C.render(nd, C.rect(0, 0, nd.width, nd.height), () => true, null))
        return { w: img.w, h: img.h, data: img.data, pl }
      }
    }
  } catch { /* not readable: the caller falls back to the layers themselves */ }
  return null
}

function bilinear(src, x, y) {
  const { w, h, data } = src
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return null
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const a = data[(y0 * w + x0) * 4 + c], b = data[(y0 * w + x1) * 4 + c], d = data[(y1 * w + x0) * 4 + c], e = data[(y1 * w + x1) * 4 + c]
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
  }
  return out
}

async function photoFull(doc, u, dir, pageId) {
  const whole = async (node) => {
    const src = await decodeLinked(doc, node)
    if (!src) return null
    const k = Math.min(1, MAX / Math.max(src.w, src.h))
    const w = Math.round(src.w * k), h = Math.round(src.h * k)
    const buf = await sharpRaw(src.data, src.w, src.h).resize(w, h).raw().toBuffer()
    return saveWebp(dir, pageId, `full-${u.z}`, new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), w, h, 'full', { noHalf: true })
  }
  if (u.rule && u.rule.crop) {
    const n = doc.nodes.find((x) => x.name === u.rule.crop && u.leafIds.has(x.id))
    return n ? whole(n) : null
  }
  if (u.rawKind === 'SMART') return whole(u.node)

  const [tl, tr, br, bl] = frameCorners(u.node)
  const W0 = dist(tl, tr), H0 = dist(tl, bl)
  if (W0 < 40 || H0 < 40) return null
  const ex = [(tr[0] - tl[0]) / W0, (tr[1] - tl[1]) / W0], ey = [(bl[0] - tl[0]) / H0, (bl[1] - tl[1]) / H0]
  const rasters = u.clips.filter((c) => c.kind === 'SMART' || c.kind === 'PIXEL' || c.isGroup)
  const adjs = u.clips.filter((c) => c.kind === 'ADJ')
  let src = null, inv = null, k = 1
  if (rasters.length === 1 && rasters[0].kind === 'SMART') {
    const s = await decodeLinked(doc, rasters[0])
    if (s) {
      const q = s.pl.transform
      const para = Math.abs(q[0] + q[4] - q[2] - q[6]) < 2 && Math.abs(q[1] + q[5] - q[3] - q[7]) < 2
      const ux = [(q[2] - q[0]) / s.w, (q[3] - q[1]) / s.w], uy = [(q[6] - q[0]) / s.h, (q[7] - q[1]) / s.h]
      const det = ux[0] * uy[1] - ux[1] * uy[0]
      const density = 1 / Math.hypot(ux[0], ux[1])
      if (para && Math.abs(det) > 1e-6 && density > 1.15) {
        src = s
        inv = (px, py) => { const dx = px - q[0], dy = py - q[1]; return [(dx * uy[1] - dy * uy[0]) / det, (dy * ux[0] - dx * ux[1]) / det] }
        k = Math.max(1, Math.min(density, MAX / Math.max(W0, H0), 3))
      }
    }
  }
  // what the layers themselves show: used as it is, or to fill whatever the source does not cover
  const xs = [tl[0], tr[0], br[0], bl[0]], ys = [tl[1], tr[1], br[1], bl[1]]
  const fr = C.rect(Math.floor(Math.min(...xs)) - 2, Math.floor(Math.min(...ys)) - 2, Math.ceil(Math.max(...xs) - Math.min(...xs)) + 4, Math.ceil(Math.max(...ys) - Math.min(...ys)) + 4)
  const ids = new Set([u.node.id])
  for (const c of u.clips) U.leavesOf(c).forEach((n) => ids.add(n.id))
  const fb = C.toRGBA8(C.render(doc, fr, (n) => ids.has(n.id), null, { noFx: true }))
  const fbSrc = { w: fb.w, h: fb.h, data: fb.data }
  const W = Math.round(W0 * k), H = Math.round(H0 * k)
  const out = new Uint8ClampedArray(W * H * 4)
  const lut = u.lut
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = tl[0] + (ex[0] * (i + 0.5)) / k + (ey[0] * (j + 0.5)) / k, py = tl[1] + (ex[1] * (i + 0.5)) / k + (ey[1] * (j + 0.5)) / k
    let c = null
    if (src) {
      const [sx, sy] = inv(px, py)
      c = bilinear(src, sx - 0.5, sy - 0.5)
      if (c && c[3] < 250) c = null
      if (c && adjs.length) {
        let rgb = [c[0] / 255, c[1] / 255, c[2] / 255]
        for (const a of adjs) {
          const m = C.maskPixels(doc, a)
          const wgt = (a.l.opacity == null ? 1 : a.l.opacity) * (m ? C.maskAt(m, Math.round(px), Math.round(py)) : 1)
          if (wgt <= 0) continue
          const t = C.adjustColor(a.l.adjustment, rgb[0], rgb[1], rgb[2])
          rgb = [rgb[0] + (t[0] - rgb[0]) * wgt, rgb[1] + (t[1] - rgb[1]) * wgt, rgb[2] + (t[2] - rgb[2]) * wgt]
        }
        c = [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, 255]
      }
    }
    if (!c) c = bilinear(fbSrc, px - fb.x - 0.5, py - fb.y - 0.5) || [0, 0, 0, 0]
    // the same tone correction the framed picture received
    if (lut) c = [lut[0][clamp(c[0])], lut[1][clamp(c[1])], lut[2][clamp(c[2])], 255]
    const o = (j * W + i) * 4
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255
  }
  return saveWebp(dir, pageId, `full-${u.z}`, out, W, H, 'full', { noHalf: true })
}

module.exports = { photoFull, frameCorners }
