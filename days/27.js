import { go, THREE, U, R, TAU, noise, pointer, raymarch } from '../lib/stage.js'

// 27 — aurora: a winter night by a lake. Red curtains of aurora fold across the sky above a snowy range: a pale rose hem,
// a glowing red body, deep crimson where they fade out; fine rays stream through them and electrons rain down in pulses.
// Their glow tints the sky, the snow and the water; the moon adds a soft cool light. The land and the lake are raymarched;
// the aurora is drawn as rays, blurred into a glow, once as seen and once mirrored in the water. Fireflies dance low over the
// lake on looping paths, trailing light, and the water mirrors them too.
// hover: the curtains drift and lean with you · click the lake: a stone thrown in · click the sky: a substorm — they flare and race
go('aurora', ({ scene, camera, renderer }) => {
  const WL = -0.55 // the lake's surface: the camera sits just above it, looking out across the water
  const u = { ...U, lean: { value: 0 }, storm: { value: 0 }, T: { value: 0 }, drops: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -99, 0)) } }

  // ── the aurora: three curtains of rays, positioned on the GPU ──
  const NC = 2, NR = 3200, NS = 12, pos = [], att = []
  for (let c = 0; c < NC; c++) for (let r = 0; r < NR; r++) { const s = (r + R()) / NR, h = R(); for (let k = 0; k < NS; k++) pos.push(s, k / NS, c, s, (k + 1) / NS, c), att.push(h, h) }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('h', new THREE.Float32BufferAttribute(att, 1))
  const lines = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: noise + `uniform float T, lean, storm; uniform vec3 ink, accent; attribute float h; varying float vB; varying vec3 vC;
      void main(){
        float s = position.x, v = position.y, c = position.z, t = T;
        float fold = snoise(vec3(s * 3.2, t * .07, c * 7.)), fold2 = snoise(vec3(s * 10., t * .13, c * 3. + 9.));
        vec3 p = vec3(-56. + 112. * s, 0., -26. - c * 12. + 11. * sin(s * 6.5 + c * 2. + t * .05 + lean) + fold * 7. + fold2 * 1.1);
        p.xz = mat2(.94, -.34, .34, .94) * p.xz;                                                            // running a little diagonally across the sky
        float foot = 4.6 + c * .9 + snoise(vec3(s * 3., t * .1, c)) * 1.4 + snoise(vec3(s * 14., t * .2, c + 2.)) * .55 + snoise(vec3(s * 40., t * .3, c + 5.)) * .18, height = (5. + 3.5 * (.5 + .5 * snoise(vec3(s * 1.7, t * .09, c + 4.)))) * (.75 + .5 * h);   // rays of different heights: no hard top edge
        p.y = foot + v * height;
        // brightness: a sharp white hem, rays brightening as waves run along the curtain, electrons raining down each ray
        float rays = (.82 + .18 * pow(.5 + .5 * sin(s * 260. + fold2 * 9. - t * (1.4 + storm * 3.) + c * 3.), 5.)) * pow(h, 1.6) * 1.6;   // strong ray-to-ray contrast
        float hem = exp(-v * 5.) * 1.6 + .32 * (1. - v);
        float patchy = .3 + .7 * smoothstep(.2, .7, .5 + .5 * snoise(vec3(s * 2.5 + t * .02, c * 5., 1.)));
        vB = (hem * rays + smoothstep(.3, .65, v) * (1. - v) * .5 * rays) * patchy * (.55 + .45 * h) * smoothstep(0., .1, s) * smoothstep(1., .9, s) * smoothstep(1., .55, v) * (1. + storm * .7);
        vC = mix(mix(mix(ink, accent, .35) * 1.1, accent * 1.05, smoothstep(.04, .22, v)), accent * vec3(.75, .3, .35) * .8, smoothstep(.45, .9, v)); // rose hem, red body, crimson crown
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `varying float vB; varying vec3 vC; void main(){ gl_FragColor = vec4(vC * vB * .07, 1.); }`,
  }))
  lines.frustumCulled = false
  const aGroup = new THREE.Group().add(lines), aScene = new THREE.Scene().add(aGroup)
  aGroup.position.y = WL
  const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  const aRT = mk(), mRT = mk(), size = new THREE.Vector2()
  const lin = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
  const gA = lin(), gB = lin(), gM = lin(), gN = lin() // blurred glow: aurora and mirror
  const bq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { tS: { value: null }, dir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tS; uniform vec2 dir; varying vec2 vU;
      void main(){ vec3 c = vec3(0.); float w = 0.; for (int i = -7; i <= 7; i++) { float k = exp(-float(i * i) / 18.); c += texture2D(tS, vU + dir * float(i)).rgb * k; w += k; } gl_FragColor = vec4(c / w, 1.); }` }))
  bq.frustumCulled = false
  const bScene = new THREE.Scene().add(bq), bCam = new THREE.Camera()
  const blur = (src, a, b) => { // two wide passes each way
    for (let i = 0; i < 2; i++) for (const [from, to, d] of [[i ? b : src, a, [1, 0]], [a, b, [0, 1]]]) bq.material.uniforms.tS.value = from.texture, bq.material.uniforms.dir.value.set(d[0] * 2.2 / a.width, d[1] * 2.2 / a.height), renderer.setRenderTarget(to), renderer.render(bScene, bCam)
  }

  // ── the land and the lake, raymarched; the sky shows the aurora image, the water its mirror image ──
  scene.add(raymarch(noise + `
    uniform float lean, storm, T; uniform vec4 drops[4]; uniform vec2 res; uniform sampler2D tA, tM, tG, tGM; uniform vec3 ink, accent; varying vec3 vRay;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p), w = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), w.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), w.x), w.y); }
    float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
    float ridged(vec2 p, int oct){ float s = 0., a = .55; for (int i = 0; i < 6; i++) { if (i >= oct) break; float n = 1. - abs(vn(p) * 2. - 1.); s += a * n * n; p = p * 2.07 + vec2(3.1, 1.3); a *= .48; } return s; }
    // the land (lake level 0 here): a lake in front, a snow range beyond it, low hills closing the sides
    float land(vec2 q, int oct){
      float far = smoothstep(-19., -25., q.y) * smoothstep(-35., -29., q.y), side = 0.; // one range across the whole view, then open sky
      return ridged(q * vec2(.06, .08), oct) * 4.2 * far + side * (.35 + ridged(q * .2, 3) * .5) - .5 + far * .45 + fbm(q * .6) * .2 * (far + side) - 4. * smoothstep(-30., -37., q.y);
    }
    vec3 nrm(vec3 p){ float e = .04; return normalize(vec3(land(p.xz - vec2(e, 0.), 6) - land(p.xz + vec2(e, 0.), 6), 2. * e, land(p.xz - vec2(0., e), 6) - land(p.xz + vec2(0., e), 6))); }
    float march(vec3 ro, vec3 rd, float tmax, int steps, int oct){
      float t = .05;
      for (int i = 0; i < 110; i++) { if (i >= steps) break; vec3 p = ro + rd * t; float h = p.y - land(p.xz, oct); if (h < .002 * t) return t; if (p.y > 5. && rd.y > 0.) break; t += max(.02, h * .45); if (t > tmax) break; } // above every peak and climbing: it's sky
      return -1.;
    }
    float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    vec3 starLayer(vec3 rd, float scale, float density, float bright){  // stars as round sub-pixel points, one at most per cell
      vec3 g = rd * scale, id = floor(g), f = fract(g) - .5;
      float h = h3(id); if (h > density) return vec3(0.);
      vec3 o = vec3(h3(id + 7.1), h3(id + 3.7), h3(id + 9.3)) - .5; o *= .7;                       // where in the cell
      float d = length((f - o) - rd * dot(f - o, rd));                                                 // distance across the line of sight
      float m = pow(h3(id + 1.3), 14.) * bright + .025;                                                  // most faint, a few bright
      float tw = .75 + .25 * sin(T * (2. + h * 5.) + h * 90.) * smoothstep(.35, .0, rd.y);            // twinkling, near the horizon
      vec3 tint = mix(vec3(.85, .9, 1.), vec3(1., .88, .75), h3(id + 5.5));                             // blue-white to warm
      float px = .0009 * scale; return tint * m * tw * exp(-d * d / (2. * px * px));   // about a pixel across
    }
    vec3 sky(vec3 rd, float stars){
      float y = max(rd.y, 0.);
      vec3 c = mix(vec3(.007, .0065, .009) + accent * .006 * (1. + storm), vec3(.003, .003, .005), smoothstep(0., .4, y));     // a faint glow at the horizon, warmed by the aurora
      // the milky way: a band rising diagonally across the view, clumpy, split by dark dust lanes
      vec3 mwN = normalize(vec3(.3, -.6, -.12)); float b = dot(rd, mwN), band = exp(-b * b / .018), core = exp(-b * b / .004);
      float clouds = .5 + .3 * snoise(rd * 7.) + .2 * snoise(rd * 23.) + .1 * snoise(rd * 60.), dust = smoothstep(.15, .6, snoise(rd * 9. + vec3(3.)) * .5 + .5 + snoise(rd * 30.) * .2) * core;
      float mw = band * clouds * (1. - dust * .85) * smoothstep(.0, .25, y);
      c += vec3(.9, .85, .78) * max(mw, 0.) * .02 + vec3(.6, .7, .9) * mw * mw * .008;
      // the stars: three layers, thicker along the band
      float dens = 1. + band * 1.2;
      vec3 st = starLayer(rd, 220., .02 * dens, 2.) + starLayer(rd, 430., .03 * dens, .7) + starLayer(rd, 800., .045 * dens, .3);
      return c + st * smoothstep(.0, .12, y) * .22 * stars;
    }
    vec3 shade(vec3 p, float t){                              // snow where it can lie, rock where it can't; lit by the aurora and a low moon
      vec3 n = nrm(p); float h = p.y;
      float snow = smoothstep(.5, .75, n.y + fbm(p.xz * 2.5) * .3 - .1) * smoothstep(-.1, .9, h + fbm(p.xz * .7) * 1.1);
      vec3 alb = mix(vec3(.06, .055, .055), vec3(.55, .56, .6), snow);
      vec3 moon = normalize(vec3(-.55, .45, .7)), aur = normalize(vec3(.1, .8, -.6));
      vec3 light = vec3(.09, .1, .13) * (.55 + .45 * max(dot(n, moon), 0.)) + vec3(.03, .033, .045) * (n.y * .5 + .5)          // a soft moon, the night sky all round
                 + accent * vec3(1., .5, .45) * .09 * (1. + storm * .9) * (.6 + .4 * max(dot(n, aur), 0.));                  // and the aurora's red, from above and behind
      return alb * light;
    }
    vec4 trace(vec3 ro, vec3 rd, int steps, int oct){                  // .a: 1 land, 0 sky, -1 water
      float tw = rd.y < 0. ? -ro.y / rd.y : 1e3, t = march(ro, rd, min(tw, 90.), steps, oct);
      if (t > 0.) return vec4(mix(shade(ro + rd * t, t), sky(rd, 0.) * .9, 1. - exp(-t * .02)), 1.);   // far land fades into the sky behind it
      if (tw < 1e3) return vec4(0., 0., 0., -1.);
      return vec4(sky(rd, 1.), 0.);
    }
    vec3 sheet(sampler2D t, vec2 uv){                         // the rays smoothed sideways only: a seamless curtain that keeps its hem and folds
      vec3 c = vec3(0.); float w = 0.;
      for (int i = -8; i <= 8; i++) { float k = exp(-float(i * i) / 30.); c += texture2D(t, uv + vec2(float(i) * 2.5 / res.x * res.y / 1080., 0.)).rgb * k; w += k; }
      return c / w;
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / res;
      vec3 ro = cameraPosition - vec3(0., ${WL}, 0.), rd = normalize(vRay);
      vec4 c = trace(ro, rd, 110, 5);
      if (c.a == 0.) c.rgb += (sheet(tA, uv) * 1.1 + texture2D(tG, uv).rgb * 4.4) * res.y / 1080.;   // the curtain itself, and the glow it spreads   // the aurora where the sky is open: a glowing sheet, its rays faint within it
      if (c.a < 0.) {                                          // the lake: a mirror, rippled, darker where you look down into it
        float tw = -ro.y / rd.y; vec3 p = ro + rd * tw;
        vec2 w = p.xz;                                                                                              // ripples: a few long smooth waves, a little fine chop
        vec2 g = .006 * vec2(sin(w.x * .9 + w.y * 1.7 + T * .7) + .6 * sin(w.x * 2.3 - w.y * 1.1 + T * 1.1), cos(w.y * 2.6 - w.x * .6 + T * .8) + .5 * cos(w.y * 4.1 + w.x * 1.9 - T * 1.3))
               + .0025 * vec2(sin(w.x * 9. + w.y * 13. + T * 2.), cos(w.y * 11. - w.x * 7. + T * 2.3));
        float crest = 0.;
        for (int i = 0; i < 4; i++) {                                                                              // a stone's rings: a packet of waves running out, spreading and dying
          vec2 d = w - drops[i].xy; float r = length(d), a = T - drops[i].z; if (a < 0. || a > 8.) continue;
          float front = r - a * 1.1, env = exp(-front * front / (.05 + a * .18)) * exp(-a * .4) / (1. + r * .35) * smoothstep(.0, .15, a);
          float wv = sin(front * 9. - a * 3.) * env, sl = cos(front * 9. - a * 3.) * env;
          g += d / max(r, .01) * sl * .3;
          crest += max(wv, 0.) + exp(-r * r * 30.) * exp(-a * 3.);                                                   // and the splash where it went in
        }
        vec3 n = normalize(vec3(g.x, 1., g.y));
        vec3 r = reflect(rd, n); r.y = abs(r.y);
        vec4 rc = trace(p + vec3(0., .001, 0.), r, 64, 3);   // the water blurs it anyway: a coarser look if (rc.a < 0.) rc = vec4(sky(r), 0.);
        vec2 ru = uv + n.xz * vec2(.5, .12); if (rc.a == 0.) rc.rgb += (sheet(tM, ru) * .7 + texture2D(tGM, ru).rgb * 4.4) * res.y / 1080.;   // the aurora, mirrored, softened by the water
        float F = .03 + .97 * pow(1. - max(-rd.y, 0.), 5.);
        c.rgb = vec3(.004, .005, .007) + rc.rgb * mix(.6, 1., F) * .92;
        c.rgb += (accent * vec3(1., .55, .5) * .05 * (1. + storm) + vec3(.03, .033, .04)) * crest;                // the crests catch the aurora and the moon
        c.rgb = mix(c.rgb, vec3(.006, .0065, .009), 1. - exp(-tw * .018));
      }
      gl_FragColor = vec4(c.rgb, 1.);
    }`, { ...u, tA: { value: aRT.texture }, tM: { value: mRT.texture }, tG: { value: gB.texture }, tGM: { value: gN.texture } }))

  // ── fireflies: each follows a looping path (noise sampled round a circle, so it closes every 20 s), its trail the same path
  //    a moment earlier; they blink, and the light they shed stays in the trail. Drawn once as seen, once mirrored in the lake.
  const NF = 34, K = 44, fl = [], fs = [], hp = [], hs = []
  for (let i = 0; i < NF; i++) {
    const z = 0.5 - R() ** 0.8 * 15, f = [(R() - 0.5) * (3 + (6.5 - z) * 0.75), z, R() * 100, 2 + Math.floor(R() * 3)]
    for (let k = 0; k < K; k++) fl.push(k, i, 0, k + 1, i, 0), fs.push(...f, ...f)
    hp.push(0, i, 0), hs.push(...f)
  }
  const flyGLSL = noise + `uniform float T, lean, storm, mir; uniform vec2 res; uniform vec3 ink, accent; attribute vec4 f;
    vec3 fly(float t){                                                   // where this firefly is at time t (lake level is y = 0)
      float a = 6.2831853 * t / 20., s = f.z;
      vec2 c1 = vec2(cos(a), sin(a)), c2 = vec2(cos(2. * a + s), sin(2. * a + s));         // slow, wide drifts: one lap and a lazy second
      vec3 n = vec3(snoise(vec3(c1 * .75, s)) + .3 * snoise(vec3(c2 * .5, s + 3.)),
                    .6 * snoise(vec3(c1 * .6, s + 7.)) + .4 * sin(a * 2. + s * 5.),
                    snoise(vec3(c1 * .7, s + 17.)) + .3 * snoise(vec3(c2 * .45, s + 23.)));
      float hy = .15 + fract(s * .618) * .85;                                       // each keeps to its own height above the water
      vec3 p = vec3(f.x + n.x * (1.7 + storm * 1.5) + lean * .6, hy + n.y * (.12 + hy * .3), f.y + n.z * 1.8);
      float lf = 4. + floor(fract(s * .31) * 3.);                                    // and a few lazy loops along the way
      p += vec3(sin(a * lf + s), .45 * sin(a * (lf + 1.) + s * 2.), cos(a * lf + s)) * (.22 + .12 * fract(s * .77));
      p.z = min(p.z, 1.);                                                            // never right up against the lens
      p.y = max(p.y, .07 + .05 * sin(p.x * 3.));                                    // skimming, never touching the water
      if (mir > .5) p.x += .025 * sin(p.z * 5. + T * 2.3);                          // the ripples wobble the reflection
      return p;
    }
    float blink(float t){ float x = clamp(.5 + .5 * sin(6.2831853 * t / 20. * f.w + f.z * 7.), 0., 1.); x *= x; x *= x; return .1 + .9 * x * x; }`
  const flyMat = mirror => [new THREE.ShaderMaterial({                // the trail
    uniforms: { ...u, mir: { value: mirror } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: flyGLSL + `varying vec3 vC;
      void main(){
        float k = position.x, dt = .05, tk = T - k * dt, e = max(0., 1. - k / ${K}.);
        vec3 p = fly(tk);
        float b = blink(tk) * e * sqrt(e) * (1. + storm * .6);
        vC = mix(accent, mix(ink, accent, .35), e * e) * b * (mir > .5 ? .38 : 1.) * .9;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.); }`,
  }), new THREE.ShaderMaterial({                                      // the head: a soft point of light
    uniforms: { ...u, mir: { value: mirror } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: flyGLSL + `varying float vB;
      void main(){
        vec4 mv = modelViewMatrix * vec4(fly(T), 1.);
        vB = blink(T) * (1. + storm * .6) * (mir > .5 ? .38 : 1.);
        gl_PointSize = (8. + 26. * vB) / -mv.z * res.y / 1080. * 2.;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 ink, accent; varying float vB;
      void main(){ float r = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4((ink * exp(-r * r * 22.) * 1.4 + mix(ink, accent, .6) * exp(-r * r * 5.) * .5) * vB, 1.); }`,
  })]
  const flies = new THREE.Group(), mflies = new THREE.Group()
  for (const [g, m] of [[flies, 0], [mflies, 1]]) {
    const [tm, hm] = flyMat(m)
    const tg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fl, 3)).setAttribute('f', new THREE.Float32BufferAttribute(fs, 4))
    const hg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)).setAttribute('f', new THREE.Float32BufferAttribute(hs, 4))
    for (const o of [new THREE.LineSegments(tg, tm), new THREE.Points(hg, hm)]) (o.frustumCulled = false), (o.renderOrder = 5), g.add(o)
    g.position.y = WL, (g.scale.y = m ? -1 : 1), scene.add(g)
  }

  // click: on the lake, a stone thrown in; on the sky or the mountains, a substorm
  let stormAt = -9, now = 0, nd = 0
  const ray = new THREE.Raycaster(), lake = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WL), hit = new THREE.Vector3()
  addEventListener('pointerdown', () => {
    ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera)
    if (ray.ray.intersectPlane(lake, hit) && hit.z > -18.5) u.drops.value[nd++ % 4].set(hit.x, hit.z, now, 1)
    else stormAt = now
  })
  return (t, p) => {
    now = t
    u.T.value = t
    if (pointer.active) u.lean.value += (pointer.x * 1.6 - u.lean.value) * 0.03
    const s = t - stormAt; u.storm.value = s > 0 && s < 6 ? Math.sin(Math.min(1, s / 0.6) * Math.PI * 0.5) * Math.exp(-s * 0.55) : 0
    // the aurora as seen, and as the lake sees it (the world flipped about the water)
    renderer.getDrawingBufferSize(size)
    if (aRT.width !== size.x || aRT.height !== size.y) aRT.setSize(size.x, size.y), mRT.setSize(size.x, size.y)
    camera.updateMatrixWorld()
    renderer.setRenderTarget(aRT), renderer.setClearColor(0x000000, 1), renderer.clear(), renderer.render(aScene, camera)
    aGroup.scale.y = -1, (aGroup.position.y = WL), aGroup.updateMatrixWorld()
    renderer.setRenderTarget(mRT), renderer.clear(), renderer.render(aScene, camera)
    aGroup.scale.y = 1, aGroup.updateMatrixWorld()
    const qw = Math.max(1, size.x >> 2), qh = Math.max(1, size.y >> 2); if (gA.width !== qw || gA.height !== qh) [gA, gB, gM, gN].forEach(r => r.setSize(qw, qh))
    blur(aRT, gA, gB), blur(mRT, gM, gN), renderer.setRenderTarget(null)
  }
}, { loop: 20, blend: 2, eye: [0, -0.15, 6.5], drift: 0.12, bloom: 0.55, dpr: 1, parallax: 0.2, fog: 0 })
