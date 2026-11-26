import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 11 — meander: differential growth. A closed line of light keeps growing but may never cross itself, so it buckles and folds
// into an ever finer labyrinth, like brain coral or a river delta. New growth burns ember, older line cools to bone; sparks race
// along it both ways and light breathes through it.
// click: plant a new seed · drag: carve a channel through it
go('meander', ({ scene, camera }) => {
  const LOOP = 16, MAXN = 8500, L = 0.02, RAD = 0.045, BOUND = 1.5, SUB = 3
  let curves = [], born = 0, now = 0
  const seed = (cx, cy, r) => { const n = 28, c = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; c.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, b: born }) } curves.push(c) }
  const reset = () => ((curves = []), (born = 0), seed(0, 0, 0.12))

  // ── one growth step: edges spring to a rest length, everything else nearby repels (spatial hash), growth is rationed ──
  const grid = new Map(), key = (x, y) => ((Math.floor(x / RAD) + 512) << 10) | (Math.floor(y / RAD) + 512)
  let finger = null
  const step = () => {
    grid.clear()
    curves.forEach((c, ci) => c.forEach((p, i) => { p.c = ci, (p.i = i); const k = key(p.x, p.y); grid.has(k) ? grid.get(k).push(p) : grid.set(k, [p]) }))
    let total = 0
    for (const c of curves) {
      const n = c.length
      for (let i = 0; i < n; i++) {
        const p = c[i], a = c[(i - 1 + n) % n], b = c[(i + 1) % n]
        let fx = ((a.x + b.x) / 2 - p.x) * 0.2, fy = ((a.y + b.y) / 2 - p.y) * 0.2 // smoothing: rounded, coral-like walls
        for (const q of [a, b]) { const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1; (fx += (dx / d) * (d - L) * 0.3), (fy += (dy / d) * (d - L) * 0.3) } // springs
        const gx = Math.floor(p.x / RAD), gy = Math.floor(p.y / RAD)
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get(((gx + ox + 512) << 10) | (gy + oy + 512)); if (!cell) continue
          for (const q of cell) {
            if (q.c === p.c) { const di = Math.abs(q.i - p.i); if (Math.min(di, n - di) < 4) continue } // ignore our own neighbours along the line
            const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy
            if (d2 < RAD * RAD && d2 > 1e-12) { const d = Math.sqrt(d2), f = (RAD - d) * 0.35; (fx += (dx / d) * f), (fy += (dy / d) * f) } // never cross
          }
        }
        const r = Math.hypot(p.x, p.y); if (r > BOUND) (fx -= (p.x / r) * (r - BOUND) * 0.3), (fy -= (p.y / r) * (r - BOUND) * 0.3) // a soft round edge
        const m = Math.hypot(fx, fy), cap = L * 0.35; if (m > cap) (fx *= cap / m), (fy *= cap / m) // small moves: lines can't jump each other
        if (finger) { const dx = p.x - finger.x, dy = p.y - finger.y, d = Math.hypot(dx, dy); if (d < 0.3 && d > 1e-6) (fx += (dx / d) * (0.3 - d) * 0.3), (fy += (dy / d) * (0.3 - d) * 0.3) } // the finger is stronger than the cap: it carves
        p.nx = p.x + fx + R(-1, 1) * 0.0002, p.ny = p.y + fy + R(-1, 1) * 0.0002
      }
      for (const p of c) (p.x = p.nx), (p.y = p.ny)
      total += n
    }
    if (total < MAXN) for (const c of curves) { // grow: keep adding length at random points; crowding makes it buckle and fold
      for (let k = Math.max(1, Math.round(c.length * 0.0028)); k > 0; k--) {
        const i = Math.floor(R(c.length)), p = c[i], q = c[(i + 1) % c.length]
        c.splice(i + 1, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, b: now })
      }
    }
  }

  // ── drawn as a ribbon (a 1px line would vanish), coloured by age: ember at the growing edge, bone where it has settled ──
  const pos = new Float32Array(MAXN * 4 * 3), age = new Float32Array(MAXN * 4), arc = new Float32Array(MAXN * 4), idx = new Uint32Array(MAXN * 6 * 2)
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('age', new THREE.BufferAttribute(age, 1)).setAttribute('arc', new THREE.BufferAttribute(arc, 1)).setIndex(new THREE.BufferAttribute(idx, 1))
  const ru = { ...U, life: { value: 1 } }
  const ribbon = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: ru, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float age, arc; varying float vA, vS; void main(){ vA = age, vS = arc; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 ink, accent; uniform float life, phase; varying float vA, vS;
      void main(){
        float hot = exp(-vA * 1.6), wave = .5 + .5 * sin(vS * 9. - phase * 6.2832 * 10.);       // light breathing along the line
        float a = fract(vS * .55 - phase * 7.), b = fract(-vS * .4 - phase * 9. + .37);       // sparks racing both ways, as in 03
        float sp = pow(a, 50.) + pow(b, 70.) * .8 + pow(a, 8.) * .08;
        vec3 c = ink * .2 * (.55 + .45 * wave) + mix(accent * .9, ink * 1.6, hot * hot) * hot + mix(accent * 2.2, ink * 3.5, sp * sp) * sp;
        gl_FragColor = vec4(c * life, 1.);
      }`,
  }))
  ribbon.frustumCulled = false, ribbon.rotation.x = -0.55, scene.add(ribbon) // a slight tilt: a plate seen from above, not a diagram
  const build = () => {
    let v = 0, k = 0
    for (const c of curves) {
      const n = c.length, v0 = v; let s = 0
      for (let i = 0; i < n; i++) {
        const a = c[(i - 1 + n) % n], b = c[(i + 1) % n], p = c[i]
        let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1, w = 0.0032 + 0.003 * Math.exp(-(now - p.b) * 0.9) // fresh growth is a touch thicker
        tx /= tl, ty /= tl
        pos.set([p.x - ty * w, p.y + tx * w, 0, p.x + ty * w, p.y - tx * w, 0], v * 3), (age[v] = age[v + 1] = now - p.b), (arc[v] = arc[v + 1] = s), (s += Math.hypot(b.x - p.x, b.y - p.y))
        const j = v0 + ((i + 1) % n) * 2
        idx.set([v, v + 1, j, v + 1, j + 1, j], k), (k += 6), (v += 2)
      }
    }
    geo.setDrawRange(0, k), (geo.attributes.position.needsUpdate = geo.attributes.age.needsUpdate = geo.attributes.arc.needsUpdate = geo.index.needsUpdate = true)
  }

  // ── each loop grows from a seed and fades before the wrap · you can plant more seeds and carve with a finger ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), local = new THREE.Vector3()
  const toPlate = () => (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).applyQuaternion(ribbon.quaternion), ribbon.position), hit) ? ribbon.worldToLocal(local.copy(hit)) : null)
  let down = null, cycle = -1
  addEventListener('pointerdown', () => (down = { moved: 0, x: pointer.x, y: pointer.y }))
  addEventListener('pointermove', () => down && ((down.moved += Math.hypot(pointer.x - down.x, pointer.y - down.y)), (down.x = pointer.x), (down.y = pointer.y)))
  addEventListener('pointerup', () => { if (down && down.moved < 0.02) { const q = toPlate(); if (q && Math.hypot(q.x, q.y) < BOUND) seed(q.x, q.y, 0.06) } down = null })

  return t => {
    now = t
    if (Math.floor(t / LOOP) !== cycle) cycle = Math.floor(t / LOOP), reset(), (born = t), curves[0].forEach(p => (p.b = t))
    finger = down && down.moved >= 0.02 ? toPlate() : null
    for (let i = 0; i < SUB; i++) step()
    build()
    const tl = t % LOOP
    ru.life.value = Math.min(1, tl / 0.8) * Math.min(1, (LOOP - tl) / 2) // grow in, fade out before the wrap → seamless
  }
}, { loop: 16, eye: [0, 0.2, 5.2], drift: 0.5, bloom: 0.75 })
