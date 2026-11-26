import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { Reflector } from 'three/addons/objects/Reflector.js'

// 19 — precession: three chrome spinning tops on black glass. Each is a heavy symmetric top integrated from its equations of
// motion (gravity's torque against the spin's angular momentum), so it precesses round the vertical while nutating up and
// down; the tip of each axis draws its rosette in ember light: cusps, loops or waves depending on how it was set going.
// The tops mirror the room and each other; the glass mirrors them.
// click a top: flick it · hover: blow on them · drag: turn the table · scroll: slow time
go('precession', ({ scene, camera, renderer }) => {
  const MGL = 9, TRAIL = 260
  // a = spin term (I3·ω3/I1), b = conserved angular momentum about the vertical (/I1); start tilted, at rest or already precessing
  const tops = [
    { at: [-1.7, 0.35], a: 9, th: 0.55, dth: 0, phi: 0, psi: 0, pre: 0 },      // released from rest: cusps
    { at: [1.7, 0.35], a: 11, th: 0.75, dth: 0, phi: 2, psi: 0, pre: 1.6 },     // pushed along: loops
    { at: [0, -1.5], a: 13, th: 0.45, dth: 0.9, phi: 4, psi: 0, pre: 0.55 },     // near steady: waves
  ].map(t => ({ ...t, a0: t.a, b: t.a * Math.cos(t.th) + t.pre * Math.sin(t.th) ** 2 }))
  const rhs = (t, th, dth) => { const s = Math.sin(th), c = Math.cos(th), dphi = (t.b - t.a * c) / (s * s); return [dth, dphi * dphi * s * c - t.a * dphi * s + MGL * s, dphi] }
  const step = (t, h) => { // RK4 on (θ, θ'), φ alongside; ψ' = ω3 − φ' cosθ
    const k1 = rhs(t, t.th, t.dth), k2 = rhs(t, t.th + (h / 2) * k1[0], t.dth + (h / 2) * k1[1]), k3 = rhs(t, t.th + (h / 2) * k2[0], t.dth + (h / 2) * k2[1]), k4 = rhs(t, t.th + h * k3[0], t.dth + h * k3[1])
    t.th += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), (t.dth += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])), (t.phi += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]))
    t.psi += (t.a * 2.2 - k1[2] * Math.cos(t.th)) * h
    if (t.th < 0.05) (t.th = 0.05), (t.dth = Math.abs(t.dth))
    if (t.th > 1.25) (t.th = 1.25), (t.dth = -Math.abs(t.dth) * 0.6) // the rim touches down and bounces it back up
  }

  // ── studio panels only the mirrors see, and one live cube map for the chrome ──
  const panel = (w, h, c, k, ...at) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, fog: false })); m.position.set(...at), m.lookAt(0, 0.5, 0), m.layers.set(1), scene.add(m) }
  panel(10, 1, U.ink.value, 1.4, 0, 8, -2), panel(1.2, 6, U.accent.value, 1, -7, 2, 2), panel(0.8, 5, U.ink.value, 0.8, 7, 2, -3), panel(20, 0.5, U.accent.value, 0.6, 0, 1, -10)
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }), cubeCam = new THREE.CubeCamera(0.05, 40, cubeRT)
  cubeCam.position.set(0, 0.6, 0), cubeCam.children.forEach(c => c.layers.enable(1)), scene.add(cubeCam)

  // ── a top: turned chrome, a ring of ember marks on its rim so you can see it spin ──
  const prof = [[0, 0], [0.03, 0.05], [0.1, 0.2], [0.4, 0.4], [0.46, 0.46], [0.44, 0.5], [0.3, 0.56], [0.1, 0.62], [0.045, 0.68], [0.045, 1], [0.065, 1.02], [0.05, 1.05], [0, 1.06]].map(([x, y]) => new THREE.Vector2(x, y))
  const geo = new THREE.LatheGeometry(prof, 96)
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, envMap: cubeRT.texture })
  chrome.onBeforeCompile = s => {
    Object.assign(s.uniforms, { accent: U.accent })
    s.vertexShader = 'varying vec3 vO;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvO = position;')
    s.fragmentShader = 'uniform vec3 accent; varying vec3 vO;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float an = atan(vO.z, vO.x), band = smoothstep(.42, .45, vO.y) * smoothstep(.53, .5, vO.y);
      totalEmissiveRadiance += accent * band * smoothstep(.85, .97, cos(an * 6.)) * .7;`)
  }
  const table = new THREE.Group()
  const bodies = tops.map(t => { const m = new THREE.Mesh(geo, chrome); m.position.set(t.at[0], 0, t.at[1]), table.add(m); return m })
  const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'), r.addColorStop(0.25, 'rgba(255,255,255,.4)'), r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r, g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c) })()
  const sparks = tops.map(t => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: U.accent.value, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.position.set(t.at[0], 0.01, t.at[1]), s.scale.setScalar(0.18), table.add(s); return s }) // where the point grinds the glass

  // trails: where the tip of each axis has been, fading ember
  const tp = new Float32Array(tops.length * TRAIL * 6), tc = new Float32Array(tops.length * TRAIL * 6), hist = tops.map(() => [])
  const tgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(tp, 3)).setAttribute('color', new THREE.BufferAttribute(tc, 3))
  const trails = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  trails.frustumCulled = false, scene.add(trails)

  // the table: a mirror under a dark veil
  const mirror = new Reflector(new THREE.CircleGeometry(14, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x909090 })
  mirror.rotation.x = -Math.PI / 2
  const veil = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshBasicMaterial({ color: 0x060608, transparent: true, opacity: 0.72 }))
  veil.rotation.x = -Math.PI / 2, (veil.position.y = 0.001)
  scene.add(mirror, veil, table)

  // ── interaction ──
  const ray = new THREE.Raycaster(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), QY = new THREE.Quaternion(), QX = new THREE.Quaternion(), QS = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0)
  let down = null, yaw = 0, vy = 0, lx = 0, rate = 1, rateT = 1, last = null
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.abs(pointer.x - lx); if (down.moved > 0.02) (vy = (pointer.x - lx) * 2.5), (yaw += vy); lx = pointer.x })
  addEventListener('pointerup', () => {
    if (down && down.moved < 0.02) { ray.setFromCamera(pointer, camera); const h = ray.intersectObjects(bodies)[0]; if (h) { const t = tops[bodies.indexOf(h.object)]; t.dth += 2.6, (t.a = Math.min(t.a * 1.25, 22)), (t.b = t.a * Math.cos(t.th) + 0.6 * Math.sin(t.th) ** 2) } }
    down = null
  })
  addEventListener('wheel', e => (rateT = THREE.MathUtils.clamp(rateT - Math.sign(e.deltaY) * 0.2, 0.1, 1.5)), { passive: true })

  return (t, p) => {
    const dt = last === null ? 0 : Math.min(Math.max(t - last, 0), 1 / 20); last = t
    rate += (rateT - rate) * 0.08
    if (!down) yaw += vy *= 0.93
    table.rotation.y = yaw + Math.sin(p * TAU) * 0.15, table.updateMatrixWorld()
    const near = pointer.active && !down
    tops.forEach((T, i) => {
      if (near) { V.copy(bodies[i].position).applyMatrix4(table.matrixWorld).project(camera); const d = Math.hypot(V.x - pointer.x, V.y - pointer.y); if (d < 0.25) T.dth += (0.25 - d) * 4 * dt } // a breath on it
      const n = 12; for (let s = 0; s < n; s++) step(T, (dt * rate) / n)
      // a flick's extra spin slowly wears off; b follows so the motion stays continuous
      const a1 = T.a + (T.a0 - T.a) * dt * 0.15, dphi = (T.b - T.a * Math.cos(T.th)) / Math.sin(T.th) ** 2
      T.a = a1, (T.b = a1 * Math.cos(T.th) + dphi * Math.sin(T.th) ** 2)
      // orientation: precess about the vertical, tilt, spin about its own axis
      Q.copy(QY.setFromAxisAngle(Y, T.phi)).multiply(QX.setFromAxisAngle(X, T.th)).multiply(QS.setFromAxisAngle(Y, T.psi)), bodies[i].quaternion.copy(Q)
      const tip = V.set(0, 1.05, 0).applyQuaternion(Q).add(bodies[i].position).applyMatrix4(table.matrixWorld), hs = hist[i]
      hs.unshift(tip.clone()); if (hs.length > TRAIL) hs.pop()
      for (let k = 0; k < TRAIL; k++) {
        const a = hs[Math.min(k, hs.length - 1)], b = hs[Math.min(k + 1, hs.length - 1)], o = (i * TRAIL + k) * 6, f = (1 - k / TRAIL) ** 1.3 * 1.6, c = U.accent.value
        tp.set([a.x, a.y, a.z, b.x, b.y, b.z], o), tc.set([c.r * f, (c.g + f * 0.15) * f, (c.b + f * 0.1) * f, c.r * f, (c.g + f * 0.15) * f, (c.b + f * 0.1) * f], o)
      }
      sparks[i].material.opacity = 0.5 + 0.5 * Math.sin(t * 40 + i * 2) ** 2, sparks[i].scale.setScalar(0.12 + 0.01 * T.a)
    })
    tgeo.attributes.position.needsUpdate = tgeo.attributes.color.needsUpdate = true
    cubeCam.update(renderer, scene)
  }
}, { loop: 16, blend: 2, eye: [0, 3.6, 8.6], drift: 0.35, bloom: 0.7, parallax: 0.3 })
