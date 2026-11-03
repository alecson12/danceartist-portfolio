// Finds every image in public/pages/, sorts them by filename and reads their
// pixel size, then exposes the list to the app as the module `virtual:pages`.
// Because the width/height are known before the browser downloads anything,
// the page can reserve the exact space for each image and never jumps.
//
// Nothing here needs editing to add images: drop them in public/pages/.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { imageSize } from 'image-size'

const VIRTUAL_ID = 'virtual:pages'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|svg)$/i

function listPages(dir, base) {
  let files = []
  try {
    files = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return files
    .filter((f) => f.isFile() && IMAGE_EXT.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => {
      const { width, height } = imageSize(readFileSync(join(dir, name)))
      return { name, src: `${base}pages/${encodeURIComponent(name)}`, width, height }
    })
}

export default function pagesPlugin() {
  let dir
  let base

  return {
    name: 'dance-portfolio-pages',
    configResolved(config) {
      dir = join(config.publicDir, 'pages')
      base = config.base.endsWith('/') ? config.base : config.base + '/'
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(listPages(dir, base))}`
      }
    },
    // Dev server: when an image is added, removed or replaced, rebuild the list and reload.
    configureServer(server) {
      server.watcher.add(dir)
      const refresh = (file) => {
        if (!file.startsWith(dir)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', refresh)
      server.watcher.on('unlink', refresh)
      server.watcher.on('change', refresh)
    },
  }
}
