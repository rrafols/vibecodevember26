import { go, THREE, U, R, TAU, pointer, raymarch } from '../lib/stage.js'

// 17 — relic: a twisted crystal with an ember heart. Every ray reflects off its skin, refracts in, bounces off its inner faces
// (total internal reflection) and refracts out into a dark studio, picking up the heart's glow on the way; red and blue bend
// by slightly different amounts, so edges fringe.
// Struck, it fractures: a rough, conchoidal break (the two faces still mate), a thin ember seam where the heart shows through,
// the pieces drift apart with a slight turn. Strike a piece and only that piece breaks again. A few seconds later it fuses.
// drag: turn it · hover: move the light · click: break the piece under the cursor
go('relic', ({ scene, camera }) => {
  const LOOP = 16, NP = 4
  const u = { ...U, rot: { value: new THREE.Matrix3() }, light: { value: new THREE.Vector2(0.4, 0.8) }, flare: { value: 0 },
    pl: { value: [new THREE.Vector4(), new THREE.Vector4()] }, po: { value: Array.from({ length: NP }, () => new THREE.Vector4()) },
    ps: { value: Array.from({ length: NP }, () => new THREE.Vector2()) }, pr: { value: Array.from({ length: NP }, () => new THREE.Matrix3()) }, open: { value: 0 } }
  scene.add(raymarch(`
    uniform mat3 rot, pr[${NP}]; uniform vec2 light, ps[${NP}]; uniform float flare, open; uniform vec4 pl[2], po[${NP}]; uniform vec3 ink, accent; varying vec3 vRay;
    float gem0(vec3 p){                                    // a hexagonal column, barely twisted, with long pointed tips
      float d = -1e9;
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + p.y * .1; d = max(d, dot(p.xz, vec2(cos(a), sin(a))) - .58); }
      vec3 q = vec3(p.x, abs(p.y), p.z);
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + .5236; d = max(d, dot(q, normalize(vec3(cos(a) * 1.25, 1., sin(a) * 1.25))) - 1.22); }
      return d;
    }
    float gem(vec3 p){ return gem0(p * 1.45) / 1.45; } // sized to sit in frame, tips and all
    // a fracture surface: a plane made rough and wavy (conchoidal), the same surface for both sides so the pieces mate
    float rough = 1.;                                      // full roughness for the surface we see, less for rays inside (no speckle)
    float brk(int k, vec3 q){
      vec4 P = pl[k]; vec3 s = q * 1.7 + float(k) * 4.1;
      float r = sin(dot(s, vec3(7.1, 9.3, 5.7))) * .5 + sin(dot(s, vec3(-13.7, 6.1, 11.3)) + 1.3) * .25 + sin(dot(s, vec3(23.1, -19.7, 17.3)) + 2.1) * .12 + sin(dot(s, vec3(-41., 37., 29.)) + .7) * .05;
      return dot(P.xyz, q) - P.w + r * .035 * rough;
    }
    // every piece: its own small move and turn, the gem cut by its side of each break it has
    float scene(vec3 p, out vec3 qb, out int id){
      float best = 1e9; qb = p; id = 0;
      for (int i = 0; i < ${NP}; i++) {
        if (po[i].w < .5) continue;
        vec3 q = pr[i] * (p - po[i].xyz); float d = gem(q);
        if (ps[i].x != 0.) d = max(d, -ps[i].x * brk(0, q) * .7); if (ps[i].y != 0.) d = max(d, -ps[i].y * brk(1, q) * .7);
        if (d < best) best = d, qb = q, id = i;
      }
      return best;
    }
    float sc(vec3 p){ vec3 q; int i; return scene(p, q, i); }
    float seam(vec3 q, int i){                            // how close to one of this piece's fracture faces
      float g = 1e9; if (ps[i].x != 0.) g = abs(brk(0, q)); if (ps[i].y != 0.) g = min(g, abs(brk(1, q)));
      return exp(-g * 120.) * exp(-abs(gem(q)) * 70.) * open; // only where the break meets the old skin: a hairline
    }
    vec3 nrm(vec3 p){ vec2 e = vec2(.001, -.001); return normalize(e.xyy * sc(p + e.xyy) + e.yyx * sc(p + e.yyx) + e.yxy * sc(p + e.yxy) + e.xxx * sc(p + e.xxx)); }
    vec3 env(vec3 d){                                     // a dark studio: a key softbox you can move, a horizon hairline, an ember panel
      vec3 k = normalize(vec3(cos(light.x) * cos(light.y), sin(light.y), sin(light.x) * cos(light.y)));
      return ink * (smoothstep(.93, .99, dot(d, k)) * 2.6 + smoothstep(.95, .995, dot(d, normalize(vec3(-.8, .5, .4)))) * 1.4 + exp(-pow(d.y * 14., 2.)) * .035) // key + back rim + horizon
           + accent * smoothstep(.93, .99, dot(d, normalize(vec3(-.7, -.25, -.6)))) * 1.6;
    }
    vec3 heart(vec3 q){ float r2 = dot(q, q); return (accent * 1.3 * exp(-r2 * 22.) + ink * 2.5 * exp(-r2 * 260.)) * (1. + flare * 2.5) * (1. - open * .45); } // dimmer while broken: it bleeds out
    vec3 through(vec3 p, vec3 d, float ior){              // inside the crystal: march to a face, refract out or reflect back (TIR)
      vec3 glow = vec3(0.); rough = .25;
      for (int b = 0; b < 3; b++) {
        float t = .02;
        for (int i = 0; i < 48; i++) { vec3 q = p + d * t, qb; int id; float h = -scene(q, qb, id); glow += heart(qb) * .045; if (h < .001) break; t += clamp(h, .02, .09); }
        p += d * t; vec3 n = nrm(p), o = refract(d, -n, ior);
        if (dot(o, o) > 0.) { rough = 1.; return glow + env(o) * vec3(1., .96, .92) * .9; }    // out: a little warm absorption
        d = reflect(d, -n), p += d * .003;
      }
      rough = 1.; return glow;
    }
    void main(){
      vec3 ro = rot * cameraPosition, rd = rot * normalize(vRay);
      float t = 0.;
      float h = 1.;
      for (int i = 0; i < 140; i++) { h = sc(ro + rd * t); if (h < .001 || t > 20.) break; t += h * .85; }
      if (t > 20. || h > .006) discard;                  // never reached a surface (e.g. looking down the gap of a break): see through
      vec3 p = ro + rd * t, n = nrm(p), qb; int id; scene(p, qb, id);
      float k = seam(qb, id), face = exp(-abs(ps[id].x != 0. ? brk(0, qb) : 1.) * 40.) + exp(-abs(ps[id].y != 0. ? brk(1, qb) : 1.) * 40.);
      float F = .04 + .96 * pow(1. - max(dot(-rd, n), 0.), 5.);
      vec3 r = through(p - n * .003, refract(rd, n, 1. / 1.57), 1.57), b = through(p - n * .003, refract(rd, n, 1. / 1.62), 1.62); // dispersion
      vec3 m = (r + b) * .5, tr = mix(m, vec3(r.r, m.g, b.b), .45);   // a hint of fringing, kept near the palette
      vec3 c = env(reflect(rd, n)) * F + tr * (1. - F);
      c = mix(c, c * .14 + ink * .035 + m * .04, clamp(face, 0., 1.) * open);   // broken faces: frosted, duller than the cut ones
      c += accent * k * .9 + ink * k * k * .3;                                // a thin ember seam along the break
      gl_FragColor = vec4(c, 1.);
    }`, u))

  // ── the pieces: each has its side (−1, 0 = untouched, +1) of each break, a drift and a turn ──
  const pieces = [{ s: [0, 0], off: new THREE.Vector3(), to: new THREE.Vector3(), ax: new THREE.Vector3(0, 1, 0), ang: 0, angTo: 0 }]
  const planes = [] // { n, c }
  let lastHit = -9, healing = false
  const M4 = new THREE.Matrix4(), V = new THREE.Vector3(), Mi = new THREE.Matrix3(), RT = new THREE.Matrix3()
  const centre = pc => { // a rough centre for a piece, in the crystal's frame: the middle, pushed to its side of each break
    V.set(0, 0, 0); pc.s.forEach((s, k) => s && planes[k] && V.addScaledVector(planes[k].n, s * 0.32)); return V.clone().add(pc.off)
  }
  const strike = (sx, sy) => {
    // which piece is under the cursor: the one whose centre lands nearest on screen
    RT.copy(u.rot.value).transpose()
    let pick = 0, best = 1e9
    pieces.forEach((pc, i) => { const w = centre(pc).applyMatrix3(RT).project(camera), d = Math.hypot(w.x - sx, w.y - sy); if (d < best) (best = d), (pick = i) })
    const pc = pieces[pick], k = pc.s[0] === 0 ? 0 : pc.s[1] === 0 ? 1 : -1
    lastHit = now, (flareAt = now), (healing = false)
    if (k < 0 || pieces.length >= NP) return                              // already in its smallest pieces: it only flares
    // the break: across the screen, perpendicular to the line from the piece's centre to the click, through the piece
    const cw = centre(pc).applyMatrix3(RT).project(camera), dx = sx - cw.x, dy = sy - cw.y, l = Math.hypot(dx, dy)
    const n = new THREE.Vector3(l > 0.02 ? dx / l : 1, l > 0.02 ? dy / l : 0.3, R(-0.3, 0.3)).normalize().applyMatrix3(Mi.copy(u.rot.value)).normalize()
    if (!planes[k]) planes[k] = { n, c: n.dot(centre(pc)) }
    const P = planes[k], twin = { s: pc.s.slice(), off: pc.off.clone(), to: new THREE.Vector3(), ax: new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize(), ang: pc.ang, angTo: 0 }
    pc.s[k] = -1, (twin.s[k] = 1)
    for (const [q, sgn] of [[pc, -1], [twin, 1]]) q.to.copy(q.off).addScaledVector(P.n, sgn * R(0.1, 0.16)).add(V.set(R(-0.03, 0.03), R(-0.03, 0.03), R(-0.03, 0.03))), (q.angTo = q.ang + R(0.08, 0.2) * sgn), q.ax.set(R(-1, 1), R(-1, 1), R(-1, 1)).normalize()
    pieces.push(twin)
  }

  const E = new THREE.Euler(0, 0, 0, 'YXZ'), M = new THREE.Matrix4()
  let down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0, flareAt = -9, now = 0, lastP = 0
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.hypot(pointer.x - lx, pointer.y - ly); if (down.moved > 0.02) (vy = (pointer.x - lx) * 3), (vp = -(pointer.y - ly) * 2), (yaw += vy), (pitch += vp); (lx = pointer.x), (ly = pointer.y) })
  addEventListener('pointerup', () => { if (down && down.moved < 0.02) strike(pointer.x, pointer.y); down = null })

  return (t, p) => {
    const dt = Math.min(1 / 30, Math.max(0, t - now)); now = t
    if (!down) (yaw += vy *= 0.93), (pitch += vp *= 0.93)
    M.makeRotationFromEuler(E.set(Math.sin(p * TAU) * 0.18 + pitch, p * TAU + yaw, 0.12)) // one full turn per loop
    u.rot.value.setFromMatrix4(M).transpose()           // rays into the crystal's frame
    if (pointer.active && !down) u.light.value.lerp(new THREE.Vector2(pointer.x * 2.2 + 0.4, 0.8 + pointer.y * 0.7), 0.05)
    const beat = 0.6 * (0.5 + 0.5 * Math.cos(p * TAU * 2)) ** 14 // the heart beats twice a loop on its own, smoothly: no pop at the wrap
    u.flare.value = Math.max(beat, Math.exp(-(t - flareAt) * 3) * 0.5)
    // the loop breaks it, then breaks one of the halves, and lets it heal before the wrap
    if (lastP < 0.5 && p >= 0.5) strike(0.45, 0.3)
    if (lastP < 0.58 && p >= 0.58) strike(-0.3, -0.35)
    lastP = p
    // a few seconds after the last blow the pieces drift home and fuse
    if (pieces.length > 1 && now - lastHit > 3.2) (healing = true), pieces.forEach(pc => (pc.to.set(0, 0, 0), (pc.angTo = 0)))
    let far = 0
    pieces.forEach(pc => { const k = 1 - Math.exp(-dt * (healing ? 2.2 : 5)); pc.off.lerp(pc.to, k), (pc.ang += (pc.angTo - pc.ang) * k), (far = Math.max(far, pc.off.length())) })
    if (healing && far < 0.003) pieces.splice(1), (pieces[0].s = [0, 0]), pieces[0].off.set(0, 0, 0), (pieces[0].ang = 0), (planes.length = 0), (healing = false)
    u.open.value = Math.min(1, far / 0.05)
    for (let i = 0; i < NP; i++) {
      const pc = pieces[i]
      if (!pc) { u.po.value[i].w = 0; continue }
      u.po.value[i].set(pc.off.x, pc.off.y, pc.off.z, 1), u.ps.value[i].set(pc.s[0], pc.s[1])
      u.pr.value[i].setFromMatrix4(M4.makeRotationAxis(pc.ax, -pc.ang))
    }
    planes.forEach((P, k) => u.pl.value[k].set(P.n.x, P.n.y, P.n.z, P.c))
  }
}, { loop: 16, eye: [0, 0.2, 6.4], drift: 0.4, bloom: 0.75, dpr: 1 })
