// Records the self-contained site/NN.html. Frame-exact capture: steps the scene at a fixed timestep (no dropped frames), pipes PNGs to ffmpeg.
//   npm run publish                → today's day
//   npm run publish -- 3 7         → days 03 and 07
//   options: --size 1080x1920  --fps 60  --seconds 20  (default: exactly one loop → seamless)  --crf 22
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import puppeteer from 'puppeteer-core'
import ffmpeg from 'ffmpeg-static'

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { size: { type: 'string', default: '1080x1080' }, fps: { type: 'string', default: '60' }, seconds: { type: 'string' }, crf: { type: 'string', default: '22' } },
})
const [W, H] = o.size.split('x').map(Number), fps = +o.fps
const days = (positionals.length ? positionals : [new Date().getDate()]).map(d => String(d).padStart(2, '0'))

// headless Chrome occasionally fails a capture: retry a few times before giving up
const shot = async (page, opts, k = 0) => {
  try { return await page.screenshot(opts) } catch (e) { if (k > 8) throw e; await new Promise(r => setTimeout(r, 100 * ++k)); return shot(page, opts, k) }
}

mkdirSync('site/videos', { recursive: true })
const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})

for (const d of days) {
  if (!existsSync(`site/${d}.html`)) { console.log(`✗ site/${d}.html not found (no days/${d}.js?)`); continue }
  const page = await browser.newPage()
  page.on('pageerror', e => console.error(`  [${d}] ${e.message}`))
  page.on('console', m => m.type() === 'error' && console.error(`  [${d}] ${m.text().slice(0, 400)}`))
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto(`${pathToFileURL(`site/${d}.html`)}?record`)
  await page.waitForFunction('window.__ready', { timeout: 60000 })

  const loop = await page.evaluate('window.__loop')
  const n = Math.round((o.seconds ? +o.seconds : loop) * fps)
  const out = `site/videos/${d}.mp4`
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', o.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })

  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.__frame(t), i / fps)
    const png = await shot(page, { type: 'png', optimizeForSpeed: true })
    if (!ff.stdin.write(png)) await once(ff.stdin, 'drain')
    if (i === n >> 1) await shot(page, { type: 'jpeg', quality: 88, path: `site/videos/${d}.jpg` })
    process.stdout.write(`\r  ${d}  ${'█'.repeat((20 * (i + 1) / n) | 0).padEnd(20, '·')}  ${i + 1}/${n}`)
  }
  ff.stdin.end(), await once(ff, 'close')
  console.log(`\n✓ ${out}  ${W}×${H} @${fps}  ${(n / fps).toFixed(1)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  await page.close()
}

await browser.close()
