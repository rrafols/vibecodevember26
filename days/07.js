import { go, THREE, U, R, noise, pointer } from '../lib/stage.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

// 07 — murmuration: 32k starlings simulated on the GPU, black against a low ember dusk. The flock folds into sheets, swirls
// around a drifting centre and ripples with turning waves.
// move: you are a falcon, the flock parts around you · click: startle it · hold: dive
go('murmuration', ({ scene, camera, renderer }) => {
  const W = 256, H = 128, N = W * H, LOOP = 16
  const gpu = new GPUComputationRenderer(W, H, renderer), p0 = gpu.createTexture(), v0 = gpu.createTexture()
  for (let i = 0; i < N; i++) p0.image.data.set([R(-3, 3), R(-1.2, 1.6), R(-2, 2), R()], i * 4), v0.image.data.set([R(-1, 1), R(-0.2, 0.2), R(-1, 1), 0], i * 4)
  const sim = { time: { value: 0 }, dt: { value: 1 / 60 }, pred: { value: new THREE.Vector4(0, 0, 0, 0) }, shock: { value: new THREE.Vector4(0, 0, 0, 99) } }

  const vVel = gpu.addVariable('tVel', noise + `
    uniform float time, dt; uniform vec4 pred, shock;
    vec3 F(vec3 p){ return vec3(snoise(p), snoise(p + 31.4), snoise(p + 57.2)); }
    vec3 curl(vec3 p){                                  // divergence-free turbulence: the flock swirls instead of bunching up
      const float e = .08; vec3 x = vec3(e, 0, 0), y = vec3(0, e, 0), z = vec3(0, 0, e);
      vec3 dx = F(p + x) - F(p - x), dy = F(p + y) - F(p - y), dz = F(p + z) - F(p - z);
      return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2. * e);
    }
    vec3 ribbon(float s, float T){                      // the sheet's spine: a long curve looping through the sky
      float a = s * 3.4 - 1.7;
      return vec3(a * 2.1 + sin(T * .5 + s * 2.) * .7, sin(a * 1.4 + T * .7) * .8 + sin(T * .33) * .35 + .1, cos(a * 1.1 + T * .6) * 1.5);
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec3 p = texture2D(tPos, uv).xyz, v = texture2D(tVel, uv).xyz;
      // every bird has a home on a long ribbon that sweeps, twists and folds through the sky: seen edge-on the sheet is a dark
      // stroke, face-on a sparse veil, which is exactly how a murmuration reads. Birds chase home on a spring, so they lag and stream
      float T = time * .9, su = uv.x, sv = uv.y;
      vec3 h = fract(sin(vec3(su * 127.1 + sv * 311.7, su * 269.5 + sv * 183.3, su * 419.2 + sv * 371.9)) * 43758.5) - .5;
      vec3 c = ribbon(su, T), tg = normalize(ribbon(su + .01, T) - c);
      vec3 nw = normalize(cross(tg, vec3(sin(T * .45 + su * 3.4), cos(T * .45 + su * 3.4), .35)));  // the sheet's width direction, twisting
      vec3 home = c + nw * (sv - .5) * (1.3 + .6 * sin(su * 6. + T * .8)) + h * vec3(.12, .12, .3);
      vec3 ph = home - pred.xyz; home += normalize(ph) * pred.w * 1.6 * exp(-dot(ph, ph) / 1.4);    // the sheet itself parts around the falcon
      vec3 a = (home - p) * 4.2 - v * 1.6 + curl(p * .35 + vec3(0., time * .1, 0.)) * .9;
      vec3 o = p - pred.xyz; float od = length(o);                                            // the falcon: flee, and swirl past it
      a += (normalize(o) * 30. + cross(normalize(o), vec3(0., 1., 0.)) * 12.) * pred.w * exp(-od * od / (.6 + .6 * pred.w));
      vec3 s = p - shock.xyz; float sd = length(s);                                           // a startle: a ring of panic racing outward
      a += normalize(s) * 55. * exp(-shock.w * 1.2) * exp(-pow((sd - shock.w * 4.) * 1.5, 2.));
      v += a * dt;
      float sp = length(v); v *= min(sp, 5.) / max(sp, 1e-4);
      gl_FragColor = vec4(v, 1.);
    }`, v0)
  const vPos = gpu.addVariable('tPos', `uniform float dt; void main(){ vec2 uv = gl_FragCoord.xy / resolution.xy; vec4 p = texture2D(tPos, uv); gl_FragColor = vec4(p.xyz + texture2D(tVel, uv).xyz * dt, p.w); }`, p0)
  gpu.setVariableDependencies(vVel, [vPos, vVel]), gpu.setVariableDependencies(vPos, [vPos, vVel])
  Object.assign(vVel.material.uniforms, sim), Object.assign(vPos.material.uniforms, { dt: sim.dt })
  const err = gpu.init(); if (err) throw new Error(err)

  // ── the dusk: one low ember band and a pale sun, everything else night ──
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(90, 50), new THREE.ShaderMaterial({
    uniforms: U, depthWrite: false,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 ink, accent; varying vec2 vU;
      void main(){
        float y = vU.y, line = exp(-pow((y - .47) / .006, 2.)), glow = exp(-pow((y - .47) / .1, 2.)), haze = exp(-pow((y - .44) / .24, 2.));
        vec2 s = (vU - vec2(.555, .462)) * vec2(1.8, 1.); float sun = smoothstep(.007, .005, length(s)) * .6 + exp(-length(s) * 70.) * .25;
        gl_FragColor = vec4(mix(accent, ink, .15) * (line * .5 + glow * .14 + haze * .03) + ink * sun, 1.); // a hairline horizon, a soft glow, a faint sun
      }`,
  }))
  sky.position.set(0, 0, -16), scene.add(sky)

  // ── the birds: one instanced dart each, oriented along its velocity, wings flapping ──
  const bird = new THREE.InstancedBufferGeometry()
  bird.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, -1, 0, -0.15, 0, 0, -0.55, 0, 0, 1, 0, 0, -0.55, 1, 0, -0.15], 3)) // two wings
  const ref = new Float32Array(N * 2); for (let i = 0; i < N; i++) ref.set([((i % W) + 0.5) / W, (((i / W) | 0) + 0.5) / H], i * 2)
  bird.setAttribute('ref', new THREE.InstancedBufferAttribute(ref, 2)), (bird.instanceCount = N)
  const bu = { ...U, tPos: { value: null }, tVel: { value: null } }
  const flock = new THREE.Mesh(bird, new THREE.ShaderMaterial({
    uniforms: bu, side: THREE.DoubleSide,
    vertexShader: `
      uniform sampler2D tPos, tVel; uniform float time; attribute vec2 ref;
      void main(){
        vec3 p = texture2D(tPos, ref).xyz, v = texture2D(tVel, ref).xyz, f = normalize(v), s = normalize(cross(f, vec3(0., 1., 0.)) + 1e-4), u = cross(s, f);
        vec3 l = position; l.y += abs(l.x) * sin(time * 16. + ref.x * 911. + ref.y * 577.) * .7; // flapping
        vec3 w = p + (s * l.x * .9 + u * l.y + f * l.z) * .021;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: `void main(){ gl_FragColor = vec4(0., 0., 0., 1.); }`, // pure silhouettes: wings face-on read dense, edge-on thin
  }))
  flock.frustumCulled = false, scene.add(flock)

  const step = t => {
    sim.time.value = t, sim.shock.value.w += 1 / 60
    gpu.compute(), (bu.tPos.value = gpu.getCurrentRenderTarget(vPos).texture), (bu.tVel.value = gpu.getCurrentRenderTarget(vVel).texture)
  }
  for (let f = -300; f < 0; f++) step(f / 60) // 5s pre-roll: start mid-flight

  // ── the falcon ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3()
  let down = false, dive = 0
  addEventListener('pointerdown', () => ((down = true), sim.shock.value.set(hit.x, hit.y, hit.z, 0)))
  addEventListener('pointerup', () => (down = false))

  return t => {
    if (pointer.active) {
      ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, hit)
      dive += ((down ? 1 : 0) - dive) * 0.06
      sim.pred.value.set(hit.x, hit.y, hit.z, sim.pred.value.w + (0.6 + 0.9 * dive - sim.pred.value.w) * 0.05) // fades in; a dive hits harder
    }
    step(t)
  }
}, { loop: 16, blend: 2, eye: [0, 0.4, 13], fog: 0.02, bloom: 0.5 })
