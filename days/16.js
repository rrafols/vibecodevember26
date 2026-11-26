import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 16 — medusa: three jellyfish in the dark. Translucent pulsing bells with a ring of ember lights, long tentacles simulated as
// weighted ropes trailing every stroke, marine snow drifting past.
// move: a current that pushes them · click: a flash of bioluminescence, every bell contracts at once
go('medusa', ({ scene, camera }) => {
  const LOOP = 18, NT = 18, NA = 4, NH = 48, SEG = 26, J = [
    { x: -1.35, y: 0.55, z: -0.6, r: 0.5, beat: 6, ph: 0.0 },
    { x: 1.2, y: 0.1, z: 0.3, r: 0.62, beat: 5, ph: 0.37 },
    { x: 0.05, y: -0.95, z: -1.4, r: 0.42, beat: 7, ph: 0.71 },
  ]
  const pulse = f => { const a = f % 1; return a < 0.22 ? Math.sin((a / 0.22) * Math.PI * 0.5) : Math.cos(((a - 0.22) / 0.78) * Math.PI * 0.5) ** 2 } // fast squeeze, slow release
  const rise = f => { const a = f % 1; return THREE.MathUtils.smoothstep(a, 0, 0.3) - a } // up during the stroke, a slow sink back: periodic

  // ── bells: a hemisphere deformed by the pulse, shaded as glowing translucent tissue ──
  const bellGeo = new THREE.SphereGeometry(1, 64, 20, 0, TAU, 0, Math.PI * 0.55)
  const bells = J.map(j => {
    const u = { ...U, squeeze: { value: 0 }, flash: { value: 0 }, front: { value: -9 }, amp: { value: 0 } }
    const m = new THREE.Mesh(bellGeo, new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `uniform float squeeze, time; varying vec3 vN, vW, vP;
        void main(){
          vec3 p = position; float a = atan(p.z, p.x), down = 1. - p.y;                  // 0 at the crown, ~1 at the rim
          p.xz *= 1. - squeeze * .28 * down + sin(a * 8. + time * 3.) * .025 * down;      // contract, and a rippling margin
          p.y = p.y * (1. + squeeze * .18) - down * down * .1;
          vP = position, vN = normalize(normalMatrix * normal), vW = (modelMatrix * vec4(p, 1.)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
        }`,
      fragmentShader: `uniform vec3 ink, accent; uniform float flash, time, front, amp; varying vec3 vN, vW, vP;
        void main(){
          float f = pow(1. - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 2.2), down = 1. - vP.y, a = atan(vP.z, vP.x);
          float spots = pow(max(0., cos(a * 8.)), 60.) * smoothstep(.955, .995, down);              // eight lights round the margin
          float gonads = pow(max(0., cos(a * 2.)), 6.) * smoothstep(.15, .35, down) * smoothstep(.6, .4, down); // four soft lobes inside
          float wave = amp * exp(-pow((down - front) * 4., 2.));                                    // one light front: crown → rim → on down the strands
          vec3 c = ink * (.004 + .42 * pow(f, 1.8)) + accent * (spots * 2.2 + gonads * .08 + wave * .55) + ink * wave * .18; // clear tissue: only its edges catch light
          gl_FragColor = vec4(c, 1.);
        }`,
    }))
    m.scale.set(j.r, j.r * 0.78, j.r), scene.add(m) // a flatter, softer bell
    return { m, u }
  })

  // ── tentacles and oral arms: verlet ropes hanging from the rim, dragged by the water and the current ──
  const ropes = []
  J.forEach((j, ji) => {
    for (let k = 0; k < NT + NA + NH; k++) { // tentacles, oral arms, and a fringe of fine hairs
      const arm = k >= NT && k < NT + NA, hair = k >= NT + NA, a = arm ? ((k - NT) / NA) * TAU + 0.4 : hair ? R(TAU) : (k / NT) * TAU, len = (arm ? 1.6 : hair ? R(0.7, 2.3) : R(1.4, 2.6)) * j.r * 1.6
      ropes.push({ ji, a, arm, hair, ph: R(TAU), sp: R(2.5, 5), seg: len / SEG, p: Array.from({ length: SEG }, (_, s) => new THREE.Vector3(j.x, j.y - s * 0.05, j.z)), q: null })
    }
  })
  ropes.forEach(r => (r.q = r.p.map(v => v.clone())))
  const lp = new Float32Array(ropes.length * (SEG - 1) * 6), lc = new Float32Array(ropes.length * (SEG - 1) * 6)
  const lgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(lp, 3)).setAttribute('color', new THREE.BufferAttribute(lc, 3))
  scene.add(new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })))

  // ── marine snow: slow motes sinking through the frame, one full fall per loop ──
  const SN = 1600, snow = new Float32Array(SN * 3), sd = Array.from({ length: SN }, () => [R(-5, 5), R(), R(-4, 2), R(0.02, 0.05)])
  const sgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(snow, 3))
  scene.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ color: new THREE.Color(U.ink.value).multiplyScalar(0.35), size: 0.02, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })))

  // ── interaction ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), cur = new THREE.Vector3(), prevCur = new THREE.Vector3(), flow = new THREE.Vector3()
  const push = J.map(() => new THREE.Vector3()), anchor = new THREE.Vector3(), tmp = new THREE.Vector3(), centre = J.map(() => new THREE.Vector3())
  let flashAt = -9, now = 0
  addEventListener('pointerdown', () => (flashAt = now))

  return (t, p) => {
    now = t
    let active = false
    if (pointer.active && (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, cur))) flow.lerp(tmp.subVectors(cur, prevCur).multiplyScalar(30).clampLength(0, 3), 0.15), prevCur.copy(cur), (active = true)
    else flow.multiplyScalar(0.9)
    const fl = Math.max(0, 1 - (t - flashAt) / 1.2) // the squeeze of the flash
    const fa0 = t - flashAt

    J.forEach((j, i) => {
      const f = p * j.beat + j.ph, s = Math.max(pulse(f), fl > 0 ? Math.sin(fl * Math.PI) : 0)
      const c = centre[i].set(j.x + Math.sin(p * TAU + i * 2) * 0.35, j.y + rise(f) * 0.32 + Math.sin(p * TAU * 2 + i) * 0.08, j.z + Math.cos(p * TAU + i) * 0.3)
      if (active) { const d = c.distanceTo(cur); push[i].addScaledVector(flow, 0.03 * Math.exp(-d * d / 1.2)) }
      push[i].multiplyScalar(0.96), c.add(push[i])
      const b = bells[i]
      b.m.position.copy(c), b.m.rotation.set(Math.sin(p * TAU + i) * 0.2 + push[i].z * 0.5, 0, -push[i].x * 0.6 + Math.sin(p * TAU * 2 + i) * 0.1)
      b.u.squeeze.value = s, (b.u.flash.value = fl), (b.u.front.value = fa0 / 1.2), (b.u.amp.value = fa0 < 0 ? 0 : Math.min(1, fa0 * 8) * Math.exp(-Math.max(0, fa0 - 0.8) * 0.8))
      b.m.updateMatrixWorld(), (j.s = s)
    })

    // a click's light is one front moving at one pace: across the bell (0 → 1, crown to rim) and on down the strands (1 → 2.25)
    const fa = t - flashAt, front = fa / 1.2, amp = fa < 0 ? 0 : Math.min(1, fa * 8) * Math.exp(-Math.max(0, fa - 0.8) * 0.8)
    const wave = g => (amp < 0.005 ? 0 : amp * Math.exp(-(((1 + g * 1.25 - front) * 4) ** 2)) * (1 - g * 0.35))
    // ropes: pin the top to the (squeezing) rim, verlet the rest with drag, sink and the current, then relax lengths
    let o = 0
    ropes.forEach(r => {
      const j = J[r.ji], b = bells[r.ji].m, rr = r.arm ? 0.25 : 1 - j.s * 0.28 * 0.9
      anchor.set(Math.cos(r.a) * rr * (r.hair ? 0.84 : 0.9), r.arm ? 0.05 : r.hair ? -0.05 : 0.02 - 0.1, Math.sin(r.a) * rr * (r.hair ? 0.84 : 0.9)).applyMatrix4(b.matrixWorld)
      r.p[0].copy(anchor)
      for (let s = 1; s < SEG; s++) {
        const v = r.p[s], w = r.q[s], vx = (v.x - w.x) * 0.9, vy = (v.y - w.y) * 0.9, vz = (v.z - w.z) * 0.9
        const sw = 0.0009 * (s / SEG)                                                     // a slow undulating current: they curl and sway
        w.copy(v), v.set(v.x + vx + Math.sin(now * 1.3 + s * 0.32 + r.a * 3) * sw, v.y + vy - 0.0016, v.z + vz + Math.cos(now * 1.1 + s * 0.27 + r.a * 2) * sw)
        if (active) { const d2 = v.distanceToSquared(cur); if (d2 < 2) v.addScaledVector(flow, 0.004 * Math.exp(-d2 / 0.6)) }
      }
      for (let it = 0; it < 3; it++) for (let s = 1; s < SEG; s++) {
        const a = r.p[s - 1], c = r.p[s], d = tmp.subVectors(c, a), l = d.length() || 1, k = (l - r.seg) / l
        if (s > 1) a.addScaledVector(d, k * 0.5), c.addScaledVector(d, -k * 0.5); else c.addScaledVector(d, -k)
      }
      for (let s = 0; s < SEG - 1; s++) {
        const a = r.p[s], c = r.p[s + 1], g = s / (SEG - 1), pulse = Math.max(0, Math.sin(g * 14 - now * r.sp + r.ph)) ** 10 * (1 - g * 0.6) // faint light running down each strand
        const br = (r.arm ? 0.2 : r.hair ? 0.04 : 0.11) * (1 - g * 0.7) + pulse * (r.hair ? 0.16 : 0.12) + wave(g) * (r.hair ? 0.45 : 0.4)
        lp.set([a.x, a.y, a.z, c.x, c.y, c.z], o * 6)
        const col = [U.ink.value.r * br, U.ink.value.g * br * 0.92, U.ink.value.b * br * 0.85] // bone, warming towards the tips
        lc.set([...col, col[0] * (1 + g * 0.6), col[1] * (1 - g * 0.3), col[2] * (1 - g * 0.5)], o * 6), o++
      }
    })
    lgeo.attributes.position.needsUpdate = lgeo.attributes.color.needsUpdate = true

    sd.forEach(([x, y, z], i) => snow.set([x + Math.sin(p * TAU + i) * 0.05, 3 - ((y + p) % 1) * 6, z], i * 3))
    sgeo.attributes.position.needsUpdate = true
  }
}, { loop: 18, blend: 2, eye: [0, 0, 7.2], drift: 0.4, bloom: 0.85, fog: 0.05 })
