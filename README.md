# vibecodevember ’26

One stage, one mood, thirty days. Every entry shares the same near-black background, bone-white ink, single ember accent, lighting, bloom, grain, vignette, camera drift and label. A day only adds things to the scene.

```
npm i
npm run new            # scaffold today's days/NN.js (or: npm run new -- 12) and build it
npm run dev            # rebuild on save; open site/NN.html and refresh
npm run build          # days/*.js → packed site/NN.html + site/index.html   (--roadroller: smallest, slow to open)
npm run publish        # build + record today's video → site/videos/NN.mp4 + NN.jpg poster
npm run publish -- 3 7 --size 1080x1920 --fps 60 --seconds 20 --crf 22
```

## A day

```js
import { go, THREE, C, U, R, TAU, noise, pointer } from '../lib/stage.js'

go('title', ({ scene, camera, renderer }) => {
  const m = new THREE.Mesh(geo, mat)
  scene.add(m)
  return (t, p) => { /* t = seconds, p = 0→1 loop phase */ }
}, { loop: 10, eye: [0, 0, 10], drift: 1, bloom: 0.9, fog: 0.045 })
```

| export  | what |
|---------|------|
| `C`     | palette: `bg`, `ink`, `accent` (hex) |
| `U`     | shared uniforms for shaders — `time`, `phase`, `res`, `ink`, `accent`. Pass as `uniforms: U` |
| `R`     | seeded random: `R()`, `R(a)`, `R(a, b)` — use instead of `Math.random` so every render is identical |
| `noise` | GLSL `snoise(vec3)`; prepend to a shader string |
| `TAU`   | 2π |
| `pointer` | mouse in NDC for `raycaster.setFromCamera(pointer, camera)`; `pointer.active` once the mouse moves (never while recording, so videos stay deterministic) |

## Rules that keep videos perfect

- Animate with `p` (or `phase` in GLSL), not `t`, and only with whole cycles per loop (`sin(p * TAU * n)`, a circle through noise space, …). The default video is exactly one loop, so it repeats seamlessly.
- Use `R`, never `Math.random`, `Date` or `performance.now`.
- The recorder doesn't run in real time. It steps a fixed timestep frame by frame (`NN.html?record` exposes `window.__frame(t)`), so heavy scenes still come out at a smooth 60 fps.

## Self-contained

Every `site/NN.html` is one standalone file with three.js, shaders, CSS and code all inline. It makes no requests, needs no server or CDN, and opens with a double-click (`file://`), from email, or from any host. `site/index.html` is the gallery and also opens from disk. The only files outside the HTML are the recorded videos in `site/videos/`. `site/` is generated, so edit `days/`, `lib/` and `scripts/` instead.

Packing (`npm run build` / `publish`): esbuild bundles and tree-shakes the code, Terser minifies it with safe settings (its `unsafe` options break three.js), then it's deflated at level 9 and inlined as base64. The browser's built-in `DecompressionStream` unpacks it in about 50 ms. That takes a day from 758 KB to about 252 KB. `npm run build -- --roadroller` packs with Roadroller instead: about 175 KB, but decoding takes about 6 s at every load and packing about 25 s per day, so keep it for size-capped submissions. `npm run dev` skips packing so rebuilds stay instant.

Recording runs your installed Chrome headless (`puppeteer-core`) and the bundled `ffmpeg-static`, so you don't need a system ffmpeg. Very detailed scenes (dense particles plus grain) make large files: raise `--crf` (26–28) for lighter web copies.
