import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

// 10 — phase space: four strange attractors (Lorenz, Thomas, Aizawa, Halvorsen) traced by 410k particles on the GPU. The equations
// themselves are blended, so the cloud physically flows from one sculpture into the next. Streaks glow ember when slow, white when fast.
// hover: a disturbance that blasts particles off the attractor (watch chaos pull them back) · click: morph to the next one
// drag: turn it · scroll: slow time down or speed it up
go('phase space', ({ scene, camera, renderer }) => {
  const S = 640, N = S * S, LOOP = 24, HOLD = 4, MORPH = 2
  // world ↔ native coordinates for each attractor: scale, offset (native), time scale; Lorenz and Aizawa stood upright (native z → world y)
  const field = `
    uniform int fa, fb; uniform float k;
    vec3 att(int i, vec3 w){
      if (i == 0) { vec3 x = vec3(w.x, w.z, w.y) / .062 + vec3(0., 0., 25.);
        vec3 f = vec3(10. * (x.y - x.x), x.x * (28. - x.z) - x.y, x.x * x.y - 2.6667 * x.z); return vec3(f.x, f.z, f.y) * .062 * .22; }
      if (i == 1) { vec3 x = w / .34; vec3 f = vec3(sin(x.y) - .19 * x.x, sin(x.z) - .19 * x.y, sin(x.x) - .19 * x.z); return f * .34 * 1.7; }
      if (i == 2) { vec3 x = vec3(w.x, w.z, w.y) / .95 + vec3(0., 0., .7);
        vec3 f = vec3((x.z - .7) * x.x - 3.5 * x.y, 3.5 * x.x + (x.z - .7) * x.y, .6 + .95 * x.z - x.z * x.z * x.z / 3. - (x.x * x.x + x.y * x.y) * (1. + .25 * x.z) + .1 * x.z * x.x * x.x * x.x);
        return vec3(f.x, f.z, f.y) * .95 * .6; }
      vec3 x = w / .14 + vec3(-2.); vec3 f = vec3(-1.89 * x.x - 4. * x.y - 4. * x.z - x.y * x.y, -1.89 * x.y - 4. * x.z - 4. * x.x - x.z * x.z, -1.89 * x.z - 4. * x.x - 4. * x.y - x.x * x.x);
      return f * .14 * .35;
    }
    vec3 flow(vec3 w){ return mix(att(fa, w), att(fb, w), k); }  // the equations, blended`
  const gpu = new GPUComputationRenderer(S, S, renderer), p0 = gpu.createTexture()
  for (let i = 0; i < N; i++) p0.image.data.set([R(-1, 1), R(-1, 1), R(-1, 1), R(0.5, 4)], i * 4)
  const sim = { fa: { value: 0 }, fb: { value: 0 }, k: { value: 0 }, dt: { value: 1 / 120 }, seed: { value: 0 }, well: { value: new THREE.Vector4() } }
  const vP = gpu.addVariable('tPos', field + `
    uniform float dt, seed; uniform vec4 well;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy; vec4 s = texture2D(tPos, uv); vec3 p = s.xyz;
      vec3 v1 = flow(p), v2 = flow(p + v1 * dt * .5), v = v2;                          // RK2
      vec3 o = p - well.xyz; v += normalize(o + 1e-5) * well.w * 9. * exp(-dot(o, o) / .12); // the disturbance
      p += v * dt, s.w -= dt;
      if (s.w < 0. || dot(p, p) > 16. || p != p) {                                       // expired or flung out: respawn on the structure
        vec2 r = vec2(h(uv + seed), h(uv * 1.7 - seed));
        p = texture2D(tPos, r).xyz + (vec3(h(r + 1.), h(r + 2.), h(r + 3.)) - .5) * .02, s.w = .8 + 3.2 * h(r + 4.);
      }
      gl_FragColor = vec4(p, s.w);
    }`, p0)
  gpu.setVariableDependencies(vP, [vP]), Object.assign(vP.material.uniforms, sim)
  const err = gpu.init(); if (err) throw new Error(err)

  // ── streaks: one short segment per particle along its flow ──
  const ref = new Float32Array(N * 2 * 3)
  for (let i = 0; i < N; i++) for (let e = 0; e < 2; e++) ref.set([((i % S) + 0.5) / S, (((i / S) | 0) + 0.5) / S, e], (i * 2 + e) * 3)
  const u = { ...U, tPos: { value: null }, fa: sim.fa, fb: sim.fb, k: sim.k }
  const streaks = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ref, 3)), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: field + `
      uniform sampler2D tPos; uniform vec3 ink, accent; varying vec3 vC;
      void main(){
        vec4 s = texture2D(tPos, position.xy); vec3 v = flow(s.xyz); float sp = length(v);
        vec3 p = s.xyz - v * position.z * .045;
        vC = mix(accent * .8, ink * 1.4, smoothstep(1.4, 3.6, sp)) * (1. - position.z * .9) * smoothstep(0., .4, s.w) * .022;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.); }`,
  }))
  streaks.frustumCulled = false
  const sculpture = new THREE.Group().add(streaks)
  scene.add(sculpture)

  const step = n => { for (let i = 0; i < n; i++) (sim.seed.value = R(100)), gpu.compute(); u.tPos.value = gpu.getCurrentRenderTarget(vP).texture }
  step(240) // settle onto the first attractor

  // ── schedule: hold, then morph to the next; a click jumps straight to the next morph ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), O = new THREE.Vector3()
  let offset = 0, now = 0, speed = 1, yaw = 0, pitch = 0, vy = 0, vp = 0, down = null, lx = 0, ly = 0
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => {
    if (!down) return
    down.moved += Math.hypot(pointer.x - lx, pointer.y - ly)
    if (down.moved > 0.02) (vy = (pointer.x - lx) * 3), (vp = -(pointer.y - ly) * 2), (yaw += vy), (pitch += vp)
    lx = pointer.x, ly = pointer.y
  })
  addEventListener('pointerup', () => { if (down && down.moved < 0.02) { const st = (now + offset) % (HOLD + MORPH); offset += HOLD - st + (st > HOLD ? HOLD + MORPH : 0) } down = null })
  addEventListener('wheel', e => (speed = THREE.MathUtils.clamp(speed * Math.exp(-e.deltaY * 0.001), 0.15, 2.5)), { passive: true })

  return (t, p) => {
    now = t
    const ts = t + offset, seg = Math.floor(ts / (HOLD + MORPH)), st = ts - seg * (HOLD + MORPH)
    sim.fa.value = seg % 4, (sim.fb.value = (seg + 1) % 4), (sim.k.value = THREE.MathUtils.smoothstep(st, HOLD, HOLD + MORPH))
    sim.dt.value = speed / 120
    if (!down) (yaw += vy *= 0.93), (pitch += vp *= 0.93)
    sculpture.rotation.set(0.25 + Math.sin(p * TAU * 2) * 0.08 + pitch, p * TAU + yaw, 0) // one full turn per loop
    const W = sim.well.value
    if (pointer.active && !down) {
      ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(hit), O), hit)
      const l = sculpture.worldToLocal(hit.clone())
      W.set(l.x, l.y, l.z, W.w + (1 - W.w) * 0.1)
    } else W.w *= 0.9
    step(2)
  }
}, { loop: 24, blend: 2, eye: [0, 0, 6.4], drift: 0.4, bloom: 0.75 })
