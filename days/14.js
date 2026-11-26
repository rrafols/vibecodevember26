import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 14 — kintsugi: a disc of black obsidian cracks from a point, bursts into ~70 shards in slow motion, hangs apart, then draws
// back together. Its fracture faces glow molten gold while apart and cool to fine gold seams once joined — mended, not hidden.
// click the disc: shatter it from there · drag: turn it
go('kintsugi', ({ scene, camera, renderer }) => {
  const RAD = 1.55, TH = 0.11, NS = 72, LOOP = 16

  // ── Voronoi shards: each seed's cell is the disc clipped by the half-planes towards every other seed ──
  const seeds = []; while (seeds.length < NS) { const a = R(TAU), r = RAD * Math.sqrt(R()) * 0.98; seeds.push([Math.cos(a) * r, Math.sin(a) * r]) }
  const clip = (poly, nx, ny, c) => { // keep the side where nx*x + ny*y <= c
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], da = nx * ax + ny * ay - c, db = nx * bx + ny * by - c
      if (da <= 0) out.push([ax, ay])
      if (da * db < 0) { const k = da / (da - db); out.push([ax + (bx - ax) * k, ay + (by - ay) * k]) }
    }
    return out
  }
  const circle = Array.from({ length: 64 }, (_, i) => [Math.cos((i / 64) * TAU) * RAD, Math.sin((i / 64) * TAU) * RAD])
  const cells = seeds.map(([sx, sy], i) => {
    let poly = circle
    seeds.forEach(([tx, ty], j) => { if (i !== j) { const nx = tx - sx, ny = ty - sy; poly = clip(poly, nx, ny, (nx * (sx + tx) + ny * (sy + ty)) / 2) } })
    return poly
  })

  // ── one merged mesh: top, bottom and fracture sides of every shard, each vertex tagged with its shard ──
  const P = [], N = [], ID = [], SIDE = []
  const tri = (a, b, c, n, id, side) => { for (const v of [a, b, c]) P.push(...v), N.push(...n), ID.push(id), SIDE.push(side) }
  cells.forEach((poly, id) => {
    const [cx, cy] = poly.reduce((m, [x, y]) => [m[0] + x / poly.length, m[1] + y / poly.length], [0, 0])
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length]
      tri([cx, TH / 2, cy], [bx, TH / 2, by], [ax, TH / 2, ay], [0, 1, 0], id, 0), tri([cx, -TH / 2, cy], [ax, -TH / 2, ay], [bx, -TH / 2, by], [0, -1, 0], id, 0)
      const outer = Math.hypot((ax + bx) / 2, (ay + by) / 2) > RAD * 0.985, n = [by - ay, 0, -(bx - ax)], l = Math.hypot(n[0], n[2]) || 1
      n[0] /= l, (n[2] /= l)
      tri([ax, TH / 2, ay], [bx, TH / 2, by], [bx, -TH / 2, by], n, id, outer ? 0 : 1), tri([ax, TH / 2, ay], [bx, -TH / 2, by], [ax, -TH / 2, ay], n, id, outer ? 0 : 1) // inner sides are fracture faces
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)), geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
  geo.setAttribute('shard', new THREE.Float32BufferAttribute(ID, 1)), geo.setAttribute('side', new THREE.Float32BufferAttribute(SIDE, 1))

  // ── obsidian: a black mirror reflecting its own small dark studio; fracture faces glow by how far apart the shards are ──
  const studio = new THREE.Scene(), strip = (w, h, k, ...at) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(U.ink.value).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...at), m.lookAt(0, 0, 0), studio.add(m) }
  strip(8, 0.18, 1.6, 1, 6, 3), strip(0.15, 8, 1, -6, 2, 2), strip(30, 30, 0.015, 0, 0, -12)
  const mats = { value: Array.from({ length: NS }, () => new THREE.Matrix4()) }, heat = { value: new Float32Array(NS) }, gold = { value: new Float32Array(NS) }
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x141416, metalness: 0.5, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMap: new THREE.PMREMGenerator(renderer).fromScene(studio, 0.01).texture })
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, { mats, heat, gold, accent: U.accent, ink: U.ink })
    s.vertexShader = `uniform mat4 mats[${NS}]; uniform float heat[${NS}], gold[${NS}]; attribute float shard, side; varying float vSide, vHeat, vGold;\n` + s.vertexShader
      .replace('#include <beginnormal_vertex>', 'int si = int(shard + .5); vec3 objectNormal = mat3(mats[si]) * normal; vSide = side; vHeat = heat[si]; vGold = gold[si];')
      .replace('#include <begin_vertex>', 'vec3 transformed = (mats[si] * vec4(position, 1.)).xyz;')
    s.fragmentShader = `uniform vec3 accent, ink; varying float vSide, vHeat, vGold;\n` + s.fragmentShader
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vSide * (mix(accent * 1.4, ink * 1.1, smoothstep(.6, 1., vHeat)) * vHeat * 1.6 + mix(accent, ink, .4) * .75 * vGold);') // gold only where it is mended // molten while apart, a gold seam after
  }
  const disc = new THREE.Mesh(geo, mat)
  disc.frustumCulled = false
  scene.add(disc)

  // ── choreography: crack front from the impact, burst, drift, return. A smooth function of time → seamless ──
  const axes = seeds.map(() => new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize()), lift = seeds.map(() => R(-1, 1)), spin = seeds.map(() => R(0.6, 1.6))
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1)
  let impact = [0.45, -0.3], t0 = 0, now = 0, own = false
  const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  const shardsAt = age => seeds.forEach(([sx, sy], i) => {
    const dx = sx - impact[0], dy = sy - impact[1], d = Math.hypot(dx, dy) + 1e-3
    const open = ease((age - d * 0.18) / 1.6) * (1 - ease((age - 6.5) / 3.2)) // the crack reaches it, it flies, later it comes home
    const push = open * (0.18 + 0.55 / (d + 0.5))
    V.set((dx / d) * push, lift[i] * open * 0.12, (dy / d) * push) // mostly in the disc's plane
    Q.setFromAxisAngle(axes[i], open * spin[i] * 0.9)
    M.compose(V, Q, ONE), mats.value[i].copy(M).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0))
    // rotate about the shard's own centre: translate there, rotate, translate back
    const c = new THREE.Vector3(sx, 0, sy)
    mats.value[i].makeTranslation(c.x + V.x, V.y, c.z + V.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(Q)).multiply(new THREE.Matrix4().makeScale(0.982, 1, 0.982)).multiply(new THREE.Matrix4().makeTranslation(-c.x, 0, -c.z)) // a hairline gap: the gold seams always show
    gold.value[i] = (1 - open) ** 3
    heat.value[i] = age > d * 0.18 ? Math.exp(-(age - d * 0.18) * 0.9) : 0 // white-hot as the crack passes, cooling through ember to gold
  })

  const ray = new THREE.Raycaster()
  let down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.hypot(pointer.x - lx, pointer.y - ly); if (down.moved > 0.02) (vy = (pointer.x - lx) * 1.8), (vp = -(pointer.y - ly) * 1.2), (yaw += vy), (pitch = THREE.MathUtils.clamp(pitch + vp, -0.45, 0.45)); (lx = pointer.x), (ly = pointer.y) })
  addEventListener('pointerup', () => {
    if (down && down.moved < 0.02) { ray.setFromCamera(pointer, camera); const h = ray.intersectObject(disc)[0]; if (h) { const l = disc.worldToLocal(h.point.clone()); impact = [l.x, l.z], (t0 = now), (own = true) } }
    down = null
  })

  return (t, p) => {
    now = t
    if (!down) (yaw += vy *= 0.93), (pitch = THREE.MathUtils.clamp(pitch + (vp *= 0.93), -0.45, 0.45))
    disc.rotation.set(0.95 + Math.sin(p * TAU) * 0.08 + pitch, p * TAU * 0.5 * 0 + Math.sin(p * TAU) * 0.35 + yaw, 0)
    const age = own ? t - t0 : (t % LOOP) - 2.5 // the loop strikes at 2.5s; everything is home again well before the wrap
    if (own && age > 11) own = false
    shardsAt(age)
  }
}, { loop: 16, eye: [0, 0.6, 6.2], drift: 0.4, bloom: 0.6 })
