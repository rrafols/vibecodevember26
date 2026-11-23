import { go, THREE, U, noise, pointer } from '../lib/stage.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

// 06 — veil: a sheer silk veil floating in the void, simulated on the GPU and stirred by a slow wind.
// Pull it too hard and it tears; the hole burns open with an ember rim, then slowly closes again.
// drag: grab the silk (yank to tear)
go('veil', ({ scene, camera, renderer }) => {
  const W = 104, H = 124, SW = 4.4, SH = 5.3, LOOP = 12, SUB = 16, rest = new THREE.Vector2(SW / (W - 1), SH / (H - 1))
  const gpu = new GPUComputationRenderer(W, H, renderer)
  const p0 = gpu.createTexture(), l0 = gpu.createTexture(), d0 = gpu.createTexture()
  for (let j = 0, k = 0; j < H; j++) for (let i = 0; i < W; i++, k += 4) p0.image.data.set([(i / (W - 1) - 0.5) * SW, SH / 2 - (1 - j / (H - 1)) * SH, 0, 1], k), l0.image.data.set([1, 1, 1, 1], k)

  const common = `
    uniform float dt, time; uniform vec2 rest;
    vec2 px(){ return 1. / resolution.xy; }
    bool inside(vec2 uv){ return all(greaterThan(uv, vec2(0.))) && all(lessThan(uv, vec2(1.))); }
    vec3 P(vec2 uv){ return texture2D(tPos, uv).xyz; }`
  // position: verlet + wind + gravity, then relax every live link towards its rest length (structural + shear)
  const vPos = gpu.addVariable('tPos', noise + common + `
    uniform vec4 grab; uniform vec3 grabTo;
    vec3 pull(vec3 a, vec2 uv, vec2 o, float r, float s){
      vec2 n = uv + o * px(); if (!inside(n) || s <= 0.) return vec3(0.);
      vec3 d = a - P(n); float l = length(d) + 1e-5; return d / l * (r - l) * .5 * s;
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec3 p = P(uv), q = texture2D(tPrev, uv).xyz; vec4 L = max(texture2D(tLink, uv), 0.);
      if (uv.y > 1. - px().y) { gl_FragColor = vec4(p.x, p.y, sin(time * .6 + p.x * .9) * .2, 1.); return; } // the top edge drifts, held by nothing visible
      vec3 wind = vec3(.15, .1, 1.) * (.2 + 1.4 * snoise(vec3(p.x * .45 - time * .9, p.y * .5, time * .2))) * 2.6  // gusts rolling across
        + vec3(snoise(p * .7 + time * .4), snoise(p * .7 - time * .4 + 4.), snoise(p * 1.6 + time * .7 + 9.) * 3.5) * .8 + vec3(0., 0., sin(p.y * 2.2 - time * 1.7 + sin(p.x * 1.3)) * 1.6); // + a ripple climbing the silk
      vec3 np = p + (p - q) * .992 + (vec3(0., -1.2, 0.) + wind) * dt * dt, c = vec3(0.);
      float dg = length(rest);
      c += pull(np, uv, vec2(1, 0), rest.x, L.x) + pull(np, uv, vec2(0, 1), rest.y, L.y) + pull(np, uv, vec2(-1, 0), rest.x, L.z) + pull(np, uv, vec2(0, -1), rest.y, L.w);
      c += .5 * (pull(np, uv, vec2(1, 1), dg, L.x * L.y) + pull(np, uv, vec2(-1, 1), dg, L.y * L.z) + pull(np, uv, vec2(-1, -1), dg, L.z * L.w) + pull(np, uv, vec2(1, -1), dg, L.w * L.x));
      np += c * .5;
      if (grab.w > 0.) {                                               // a hand: carries a patch along, keeping its shape
        vec2 e = (uv - grab.xy) * resolution.xy * rest; float f = grab.w * smoothstep(grab.z, 0., length(e));
        np = mix(np, grabTo + vec3(e, 0.), f);
      }
      gl_FragColor = vec4(np, 1.);
    }`, p0)
  const vPrev = gpu.addVariable('tPrev', `void main(){ gl_FragColor = texture2D(tPos, gl_FragCoord.xy / resolution.xy); }`, p0)
  // links (right, up, left, down): a healthy link tears past 2.6× rest → drops to -.6, stays open ~2.5s, then knits back over ~4s
  const vLink = gpu.addVariable('tLink', common + `
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy, o = px();
      vec3 p = P(uv); vec4 L = texture2D(tLink, uv);
      vec4 len = vec4(length(p - P(uv + vec2(o.x, 0.))), length(p - P(uv + vec2(0., o.y))), length(p - P(uv - vec2(o.x, 0.))), length(p - P(uv - vec2(0., o.y))));
      L = mix(L, vec4(-.6), step(.98, L) * step(vec4(rest, rest) * 2.6, len) * step(uv.y, 1. - 3. * o.y)); // the top edge never tears
      L = min(L + dt * .25, 1.);
      gl_FragColor = vec4(inside(uv + vec2(o.x, 0.)) ? L.x : 1., inside(uv + vec2(0., o.y)) ? L.y : 1., inside(uv - vec2(o.x, 0.)) ? L.z : 1., inside(uv - vec2(0., o.y)) ? L.w : 1.);
    }`, l0)
  // damage: a smooth field over the torn links, with a short soft halo → holes get organic, burnt edges instead of grid steps
  const vDmg = gpu.addVariable('tDmg', common + `
    float D(vec2 uv){ return inside(uv) ? texture2D(tDmg, uv).x : 0.; }
    void main(){
      vec2 uv = gl_FragCoord.xy / resolution.xy, o = px(); vec4 L = texture2D(tLink, uv);
      float raw = 1. - clamp(min(min(L.x, L.y), min(L.z, L.w)), 0., 1.);
      float halo = (D(uv + vec2(o.x, 0.)) + D(uv - vec2(o.x, 0.)) + D(uv + vec2(0., o.y)) + D(uv - vec2(0., o.y))) * .25 * .9;
      gl_FragColor = vec4(max(raw, halo));
    }`, d0)
  gpu.setVariableDependencies(vPos, [vPos, vPrev, vLink]), gpu.setVariableDependencies(vPrev, [vPos]), gpu.setVariableDependencies(vLink, [vPos, vLink]), gpu.setVariableDependencies(vDmg, [vPos, vLink, vDmg])
  const sim = { dt: { value: 1 / 60 / SUB }, time: { value: 0 }, rest: { value: rest }, grab: { value: new THREE.Vector4() }, grabTo: { value: new THREE.Vector3() } }
  for (const v of [vPos, vLink, vDmg]) Object.assign(v.material.uniforms, sim)
  const err = gpu.init(); if (err) throw new Error(err)

  // ── the silk: sheer where it faces you, dense where folds turn edge-on, ember light glowing through ──
  const geo = new THREE.PlaneGeometry(1, 1, W - 1, H - 1), uvs = geo.attributes.uv
  for (let k = 0; k < uvs.count; k++) uvs.setXY(k, ((k % W) + 0.5) / W, 1 - (((k / W) | 0) + 0.5) / H) // texel centres
  const u = { ...U, tPos: { value: null }, tDmg: { value: null }, px: { value: new THREE.Vector2(1 / W, 1 / H) } }
  const veil = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: u, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform sampler2D tPos; uniform vec2 px; varying vec3 vN, vW; varying vec2 vUv;
      vec3 P(vec2 o){ return texture2D(tPos, clamp(uv + o * px, px * .5, 1. - px * .5)).xyz; }
      void main(){
        vUv = uv, vW = P(vec2(0.));
        vN = cross(P(vec2(1, 0)) - P(vec2(-1, 0)), P(vec2(0, 1)) - P(vec2(0, -1))) + vec3(0., 0., 1e-6); // never zero: normalize(0) is NaN, and bloom spreads NaN everywhere
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
      }`,
    fragmentShader: noise + `
      uniform vec3 ink, accent; uniform sampler2D tDmg; uniform vec2 px; varying vec3 vN, vW; varying vec2 vUv;
      float D(vec2 uv){                                                          // bilinear damage (sim textures are nearest-filtered)
        vec2 f = uv / px - .5, i = floor(f), t = f - i, a = (i + .5) * px;
        return mix(mix(texture2D(tDmg, a).x, texture2D(tDmg, a + vec2(px.x, 0.)).x, t.x), mix(texture2D(tDmg, a + vec2(0., px.y)).x, texture2D(tDmg, a + px).x, t.x), t.y);
      }
      void main(){
        float dmg = D(vUv) + snoise(vec3(vUv * 26., 1.)) * .07;                  // ragged, organic burn line
        if (dmg > .55) discard;
        vec2 e2 = min(vUv, 1. - vUv);
        float fray = smoothstep(0., .16, min(e2.x, e2.y) + snoise(vec3(vUv * 4., 3.)) * .02); // soft, dissolving border: no hard rectangle
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1. : -1.), v = normalize(cameraPosition - vW);
        float sheer = clamp(1. - abs(dot(n, v)), 0., 1.), a = mix(.08, .8, pow(sheer, 1.6)) * fray;
        vec3 c = (ink * (.1 + 1.1 * sheer * sheer * sheer) + accent * .22 * pow(1. - sheer, 3.)) * a
          + ink * .05 * pow(max(dot(n, normalize(vec3(-.9, .35, .25))), 0.), 2.) * fray; // a soft raking light models the gentle swells
        float rim = smoothstep(.28, .55, dmg);                                    // burning rim: ember, white at the very edge
        c += (accent * 1.6 * rim * rim + ink * 2.5 * smoothstep(.49, .55, dmg)) * fray;
        gl_FragColor = vec4(c, 1.);
      }`,
  }))
  veil.frustumCulled = false
  scene.add(veil)

  const step = t => {
    sim.time.value = t
    for (let i = 0; i < SUB; i++) gpu.compute()
    u.tPos.value = gpu.getCurrentRenderTarget(vPos).texture, u.tDmg.value = gpu.getCurrentRenderTarget(vDmg).texture
  }
  for (let f = -360; f < 0; f++) step(f / 60) // 6s pre-roll so it starts mid-flutter

  // ── hands: two scripted yanks per loop (seamless thanks to the recorder crossfade) and the user's own ──
  const ghosts = [{ at: 2, uv: [0.38, 0.45], to: [1.7, -1.3, 2.2] }, { at: 7, uv: [0.66, 0.66], to: [-1.9, 0.9, 2] }]
  const rest3 = (x, y) => new THREE.Vector3((x - 0.5) * SW, SH / 2 - (1 - y) * SH, 0)
  const buf = new Float32Array(W * H * 4), ray = new THREE.Raycaster(), plane = new THREE.Plane(), V = new THREE.Vector3(), C = new THREE.Vector3()
  let hand = null
  addEventListener('pointerdown', () => {
    renderer.readRenderTargetPixels(gpu.getCurrentRenderTarget(vPos), 0, 0, W, H, buf)
    let best = -1, bd = 0.08 ** 2
    for (let k = 0; k < W * H; k++) {
      const d = V.set(buf[k * 4], buf[k * 4 + 1], buf[k * 4 + 2]).project(camera)
      const e = (d.x - pointer.x) ** 2 + (d.y - pointer.y) ** 2
      if (e < bd) (bd = e), (best = k)
    }
    if (best >= 0) hand = { uv: [((best % W) + 0.5) / W, (((best / W) | 0) + 0.5) / H], at: new THREE.Vector3(buf[best * 4], buf[best * 4 + 1], buf[best * 4 + 2]) }
  })
  addEventListener('pointerup', () => (hand = null))

  return t => {
    const g = sim.grab.value, c = t % LOOP
    if (hand) {
      ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(C), hand.at), sim.grabTo.value)
      g.set(...hand.uv, 0.14, 1) // a small grip: whatever tears free is small enough to burn away
    } else {
      const o = ghosts.find(o => c > o.at && c < o.at + 1.1)
      if (o) {
        const k = (c - o.at) / 1.1, e = k < 0.25 ? 0 : Math.min(1, (k - 0.25) / 0.45) ** 2 // grip, then yank
        sim.grabTo.value.copy(rest3(...o.uv)).lerp(V.set(...o.to), e), g.set(...o.uv, 0.12, Math.sin(Math.min(k, 0.999) * Math.PI) ** 0.3)
      } else g.w = 0
    }
    step(t)
  }
}, { loop: 12, blend: 1.5, eye: [2, 0.4, 10.6], bloom: 0.75 })
