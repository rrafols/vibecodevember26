import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// 13 — collision: two voxel spheres, ~4,000 solid cubes, one bone and one graphite, fly into each other. Every cube is a rigid body:
// contact springs with damping, friction that sets them tumbling, impacts that heat the faces ember to white. Afterwards the
// cubes sort themselves out and stream back to their own sphere, and the next pass begins.
// hover: your cursor is a solid ball, swat the cubes · click: fire a slug into them · drag: orbit · scroll: bullet time
go('collision', ({ scene, camera }) => {
  const LOOP = 14, RAD = 0.05, GAP = 0.1, BALL = 0.78, VB = 2.2, HOLD = 1, H = 1 / 240
  const K = 12000, C = 50, MU = 0.45, GT = 18, IN = 0.4 * RAD * RAD, DRAG = Math.exp(-0.3 * H)
  const S = [[-2.6, 0.24, 0.2, 1], [2.6, -0.24, -0.2, -1]] // start centres (a little off-axis, so it glances) and their direction
  const off = [], n = Math.floor(BALL / GAP)
  for (let b = 0; b < 2; b++) for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) if ((i * i + j * j + k * k) * GAP * GAP <= BALL * BALL) off.push(i * GAP, j * GAP, k * GAP, b)
  const N = off.length / 4, P = new Float32Array(N * 3), V = new Float32Array(N * 3), W = new Float32Array(N * 3), Q = new Float32Array(N * 4), F = new Float32Array(N * 3), T = new Float32Array(N * 3), heat = new Float32Array(N)
  // where each sphere should be: at rest at its start while it gathers (end of the loop), then accelerating into the other one
  const hc = (b, tau) => { if (tau > LOOP / 2) return [S[b][0], 0]; const d = S[b][3], s = tau < HOLD ? (VB * tau * tau) / (2 * HOLD) : VB * (tau - HOLD / 2); return [S[b][0] + d * s, d * (tau < HOLD ? (VB * tau) / HOLD : VB)] }
  const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b)

  // ── broad phase: a hashed grid, one cube per cell, counting-sorted every substep ──
  const MASK = (1 << 15) - 1, cnt = new Int32Array(MASK + 2), cur = new Int32Array(MASK + 2), ord = new Int32Array(N), key = new Int32Array(N), cell = new Int32Array(N * 3)
  const hk = (x, y, z) => (Math.imul(x, 92837111) ^ Math.imul(y, 689287499) ^ Math.imul(z, 283923481)) & MASK

  const step = (tau, colliders) => {
    const cross = 1 - smooth(tau, 6.5, 8) // while they go home, the two swarms pass through each other instead of jamming
    if (tau < HOLD) { // still rigid: every cube in its lattice slot
      for (let i = 0; i < N; i++) { const b = off[i * 4 + 3], [cx, vx] = hc(b, tau); P.set([cx + off[i * 4], S[b][1] + off[i * 4 + 1], S[b][2] + off[i * 4 + 2]], i * 3), V.set([vx, 0, 0], i * 3), W.fill(0, i * 3, i * 3 + 3), Q.set([0, 0, 0, 1], i * 4), (heat[i] = 0) }
      return
    }
    F.fill(0), T.fill(0), cnt.fill(0)
    for (let i = 0; i < N; i++) { const x = Math.floor(P[i * 3] / GAP), y = Math.floor(P[i * 3 + 1] / GAP), z = Math.floor(P[i * 3 + 2] / GAP); cell[i * 3] = x, (cell[i * 3 + 1] = y), (cell[i * 3 + 2] = z), (key[i] = hk(x, y, z)), cnt[key[i] + 1]++ }
    for (let k = 1; k <= MASK + 1; k++) cnt[k] += cnt[k - 1]
    cur.set(cnt); for (let i = 0; i < N; i++) ord[cur[key[i]]++] = i

    // narrow phase: spring-dashpot normal force, capped viscous friction, the friction's torque spins both
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, cx = cell[i3], cy = cell[i3 + 1], cz = cell[i3 + 2]
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const k = hk(cx + dx, cy + dy, cz + dz)
        for (let m = cnt[k], e = cnt[k + 1]; m < e; m++) {
          const j = ord[m]; if (j <= i) continue
          const j3 = j * 3, ex = P[i3] - P[j3], ey = P[i3 + 1] - P[j3 + 1], ez = P[i3 + 2] - P[j3 + 2], d2 = ex * ex + ey * ey + ez * ez
          if (d2 >= 4 * RAD * RAD || d2 < 1e-12) continue
          const d = Math.sqrt(d2), nx = ex / d, ny = ey / d, nz = ez / d, pen = 2 * RAD - d
          const sx = W[i3] + W[j3], sy = W[i3 + 1] + W[j3 + 1], sz = W[i3 + 2] + W[j3 + 2]
          const rx = V[i3] - V[j3] - RAD * (sy * nz - sz * ny), ry = V[i3 + 1] - V[j3 + 1] - RAD * (sz * nx - sx * nz), rz = V[i3 + 2] - V[j3 + 2] - RAD * (sx * ny - sy * nx)
          const vn = rx * nx + ry * ny + rz * nz, fn = Math.max(0, K * pen - C * vn) * (off[i * 4 + 3] === off[j * 4 + 3] ? 1 : cross)
          const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz, vt = Math.hypot(tx, ty, tz), g = vt > 1e-9 ? -Math.min(GT, (MU * fn) / vt) : 0
          const fx = fn * nx + g * tx, fy = fn * ny + g * ty, fz = fn * nz + g * tz
          F[i3] += fx, (F[i3 + 1] += fy), (F[i3 + 2] += fz), (F[j3] -= fx), (F[j3 + 1] -= fy), (F[j3 + 2] -= fz)
          const qx = -RAD * (ny * g * tz - nz * g * ty), qy = -RAD * (nz * g * tx - nx * g * tz), qz = -RAD * (nx * g * ty - ny * g * tx)
          T[i3] += qx, (T[i3 + 1] += qy), (T[i3 + 2] += qz), (T[j3] += qx), (T[j3 + 1] += qy), (T[j3 + 2] += qz)
          const hh = Math.max(0, fn * H - 0.005) * 0.14; heat[i] += hh, (heat[j] += hh) // hard hits heat the faces
        }
      }
    }

    // kinematic spheres (your cursor, the slug): push out, bounce off, get spun
    for (const c of colliders) for (let i = 0; i < N; i++) {
      const i3 = i * 3, ex = P[i3] - c.c.x, ey = P[i3 + 1] - c.c.y, ez = P[i3 + 2] - c.c.z, rr = c.r + RAD, d2 = ex * ex + ey * ey + ez * ez
      if (d2 >= rr * rr || d2 < 1e-12) continue
      const d = Math.sqrt(d2), nx = ex / d, ny = ey / d, nz = ez / d
      P[i3] = c.c.x + nx * rr, (P[i3 + 1] = c.c.y + ny * rr), (P[i3 + 2] = c.c.z + nz * rr)
      const rx = V[i3] - c.v.x, ry = V[i3 + 1] - c.v.y, rz = V[i3 + 2] - c.v.z, vn = rx * nx + ry * ny + rz * nz
      if (vn < 0) {
        V[i3] -= nx * vn * 1.45, (V[i3 + 1] -= ny * vn * 1.45), (V[i3 + 2] -= nz * vn * 1.45), (heat[i] += -vn * c.hot)
        const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz
        W[i3] += ((ny * tz - nz * ty) / RAD) * 0.4, (W[i3 + 1] += ((nz * tx - nx * tz) / RAD) * 0.4), (W[i3 + 2] += ((nx * ty - ny * tx) / RAD) * 0.4)
      }
    }

    // integrate; late in the loop a spring gathers every cube home, and in the last seconds it snaps exactly into place
    const sp = smooth(tau, 7, 11), sn = smooth(tau, 12, LOOP - 0.05), f = sn >= 1 ? 1 : sn ** 3 * 0.05
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, i4 = i * 4, b = off[i4 / 4 * 4 + 3], [cx, vx] = hc(b, tau), hx = cx + off[i4], hy = S[b][1] + off[i4 + 1], hz = S[b][2] + off[i4 + 2]
      if (sp > 0) F[i3] += sp * (6 * (hx - P[i3]) - 3.5 * (V[i3] - vx)), (F[i3 + 1] += sp * (6 * (hy - P[i3 + 1]) - 3.5 * V[i3 + 1])), (F[i3 + 2] += sp * (6 * (hz - P[i3 + 2]) - 3.5 * V[i3 + 2]))
      for (let a = 0; a < 3; a++) (V[i3 + a] = (V[i3 + a] + F[i3 + a] * H) * DRAG), (P[i3 + a] += V[i3 + a] * H), (W[i3 + a] = (W[i3 + a] + (T[i3 + a] / IN) * H) * (1 - sp * 0.004))
      const ox = W[i3] * H * 0.5, oy = W[i3 + 1] * H * 0.5, oz = W[i3 + 2] * H * 0.5, x = Q[i4], y = Q[i4 + 1], z = Q[i4 + 2], w = Q[i4 + 3]
      let qx = x + ox * w + oy * z - oz * y, qy = y + oy * w + oz * x - ox * z, qz = z + oz * w + ox * y - oy * x, qw = w - ox * x - oy * y - oz * z
      if (f > 0) {
        const s = qw < 0 ? -1 : 1; qx *= 1 - f, (qy *= 1 - f), (qz *= 1 - f), (qw = qw * (1 - f) + s * f)
        P[i3] += (hx - P[i3]) * f, (P[i3 + 1] += (hy - P[i3 + 1]) * f), (P[i3 + 2] += (hz - P[i3 + 2]) * f)
        V[i3] += (vx - V[i3]) * f, (V[i3 + 1] *= 1 - f), (V[i3 + 2] *= 1 - f), (W[i3] *= 1 - f), (W[i3 + 1] *= 1 - f), (W[i3 + 2] *= 1 - f), (heat[i] *= 1 - f)
      }
      const l = Math.hypot(qx, qy, qz, qw); Q[i4] = qx / l, (Q[i4 + 1] = qy / l), (Q[i4 + 2] = qz / l), (Q[i4 + 3] = qw / l)
      heat[i] = Math.min(heat[i] * 0.99, 2)
    }
  }

  // ── the cubes: rounded, so their edges catch the light; ember heat added to their emission ──
  const geo = new RoundedBoxGeometry(GAP * 0.86, GAP * 0.86, GAP * 0.86, 2, 0.012), hAttr = new THREE.InstancedBufferAttribute(heat, 1)
  geo.setAttribute('heat', hAttr)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.3 })
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, { accent: U.accent, ink: U.ink })
    s.vertexShader = 'attribute float heat; varying float vHeat;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = heat;')
    s.fragmentShader = 'uniform vec3 accent, ink; varying float vHeat;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mix(accent * 1.8, ink * 2.4, smoothstep(.7, 1.6, vHeat)) * min(vHeat, 1.6);')
  }
  const cubes = new THREE.InstancedMesh(geo, mat, N), col = new THREE.Color()
  for (let i = 0; i < N; i++) cubes.setColorAt(i, off[i * 4 + 3] ? col.setHex(0x16161a).multiplyScalar(R(0.7, 1.3)) : col.copy(U.ink.value).multiplyScalar(R(0.16, 0.24)))
  cubes.frustumCulled = false

  // your cursor: a glass ball, seen only by its rim · the slug: an ember projectile with its own light
  const rimMat = new THREE.ShaderMaterial({
    uniforms: { ...U, vis: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN, vV; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 ink, accent; uniform float vis; varying vec3 vN, vV; void main(){ float f = pow(1. - abs(dot(normalize(vN), vV)), 3.); gl_FragColor = vec4((ink * .3 + accent * .35) * f * vis, 1.); }`,
  })
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), rimMat)
  const slugMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(U.accent.value).multiplyScalar(4) }))
  const slugLight = new THREE.PointLight(U.accent.value, 0, 7, 1.5)
  const world = new THREE.Group().add(cubes, ball, slugMesh, slugLight)
  scene.add(world)

  // ── interaction ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), fwd = new THREE.Vector3(), O = new THREE.Vector3(), iq = new THREE.Quaternion()
  const hand = { c: new THREE.Vector3(0, 0, 50), v: new THREE.Vector3(), r: 0.42, hot: 0.05 }, slug = { c: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.18, hot: 0.25, age: 9 }
  let down = null, yaw = 0, pitch = 0, vy = 0, vp = 0, lx = 0, ly = 0, speed = 1, speedT = 1, clock = 0, acc = 0, last = null
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x), (ly = pointer.y)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.hypot(pointer.x - lx, pointer.y - ly); if (down.moved > 0.02) (vy = (pointer.x - lx) * 2), (vp = -(pointer.y - ly) * 1.2), (yaw += vy), (pitch = THREE.MathUtils.clamp(pitch + vp, -0.6, 0.6)); (lx = pointer.x), (ly = pointer.y) })
  addEventListener('pointerup', () => {
    if (down && down.moved < 0.02) { // fire: from just in front of the camera, through the cursor
      ray.setFromCamera(pointer, camera), iq.copy(world.quaternion).invert()
      slug.v.copy(ray.ray.direction).applyQuaternion(iq).multiplyScalar(16), slug.c.copy(world.worldToLocal(camera.position.clone())).addScaledVector(slug.v, 0.18), (slug.age = 0)
    }
    down = null
  })
  addEventListener('wheel', e => (speedT = THREE.MathUtils.clamp(speedT * (e.deltaY > 0 ? 0.75 : 1.33), 0.06, 1.5)), { passive: true })

  return (t, p) => {
    const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 1 / 20); last = t
    speed += (speedT - speed) * 0.1
    if (!down) (yaw += vy *= 0.93), (pitch = THREE.MathUtils.clamp(pitch + (vp *= 0.93), -0.6, 0.6))
    world.rotation.set(0.12 + pitch + Math.sin(p * TAU) * 0.06, yaw + Math.sin(p * TAU) * 0.25, 0), world.updateMatrixWorld()

    // the hand: where the cursor meets a plane through the centre, facing us; its velocity matters (swat!)
    const orbiting = down && down.moved > 0.02, on = pointer.active && !orbiting
    if (on && (ray.setFromCamera(pointer, camera), plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(fwd), O.set(0, 0, 0)), ray.ray.intersectPlane(plane, hit))) {
      world.worldToLocal(hit)
      if (dt > 0) hand.v.lerp(hit.clone().sub(hand.c).divideScalar(dt * speed + 1e-4).clampLength(0, 25), 0.5)
      hand.c.copy(hit)
    } else hand.v.set(0, 0, 0)
    rimMat.uniforms.vis.value += ((on ? 1 : 0) - rimMat.uniforms.vis.value) * 0.1
    ball.position.copy(hand.c), ball.scale.setScalar(hand.r)

    if (last === t && clock === 0 && acc === 0) step(0, []) // the very first frame: put every cube in its slot
    acc += dt * speed
    for (let s = 0; acc >= H - 1e-9 && s < 10; s++, acc -= H) {
      const cs = []; if (on) cs.push(hand)
      if (slug.age < 2) slug.c.addScaledVector(slug.v, H), (slug.age += H), cs.push(slug)
      step(clock % LOOP, cs), (clock += H)
    }
    acc = Math.min(acc, H)
    const live = slug.age < 2
    slugMesh.visible = live, slugMesh.position.copy(slug.c), slugMesh.scale.setScalar(slug.r * 0.7), slugLight.position.copy(slug.c), (slugLight.intensity = live ? 10 : 0)

    const A = cubes.instanceMatrix.array
    for (let i = 0; i < N; i++) {
      const x = Q[i * 4], y = Q[i * 4 + 1], z = Q[i * 4 + 2], w = Q[i * 4 + 3], x2 = x + x, y2 = y + y, z2 = z + z
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2
      A.set([1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 1], i * 16)
    }
    cubes.instanceMatrix.needsUpdate = hAttr.needsUpdate = true
  }
}, { loop: 14, eye: [0, 1.2, 11.5], drift: 0.35, bloom: 0.45, parallax: 0, poster: 0.16 })
