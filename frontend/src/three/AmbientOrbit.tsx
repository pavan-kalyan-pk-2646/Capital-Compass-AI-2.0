import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function ShardField() {
  const group = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const pointer = useRef({ x: 0, y: 0 })
  const shards = useMemo(() => Array.from({ length: 42 }, () => ({
    p: [(Math.random() - 0.5) * 13, (Math.random() - 0.5) * 8, -1 - Math.random() * 7] as [number, number, number],
    r: [Math.random() * 2, Math.random() * 2, Math.random() * 2] as [number, number, number],
    s: 0.08 + Math.random() * 0.3,
    w: 0.5 + Math.random() * 1.8,
  })), [])
  const particles = useMemo(() => {
    const n = 420
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const r = 3 + Math.random() * 8
      const t = Math.random() * Math.PI * 2
      a[i * 3] = Math.cos(t) * r
      a[i * 3 + 1] = (Math.random() - 0.5) * 8
      a[i * 3 + 2] = Math.sin(t) * r - 5
    }
    return a
  }, [])
  useEffect(() => {
    const move = (e: MouseEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      pointer.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', move, { passive: true })
    return () => window.removeEventListener('mousemove', move)
  }, [])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const p = pointer.current
    camera.position.x += (p.x * 0.7 - camera.position.x) * 0.018
    camera.position.y += (-p.y * 0.45 - camera.position.y) * 0.018
    camera.lookAt(0, 0, -4)
    if (group.current) {
      group.current.rotation.y = t * 0.025 + p.x * 0.04
      group.current.rotation.x = Math.sin(t * 0.13) * 0.04 + p.y * 0.02
      group.current.children.forEach((m, i) => {
        const w = shards[i]?.w ?? 1
        m.rotation.x += 0.001 * w
        m.rotation.y += 0.0015 * w
      })
    }
  })
  return (
    <>
      <group ref={group}>
        {shards.map((s, i) => (
          <mesh key={i} position={s.p} rotation={s.r} scale={s.s}>
            <icosahedronGeometry args={[1, 0]} />
            <meshPhysicalMaterial color="#080b12" metalness={0.98} roughness={0.22} clearcoat={0.8} emissive="#121326" emissiveIntensity={0.7} transparent opacity={0.72} />
          </mesh>
        ))}
      </group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles, 3]} count={particles.length / 3} />
        </bufferGeometry>
        <pointsMaterial color="#c9a24a" size={0.018} transparent opacity={0.28} sizeAttenuation />
      </points>
      <gridHelper args={[20, 40, '#263449', '#101722']} position={[0, -4.2, -5]} rotation={[0, 0, 0]} material-opacity={0.18} material-transparent />
    </>
  )
}

export default function AmbientOrbit() {
  return (
    <div className="ambient-orbit" aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 1.35]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
        <ambientLight intensity={0.16} />
        <pointLight position={[4, 4, 3]} intensity={11} color="#c9a24a" />
        <pointLight position={[-5, 2, 1]} intensity={9} color="#5d3fd3" />
        <pointLight position={[0, -4, -2]} intensity={6} color="#246bff" />
        <ShardField />
      </Canvas>
    </div>
  )
}
