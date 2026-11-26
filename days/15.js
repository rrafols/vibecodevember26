import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

// 15 — grindstone: a steel bar pressed against a spinning wheel. 65k sparks on the GPU leave the contact point along the rim's
// tangent, arc under gravity, skip across a wet black floor that mirrors them, and the carbon in some of them bursts into
// little stars mid-flight: every burst spawns real child sparks from where its parent is. The sparks light the wheel and the floor.
// hover: slide the bar round the wheel, the spray follows the tangent · hold: lean on it, hotter and denser · scroll: wheel speed
go('grindstone', ({ scene, camera, renderer }) => {
  const S = 256, RP = 64, LOOP = 12, RAD = 1, FLOOR = -1.1, DT = 1 / 60, MIN = -0.6, MAX = 2
  const gpu = new GPUComputationRenderer(S, S, renderer), p0 = gpu.createTexture(), v0 = gpu.createTexture()
  for (let i = 0; i < S * S; i++) p0.image.data.set([0, -9, 0, 1], i * 4), v0.image.data.set([0, 0, 0, 0], i * 4) // all dead: age 1 > life 0
  const sim = { time: { value: 0 }, rate: { value: 0 }, speed: { value: 1 }, burst: { value: 0.3 }, src: { value: new THREE.Vector3() }, dir: { value: new THREE.Vector3() }, side: { value: new THREE.Vector3() } }
  const step = `
    uniform float time, rate, speed, burst; uniform vec3 src, dir, side;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    bool alive(vec4 P, vec4 V){ return P.w < V.w; }
    void move(inout vec4 P, inout vec4 V){                  // gravity, air drag, and skipping across the floor
      V.xyz += vec3(0., -7., 0.) * ${DT}; V.xyz *= ${Math.exp(-0.9 * DT)};
      P.xyz += V.xyz * ${DT}; P.w += ${DT};
      if (P.y < ${FLOOR} && V.y < 0.) P.y = ${FLOOR}, V.y *= -.32, V.xz *= .62;
    }
    void tick(out vec4 P, out vec4 V){
      vec2 uv = gl_FragCoord.xy / resolution.xy; P = texture2D(tPos, uv); V = texture2D(tVel, uv);
      float a = h(uv + time), b = h(uv * 1.7 - time), c = h(uv * 2.3 + time * .7);
      if (gl_FragCoord.y < ${RP}.) {                        // primaries: thrown off the rim
        if (alive(P, V)) { move(P, V); return; }
        if (a > rate) return;                               // waiting for its turn
        vec3 n = cross(side, dir); float f = (b - .5) * .7;
        vec3 d = normalize(dir * cos(f) + n * sin(f) + side * (c - .5) * .5);
        P = vec4(src + d * .02, 0.), V = vec4(d * mix(2.4, 7.5, b * b) * speed, mix(.5, 1.9, c * c));
        return;
      }
      float k = (floor(gl_FragCoord.y) - ${RP}.) * ${S}. + floor(gl_FragCoord.x), par = floor(k / 3.);
      vec2 pu = (vec2(mod(par, ${S}.), floor(par / ${S}.)) + .5) / ${S}.;
      vec4 PP = texture2D(tPos, pu), PV = texture2D(tVel, pu);
      float at = PV.w * mix(.25, .8, h(pu * 1.3 + PV.w));      // children: carbon bursts, born where the parent is when it pops
      if (alive(PP, PV) && h(pu + PV.w) < burst && PP.w < at && PP.w + ${DT} >= at) {
        vec3 d = normalize(vec3(a, b, c) - .5 + 1e-4);
        P = vec4(PP.xyz, 0.), V = vec4(PV.xyz * .3 + d * mix(1.2, 3.2, h(uv - time)), mix(.12, .38, h(uv + PV.w)));
        return;
      }
      if (alive(P, V)) move(P, V);
    }`
  const vP = gpu.addVariable('tPos', step + `void main(){ vec4 P, V; tick(P, V); gl_FragColor = P; }`, p0)
  const vV = gpu.addVariable('tVel', step + `void main(){ vec4 P, V; tick(P, V); gl_FragColor = V; }`, v0)
  for (const v of [vP, vV]) gpu.setVariableDependencies(v, [vP, vV]), Object.assign(v.material.uniforms, sim)
  const err = gpu.init(); if (err) throw new Error(err)

  // ── sparks: each a short screen-space streak from where it is to where it was, white-hot cooling to ember ──
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3)), quad.setIndex([0, 2, 1, 2, 3, 1])
  const ref = new Float32Array(S * S * 2); for (let i = 0; i < S * S; i++) ref.set([((i % S) + 0.5) / S, (((i / S) | 0) + 0.5) / S], i * 2)
  quad.setAttribute('ref', new THREE.InstancedBufferAttribute(ref, 2)), (quad.instanceCount = S * S)
  const tex = { tPos: { value: null }, tVel: { value: null } }
  const sparks = mirror => {
    const m = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      uniforms: { ...U, ...tex }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform sampler2D tPos, tVel; uniform vec2 res; attribute vec2 ref; varying float vT, vA, vS, vK;
        vec3 m(vec3 p){ ${mirror ? `p.y = ${2 * FLOOR} - p.y;` : ''} return p; }
        void main(){
          vec4 P = texture2D(tPos, ref), V = texture2D(tVel, ref);
          if (P.w >= V.w) { gl_Position = vec4(2., 2., 2., 1.); return; }
          vK = step(${RP / S}, ref.y); vT = 1. - P.w / V.w; vA = position.x; vS = position.y;
          vec3 head = m(P.xyz), tail = m(P.xyz - V.xyz * .045);
          vec4 a = projectionMatrix * viewMatrix * vec4(head, 1.), b = projectionMatrix * viewMatrix * vec4(tail, 1.);
          vec2 asp = vec2(res.x / res.y, 1.), d = (b.xy / b.w - a.xy / a.w) * asp; d = length(d) > 1e-5 ? normalize(d) : vec2(1., 0.);
          vec4 c = mix(a, b, position.x);
          float w = (vK > .5 ? .9 : 1.3) * (.5 + vT) * 2. / res.y * res.y / 1080.;
          c.xy += (vec2(-d.y, d.x) * position.y - d * (1. - position.x) * .6) * w * c.w / asp;   // thickness, and a rounded head
          gl_Position = c;
        }`,
      fragmentShader: `uniform vec3 ink, accent; varying float vT, vA, vS, vK;
        void main(){
          float T = clamp(vT, 0., 1.); T = vK > .5 ? T * T : T; float hot = pow(T, 4.) * (vK > .5 ? 1.6 : .9);
          vec3 c = accent * (.12 + .55 * T) + ink * hot;
          gl_FragColor = vec4(c * pow(clamp(1. - vA, 0., 1.), 1.4) * max(1. - vS * vS, 0.) * (.15 + .85 * T) * ${mirror ? '.3' : '1.'}, 1.);
        }`,
    }))
    return (m.frustumCulled = false), m
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, '#fff'), r.addColorStop(0.2, 'rgba(255,255,255,.35)'), r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r, g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c) })()

  // ── the wheel: grit, rings and a few marks so the spin reads; the bar; an axle back into the dark ──
  const face = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d')
    g.fillStyle = '#1c1a18', g.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 40; i++) (g.strokeStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R(0.02, 0.08)})`), (g.lineWidth = R(1, 6)), g.beginPath(), g.arc(256, 256, R(40, 256), 0, TAU), g.stroke()
    for (let i = 0; i < 9000; i++) (g.fillStyle = `rgba(255,255,255,${R(0.03, 0.14)})`), g.fillRect(R(512), R(512), 1.2, 1.2)
    for (let i = 0; i < 5; i++) (g.strokeStyle = 'rgba(255,255,255,.1)'), (g.lineWidth = 3), g.beginPath(), g.moveTo(256, 256), g.lineTo(256 + Math.cos(i * 1.3) * 250, 256 + Math.sin(i * 1.3) * 250), g.stroke()
    g.fillStyle = '#0c0b0b', g.beginPath(), g.arc(256, 256, 54, 0, TAU), g.fill()
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  })()
  const stone = new THREE.MeshStandardMaterial({ map: face, roughness: 0.95 }), steel = new THREE.MeshStandardMaterial({ color: 0x55555c, metalness: 0.9, roughness: 0.3 })
  const make = () => {
    const rig = new THREE.Group(), spinner = new THREE.Group(), wheel = new THREE.Mesh(new THREE.CylinderGeometry(RAD, RAD, 0.2, 128), stone)
    wheel.rotation.x = Math.PI / 2, spinner.add(wheel)
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 16).rotateX(Math.PI / 2).translate(0, 0, -2), steel)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12).translate(0.75, 0, 0), steel)
    rig.add(spinner, axle, bar), rig.position.set(-1, 0.3, 0), (rig.rotation.y = -0.5)
    return { rig, spinner, bar }
  }
  const A = make(), B = make(), under = new THREE.Group().add(B.rig), mirrored = sparks(true) // the reflection: the rig flipped under the floor (sparks flip in their shader)
  under.scale.y = -1, (under.position.y = 2 * FLOOR)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.45, metalness: 0.4, transparent: true, opacity: 0.8 }))
  floor.position.y = FLOOR, (floor.renderOrder = 1), (mirrored.renderOrder = 0)
  const live = sparks(false); live.renderOrder = 2
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: U.ink.value, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: U.accent.value, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  core.renderOrder = halo.renderOrder = 3
  const light = new THREE.PointLight(U.accent.value, 0, 9, 1.6)
  scene.add(A.rig, under, mirrored, floor, live, core, halo, light)

  // ── interaction ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), Z = new THREE.Vector3(), L = new THREE.Vector3()
  let held = false, rpm = 1, rpmT = 1, theta = 0.7, press = 0.5, heat = 0, spin = 0
  addEventListener('pointerdown', () => (held = true)), addEventListener('pointerup', () => (held = false))
  addEventListener('wheel', e => (rpmT = THREE.MathUtils.clamp(rpmT - Math.sign(e.deltaY) * 0.15, 0.35, 1.8)), { passive: true })

  return (t, p) => {
    let thT = 0.7 + 0.6 * Math.sin(p * TAU) + 0.25 * Math.sin(p * TAU * 2 + 1)                     // on its own: wander the rim
    let prT = 0.2 + 0.8 * THREE.MathUtils.smoothstep(Math.sin(p * TAU * 3), -0.3, 0.7)               // and lean in three times a loop
    A.rig.updateMatrixWorld(), Z.set(0, 0, 1).transformDirection(A.rig.matrixWorld)
    if (pointer.active) {
      ray.setFromCamera(pointer, camera), plane.setFromNormalAndCoplanarPoint(Z, A.rig.position)
      if (ray.ray.intersectPlane(plane, hit)) { A.rig.worldToLocal(hit); const a = Math.atan2(hit.y, hit.x); thT = THREE.MathUtils.clamp(a < -2.4 ? MAX : a, MIN, MAX) }
      prT = held ? 1 : 0.35
    }
    theta += (thT - theta) * 0.08, (press += (prT - press) * 0.1), (rpm += (rpmT - rpm) * 0.05)
    heat += ((held ? 1 : press * 0.6) - heat) * (held ? 0.01 : 0.03)                              // leaning on it heats the bar
    spin -= rpm * 0.35
    for (const X of [A, B]) X.spinner.rotation.z = spin, X.bar.position.set(Math.cos(theta) * RAD, Math.sin(theta) * RAD, 0), (X.bar.rotation.z = theta)

    // the contact point and the rim's direction there (the wheel turns clockwise as we see it)
    sim.src.value.set(Math.cos(theta) * RAD, Math.sin(theta) * RAD, 0).applyMatrix4(A.rig.matrixWorld)
    sim.dir.value.set(Math.sin(theta), -Math.cos(theta), 0).transformDirection(A.rig.matrixWorld), sim.side.value.copy(Z)
    sim.rate.value = press * press * 0.0025 * rpm, (sim.speed.value = (0.65 + 0.45 * press + 0.2 * heat) * Math.sqrt(rpm)), (sim.burst.value = 0.15 + 0.4 * press + 0.2 * heat)
    sim.time.value = t % 97, gpu.compute()
    tex.tPos.value = gpu.getCurrentRenderTarget(vP).texture, (tex.tVel.value = gpu.getCurrentRenderTarget(vV).texture)

    const fl = 0.85 + 0.15 * Math.sin(t * 53) * Math.sin(t * 31), g = press * fl
    L.copy(sim.src.value).addScaledVector(sim.dir.value, 0.25)
    core.position.copy(sim.src.value), halo.position.copy(sim.src.value), light.position.copy(L)
    core.scale.setScalar(0.06 + 0.14 * g + 0.06 * heat), halo.scale.setScalar(0.35 + 0.6 * g), (halo.material.opacity = 0.12 + 0.3 * g)
    light.intensity = (1 + 7 * g) * (0.8 + 0.4 * heat)
  }
}, { loop: 12, blend: 2, eye: [0, 1.1, 7.6], drift: 0.35, bloom: 0.75, parallax: 0.4 })
