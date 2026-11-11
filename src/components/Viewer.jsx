import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ASSET, PAGES } from '../content/pages.js'

// every photo of the portfolio, in page order, so the arrows walk through all of them
const ALL = PAGES.flatMap((page) =>
  page.photos.map((id) => {
    const item = page.items.find((i) => i.id === id)
    return { key: `${page.id}/${id}`, page, item }
  }),
)
export const photoIndex = (pageId, id) => ALL.findIndex((p) => p.key === `${pageId}/${id}`)

/** Full-screen photo viewer: arrows or swipe to move, Esc or a click outside to close. */
export default function Viewer({ index, onMove, onClose }) {
  const entry = ALL[index]
  const closeRef = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const touch = useRef(null)

  useEffect(() => setLoaded(false), [index])
  useEffect(() => {
    const prevFocus = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onMove(1)
      else if (e.key === 'ArrowLeft') onMove(-1)
      else if (e.key === 'Tab') {
        // keep the keyboard inside the viewer
        const f = [...document.querySelectorAll('.viewer button')]
        const i = f.indexOf(document.activeElement)
        e.preventDefault()
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onMove])
  // warm up the neighbours so stepping feels instant
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = ALL[(index + d + ALL.length) % ALL.length]
      if (n) new Image().src = ASSET(n.item.full.src)
    }
  }, [index])

  if (!entry) return null
  const { item, page } = entry
  const caption = item.caption || []
  const name = item.alt || caption.join(', ') || page.title

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo: ${name}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touch.current == null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (Math.abs(dx) > 48) onMove(dx < 0 ? 1 : -1)
      }}
    >
      <span className="viewer-count" aria-hidden="true">
        {String(index + 1).padStart(2, '0')} / {ALL.length}
      </span>
      <button ref={closeRef} type="button" className="viewer-btn" style={{ right: 14, top: 14 }} onClick={onClose} aria-label="Close photo">
        ✕
      </button>
      <button type="button" className="viewer-btn" style={{ left: 14, top: '50%', marginTop: -23 }} onClick={() => onMove(-1)} aria-label="Previous photo">
        ‹
      </button>
      <button type="button" className="viewer-btn" style={{ right: 14, top: '50%', marginTop: -23 }} onClick={() => onMove(1)} aria-label="Next photo">
        ›
      </button>
      <div className="viewer-frame" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img
          key={entry.key}
          src={ASSET(item.full.src)}
          width={item.full.w}
          height={item.full.h}
          alt={name}
          onLoad={() => setLoaded(true)}
          style={{
            opacity: loaded ? 1 : 0.35,
            transition: 'opacity .2s',
            aspectRatio: `${item.full.w} / ${item.full.h}`,
            // fill the screen comfortably; small originals are enlarged, but not past 1.8x
            width: `min(92vw, calc((100dvh - 190px) * ${(item.full.w / item.full.h).toFixed(4)}), ${Math.round(item.full.w * 1.8)}px)`,
            height: 'auto',
            maxHeight: 'none',
          }}
        />
      </div>
      {caption.length > 0 && (
        <p className="viewer-cap">
          {caption.map((line, i) => (
            <span key={i} style={{ display: 'block' }}>
              {/^[^a-z]+$/.test(line) && i > 0 ? <b>{line}</b> : line}
            </span>
          ))}
        </p>
      )}
    </div>,
    document.body,
  )
}
