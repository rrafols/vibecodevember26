import { go, THREE, U, R, TAU, noise, pointer, raymarch } from '../lib/stage.js'

// 04 — event horizon: light bent around a black hole, ray by ray. The disk's far side arches over the top,
// a hairline photon ring hugs the shadow, the approaching side burns brighter.
// drag: tilt · move: a second, small mass warps the light near the cursor · click: drop a flare into the disk
go('event horizon', ({ scene, camera }) => {
  const LOOP = 12
  const u = { ...U, tilt: { value: 0.12 }, m2: { value: new THREE.Vector4() }, fl: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) } }
  scene.add(raymarch(noise + `
    uniform float time, phase, tilt; uniform vec3 ink, accent, fl[4]; uniform vec4 m2; varying vec3 vRay;
    const float LOOP = ${LOOP}.;
    float sq(float x){ return x * x; }
    float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

    // plasma: streaks orbiting at Kepler speed. Two copies a loop apart, crossfaded → seamless even though every radius spins differently
    float plasma(float r, float a, float t){
      float w = .9 * pow(r, -1.5) * 7., A = a - w * t;
      return .5 + .5 * snoise(vec3(r * 2.4, cos(A) * 1.6, sin(A) * 1.6)) * .8 + .25 * snoise(vec3(r * 9., cos(A) * 5., sin(A) * 5.));
    }
    vec4 disk(vec3 x, vec3 v, vec3 n, vec3 e1, vec3 e2){
      float r = length(x), a = atan(dot(x, e2), dot(x, e1)), t = phase * LOOP;
      if (r < 2.4 || r > 7.5) return vec4(0.);
      float s = pow(max(mix(plasma(r, a, t), plasma(r, a, t - LOOP), phase), 0.), 2.2) * 1.8; // max(): pow of a negative is NaN, and bloom smears one NaN over the whole frame
      for (int i = 0; i < 4; i++) {                                     // flares spiralling inwards
        vec3 f = fl[i]; if (f.z <= 0.) continue;
        float fr = 7. - f.y * 1.3, fa = f.x + f.y * 1.1 * pow(max(fr, 2.4), -1.5) * 7.;
        s += f.z * 4. * exp(-f.y * .35) * exp(-(r - fr) * (r - fr) * 6. - sq(atan(sin(a - fa), cos(a - fa)) * r) * 1.5) * step(2.4, fr);
      }
      vec3 orb = normalize(cross(n, x));                                 // orbital direction
      float beam = pow(1. + .6 * dot(orb, -v), 2.5);                     // Doppler: the side rushing at us burns brighter
      float heat = smoothstep(7.5, 2.4, r), edge = smoothstep(2.4, 2.7, r) * smoothstep(7.5, 4.5, r);
      vec3 c = mix(accent * .12, mix(accent * .7, ink * 1.3, smoothstep(.8, 1., heat)), heat * heat) * s * beam * edge;
      return vec4(c, clamp(s * edge * .9, 0., 1.));
    }
    void main(){
      vec3 p = cameraPosition, v = normalize(vRay), n = vec3(0., cos(tilt), sin(tilt)), e1 = vec3(1., 0., 0.), e2 = cross(n, e1);
      vec3 col = vec3(0.); float al = 0., ring = 0.;
      float h2 = dot(cross(p, v), cross(p, v));
      for (int i = 0; i < 260; i++) {
        float r = length(p);
        if (r < 1. || al > .99) { al = 1.; break; }                      // swallowed
        float dt = clamp(.05 * r * r, .012, 1.2);
        vec3 a = -1.5 * h2 * p / pow(r, 5.);                             // Schwarzschild light bending (Rs = 1)
        vec3 q = p - m2.xyz; a -= m2.w * q / pow(dot(q, q) + .08, 1.5);  // the cursor's little mass
        vec3 pn = p + v * dt;
        float s0 = dot(p, n), s1 = dot(pn, n);
        if (s0 * s1 < 0.) { vec4 d = disk(mix(p, pn, s0 / (s0 - s1)), v, n, e1, e2); col += d.rgb * (1. - al); al += d.a * (1. - al); }
        ring += exp(-sq((r - 1.5) * 9.)) * dt;                      // grazing the photon sphere
        v = normalize(v + a * dt); p = pn;
        if (r > 60.) break;
      }
      vec3 bg = vec3(0.);
      if (al < 1.) { vec3 c = floor(v * 180.); bg = ink * step(.9985, h(c)) * h(c + 1.) * .6; } // faint stars, lensed with everything else
      col += (ring * ink * 1.2 + bg) * (1. - al);
      if (dot(col, col) < 1e-6 && al < .01) discard;
      gl_FragColor = vec4(col, 1.);
    }`, u))

  // ── interaction ──
  const auto = [0.1, 0.55].map(at => ({ a: R(TAU), at })), mine = [], ray = new THREE.Raycaster(), plane = new THREE.Plane(), C = new THREE.Vector3(), V = new THREE.Vector3()
  let now = 0, down = null, tilt = 0.12, tiltS = 0.12, mass = 0
  addEventListener('pointerdown', () => (down = { x: pointer.x, y: pointer.y, t: now, tilt }))
  addEventListener('pointermove', () => down && (tilt = THREE.MathUtils.clamp(down.tilt + (pointer.y - down.y) * 0.9, -0.6, 1.2)))
  addEventListener('pointerup', () => {
    if (down && now - down.t < 0.25 && Math.hypot(pointer.x - down.x, pointer.y - down.y) < 0.02) mine.push({ a: Math.atan2(pointer.x, -pointer.y), t: now }), mine.length > 2 && mine.shift()
    down = null
  })

  return (t, p) => {
    now = t
    tiltS += (tilt - tiltS) * 0.08 // smooth only the user's drag; the loop's own wobble stays exact → seamless
    u.tilt.value = tiltS + Math.sin(p * TAU) * 0.05
    auto.forEach((f, i) => u.fl.value[i].set(f.a, ((p - f.at + 1) % 1) * LOOP, 1))
    for (let i = 0; i < 2; i++) mine[i] ? u.fl.value[2 + i].set(mine[i].a, t - mine[i].t, 1.4) : u.fl.value[2 + i].set(0, 0, 0)
    if (pointer.active) {
      ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(C), V.set(0, 0, 0)), C)
      mass += (0.35 - mass) * 0.05
      u.m2.value.set(C.x, C.y, C.z, mass)
    }
  }
}, { loop: 12, eye: [0, 0.9, 28], bloom: 0.45 })
