// A Photoshop text layer set as real text. Coordinates are design pixels inside a stage.
//
// item.m is the layer's own matrix: the text is laid out unscaled around its origin (the
// start of the first baseline, or the top-left of a text box) and the matrix scales, tilts
// and places it, exactly as Photoshop does. Each line is pinned by its baseline (item.lines[].y).

const runStyle = (r) => ({
  fontFamily: `var(--f-${r.f})`,
  fontWeight: r.w,
  fontStyle: r.i ? 'italic' : undefined,
  fontSize: r.s,
  color: r.c,
  letterSpacing: r.ls ? `${r.ls}em` : undefined,
  textTransform: r.up ? 'uppercase' : undefined,
})

const SHIFT = { left: '', center: 'translateX(-50%) ', right: 'translateX(-100%) ' }
const ORIGIN = { left: '0 0', center: '50% 0', right: '100% 0' }

export default function LiveText({ item, ox = 0, oy = 0, href, onClick, label, className = '', style }) {
  const [a, b, c, d, tx, ty] = item.m
  const Tag = href ? 'a' : 'p'
  const stroke = item.stroke ? { WebkitTextStroke: `${(item.stroke.w * 2).toFixed(2)}px ${item.stroke.c}`, paintOrder: 'stroke fill' } : null
  const ext = href && /^https?:/.test(href)
  const linkProps = href ? { href, onClick, 'aria-label': label, target: ext ? '_blank' : undefined, rel: ext ? 'noopener' : undefined } : {}
  const sx = item.sx && item.sx !== 1 ? `scaleX(${item.sx})` : ''
  const shift = (SHIFT[item.align] || '') + sx

  return (
    <Tag
      className={`lt ${className}`}
      style={{ left: tx - ox, top: ty - oy, transform: `matrix(${a},${b},${c},${d},0,0)`, opacity: item.op, ...stroke, ...style }}
      {...linkProps}
    >
      {item.lines.map((ln, i) => {
        const fam = (ln.runs[0] && ln.runs[0].f) || 'scp'
        return (
          <span
            key={i}
            className="ln"
            style={{
              // the line box starts k * size above the baseline (see lib/fonts.js)
              top: `calc(${ln.y}px - var(--k-${fam}) * ${ln.s}px)`,
              transform: shift || undefined,
              transformOrigin: ORIGIN[item.align],
              wordSpacing: ln.ws ? `${ln.ws}px` : undefined,
            }}
          >
            {ln.runs.map((r, k) => (
              <span key={k} style={runStyle(r)}>
                {r.t}
              </span>
            ))}
            {i < item.lines.length - 1 ? ' ' : null}
          </span>
        )
      })}
    </Tag>
  )
}
