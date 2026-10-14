import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

function WealthCore({ burst }: { burst: number }) {
  const group = useRef<THREE.Group>(null)
  const points = useMemo(() => {
    const n = 520
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1
      const t = Math.random() * Math.PI * 2
      const r = 1.75 * Math.cbrt(Math.random())
      const s = Math.sqrt(1 - u * u)
      a[i*3] = r*s*Math.cos(t); a[i*3+1] = r*u; a[i*3+2] = r*s*Math.sin(t)
    }
    return a
  }, [])
  useFrame(({ clock, pointer }) => {
    const t = clock.getElapsedTime()
    if (!group.current) return
    group.current.rotation.y = t * 0.16 + pointer.x * 0.18
    group.current.rotation.x = Math.sin(t * 0.25) * 0.08 + pointer.y * 0.1
    group.current.scale.setScalar(1 + burst * 0.12)
  })
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.78, 3]} />
        <meshPhysicalMaterial color="#090b0f" metalness={1} roughness={0.17} clearcoat={1} emissive="#3c2a0a" emissiveIntensity={0.42} wireframe />
      </mesh>
      <points>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[points,3]} count={points.length/3}/></bufferGeometry>
        <pointsMaterial color="#ffe1a0" size={0.025} transparent opacity={0.72} sizeAttenuation />
      </points>
      {[2.15,2.5,2.85].map((r,i)=><mesh key={r} rotation={[i*.8,i*.5,0]}><torusGeometry args={[r,.008,8,160]}/><meshBasicMaterial color={i===1?'#5c43c7':'#c9a24a'} transparent opacity={.28-i*.05}/></mesh>)}
    </group>
  )
}

export default function VaultSphere() {
  const [burst, setBurst] = useState(0)
  return (
    <button className="vault-sphere" type="button" aria-label="Explode the wealth sphere into a particle field" onClick={() => setBurst((v) => v + 1)}>
      <Canvas camera={{ position:[0,0,7], fov:38 }} dpr={[1,1.5]} gl={{antialias:true,alpha:true}}>
        <ambientLight intensity={.18}/><pointLight position={[3,3,4]} intensity={8} color="#ffe1a0"/><pointLight position={[-3,1,2]} intensity={6} color="#6144d8"/>
        <WealthCore burst={burst}/>
      </Canvas>
      <span className="vault-label">WEALTH FIELD <b>CLICK TO DISPERSE</b></span>
    </button>
  )
}
