import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'

// 23 — obsidian: a black sea under an ember sun about to set. 28 deep-water waves with the true dispersion relation (ω² = g·k:
// long swells run fast, short chop slow), each tuned to finish whole cycles in the loop so the sea repeats exactly. The sun
// lays a path of glitter towards you; a black glass buoy rides the swell (buoyancy at four points: heave, pitch and roll) and
// mirrors the sky.
// hover: move the sun · click: drop a stone, rings spread out (and rock the buoy) · scroll: wind
go('obsidian', ({ scene, camera }) => {
  const LOOP = 20, NW = 28, NV = 10, G = 9.81
  // waves: [dir x, dir z, k, amp, cycles]; steepness falls with frequency
  const W = Array.from({ length: NW }, (_, i) => {
    const n = Math.round(5 + i * i * 0.11 + i * 1.6), w = (TAU * n) / LOOP, k = (w * w) / G, a = R(-0.9, 0.9) + (i % 3) * 0.25 - 0.25
    return [Math.cos(a - Math.PI / 2), Math.sin(a - Math.PI / 2), k, (0.055 / k) * (i < 4 ? 1 : 0.8) * R(0.6, 1), n, R(TAU)]
  })
  const wv = { value: W.map(w => new THREE.Vector4(w[0], w[1], w[2], w[3])) }, wn = { value: W.map(w => new THREE.Vector2(w[4], w[5])) }
  const u = { ...U, wv, wn, sun: { value: new THREE.Vector3() }, wind: { value: 1 }, rip: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -99, 0)) }, now: { value: 0 } }
  const GLSL = `
    uniform vec4 wv[${NW}], rip[4]; uniform vec2 wn[${NW}]; uniform float phase, wind, now; uniform vec3 sun, ink, accent;
    float sea(vec2 p, int n){                                  // peaky sines: crests sharper than troughs, like real water
      float h = 0.;
      for (int i = 0; i < ${NW}; i++) { if (i >= n) break; vec4 w = wv[i]; float ph = dot(w.xy, p) * w.z - phase * 6.2832 * wn[i].x + wn[i].y; h += w.w * wind * (exp(sin(ph) - 1.) * 2. - .74); }
      for (int i = 0; i < 4; i++) { vec4 r = rip[i]; float a = now - r.z; if (a < 0. || a > 9.) continue;
        float d = length(p - r.xy); h += r.w * exp(-a * .45) * sin(d * 6. - a * 7.6) * exp(-pow((d - a * .62 - .3) * 1.3, 2.)) / (1. + d); } // a ring travelling at the group speed
      return h;
    }
    vec3 sky(vec3 d){
      float s = max(dot(d, sun), 0.), y = max(d.y, 0.);
      vec3 c = ink * .004 + accent * (.035 * exp(-y * 9.) + .16 * exp(-y * 45.)) * (.06 + .94 * pow(s, 8.));
      c += accent * pow(s, 150.) * .35 + mix(accent, ink, .6) * smoothstep(.9994, .9998, s) * 3.;  // the disc, white-hot in its middle
      vec3 q = floor(d * 300.); float st = fract(sin(dot(q, vec3(12.9, 78.2, 37.7))) * 4e4);
      return c + ink * step(.9985, st) * smoothstep(.05, .5, d.y) * .4;
    }`

  // ── the sea: a 120×120 grid displaced by the long waves; every pixel's normal from all 28 (that is where the glitter is) ──
  const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 360, 360).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: u, fog: false,
    vertexShader: GLSL + `varying vec3 vW;
      void main(){ vec3 p = (modelMatrix * vec4(position, 1.)).xyz; p.y += sea(p.xz, ${NV}); vW = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: GLSL + `varying vec3 vW;
      void main(){
        float dist = length(vW - cameraPosition), e = .02 + dist * .004; int n = dist < 25. ? ${NW} : 16;
        vec3 nn = normalize(vec3(sea(vW.xz - vec2(e, 0.), n) - sea(vW.xz + vec2(e, 0.), n), 2. * e, sea(vW.xz - vec2(0., e), n) - sea(vW.xz + vec2(0., e), n)));
        nn = normalize(mix(nn, vec3(0., 1., 0.), smoothstep(20., 90., dist)));                  // far away it all averages flat
        vec3 v = normalize(vW - cameraPosition), r = reflect(v, nn); r.y = abs(r.y);
        float F = .02 + .98 * pow(1. - max(dot(-v, nn), 0.), 5.);
        vec3 c = sky(r) * F * .8 + accent * .01 * smoothstep(-.1, .5, vW.y) * max(dot(nn, sun), 0.); // reflected sky; a little light through the crests
        c += mix(accent, ink, .5) * pow(max(dot(r, sun), 0.), 2500.) * 6.;                     // glitter
        c = mix(c, sky(normalize(vec3(v.x, .002, v.z))), smoothstep(40., 70., dist));            // the horizon haze
        gl_FragColor = vec4(c, 1.);
      }`,
  }))
  water.frustumCulled = false
  const dome = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), new THREE.ShaderMaterial({ uniforms: u, side: THREE.BackSide, fog: false, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.); }`,
    fragmentShader: GLSL + `varying vec3 vD; void main(){ gl_FragColor = vec4(sky(normalize(vD)), 1.); }` }))
  dome.renderOrder = -1

  // ── the buoy: black glass, mirroring the same sky; it floats ──
  const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.38, 64, 32), new THREE.ShaderMaterial({ uniforms: u, fog: false,
    vertexShader: `varying vec3 vN, vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: GLSL + `varying vec3 vN, vW;
      void main(){ vec3 v = normalize(vW - cameraPosition), n = normalize(vN), r = reflect(v, n); float F = .05 + .95 * pow(1. - max(dot(-v, n), 0.), 5.);
        vec3 c = (r.y > 0. ? sky(r) : sky(vec3(r.x, -r.y, r.z)) * .06) * mix(.35, 1., F) + accent * .3 * pow(max(dot(r, sun), 0.), 400.);
        gl_FragColor = vec4(c, 1.); }` }))
  scene.add(dome, water, buoy)

  // the same sea, in JS, for the buoy to feel
  const seaJS = (x, z, t) => {
    let h = 0
    for (let i = 0; i < NV; i++) { const [dx, dz, k, a, n, o] = W[i]; h += a * u.wind.value * (Math.exp(Math.sin((dx * x + dz * z) * k - u.phase.value * TAU * n + o) - 1) * 2 - 0.74) }
    for (const r of u.rip.value) { const a = t - r.z; if (a < 0 || a > 9) continue; const d = Math.hypot(x - r.x, z - r.y); h += r.w * Math.exp(-a * 0.45) * Math.sin(d * 6 - a * 7.6) * Math.exp(-(((d - a * 0.62 - 0.3) * 1.3) ** 2)) / (1 + d) }
    return h
  }
  const B = { y: 0, vy: 0, px: 0, pz: 0, vx: 0, vz: 0 }, BX = 0.9, BZ = 1.2
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3()
  let ri = 0, now = 0, windT = 1, sunAz = 0.15, sunAlt = 0.05
  addEventListener('pointerdown', () => { ray.setFromCamera(pointer, camera); if (ray.ray.intersectPlane(plane, hit)) u.rip.value[ri++ % 4].set(hit.x, hit.z, now, 0.22) })
  addEventListener('wheel', e => (windT = THREE.MathUtils.clamp(windT - Math.sign(e.deltaY) * 0.15, 0.25, 2)), { passive: true })

  return (t, p) => {
    const dt = Math.min(1 / 30, Math.max(0, t - now)); now = t, (u.now.value = t)
    u.wind.value += (windT - u.wind.value) * 0.03
    if (pointer.active) (sunAz += (pointer.x * 0.9 - sunAz) * 0.04), (sunAlt += ((pointer.y * 0.5 + 0.5) * 0.35 - 0.02 - sunAlt) * 0.04)
    else (sunAz = 0.15 + Math.sin(p * TAU) * 0.05), (sunAlt = 0.05 + Math.sin(p * TAU) * 0.012)
    u.sun.value.set(Math.sin(sunAz) * Math.cos(sunAlt), Math.sin(sunAlt), -Math.cos(sunAz) * Math.cos(sunAlt))
    // buoyancy: four samples round the hull → heave and tilt, springy and damped
    const h0 = seaJS(BX + 0.3, BZ, t), h1 = seaJS(BX - 0.3, BZ, t), h2 = seaJS(BX, BZ + 0.3, t), h3 = seaJS(BX, BZ - 0.3, t), hm = (h0 + h1 + h2 + h3) / 4
    for (let s = 0; s < 4; s++) { const k = dt / 4; B.vy += ((hm - B.y) * 40 - B.vy * 5) * k, (B.y += B.vy * k) }
    B.vx += ((h1 - h0) / 0.6 * 0.9 - B.px) * 30 * dt - B.vx * 4 * dt, (B.vz += ((h2 - h3) / 0.6 * 0.9 - B.pz) * 30 * dt - B.vz * 4 * dt), (B.px += B.vx * dt), (B.pz += B.vz * dt)
    buoy.position.set(BX, B.y + 0.12, BZ), buoy.rotation.set(B.pz, 0, B.px)
  }
}, { loop: 20, blend: 1, eye: [0, 1.35, 7.5], drift: 0.25, bloom: 0.5, parallax: 0.3 })
