// Bundles every days/NN.js into ONE self-contained file: docs/NN.html (three.js + code + css inline, opens from file://).
// Also writes docs/index.html, a gallery of all days.
//   node scripts/build.mjs               esbuild → terser → deflate → base64, unpacked natively by the browser (~0.05s)
//   node scripts/build.mjs --roadroller  esbuild → terser → roadroller: ~30% smaller still, but ~6s black screen to decode
//   node scripts/build.mjs --watch       fast dev rebuilds, plain minified script
import * as esbuild from 'esbuild'
import { minify } from 'terser'
import { deflateRawSync, constants } from 'node:zlib'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const watch = process.argv.includes('--watch'), rr = process.argv.includes('--roadroller')
const days = () => readdirSync('days').filter(f => /^\d+\.js$/.test(f)).map(f => f.slice(0, -3)).sort()
const css = (await esbuild.transform(readFileSync('lib/style.css', 'utf8'), { loader: 'css', minify: true })).code.trim()
const page = (title, body) => `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style>${body}</html>`
const draft = d => /go\(\s*['"]untitled['"]/.test(readFileSync(`days/${d}.js`, 'utf8')) // still titled 'untitled' → built, but kept out of the gallery
const kb = n => `${(n / 1024).toFixed(0)}K`

const pack = async js => {
  if (watch) return js
  js = (await minify(js, { ecma: 2020, compress: { passes: 2 }, mangle: true })).code // no `unsafe`: it breaks three's constructors
  if (rr) {
    const { Packer } = await import('roadroller'), p = new Packer([{ data: js, type: 'js', action: 'eval' }], {})
    await p.optimize(0)
    const { firstLine, secondLine } = p.makeDecoder()
    return firstLine + secondLine
  }
  const z = deflateRawSync(js, { level: 9, memLevel: 9, strategy: constants.Z_DEFAULT_STRATEGY }).toString('base64')
  return `fetch("data:;base64,${z}").then(r=>new Response(r.body.pipeThrough(new DecompressionStream("deflate-raw"))).text()).then(s=>(0,eval)(s))`
}

const write = async r => {
  if (r.errors.length) return
  mkdirSync('docs', { recursive: true })
  writeFileSync('docs/.nojekyll', '') // GitHub Pages: serve files as-is, no Jekyll
  for (const f of r.outputFiles) {
    const d = f.path.match(/(\d+)\.js$/)[1], html = page(`vibecodevember ’26 · ${d}`, `<body data-day=${d}><script>${await pack(f.text)}</script>`)
    writeFileSync(`docs/${d}.html`, html)
    console.log(`  docs/${d}.html  ${kb(f.text.length)} → ${kb(html.length)}`)
  }
  // the gallery fits the screen: try every column count, keep the one with the biggest square tiles (ties go to 6 per row)
  const fit = `const g=document.querySelector('.grid'),h=g.querySelector('h1'),n=g.querySelectorAll('a').length,px=v=>parseFloat(v)||0,f=()=>{const s=getComputedStyle(g),W=g.clientWidth-px(s.paddingLeft)-px(s.paddingRight),H=g.clientHeight-px(s.paddingTop)-px(s.paddingBottom)-h.offsetHeight-px(getComputedStyle(h).marginBottom)-2;let b=[0,6];for(let c=1;c<=n;c++){const r=Math.ceil(n/c),t=Math.min((W-(c-1)*2)/c,(H-(r-1)*2)/r);if(t>b[0]+.5||(Math.abs(t-b[0])<=.5&&Math.abs(c-6)<Math.abs(b[1]-6)))b=[t,c]}g.style.setProperty('--c',b[1]),g.style.setProperty('--s',Math.floor(b[0])+'px')};f(),addEventListener('resize',f)`
  writeFileSync('docs/index.html', page('vibecodevember ’26', `<body><main class=grid><h1>vibecodevember ’26</h1>${days().filter(d => !draft(d)).map(d =>
    `<a href="${d}.html"><video src="videos/${d}.mp4" poster="videos/${d}.jpg" muted loop playsinline autoplay onerror="this.remove()"></video><b>${d}</b></a>`).join('')}</main><script>${fit}</script>`))
  console.log(`✓ ${r.outputFiles.length} days → docs/   ${pathToFileURL('docs/index.html')}`)
}

const ctx = await esbuild.context({
  entryPoints: days().map(d => `days/${d}.js`),
  outdir: 'docs', bundle: true, minify: true, legalComments: 'none', format: 'iife', target: 'es2022', write: false, logLevel: 'error',
  plugins: [{ name: 'html', setup: b => b.onEnd(write) }],
})
watch ? (await ctx.watch(), console.log('watching… edit a day, then refresh its page')) : (await ctx.rebuild(), await ctx.dispose())
