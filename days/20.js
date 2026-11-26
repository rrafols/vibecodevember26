import { go, THREE, U, R, TAU, pointer } from '../lib/stage.js'
import { Reflector } from 'three/addons/objects/Reflector.js'

// 20 — domino: 700 black dominoes with bone pips, set out in a six-armed spiral on black lacquer that mirrors them. Struck at
// the centre, the fall runs out along every arm: each one tips about its front edge, accelerates, strikes the next (a brief
// ember flash on impact) and comes to rest leaning on it. Later they stand back up, outermost first.
// click a domino: topple the line from there · hover: carry a lamp over them · drag: turn the table
go('domino', ({ scene, camera }) => {
  const LOOP = 14, ARMS = 6, GAP = 0.1, W = 0.15, HT = 0.28, TH = 0.04, STEP = 0.034, FALL = 0.34, REST = 0.98
  // ── layout: six Archimedean arms, a domino every GAP along each ──
  const doms = []
  for (let a = 0; a < ARMS; a++) {
    let th = 0, k = 0
    const at = t => { const r = 0.3 + 0.6 * t, q = t + (a / ARMS) * TAU; return [Math.cos(q) * r, Math.sin(q) * r] }
    while (true) {
      const [x, z] = at(th); if (Math.hypot(x, z) > 2.5) break
      let t2 = th + 0.01, [x2, z2] = at(t2); while (Math.hypot(x2 - x, z2 - z) < GAP) (t2 += 0.004), ([x2, z2] = at(t2))
      doms.push({ arm: a, k: k++, x, z, yaw: Math.atan2(x2 - x, z2 - z), fallT: null, riseT: null, last: false, pips: [R(7) | 0, R(7) | 0] }), (th = t2)
    }
  }
  const N = doms.length, arms = Array.from({ length: ARMS }, (_, a) => doms.filter(d => d.arm === a))
  arms.forEach(l => (l[l.length - 1].last = true))

  // ── the dominoes: black lacquer, bone pips and a centre line on both faces, an ember flash where they strike ──
  const geo = new THREE.BoxGeometry(W, HT, TH).translate(0, HT / 2, -TH / 2) // pivot: the bottom front edge
  const heat = new Float32Array(N), pips = new Float32Array(N * 2)
  doms.forEach((d, i) => pips.set(d.pips, i * 2))
  geo.setAttribute('heat', new THREE.InstancedBufferAttribute(heat, 1)), geo.setAttribute('pips', new THREE.InstancedBufferAttribute(pips, 2))
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 })
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, { accent: U.accent, ink: U.ink })
    s.vertexShader = 'attribute float heat; attribute vec2 pips; varying float vHeat; varying vec2 vPips, vFace; varying float vZ;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = heat; vPips = pips; vFace = uv; vZ = normal.z;')
    s.fragmentShader = `uniform vec3 accent, ink; varying float vHeat; varying vec2 vPips, vFace; varying float vZ;
      float pip(vec2 g, int n){                           // the classic die faces on a 3×3 grid
        int m = n == 1 ? 16 : n == 2 ? 257 : n == 3 ? 273 : n == 4 ? 325 : n == 5 ? 341 : n == 6 ? 365 : 0; float p = 0.;
        for (int k = 0; k < 9; k++) if (((m >> k) & 1) == 1) p = max(p, smoothstep(.36, .26, length(g - vec2(float(k % 3 - 1), float(k / 3 - 1)))));
        return p;
      }\n` + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vZ) > .5) {
          float top = step(.5, vFace.y), y = fract(vFace.y * 2.); vec2 g = (vec2(vFace.x, y) - .5) / vec2(.27, .25);
          float p = pip(g, int(mix(vPips.x, vPips.y, top) + .5)) + smoothstep(.03, .0, abs(vFace.y - .5)) * step(abs(vFace.x - .5), .38);
          diffuseColor.rgb = mix(diffuseColor.rgb, ink * .55, clamp(p, 0., 1.));
        }`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mix(accent * 1.5, ink * 2., smoothstep(.6, 1., vHeat)) * vHeat;')
  }
  const mesh = new THREE.InstancedMesh(geo, mat, N)
  mesh.frustumCulled = false

  // the table: a mirror under a dark veil = black lacquer
  const mirror = new Reflector(new THREE.CircleGeometry(12, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x8a8a8a })
  mirror.rotation.x = -Math.PI / 2
  const veil = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6, transparent: true, opacity: 0.72 }))
  veil.rotation.x = -Math.PI / 2, (veil.position.y = 0.001)
  const lamp = new THREE.PointLight(U.accent.value, 0, 4, 1.4), table = new THREE.Group().add(mesh, veil, lamp)
  scene.add(mirror, table)

  // ── motion: a pendulum fall onto the next, a small rebound, then the lean; standing up again is the same eased back ──
  const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  const angle = (d, t) => {
    if (d.fallT === null || t < d.fallT) return [0, 0]
    const s = t - d.fallT, end = d.last ? Math.PI / 2 - 0.02 : REST
    let a = s < FALL ? end * (s / FALL) ** 2 : end + 0.05 * Math.exp(-(s - FALL) * 9) * Math.sin((s - FALL) * 28)
    const h = s > FALL ? 0.6 * Math.exp(-(s - FALL) * 7) : 0
    if (d.riseT !== null && t > d.riseT) { const r = ease((t - d.riseT) / 0.6); a *= 1 - r; if (r >= 1) d.fallT = d.riseT = null }
    return [a, h]
  }
  const topple = (list, from, t) => { for (let k = from, n = 0; k < list.length; k++, n++) { if (list[k].fallT !== null) break; list[k].fallT = t + n * STEP } }

  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3), hit = new THREE.Vector3(), O = new THREE.Object3D()
  let now = 0, lastP = 0, down = null, yaw = 0, vy = 0, lx = 0
  addEventListener('pointerdown', () => ((down = { moved: 0 }), (lx = pointer.x)))
  addEventListener('pointermove', () => { if (!down) return; down.moved += Math.abs(pointer.x - lx); if (down.moved > 0.02) (vy = (pointer.x - lx) * 2.5), (yaw += vy); lx = pointer.x })
  addEventListener('pointerup', () => {
    if (down && down.moved < 0.02) { ray.setFromCamera(pointer, camera); const h = ray.intersectObject(mesh)[0]; if (h) { const d = doms[h.instanceId]; topple(arms[d.arm], d.k, now) } }
    down = null
  })

  return (t, p) => {
    now = t
    const cross = at => (lastP < at && p >= at) || (p < lastP && at <= p)
    if (cross(0.06)) arms.forEach(l => topple(l, 0, t))                                                   // the loop's strike at the centre
    if (cross(0.6)) arms.forEach(l => l.forEach((d, k) => d.fallT !== null && d.riseT === null && (d.riseT = t + (l.length - k) * 0.016))) // and the rising, outermost first
    lastP = p
    if (!down) yaw += vy *= 0.93
    table.rotation.y = yaw + Math.sin(p * TAU) * 0.2
    doms.forEach((d, i) => {
      const [a, h] = angle(d, t)
      O.position.set(d.x, 0, d.z), O.rotation.set(0, d.yaw, 0, 'YXZ'), O.rotateX(a), O.updateMatrix(), mesh.setMatrixAt(i, O.matrix), (heat[i] = h)
    })
    mesh.instanceMatrix.needsUpdate = geo.attributes.heat.needsUpdate = true
    // the lamp follows the cursor, low over the table
    if (pointer.active && (ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(plane, hit))) table.worldToLocal(hit), lamp.position.lerp(hit, 0.15), (lamp.intensity += (4 - lamp.intensity) * 0.1)
    else lamp.intensity *= 0.95
  }
}, { loop: 14, eye: [0, 6.6, 5.4], drift: 0.35, bloom: 0.6, parallax: 0.3 })
