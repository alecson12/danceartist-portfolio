import { useEffect } from 'react'
import pages from 'virtual:pages'
import { PORTFOLIO } from './content/portfolio.js'

export default function App() {
  useEffect(() => {
    document.title = PORTFOLIO.title
    document.body.style.background = PORTFOLIO.background
  }, [])

  return (
    <div className="min-h-dvh" style={{ background: PORTFOLIO.background }}>
      <main className="mx-auto w-full" style={{ maxWidth: PORTFOLIO.maxWidth }}>
        {pages.length === 0 ? (
          <Empty />
        ) : (
          pages.map((page, i) => (
            <img
              key={page.name}
              src={page.src}
              width={page.width}
              height={page.height}
              alt={PORTFOLIO.alt[page.name] ?? `${PORTFOLIO.title}, page ${i + 1}`}
              className="h-auto w-full"
              loading={i < 2 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : 'auto'}
              decoding="async"
            />
          ))
        )}
      </main>

      {PORTFOLIO.footer && (
        <footer className="mx-auto w-full py-6 text-center" style={{ maxWidth: PORTFOLIO.maxWidth }}>
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

// Shown only while public/pages/ has no images yet.
function Empty() {
  return (
    <p className="flex min-h-dvh items-center justify-center px-6 text-center text-sm text-white/50">
      No images yet — drop them into public/pages/ as 01.jpg, 02.jpg, 03.jpg …
    </p>
  )
}
