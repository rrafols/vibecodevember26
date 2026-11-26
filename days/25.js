import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// 25 — jelly: translucent jelly cubes tumbling down a black staircase. Each is a soft body: 64 particles held together by shape
// matching (every step the best-fit rotation and stretch of its rest shape is found and the particles pulled towards it), so
// they squash on landing, wobble, shear on the step edges and shove each other. Rendered as refracting glass-like jelly that
// bends the ember lights set into the steps behind and beneath it.
// hover: poke them · drag: grab one and stretch it, let go to fling · click: drop a new one
go('jelly', ({ scene, camera }) => {
  const NB = 10, NL = 4, S = 0.15, PR = 0.075, DT = 1 / 240, G = 9, ALPHA = 0.06, BETA = 0.65, W = 0.75
  const steps = Array.from({ length: 6 }, (_, i) => ({ x0: -3.3 + i * 1.08, x1: -2.22 + i * 1.08, y1: 1.3 - i * 0.52 })) // tops of the stair blocks
  const NP = NB * NL ** 3, x = new Float32Array(NP * 3), p = new Float32Array(NP * 3), v = new Float32Array(NP * 3)
  const rest = []; for (let c = 0; c < NL; c++) for (let b = 0; b < NL; b++) for (let a = 0; a < NL; a++) rest.push((a - 1.5) * S, (b - 1.5) * S, (c - 1.5) * S)
  const aqq = rest.reduce((s, q, i) => (i % 3 === 0 ? s + q * q : s), 0) // diagonal of Σ q qᵀ (the lattice is symmetric)
  const bodies = Array.from({ length: NB }, (_, b) => ({ q: new THREE.Quaternion(), wait: b * 0.9, grabbed: -1 }))
  const Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), M3 = new THREE.Matrix4()

  const drop = (b, X, Y, Z, vx) => { // place body b as a fresh cube, randomly turned
    const B = bodies[b]; B.q.setFromEuler(E.set(R(TAU), R(TAU), R(TAU)))
    for (let i = 0; i < 64; i++) { const k = (b * 64 + i) * 3; V.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]).applyQuaternion(B.q); x[k] = X + V.x, (x[k + 1] = Y + V.y), (x[k + 2] = Z + V.z), (v[k] = vx), (v[k + 1] = -1), (v[k + 2] = 0) }
  }
  bodies.forEach((B, b) => drop(b, -2.9 + R(0.3), 3 + b * 1.4, R(-0.4, 0.4), R(0.6, 1)))

  // ── one substep: integrate, collide (steps, walls, each other, your finger), match shapes, update velocities ──
  const GX = 64, GY = 48, GZ = 8, CS = 2 * PR, head = new Int32Array(GX * GY * GZ), next = new Int32Array(NP)
  const finger = { on: false, p: new THREE.Vector3(), r: 0.22 }, grab = { b: -1, i: -1, to: new THREE.Vector3() }
  const sub = () => {
    for (let k = 0; k < NP * 3; k += 3) { p[k] = x[k], (p[k + 1] = x[k + 1]), (p[k + 2] = x[k + 2]); v[k] += 0.9 * DT, (v[k + 1] -= G * DT); for (let a = 0; a < 3; a++) x[k + a] += v[k + a] * DT } // (a little push down the stairs)
    if (grab.b >= 0) { const k = (grab.b * 64 + grab.i) * 3; for (let a = 0; a < 3; a++) x[k + a] += (grab.to.getComponent(a) - x[k + a]) * 0.5 }
    // particle–particle between bodies
    head.fill(-1)
    for (let i = 0; i < NP; i++) { const cx = ((x[i * 3] + 4) / CS) | 0, cy = ((x[i * 3 + 1] + 4) / CS) | 0, cz = ((x[i * 3 + 2] + 0.8) / CS) | 0; if (cx < 0 || cy < 0 || cz < 0 || cx >= GX || cy >= GY || cz >= GZ) { next[i] = -2; continue } const c = (cz * GY + cy) * GX + cx; next[i] = head[c], (head[c] = i) }
    for (let i = 0; i < NP; i++) {
      if (next[i] === -2) continue
      const cx = ((x[i * 3] + 4) / CS) | 0, cy = ((x[i * 3 + 1] + 4) / CS) | 0, cz = ((x[i * 3 + 2] + 0.8) / CS) | 0, bi = (i / 64) | 0
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx, Y = cy + dy, Z = cz + dz; if (X < 0 || Y < 0 || Z < 0 || X >= GX || Y >= GY || Z >= GZ) continue
        for (let j = head[(Z * GY + Y) * GX + X]; j >= 0; j = next[j]) {
          if (j <= i || ((j / 64) | 0) === bi) continue
          const ex = x[i * 3] - x[j * 3], ey = x[i * 3 + 1] - x[j * 3 + 1], ez = x[i * 3 + 2] - x[j * 3 + 2], d2 = ex * ex + ey * ey + ez * ez
          if (d2 >= 4 * PR * PR || d2 < 1e-10) continue
          const d = Math.sqrt(d2), f = (2 * PR - d) / d / 2
          x[i * 3] += ex * f, (x[i * 3 + 1] += ey * f), (x[i * 3 + 2] += ez * f), (x[j * 3] -= ex * f), (x[j * 3 + 1] -= ey * f), (x[j * 3 + 2] -= ez * f)
        }
      }
    }
    // the stairs (solid blocks), the side walls, your finger; friction on contact
    for (let i = 0; i < NP; i++) {
      const k = i * 3
      for (const s of steps) {
        if (x[k] < s.x0 - PR || x[k] > s.x1 + PR || x[k + 1] > s.y1 + PR) continue
        const up = s.y1 + PR - x[k + 1], lf = x[k] - (s.x0 - PR), rt = s.x1 + PR - x[k]
        if (up <= Math.min(lf, rt)) { x[k + 1] += up; x[k] -= (x[k] - p[k]) * 0.35, (x[k + 2] -= (x[k + 2] - p[k + 2]) * 0.35) }
        else if (lf < rt) x[k] -= lf; else x[k] += rt
      }
      if (x[k + 2] > W - PR) x[k + 2] = W - PR; else if (x[k + 2] < -W + PR) x[k + 2] = -W + PR
      if (finger.on) { const ex = x[k] - finger.p.x, ey = x[k + 1] - finger.p.y, ez = x[k + 2] - finger.p.z, d = Math.hypot(ex, ey, ez), r = finger.r + PR; if (d < r && d > 1e-6) { const f = (r - d) / d; x[k] += ex * f, (x[k + 1] += ey * f), (x[k + 2] += ez * f) } }
    }
    // shape matching: best-fit rotation (and some stretch) of the rest shape, pull the particles to it
    for (let b = 0; b < NB; b++) {
      const o = b * 64; let cx = 0, cy = 0, cz = 0
      for (let i = 0; i < 64; i++) cx += x[(o + i) * 3], (cy += x[(o + i) * 3 + 1]), (cz += x[(o + i) * 3 + 2])
      cx /= 64, (cy /= 64), (cz /= 64)
      const A = [0, 0, 0, 0, 0, 0, 0, 0, 0]
      for (let i = 0; i < 64; i++) { const k = (o + i) * 3, px = x[k] - cx, py = x[k + 1] - cy, pz = x[k + 2] - cz, qx = rest[i * 3], qy = rest[i * 3 + 1], qz = rest[i * 3 + 2]; A[0] += px * qx, (A[1] += px * qy), (A[2] += px * qz), (A[3] += py * qx), (A[4] += py * qy), (A[5] += py * qz), (A[6] += pz * qx), (A[7] += pz * qy), (A[8] += pz * qz) }
      for (let a = 0; a < 9; a++) A[a] /= aqq
      // rotation: iterate the quaternion towards A's rotational part (warm-started from last step)
      const B = bodies[b]
      for (let it = 0; it < 6; it++) {
        M3.makeRotationFromQuaternion(B.q); const e = M3.elements // column-major
        let wx = 0, wy = 0, wz = 0, dn = 0
        for (let c = 0; c < 3; c++) { const rx = e[c * 4], ry = e[c * 4 + 1], rz = e[c * 4 + 2], ax = A[c], ay = A[3 + c], az = A[6 + c]; wx += ry * az - rz * ay, (wy += rz * ax - rx * az), (wz += rx * ay - ry * ax), (dn += rx * ax + ry * ay + rz * az) }
        const s = 1 / (Math.abs(dn) + 1e-9); wx *= s, (wy *= s), (wz *= s); const w = Math.hypot(wx, wy, wz); if (w < 1e-7) break
        B.q.premultiply(Q.setFromAxisAngle(V.set(wx / w, wy / w, wz / w), w)).normalize()
      }
      M3.makeRotationFromQuaternion(B.q); const e = M3.elements
      const det = A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]), vs = det > 0.05 ? 1 / Math.cbrt(det) : 0, be = vs ? BETA : 0
      const Mx = (r, c) => be * A[r * 3 + c] * vs + (1 - be) * e[c * 4 + r] // blend of stretch and rotation
      for (let i = 0; i < 64; i++) {
        const k = (o + i) * 3, qx = rest[i * 3], qy = rest[i * 3 + 1], qz = rest[i * 3 + 2]
        const gx = Mx(0, 0) * qx + Mx(0, 1) * qy + Mx(0, 2) * qz + cx, gy = Mx(1, 0) * qx + Mx(1, 1) * qy + Mx(1, 2) * qz + cy, gz = Mx(2, 0) * qx + Mx(2, 1) * qy + Mx(2, 2) * qz + cz
        x[k] += (gx - x[k]) * ALPHA, (x[k + 1] += (gy - x[k + 1]) * ALPHA), (x[k + 2] += (gz - x[k + 2]) * ALPHA)
      }
    }
    for (let k = 0; k < NP * 3; k++) v[k] = ((x[k] - p[k]) / DT) * 0.9995
  }

  // ── the stairs: black lacquer, an ember light along every nose, a bone strip in every riser (what the jelly refracts) ──
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.2 })
  const emb = new THREE.MeshBasicMaterial({ color: new THREE.Color(U.accent.value).multiplyScalar(1.6) }), bone = new THREE.MeshBasicMaterial({ color: new THREE.Color(U.ink.value).multiplyScalar(0.9) })
  steps.forEach((s, i) => {
    const h = s.y1 + 4.5, blk = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, h, 2 * W + 0.6), lacquer)
    blk.position.set((s.x0 + s.x1) / 2, s.y1 - h / 2, -0.3), scene.add(blk)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 2 * W + 0.6), emb); nose.position.set(s.x1, s.y1 - 0.01, -0.3), scene.add(nose)
    if (i) { const riser = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 2 * W + 0.6), i % 2 ? bone : emb); riser.position.set(s.x0 - 0.006, s.y1 + 0.26, -0.3), scene.add(riser) }
  })
  const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.04), emb); back.position.set(0, -0.2, -1.4), back.rotation.z = -0.44, scene.add(back) // a long ember line behind it all

  // ── the jellies: a rounded box per body, every vertex carried by its 8 lattice neighbours ──
  const tints = [[U.accent.value, 0.25], [new THREE.Color(0xffd9b0), 0.5], [new THREE.Color(0xff7a3d), 0.3], [U.accent.value, 0.4], [new THREE.Color(0xf1ede6), 0.8]]
  const meshes = bodies.map((B, b) => {
    const geo = new RoundedBoxGeometry(0.62, 0.62, 0.62, 3, 0.16), [c, d] = tints[b % tints.length]
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), transmission: 1, thickness: 1.2, roughness: 0.26, ior: 1.4, attenuationColor: c, attenuationDistance: d, emissive: c, emissiveIntensity: 0.06, clearcoat: 0.6, clearcoatRoughness: 0.28, specularIntensity: 0.7 }))
    const r = geo.attributes.position.array, lat = new Float32Array(r.length)
    for (let k = 0; k < r.length; k++) lat[k] = r[k] / S + 1.5 // lattice coordinates of every vertex
    m.userData.lat = lat, (m.frustumCulled = false), scene.add(m)
    return m
  })
  const deform = (m, b) => {
    const lat = m.userData.lat, out = m.geometry.attributes.position.array, o = b * 64
    for (let k = 0; k < lat.length; k += 3) {
      const u = lat[k], w = lat[k + 1], z = lat[k + 2], i = Math.min(2, Math.max(0, Math.floor(u))), j = Math.min(2, Math.max(0, Math.floor(w))), l = Math.min(2, Math.max(0, Math.floor(z))), fu = u - i, fv = w - j, fw = z - l
      for (let a = 0; a < 3; a++) {
        const P = (ii, jj, ll) => x[(o + ii + jj * 4 + ll * 16) * 3 + a]
        const c00 = P(i, j, l) * (1 - fu) + P(i + 1, j, l) * fu, c10 = P(i, j + 1, l) * (1 - fu) + P(i + 1, j + 1, l) * fu, c01 = P(i, j, l + 1) * (1 - fu) + P(i + 1, j, l + 1) * fu, c11 = P(i, j + 1, l + 1) * (1 - fu) + P(i + 1, j + 1, l + 1) * fu
        out[k + a] = (c00 * (1 - fv) + c10 * fv) * (1 - fw) + (c01 * (1 - fv) + c11 * fv) * fw
      }
    }
    m.geometry.attributes.position.needsUpdate = true, m.geometry.computeVertexNormals()
  }

  // ── interaction ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3()
  let down = null, now = 0, last = null
  addEventListener('pointerdown', () => {
    down = { at: now, moved: false }
    ray.setFromCamera(pointer, camera)
    let best = 0.35 ** 2
    for (let i = 0; i < NP; i++) { V.set(x[i * 3], x[i * 3 + 1], x[i * 3 + 2]); const d = ray.ray.distanceSqToPoint(V); if (d < best) (best = d), (grab.b = (i / 64) | 0), (grab.i = i % 64) }
    if (grab.b >= 0) grab.to.set(x[(grab.b * 64 + grab.i) * 3], x[(grab.b * 64 + grab.i) * 3 + 1], x[(grab.b * 64 + grab.i) * 3 + 2]), plane.constant = -grab.to.z
  })
  addEventListener('pointerup', () => {
    if (down && grab.b < 0 && now - down.at < 0.3 && (ray.setFromCamera(pointer, camera), plane.set(plane.normal, 0), ray.ray.intersectPlane(plane, hit))) { // a new one, from where you clicked
      let lo = 0; bodies.forEach((B, b) => { if (x[b * 192 + 1] < x[lo * 192 + 1]) lo = b }); drop(lo, hit.x, Math.max(hit.y, 1.8), 0, 0.5)
    }
    grab.b = -1, (down = null), plane.set(plane.normal, 0)
  })

  return (t, ph) => {
    const dt = last === null ? 1 / 60 : Math.min(Math.max(t - last, 0), 1 / 20); last = t, (now = t)
    finger.on = false
    if (pointer.active && (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, hit))) { if (grab.b >= 0) grab.to.copy(hit); else if (!down) finger.p.copy(hit), (finger.on = true) }
    for (let s = 0; s < Math.round(dt / DT); s++) sub()
    // fallen off the bottom → back to the top
    bodies.forEach((B, b) => { if (x[b * 192 + 1] < -4.5 && grab.b !== b) drop(b, -2.9 + R(0.3), 2.6, R(-0.4, 0.4), R(0.5, 1)) })
    meshes.forEach(deform)
  }
}, { loop: 16, blend: 2, eye: [0.3, 1.4, 8.2], drift: 0.3, bloom: 0.6, parallax: 0.3 })
