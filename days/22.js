import { go, THREE, U, R, TAU, pointer, REC } from '../lib/stage.js'

// 22 — rain: a fogged window at night over a wet street: towers, lamps, traffic, all far out of focus behind it. Raindrops land, bead, and once heavy enough
// slide down in stick-slip jerks, swallowing every droplet in their way and leaving a trail of beads behind. Each drop is a
// tiny lens: through it the lights are sharp and upside down.
// move: your warmth clears the fog · hold and drag: wipe the glass · click: a spray of rain
go('rain', ({ scene, renderer }) => {
  const LOOP = 16, MAX = 1400
  const drops = [] // { x, y, r, vy, hold, trailAt }
  const add = (x, y, r) => drops.length < MAX && drops.push({ x, y, r, vy: 0, hold: R(0.2, 1.5), trail: y })
  for (let i = 0; i < 700; i++) add(R(), R(), 0.002 + R() ** 3 * 0.012)

  // ── the drops are drawn as little lenses into a normal map: xy = surface slope, z = thickness ──
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }), dScene = new THREE.Scene(), dCam = new THREE.Camera()
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)), quad.setIndex([0, 1, 2, 0, 2, 3])
  const inst = new Float32Array(MAX * 4), ia = new THREE.InstancedBufferAttribute(inst, 4); ia.setUsage(THREE.DynamicDrawUsage)
  quad.setAttribute('drop', ia)
  const aspect = { value: 1 }
  const dMesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
    uniforms: { aspect }, depthTest: false, depthWrite: false,
    vertexShader: `attribute vec4 drop; uniform float aspect; varying vec2 vP;
      void main(){ vP = position.xy; vec2 s = vec2(drop.z / aspect, drop.z * drop.w); gl_Position = vec4(drop.xy * 2. - 1. + position.xy * s * 2., 0., 1.); }`,
    fragmentShader: `varying vec2 vP;
      void main(){ vec2 p = vP; p.y += .25 * p.y * p.y - .1; float r2 = dot(p, p); if (r2 > 1.) discard; gl_FragColor = vec4(p * .5 + .5, sqrt(1. - r2), 1.); }`, // a little heavier at the bottom, like a real bead
  }))
  dMesh.frustumCulled = false, dScene.add(dMesh)

  // the fog you clear: a small canvas painted by the cursor, slowly misting back over
  const fc = document.createElement('canvas'); fc.width = fc.height = 128
  const fx = fc.getContext('2d'), fogTex = new THREE.CanvasTexture(fc)
  fx.fillStyle = '#000', fx.fillRect(0, 0, 128, 128)

  // ── the city behind the glass, drawn sharp into a mip-mapped target: the mips are the blur ──
  //    towers with lit windows and a few neon signs, sodium street lamps, a lane of headlights and a lane of taillights (whole laps
  //    per loop), and the wet street mirroring all of it in long broken streaks
  const cityRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter })
  const cScene = new THREE.Scene(), cq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { ...U, aspect }, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform float phase, aspect; uniform vec3 ink, accent; varying vec2 vU;
      float h1(float x){ return fract(sin(x * 127.1) * 43758.5); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      const float HZ = .3;                                    // the street
      vec3 lamps(vec2 uv){                                    // only the point lights: lamps and cars (the street mirrors these brightest)
        vec3 c = vec3(0.); vec2 a = vec2(aspect, 1.);
        for (int i = 0; i < 7; i++) { vec2 d = (uv - vec2((float(i) + .3) / 7., HZ + .1)) * a; float q = dot(d, d); c += mix(accent, ink, .3) * (exp(-q / .00003) * 2. + exp(-q / .002) * .1); }
        for (int i = 0; i < 7; i++) {
          float f = float(i), x = fract(h1(f) + phase * (2. + floor(h1(f + 9.) * 2.))), y = fract(h1(f + 3.) - phase * (2. + floor(h1(f + 5.) * 2.)));
          for (int s = 0; s < 2; s++) {
            vec2 d = (uv - vec2(x + float(s) * .016, HZ + .008)) * a; float q = dot(d, d); c += ink * (exp(-q / .000006) * 1.5 + exp(-q / .0004) * .04);      // headlights, near lane →
            d = (uv - vec2(y + float(s) * .012, HZ + .026)) * a; q = dot(d, d); c += accent * (exp(-q / .000004) * 1.3 + exp(-q / .0003) * .04);       // taillights, far lane ←
          }
        }
        return c;
      }
      vec3 towers(vec2 uv){
        vec3 c = accent * .05 * exp(-(uv.y - HZ) * 5.) + ink * .003;                                               // the glow over a city
        for (int l = 0; l < 3; l++) {
          float fl = float(l), n = 7. + fl * 5., cx = floor(uv.x * n + fl * .37), lx = fract(uv.x * n + fl * .37);
          float top = HZ + .04 + h1(cx + fl * 31.) * (.55 - fl * .14);
          if (uv.y < top && uv.y > HZ + .035 && lx > .05 && lx < .95) {
            vec2 w = vec2(lx * (7. + fl * 2.), (uv.y - HZ) * (60. - fl * 8.)), wi = floor(w), wf = fract(w);
            float lit = step(.6, h2(wi + cx * 7. + fl * 13.)) * step(.2, wf.x) * step(wf.x, .8) * step(.25, wf.y) * step(wf.y, .75);
            vec3 wc = mix(ink * .45, accent * .8, step(.72, h2(wi.yx + cx))) * (.25 + .75 * h2(wi * 1.7 + cx));
            c = vec3(.004 + fl * .001) + wc * lit * (.25 + fl * .2);
            if (h1(cx * 3.1 + fl) > .75 && abs(uv.y - top + .04) < .007 && lx > .2 && lx < .8) c = accent * 1.3;   // neon
          }
        }
        if (uv.y < HZ + .035) c = vec3(.006);                                                                     // the road itself
        for (int i = 0; i < 7; i++) { float x = (float(i) + .3) / 7.; if (abs(uv.x - x) < .0012 && uv.y < HZ + .1) c = vec3(.01); } // lamp posts
        return c;
      }
      void main(){
        vec2 uv = vU; vec3 c;
        if (uv.y > HZ) c = towers(uv) + lamps(uv);
        else {                                                // wet asphalt: the city mirrored, smeared into streaks, broken by rain
          float dy = HZ - uv.y, wob = sin(uv.y * 180. + phase * 6.2832 * 6.) * .002 + sin(uv.y * 410. - phase * 6.2832 * 9.) * .001;
          for (int k = 0; k < 4; k++) { vec2 q = vec2(uv.x + wob, HZ + dy * (.3 + float(k) * .3)); c += towers(q) * .3 + lamps(q) * .7; }
          c = c * .25 * smoothstep(-.05, HZ, uv.y) + vec3(.003);
        }
        gl_FragColor = vec4(c, 1.);
      }`,
  }))
  cq.frustumCulled = false, cScene.add(cq)

  // ── the window: blurred city through the fog, sharp where it is wiped, sharp and upside down inside every drop ──
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { ...U, tD: { value: rt.texture }, tF: { value: fogTex }, tC: { value: cityRT.texture }, aspect }, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tD, tF, tC; uniform float aspect; uniform vec3 ink, accent; varying vec2 vU;
      vec3 soft(vec2 uv, float lod){                          // a wider, rounder blur than one mip: a ring of taps
        vec3 c = textureLod(tC, uv, lod).rgb * 2.; float r = exp2(lod) / 900.;
        for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472; c += textureLod(tC, uv + vec2(cos(a) / aspect, sin(a)) * r, lod).rgb; }
        return c / 8.;
      }
      void main(){
        vec4 d = texture2D(tD, vU); float fog = 1. - texture2D(tF, vU).r;
        vec3 c;
        if (d.a > .5) {
          vec2 n = d.xy * 2. - 1.; float th = d.z;
          c = textureLod(tC, vU - n * .07 * vec2(1. / aspect, 1.) - vec2(0., .02), .5).rgb * 1.4 + ink * .01;
          c += ink * pow(max(dot(normalize(vec3(n, th)), normalize(vec3(-.5, .7, .5))), 0.), 30.) * .5;     // a glint
          c *= .7 + .3 * smoothstep(0., .35, th);                                                      // dark rims
        } else c = soft(vU, mix(.2, 3.6, fog)) * mix(1.05, .85, fog) + ink * .012 * fog;                   // misted glass
        gl_FragColor = vec4(c, 1.);
      }`,
  }))
  win.frustumCulled = false, scene.add(win)

  // ── interaction ──
  let now = 0, down = false, lastP = 0
  const hand = new THREE.Vector2(), prevHand = new THREE.Vector2()
  addEventListener('pointerdown', () => { down = true; const x = pointer.x * 0.5 + 0.5, y = pointer.y * 0.5 + 0.5; for (let i = 0; i < 26; i++) add(x + R(-0.12, 0.12), y + R(-0.12, 0.12), 0.004 + R() ** 2 * 0.02) })
  addEventListener('pointerup', () => (down = false))
  const rain = Array.from({ length: 60 }, () => [R(), R(), R(), R() < 0.3]) // the loop's own rain: when, where, big?

  const size = new THREE.Vector2()
  return (t, p) => {
    const dt = Math.min(1 / 30, Math.max(0, t - now)); now = t
    renderer.getDrawingBufferSize(size), (aspect.value = size.x / size.y)
    const w = Math.max(1, (size.x / 2) | 0), h = Math.max(1, (size.y / 2) | 0)
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h)

    // rain falls on the glass
    for (const [at, x, y, big] of rain) if ((lastP < at && p >= at) || (p < lastP && at <= p)) add(x, 0.25 + y * 0.8, big ? R(0.013, 0.024) : R(0.004, 0.01))
    for (let i = 0; i < 4; i++) add(R(), R(), 0.0015 + R() ** 4 * 0.005)   // and mist keeps settling
    lastP = p

    // physics: heavy drops slide in stick-slip jerks, absorb what they touch and shed beads behind them
    for (const d of drops) {
      if (d.r < 0.011) continue
      d.hold -= dt * (d.r * 70)
      if (d.hold > 0) { d.vy *= 0.8; continue }
      d.vy = Math.min(0.45, d.vy + dt * (d.r - 0.01) * 60)
      if (R() < dt * 2.5) d.hold = R(0.05, 0.5)                              // snag on something, pause
      d.y -= d.vy * dt, (d.x += Math.sin(t * 3 + d.r * 900) * dt * 0.006)
      if (d.trail - d.y > d.r * 1.6) { d.trail = d.y; if (R() < 0.8) { const b = d.r * R(0.15, 0.35); add(d.x + R(-0.2, 0.2) * d.r / aspect.value, d.y + d.r * 1.4, b), (d.r = Math.cbrt(d.r ** 3 - b ** 3 * 0.6)) } }
      for (const o of drops) {
        if (o === d || o.r <= 0) continue
        const dx = (o.x - d.x) * aspect.value, dy = o.y - d.y
        if (dx * dx + dy * dy < (d.r + o.r) ** 2 * 0.7 && o.r <= d.r) d.r = Math.cbrt(d.r ** 3 + o.r ** 3), (o.r = 0), (d.vy *= 0.9)
      }
    }
    // the hand: warmth clears gently, a held drag wipes the glass, beads and all
    const fade = 0.006
    fx.fillStyle = `rgba(0,0,0,${fade})`, fx.fillRect(0, 0, 128, 128)
    if (pointer.active) {
      hand.set(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5)
      const rad = down ? 0.07 : 0.035
      const g = fx.createRadialGradient(hand.x * 128, (1 - hand.y) * 128, 0, hand.x * 128, (1 - hand.y) * 128, rad * 128 * 1.6)
      g.addColorStop(0, `rgba(255,255,255,${down ? 0.9 : 0.08})`), g.addColorStop(1, 'rgba(255,255,255,0)'), (fx.fillStyle = g), fx.fillRect(0, 0, 128, 128)
      if (down) for (const d of drops) { const dx = (d.x - hand.x) * aspect.value, dy = d.y - hand.y; if (dx * dx + dy * dy < rad * rad) d.r = 0 }
      prevHand.copy(hand)
    }
    fogTex.needsUpdate = true
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].r <= 0.0004 || drops[i].y < -0.05) drops.splice(i, 1)

    drops.forEach((d, i) => inst.set([d.x, d.y, d.r, 1 + Math.min(d.vy * 3, 0.6)], i * 4))
    quad.instanceCount = drops.length, (ia.needsUpdate = true)
    if (cityRT.width !== w * 2 || cityRT.height !== h * 2) cityRT.setSize(w * 2, h * 2)
    renderer.setRenderTarget(cityRT), renderer.render(cScene, dCam)
    renderer.setRenderTarget(rt), renderer.setClearColor(0x000000, 0), renderer.clear(), renderer.render(dScene, dCam), renderer.setRenderTarget(null)
  }
}, { loop: 16, blend: 2, drift: 0, bloom: 0.8, fog: 0 })
