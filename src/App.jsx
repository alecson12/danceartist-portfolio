import { useEffect } from 'react'
import pages from 'virtual:pages'
import { PORTFOLIO } from './content/portfolio.js'
import { STARS } from './content/stars.js'

const BASE = import.meta.env.BASE_URL

export default function App() {
  useEffect(() => {
    document.title = PORTFOLIO.title
    document.body.style.background = PORTFOLIO.background
  }, [])

  const maxWidth = PORTFOLIO.maxWidth ?? 'none'
  return (
    <div className="min-h-dvh" style={{ background: PORTFOLIO.background }}>
      <main className="mx-auto w-full" style={{ maxWidth }}>
        {pages.length === 0 ? (
          <Empty />
        ) : (
          pages.map((page, i) => (
            <Page key={page.name} page={page} index={i} />
          ))
        )}
      </main>

      {PORTFOLIO.footer && (
        <footer className="mx-auto w-full py-6 text-center" style={{ maxWidth }}>
          <a
            href={PORTFOLIO.footer.href}
            className="text-xs tracking-wide text-white/40 transition-colors hover:text-white/80"
          >
            {PORTFOLIO.footer.label}
          </a>
        </footer>
      )}
    </div>
  )
}

// One page image plus its spinning stars, positioned in % so they scale with the image.
function Page({ page, index }) {
  const stars = (PORTFOLIO.stars && STARS[page.name]) || []
  return (
    <div className="relative overflow-hidden">
      <img
        src={page.src}
        width={page.width}
        height={page.height}
        alt={PORTFOLIO.alt[page.name] ?? `${PORTFOLIO.title}, page ${index + 1}`}
        className="h-auto w-full"
        loading={index < 2 ? 'eager' : 'lazy'}
        fetchPriority={index === 0 ? 'high' : 'auto'}
        decoding="async"
      />
      {stars.map((star, i) => (
        <Star key={i} star={star} index={i} />
      ))}
    </div>
  )
}

function Star({ star, index }) {
  const { icon, scale, seconds } = PORTFOLIO.stars
  const size = star.s * scale
  // vary speed and direction per star so the page feels alive rather than mechanical
  const duration = seconds * (0.85 + ((index * 7) % 5) * 0.12)
  const reverse = index % 2 === 1
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${star.x}%`,
        top: `${star.y}%`,
        width: `${size}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <img
        src={BASE + icon}
        alt=""
        aria-hidden="true"
        className="spin block h-auto w-full"
        style={{
          '--spin-from': `${star.r ?? 0}deg`,
          animationDuration: `${duration}s`,
          animationDirection: reverse ? 'reverse' : 'normal',
        }}
      />
    </div>
  )
}

// Shown only while public/pages/ has no images yet.
function Empty() {
  return (
    <p className="flex min-h-dvh items-center justify-center px-6 text-center text-sm text-white/50">
      No images yet — drop them into public/pages/ as 01.jpg, 02.jpg, 03.jpg …
    </p>
  )
}
