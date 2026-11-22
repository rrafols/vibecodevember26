import { go, THREE, C, U, R, noise } from '../lib/stage.js'

// 01 — corona: a star breathing. 200k particles on a noise-warped shell, lit from within, rim-bright like a solar limb
go('corona', ({ scene }) => {
  const n = 200000, pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996 // fibonacci sphere
    pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3)
  }
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }
  const shell = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
    new THREE.ShaderMaterial({
      uniforms: U, ...add,
      vertexShader: noise + `
        uniform float phase; uniform vec2 res; varying float v, rim;
        void main(){
          vec3 o = vec3(cos(phase * 6.2832), sin(phase * 6.2832), 0.) * .8;   // circle through noise space = perfect loop
          float d = snoise(position * 1.3 + o), e = snoise(position * 5. - o * 2.) * .15;
          v = d;
          rim = pow(1. - abs(normalize(normalMatrix * position).z), 3.);    // limb brightening
          vec4 mv = modelViewMatrix * vec4(position * (2. + (d + e) * .6), 1.);
          gl_PointSize = (.7 + pow(max(d, 0.), 2.) * 5.) * res.y / -mv.z * .0045;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 ink, accent; varying float v, rim;
        void main(){
          float l = 1. - length(gl_PointCoord - .5) * 2.; if (l < 0.) discard;
          vec3 c = mix(ink * (.16 + rim * .9), accent * 2.6, smoothstep(.35, .9, v)) + accent * rim * .35;
          gl_FragColor = vec4(c * l * l, 1.);
        }`,
    }),
  )

  // the heart: a soft ember glow behind the shell, so the particles read as backlit
  const g = document.createElement('canvas').getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.canvas.width = g.canvas.height = 128
  ;[[0, 'rgba(255,170,120,.9)'], [0.1, 'rgba(255,77,26,.45)'], [0.35, 'rgba(255,77,26,.06)'], [1, 'rgba(255,77,26,0)']].forEach(s => grad.addColorStop(...s))
  g.fillStyle = grad, g.fillRect(0, 0, 128, 128)
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(g.canvas), ...add, fog: false }))

  // dust: sparse motes orbiting far out, for depth
  const dust = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 4000 * 3 }, () => R(-9, 9)), 3)),
    new THREE.PointsMaterial({ color: C.ink, size: 0.025, ...add, opacity: 0.5 }),
  )

  scene.add(core, shell, dust)
  return (t, p) => {
    const a = p * 6.2832
    shell.rotation.set(Math.sin(a) * 0.2, Math.sin(a) * 0.6, 0)
    core.scale.setScalar(4.2 + Math.sin(a * 2) * 0.5)
    dust.rotation.set(Math.sin(a) * 0.05, Math.sin(a) * 0.15, 0)
  }
}, { bloom: 1.25 })
