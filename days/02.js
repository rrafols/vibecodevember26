import { go, THREE, C, R, TAU, pointer } from '../lib/stage.js'

// 02 — aftershock: a disc of dark steel rods. Shockwaves from three epicentres roll out and heat them from the base up.
// Hover warms the rods under the cursor, click to strike your own.
go('aftershock', ({ scene, camera }) => {
  const N = 96, S = 0.17, E = 7.2, rods = [], M = new THREE.Matrix4(), col = new THREE.Color()
  const ember = new THREE.Color(C.accent).multiplyScalar(0.9), white = new THREE.Color(C.ink).multiplyScalar(1.1)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i - N / 2 + (j & 1) * 0.5) * S, z = (j - N / 2) * S * 0.866, r = Math.hypot(x, z) // hex grid, cut to a disc
    if (r < E) rods.push({ x, z, k: R(0.75, 1.25), m: THREE.MathUtils.smoothstep(E - r, 0, E * 0.55) }) // m: sinks + cools toward the rim
  }
  const quakes = [0, 1 / 3, 2 / 3].map(o => ({ x: R(-2.5, 2.5), z: R(-2.5, 2.5), o })) // staggered epicentres, one strike each per loop
  const strikes = [], ray = new THREE.Raycaster(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1), hit = new THREE.Vector3(), cur = new THREE.Vector3(0, 0, 99)
  let now = 0, warm = 0
  addEventListener('pointerdown', () => pointer.active && strikes.push({ x: cur.x, z: cur.z, t: now }))

  // steel body + heat that climbs the rod: emissive = instance colour × height⁴ (glowing tip, cool base)
  const mat = new THREE.MeshStandardMaterial({ color: 0x0c0c0f, metalness: 0.9, roughness: 0.32 })
  mat.onBeforeCompile = s => {
    s.vertexShader = 'varying float vH;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;')
    s.fragmentShader = 'varying float vH;\n' + s.fragmentShader
      .replace('#include <color_fragment>', '') // instance colour is heat, not paint
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vColor.rgb * pow(vH, 4.);')
  }
  const field = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6).translate(0, 0.5, 0), mat, rods.length)
  scene.add(field)

  const ring = (d, R, a) => a * Math.exp(-((d - R) ** 2) / 0.16) // a travelling wavefront

  return (t, p) => {
    const a = p * TAU
    now = t
    if (pointer.active) ray.setFromCamera(pointer, camera), ray.ray.intersectPlane(floor, hit) && (cur.lerp(hit, 0.15), (warm += (1 - warm) * 0.05))
    while (strikes.length && t - strikes[0].t > 6) strikes.shift()

    rods.forEach(({ x, z, k, m }, i) => {
      let w = 0
      for (const q of quakes) {
        const s = (p + q.o) % 1 // 0→1 life of this shockwave; wraps with the loop → seamless
        w += ring(Math.hypot(x - q.x, z - q.z), s * 11, (1 - s) ** 2.5)
      }
      for (const s of strikes) w += ring(Math.hypot(x - s.x, z - s.z), (t - s.t) * 3.5, 0.75 * Math.exp(-(t - s.t) * 0.9))
      w += warm * 0.8 * Math.exp(-((x - cur.x) ** 2 + (z - cur.z) ** 2) / 0.5) // cursor hotspot
      w = Math.min(1, w) * m
      const swell = (0.08 + 0.06 * Math.sin(x * 0.7 + a) * Math.sin(z * 0.6 - a)) * m // slow breathing ground
      field.setMatrixAt(i, M.makeScale(1, 0.001 + swell + w * 1.9 * k, 1).setPosition(x, -1, z))
      field.setColorAt(i, col.setRGB(0, 0, 0).lerp(ember, Math.min(1, w * 3)).lerp(white, w ** 4))
    })
    field.instanceMatrix.needsUpdate = field.instanceColor.needsUpdate = true
  }
}, { eye: [0, 3.4, 10], fog: 0.07, bloom: 0.7 })
