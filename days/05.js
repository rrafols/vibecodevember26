import { go, THREE, U, TAU, pointer } from '../lib/stage.js'

// 05 — attraction: a single drop of black ferrofluid floating in the void. Two magnets circle it; where the field is strong the
// mirror sphere stretches towards them and erupts into a crown of razor spikes with ember-lit flanks, then settles back to glass.
// move: you are a third magnet · hold: pull harder
go('attraction', ({ scene, camera, renderer }) => {
  const u = { ...U, m: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] } } // xyz: direction · w: strength
  const glsl = `
    uniform vec4 m[3];
    vec3 hash3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
    float cell(vec3 p){                                  // distance to the nearest of a jittered 3D lattice: one spike per cell
      vec3 i = floor(p), f = fract(p); float d = 9.;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(x, y, z); d = min(d, length(g + .3 + .4 * hash3(i + g) - f)); // modest jitter: near-regular spacing
      }
      return d;
    }
    float field(vec3 d){ float B = 0.; for (int i = 0; i < 3; i++) B += m[i].w * exp((dot(d, m[i].xyz) - 1.) * 2.3); return B; }
    float spike(vec3 d, float B){ return smoothstep(.3, 1., B) * pow(max(0., 1. - cell(d * 4.2) / (.4 + .1 * B)), 1.25); } // 0→1; below the threshold the fluid stays smooth
    float H(vec3 d){ float B = field(d); return .14 * B + spike(d, B) * (.14 + .36 * min(B, 1.6)); } // radial height along direction d
    vec3 S(vec3 d){ d = normalize(d); return d * (1. + H(d)); }`

  // a private dark studio for the mirror to reflect: black, a soft overhead strip, a side strip, a faint backdrop
  const studio = new THREE.Scene(), strip = (w, h, c, k, ...at) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }))
    s.position.set(...at), s.lookAt(0, 0, 0), studio.add(s)
  }
  strip(10, 0.6, U.ink.value, 4, 1, 7, 3), strip(0.4, 10, U.ink.value, 2.5, -7, 1, 2), strip(30, 30, U.ink.value, 0.08, 0, 0, -14)
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x3c3c40, metalness: 1, roughness: 0.1, envMap: new THREE.PMREMGenerator(renderer).fromScene(studio, 0.01).texture })
  mat.onBeforeCompile = s => {
    s.uniforms.m = u.m, (s.uniforms.accent = u.accent)
    s.fragmentShader = 'uniform vec3 accent; varying float vK;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += accent * pow(vK, 5.) * 2.6;') // ember-hot tips
    s.vertexShader = glsl + '\nvarying float vK;\n' + s.vertexShader // the newline matters: the shader starts with #define
      .replace('#include <beginnormal_vertex>', `
        vec3 d0 = normalize(position), t1 = normalize(cross(d0, abs(d0.y) < .99 ? vec3(0, 1, 0) : vec3(1, 0, 0))), t2 = cross(d0, t1);
        float e = .004; vec3 objectNormal = normalize(cross(S(d0 + t1 * e) - S(d0 - t1 * e), S(d0 + t2 * e) - S(d0 - t2 * e)));
        if (dot(objectNormal, d0) < 0.) objectNormal = -objectNormal;
        float B0 = field(d0); vK = spike(d0, B0) * smoothstep(.5, 1.3, B0);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = S(d0);')
  }
  const drop = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 150), mat)
  scene.add(drop)
  scene.traverse(o => o.isDirectionalLight && o.color.getHex() !== 0xffffff && o.color.r > o.color.b * 2 && (o.intensity = 0)) // mute the stage's ember rim: a mirror's silhouette would flare it; the tips glow instead

  // ── magnets: two circling the drop on closed paths, surging in turn · plus the cursor, stronger while held ──
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3(), cur = new THREE.Vector3(0, 0, 1), V = new THREE.Vector3()
  let me = 0, held = 0, down = false
  addEventListener('pointerdown', () => (down = true)), addEventListener('pointerup', () => (down = false))

  return (t, p) => {
    const a = p * TAU, M = u.m.value
    // orbits mostly across the silhouette, so the spikes are seen in profile; each surges in turn
    M[0].set(...V.set(Math.cos(a), 0.75 * Math.sin(a), 0.3 * Math.sin(2 * a)).normalize().toArray(), 0.42 + 0.95 * Math.max(0, Math.sin(a)) ** 2)
    M[1].set(...V.set(-Math.cos(a + 1.2), -0.8 * Math.sin(a + 1.2), -0.35 * Math.cos(2 * a)).normalize().toArray(), 0.4 + 0.95 * Math.max(0, -Math.sin(a)) ** 2)
    if (pointer.active) {
      ray.setFromCamera(pointer, camera)
      if (ray.ray.intersectPlane(plane, hit)) cur.lerp(V.copy(hit).setZ(1.6).normalize(), 0.15) // towards the cursor, leaning to the viewer
      me += (1 - me) * 0.04, (held += ((down ? 1 : 0) - held) * 0.06)
    }
    M[2].set(cur.x, cur.y, cur.z, me * (0.75 + 0.9 * held))
  }
}, { loop: 14, eye: [0, 0.3, 6.5], bloom: 0.55 })
