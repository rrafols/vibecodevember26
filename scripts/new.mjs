// Scaffold a day, then build:  npm run new  (today)   ·   npm run new -- 12
import { existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const d = String(process.argv[2] || new Date().getDate()).padStart(2, '0'), f = `days/${d}.js`
if (existsSync(f)) console.log(`✗ ${f} already exists`), process.exit(1)

writeFileSync(f, `import { go, THREE, C, U, R, TAU } from '../lib/stage.js'

go('untitled', ({ scene }) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), new THREE.MeshStandardMaterial({ color: C.ink, metalness: 1, roughness: 0.15 }))
  scene.add(m)
  return (t, p) => m.rotation.set(p * TAU, p * TAU * 2, 0) // use p (0→1 per loop) for seamless video
})
`)
console.log(`✓ ${f}  →  docs/${d}.html`)
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' }) // built here, not chained in package.json: npm hands `-- 12` to the last command
