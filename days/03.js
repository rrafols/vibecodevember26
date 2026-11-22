import { go, THREE, U, R, TAU, noise, pointer } from '../lib/stage.js'

// 03 — filament: 3000 hairline fibres braided round a knot that morphs trefoil → (3,5) → cinquefoil.
// The rope breathes, sheds embers, gets plucked and unravels on its own.
// move: comb the silk · click: pluck the nearest point · hold: unravel
go('filament', ({ scene, camera }) => {
  const KN = [[2, 3], [3, 5], [2, 5]], LOOP = 18

  // ── one knot function, mirrored in JS (for picking) and GLSL (for drawing) ──
  const V = new THREE.Vector3()
  const knot = (t, P, out = new THREE.Vector3()) => {
    const w = KN.map((_, i) => (0.5 + 0.5 * Math.cos(P - (i * TAU) / 3)) ** 4), s = w[0] + w[1] + w[2]
    out.set(0, 0, 0)
    KN.forEach(([p, q], i) => out.addScaledVector(V.set((2 + Math.cos(q * t)) * Math.cos(p * t), (2 + Math.cos(q * t)) * Math.sin(p * t), Math.sin(q * t) * 1.2), (w[i] / s) * 0.62))
    return out
  }
  const glsl = noise + `
    uniform float phase, unr, curOn; uniform vec3 cur, pl[6];
    vec3 tk(float t, float p, float q){ return vec3((2. + cos(q * t)) * cos(p * t), (2. + cos(q * t)) * sin(p * t), sin(q * t) * 1.2); }
    vec3 knot(float t){
      vec3 w = pow(.5 + .5 * cos(phase * 6.2832 - vec3(0., 2.0944, 4.1888)), vec3(4.)); w /= w.x + w.y + w.z;
      return (tk(t, 2., 3.) * w.x + tk(t, 3., 5.) * w.y + tk(t, 2., 5.) * w.z) * .62;
    }
    void frame(float t, out vec3 c, out vec3 N, out vec3 B){ c = knot(t); vec3 T = normalize(knot(t + .01) - c); N = normalize(cross(T, normalize(c))); B = cross(T, N); }
    float pluck(float t, out float glow){                     // vibration rings racing both ways from each pluck
      float d = 0.; glow = 0.;
      for (int i = 0; i < 6; i++) {
        vec3 k = pl[i]; if (k.z <= 0.) continue;
        float dt = abs(mod(t - k.x + 3.1416, 6.2832) - 3.1416), e = k.z * exp(-k.y * .7) * exp(-pow((dt - k.y * 1.8) * 2.5, 2.));
        d += e * sin(k.y * 30. - dt * 12.);
        glow += e + .4 * k.z * exp(-k.y * 3.) * exp(-dt * dt * 30.);
      }
      return d;
    }
    vec3 comb(vec3 w, out float h){ vec3 v = w - cur; h = curOn * exp(-dot(v, v) / .5); return w + normalize(v + 1e-4) * h * .8; }
    float unravel(){ return max(unr, .6 * pow(max(0., sin(phase * 12.5664 + 1.)), 10.)); } // twice per loop on its own
  `
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }
  const u = { ...U, unr: { value: 0 }, curOn: { value: 0 }, cur: { value: new THREE.Vector3() }, pl: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) } }

  // ── fibres: one LineSegments, everything positioned on the GPU ──
  const F = 3000, S = 480, fp = new Float32Array(F * S * 3), fk = new Float32Array(F * S), idx = new Uint32Array(F * S * 2)
  for (let f = 0; f < F; f++) {
    const a = R(TAU), r = Math.sqrt(R()) * 0.2, k = R() < 0.035 ? R(1, 2) : 0 // 3.5% of fibres carry a spark
    for (let s = 0, v = f * S; s < S; s++, v++) fp.set([s / S, a, r], v * 3), (fk[v] = k), idx.set([v, s < S - 1 ? v + 1 : f * S], v * 2)
  }
  const fibres = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(fp, 3)).setAttribute('k', new THREE.BufferAttribute(fk, 1)).setIndex(new THREE.BufferAttribute(idx, 1)),
    new THREE.ShaderMaterial({
      uniforms: u, ...add,
      vertexShader: glsl + `
        attribute float k; varying float vS, vF, vH;
        void main(){
          float t = position.x * 6.2832, P = phase * 6.2832, un = unravel(), g, h; vec3 c, N, B;
          frame(t, c, N, B);
          vec3 o = vec3(cos(P), sin(P), 0.) * .7;                               // circle through noise space = perfect loop
          float a = position.y + t * 3. + snoise(c * .9 + o) * (.7 + un * 2.5); // fibres twist round the rope
          float d = pluck(t, g);
          float r = position.z * (1. + 1.6 * smoothstep(-.2, 1., snoise(c * .7 - o))) * (1. + un * (3. + 5. * fract(position.y * 7.13))) + d * .3;
          vec3 dir = N * cos(a) + B * sin(a);
          vec4 w = modelMatrix * vec4(c + dir * r, 1.);
          w.xyz = comb(w.xyz, h);
          vec4 mv = viewMatrix * w;
          float s = fract((k > 1.5 ? -1. : 1.) * (position.x - phase * 3.) + k); // sparks, some running backwards
          vS = k > 0. ? pow(s, 60.) : 0.;
          vH = min(g * 1.5 + h, 2.);
          vF = (.5 + .5 * normalize(mat3(viewMatrix) * mat3(modelMatrix) * dir).z) * smoothstep(14., 8.5, -mv.z) * (1. - .45 * un); // front + depth fade, dimmer when spread out
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 ink, accent; varying float vS, vF, vH;
        void main(){ gl_FragColor = vec4(ink * .0022 * (.15 + vF) + accent * vH * .0045 * (.3 + vF) + mix(accent * 2.5, ink * 5., pow(vS, 3.)) * vS, 1.); }`,
    }),
  )

  // ── embers shed from the rope surface, drifting off on noise ──
  const E = 2000, ep = new Float32Array(Array.from({ length: E * 3 }, () => R()))
  const embers = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ep, 3)),
    new THREE.ShaderMaterial({
      uniforms: u, ...add,
      vertexShader: glsl + `
        uniform vec2 res; varying float vB, vW;
        void main(){
          float t = position.x * 6.2832, q = fract(phase * 3. + position.z), g, h; vec3 c, N, B;  // q: 0→1 life, wraps = seamless
          frame(t, c, N, B);
          vec3 o = vec3(cos(phase * 6.2832), sin(phase * 6.2832), 0.) * .7, n = c * 1.5 + o + q;
          vec3 p = c + (N * cos(position.y * 6.2832) + B * sin(position.y * 6.2832)) * (.2 + q * 1.4 * (1. + unravel())) + vec3(snoise(n), snoise(n + 3.), snoise(n + 7.)) * q * .7;
          pluck(t, g);
          vec4 w = modelMatrix * vec4(p, 1.); w.xyz = comb(w.xyz, h);
          vec4 mv = viewMatrix * w;
          vB = smoothstep(0., .06, q) * pow(1. - q, 2.) * (.12 + g * .4 + h * .6);
          vW = step(.93, fract(position.z * 91.7));                                    // a few burn white
          gl_PointSize = (1. + 2. * fract(position.y * 53.3)) * res.y / -mv.z * .0035;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 ink, accent; varying float vB, vW;
        void main(){ float l = 1. - length(gl_PointCoord - .5) * 2.; if (l < 0.) discard; gl_FragColor = vec4(mix(accent * 1.5, ink * 3., vW) * vB * l * l, 1.); }`,
    }),
  )
  const rope = new THREE.Group().add(fibres, embers)
  fibres.frustumCulled = embers.frustumCulled = false
  scene.add(rope)

  // ── interaction ──
  const auto = [0.08, 0.41, 0.74].map(at => ({ t: R(TAU), at })), mine = [], ray = new THREE.Raycaster(), plane = new THREE.Plane(), C = new THREE.Vector3()
  let now = 0, P = 0, down = -1
  addEventListener('pointerdown', () => (down = now))
  addEventListener('pointerup', () => {
    if (down >= 0 && now - down < 0.25) { // short click → pluck the point on the rope nearest the cursor
      let best = 0, bd = 1e9
      for (let i = 0; i < 256; i++) {
        const t = (i / 256) * TAU, d = knot(t, P, C).applyMatrix4(rope.matrixWorld).project(camera).sub(V.set(pointer.x, pointer.y, C.z)).lengthSq()
        if (d < bd) (bd = d), (best = t)
      }
      mine.push({ t: best, at: now }), mine.length > 3 && mine.shift()
    }
    down = -1
  })

  return (t, p) => {
    now = t, (P = p * TAU)
    rope.rotation.set(0.35 + Math.sin(P) * 0.15, Math.sin(P) * 0.3, Math.sin(P) * 0.5)
    rope.updateMatrixWorld()
    auto.forEach((a, i) => u.pl.value[i].set(a.t, ((p - a.at + 1) % 1) * LOOP, 0.8))
    for (let i = 0; i < 3; i++) mine[i] ? u.pl.value[3 + i].set(mine[i].t, t - mine[i].at, 1.3) : u.pl.value[3 + i].set(0, 0, 0)
    u.unr.value += ((down >= 0 && t - down > 0.25 ? 1 : 0) - u.unr.value) * 0.05
    if (pointer.active) {
      ray.setFromCamera(pointer, camera)
      ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(C), V.set(0, 0, 0)), u.cur.value)
      u.curOn.value += (1 - u.curOn.value) * 0.05
    }
  }
}, { loop: 18, bloom: 0.55 })
