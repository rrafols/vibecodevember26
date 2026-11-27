import { go, THREE, U, R, TAU, noise, pointer } from '../lib/stage.js'

// spike (kept for later) — inferno: a 2D stable-fluids simulation on the GPU (advection, vorticity confinement, buoyancy,
// a pressure solve) carrying heat and smoke up from a bed of embers. Colour is blackbody: white-hot, ember, then smoke.
// hover: fan the flames · click: throw fuel on
// To try it: copy to days/NN.js and build.
go('inferno', ({ scene, renderer }) => {
  const SIM = 192, DYE = 512, JACOBI = 24
  const rt = n => new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false })
  const pair = n => { const a = rt(n), b = rt(n); return { r: a, w: b, swap() { [this.r, this.w] = [this.w, this.r] } } }
  const vel = pair(SIM), dye = pair(DYE), prs = pair(SIM), div = rt(SIM), crl = rt(SIM)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), qs = new THREE.Scene().add(quad), qc = new THREE.Camera(); quad.frustumCulled = false
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`
  const M = (fs, uni) => new THREE.ShaderMaterial({ uniforms: uni, vertexShader: vs, fragmentShader: fs, depthTest: false, depthWrite: false })
  const T = { value: new THREE.Vector2(1 / SIM, 1 / SIM) }, dt = { value: 1 / 60 }, time = U.time
  const nb = `uniform vec2 tx; vec4 L(sampler2D s){ return texture2D(s, vUv - vec2(tx.x, 0.)); } vec4 Rr(sampler2D s){ return texture2D(s, vUv + vec2(tx.x, 0.)); } vec4 B(sampler2D s){ return texture2D(s, vUv - vec2(0., tx.y)); } vec4 Tp(sampler2D s){ return texture2D(s, vUv + vec2(0., tx.y)); }`
  const advect = M(`uniform sampler2D uV, uS; uniform float dt, diss; varying vec2 vUv; void main(){ vec2 c = vUv - dt * texture2D(uV, vUv).xy; gl_FragColor = texture2D(uS, c) * diss; }`, { uV: { value: null }, uS: { value: null }, dt, diss: { value: 1 } })
  const curl = M(`uniform sampler2D uV; varying vec2 vUv; ${nb} void main(){ gl_FragColor = vec4(.5 * (Rr(uV).y - L(uV).y - Tp(uV).x + B(uV).x), 0., 0., 1.); }`, { uV: { value: null }, tx: T })
  const forces = M(noise + `uniform sampler2D uV, uC, uD; uniform float dt, time; uniform vec4 fan; varying vec2 vUv; ${nb}
    void main(){
      vec2 v = texture2D(uV, vUv).xy; vec4 d = texture2D(uD, vUv);
      vec2 f = .5 * vec2(abs(Tp(uC).x) - abs(B(uC).x), abs(Rr(uC).x) - abs(L(uC).x)); f /= length(f) + 1e-4;     // vorticity confinement: keep the curls
      v += vec2(f.y, -f.x) * texture2D(uC, vUv).x * 9. * dt;
      v.y += (d.r * 4.2 - d.g * .2) * dt;                                                                     // hot rises, smoke is heavy
      float bed = smoothstep(.09, .0, vUv.y) * smoothstep(.0, .2, vUv.x) * smoothstep(1., .8, vUv.x);
      v.y += bed * (.6 + .6 * snoise(vec3(vUv.x * 9., time * 1.3, 0.))) * dt * 10.;
      vec2 dp = vUv - fan.xy; v += fan.zw * exp(-dot(dp, dp) / .006) * dt * 30.;                                // your hand
      gl_FragColor = vec4(v * .999, 0., 1.);
    }`, { uV: { value: null }, uC: { value: null }, uD: { value: null }, dt, time, fan: { value: new THREE.Vector4() }, tx: T })
  const heat = M(noise + `uniform sampler2D uD; uniform float time; uniform vec4 fuel; varying vec2 vUv;
    void main(){
      vec4 d = texture2D(uD, vUv);
      float bed = smoothstep(.07, .0, vUv.y) * smoothstep(.02, .22, vUv.x) * smoothstep(.98, .78, vUv.x);
      float burn = max(0., snoise(vec3(vUv.x * 14., time * 1.7, 3.)) * .7 + snoise(vec3(vUv.x * 37., time * 3.1, 9.)) * .4 + .25);
      d.r += bed * burn * .08;                                                                                   // the embers feed heat
      vec2 q = vUv - fuel.xy; d.r += fuel.z * exp(-dot(q, q) / .004) * .5;                                       // thrown fuel flares
      float cool = d.r * .032; d.r -= cool; d.g += cool * 1.6;                                                   // cooling fire becomes smoke
      d.g *= .992;
      gl_FragColor = d;
    }`, { uD: { value: null }, time, fuel: { value: new THREE.Vector4() } })
  const divergence = M(`uniform sampler2D uV; varying vec2 vUv; ${nb} void main(){ float l = L(uV).x, r = Rr(uV).x, b = B(uV).y, t = Tp(uV).y; if (vUv.x - tx.x < 0.) l = -r; if (vUv.x + tx.x > 1.) r = -l; if (vUv.y - tx.y < 0.) b = -t; if (vUv.y + tx.y > 1.) t = -b; gl_FragColor = vec4(.5 * (r - l + t - b), 0., 0., 1.); }`, { uV: { value: null }, tx: T })
  const jacobi = M(`uniform sampler2D uP, uDv; varying vec2 vUv; ${nb} void main(){ gl_FragColor = vec4((L(uP).x + Rr(uP).x + B(uP).x + Tp(uP).x - texture2D(uDv, vUv).x) * .25, 0., 0., 1.); }`, { uP: { value: null }, uDv: { value: null }, tx: T })
  const project = M(`uniform sampler2D uP, uV; varying vec2 vUv; ${nb} void main(){ vec2 v = texture2D(uV, vUv).xy - .5 * vec2(Rr(uP).x - L(uP).x, Tp(uP).x - B(uP).x); gl_FragColor = vec4(v, 0., 1.); }`, { uP: { value: null }, uV: { value: null }, tx: T })
  const fade = M(`uniform sampler2D uP; varying vec2 vUv; void main(){ gl_FragColor = texture2D(uP, vUv) * .8; }`, { uP: { value: null } })
  const run = (mat, target) => { quad.material = mat, renderer.setRenderTarget(target), renderer.render(qs, qc) }

  // display: blackbody heat over smoke lit from below
  const show = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { ...U, uD: { value: null } }, depthTest: false, depthWrite: false,
    vertexShader: vs, fragmentShader: `uniform sampler2D uD; uniform vec3 ink, accent; varying vec2 vUv;
      vec3 body(float t){ return accent * vec3(.3, .05, .03) * smoothstep(.04, .25, t) + accent * smoothstep(.18, .55, t) * .55 + mix(accent, ink, .5) * smoothstep(.5, .9, t) * .7 + ink * smoothstep(.9, 1.6, t) * .9; }
      void main(){
        vec4 d = texture2D(uD, vUv); float t = d.r, sm = clamp(d.g * .5, 0., 1.);
        vec3 c = body(t) + vec3(.03, .025, .024) * sm * (.2 + .8 * smoothstep(.6, .0, vUv.y));
        c += accent * .2 * smoothstep(.025, .0, vUv.y);                                                        // the bed of embers
        gl_FragColor = vec4(c, 1.);
      }` }))
  show.frustumCulled = false, scene.add(show)

  let last = new THREE.Vector2(), had = false
  const fuel = heat.uniforms.fuel.value, fan = forces.uniforms.fan.value
  addEventListener('pointerdown', () => fuel.set(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5, 1, 0))
  return () => {
    if (pointer.active) { const at = new THREE.Vector2(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5); if (had) fan.set(at.x, at.y, (at.x - last.x) * 60, (at.y - last.y) * 60); else fan.set(at.x, at.y, 0, 0); last.copy(at), (had = true) } else fan.set(0, 0, 0, 0)
    curl.uniforms.uV.value = vel.r.texture, run(curl, crl)
    forces.uniforms.uV.value = vel.r.texture, (forces.uniforms.uC.value = crl.texture), (forces.uniforms.uD.value = dye.r.texture), run(forces, vel.w), vel.swap()
    divergence.uniforms.uV.value = vel.r.texture, run(divergence, div)
    fade.uniforms.uP.value = prs.r.texture, run(fade, prs.w), prs.swap()
    jacobi.uniforms.uDv.value = div.texture
    for (let i = 0; i < JACOBI; i++) (jacobi.uniforms.uP.value = prs.r.texture), run(jacobi, prs.w), prs.swap()
    project.uniforms.uP.value = prs.r.texture, (project.uniforms.uV.value = vel.r.texture), run(project, vel.w), vel.swap()
    advect.uniforms.uV.value = vel.r.texture, (advect.uniforms.uS.value = vel.r.texture), (advect.uniforms.diss.value = 0.995), run(advect, vel.w), vel.swap()
    heat.uniforms.uD.value = dye.r.texture, run(heat, dye.w), dye.swap()
    advect.uniforms.uV.value = vel.r.texture, (advect.uniforms.uS.value = dye.r.texture), (advect.uniforms.diss.value = 0.998), run(advect, dye.w), dye.swap()
    renderer.setRenderTarget(null)
    show.material.uniforms.uD.value = dye.r.texture
    fuel.z *= 0.85
  }
}, { loop: 16, drift: 0, bloom: 0.6, fog: 0 })
