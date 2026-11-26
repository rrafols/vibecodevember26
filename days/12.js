import { go, THREE, U, TAU, noise, pointer, raymarch, REC } from '../lib/stage.js'

// 12 — incense: one stick, one ember, and its smoke: a thin laminar thread that breaks into curls as it rises, lit from below by
// the ember and from behind by a cool light, shadowing itself.
// Kept cheap: detail noise only where the plume's outline says there is smoke, shadows from the outline alone, sway from sines
// (whole cycles per loop, so it stays seamless), and the volume rendered at reduced resolution then scaled up (smoke is soft).
// move: waft it, stirring curls (faster = stronger) · hold and move: breathe on it · tap: puff a smoke ring
go('incense', ({ scene, camera, renderer }) => {
  const LOOP = 14, TIP = new THREE.Vector3(0, -0.95, 0), NR = 4, SCALE = REC ? 0.75 : 0.5
  const u = { ...U, wind: { value: new THREE.Vector4(0, 0, 0, 0) }, windV: { value: new THREE.Vector3() }, swirl: { value: 0 }, rings: { value: Array.from({ length: NR }, () => new THREE.Vector2()) }, tip: { value: TIP } }
  const smokeScene = new THREE.Scene()
  smokeScene.add(raymarch(noise + `
    uniform float phase, swirl; uniform vec3 ink, accent, tip, windV; uniform vec4 wind; uniform vec2 rings[${NR}]; varying vec3 vRay;
    const float LOOP = ${LOOP}.;
    // the plume's outline: a column that widens, sways and thins with height. No noise: cheap enough for every sample and shadow
    float outline(vec3 p, out vec3 q, out float h){
      h = p.y - tip.y; if (h < 0.) return 0.;
      float P = phase * 6.2832;
      vec3 sway = vec3(sin(h * 1.6 - P) + .5 * sin(h * 2.9 - 2. * P + 1.3), 0., .6 * sin(h * 1.3 - P + 2.) + .3 * sin(h * 3.3 - 3. * P)) * .2 * h * h / (1. + h);
      q = p - tip - sway;
      float r = .02 + .05 * h + .014 * h * h, d = length(q.xz) / r, turb = smoothstep(.25, 1.4, h);
      return exp(-d * d * (1. - .5 * turb)) * exp(-h * .85) * smoothstep(0., .06, h);
    }
    float detail(vec3 q, float h, float t){               // curls: one warp, two octaves
      float turb = smoothstep(.25, 1.4, h);
      vec3 w = q * vec3(2.2, 1.5, 2.2) - vec3(0., t * .9, 0.);
      w += vec3(snoise(w * .7 + 11.), snoise(w * .7 + 23.), snoise(w * .7 + 37.)) * 1.3 * turb;
      float n = (snoise(w * 1.4) * .62 + snoise(w * 2.9 + 5.) * .3) * .5 + .5;
      return mix(1., smoothstep(.5, .62, n) * 2., turb);
    }
    float rings_(vec3 p){                                 // smoke rings: tori that rise and widen as they fade
      float s = 0.;
      for (int i = 0; i < ${NR}; i++) {
        vec2 k = rings[i]; if (k.y <= 0.) continue;
        float a = k.x; vec3 q = p - tip - vec3(0., .12 + a * .42, 0.);
        q.yz = mat2(.9, -.44, .44, .9) * q.yz;            // tilted towards us, so it reads as a ring
        float R = .12 + a * .12, tube = .025 + a * .015;
        vec2 tq = vec2(length(q.xz) - R, q.y); float g = exp(-dot(tq, tq) / (tube * tube));
        if (g > .01) s += k.y * g * exp(-a * .5) * .9 * (.45 + .55 * smoothstep(-.4, .6, snoise(q * 7. + a))); // uneven, like real smoke
      }
      return s;
    }
    vec3 waft(vec3 p){                                    // your hand: carries the smoke along and stirs a vortex into it; the ember stays put
      vec3 o = p - wind.xyz; float f = wind.w * exp(-dot(o, o) / .5) * smoothstep(.05, .9, p.y - tip.y);
      p -= windV * f;
      float a = swirl * f; vec2 q = p.xy - wind.xy; p.xy = wind.xy + mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
      return p;
    }
    float smoke(vec3 p){
      p = waft(p); vec3 q; float h, e = outline(p, q, h), t = phase * LOOP;
      if (e > .01) e *= mix(detail(q, h, t), detail(q, h, t - LOOP), phase); // only where there is smoke; two copies crossfaded = seamless
      return e + rings_(p);
    }
    float shade(vec3 p){ vec3 q; float h; return outline(waft(p), q, h); }
    void main(){
      vec3 ro = cameraPosition, rd = normalize(vRay), lo = vec3(-1.5, tip.y - .05, -1.1), hi = vec3(1.5, 2.6, 1.1);
      vec3 i0 = (lo - ro) / rd, i1 = (hi - ro) / rd, tn = min(i0, i1), tf = max(i0, i1);
      float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
      if (b < max(a, 0.)) discard;                        // only rays through the smoke's box do any work
      a = max(a, 0.);
      const int N = 40; float dt = (b - a) / float(N), T = 1.;
      vec3 col = vec3(0.), key = normalize(vec3(-.6, .7, -.6)); // a cool light from behind, upper left: silver edges
      float back = .35 + .65 * pow(max(dot(rd, -key), 0.) * .5 + .5, 4.);
      for (int i = 0; i < N; i++) {
        vec3 p = ro + rd * (a + (float(i) + .5) * dt);
        float d = smoke(p); if (d < .005) continue;
        float sh = shade(p + key * .12) + shade(p + key * .26) + shade(p + key * .42); // self-shadow from the outline
        vec3 e = p - tip; float ember = 1. / (1. + dot(e, e) * 18.);
        vec3 c = ink * .55 * exp(-sh * 1.2) * back + accent * ember * 2.2;
        float k = d * 6. * dt;
        col += T * c * k, T *= exp(-k);
        if (T < .02) break;
      }
      vec3 e = rd * dot(tip - ro, rd) + ro - tip;        // the ember's own glow, hanging in the air
      col += (accent * .003 / (dot(e, e) + .0008) + ink * .0006 / (dot(e, e) + .00004)) * T;
      gl_FragColor = vec4(col, 1.);
    }`, u))

  // the volume is drawn into a smaller target, then laid over the scene full size
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }), size = new THREE.Vector2()
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tS: { value: rt.texture } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tS; varying vec2 vU; void main(){ gl_FragColor = texture2D(tS, vU); }`,
  }))
  overlay.frustumCulled = false, (overlay.renderOrder = 1), scene.add(overlay)

  // the stick
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.4, 8).translate(0, -0.7, 0), new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8 }))
  stick.position.copy(TIP), stick.rotation.z = 0.06, scene.add(stick)

  // interaction: the cursor's motion is the gust · clicks and the loop puff rings
  const auto = [0.22, 0.62], mine = [], ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3(), last = new THREE.Vector3()
  let now = 0, held = false, downAt = 0, moved = 0
  addEventListener('pointerdown', () => ((held = true), (downAt = now), (moved = 0)))
  addEventListener('pointerup', () => { if (moved < 0.05 && now - downAt < 0.3) mine.push(now), mine.length > 2 && mine.shift(); held = false }) // a tap puffs a ring, a held drag is a breath

  return (t, p) => {
    now = t
    const W = u.wind.value, Rg = u.rings.value
    if (pointer.active && (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, hit))) {
      const step = hit.clone().sub(last); moved += step.length()
      u.windV.value.lerp(step.multiplyScalar(held ? 26 : 14).clampLength(0, held ? 2.4 : 1.4), 0.1), last.copy(hit) // the hand's motion, smoothed; held = a breath
      u.swirl.value += (THREE.MathUtils.clamp(-u.windV.value.x * 2.2, -2.5, 2.5) - u.swirl.value) * 0.08   // sideways motion stirs a vortex
      W.set(W.x + (hit.x - W.x) * 0.15, W.y + (hit.y - W.y) * 0.15, 0, 1)
    } else (W.w *= 0.95), (u.swirl.value *= 0.95)
    auto.forEach((at, k) => { const a = ((p - at + 1) % 1) * LOOP; Rg[k].set(a, a < 9 ? Math.min(1, a * 3) * Math.min(1, (9 - a) / 2) : 0) }) // fade out before the wrap
    for (let k = 0; k < 2; k++) { const a = mine[k] !== undefined ? t - mine[k] : 99; Rg[2 + k].set(a, a < 12 ? Math.min(1, a * 3) : 0) }

    renderer.getDrawingBufferSize(size)
    const w = Math.max(1, Math.round(size.x * SCALE)), h = Math.max(1, Math.round(size.y * SCALE))
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h)
    renderer.setRenderTarget(rt), renderer.setClearColor(0x000000, 0), renderer.clear(), renderer.render(smokeScene, camera), renderer.setRenderTarget(null)
  }
}, { loop: 14, eye: [0, 0.55, 5.6], drift: 0.5, bloom: 0.7, dpr: 1, parallax: 0 })
