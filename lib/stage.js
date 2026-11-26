// Shared stage: one look for every day. Days only add things to `scene`.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
export { THREE }
export { noise } from './noise.js'

export const TAU = Math.PI * 2
export const C = { bg: 0x060608, ink: 0xf1ede6, accent: 0xff4d1a } // the mood: near-black, bone, one ember
export const REC = location.search.includes('record')

// Seeded random so every run (and every recorded frame) is identical. R() [0,1)  R(a) [0,a)  R(a,b) [a,b)
let s = 1337
const rnd = () => ((s = (s + 0x6d2b79f5) | 0), (s = Math.imul(s ^ (s >>> 15), s | 1)), (s ^= s + Math.imul(s ^ (s >>> 7), s | 61)), ((s ^ (s >>> 14)) >>> 0) / 4294967296)
export const R = (a = 1, b) => (b === undefined ? rnd() * a : a + rnd() * (b - a))

// Shared uniforms — pass straight into any ShaderMaterial: `uniforms: { ...U }` or `uniforms: U`.
// Pointer in NDC (-1..1, y up) for raycasting: `ray.setFromCamera(pointer, camera)`. `.active` once the mouse moved (never while recording).
export const pointer = Object.assign(new THREE.Vector2(), { active: false })

// Full-screen raymarch quad. The fragment shader gets `varying vec3 vRay` (world-space view ray) and three's `cameraPosition`.
// Pixels it discards show the stage background, so a raymarched day keeps the same look.
export const raymarch = (fragmentShader, uniforms = U) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, fragmentShader, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vRay; void main(){ vRay = (inverse(viewMatrix) * vec4((inverse(projectionMatrix) * vec4(position.xy, 1., 1.)).xyz, 0.)).xyz; gl_Position = vec4(position.xy, 1., 1.); }`,
  }))
  m.frustumCulled = false
  return m
}

export const U = {
  time: { value: 0 }, // seconds
  phase: { value: 0 }, // 0→1 over one loop: animate with this for seamless videos
  res: { value: new THREE.Vector2() }, // drawing-buffer px
  ink: { value: new THREE.Color(C.ink) },
  accent: { value: new THREE.Color(C.accent) },
}

/**
 * go(title, setup, options)
 *   setup({ scene, camera, renderer }) → optional (t, p) => {}   t: seconds, p: loop phase 0..1
 *   options: { loop: 10 (s), eye: [0,0,10], drift: 1, bloom: .9, fog: .045, blend: 0 (s: recorder crossfades end→start, for stateful sims),
 *              dpr: 2 (max pixel ratio live; 1 for heavy raymarched days), parallax: 1 (camera follows the mouse; 0 when the cursor is a tool) }
 */
export function go(title, setup, o = {}) {
  o = { loop: 10, eye: [0, 0, 10], drift: 1, bloom: 0.9, fog: 0.045, dpr: 2, parallax: 1, ...o }

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: REC })
  renderer.setPixelRatio(REC ? 1 : Math.min(devicePixelRatio, o.dpr))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  document.body.prepend(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(C.bg)
  scene.fog = new THREE.FogExp2(C.bg, o.fog)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.3

  const key = new THREE.DirectionalLight(C.ink, 2)
  const rim = new THREE.DirectionalLight(C.accent, 2.5)
  key.position.set(3, 5, 4), rim.position.set(-4, -1, -6)
  scene.add(key, rim, new THREE.HemisphereLight(C.ink, C.bg, 0.25))

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200)
  const eye = new THREE.Vector3(...o.eye)

  // Post: bloom → tone map → grain / vignette / chromatic fringe (same on every day)
  const composer = new EffectComposer(renderer)
  const fx = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: U.time, res: U.res },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - .5; float k = dot(d, d);
        vec2 o = d * k * .02;
        vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
        c *= mix(.25, 1., smoothstep(.8, .15, length(d)));
        c += (h(vUv * res + fract(floor(time * 24.) * .1373) * 91.) - .5) * .035;
        gl_FragColor = vec4(c, 1.);
      }`,
  })
  ;[new RenderPass(scene, camera), new UnrealBloomPass(new THREE.Vector2(), o.bloom, 0.6, 0.12), new OutputPass(), fx].forEach(p => composer.addPass(p))

  const size = () => {
    const w = innerWidth, h = innerHeight
    renderer.setSize(w, h), composer.setSize(w, h)
    camera.aspect = w / h, camera.updateProjectionMatrix()
    renderer.getDrawingBufferSize(U.res.value)
  }
  addEventListener('resize', size), size()

  const mouse = new THREE.Vector2(), m = new THREE.Vector2()
  addEventListener('pointermove', e => {
    mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5)
    pointer.set(mouse.x * 2, -mouse.y * 2), (pointer.active = true)
  })

  const update = setup({ scene, camera, renderer, composer }) || (() => {})

  const frame = t => {
    const p = (t / o.loop) % 1, a = p * TAU
    U.time.value = t, U.phase.value = p
    m.lerp(mouse, 0.04)
    camera.position.copy(eye).multiplyScalar(Math.max(1, 1 / camera.aspect)) // keep framing in portrait
    camera.position.x += (Math.sin(a) * 0.6 + m.x * 2 * o.parallax) * o.drift
    camera.position.y += (Math.sin(a * 2) * 0.25 - m.y * 1.2 * o.parallax) * o.drift
    camera.lookAt(0, 0, 0)
    update(t, p)
    composer.render()
  }

  // Labels: the only typography, identical everywhere (title bottom-left, author top-right)
  const day = document.body.dataset.day || ''
  document.body.insertAdjacentHTML('beforeend', `<div id=label><span>vibecodevember ’26</span><span>${day} — ${title}</span></div><div id=author>bp ^ fzn</div>`)
  document.title = `${day} · ${title}`

  if (REC) renderer.domElement.style.cssText += 'opacity:1;transition:none', Object.assign(window, { __frame: frame, __loop: o.loop, __blend: o.blend || 0, __ready: true })
  else renderer.setAnimationLoop(ms => frame(ms / 1000)), requestAnimationFrame(() => document.body.classList.add('on'))
}
