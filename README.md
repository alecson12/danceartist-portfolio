# Dance Artist portfolio

A single page that shows the Behance portfolio images as one seamless vertical
stack, full width at any screen size.

## Adding or reordering images

1. Drop the images into `public/pages/`, named in display order:
   `01.jpg`, `02.jpg`, `03.jpg` … (any size; jpg, png, webp, gif, avif or svg).
2. Done. The site picks them up automatically, in filename order.
   Reorder by renaming, remove by deleting.

Everything else that is editable (tab title, background colour, max width,
footer link, optional alt text) is in `src/content/portfolio.js`.

## Spinning stars

The star icon in `public/icon/star_p5.png` is laid over every small star in the
pages and slowly spins. Its positions live in `src/content/stars.js`:

- `npm run find-stars` regenerates that file by scanning the images (run it
  again if a page image changes).
- The file is plain data you can hand-edit: delete a line to remove a star,
  copy a line and change `x`/`y` (percent of the image) to add one.
- Size, speed and the icon itself are set under `stars` in
  `src/content/portfolio.js`; set `stars: null` to turn the effect off.

## Running it

```bash
npm install
npm run dev
```

Then open the address Vite prints (http://localhost:5173 by default).

`npm run build` writes the deployable site to `dist/`.

## Deploying

Pushing to the `main` branch of the GitHub repo runs
`.github/workflows/deploy.yml`, which builds the site and publishes it to
GitHub Pages at `https://alecson12.github.io/danceartist-portfolio/`.
The repo must be named `danceartist-portfolio`; if it is named differently, change
`base` in `vite.config.js` to match.

## How it works

`vite-plugin-pages.js` scans `public/pages/` at build time, sorts the files by
name and reads each image's pixel size. `src/App.jsx` renders them as `<img>`
elements with width and height set, so the browser reserves the right space
before the images load and the page never jumps. Images below the fold load
lazily.
