import { go, THREE, U, R, TAU, pointer, raymarch } from '../lib/stage.js'

// 17 — relic: a twisted crystal with an ember heart. Every ray reflects off its skin, refracts in, bounces off its inner faces
// (total internal reflection) and refracts out into a dark studio, picking up the heart's glow on the way; red and blue bend
// by slightly different amounts, so edges fringe.
// Struck, it fractures: rough conchoidal breaks (the faces still mate), a hairline ember seam, a web of micro-fractures around
// each break, chips spalling off. Each blow breaks the piece you hit and the crack branches on through it; strike the pieces
// again and they break again, up to ten. A few seconds after the last blow they drift home and fuse.
// drag: turn it · hover: move the light · click: break the piece under the cursor
go('relic', ({ scene, camera }) => {
  const LOOP = 16, NP = 10, NPL = 7
  const u = { ...U, rot: { value: new THREE.Matrix3() }, light: { value: new THREE.Vector2(0.4, 0.8) }, flare: { value: 0 }, open: { value: 0 }, cutW: { value: 1 }, cutI: { value: 1 }, disp: { value: 1 },
    pl: { value: Array.from({ length: NPL }, () => new THREE.Vector4()) }, po: { value: Array.from({ length: NP }, () => new THREE.Vector4()) },
    pb: { value: Array.from({ length: NP }, () => new THREE.Vector4()) }, ps: { value: new Float32Array(NP * NPL) }, pr: { value: Array.from({ length: NP }, () => new THREE.Matrix3()) } }
  scene.add(raymarch(`
    uniform mat3 rot, pr[${NP}]; uniform vec2 light; uniform float flare, open, cutW, cutI, disp, ps[${NP * NPL}]; uniform vec4 pl[${NPL}], po[${NP}], pb[${NP}]; uniform vec3 ink, accent; varying vec3 vRay;
    float gem0(vec3 p){                                    // a hexagonal column, barely twisted, with long pointed tips
      float d = -1e9;
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + p.y * .1; d = max(d, dot(p.xz, vec2(cos(a), sin(a))) - .58); }
      vec3 q = vec3(p.x, abs(p.y), p.z);
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + .5236; d = max(d, dot(q, normalize(vec3(cos(a) * 1.25, 1., sin(a) * 1.25))) - 1.22); }
      return d;
    }
    float gem(vec3 p){ return gem0(p * 1.45) / 1.45; } // sized to sit in frame, tips and all
    float rough = 1., cw = 1.;                             // cw: how much the breaks count (the outline melts late, the light inside early)                                      // full roughness for the surface we see, less for rays inside (no speckle)
    float brk(int k, vec3 q){                              // a fracture: a plane made rough and wavy; one surface for both sides, so they mate
      vec4 P = pl[k]; vec3 s = q * 1.7 + float(k) * 4.1;
      float r = sin(dot(s, vec3(7.1, 9.3, 5.7))) * .5 + sin(dot(s, vec3(-13.7, 6.1, 11.3)) + 1.3) * .25 + sin(dot(s, vec3(23.1, -19.7, 17.3)) + 2.1) * .08; // slope ≤ ~1.85: stepped at .5 below
      return dot(P.xyz, q) - P.w + r * .035 * rough;
    }
    float piece(int i, vec3 p, out vec3 q){
      q = pr[i] * (p - po[i].xyz); float d0 = gem(q), d = d0;
      for (int k = 0; k < ${NPL}; k++) { float sg = ps[i * ${NPL} + k]; if (sg != 0.) d = max(d, -sg * brk(k, q) * .5); }
      return mix(d0, d, cw);                              // as the pieces come home the breaks melt away: no last-moment gaps
    }
    float scene(vec3 p, out vec3 qb, out int id){
      float best = 1e9; qb = p; id = 0;
      for (int i = 0; i < ${NP}; i++) {
        if (po[i].w < .5) continue;
        if (length(p - pb[i].xyz) - pb[i].w > best) continue;   // too far to matter: skip the piece
        vec3 q; float d = piece(i, p, q);
        if (d < best) best = d, qb = q, id = i;
      }
      return best;
    }
    float sc(vec3 p){ vec3 q; int i; return scene(p, q, i); }
    float near(vec3 q, int i, float w){                    // closeness to any of this piece's breaks
      float g = 1e9; for (int k = 0; k < ${NPL}; k++) if (ps[i * ${NPL} + k] != 0.) g = min(g, abs(brk(k, q)));
      return exp(-g * w);
    }
    vec3 nrm(vec3 p){ vec2 e = vec2(.0015, -.0015); return normalize(e.xyy * sc(p + e.xyy) + e.yyx * sc(p + e.yyx) + e.yxy * sc(p + e.yxy) + e.xxx * sc(p + e.xxx)); }
    float pc(int i, vec3 p){ vec3 q; return piece(i, p, q); }
    vec3 nrmP(int i, vec3 p){ vec2 e = vec2(.0015, -.0015); return normalize(e.xyy * pc(i, p + e.xyy) + e.yyx * pc(i, p + e.yyx) + e.yxy * pc(i, p + e.yxy) + e.xxx * pc(i, p + e.xxx)); }
    vec3 env(vec3 d){                                     // a dark studio: a key softbox you can move, a horizon hairline, an ember panel
      vec3 k = normalize(vec3(cos(light.x) * cos(light.y), sin(light.y), sin(light.x) * cos(light.y)));
      return ink * (smoothstep(.93, .99, dot(d, k)) * 2.6 + smoothstep(.95, .995, dot(d, normalize(vec3(-.8, .5, .4)))) * 1.4 + exp(-pow(d.y * 14., 2.)) * .035) // key + back rim + horizon
           + accent * smoothstep(.93, .99, dot(d, normalize(vec3(-.7, -.25, -.6)))) * 1.6;
    }
    vec3 heart(vec3 q){ float r2 = dot(q, q); return (accent * 1.3 * exp(-r2 * 22.) + ink * 2.5 * exp(-r2 * 260.)) * (1. + flare * 2.5) * (1. - open * .45); }
    vec3 through0(vec3 p, vec3 d, float ior, int id, float ci){ // inside one piece: march to its face, refract out or reflect back (TIR); cracks don't act as mirrors
      vec3 glow = vec3(0.); rough = 0.; cw = ci;
      for (int b = 0; b < 3; b++) {
        float t = .02;
        for (int i = 0; i < 40; i++) { vec3 qb; float h = -piece(id, p + d * t, qb); glow += heart(qb) * .054; if (h < .001) break; t += clamp(h * .5, .02, .1); }
        p += d * t; vec3 n = nrmP(id, p), o = refract(d, -n, ior);
        if (dot(o, o) > 0.) { rough = 1., cw = cutW; return glow + env(o) * vec3(1., .96, .92) * .9; }
        d = reflect(d, -n), p += d * .003;
      }
      rough = 1., cw = cutW; return glow;
    }
    vec3 through(vec3 p, vec3 d, float ior, int id){        // while it fuses: the broken and the whole light, cross-faded (blending the shapes would jump)
      if (cutI >= 1.) return through0(p, d, ior, id, 1.);
      if (cutI <= 0.) return through0(p, d, ior, id, 0.);
      return mix(through0(p, d, ior, id, 0.), through0(p, d, ior, id, 1.), cutI);
    }
    void main(){
      vec3 ro = rot * cameraPosition, rd = rot * normalize(vRay); cw = cutW;
      float t = 0., h = 1.;
      int steps = open > 0. || po[1].w > .5 ? 200 : 110;
      for (int i = 0; i < 200; i++) { if (i >= steps) break; h = sc(ro + rd * t); if (h < .001 || t > 20.) break; t += h * .9; }
      if (t > 20. || h > .006) discard;                    // never reached a surface (e.g. down the gap of a break): see through
      vec3 p = ro + rd * t, n = nrm(p), qb; int id; scene(p, qb, id);
      float face = near(qb, id, 40.) * open, seam = near(qb, id, 120.) * exp(-abs(gem(qb)) * 70.) * open;
      // micro-fractures: a web of fine lines on the skin, densest by the breaks
      vec3 w = qb * 7.; float web = sin(w.x * 1.13 + 1.7 * sin(w.y * .71 + w.z * 1.31)) + sin(w.y * .87 - 1.9 * sin(w.z * .53 - w.x * .97) + 1.1) + sin(w.z * 1.29 + 1.5 * sin(w.x * .61 + w.y * 1.17) + 2.3); // irregular, not a lattice
      float craze = exp(-abs(web) * 28.) * near(qb, id, 22.) * open;
      float F = .04 + .96 * pow(1. - max(dot(-rd, n), 0.), 5.);
      float fz = clamp(face * 1.5, 0., 1.);
      rough = 0.; vec3 nS = nrm(p); rough = 1.; vec3 nr = normalize(mix(n, nS, fz)); // light passes a frosted break diffusely, not through a lens of ripples
      vec3 r = through(p - n * .003, refract(rd, nr, 1. / 1.57), 1.57, id), b = disp > 0. ? through(p - n * .003, refract(rd, nr, 1. / mix(1.57, 1.62, disp)), mix(1.57, 1.62, disp), id) : r; // dispersion (whole only: broken, it is too busy to see, and costly)
      vec3 m = (r + b) * .5, tr = mix(m, vec3(r.r, m.g, b.b), .45);
      vec3 c = env(reflect(rd, n)) * F * (1. - fz) + tr * (1. - F);         // broken faces don't mirror the lights …
      c = mix(c, c * .14 + ink * .035 + m * .04, fz);                      // … they are frosted and dull
      c += accent * seam * .9 + ink * seam * seam * .3 + (accent * .22 + ink * .05) * craze; // the seam, and the crazing round it
      gl_FragColor = vec4(c, 1.);
    }`, u))

  // ── the crystal's shape in JS, as a cloud of points: for each piece's centre and reach (the shader skips far pieces) ──
  const gemJS = (x, y, z) => {
    x *= 1.45, (y *= 1.45), (z *= 1.45); let d = -1e9
    for (let i = 0; i < 6; i++) { const a = i * 1.0472 + y * 0.1; d = Math.max(d, x * Math.cos(a) + z * Math.sin(a) - 0.58) }
    for (let i = 0; i < 6; i++) { const a = i * 1.0472 + 0.5236, nx = Math.cos(a) * 1.25, nz = Math.sin(a) * 1.25, l = Math.hypot(nx, 1, nz); d = Math.max(d, (x * nx + Math.abs(y) + z * nz) / l - 1.22) }
    return d / 1.45
  }
  const cloud = []; while (cloud.length < 2500) { const v = new THREE.Vector3(R(-0.45, 0.45), R(-0.9, 0.9), R(-0.45, 0.45)); if (gemJS(v.x, v.y, v.z) < 0) cloud.push(v) }

  // ── the pieces: their side of every break (−1, 0 = untouched, +1), a drift and a turn ──
  const planes = []
  const fresh = () => ({ s: new Array(NPL).fill(0), off: new THREE.Vector3(), to: new THREE.Vector3(), ax: new THREE.Vector3(0, 1, 0), ang: 0, angTo: 0, c: new THREE.Vector3(), r: 1 })
  const pieces = [fresh()]
  const bound = pc => { // centre and reach from the cloud points on its side of every break
    const pts = cloud.filter(v => pc.s.every((sg, k) => !sg || sg * (planes[k].n.dot(v) - planes[k].c) > -0.05))
    pc.c.set(0, 0, 0); pts.forEach(v => pc.c.add(v)); if (pts.length) pc.c.divideScalar(pts.length)
    pc.r = pts.reduce((m, v) => Math.max(m, v.distanceTo(pc.c)), 0.05) + 0.08
  }
  bound(pieces[0])
  let lastHit = -9, healing = false, flareAt = -9, now = 0
  const M4 = new THREE.Matrix4(), V = new THREE.Vector3(), Mi = new THREE.Matrix3(), RT = new THREE.Matrix3(), Q = new THREE.Quaternion()
  const world = pc => V.copy(pc.c).applyQuaternion(Q.setFromAxisAngle(pc.ax, pc.ang)).add(pc.off).applyMatrix3(RT.copy(u.rot.value).transpose()).clone()
  const split = (pc, n) => { // break one piece with a new plane through it; returns the new twin
    if (planes.length >= NPL || pieces.length >= NP) return null
    const k = planes.length; planes.push({ n, c: n.dot(pc.c) + R(-0.05, 0.05) })
    const twin = fresh(); twin.s = pc.s.slice(), twin.off.copy(pc.off), (twin.ang = pc.ang), twin.ax.copy(pc.ax)
    pc.s[k] = -1, (twin.s[k] = 1)
    const depth = pc.s.filter(Boolean).length, push = 0.17 / Math.sqrt(depth)
    for (const [q, sg] of [[pc, -1], [twin, 1]]) { q.to.copy(q.off).addScaledVector(n, sg * R(0.7, 1.2) * push).add(V.set(R(-0.02, 0.02), R(-0.02, 0.02), R(-0.02, 0.02))), (q.angTo = q.ang + R(0.06, 0.18) * sg); if (q === twin) q.ax.set(R(-1, 1), R(-1, 1), R(-1, 1)).normalize() }
    pieces.push(twin), bound(pc), bound(twin)
    return twin
  }
  const queue = [] // branching cracks, a beat after the blow
  const strike = (sx, sy) => {
    let pick = pieces[0], best = 1e9
    pieces.forEach(pc => { const w = world(pc).project(camera), d = Math.hypot(w.x - sx, w.y - sy); if (d < best) (best = d), (pick = pc) })
    lastHit = now, (flareAt = now), (healing = false)
    const cw = world(pick).project(camera), dx = sx - cw.x, dy = sy - cw.y, l = Math.hypot(dx, dy)
    const n = new THREE.Vector3(l > 0.02 ? dx / l : 1, l > 0.02 ? dy / l : 0.3, R(-0.35, 0.35)).normalize().applyMatrix3(Mi.copy(u.rot.value)).normalize()
    const twin = split(pick, n)
    chips(world(pick), 14 + (twin ? 6 : 0))
    if (twin) queue.push({ at: now + R(0.12, 0.22), pc: R() < 0.5 ? pick : twin }) // the crack runs on through one of the halves
  }

  // ── chips: small dark shards spalling off each blow, tumbling away ──
  const NC = 120, chipMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.03), new THREE.MeshPhysicalMaterial({ color: 0x1c0f0b, roughness: 0.15, metalness: 0.2, clearcoat: 1, emissive: U.accent.value, emissiveIntensity: 0.25 }), NC)
  const cs = Array.from({ length: NC }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0, s: 1 }))
  let ci = 0
  const chips = (at, n) => { for (let j = 0; j < n; j++) { const c = cs[ci++ % NC]; c.p.copy(at).add(V.set(R(-0.15, 0.15), R(-0.15, 0.15), R(0.1, 0.3))), c.v.set(R(-1.2, 1.2), R(-0.2, 1.6), R(0.2, 1.4)), c.w.set(R(-12, 12), R(-12, 12), R(-12, 12)), (c.life = R(1.2, 2)), (c.s = R(0.4, 1.4)) } }
  chipMesh.frustumCulled = false, scene.add(chipMesh)
  const O = new THREE.Object3D()

  const E = new THREE.Euler(0, 0, 0, 'YXZ'), M = new THREE.Matrix4()
  let down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0, lastP = 0
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
    // the loop's own blows: three, each deeper; healed before the wrap
    for (const [at, x, y] of [[0.4, 0.35, 0.25], [0.47, -0.25, -0.3], [0.54, 0.15, -0.1]]) if (lastP < at && p >= at) strike(x, y)
    lastP = p
    for (let i = queue.length - 1; i >= 0; i--) if (now >= queue[i].at) { const { pc } = queue[i]; queue.splice(i, 1); if (pieces.includes(pc)) split(pc, new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize()) }
    // a few seconds after the last blow the pieces drift home and fuse
    if (pieces.length > 1 && now - lastHit > 3) (healing = true), pieces.forEach(pc => (pc.to.set(0, 0, 0), (pc.angTo = 0)))
    let far = 0 // ≈ how far the pieces' tips are from home
    pieces.forEach(pc => { const k = 1 - Math.exp(-dt * (healing ? 2.6 : 6)); pc.off.lerp(pc.to, k), (pc.ang += (pc.angTo - pc.ang) * k), (far = Math.max(far, pc.off.length() + Math.abs(pc.ang) * 0.9)) })
    if (healing && far < 0.002) pieces.splice(0, pieces.length, fresh()), (planes.length = 0), bound(pieces[0]), (healing = false)
    u.open.value = THREE.MathUtils.clamp((far - 0.004) / 0.12, 0, 1)  // fades as the pieces come home, reaching 0 before they fuse
    u.cutW.value = healing ? THREE.MathUtils.clamp((far - 0.002) / 0.008, 0, 1) : 1 // the outline's breaks melt only in the last hundredth, where overlap can't show
    u.cutI.value = healing ? THREE.MathUtils.clamp((far - 0.002) / 0.1, 0, 1) : 1   // inside, light learns to cross the breaks over the whole return
    u.disp.value = pieces.length > 1 ? 0 : Math.min(1, u.disp.value + dt * 1.5)  // colour fringing returns gently once whole
    for (let i = 0; i < NP; i++) {
      const pc = pieces[i]
      if (!pc) { u.po.value[i].w = 0; continue }
      Q.setFromAxisAngle(pc.ax, pc.ang)
      u.po.value[i].set(pc.off.x, pc.off.y, pc.off.z, 1), u.pr.value[i].setFromMatrix4(M4.makeRotationAxis(pc.ax, -pc.ang))
      V.copy(pc.c).applyQuaternion(Q).add(pc.off), u.pb.value[i].set(V.x, V.y, V.z, pc.r)
      for (let k = 0; k < NPL; k++) u.ps.value[i * NPL + k] = pc.s[k]
    }
    planes.forEach((P, k) => u.pl.value[k].set(P.n.x, P.n.y, P.n.z, P.c))
    // chips
    cs.forEach((c, j) => {
      if (c.life > 0) c.life -= dt, c.v.y -= 3.5 * dt, c.p.addScaledVector(c.v, dt), c.q.multiply(Q.setFromEuler(E.set(c.w.x * dt, c.w.y * dt, c.w.z * dt)))
      O.position.copy(c.p), O.quaternion.copy(c.q), O.scale.setScalar(c.life > 0 ? c.s * Math.min(1, c.life * 2) : 0), O.updateMatrix(), chipMesh.setMatrixAt(j, O.matrix)
    })
    chipMesh.instanceMatrix.needsUpdate = true
  }
}, { loop: 16, eye: [0, 0.2, 6.4], drift: 0.4, bloom: 0.75, dpr: 1 })
