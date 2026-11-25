import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 09 — lichtenberg: a clear acrylic block. A high-voltage discharge tears a branching tree of light through it in half a second:
// white-hot, then ember, then a faint frosted trace frozen in the block, the way real Lichtenberg figures are made.
// click the block: fire from there (hold first to charge a bigger one) · drag: turn the block
go('lichtenberg', ({ scene, camera }) => {
  const LOOP = 12, HALF = 1.15, MAX = 40000, SPEED = 2.6

  // ── branches: instanced ribbons, each segment knows when the discharge front reaches it ──
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3)), geo.setIndex([0, 1, 2, 2, 1, 3])
  const A = new Float32Array(MAX * 3), B = new Float32Array(MAX * 3), WT = new Float32Array(MAX * 4) // width, arrival, start, kind (0 loop · 1 yours)
  for (const [k, arr, n] of [['a', A, 3], ['b', B, 3], ['wt', WT, 4]]) geo.setAttribute(k, new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage))
  geo.instanceCount = 0
  const bolts = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 a, b; attribute vec4 wt; uniform float time, phase; uniform vec3 ink, accent; varying vec3 vC; varying float vY;
      void main(){
        float tl = phase * ${LOOP}., loop = step(wt.w, .5);
        float age = mix(time, tl, loop) - wt.z - wt.y;                                   // time since the front reached this segment
        float life = mix(exp(-(time - wt.z) / 40.), smoothstep(${LOOP}., ${LOOP - 1.6}, tl) * step(wt.z, tl), loop); // loop traces clear before the wrap
        vec4 pa = modelViewMatrix * vec4(a, 1.), pb = modelViewMatrix * vec4(b, 1.);
        vec3 side = normalize(cross(pb.xyz - pa.xyz, pa.xyz) + 1e-6);                     // a ribbon that always faces the camera
        vec4 p = mix(pa, pb, position.x); p.xyz += side * position.y * wt.x * (1. + 2.5 * exp(-max(age, 0.) * 6.));
        float g = max(age, 0.);
        vC = (ink * 4.5 * exp(-g * 7.) + accent * .9 * exp(-g * 1.1) + ink * .07) * step(0., age) * life; // flash · ember · frosted trace
        vY = position.y, gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: `varying vec3 vC; varying float vY; void main(){ gl_FragColor = vec4(vC * (1. - vY * vY), 1.); }`,
  }))
  bolts.frustumCulled = false

  // ── the block: faint fresnel faces and hairline edges; it flares with each discharge ──
  const flash = { value: 0 }
  const glass = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2), new THREE.ShaderMaterial({
    uniforms: { ...U, flash }, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN, vV; void main(){ vec4 w = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal, vV = -w.xyz; gl_Position = projectionMatrix * w; }`,
    fragmentShader: `uniform vec3 ink, accent; uniform float flash; varying vec3 vN, vV;
      void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 4.); gl_FragColor = vec4(ink * (.004 + .06 * f) + accent * flash * (.02 + .2 * f), 1.); }`,
  }))
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(U.ink.value).multiplyScalar(0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  const block = new THREE.Group().add(glass, edges, bolts)
  scene.add(block)

  // ── a discharge: a stochastic branching walk from a point on a face, inwards. Thick trunk, ever finer twigs ──
  let n = 0, head = 0
  const jit = () => new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1))
  const discharge = (root, dir, budget, start, kind) => {
    const d0 = dir.clone().normalize(), o = root.clone().addScaledVector(d0, 0.06) // start just inside the face
    const stack = [{ p: o.clone(), d: d0.clone(), w: 0.014 * Math.sqrt(budget / 3000), s: 0 }]
    let made = 0
    while (stack.length && made < budget) {
      const br = stack.pop()
      for (let k = 0; k < 500 && br.w > 0.0018 && made < budget; k++) {
        const L = 0.022 + R(0.02)
        br.d.addScaledVector(jit(), 0.2).addScaledVector(br.p.clone().sub(o).normalize(), 0.04).normalize() // persistent channels that fan out from the root
        const q = br.p.clone().addScaledVector(br.d, L)
        if (Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z)) > HALF - 0.03) break // the charge stays inside the block
        const i = head
        A.set(br.p.toArray(), i * 3), B.set(q.toArray(), i * 3), WT.set([br.w, br.s / SPEED + R(0.012), start, kind], i * 4)
        head = (head + 1) % MAX, (n = Math.min(MAX, n + 1)), made++
        br.s += L, (br.p = q), (br.w *= 0.991)
        if (R() < 0.13) stack.push({ p: q.clone(), d: br.d.clone().addScaledVector(jit(), 0.9).normalize(), w: br.w * 0.66, s: br.s })
      }
    }
    for (const k of ['a', 'b', 'wt']) geo.attributes[k].needsUpdate = true
    geo.instanceCount = n
  }
  // the loop's own two discharges, from fixed points: built once, replayed every loop
  const shots = [[new THREE.Vector3(-0.4, HALF, 0.2), new THREE.Vector3(0.15, -1, -0.1), 0.6], [new THREE.Vector3(HALF, -0.3, -0.35), new THREE.Vector3(-1, 0.25, 0.2), 5.4]]
  shots.forEach(([p, d, t]) => discharge(p, d, 5200, t, 0))

  // ── hands: drag turns the block, a click fires; holding first charges it ──
  const ray = new THREE.Raycaster()
  let now = 0, down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0, last = -99
  addEventListener('pointerdown', () => ((down = { t: now, moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => {
    if (!down) return
    down.moved += Math.hypot(pointer.x - lx, pointer.y - ly)
    if (down.moved > 0.02) (vy = (pointer.x - lx) * 3), (vp = -(pointer.y - ly) * 2), (yaw += vy), (pitch += vp)
    lx = pointer.x, ly = pointer.y
  })
  addEventListener('pointerup', () => {
    if (down && down.moved < 0.02) {
      ray.setFromCamera(pointer, camera)
      const h = ray.intersectObject(glass)[0]
      if (h) {
        const charge = Math.min(2.5, Math.max(0.2, now - down.t))
        discharge(block.worldToLocal(h.point.clone()), h.face.normal.clone().negate(), 1500 + charge * 2600, now, 1), (last = now)
      }
    }
    down = null
  })

  return (t, p) => {
    now = t
    const a = p * TAU, tl = p * LOOP
    if (!down) (yaw += vy *= 0.93), (pitch += vp *= 0.93)
    block.rotation.set(0.42 + Math.sin(2 * a) * 0.06 + pitch, 0.65 + Math.sin(a) * 0.45 + yaw, 0)
    flash.value = Math.max(...shots.map(([, , s]) => (tl > s ? Math.exp(-(tl - s) * 2.5) : 0)), Math.exp(-(t - last) * 2.5)) // the block flares with each strike
  }
}, { loop: 12, eye: [0, 0.2, 6.6], drift: 0.5, bloom: 0.85 })
