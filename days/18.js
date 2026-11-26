import { go, THREE, U, R, TAU, pointer, raymarch } from '../lib/stage.js'

// 18 — mercury: beads of liquid metal on a dish of black glass. They roll as the dish tilts, attract when they touch and swallow
// each other (volume conserved), and shatter into droplets when the dish is struck. Raymarched: every bead is a mirror that
// reflects the studio, the other beads and the glass, and the glass reflects them back.
// hover: tilt the dish · click: strike it · hold and drag: run a finger through them
go('mercury', ({ scene, camera }) => {
  const M = 56, DISH = 2.4, LOOP = 16, SQ = 0.72
  const D = Array.from({ length: M }, () => ({ p: new THREE.Vector2(), v: new THREE.Vector2(), r: 0, cool: 0, swell: 0 }))
  for (let i = 0; i < 30; i++) { const a = R(TAU), d = R(0.3, 1.9); D[i].p.set(Math.cos(a) * d, Math.sin(a) * d), (D[i].r = R(0.08, 0.22)) }
  const u = { ...U, drops: { value: Array.from({ length: M }, () => new THREE.Vector4()) }, rot: { value: new THREE.Matrix3() }, shock: { value: new THREE.Vector4(0, 0, -99, 0) }, now: { value: 0 } }
  const mesh = raymarch(`
    uniform vec4 drops[${M}], shock; uniform mat3 rot; uniform vec3 ink, accent; uniform float phase, now; varying vec3 vRay;
    float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
    float beads(vec3 p){
      float d = 1e3;
      for (int i = 0; i < ${M}; i++) { vec4 B = drops[i]; if (B.w <= 0.) continue; float s = min(${SQ}, .17 / B.w); vec3 q = p - B.xyz; q.y /= s; d = smin(d, (length(q) - B.w) * s, .07); }
      return d;
    }
    vec3 nrm(vec3 p){ vec2 e = vec2(.002, -.002); return normalize(e.xyy * beads(p + e.xyy) + e.yyx * beads(p + e.yyx) + e.yxy * beads(p + e.yxy) + e.xxx * beads(p + e.xxx)); }
    float panel(vec3 d, vec3 c, vec3 up, vec2 s){                 // a rectangular softbox, as seen in direction d
      float t = dot(d, c); if (t <= 0.) return 0.;
      vec3 q = d / t, r = normalize(cross(up, c)), u = cross(c, r); vec2 uv = vec2(dot(q, r), dot(q, u)) / s;
      return smoothstep(1., .85, max(abs(uv.x), abs(uv.y)));
    }
    vec3 env(vec3 d){                                             // a dark studio: a long key overhead that slowly turns, a side strip, an ember panel low
      float P = phase * 6.2832;
      vec3 k = normalize(vec3(sin(P) * .35, 1., cos(P) * .35));
      return ink * (panel(d, k, vec3(cos(P), 0., -sin(P)), vec2(.9, .14)) * 1.8 + panel(d, normalize(vec3(-1., .35, .2)), vec3(0., 1., 0.), vec2(.05, .6)) * .9 + exp(-pow(d.y * 12., 2.)) * .03 + .004 + .05 * smoothstep(-.1, .9, d.y))
           + accent * (panel(d, normalize(vec3(.7, .12, .7)), vec3(0., 1., 0.), vec2(.55, .08)) * 1.5 + pow(max(dot(d, normalize(vec3(.7, .12, .7))), 0.), 6.) * .12);
    }
    // march the beads up to the glass; 0 = sky, 1 = bead, 2 = glass
    int trace(vec3 ro, vec3 rd, out vec3 p){
      float tf = rd.y < 0. ? -ro.y / rd.y : 1e3, t = 0.;
      if (ro.y > .75) { if (rd.y >= 0.) return 0; t = (ro.y - .75) / -rd.y; }
      for (int i = 0; i < 72; i++) { p = ro + rd * t; float h = beads(p); if (h < .0015) return 1; t += h; if (t > tf || t > 30.) break; }
      if (tf < 1e3) { p = ro + rd * tf; if (length(p.xz) < ${DISH}) return 2; }
      return 0;
    }
    vec3 bounce(vec3 ro, vec3 rd){                                 // what a reflection sees (one level deep)
      vec3 p; int h = trace(ro, rd, p);
      if (h == 1) { vec3 n = nrm(p); return env(reflect(rd, n)) * .75; }
      if (h == 2) return vec3(.003) + env(reflect(rd, vec3(0., 1., 0.))) * .06;
      return env(rd);
    }
    void main(){
      vec3 ro = rot * cameraPosition, rd = rot * normalize(vRay), p;
      int h = trace(ro, rd, p);
      vec3 c;
      if (h == 1) {                                               // a bead: a near-perfect mirror
        vec3 n = nrm(p); float F = pow(1. - max(dot(-rd, n), 0.), 5.);
        c = bounce(p + n * .004, reflect(rd, n)) * (.72 + .28 * F) * vec3(.95, .96, 1.);
      } else if (h == 2) {                                         // black glass: faint, mostly at grazing angles; a polished rim
        float F = .03 + .97 * pow(1. - max(-rd.y, 0.), 5.), occ = clamp(beads(p) / .25, 0., 1.);
        vec3 r = reflect(rd, vec3(0., 1., 0.)), q; float bead = float(trace(p + vec3(0., .002, 0.), r, q) == 1);
        c = vec3(.002) + bounce(p + vec3(0., .002, 0.), r) * mix(.04, .5, F) * mix(.6, 7., bead) * .5 * (.5 + .5 * occ); // dim studio, clear bead reflections
        c += ink * .05 * smoothstep(${DISH - 0.03}, ${DISH}, length(p.xz));
        float age = now - shock.z, ring = exp(-pow((length(p.xz - shock.xy) - age * 3.2) * 9., 2.)) * exp(-age * 2.2) * shock.w * step(0., age); // the blow's shockwave racing over the glass
        c += (accent * .9 + ink * .35 * exp(-age * 6.)) * ring + accent * .5 * exp(-length(p.xz - shock.xy) * 6.) * exp(-age * 7.) * shock.w * step(0., age);
      } else discard;
      gl_FragColor = vec4(c, 1.);
    }`, u)
  scene.add(mesh)
  const ray = new THREE.Raycaster(), M3 = new THREE.Matrix4(), E = new THREE.Euler(), tilt = new THREE.Vector2(), g = new THREE.Vector2(), O = new THREE.Vector3(), Dir = new THREE.Vector3()
  const finger = { on: false, p: new THREE.Vector2(), last: new THREE.Vector2(), v: new THREE.Vector2() }
  let down = null, now = 0
  const free = () => D.find(d => d.r <= 0)
  const strike = (c, power, reach = 1) => { // everything near the blow splinters and is thrown outward; volume is conserved exactly
    u.shock.value.set(c.x, c.y, now, Math.min(1.5, power * 0.6))
    for (const d of D.filter(d => d.r > 0.06 && d.p.distanceTo(c) < reach + d.r)) {
      const want = Math.min(power > 1.5 ? 9 : 5, Math.max(2, Math.round((d.r / 0.07) * power))), pieces = [d]
      for (const f of D) { if (pieces.length >= want) break; if (f.r <= 0 && !pieces.includes(f)) pieces.push(f) } // distinct free slots only
      // a main blob and smaller satellites, like a real splash
      const w = pieces.map((_, k) => (k === 0 ? 2.2 : R(0.25, 1))), W = w.reduce((a, b) => a + b, 0), vol = d.r ** 3
      const base = d.p.clone(), v0 = d.v.clone(), out = d.p.clone().sub(c), dist = out.length(), a0 = dist > 1e-2 ? Math.atan2(out.y, out.x) : R(TAU)
      pieces.forEach((q, k) => {
        const r = Math.cbrt((vol * w[k]) / W), a = k === 0 ? a0 : a0 + ((k - 1) / (pieces.length - 1) - 0.5) * (dist > 0.15 ? 2.6 : TAU) + R(-0.25, 0.25)
        const s = (k === 0 ? 0.5 : 1.6 + R(1.6) * (1 - w[k] / 2)) * power / (0.7 + dist), off = k === 0 ? 0 : d.r * 0.75
        q.p.set(base.x + Math.cos(a) * off, base.y + Math.sin(a) * off), q.v.set(v0.x + Math.cos(a) * s, v0.y + Math.sin(a) * s), (q.r = r), (q.cool = 0.45 + R(0.35)), (q.swell = 0)
      })
    }
  }

  const onDish = () => { // the cursor on the dish, in the dish's frame
    ray.setFromCamera(pointer, camera)
    O.copy(ray.ray.origin).applyMatrix3(u.rot.value), Dir.copy(ray.ray.direction).applyMatrix3(u.rot.value)
    if (Dir.y >= 0) return null
    const t = -O.y / Dir.y; return new THREE.Vector2(O.x + Dir.x * t, O.z + Dir.z * t)
  }
  addEventListener('pointerdown', () => { down = { at: now, moved: 0 }; const c = onDish(); if (c) finger.last.copy(c), finger.p.copy(c) }) // measure movement from here, not from the last drag
  const bursts = [] // your blows: the beads near it swell for a moment, then burst
  addEventListener('pointerup', () => { if (down && down.moved < 0.08 && now - down.at < 0.35) { const c = onDish(); if (c) { D.forEach(d => d.r > 0 && d.p.distanceTo(c) < 1.5 + d.r && (d.swell = 1e-3)); bursts.push({ c, at: now + 0.22 }) } } down = null, (finger.on = false) })
  const strikes = [[0.12, 0.9, -0.4], [0.47, -0.8, 0.6], [0.78, 0.2, 0.9]] // the loop's own blows: phase, x, z
  let lastP = 0

  const step = dt => {
    for (const d of D) {
      if (d.r <= 0) continue
      d.cool = Math.max(0, d.cool - dt)
      d.v.addScaledVector(g, dt).multiplyScalar(Math.exp(-dt * (0.7 + 0.04 / d.r)))       // small beads drag more
      d.p.addScaledVector(d.v, dt)
      const l = d.p.length(), lim = DISH - d.r * 0.9
      if (l > lim) { const n = d.p.clone().divideScalar(l), vn = d.v.dot(n); d.p.copy(n).multiplyScalar(lim); if (vn > 0) d.v.addScaledVector(n, -vn * 1.35) } // the rim
      if (finger.on) { const e = d.p.clone().sub(finger.p), el = e.length(), lim2 = 0.12 + d.r; if (el < lim2) { e.divideScalar(el || 1), d.p.copy(finger.p).addScaledVector(e, lim2), d.v.addScaledVector(e, 2).addScaledVector(finger.v, 0.3); if (d.r > 0.16 && finger.v.length() > 1.2 && !d.cool) strike(finger.p, 0.45) } }
    }
    for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++) {                         // surface tension: touch → the bigger swallows the smaller
      const a = D[i], b = D[j]; if (a.r <= 0 || b.r <= 0) continue
      const e = b.p.clone().sub(a.p), l = e.length(), s = a.r + b.r
      if (l > s + 0.15) continue
      e.divideScalar(l || 1)
      if (a.cool || b.cool) { if (l < s) { const f = 3 * dt; a.v.addScaledVector(e, -f * (b.r / s)), b.v.addScaledVector(e, f * (a.r / s)) } continue } // fresh splinters bounce apart
      if (l > s * 0.85) { const f = 2.5 * dt; a.v.addScaledVector(e, f * (b.r / s)), b.v.addScaledVector(e, -f * (a.r / s)); continue }           // near: they pull together
      const [big, small] = a.r >= b.r ? [a, b] : [b, a], vb = big.r ** 3, vs = small.r ** 3, x = Math.min(vs, (vb + vs) * 5 * dt)
      big.p.lerp(small.p, x / (vb + x) * 0.5), big.v.lerp(small.v, x / (vb + x)), small.p.lerp(big.p, 8 * dt)
      big.r = Math.cbrt(vb + x), (small.r = vs - x < 1e-5 ? 0 : Math.cbrt(vs - x))
    }
  }

  return (t, p) => {
    const dt = Math.min(1 / 30, Math.max(0, t - now)); now = t
    // the dish tilts: on its own a slow wobble; under your cursor, towards it
    const target = new THREE.Vector2(Math.sin(p * TAU) * 0.07, Math.sin(p * TAU * 2 + 1) * 0.05)
    if (pointer.active && !down) { const c = onDish(); if (c) target.copy(c).multiplyScalar(0.14 / DISH * 1.6).clampLength(0, 0.16) }
    tilt.lerp(target, 0.05)
    g.set(tilt.x, tilt.y).multiplyScalar(6)                                                  // tilt = which way is downhill
    M3.makeRotationFromEuler(E.set(-tilt.y, 0, tilt.x)), u.rot.value.setFromMatrix4(M3)
    if (down) { const c = onDish(); if (c) { down.moved += c.distanceTo(finger.last); finger.v.copy(c).sub(finger.last).divideScalar(dt || 1 / 60), finger.p.copy(c), finger.last.copy(c), (finger.on = now - down.at > 0.12) } }
    for (let i = bursts.length - 1; i >= 0; i--) if (now >= bursts[i].at) { D.forEach(d => (d.swell = 0)); strike(bursts[i].c, 2.4, 1.6), bursts.splice(i, 1) }
    D.forEach(d => d.swell > 0 && (d.swell = Math.min(1, d.swell + dt / 0.22)))
    u.now.value = now
    for (const [at, x, z] of strikes) if ((lastP < at && p >= at) || (lastP > p && at <= p)) strike(new THREE.Vector2(x, z), 1)
    lastP = p
    for (let s = 0; s < 2; s++) step(dt / 2)
    D.forEach((d, i) => { const r = d.r * (1 + 0.12 * d.swell * d.swell + 0.05 * d.swell * Math.sin(now * 90)); u.drops.value[i].set(d.p.x, r * Math.min(SQ, 0.17 / Math.max(r, 1e-3)) * 0.72, d.p.y, r) }) // swelling beads quiver
  }
}, { loop: 16, blend: 2, eye: [0, 5.2, 6.4], drift: 0.3, bloom: 0.55, dpr: 1, parallax: 0, poster: 0.1 })
