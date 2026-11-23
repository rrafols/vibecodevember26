import { go, THREE, U, TAU, pointer } from '../lib/stage.js'

// 05 — attraction: a still pool of black ferrofluid. A magnet drifts beneath it; when the field surges the mirror
// breaks into a hexagonal crown of razor spikes with ember-hot tips, then melts back to glass.
// move: you are the magnet · hold: pull harder
go('attraction', ({ scene, camera, renderer }) => {
  const u = { ...U, mag: { value: new THREE.Vector4() } } // xz: magnet position · z: field strength · w: field radius
  const glsl = `
    uniform vec4 mag;
    vec2 hex(vec2 p, float s){                          // offset to the nearest point of a hex lattice
      vec2 r = vec2(1., 1.7320508) * s, h = r * .5, a = mod(p, r) - h, b = mod(p - h, r) - h;
      return dot(a, a) < dot(b, b) ? a : b;
    }
    float field(vec2 p){ vec2 d = p - mag.xy; return mag.z * exp(-dot(d, d) / (mag.w * mag.w)); }
    float spikes(vec2 p){                               // 0 → 1 cone per lattice cell, anchored on the magnet so the crown travels with it
      float B = field(p), k = smoothstep(.28, 1., B);   // below the threshold the fluid stays smooth (it's an instability)
      return k * pow(max(0., 1. - length(hex(p - mag.xy, .36)) / (.13 + .07 * B)), 1.4) * (.22 + .55 * B);
    }
    float H(vec2 p){ float B = field(p); return .55 * B * B + spikes(p); }`

  // its own dark studio to reflect: black, one soft overhead strip, a side strip, a thin ember horizon. The mirror draws them as lines.
  const studio = new THREE.Scene(), strip = (w, h, c, k, ...at) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(...at), m.lookAt(0, 0, 0), studio.add(m)
  }
  strip(9, 0.5, U.ink.value, 2.2, 0, 7, -3), strip(0.35, 9, U.ink.value, 1.2, -7, 3, 1), strip(16, 0.12, U.accent.value, 4, 0, 0.6, -9)
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x020203, metalness: 1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, envMap: new THREE.PMREMGenerator(renderer).fromScene(studio, 0.01).texture })
  mat.onBeforeCompile = s => {
    s.uniforms.mag = u.mag, s.uniforms.accent = u.accent
    s.vertexShader = glsl + 'varying vec2 vP;\n' + s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position; transformed.y += H(position.xz); vP = position.xz;')
    s.fragmentShader = glsl + 'uniform vec3 accent; varying vec2 vP;\n' + s.fragmentShader
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = 1.;                       // per-pixel normal from the height field: tips stay razor sharp at any mesh density
        vec2 e = vec2(.003, 0.);
        vec3 normal = normalize((viewMatrix * vec4(normalize(vec3(H(vP - e.xy) - H(vP + e.xy), 2. * e.x, H(vP - e.yx) - H(vP + e.yx))), 0.)).xyz);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += accent * pow(spikes(vP) / (.22 + .55 * mag.z), 16.) * 3. * smoothstep(.4, 1.1, mag.z);') // ember-hot tips under a strong field
  }
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 600, 600).rotateX(-Math.PI / 2), mat)
  pool.position.y = -1
  scene.add(pool)

  // ── the magnet: drifts on a closed path and surges twice per loop · or follows the cursor, stronger while held ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1), hit = new THREE.Vector3(), cur = new THREE.Vector2(), V = new THREE.Vector2()
  let me = 0, held = 0, down = false
  addEventListener('pointerdown', () => (down = true)), addEventListener('pointerup', () => (down = false))

  return (t, p) => {
    const a = p * TAU
    const auto = V.set(Math.sin(a) * 1.3, Math.sin(2 * a) * 0.7), surge = 0.2 + 0.95 * (0.5 - 0.5 * Math.cos(2 * a)) ** 1.6
    if (pointer.active) {
      ray.setFromCamera(pointer, camera)
      if (ray.ray.intersectPlane(plane, hit)) cur.lerp(V.set(hit.x, hit.z), me ? 0.12 : 1)
      me += (1 - me) * 0.04, (held += ((down ? 1 : 0) - held) * 0.06)
    }
    const at = V.set(Math.sin(a) * 1.3, Math.sin(2 * a) * 0.7).lerp(cur, me)
    u.mag.value.set(at.x, at.y, surge * (1 - me) + me * (0.85 + 0.55 * held), 1.5 + 0.3 * held)
  }
}, { loop: 12, eye: [0, 2.6, 7.5], fog: 0.07, bloom: 0.7 })
