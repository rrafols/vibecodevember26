import { go, THREE, U, R, TAU, pointer, raymarch } from '../lib/stage.js'

// 08 — cathedral: an endless nave through an infinite Menger sponge. Bone-grey stone, deep shadow, ember light hanging in the
// haze. The fractal repeats along the nave and the camera glides exactly two bays per loop, so it never ends.
// move: look around · click: fire a light deep down the nave · scroll: reshape the architecture
go('cathedral', ({ scene, camera }) => {
  const LOOP = 30, BAY = 4, SPAN = BAY * 2, NO = 8 // two bays per 30s loop: a slow, steady glide
  const u = { ...U, scale: { value: 0.32 }, orb: { value: Array.from({ length: NO }, () => new THREE.Vector4()) } }
  const quad = raymarch(`
    uniform float scale, phase, time; uniform vec3 ink, accent; uniform vec4 orb[${NO}]; varying vec3 vRay;
    mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
    float map(vec3 p){                                   // an infinite Menger sponge: square halls pierced by ever smaller openings
      p *= .5;                                           // its widest tunnels run along z through x = y = 0: that's the nave
      float d = -1e9, s = 1.;
      for (int m = 0; m < 4; m++) {
        vec3 a = mod(p * s, 2.) - 1.; s *= 3.;
        if (m > 0) a.xy *= rot(scale * float(m)), a.yz *= rot(scale * .5);    // twist the inner levels: from pure grid to gothic
        vec3 r = abs(1. - 3. * abs(a));
        d = max(d, (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.) / s);
      }
      return d / .5;                                     // positive in the openings: empty space
    }
    vec3 normal(vec3 p){ vec2 e = vec2(.0015, -.0015); return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx)); }
    float shadow(vec3 p, vec3 d, float far){ float s = 1., t = .03; for (int i = 0; i < 18 && t < far; i++) { float h = map(p + d * t); s = min(s, 10. * h / t); t += clamp(h, .03, .4); } return clamp(s, 0., 1.); }
    void main(){
      vec3 ro = cameraPosition, rd = normalize(vRay);
      float t = 0., h = 1.; int i;
      for (i = 0; i < 150; i++) { h = map(ro + rd * t); if (h < .0008 * t || t > 18.) break; t += h * .85; }
      if (i == 150) t = 18.;                                                            // never converged: treat as distance, not as a wall
      vec3 col = vec3(0.);
      if (t < 18.) {
        vec3 p = ro + rd * t, n = normal(p);
        float ao = 0.; for (int k = 1; k <= 4; k++) { float d = .06 * float(k); ao += (d - map(p + n * d)) / d; } ao = clamp(1. - ao * .3, 0., 1.);
        col = ink * .006 * (.5 + .5 * n.y) * ao;                                          // a whisper of skylight from the vaults
        for (int k = 0; k < ${NO}; k++) {                                               // the ember lights
          vec4 o = orb[k]; if (o.w <= 0.) continue;
          vec3 L = o.xyz - p; float d = length(L); L /= d;
          float fall = o.w * 1.4 / (1. + d * d * 6.), sh = fall > .02 ? shadow(p + n * .004, L, d) : 1.;
          col += mix(accent, ink, .25) * (max(dot(n, L), 0.) + .5 * pow(max(dot(reflect(-L, n), -rd), 0.), 18.)) * fall * sh * (.6 + .4 * ao); // + a glint on the edges
        }
        col *= 1. - float(i) / 220.;                                                    // grazing detail darkens: cheap cavity shading
      }
      col = mix(vec3(0.), col, exp(-t * .22));                                          // haze swallows the distance
      for (int k = 0; k < ${NO}; k++) {                                                 // light hanging in the haze
        vec4 o = orb[k]; if (o.w <= 0.) continue;
        vec3 w = o.xyz - ro; float s = clamp(dot(w, rd), 0., t), d = length(w - rd * s);
        col += (accent * .004 / (d * d + .01) + ink * .0012 / (d * d + .0006)) * o.w * exp(-s * .12) * step(0., dot(w, rd));
      }
      gl_FragColor = vec4(col, 1.);
    }`, u)
  scene.add(quad)

  // lights: four hang along the nave, repeating every two bays like the stone, so the loop is seamless · plus up to four you fire
  const auto = Array.from({ length: 4 }, (_, k) => ({ z: -k * 2 - 1, x: R(-0.35, 0.35), y: R(-0.3, 0.3), w: R(0.5, 0.8), ph: R(TAU) }))
  const mine = [], ray = new THREE.Raycaster(), D = new THREE.Vector3()
  let now = 0, yaw = 0, pitch = 0, sc = 0.32
  addEventListener('pointerdown', () => {
    ray.setFromCamera(pointer, camera), D.copy(ray.ray.direction), (D.x *= 0.35), (D.y *= 0.35), D.normalize() // aimed at the cursor, held to the nave
    mine.push({ t: now, o: camera.position.clone().addScaledVector(D, 0.9), d: D.clone() }), mine.length > 4 && mine.shift()
  })
  addEventListener('wheel', e => (sc = THREE.MathUtils.clamp(sc + e.deltaY * 0.0005, 0, 0.7)), { passive: true })

  return (t, p) => {
    now = t
    const a = p * TAU, z = -p * SPAN
    camera.position.set(Math.sin(a) * 0.07, Math.sin(2 * a) * 0.035, z) // barely a drift
    yaw += ((pointer.active ? pointer.x * 0.45 : 0) - yaw) * 0.025, (pitch += ((pointer.active ? pointer.y * 0.25 : 0) - pitch) * 0.025) // slow, gentle look
    camera.lookAt(camera.position.x + Math.sin(yaw), camera.position.y + Math.sin(pitch) - 0.02, z - Math.cos(yaw))
    u.scale.value += (sc - u.scale.value) * 0.05
    const O = u.orb.value
    auto.forEach((o, k) => { // each auto light keeps its place in the repeating nave, so it scrolls past exactly like the stone does
      const oz = z + ((((o.z - z) % SPAN) - SPAN) % SPAN) - 0.3, ahead = z - oz
      const near = THREE.MathUtils.smoothstep(ahead, 0.3, 2.4) * THREE.MathUtils.smoothstep(-ahead, -SPAN - 0.3, -SPAN + 2) // fade out before it reaches us, in at the far end
      O[k].set(o.x + Math.sin(a + o.ph) * 0.08, o.y + Math.sin(a + o.ph) * 0.05, oz, o.w * near * (0.85 + 0.15 * Math.sin(a * 3 + o.ph)))
    })
    for (let k = 0; k < 4; k++) { // fired lights race away into the deep, lighting the stone as they pass, and sink into the haze
      const m = mine[k], age = m ? t - m.t : 99
      if (!m || age > 7) { O[4 + k].set(0, 0, 0, 0); continue }
      const q = m.o.clone().addScaledVector(m.d, age * 5.5 + age * age * 0.4)
      O[4 + k].set(q.x, q.y, q.z, 1.6 * Math.min(1, age * 4) * Math.min(1, (7 - age) / 2) * THREE.MathUtils.smoothstep(camera.position.distanceTo(q), 0.5, 1.4))
    }
  }
}, { loop: 30, drift: 0, bloom: 0.7, dpr: 1 })
