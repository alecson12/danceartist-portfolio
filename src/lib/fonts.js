// Live text is pinned by its baseline, like in Photoshop. Where a browser puts the baseline
// of a font depends a little on the platform, so measure it once the fonts are in and store
// it in the --k-* variables that the text positions are written against.
const FAMILIES = { scp: 'var(--f-scp)', bebas: 'var(--f-bebas)', hand: 'var(--f-hand)', sans: 'var(--f-sans)' }

function probe(family) {
  const d = document.createElement('div')
  d.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;line-height:0;font-size:400px;font-family:${family}`
  d.innerHTML = '<span>Hxg</span><i style="display:inline-block;width:1px;height:0"></i>'
  document.body.appendChild(d)
  const k = (d.lastChild.getBoundingClientRect().top - d.getBoundingClientRect().top) / 400
  d.remove()
  return k
}

export function calibrateFonts() {
  const run = () => {
    for (const [key, family] of Object.entries(FAMILIES)) {
      const k = probe(family)
      if (k > 0.05 && k < 0.8) document.documentElement.style.setProperty(`--k-${key}`, k.toFixed(4))
    }
  }
  run()
  if (document.fonts && document.fonts.ready) {
    // ask for the faces up front so every page is set in the right font from its first paint
    const faces = ['400 16px "Source Code Pro Variable"', 'italic 700 16px "Source Code Pro Variable"', '400 16px "Bebas Neue"', '400 16px "Alecson Hand"']
    Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))).then(run)
    document.fonts.ready.then(run)
  }
}
