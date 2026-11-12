import { useCallback, useEffect, useState } from 'react'
import { SITE } from './content/site.js'
import { PAGES } from './content/pages.js'
import { NAV_H, StageProvider, scrollToPage, useStageSize } from './lib/stage.js'
import { calibrateFonts } from './lib/fonts.js'
import Header from './components/Header.jsx'
import Stage from './components/Stage.jsx'
import Viewer, { photoIndex } from './components/Viewer.jsx'

const COUNT = PAGES.reduce((n, p) => n + p.photos.length, 0)

export default function App() {
  const size = useStageSize()
  const [viewing, setViewing] = useState(-1)

  useEffect(() => {
    document.title = SITE.title
    document.body.style.background = SITE.background
    calibrateFonts()
    // open on the page named in the address, if any
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id && document.getElementById(id)) requestAnimationFrame(() => scrollToPage(id, false))
  }, [])

  const open = useCallback((pageId, id) => setViewing(photoIndex(pageId, id)), [])
  const close = useCallback(() => setViewing(-1), [])
  const move = useCallback((d) => setViewing((i) => (i + d + COUNT) % COUNT), [])

  return (
    <StageProvider value={size}>
      <div className={SITE.motion ? 'motion' : ''} style={{ paddingTop: NAV_H, background: SITE.background }}>
        <a className="skip" href="#about" onClick={(e) => { e.preventDefault(); scrollToPage('about') }}>
          Skip to content
        </a>
        <Header />
        <main>
          {PAGES.map((page, i) => (
            <section key={page.id} id={page.id} className="page" aria-label={page.title}>
              {i === 0 ? <h1 className="sr-only">{SITE.title}</h1> : <h2 className="sr-only">{page.title}</h2>}
              <Stage page={page} eager={i === 0} onOpen={open} />
            </section>
          ))}
        </main>
        {SITE.footer && (
          <footer className="py-6 text-center">
            <a href={SITE.footer.href} className="text-xs tracking-wide text-white/40 transition-colors hover:text-white/80">
              {SITE.footer.label}
            </a>
          </footer>
        )}
      </div>
      {viewing >= 0 && <Viewer index={viewing} onMove={move} onClose={close} />}
    </StageProvider>
  )
}
