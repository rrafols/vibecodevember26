import { go, THREE, U, TAU, pointer, raymarch } from '../lib/stage.js'

// 17 — relic: a twisted crystal with an ember heart. Every ray reflects off its skin, refracts in, bounces off its inner faces
// (total internal reflection) and refracts out into a dark studio, picking up the heart's glow on the way; red and blue bend
// by slightly different amounts, so edges fringe.
// drag: turn it · hover: move the light · click: the heart flares
go('relic', ({ scene }) => {
  const LOOP = 16
  const u = { ...U, rot: { value: new THREE.Matrix3() }, light: { value: new THREE.Vector2(0.4, 0.8) }, flare: { value: 0 } }
  scene.add(raymarch(`
    uniform mat3 rot; uniform vec2 light; uniform float flare; uniform vec3 ink, accent; varying vec3 vRay;
    float gem0(vec3 p){                                    // a hexagonal column, barely twisted, with long pointed tips
      float d = -1e9;
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + p.y * .1; d = max(d, dot(p.xz, vec2(cos(a), sin(a))) - .58); }
      vec3 q = vec3(p.x, abs(p.y), p.z);
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + .5236; d = max(d, dot(q, normalize(vec3(cos(a) * 1.25, 1., sin(a) * 1.25))) - 1.22); }
      return d;
    }
    float gem(vec3 p){ return gem0(p * 1.45) / 1.45; } // sized to sit in frame, tips and all
    vec3 nrm(vec3 p){ vec2 e = vec2(.001, -.001); return normalize(e.xyy * gem(p + e.xyy) + e.yyx * gem(p + e.yyx) + e.yxy * gem(p + e.yxy) + e.xxx * gem(p + e.xxx)); }
    vec3 env(vec3 d){                                     // a dark studio: a key softbox you can move, a horizon hairline, an ember panel
      vec3 k = normalize(vec3(cos(light.x) * cos(light.y), sin(light.y), sin(light.x) * cos(light.y)));
      return ink * (smoothstep(.93, .99, dot(d, k)) * 2.6 + smoothstep(.95, .995, dot(d, normalize(vec3(-.8, .5, .4)))) * 1.4 + exp(-pow(d.y * 14., 2.)) * .035) // key + back rim + horizon
           + accent * smoothstep(.93, .99, dot(d, normalize(vec3(-.7, -.25, -.6)))) * 1.6;
    }
    vec3 heart(vec3 q){ float r2 = dot(q, q); return (accent * 1.3 * exp(-r2 * 22.) + ink * 2.5 * exp(-r2 * 260.)) * (1. + flare * 2.5); }
    vec3 through(vec3 p, vec3 d, float ior){              // inside the crystal: march to a face, refract out or reflect back (TIR)
      vec3 glow = vec3(0.);
      for (int b = 0; b < 3; b++) {
        float t = .02;
        for (int i = 0; i < 48; i++) { vec3 q = p + d * t; float h = -gem(q); glow += heart(q) * .045; if (h < .001) break; t += clamp(h, .02, .09); }
        p += d * t; vec3 n = nrm(p), o = refract(d, -n, ior);
        if (dot(o, o) > 0.) return glow + env(o) * vec3(1., .96, .92) * .9;    // out: a little warm absorption
        d = reflect(d, -n), p += d * .003;
      }
      return glow;
    }
    void main(){
      vec3 ro = rot * cameraPosition, rd = rot * normalize(vRay);
      float t = 0.;
      for (int i = 0; i < 80; i++) { float h = gem(ro + rd * t); if (h < .001 || t > 20.) break; t += h * .9; }
      if (t > 20.) discard;
      vec3 p = ro + rd * t, n = nrm(p);
      float F = .04 + .96 * pow(1. - max(dot(-rd, n), 0.), 5.);
      vec3 r = through(p - n * .003, refract(rd, n, 1. / 1.57), 1.57), b = through(p - n * .003, refract(rd, n, 1. / 1.62), 1.62); // dispersion
      vec3 m = (r + b) * .5, tr = mix(m, vec3(r.r, m.g, b.b), .45);   // a hint of fringing, kept near the palette
      vec3 c = env(reflect(rd, n)) * F + tr * (1. - F);
      gl_FragColor = vec4(c, 1.);
    }`, u))

  const E = new THREE.Euler(0, 0, 0, 'YXZ'), M = new THREE.Matrix4()
  let down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0, flareAt = -9, now = 0
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.hypot(pointer.x - lx, pointer.y - ly); if (down.moved > 0.02) (vy = (pointer.x - lx) * 3), (vp = -(pointer.y - ly) * 2), (yaw += vy), (pitch += vp); (lx = pointer.x), (ly = pointer.y) })
  addEventListener('pointerup', () => { if (down && down.moved < 0.02) flareAt = now; down = null })

  return (t, p) => {
    now = t
    if (!down) (yaw += vy *= 0.93), (pitch += vp *= 0.93)
    M.makeRotationFromEuler(E.set(Math.sin(p * TAU) * 0.18 + pitch, p * TAU + yaw, 0.12)) // one full turn per loop
    u.rot.value.setFromMatrix4(M).transpose()           // rays into the crystal's frame
    if (pointer.active && !down) u.light.value.lerp(new THREE.Vector2(pointer.x * 2.2 + 0.4, 0.8 + pointer.y * 0.7), 0.05)
    const beat = 0.6 * (0.5 + 0.5 * Math.cos(p * TAU * 2)) ** 14 // the heart beats twice a loop on its own, smoothly: no pop at the wrap
    u.flare.value = Math.max(beat, Math.exp(-(t - flareAt) * 2.5) * 1.6)
  }
}, { loop: 16, eye: [0, 0.2, 6.4], drift: 0.4, bloom: 0.75, dpr: 1 })
