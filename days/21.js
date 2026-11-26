import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 21 — pendulum: twenty chrome balls on wires, each length tuned so that in one loop they swing 16, 17 … 35 times. Released
// together they drift apart into travelling waves, braids and apparent chaos, and come back into line exactly at the end of the
// loop. Each ball mirrors the others (one live cube map) and draws its path in ember light.
// Knocked sideways they collide with their neighbours like a Newton's cradle (elastic impulses, an ember flash at each hit), then
// settle back into step.
// drag a ball: throw it in any direction · hover: sweep your hand through the row · click: strike the bar · scroll: scrub time
go('pendulum', ({ scene, camera, renderer }) => {
  const LOOP = 30, NP = 20, N0 = 16, A = 0.42, TOP = 1.05, BALL = 0.13, SPAN = 0.3, TRAIL = 44
  const P = Array.from({ length: NP }, (_, i) => { const T = LOOP / (N0 + i), l = (T / TAU) ** 2 * 24.7; return { T, l, x: (i - (NP - 1) / 2) * SPAN, D: new THREE.Vector3(), DV: new THREE.Vector3(), hot: 0 } })
  const th = (q, t) => A * Math.cos((TAU * t) / q.T) // the choreography: small swings, exact periods → exactly seamless

  // ── studio: panels outside the frame, there only to be reflected ──
  const panel = (w, h, c, k, ...at) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, fog: false })); m.position.set(...at), m.lookAt(0, 0, 0), m.layers.set(1), scene.add(m) } // layer 1: only the mirror sees them
  panel(14, 1.2, U.ink.value, 1.1, 0, 9, 3), panel(1.4, 8, U.accent.value, 2.4, -9, 2, -3), panel(1, 6, U.ink.value, 1, 9, 2, -4), panel(30, 0.4, U.accent.value, 0.8, 0, -3, -9)
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }), cubeCam = new THREE.CubeCamera(0.05, 40, cubeRT)
  cubeCam.position.set(0, 0.2, 0.7), cubeCam.children.forEach(c => c.layers.enable(1)), scene.add(cubeCam)

  // ── the rig: a steel bar, wires, chrome balls ──
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, envMap: cubeRT.texture, envMapIntensity: 1 })
  const ballGeo = new THREE.SphereGeometry(BALL, 48, 24), balls = P.map(() => { const m = new THREE.Mesh(ballGeo, chrome.clone()); m.material.emissive.copy(U.accent.value), (m.material.emissiveIntensity = 0), scene.add(m); return m })
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, SPAN * NP + 0.4, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.9, roughness: 0.3 }))
  bar.position.y = TOP, scene.add(bar)
  const wp = new Float32Array(NP * 12), wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(wp, 3)), new THREE.LineBasicMaterial({ color: new THREE.Color(U.ink.value).multiplyScalar(0.3), transparent: true, opacity: 0.7 }))
  scene.add(wires)
  // trails: where each ball has just been (from the choreography, so they too loop seamlessly), fading ember
  const tp = new Float32Array(NP * (TRAIL - 1) * 6), tc = new Float32Array(NP * (TRAIL - 1) * 6)
  const tgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(tp, 3)).setAttribute('color', new THREE.BufferAttribute(tc, 3))
  scene.add(new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))

  // ── motion: the choreography C(t) plus each ball's own displacement D, a damped pendulum of its own that collisions kick ──
  const C = (q, t, out) => { const a = th(q, t); return out.set(q.x, TOP - Math.cos(a) * q.l, Math.sin(a) * q.l) }
  const CV = (q, t, out) => { const a = th(q, t), da = -A * (TAU / q.T) * Math.sin((TAU * t) / q.T); return out.set(0, Math.sin(a) * q.l * da, Math.cos(a) * q.l * da) }
  const pos = P.map(() => new THREE.Vector3()), vel = P.map(() => new THREE.Vector3()), PV = new THREE.Vector3(), N = new THREE.Vector3(), tmp = new THREE.Vector3()
  const place = (q, i, t) => { // actual position: choreography + displacement, kept on the sphere of the wire
    C(q, t, pos[i]).add(q.D), CV(q, t, vel[i]).add(q.DV)
    PV.set(q.x, TOP, 0); tmp.subVectors(pos[i], PV); if (tmp.y > -0.05) tmp.y = -0.05
    pos[i].copy(PV).add(tmp.setLength(q.l))
  }

  // ── interaction ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), fwd = new THREE.Vector3()
  const hand = { p: new THREE.Vector3(0, -9, 0), v: new THREE.Vector3(), on: false }
  let grab = null, down = null, clock = 0, last = null, rate = 1, rateT = 1
  addEventListener('pointerdown', () => {
    ray.setFromCamera(pointer, camera); const h = ray.intersectObjects(balls)[0]
    down = { at: performance.now() }
    if (h) grab = P[balls.indexOf(h.object)]
  })
  addEventListener('pointerup', () => {
    if (!grab && down && performance.now() - down.at < 300) P.forEach(q => q.DV.add(tmp.set(R(-0.5, 0.5), 0, R(-1, 1) * 0.8 + 0.6))) // a blow to the bar: everyone jolts
    grab = null, (down = null)
  })
  addEventListener('wheel', e => (rateT = THREE.MathUtils.clamp(rateT - Math.sign(e.deltaY) * 0.25, -1.5, 2)), { passive: true })

  return (t, p) => {
    const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 1 / 20); last = t
    rate += (rateT - rate) * 0.08, (clock += dt * rate)
    const T = clock // in a recording, clock === t
    camera.getWorldDirection(fwd)
    // the cursor: a grabbed ball follows it; otherwise it is a hand that knocks balls aside as it sweeps through
    if (pointer.active) {
      ray.setFromCamera(pointer, camera)
      if (grab) { const i = P.indexOf(grab); plane.setFromNormalAndCoplanarPoint(fwd, pos[i]); if (ray.ray.intersectPlane(plane, hit)) { C(grab, T, tmp); const nd = hit.sub(tmp).clampLength(0, 1.6); grab.DV.copy(nd).sub(grab.D).divideScalar(dt || 1 / 60).clampLength(0, 12), grab.D.copy(nd) } }
      plane.setFromNormalAndCoplanarPoint(fwd, tmp.set(0, 0, 0))
      if (!grab && ray.ray.intersectPlane(plane, hit)) { if (hand.on && dt) hand.v.lerp(tmp.subVectors(hit, hand.p).divideScalar(dt), 0.5); hand.p.copy(hit), (hand.on = true) }
    } else hand.on = false
    const S = 6, h = dt / S
    for (let s = 0; s < S; s++) {
      const ts = T - dt * rate + (s + 1) * h * rate
      P.forEach((q, i) => {
        if (q !== grab) q.DV.addScaledVector(q.D, (-24.7 / q.l) * h).multiplyScalar(1 - 0.35 * h), q.D.addScaledVector(q.DV, h)
        place(q, i, ts)
      })
      // collisions: ball–ball (equal masses, nearly elastic) and ball–hand
      for (let i = 0; i < NP; i++) for (let j = i + 1; j < Math.min(NP, i + 4); j++) {
        N.subVectors(pos[i], pos[j]); const d = N.length(); if (d >= 2 * BALL || d < 1e-6) continue
        N.divideScalar(d); const over = 2 * BALL - d, vn = tmp.subVectors(vel[i], vel[j]).dot(N)
        P[i].D.addScaledVector(N, over / 2), P[j].D.addScaledVector(N, -over / 2)
        if (vn < 0) { const J = -0.95 * vn; P[i].DV.addScaledVector(N, J), P[j].DV.addScaledVector(N, -J), (P[i].hot = Math.max(P[i].hot, Math.min(1, -vn * 0.6))), (P[j].hot = Math.max(P[j].hot, Math.min(1, -vn * 0.6))) }
      }
      if (hand.on && !grab) P.forEach((q, i) => {
        N.subVectors(pos[i], hand.p); const d = N.length(), r = BALL + 0.12; if (d >= r || d < 1e-6) return
        N.divideScalar(d); q.D.addScaledVector(N, r - d); const vn = tmp.subVectors(vel[i], hand.v).dot(N)
        if (vn < 0) q.DV.addScaledVector(N, -1.6 * vn), (q.hot = Math.max(q.hot, Math.min(1, -vn * 0.4)))
      })
    }
    hand.v.multiplyScalar(0.8)
    P.forEach((q, i) => {
      place(q, i, T)
      balls[i].position.copy(pos[i]), wp.set([q.x, TOP, 0, pos[i].x, pos[i].y, pos[i].z], i * 6)
      balls[i].material.emissiveIntensity = q.hot * 0.9, (q.hot *= 0.9)
      for (let k = 0; k < TRAIL - 1; k++) { // the trail: where it has been, the displacement fading back along it
        const o = (i * (TRAIL - 1) + k) * 6, e0 = Math.exp(-k * 0.08), e1 = Math.exp(-(k + 1) * 0.08)
        C(q, T - k * 0.03, tmp).addScaledVector(q.D, e0), tp.set([tmp.x, tmp.y, tmp.z], o)
        C(q, T - (k + 1) * 0.03, tmp).addScaledVector(q.D, e1), tp.set([tmp.x, tmp.y, tmp.z], o + 3)
        const f = (1 - k / (TRAIL - 1)) ** 2 * 0.9, g = (1 - (k + 1) / (TRAIL - 1)) ** 2 * 0.9, c = U.accent.value
        tc.set([c.r * f, c.g * f + f * f * 0.25, c.b * f + f * f * 0.2, c.r * g, c.g * g + g * g * 0.25, c.b * g + g * g * 0.2], o)
      }
    })
    wires.geometry.attributes.position.needsUpdate = tgeo.attributes.position.needsUpdate = tgeo.attributes.color.needsUpdate = true
    cubeCam.update(renderer, scene) // the shared mirror: the scene once, from among the balls
  }
}, { loop: 30, eye: [1.3, 0.15, 10.4], drift: 0.35, bloom: 0.7, parallax: 0.5 })
