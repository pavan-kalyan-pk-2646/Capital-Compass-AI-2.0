import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/** Procedural low-poly wealth bag: no external asset, intentionally lightweight for the 60s intro. */
export default function MoneyBag() {
  const group = useRef<THREE.Group>(null)
  const coins = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    a: i * 2.39, r: 0.55 + (i % 4) * 0.12, y: 0.55 + (i % 3) * 0.08, s: 0.09 + (i % 3) * 0.025,
  })), [])
  useFrame((_, dt) => {
    if (!group.current) return
    const t = performance.now() / 1000
    const phase = t % 6.5
    const reveal = THREE.MathUtils.smoothstep(phase, 0.8, 1.8)
    const collapse = THREE.MathUtils.smoothstep(phase, 3.2, 4.9)
    const float = Math.sin(t * 1.25) * 0.08
    group.current.visible = reveal > 0.01 && phase < 5.6
    group.current.position.y = -0.7 + float + collapse * 0.55
    group.current.position.z = -1.7 + collapse * 2.2
    group.current.rotation.y += dt * 0.22
    group.current.rotation.z = Math.sin(t * .7) * .035
    group.current.scale.setScalar((0.72 + reveal * 0.32) * (1 - collapse * .65))
  })
  return <group ref={group} position={[0,-.7,-1.7]}>
    <mesh scale={[1.05,.92,.72]} rotation={[0,0,.02]}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshPhysicalMaterial color="#0e6b4b" metalness={0.12} roughness={0.32} clearcoat={.75} clearcoatRoughness={.12} emissive="#063625" emissiveIntensity={.15} />
    </mesh>
    <mesh position={[0,.72,0]} rotation={[0,0,.02]}>
      <cylinderGeometry args={[.34,.26,.38,8]} />
      <meshPhysicalMaterial color="#0b4d39" roughness={.28} clearcoat={.8} />
    </mesh>
    <mesh position={[0,.91,0]} rotation={[0,0,.12]}>
      <torusGeometry args={[.27,.055,6,12]} />
      <meshPhysicalMaterial color="#e4b84e" metalness={1} roughness={.18} clearcoat={.8} />
    </mesh>
    {coins.map((c,i)=><mesh key={i} position={[Math.cos(c.a)*c.r,c.y+Math.sin(c.a*1.7)*.08,Math.sin(c.a)*c.r*.62]} rotation={[.3,i*.7,c.a]} scale={c.s}>
      <cylinderGeometry args={[1,1,.22,8]} />
      <meshPhysicalMaterial color={i%3===0?'#ffe08a':'#d9a62f'} metalness={1} roughness={.2} clearcoat={.75} emissive="#6b3d08" emissiveIntensity={.12}/>
    </mesh>)}
    <mesh position={[0,.7,.06]} scale={[.48,.34,.06]}>
      <sphereGeometry args={[1,8,6]} />
      <meshPhysicalMaterial color="#e4b84e" metalness={1} roughness={.18} clearcoat={.8}/>
    </mesh>
  </group>
}
