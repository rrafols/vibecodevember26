import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 24 — foundry: molten metal poured from a crucible into a stone mould. ~2,600 particles of a viscoelastic SPH fluid
// (double-density relaxation) carrying heat: they conduct it to each other, lose it to the mould and the air, and grow thick
// and then solid as they cool, so a dark crust forms on the stone and fresh metal remelts it. Overflow spills off the lips
// in curtains. The fluid is drawn as one surface: particles splatted into a buffer, then shaded from its thickness and heat.
// hover: move the crucible · hold: tip it further · click: drop a cold ingot in, watch it melt
go('foundry', ({ scene, camera, renderer }) => {
  const N = 2600, H = 0.1, DT = 1 / 120, G = 7, RHO0 = 4.6, K = 34, KN = 110, PR = 0.03
  const x = new Float32Array(N), y = new Float32Array(N), px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N)
  const T = new Float32Array(N), live = new Uint8Array(N), nearM = new Float32Array(N), tSum = new Float32Array(N), tCnt = new Float32Array(N)
  // the mould: a thick arc · the crucible: a cup on a pivot
  const BC = [0.35, -0.15], BR = 1.38, BT = 0.17, A0 = -Math.PI + 0.36, A1 = -0.36
  const arcD = (X, Y) => { // signed distance to the mould's wall
    const dx = X - BC[0], dy = Y - BC[1], a = Math.atan2(dy, dx), m = BR + BT / 2
    if (a >= A0 && a <= A1) return Math.abs(Math.hypot(dx, dy) - m) - BT / 2
    const e0x = BC[0] + Math.cos(A0) * m, e0y = BC[1] + Math.sin(A0) * m, e1x = BC[0] + Math.cos(A1) * m, e1y = BC[1] + Math.sin(A1) * m
    return Math.min(Math.hypot(X - e0x, Y - e0y), Math.hypot(X - e1x, Y - e1y)) - BT / 2
  }
  // pre-fill the mould with cooling metal so it starts alive
  let k = 0
  for (let gy = -1.45; gy < -0.75 && k < 1300; gy += 0.045) for (let gx = -1.1; gx < 1.8 && k < 1300; gx += 0.045) if (arcD(gx, gy) > 0.04 && Math.hypot(gx - BC[0], gy - BC[1]) < BR) (x[k] = gx + R(-0.005, 0.005)), (y[k] = gy), (T[k] = R(0.35, 0.6)), (live[k++] = 1)

  // ── grid ──
  const GX = 90, GY = 70, OX = -4.5, OY = -3.5, cs = new Int32Array(GX * GY + 1), cc = new Int32Array(GX * GY + 1), ord = new Int32Array(N), cell = new Int32Array(N)
  const build = () => {
    cs.fill(0)
    for (let i = 0; i < N; i++) { if (!live[i]) { cell[i] = -1; continue } const cx = Math.min(GX - 1, Math.max(0, ((x[i] - OX) / H) | 0)), cy = Math.min(GY - 1, Math.max(0, ((y[i] - OY) / H) | 0)); cell[i] = cy * GX + cx, cs[cell[i] + 1]++ }
    for (let c = 1; c <= GX * GY; c++) cs[c] += cs[c - 1]
    cc.set(cs); for (let i = 0; i < N; i++) if (cell[i] >= 0) ord[cc[cell[i]]++] = i
  }
  const each = (i, f) => { // every neighbour j > i … or all, as asked
    const c = cell[i], cx = c % GX, cy = (c / GX) | 0
    for (let oy = -1; oy <= 1; oy++) { const yy = cy + oy; if (yy < 0 || yy >= GY) continue; for (let ox = -1; ox <= 1; ox++) { const xx = cx + ox; if (xx < 0 || xx >= GX) continue; const cc_ = yy * GX + xx; for (let m = cs[cc_]; m < cs[cc_ + 1]; m++) f(ord[m]) } }
  }

  // ── the crucible and its pour ──
  const cru = { x: -1.2, y: 1.75, tilt: 0.9, tiltT: 0.9, rate: 0 }, ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3()
  const lip = () => { const c = Math.cos(-cru.tilt), s = Math.sin(-cru.tilt), lx = 0.34, ly = 0.3; return [cru.x + lx * c - ly * s, cru.y + lx * s + ly * c, c, s] }
  let spawnAcc = 0
  const spawn = n => { for (let i = 0; i < N && n > 0; i++) if (!live[i]) { const [lx, ly, c, s] = lip(); x[i] = lx + R(-0.03, 0.03), (y[i] = ly + R(-0.03, 0.03)), (vx[i] = 0.9 * c + R(-0.1, 0.1)), (vy[i] = 0.9 * s - 0.3), (T[i] = 1), (live[i] = 1), n-- } }
  const ingot = (cx, cy) => { let n = 0; for (let i = 0; i < N && n < 90; i++) if (!live[i]) { x[i] = cx + ((n % 9) - 4) * 0.042, (y[i] = cy + ((n / 9) | 0) * 0.042), (vx[i] = 0), (vy[i] = -1), (T[i] = 0), (live[i] = 1), n++ } }

  // sparks: struck off hard splashes
  const SN = 500, sx = new Float32Array(SN * 3), sv = new Float32Array(SN * 3), sl = new Float32Array(SN)
  const sp = new Float32Array(SN * 6), sc = new Float32Array(SN * 6)
  const sgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)).setAttribute('color', new THREE.BufferAttribute(sc, 3))
  const sparkLines = new THREE.LineSegments(sgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  sparkLines.frustumCulled = false, scene.add(sparkLines)
  let si = 0
  const spark = (X, Y, VX, VY) => { const j = si++ % SN; sx.set([X, Y, R(-0.3, 0.3)], j * 3), sv.set([VX * 1.3 + R(-1, 1), VY * 1.2 + R(0.5, 2.5), R(-1, 1)], j * 3), (sl[j] = R(0.3, 0.8)) }

  const step = () => {
    build()
    // viscosity (stronger as it cools), gravity
    for (let i = 0; i < N; i++) {
      if (!live[i]) continue
      vy[i] -= G * DT
      each(i, j => {
        if (j <= i) return
        const dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy); if (d >= H || d < 1e-6) return
        const q = d / H, nx = dx / d, ny = dy / d, u = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny
        if (u > 0) { const cold = 1 - (T[i] + T[j]) / 2, sg = 0.4 + 14 * cold * cold * cold, I = DT * (1 - q) * (sg * u + 0.3 * u * u) * 0.5; vx[i] -= I * nx, (vy[i] -= I * ny), (vx[j] += I * nx), (vy[j] += I * ny) }
      })
    }
    for (let i = 0; i < N; i++) if (live[i]) (px[i] = x[i]), (py[i] = y[i]), (x[i] += vx[i] * DT), (y[i] += vy[i] * DT)
    build()
    // double density relaxation; conduction alongside
    tSum.fill(0), tCnt.fill(0)
    for (let i = 0; i < N; i++) {
      if (!live[i]) continue
      let rho = 0, rhoN = 0
      each(i, j => { if (j === i) return; const d = Math.hypot(x[j] - x[i], y[j] - y[i]); if (d < H) { const q = 1 - d / H; rho += q * q, (rhoN += q * q * q), (tSum[i] += T[j]), tCnt[i]++ } })
      const P = K * (rho - RHO0), PN = KN * rhoN
      let dxs = 0, dys = 0
      each(i, j => {
        if (j === i) return
        const dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy); if (d >= H || d < 1e-6) return
        const q = 1 - d / H, D = DT * DT * (P * q + PN * q * q) * 0.5, ux = (dx / d) * D, uy = (dy / d) * D
        x[j] += ux, (y[j] += uy), (dxs -= ux), (dys -= uy)
      })
      x[i] += dxs, (y[i] += dys)
    }
    // the mould and the world's edges; velocities from the corrected positions; heat
    for (let i = 0; i < N; i++) {
      if (!live[i]) continue
      const d = arcD(x[i], y[i]); nearM[i] = d < 0.07 ? 1 : 0
      if (d < PR) {
        const e = 0.001, gx = arcD(x[i] + e, y[i]) - arcD(x[i] - e, y[i]), gy = arcD(x[i], y[i] + e) - arcD(x[i], y[i] - e), gl = Math.hypot(gx, gy) || 1
        x[i] += (gx / gl) * (PR - d), (y[i] += (gy / gl) * (PR - d))
        const fr = T[i] < 0.12 ? 0.6 : 0.15; x[i] = px[i] + (x[i] - px[i]) * (1 - fr) + (gx / gl) * 0 // friction along the stone
      }
      vx[i] = (x[i] - px[i]) / DT, (vy[i] = (y[i] - py[i]) / DT)
      if (T[i] < 0.1) (vx[i] *= 0.9), (vy[i] *= 0.9)                    // crust: nearly solid
      const sp_ = Math.hypot(vx[i], vy[i]); if (sp_ > 6) (vx[i] *= 6 / sp_), (vy[i] *= 6 / sp_)
      if (tCnt[i]) T[i] += (tSum[i] / tCnt[i] - T[i]) * 0.04                // conduction
      T[i] = Math.max(0, T[i] - DT * (0.035 + 0.9 * nearM[i] * T[i] + (tCnt[i] < 4 ? 0.2 : 0)))  // to the stone, and the air (thin bits cool fast)
      if (sp_ > 2.6 && T[i] > 0.6 && R() < 0.02) spark(x[i], y[i], vx[i], vy[i])
      if (y[i] < -3.3 || Math.abs(x[i]) > 4.3) live[i] = 0                 // fell away: back to the crucible
    }
  }

  // ── render the fluid: splat heat and thickness into a buffer, shade it as one surface ──
  const pos = new Float32Array(N * 3), heat = new Float32Array(N)
  const pgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('heat', new THREE.BufferAttribute(heat, 1))
  const fScene = new THREE.Scene(), rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }), rtH = { value: 1 }
  const pts = new THREE.Points(pgeo, new THREE.ShaderMaterial({
    uniforms: { rtH }, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: `attribute float heat; uniform float rtH; varying float vT;
      void main(){ vT = heat; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = position.z < -50. ? 0. : .2 * projectionMatrix[1][1] * rtH * .5 / -mv.z; }`,
    fragmentShader: `varying float vT; void main(){ vec2 c = gl_PointCoord * 2. - 1.; float r = dot(c, c); if (r > 1.) discard; float w = (1. - r) * (1. - r); gl_FragColor = vec4(w * vT, 0., 0., w); }`,
  }))
  pts.frustumCulled = false, fScene.add(pts)
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { ...U, tF: { value: rt.texture } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tF; uniform vec2 res; uniform vec3 ink, accent; varying vec2 vU;
      vec3 glow(float t){                                     // crust → deep red → ember → yellow-white
        return accent * vec3(.35, .08, .05) * smoothstep(.06, .3, t) + accent * smoothstep(.28, .62, t) * .45 + mix(accent, ink, .55) * smoothstep(.6, .88, t) * .55 + ink * smoothstep(.88, 1., t) * .6;
      }
      void main(){
        vec4 f = texture2D(tF, vU); float A = f.a, edge = smoothstep(.5, .9, A); if (edge <= .001) discard;
        float t = f.r / max(A, 1e-4); vec2 e = 2. / res;
        float ax = texture2D(tF, vU + vec2(e.x, 0.)).a - texture2D(tF, vU - vec2(e.x, 0.)).a, ay = texture2D(tF, vU + vec2(0., e.y)).a - texture2D(tF, vU - vec2(0., e.y)).a;
        vec3 n = normalize(vec3(-ax, -ay, .5)), v = vec3(0., 0., -1.), r = reflect(v, n);
        float key = pow(max(dot(r, normalize(vec3(-.4, .6, .7))), 0.), 30.), rim = pow(1. - n.z, 2.);
        vec3 c = vec3(.012, .011, .01) + glow(t) * (.85 + .3 * n.z) + ink * (key * .7 + rim * .05) * (.3 + .7 * (1. - t));   // glossy where it has cooled
        gl_FragColor = vec4(c, edge);
      }`,
  }))
  surf.frustumCulled = false, (surf.renderOrder = 10), scene.add(surf)

  // ── the stone: mould and crucible, lit by the metal ──
  const stone = new THREE.MeshStandardMaterial({ color: 0x1b1713, roughness: 0.85 }), steel = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.5, metalness: 0.6 })
  const ms = new THREE.Shape(); ms.absarc(BC[0], BC[1], BR + BT, A0, A1, false), ms.absarc(BC[0], BC[1], BR, A1, A0, true)
  const mould = new THREE.Mesh(new THREE.ExtrudeGeometry(ms, { depth: 1.2, bevelEnabled: false, curveSegments: 64 }).translate(0, 0, -0.6), stone)
  const cs_ = new THREE.Shape([[-0.38, 0.34], [-0.38, -0.3], [0.34, -0.3], [0.34, 0.3], [0.28, 0.3], [0.28, -0.24], [-0.32, -0.24], [-0.32, 0.34]].map(([a, b]) => new THREE.Vector2(a, b)))
  const crucible = new THREE.Mesh(new THREE.ExtrudeGeometry(cs_, { depth: 0.7, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 }).translate(0, 0, -0.35), steel)
  const melt = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, // the charge inside, hottest at its surface
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 ink, accent; varying vec2 vU; void main(){ float y = vU.y; gl_FragColor = vec4(mix(accent * .25, mix(accent, ink, .5) * .9, smoothstep(.3, 1., y)) , smoothstep(1., .9, y)); }` }))
  melt.position.set(-0.02, -0.04, -0.3), crucible.add(melt)
  const glowL = new THREE.PointLight(U.accent.value, 0, 7, 1.3), pourL = new THREE.PointLight(U.accent.value, 0, 4, 1.5)
  glowL.position.set(BC[0], -0.6, 1.2), scene.add(mould, crucible, glowL, pourL)

  // ── interaction ──
  let held = false, downAt = 0, now = 0, lastP = 0
  addEventListener('pointerdown', () => ((held = true), (downAt = now)))
  addEventListener('pointerup', () => { if (now - downAt < 0.25) { ray.setFromCamera(pointer, camera); if (ray.ray.intersectPlane(plane, hit)) ingot(hit.x, Math.max(hit.y, -0.4)) } held = false })

  const size = new THREE.Vector2()
  return (t, p) => {
    const dtF = Math.min(1 / 30, Math.max(0, t - now)); now = t
    // the crucible: on its own it sways over the mould and pours in two long draughts; your cursor carries it, holding tips it
    let tx = -1.0 + Math.sin(p * TAU) * 0.55, tilt = 0.75 + 0.85 * THREE.MathUtils.smoothstep(Math.sin(p * TAU * 2 - 0.6), -0.2, 0.5)
    if (pointer.active && (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, hit))) (tx = THREE.MathUtils.clamp(hit.x - 0.3, -2.7, 2.2)), (tilt = held && now - downAt > 0.25 ? 1.9 : 1.25)
    cru.x += (tx - cru.x) * 0.05, (cru.tilt += (tilt - cru.tilt) * 0.06)
    crucible.position.set(cru.x, cru.y, 0), (crucible.rotation.z = -cru.tilt)
    const rate = Math.max(0, (cru.tilt - 0.95) * 700)                                   // particles per second over the lip
    if ((lastP < 0.5 && p >= 0.5)) ingot(BC[0] - 0.2, 0.6)                              // the loop's own ingot
    lastP = p
    for (let s = 0; s < Math.round(dtF / DT); s++) { spawnAcc += rate * DT; const n = spawnAcc | 0; spawnAcc -= n; spawn(n), step() }

    // sparks fly and die
    for (let j = 0; j < SN; j++) {
      if (sl[j] <= 0) { sp.fill(0, j * 6, j * 6 + 6); continue }
      sl[j] -= dtF, (sv[j * 3 + 1] -= 6 * dtF)
      for (let a = 0; a < 3; a++) sx[j * 3 + a] += sv[j * 3 + a] * dtF
      const f = Math.max(0, sl[j]) * 2, a = U.accent.value
      sp.set([sx[j * 3], sx[j * 3 + 1], sx[j * 3 + 2], sx[j * 3] - sv[j * 3] * 0.03, sx[j * 3 + 1] - sv[j * 3 + 1] * 0.03, sx[j * 3 + 2] - sv[j * 3 + 2] * 0.03], j * 6)
      sc.set([f, f * 0.75, f * 0.5, a.r * f * 0.5, a.g * f * 0.5, a.b * f * 0.5], j * 6)
    }
    sgeo.attributes.position.needsUpdate = sgeo.attributes.color.needsUpdate = true

    let hot = 0, cnt = 0
    for (let i = 0; i < N; i++) { if (live[i]) pos.set([x[i], y[i], 0], i * 3), (heat[i] = T[i]), (hot += T[i]), cnt++; else pos[i * 3 + 2] = -99 }
    pgeo.attributes.position.needsUpdate = pgeo.attributes.heat.needsUpdate = true
    glowL.intensity = 0.6 + (hot / Math.max(cnt, 1)) * 5
    const [lx, ly] = lip(); pourL.position.set(lx, ly - 0.4, 0.6), (pourL.intensity = Math.min(1, rate / 300) * 1.6)
    renderer.getDrawingBufferSize(size)
    const w = Math.max(1, (size.x / 2) | 0), h = Math.max(1, (size.y / 2) | 0)
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h)
    rtH.value = h
    renderer.setRenderTarget(rt), renderer.setClearColor(0x000000, 0), renderer.clear(), renderer.render(fScene, camera), renderer.setRenderTarget(null)
  }
}, { loop: 16, blend: 2, eye: [0, 0.1, 8.6], drift: 0.15, bloom: 0.5, parallax: 0, poster: 0.3 })
