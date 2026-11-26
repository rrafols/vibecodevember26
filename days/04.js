import { go, THREE, U, R, TAU, noise, pointer, raymarch } from '../lib/stage.js'

// 04 — event horizon: a black hole raymarched ray by ray. A flared, turbulent accretion disk with spiral arms, relativistic
// jets with knots racing outward, a companion star whose light bends into Einstein arcs, and stars torn apart into
// glowing streams that spiral in and set the disk ablaze.
// drag: pour gas onto the disk (it shears into spirals and drains in) · click: throw a star in · right-drag / shift-drag: orbit
// scroll: zoom · hover: your cursor becomes a tiny star; watch its light bend around the hole
go('event horizon', ({ scene, camera }) => {
  const LOOP = 16, NB = 14, NS = 2 * NB + 1 // blobs per torn star · total emitters (2 streams + the companion)
  // poured gas lives on a polar grid wrapped around the disk (radius × angle), advanced on the CPU at the plasma's own Kepler speed
  const R0 = 2.3, R1 = 9.5, NR = 48, NA = 256, gas = new Float32Array(NR * NA), tmp = new Float32Array(NR * NA)
  const gasTex = new THREE.DataTexture(new Uint8Array(NR * NA), NA, NR, THREE.RedFormat)
  Object.assign(gasTex, { wrapS: THREE.RepeatWrapping, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, needsUpdate: true })
  const u = { ...U, rot: { value: new THREE.Matrix3() }, zoom: { value: 1 }, feed: { value: 0 },
    st: { value: Array.from({ length: NS }, () => new THREE.Vector4()) }, bound: { value: new THREE.Vector4(0, 0, 0, -1) }, gas: { value: gasTex } }

  scene.add(raymarch(noise + `
    uniform float phase, zoom, feed; uniform sampler2D gas; uniform vec3 ink, accent; uniform mat3 rot; uniform vec4 st[${NS}], bound; varying vec3 vRay;
    const float LOOP = ${LOOP}.;
    float sq(float x){ return x * x; }
    float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

    // plasma orbiting at Kepler speed; two copies a loop apart, crossfaded → seamless though every radius spins differently
    float plasma(float r, float a, float t){
      float A = a - 6.3 * pow(r, -1.5) * t;
      return .5 + .4 * snoise(vec3(r * 2.2, cos(A) * 1.6, sin(A) * 1.6)) + .25 * snoise(vec3(r * 8., cos(A) * 5., sin(A) * 5.));
    }
    // the disk: flared, volumetric, two log-spiral arms, Doppler-beamed. Returns colour; density via out
    vec3 disk(vec3 x, vec3 v, out float dens){
      dens = 0.;
      float r = length(x.xz); if (r < 2.3 || r > 9.5) return vec3(0.);
      float H = .03 + .015 * r, vert = exp(-sq(x.y / H)); if (vert < .01) return vec3(0.);
      float a = atan(x.z, x.x), t = phase * LOOP;
      float s = max(mix(plasma(r, a, t), plasma(r, a, t - LOOP), phase), 0.);
      float arms = .6 + .4 * sin(2. * a + 5. * log(r) - phase * 12.566);
      float g = texture2D(gas, vec2(a / 6.2832 + .5, (r - 2.3) / 7.2)).r * smoothstep(9.5, 8.5, r); // gas you poured
      dens = vert * smoothstep(2.3, 2.9, r) * (s * s * arms * smoothstep(9.5, 4., r) * (1. + feed * .6) + g * 2.5);
      float beam = pow(1. + .6 * dot(normalize(vec3(-x.z, 0., x.x)), -v), 2.5), heat = smoothstep(9.5, 2.3, r);
      vec3 c = mix(accent * .15, mix(accent * .8, ink * 1.4, smoothstep(.8, 1., heat)), heat * heat);
      return mix(c, accent * 1.1 + ink * .5 * heat, clamp(g * 1.5, 0., .8)) * beam * (1. + feed * .3);
    }
    // jets along the spin axis, knots racing outward (5 per loop)
    float jet(vec3 x, out float y){
      y = abs(x.y); if (y < 1.2 || y > 26.) return 0.;
      float w = .05 + .045 * y;
      return exp(-sq(length(x.xz) / w)) / w * .011 * smoothstep(2., 4., y) * smoothstep(26., 8., y) * (.3 + .7 * pow(.5 + .5 * sin(y * 1.1 - phase * 31.416), 6.));
    }
    vec3 acc(vec3 p, float h2){                                         // Schwarzschild light bending (Rs = 1), mirrored in JS for the hover trace
      return -1.5 * h2 * p / pow(length(p), 5.);
    }
    void main(){
      vec3 p = rot * cameraPosition * zoom, v = normalize(rot * vRay), col = vec3(0.);
      float T = 1., ring = 0., h2 = dot(cross(p, v), cross(p, v));
      for (int i = 0; i < 520; i++) {
        float r = length(p), rho = length(p.xz);
        if (r < 1.) { T = 0.; break; }                                   // swallowed
        float dt = clamp(.025 * r * r, .01, 1.2);
        float y = abs(p.y), vy = max(abs(v.y), .03), Hd = .03 + .015 * rho, wj = .05 + .045 * y;
        if (rho < 10.5) dt = min(dt, y < 2.5 * Hd ? clamp(.35 * Hd / vy, .03, .15) : max(.05, (y - 2. * Hd) / vy)); // jump to the disk, then sample it finely
        if (y > 1. && y < 26.) dt = min(dt, rho < 3. * wj ? max(.03, .5 * wj) : max(.05, rho - 2.5 * wj));     // same for the jets
        bool near = dot(p - bound.xyz, p - bound.xyz) < bound.w;
        if (near) for (int k = 0; k < ${NS}; k++) if (st[k].w > 0.) dt = min(dt, .02 + .4 * length(p - st[k].xyz));

        float dn, jy; vec3 e = disk(p, v, dn);
        col += T * e * dn * dt * 6.; T *= exp(-dn * dt * 4.);
        col += T * mix(accent * 1.2, ink * 1.4, smoothstep(9., 3., jy)) * jet(p, jy) * dt;
        if (near) for (int k = 0; k < ${NS}; k++) if (st[k].w > 0.) { vec3 d = p - st[k].xyz; col += T * mix(ink, accent * 1.6, step(float(k), ${NS - 2}.5) * .55) * st[k].w * exp(-dot(d, d) / .03) * dt * 6.; }
        ring += exp(-sq((r - 1.5) * 9.)) * dt;                            // grazing the photon sphere

        vec3 vm = normalize(v + acc(p, h2) * dt * .5);                   // midpoint (RK2): accurate everywhere, so the ring stays round
        v = normalize(v + acc(p + v * dt * .5, h2) * dt); p += vm * dt;
        if ((r > 60. && dot(p, v) > 0.) || T < .01) break;
      }
      vec3 bg = vec3(0.);
      if (T > .01) {                                                     // lensed sky: faint nebula + stars
        vec3 c = floor(v * 180.);
        bg = ink * step(.9985, h(c)) * h(c + 1.) * .6 + mix(ink * .5, accent, .6) * .03 * pow(max(snoise(v * 1.7) * .5 + .5, 0.), 4.);
      }
      col += (ring * ink * 1.2 + bg) * T;
      if (dot(col, col) < 1e-6 && T > .99) discard;
      gl_FragColor = vec4(col, 1.);
    }`, u))

  // ── stars torn apart: a closed-form infall (r shrinks, Kepler angle integrated once), drawn as a trailing stream of blobs ──
  const TF = 5.5, Y = new THREE.Vector3(0, 1, 0)
  const event = (dir, at) => {
    const e1 = dir.clone().normalize(), e2 = new THREE.Vector3().crossVectors(Math.abs(e1.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y, e1).normalize()
    const r = tau => 13 - 10.7 * Math.min(tau / TF, 1) ** 1.6, phi = [0]
    for (let i = 1; i <= TF * 120; i++) phi.push(phi[i - 1] + 6.3 * r(i / 120) ** -1.5 / 120)
    return { e1, e2, at, r, phi: tau => phi[Math.max(0, Math.min(phi.length - 1, Math.round(tau * 120)))] }
  }
  const place = (ev, tau, out, k) => {
    const tk = tau - k * 0.075, rr = ev.r(tk), f = ev.phi(tk)
    const on = tk > 0 && tk < TF && rr > 2.5 ? Math.min(1, tau / 0.6) * (1 - k / NB) ** 1.3 * (1 + 2.2 * (1 - rr / 13)) : 0
    out.set(...ev.e1.clone().multiplyScalar(Math.cos(f) * rr).addScaledVector(ev.e2, Math.sin(f) * rr).toArray(), on * 0.45)
  }
  const feed = tau => (tau > TF - 0.6 ? Math.min(1, (tau - TF + 0.6) / 0.6) * Math.exp(-Math.max(0, tau - TF) * 0.55) : 0)
  const auto = event(new THREE.Vector3(1, 0.55, -0.4), 0.3)
  let mine = null

  const deposit = (x, z, k) => { // splat gas at a disk-plane point (BH frame)
    const r = Math.hypot(x, z); if (r < R0 + 0.3 || r > R1 - 0.3) return
    const fi = ((r - R0) / (R1 - R0)) * NR - 0.5, fj = ((Math.atan2(z, x) / TAU + 0.5) * NA) % NA, wj = (0.32 / r / TAU) * NA
    for (let i = Math.max(0, Math.floor(fi - 3)); i <= Math.min(NR - 1, Math.ceil(fi + 3)); i++)
      for (let dj = -Math.ceil(wj * 3); dj <= Math.ceil(wj * 3); dj++) {
        const j = (Math.round(fj) + dj + NA) % NA, e = Math.exp(-(((i - fi) / 1.5) ** 2) - ((Math.round(fj) + dj - fj) / wj) ** 2)
        gas[i * NA + j] = Math.min(1.6, gas[i * NA + j] + e * k)
      }
  }
  const advect = dt => { // shear at Kepler speed, drift inward, fade; the innermost gas is swallowed
    for (let i = 0; i < NR; i++) {
      const r = R0 + ((i + 0.5) / NR) * (R1 - R0), sh = ((6.3 * r ** -1.5 * dt) / TAU) * NA, si = Math.min(NR - 1.001, i + (0.35 * dt * NR) / (R1 - R0))
      const i0 = Math.floor(si), fi = si - i0, fade = Math.exp(-dt * (0.08 + 2.5 * Math.max(0, 1 - (r - R0) / 0.6)))
      for (let j = 0; j < NA; j++) {
        const sj = (j - sh + NA * 64) % NA, j0 = Math.floor(sj) % NA, j1 = (j0 + 1) % NA, fj = sj - Math.floor(sj)
        const row = k => gas[k * NA + j0] * (1 - fj) + gas[k * NA + j1] * fj
        tmp[i * NA + j] = (row(i0) * (1 - fi) + row(Math.min(NR - 1, i0 + 1)) * fi) * fade
      }
    }
    gas.set(tmp)
    const d = gasTex.image.data
    for (let k = 0; k < d.length; k++) d[k] = Math.min(255, gas[k] * 160)
    gasTex.needsUpdate = true
  }
  const toDisk = () => { // the pointer ray, in the black hole's frame, meeting the disk plane
    ray.setFromCamera(pointer, camera)
    const o = ray.ray.origin.clone().multiplyScalar(zoom).applyMatrix3(u.rot.value), d = ray.ray.direction.clone().applyMatrix3(u.rot.value)
    return Math.abs(d.y) > 1e-3 && -o.y / d.y > 0 ? o.addScaledVector(d, -o.y / d.y) : null
  }

  // ── hover: your cursor becomes a tiny star. Its light fans out across the view and every ray bends around the hole, traced with
  // the renderer's own maths: far rays barely curve, near ones swing round, rays grazing the photon sphere wrap it, the rest fall in ──
  const NRY = 36, MS = 320, seg = new Float32Array(NRY * MS * 6), arcs = new Float32Array(NRY * MS * 2), hot = new Float32Array(NRY * MS * 2)
  const tu = { ...U, show: { value: 0 } }
  const tg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(seg, 3)).setAttribute('s', new THREE.BufferAttribute(arcs, 1)).setAttribute('h', new THREE.BufferAttribute(hot, 1))
  const rays = new THREE.LineSegments(tg, new THREE.ShaderMaterial({
    uniforms: tu, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float s, h; varying float vS, vH; void main(){ vS = s, vH = h; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform float time, show; uniform vec3 ink, accent; varying float vS, vH;
      void main(){
        float k = pow(fract(vS / 1.3 - time * 1.5), 10.);                         // light streaming outward
        vec3 c = ink * .2 + mix(accent * 1.8, ink * 3., k) * k * (.5 + vH);       // hotter where it skims the hole
        gl_FragColor = vec4(c * exp(-vS * .1) * smoothstep(0., .25, vS) * show, 1.);
      }`,
  }))
  const glow = document.createElement('canvas').getContext('2d'), gg = glow.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.canvas.width = glow.canvas.height = 64, gg.addColorStop(0, '#fff'), gg.addColorStop(0.2, 'rgba(255,150,100,.6)'), gg.addColorStop(1, 'rgba(255,77,26,0)'), (glow.fillStyle = gg), glow.fillRect(0, 0, 64, 64)
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow.canvas), blending: THREE.AdditiveBlending, depthTest: false, transparent: true }))
  rays.frustumCulled = false, scene.add(rays, star)
  const P = new THREE.Vector3(), Vv = new THREE.Vector3(), A = new THREE.Vector3(), Q = new THREE.Vector3(), Vm = new THREE.Vector3(), X = new THREE.Vector3(), Yv = new THREE.Vector3(), S0 = new THREE.Vector3()
  const accel = (p, h2) => A.copy(p).multiplyScalar((-1.5 * h2) / p.length() ** 5) // central, so the frame's rotation doesn't matter, only zoom's scale
  const trace = () => {
    ray.setFromCamera(pointer, camera)
    if (!ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(C), O), S0)) return
    X.setFromMatrixColumn(camera.matrixWorld, 0), Yv.setFromMatrixColumn(camera.matrixWorld, 1) // the view plane through the hole
    let n = 0
    for (let k = 0; k < NRY; k++) {
      const th = (k / NRY) * TAU + 0.07
      P.copy(S0).multiplyScalar(zoom), Vv.copy(X).multiplyScalar(Math.cos(th)).addScaledVector(Yv, Math.sin(th)).normalize()
      const h2 = Q.copy(P).cross(Vv).lengthSq()
      let len = 0
      for (let i = 0; i < MS - 1; i++) {
        const r = P.length(); if (r < 1.02 || r > 34) break
        const dt = Math.min(0.3, Math.max(0.02, 0.025 * r * r))
        Vm.copy(Vv).addScaledVector(accel(P, h2), dt * 0.5).normalize()             // midpoint (RK2), as in the shader
        accel(Q.copy(P).addScaledVector(Vv, dt * 0.5), h2), Vv.addScaledVector(A, dt).normalize()
        const o = n * 6, ht = Math.exp(-((r - 1.5) ** 2) * 1.5)
        seg.set([P.x / zoom, P.y / zoom, P.z / zoom], o), P.addScaledVector(Vm, dt), seg.set([P.x / zoom, P.y / zoom, P.z / zoom], o + 3)
        arcs[n * 2] = len, (len += dt / zoom), (arcs[n * 2 + 1] = len), (hot[n * 2] = hot[n * 2 + 1] = ht), n++
      }
    }
    tg.setDrawRange(0, n * 2)
    for (const k of ['position', 's', 'h']) tg.attributes[k].needsUpdate = true
    star.position.copy(S0), star.scale.setScalar(0.9 * tu.show.value)
  }

  // ── view: scroll to zoom, right-drag (or shift-drag) to orbit with inertia; the loop adds its own slow sway ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), C = new THREE.Vector3(), O = new THREE.Vector3(), E = new THREE.Euler(0, 0, 0, 'YXZ'), M = new THREE.Matrix4()
  let now = 0, down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, zoom = 1, zoomT = 1, lx = 0, ly = 0, last = null, prev = 0
  addEventListener('contextmenu', e => e.preventDefault())
  addEventListener('pointerdown', e => ((down = { orbit: e.button === 2 || e.shiftKey, t: now, moved: 0 }), (lx = pointer.x), (ly = pointer.y), (last = null)))
  addEventListener('pointermove', () => {
    if (!down) return
    down.moved += Math.hypot(pointer.x - lx, pointer.y - ly)
    if (down.orbit) vy = (pointer.x - lx) * 2.2, vp = (pointer.y - ly) * 1.6, (yaw += vy), (pitch = THREE.MathUtils.clamp(pitch + vp, -1.2, 1.2))
    else { // pour: splat along the stroke so fast drags leave a continuous ribbon
      const h = toDisk()
      if (h) { const n = last ? Math.ceil(last.distanceTo(h) / 0.12) : 1; for (let i = 1; i <= n; i++) { const q = last ? last.clone().lerp(h, i / n) : h; deposit(q.x, q.z, 0.35) } }
      last = h
    }
    lx = pointer.x, ly = pointer.y
  })
  addEventListener('pointerup', () => {
    if (down && !down.orbit && down.moved < 0.02) { // a click: throw a star in from where you clicked
      ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(C), O), C)
      C.applyMatrix3(u.rot.value).setLength(13), (mine = event(C.clone(), now))
    }
    down = null
  })
  addEventListener('wheel', e => (zoomT = THREE.MathUtils.clamp(zoomT * Math.exp(e.deltaY * 0.001), 0.45, 1.5)), { passive: true })

  return (t, p) => {
    advect(Math.min(0.05, Math.max(0, t - prev))), (prev = t), (now = t)
    const a = p * TAU
    if (!down) (yaw += vy *= 0.94), (pitch = THREE.MathUtils.clamp(pitch + (vp *= 0.94), -1.2, 1.2)) // inertia
    zoom += (zoomT - zoom) * 0.08
    M.makeRotationFromEuler(E.set(-0.12 + Math.sin(2 * a) * 0.05 - pitch, Math.sin(a) * 0.35 + yaw, 0))
    u.rot.value.setFromMatrix4(M), (u.zoom.value = zoom)

    // emitters: the scripted torn star, the user's, and the companion on a once-per-loop orbit passing behind the hole
    const tau = ((p - auto.at + 1) % 1) * LOOP, tm = mine ? t - mine.at : 1e9, st = u.st.value
    for (let k = 0; k < NB; k++) place(auto, tau, st[k], k), mine && tm < TF + 1 ? place(mine, tm, st[NB + k], k) : st[NB + k].set(0, 0, 0, 0)
    const c = a - Math.PI / 2 + 0.4
    st[NS - 1].set(Math.cos(c) * 13, -1.2 + Math.sin(c) * 0.6, Math.sin(c) * 13, 0.9)
    u.feed.value = feed(tau) + (mine ? feed(tm) : 0)

    const live = st.filter(s => s.w > 0), b = u.bound.value // a bounding sphere so rays only look for emitters when close
    if (live.length) {
      const ctr = live.reduce((m, s) => m.add(O.set(s.x, s.y, s.z)), new THREE.Vector3()).divideScalar(live.length)
      b.set(ctr.x, ctr.y, ctr.z, (Math.max(...live.map(s => ctr.distanceTo(O.set(s.x, s.y, s.z)))) + 1) ** 2)
    } else b.w = -1
    O.set(0, 0, 0)

    tu.show.value += ((pointer.active && !down ? 1 : 0) - tu.show.value) * 0.1
    star.visible = rays.visible = tu.show.value > 0.01
    if (rays.visible) trace()
  }
}, { loop: 16, eye: [0, 1.2, 42], drift: 0.6, bloom: 0.4, dpr: 1 })
