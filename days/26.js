import { go, THREE, U, R, TAU, pointer, REC } from '../lib/stage.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

// 26 — vortex: two smoke rings fired one after the other, leapfrogging: the rear ring's flow shrinks it and speeds it up,
// it slips through the front one, which swells and slows, and they trade places again and again. The physics is a vortex
// filament model: each ring is a closed line of vorticity, every point moved by the Biot–Savart velocity of every segment
// (Rosenhead–Moore core), resampled each step. ~200k tracers on the GPU are carried by the same field, so you see it as smoke.
// click: fire another ring into them, from where you point · drag: turn the view · scroll: time
go('vortex', ({ scene, camera, renderer }) => {
  const LOOP = 14, SLOTS = 4, M = 80, GAM = 2.6, CORE = 0.16, TW = 512, TH = 512
  // ── the filaments (CPU) ──
  const ring = Array.from({ length: SLOTS }, () => ({ on: false, p: new Float32Array(M * 3), g: GAM })) // slot 3 is never a ring: its tracers are the dust
  const seedRing = (s, cx, cy, cz, ax, ay, az, r, wob) => {
    const A = new THREE.Vector3(ax, ay, az).normalize(), e1 = new THREE.Vector3(0, 1, 0).cross(A); if (e1.lengthSq() < 1e-4) e1.set(0, 0, 1).cross(A); e1.normalize(); const e2 = A.clone().cross(e1)
    for (let i = 0; i < M; i++) { const a = (i / M) * TAU, rr = r * (1 + wob * (Math.sin(6 * a) * 0.7 + Math.sin(3 * a + 1) * 0.3)); ring[s].p.set([cx + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * rr, cy + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * rr, cz + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * rr], i * 3) }
    ring[s].on = true, (ring[s].axis = A), (ring[s].r = r), (ring[s].c = new THREE.Vector3(cx, cy, cz))
  }
  const vel = (X, Y, Z, out) => { // Biot–Savart, regularised, over every active segment
    let ux = 0, uy = 0, uz = 0
    for (const rg of ring) {
      if (!rg.on) continue
      const P = rg.p
      for (let i = 0; i < M; i++) {
        const j = (i + 1) % M, ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2], dx = P[j * 3] - ax, dy = P[j * 3 + 1] - ay, dz = P[j * 3 + 2] - az
        const rx = X - (ax + dx / 2), ry = Y - (ay + dy / 2), rz = Z - (az + dz / 2), q = rx * rx + ry * ry + rz * rz + CORE * CORE, f = rg.g / (4 * Math.PI * q * Math.sqrt(q))
        ux += (dy * rz - dz * ry) * f, (uy += (dz * rx - dx * rz) * f), (uz += (dx * ry - dy * rx) * f)
      }
    }
    out[0] = ux, (out[1] = uy), (out[2] = uz)
  }
  const k1 = new Float32Array(SLOTS * M * 3), tmp = ring.map(() => new Float32Array(M * 3)), u = [0, 0, 0]
  const advance = h => { // RK2 (midpoint) on every node, then resample each ring to even spacing
    ring.forEach((rg, s) => { if (rg.on) for (let i = 0; i < M; i++) { vel(rg.p[i * 3], rg.p[i * 3 + 1], rg.p[i * 3 + 2], u); k1.set(u, (s * M + i) * 3) } })
    ring.forEach((rg, s) => { if (rg.on) { tmp[s].set(rg.p); for (let i = 0; i < M * 3; i++) rg.p[i] += k1[s * M * 3 + i] * h / 2 } })
    ring.forEach((rg, s) => { if (rg.on) for (let i = 0; i < M; i++) { vel(rg.p[i * 3], rg.p[i * 3 + 1], rg.p[i * 3 + 2], u); k1.set(u, (s * M + i) * 3) } })
    ring.forEach((rg, s) => { if (!rg.on) return; for (let i = 0; i < M * 3; i++) rg.p[i] = tmp[s][i] + k1[s * M * 3 + i] * h
      const P = rg.p, L = [0]; for (let i = 0; i < M; i++) { const j = (i + 1) % M; L.push(L[i] + Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2])) }
      const out = new Float32Array(M * 3); let seg = 0
      for (let i = 0; i < M; i++) { const want = (i / M) * L[M]; while (L[seg + 1] < want) seg++; const f = (want - L[seg]) / (L[seg + 1] - L[seg] || 1), a = seg, b = (seg + 1) % M; for (let c = 0; c < 3; c++) out[i * 3 + c] = P[a * 3 + c] + (P[b * 3 + c] - P[a * 3 + c]) * f }
      for (let i = 0; i < M; i++) { const a = ((i + M - 1) % M) * 3, b = ((i + 1) % M) * 3; for (let c = 0; c < 3; c++) rg.p[i * 3 + c] = out[i * 3 + c] * 0.9 + (out[a + c] + out[b + c]) * 0.05 } // a little smoothing: damps the short waves that would otherwise blow up
    })
  }

  // ── the tracers (GPU): seeded in each ring's core, advected by the same field read from a texture of nodes ──
  const nodes = new THREE.DataTexture(new Float32Array(SLOTS * M * 4), SLOTS * M, 1, THREE.RGBAFormat, THREE.FloatType)
  const gpu = new GPUComputationRenderer(TW, TH, renderer), t0 = gpu.createTexture()
  const sim = { tN: { value: nodes }, h: { value: 0 }, seed: { value: new THREE.Vector4(-1, 0, 0, 0) }, sc: { value: new THREE.Vector4() }, sa: { value: new THREE.Vector4() }, time: { value: 0 }, ctr: { value: new THREE.Vector3() } }
  const vT = gpu.addVariable('tT', `
    uniform sampler2D tN; uniform float h, time; uniform vec4 seed, sc, sa; uniform vec3 ctr;
    float hs(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 node(int s, int i){ return texture2D(tN, vec2((float(s * ${M} + i) + .5) / ${SLOTS * M}.0, .5)).xyz; }
    vec3 flow(vec3 p){
      vec3 u = vec3(0.);
      for (int s = 0; s < ${SLOTS}; s++) {
        float g = texture2D(tN, vec2((float(s * ${M}) + .5) / ${SLOTS * M}.0, .5)).w; if (g == 0.) continue;
        vec3 a = node(s, 0), first = a;
        for (int i = 1; i <= ${M}; i++) {
          vec3 b = i == ${M} ? first : node(s, i), d = b - a, r = p - (a + d * .5); float q = dot(r, r) + ${(CORE * CORE).toFixed(4)};
          u += cross(d, r) * (g / (12.566 * q * sqrt(q))); a = b;
        }
      }
      return u;
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy; vec4 t = texture2D(tT, uv); int slot = int(uv.y * ${SLOTS}.);
      vec3 rs = vec3(hs(uv * 1.1 + time), hs(uv * 1.9 - time), hs(uv * 2.7 + time * .3)) * 2. - 1.;
      if (slot == ${SLOTS - 1} && (seed.x == ${SLOTS - 1}. || length(t.xyz - ctr) > 3.6)) {   // dust: the still air all round, refilled as it is swept off
        gl_FragColor = vec4(ctr + normalize(rs + 1e-4) * 3.4 * pow(hs(uv * 3.7 + time), .33), 0.); return;
      }
      if (float(slot) == seed.x) {                          // (re)born in this ring's core: a fuzzy torus
        vec3 A = sa.xyz, e1 = normalize(abs(A.y) < .9 ? cross(vec3(0., 1., 0.), A) : cross(vec3(0., 0., 1.), A)), e2 = cross(A, e1);
        float a = hs(uv + seed.y) * 6.2832, b = hs(uv * 1.7 + seed.y) * 6.2832, rr = sqrt(-2. * log(max(hs(uv * 2.3 + seed.y), 1e-4))) * ${CORE * 0.9};
        vec3 rad = e1 * cos(a) + e2 * sin(a);
        gl_FragColor = vec4(sc.xyz + rad * (sa.w + rr * cos(b)) + A * rr * sin(b), 0.); return;
      }
      // strays are drawn back: a tracer that has left its ring's core is reborn inside it, so the rings stay crisp
      float g0 = texture2D(tN, vec2((float(slot * ${M}) + .5) / ${SLOTS * M}.0, .5)).w, best = 1e9;
      if (g0 != 0.) {
        for (int i = 0; i < ${M}; i += 2) { vec3 q = node(slot, i) - t.xyz; best = min(best, dot(q, q)); }
        if (best > .2 || t.w > 4.) {
          int k = int(hs(uv + time) * ${M}.); vec3 rnd = vec3(hs(uv * 1.3 + time), hs(uv * 2.1 - time), hs(uv * 0.7 + time * 1.7)) - .5;
          gl_FragColor = vec4(node(slot, k) + normalize(rnd + 1e-4) * ${CORE} * .9 * hs(uv * 3.3 + time), 0.); return;
        }
      }
      vec3 p = t.xyz, u = flow(p);
      u = flow(p + u * h * .5);                              // midpoint step: tracers stay in the cores instead of spiralling out
      gl_FragColor = vec4(p + u * h, length(u));          // keep the speed: it colours the smoke
    }`, t0)
  gpu.setVariableDependencies(vT, [vT]), Object.assign(vT.material.uniforms, sim)
  const err = gpu.init(); if (err) throw new Error(err)
  const upload = () => { const d = nodes.image.data; ring.forEach((rg, s) => { for (let i = 0; i < M; i++) d.set([rg.p[i * 3], rg.p[i * 3 + 1], rg.p[i * 3 + 2], rg.on ? rg.g : 0], (s * M + i) * 4) }), (nodes.needsUpdate = true) }
  const pending = [] // slots whose tracers need seeding (one per frame)

  // ── drawing: the smoke, and faint lines along the cores ──
  const ref = new Float32Array(TW * TH * 3); for (let i = 0; i < TW * TH; i++) ref.set([((i % TW) + 0.5) / TW, (((i / TW) | 0) + 0.5) / TH, 0], i * 3)
  const view = new THREE.Group(), off = { value: new THREE.Vector3() }, fade = { value: 1 }, live = { value: new THREE.Vector4(1, 1, 0, 0) }
  const smoke = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ref, 3)), new THREE.ShaderMaterial({
    uniforms: { ...U, tT: { value: null }, off, fade, live }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform sampler2D tT; uniform vec3 off, ink, accent; uniform vec4 live; uniform float fade; uniform vec2 res; varying vec3 vC;
      void main(){
        vec4 t = texture2D(tT, position.xy); int slot = int(position.y * 4.);
        float on = slot == 0 ? live.x : slot == 1 ? live.y : slot == 2 ? live.z : live.w;
        float sp = t.w, k = smoothstep(.15, 1.6, sp), r = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 tint = slot == 0 ? ink : slot == 1 ? accent : slot == 2 ? mix(ink, accent, .6) : accent;            // whose smoke it is …
        vC = mix(mix(accent * .35, tint, .6), mix(tint, ink * 1.4, .35), k) * (.4 + .8 * k) * .0035 * on * fade * (.6 + .8 * r); // … and how fast it spins: cores white-hot
        vec4 mv = modelViewMatrix * vec4(t.xyz - off, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = res.y / 1080. * (2. + 3.5 * (1. - k)) * 7. / -mv.z;
      }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 c = gl_PointCoord * 2. - 1.; float r = dot(c, c); if (r > 1.) discard; gl_FragColor = vec4(vC * (1. - r) * 1.6, 1.); }`,
  }))
  smoke.frustumCulled = false
  // trails: 2,048 of the tracers remember their last second (a GPU ring buffer of positions); each is drawn as one long fading line
  const NTR = 2048, K = 96, hg = new GPUComputationRenderer(K, NTR, renderer), headU = { value: 0 }, tTr = { value: null }
  const vH = hg.addVariable('tH', `uniform sampler2D tTr; uniform float head;
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      if (floor(gl_FragCoord.x) == head) { float i = floor(gl_FragCoord.y) * ${(TW * TH) / NTR}.; gl_FragColor = texture2D(tTr, vec2((mod(i, ${TW}.) + .5) / ${TW}., (floor(i / ${TW}.) + .5) / ${TH}.)); }
      else gl_FragColor = texture2D(tH, uv);
    }`, hg.createTexture())
  hg.setVariableDependencies(vH, [vH]), Object.assign(vH.material.uniforms, { tTr, head: headU })
  { const e = hg.init(); if (e) throw new Error(e) }
  const tref = new Float32Array(NTR * (K - 1) * 6); for (let r = 0, o = 0; r < NTR; r++) for (let k = 0; k < K - 1; k++, o += 6) tref.set([r, k, 0, r, k, 1], o)
  const tHU = { value: null }
  const streaks = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(tref, 3)), new THREE.ShaderMaterial({
    uniforms: { ...U, tH: tHU, head: headU, off, fade, live }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform sampler2D tH; uniform float head, fade; uniform vec3 off, ink, accent; uniform vec4 live; varying vec3 vC;
      vec4 at(float k){ return texture2D(tH, vec2((mod(head - k + ${2 * K}., ${K}.) + .5) / ${K}., (position.x + .5) / ${NTR}.)); }
      void main(){
        vec4 a = at(position.y), b = at(position.y + 1.), P = position.z > .5 ? b : a;
        int slot = int(position.x / ${NTR / 4}.); float on = slot == 0 ? live.x : slot == 1 ? live.y : slot == 2 ? live.z : 1.;
        float ok = step(length(a.xyz - b.xyz), .25) * step(.001, dot(b.xyz, b.xyz)), f = 1. - (position.y + position.z) / ${K}.;  // no line across a rebirth
        vec3 tint = slot == 0 ? ink : slot == 1 ? accent : slot == 2 ? mix(ink, accent, .6) : mix(accent, ink, .3);
        float k = position.y + position.z, head = exp(-k * .45);                                                  // a white-hot head, an ember tail
        vC = (tint * f * f * (slot == 3 ? .03 + .08 * smoothstep(.1, 1., P.w) : .045) + mix(tint, ink, .7) * head * (slot == 3 ? .08 : .5)) * ok * on * fade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(P.xyz - off, 1.);
      }`,
    fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.); }`,
  }))
  streaks.frustumCulled = false
  // and at the head of every trail a light, each pulsing in its own time
  const hp = new Float32Array(NTR * 3); for (let r = 0; r < NTR; r++) hp[r * 3] = r
  const heads = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(hp, 3)), new THREE.ShaderMaterial({
    uniforms: { ...U, tH: tHU, head: headU, off, fade, live }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform sampler2D tH; uniform float head, fade, time; uniform vec3 off, ink, accent; uniform vec4 live; uniform vec2 res; varying vec3 vC;
      void main(){
        vec4 a = texture2D(tH, vec2((mod(head, ${K}.) + .5) / ${K}., (position.x + .5) / ${NTR}.));
        int slot = int(position.x / ${NTR / 4}.); float on = slot == 0 ? live.x : slot == 1 ? live.y : slot == 2 ? live.z : .15;
        float ph = fract(sin(position.x * 12.9898) * 43758.5453) * 6.2832, pulse = pow(.5 + .5 * sin(time * (3. + 4. * fract(ph)) + ph), 3.);
        vec3 tint = slot == 0 ? ink : slot == 1 ? accent : slot == 2 ? mix(ink, accent, .6) : mix(accent, ink, .3);
        vC = mix(tint, ink, .5) * (.25 + 1.6 * pulse) * on * fade * step(.001, dot(a.xyz, a.xyz)) * .5;
        vec4 mv = modelViewMatrix * vec4(a.xyz - off, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = res.y / 1080. * (2.5 + 5. * pulse) * 6. / -mv.z;
      }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 c = gl_PointCoord * 2. - 1.; float r = dot(c, c); if (r > 1.) discard; gl_FragColor = vec4(vC * exp(-r * 4.), 1.); }`,
  }))
  heads.frustumCulled = false
  const lp = new Float32Array(SLOTS * M * 6), lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(lp, 3)), new THREE.LineBasicMaterial({ color: new THREE.Color(U.accent.value).multiplyScalar(0.5), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }))
  lines.frustumCulled = false
  view.add(streaks, heads, smoke, lines), scene.add(view)

  // ── the loop: two rings, one behind the other; at the wrap the smoke fades and they are fired again ──
  const start = () => { // three rings in a train: each in turn is drawn through the ones ahead, they braid and leapfrog; dust shows the air they drag
    ring.forEach(r => (r.on = false)); seedRing(0, -1.7, 0, 0, 1, 0, 0, 1, 0.006), seedRing(1, -1.1, 0, 0, 1, 0, 0, 0.92, 0.006), seedRing(2, -0.5, 0, 0, 1, 0, 0, 1.06, 0.006)
    pending.push(0, 1, 2, 3); live.value.set(1, 1, 1, 0), (nextSlot = 2)
  }
  const ray = new THREE.Raycaster(), center = new THREE.Vector3(), V = new THREE.Vector3(), Dv = new THREE.Vector3()
  let down = null, yaw = 0.7, pitch = 0.25, vy = 0, vp = 0, lx = 0, ly = 0, rate = 1, rateT = 1, last = null, lastP = 0, nextSlot = 2, zoom = 1
  start()
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.hypot(pointer.x - lx, pointer.y - ly); if (down.moved > 0.02) (vy = (pointer.x - lx) * 2), (vp = -(pointer.y - ly) * 1.2), (yaw += vy), (pitch = THREE.MathUtils.clamp(pitch + vp, -0.8, 0.8)); (lx = pointer.x), (ly = pointer.y) })
  addEventListener('pointerup', () => {
    if (down && down.moved < 0.02) { // fire: a ring from 3 units out along your pointer's ray, aimed at the pair
      ray.setFromCamera(pointer, camera); view.updateMatrixWorld()
      const inv = view.matrixWorld.clone().invert(), o = ray.ray.origin.clone().applyMatrix4(inv).add(off.value), d = ray.ray.direction.clone().transformDirection(inv)
      const from = o.addScaledVector(d, 6), aim = Dv.copy(center).sub(from).normalize(), s = 2
      seedRing(s, from.x, from.y, from.z, aim.x, aim.y, aim.z, 0.8, 0.01), pending.push(s), live.value.setComponent(s, 1)
    }
    down = null
  })
  addEventListener('wheel', e => (rateT = THREE.MathUtils.clamp(rateT - Math.sign(e.deltaY) * 0.2, 0.1, 2)), { passive: true })

  return (t, p) => {
    const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 1 / 20); last = t
    if (p < lastP) start()
    lastP = p
    rate += (rateT - rate) * 0.08
    const h = dt * rate; if (h > 0) for (let s = 0; s < 2; s++) advance(h / 2)
    upload()
    if (pending.length) { const s = pending.shift(), rg = ring[s]; sim.seed.value.set(s, R(100), 0, 0); if (rg.on) sim.sc.value.set(rg.c.x, rg.c.y, rg.c.z, 0), sim.sa.value.set(rg.axis.x, rg.axis.y, rg.axis.z, rg.r) }
    else sim.seed.value.x = -1
    sim.ctr.value.copy(center), (sim.h.value = h), (sim.time.value = t % 50), gpu.compute(), (smoke.material.uniforms.tT.value = gpu.getCurrentRenderTarget(vT).texture), (tTr.value = gpu.getCurrentRenderTarget(vT).texture), hg.compute(), (tHU.value = hg.getCurrentRenderTarget(vH).texture), (headU.value = (headU.value + 1) % K)
    // follow the pair; the cores as faint lines
    V.set(0, 0, 0); let n = 0; ring.forEach((rg, s) => { if (rg.on) for (let i = 0; i < M; i++) V.x += rg.p[i * 3], (V.y += rg.p[i * 3 + 1]), (V.z += rg.p[i * 3 + 2]), n++ })
    if (n) V.divideScalar(n), center.copy(V), off.value.lerp(V, dt ? 0.08 : 1)
    ring.forEach((rg, s) => { for (let i = 0; i < M; i++) { const j = (i + 1) % M, o = (s * M + i) * 6; if (!rg.on) { lp.fill(0, o, o + 6); continue } lp.set([rg.p[i * 3] - off.value.x, rg.p[i * 3 + 1] - off.value.y, rg.p[i * 3 + 2] - off.value.z, rg.p[j * 3] - off.value.x, rg.p[j * 3 + 1] - off.value.y, rg.p[j * 3 + 2] - off.value.z], o) } })
    lines.geometry.attributes.position.needsUpdate = true
    fade.value = Math.min(1, p * LOOP / 0.8, (1 - p) * LOOP / 0.8)
    if (!down) (yaw += vy *= 0.93), (pitch = THREE.MathUtils.clamp(pitch + (vp *= 0.93), -0.8, 0.8))
    { let rs = 0; const P = ring[0].p; for (let i = 0; i < M; i++) rs += Math.hypot(P[i * 3] - center.x, P[i * 3 + 1] - center.y, P[i * 3 + 2] - center.z); zoom += (THREE.MathUtils.clamp(1.25 / (rs / M), 0.12, 1) - zoom) * (dt ? 0.05 : 1); view.scale.setScalar(zoom) } // pull back as the disc grows
    view.rotation.set(pitch + Math.sin(p * TAU) * 0.15, yaw + Math.sin(p * TAU) * 0.6 - 0.25, 0)
  }
}, { loop: 14, eye: [0, 0, 6.4], drift: 0.3, bloom: 0.9, poster: 0.22 })
