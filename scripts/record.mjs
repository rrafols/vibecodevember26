// Records the self-contained docs/NN.html. Frame-exact capture: steps the scene at a fixed timestep (no dropped frames), pipes PNGs to ffmpeg.
//   npm run publish                → today's day
//   npm run publish -- 3 7         → days 03 and 07
//   options: --size 1080x1920  --fps 60  --seconds 20  (default: exactly one loop → seamless)  --crf 22  --poster (only redo the still)
// A day with { blend: s } (stateful sims) is rendered s seconds past the loop and its tail crossfaded into its head → still seamless.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import puppeteer from 'puppeteer-core'
import ffmpeg from 'ffmpeg-static'

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { size: { type: 'string', default: '1080x1080' }, fps: { type: 'string', default: '60' }, seconds: { type: 'string' }, crf: { type: 'string', default: '22' }, poster: { type: 'boolean', default: false } },
})
const [W, H] = o.size.split('x').map(Number), fps = +o.fps
const days = (positionals.length ? positionals : [new Date().getDate()]).map(d => String(d).padStart(2, '0'))

// headless Chrome occasionally fails a capture: retry a few times before giving up
const shot = async (page, opts, k = 0) => {
  try { return await page.screenshot(opts) } catch (e) { if (k > 8) throw e; await new Promise(r => setTimeout(r, 100 * ++k)); return shot(page, opts, k) }
}

mkdirSync('docs/videos', { recursive: true })
const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})

for (const d of days) {
  if (!existsSync(`docs/${d}.html`)) { console.log(`✗ docs/${d}.html not found (no days/${d}.js?)`); continue }
  const page = await browser.newPage()
  page.on('pageerror', e => console.error(`  [${d}] ${e.message}`))
  page.on('console', m => m.type() === 'error' && console.error(`  [${d}] ${m.text().slice(0, 400)}`))
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto(`${pathToFileURL(`docs/${d}.html`)}?record`)
  await page.waitForFunction('window.__ready', { timeout: 60000 })

  const [loop, blend, poster] = await page.evaluate('[window.__loop, window.__blend, window.__poster]')
  const L = Math.round((o.seconds ? +o.seconds : loop) * fps), B = Math.min(Math.round(blend * fps), L >> 1), n = L + B
  const still = Math.min(n - 1, Math.round(poster * L))
  if (o.poster) { // stateful days still need every frame up to the still
    for (let i = 0; i <= still; i++) await page.evaluate(t => window.__frame(t), i / fps)
    await shot(page, { type: 'jpeg', quality: 88, path: `docs/videos/${d}.jpg` }), console.log(`✓ docs/videos/${d}.jpg  at ${(still / fps).toFixed(2)}s`), await page.close()
    continue
  }
  const out = `docs/videos/${d}.mp4`
  // body = frames B..L, then the tail (L..L+B) fading into the head (0..B): ends exactly where the body starts
  const xfade = B ? ['-filter_complex', `[0:v]split=3[a][b][c];[a]trim=start_frame=${B}:end_frame=${L},setpts=PTS-STARTPTS[body];[b]trim=start_frame=${L},setpts=PTS-STARTPTS[tail];` +
    `[c]trim=end_frame=${B},setpts=PTS-STARTPTS[head];[tail][head]blend=all_expr='A*(1-N/${B})+B*N/${B}'[mix];[body][mix]concat=n=2:v=1[v]`, '-map', '[v]'] : []
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'png', '-i', '-', ...xfade,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', o.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })

  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.__frame(t), i / fps)
    const png = await shot(page, { type: 'png', optimizeForSpeed: true })
    if (!ff.stdin.write(png)) await once(ff.stdin, 'drain')
    if (i === still) await shot(page, { type: 'jpeg', quality: 88, path: `docs/videos/${d}.jpg` })
    process.stdout.write(`\r  ${d}  ${'█'.repeat((20 * (i + 1) / n) | 0).padEnd(20, '·')}  ${i + 1}/${n}`)
  }
  ff.stdin.end(), await once(ff, 'close')
  console.log(`\n✓ ${out}  ${W}×${H} @${fps}  ${(L / fps).toFixed(1)}s${B ? ' (crossfaded loop)' : ''}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  await page.close()
}

await browser.close()
