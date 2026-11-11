import { createContext, useContext, useLayoutEffect, useState } from 'react'
import { DESIGN } from '../content/pages.js'

export const NAV_H = 56

/**
 * How the pages are shown in the current window.
 *   mode 'stage'  each page is the design itself, scaled as a whole to fit the screen
 *   mode 'flow'   phones, upright tablets and narrow windows: the same pieces, re-stacked in one column
 */
function measure() {
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  // below about 960 px a whole page would shrink its lettering under 8 px: re-stack instead
  const flow = vw < 960 || vh < 430
  // one page fills the screen under the header; never wider than the window
  // (in the column layout a page shown whole, such as a section cover, spans the full width)
  const width = flow ? vw : Math.max(320, Math.min(vw, Math.round(((vh - NAV_H) * DESIGN.w) / DESIGN.h)))
  return { mode: flow ? 'flow' : 'stage', vw, vh, width, scale: width / DESIGN.w }
}

const Ctx = createContext({ mode: 'stage', vw: 1440, vh: 900, width: 1440, scale: 1440 / DESIGN.w })
export const StageProvider = Ctx.Provider
export const useStage = () => useContext(Ctx)

export function useStageSize() {
  const [size, setSize] = useState(measure)
  useLayoutEffect(() => {
    let raf = 0
    const apply = () => {
      const m = measure()
      const root = document.documentElement.style
      root.setProperty('--stage-w', m.width + 'px')
      root.setProperty('--s', String(m.scale))
      // whole pixels, so consecutive pages meet without a hairline between them
      root.setProperty('--stage-h', Math.floor((m.width * DESIGN.h) / DESIGN.w) + 'px')
      setSize((prev) => (prev.mode === m.mode && prev.width === m.width && prev.vw === m.vw ? prev : m))
    }
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply) }
    apply()
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [])
  return size
}

/** Scroll so a page sits right under the header. */
export function scrollToPage(id, smooth = true) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const top = id === 'intro' ? 0 : el.getBoundingClientRect().top + window.scrollY - NAV_H
  window.scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'auto' })
  history.replaceState(null, '', id === 'intro' ? window.location.pathname + window.location.search : `#${id}`)
}
