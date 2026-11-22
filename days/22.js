import { go, THREE, C, U, R, TAU } from '../lib/stage.js'

go('untitled', ({ scene }) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), new THREE.MeshStandardMaterial({ color: C.ink, metalness: 1, roughness: 0.15 }))
  scene.add(m)
  return (t, p) => m.rotation.set(p * TAU, p * TAU * 2, 0) // use p (0→1 per loop) for seamless video
})
