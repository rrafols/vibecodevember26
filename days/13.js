import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

// 13 — collision: two spiral galaxies, 262k stars, pass through each other. Each star feels only the two massive cores (the classic
// restricted model behind the first tidal-tail simulations); the cores orbit each other. Tails and bridges pull out of the discs.
// hover: your cursor is a mass of its own, stars stream towards it · hold: it grows heavy and tears the galaxies apart, release to
// slingshot the streams · double-click: a fresh collision · shift/right-drag: orbit · scroll: time
go('collision', ({ scene, camera, renderer }) => {
  const S = 512, LOOP = 20, EPS = 0.22, SUB = 3
  const gpu = new GPUComputationRenderer(S, S, renderer)
  const sim = { dt: { value: 1 / 60 / SUB }, c0: { value: new THREE.Vector3() }, c1: { value: new THREE.Vector3() }, c2: { value: new THREE.Vector4() }, reset: { value: 1 },
    init: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] } } // pos0, vel0, n0, pos1, vel1, n1
  const common = `
    uniform float dt, reset; uniform vec3 c0, c1, init[6]; uniform vec4 c2;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 acc(vec3 p){ vec3 a = c0 - p, b = c1 - p, c = c2.xyz - p; return a / pow(dot(a, a) + ${EPS * EPS}, 1.5) + b / pow(dot(b, b) + ${EPS * EPS}, 1.5) + c2.w * c / pow(dot(c, c) + .03, 1.5); } // + your hand
    void star(vec2 uv, out vec3 p, out vec3 v){           // a disc star: exponential-ish radius, circular orbit around its own core
      float g = step(.5, uv.y), r = .1 + 1.2 * pow(h(uv), 1.4), arm = floor(h(uv + 5.) * 2.) * 3.1416;
      float a = arm + log(r + .1) * 2.6 + (h(uv + 7.) - .5) * mix(.7, 6.2832, step(.8, h(uv + 9.))); // two spiral arms + a sprinkle of field stars
      vec3 n = normalize(init[2 + int(g) * 3]), e1 = normalize(cross(n, vec3(.3, .1, 1.))), e2 = cross(n, e1);
      vec3 rel = (e1 * cos(a) + e2 * sin(a)) * r + n * (h(uv + 3.) - .5) * .06 * (1. - r * .4);
      float vc = sqrt(r * r / pow(r * r + ${EPS * EPS}, 1.5));
      p = init[int(g) * 3] + rel, v = init[1 + int(g) * 3] + normalize(cross(n, rel)) * vc;
    }`
  const vV = gpu.addVariable('tVel', common + `void main(){ vec2 uv = gl_FragCoord.xy / resolution.xy; vec3 p, v;
    if (reset > 0.) { star(uv, p, v); gl_FragColor = vec4(v, 1.); return; }
    gl_FragColor = vec4(texture2D(tVel, uv).xyz + acc(texture2D(tPos, uv).xyz) * dt, 1.); }`, gpu.createTexture())
  const vP = gpu.addVariable('tPos', common + `void main(){ vec2 uv = gl_FragCoord.xy / resolution.xy; vec3 p, v;
    if (reset > 0.) { star(uv, p, v); gl_FragColor = vec4(p, 1.); return; }
    gl_FragColor = vec4(texture2D(tPos, uv).xyz + texture2D(tVel, uv).xyz * dt, 1.); }`, gpu.createTexture())
  gpu.setVariableDependencies(vV, [vV, vP]), gpu.setVariableDependencies(vP, [vP, vV])
  for (const v of [vV, vP]) Object.assign(v.material.uniforms, sim)
  const err = gpu.init(); if (err) throw new Error(err)

  // ── the cores: two equal masses, integrated here (symplectic), handed to the stars every substep ──
  const core = [{ p: new THREE.Vector3(), v: new THREE.Vector3() }, { p: new THREE.Vector3(), v: new THREE.Vector3() }], D = new THREE.Vector3()
  const launch = (p1, v1) => {
    const I = sim.init.value
    I[0].set(-2.1, 0, -1), I[1].set(0.2, 0, 0), I[2].set(0, 1, 0.12)       // galaxy A: face-up, prograde
    I[3].copy(p1), I[4].copy(v1), I[5].set(0.45, 0.85, 0.3)                     // galaxy B: tilted
    core[0].p.copy(I[0]), core[0].v.copy(I[1]), core[1].p.copy(I[3]), core[1].v.copy(I[4]), (sim.reset.value = 1)
  }
  const coreStep = dt => {
    D.subVectors(core[1].p, core[0].p); const r2 = D.lengthSq() + EPS * EPS, f = 1 / (r2 * Math.sqrt(r2))
    core[0].v.addScaledVector(D, f * dt), core[1].v.addScaledVector(D, -f * dt)
    const w = sim.c2.value; if (w.w > 0) for (const c of core) { D.set(w.x, w.y, w.z).sub(c.p); const q = D.lengthSq() + 0.05; c.v.addScaledVector(D, (w.w / (q * Math.sqrt(q))) * dt) } // the cores feel it too
    core[0].p.addScaledVector(core[0].v, dt), core[1].p.addScaledVector(core[1].v, dt)
  }

  // ── stars: tiny additive points, bone in the dense discs, ember out in the tails ──
  const ref = new Float32Array(S * S * 3); for (let i = 0; i < S * S; i++) ref.set([((i % S) + 0.5) / S, (((i / S) | 0) + 0.5) / S, 0], i * 3)
  const su = { ...U, tPos: { value: null }, c0: sim.c0, c1: sim.c1, life: { value: 1 } }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ref, 3)), new THREE.ShaderMaterial({
    uniforms: su, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform sampler2D tPos; uniform vec3 c0, c1, ink, accent; uniform vec2 res; uniform float life; varying vec3 vC;
      void main(){
        vec3 p = texture2D(tPos, position.xy).xyz; float d = min(length(p - c0), length(p - c1));
        vC = mix(ink * 1.3, accent * .9, smoothstep(.35, 1.6, d)) * (.05 + .1 * fract(position.x * 977.3)) * life; // core bone, tails ember
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = res.y / 1080. * 2.; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vC; void main(){ float l = 1. - length(gl_PointCoord - .5) * 2.; if (l < 0.) discard; gl_FragColor = vec4(vC * l, 1.); }`,
  }))
  stars.frustumCulled = false
  const glow = document.createElement('canvas').getContext('2d'), gg = glow.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.canvas.width = glow.canvas.height = 64, gg.addColorStop(0, 'rgba(255,240,225,1)'), gg.addColorStop(0.15, 'rgba(255,190,150,.4)'), gg.addColorStop(1, 'rgba(255,90,40,0)'), (glow.fillStyle = gg), glow.fillRect(0, 0, 64, 64)
  const bulges = [0, 1].map(() => new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow.canvas), blending: THREE.AdditiveBlending, depthTest: false, transparent: true })))
  const well = new THREE.Sprite(new THREE.SpriteMaterial({ map: bulges[0].material.map, blending: THREE.AdditiveBlending, depthTest: false, transparent: true, opacity: 0 }))
  const sky = new THREE.Group().add(stars, ...bulges, well)
  scene.add(sky)

  // ── interaction ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), a0 = new THREE.Vector3(), a1 = new THREE.Vector3()
  let down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0, speed = 1, cycle = -1, start = 0, mine = false
  const onPlane = out => (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, out) ? sky.worldToLocal(out) : null)
  addEventListener('contextmenu', e => e.preventDefault())
  addEventListener('pointerdown', e => ((down = { orbit: e.button === 2 || e.shiftKey }), (lx = pointer.x), (ly = pointer.y), down.orbit || (mine = true)))
  addEventListener('pointermove', () => {
    if (down?.orbit) (vy = (pointer.x - lx) * 3), (vp = -(pointer.y - ly) * 2), (yaw += vy), (pitch = THREE.MathUtils.clamp(pitch + vp, -0.6, 0.9))
    lx = pointer.x, ly = pointer.y
  })
  addEventListener('pointerup', () => (down = null))
  addEventListener('dblclick', () => (launch(new THREE.Vector3(2.1, 0.15, 1), new THREE.Vector3(-0.2, 0, 0)), (start = -1), (mine = true), stars.position.set(0, 0, 0)))
  addEventListener('wheel', e => (speed = THREE.MathUtils.clamp(speed * Math.exp(-e.deltaY * 0.001), 0.2, 3)), { passive: true })

  return (t, p) => {
    if (Math.floor(t / LOOP) !== cycle && !mine) (cycle = Math.floor(t / LOOP)), launch(new THREE.Vector3(2.1, 0.15, 1), new THREE.Vector3(-0.2, 0, 0)), (start = t)
    if (start < 0) start = t
    const W = sim.c2.value, held = down && !down.orbit                             // your mass: light while hovering, heavy while held
    if (pointer.active && onPlane(a0)) a0.sub(stars.position), W.set(a0.x, 0, a0.z, W.w + ((held ? 1.6 : 0.22) - W.w) * (held ? 0.04 : 0.1))
    else W.w *= 0.9
    well.position.set(W.x, 0, W.z).add(stars.position), well.scale.setScalar(0.25 + W.w * 0.35), (well.material.opacity = Math.min(1, W.w * 1.5))
    const dt = (1 / 60 / SUB) * speed * 1.6
    sim.dt.value = dt
    for (let i = 0; i < SUB; i++) coreStep(dt), sim.c0.value.copy(core[0].p), sim.c1.value.copy(core[1].p), gpu.compute(), (sim.reset.value = 0)
    su.tPos.value = gpu.getCurrentRenderTarget(vP).texture
    bulges.forEach((b, i) => (b.position.copy(core[i].p), b.scale.setScalar(0.55)))
    if (!held) stars.position.lerp(D.addVectors(core[0].p, core[1].p).multiplyScalar(-0.5), 0.05) // follow the pair (not while you're pulling)
    bulges.forEach(b => b.position.add(stars.position))
    if (!down?.orbit) (yaw += vy *= 0.93), (pitch += vp *= 0.93)
    sky.rotation.set(pitch, yaw + Math.sin(p * TAU) * 0.25, 0)
    const age = t - start, left = mine ? 99 : LOOP - (t % LOOP)
    su.life.value = Math.min(1, age / 1) * Math.min(1, left / 1.5) // fade in from the launch, out before the wrap → seamless
    bulges.forEach(b => (b.material.opacity = su.life.value))
  }
}, { loop: 20, eye: [0, 5.6, 10.4], drift: 0.4, bloom: 0.8 })
