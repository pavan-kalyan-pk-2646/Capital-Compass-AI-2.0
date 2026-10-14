/**
 * The 3D Financial Atlas: a miniature terrain whose landmarks are the parts of Capital Compass.
 *
 * Everything is procedural (no models, no downloaded textures):
 *  - terrain: a 180×180 plane displaced by `terrainHeight`, shaded with topographic contour
 *    lines and a coordinate grid in the fragment shader (no extra geometry);
 *  - landmarks: a few primitive meshes each, brass when the user's data is behind them,
 *    dark steel when a step is missing;
 *  - roads and the route Atlas suggests: lines that follow the ground;
 *  - data flow: one instanced mesh of 48 points that travel only along active roads.
 *
 * Interaction is bounded: orbit, zoom and pan stay inside the map, and the camera never goes
 * under the ground. Rendering pauses when the tab is hidden or the canvas is scrolled away.
 * Labels are DOM elements positioned from the render loop (no React re-render per frame).
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { byId, LANDMARKS, ROADS, terrainHeight, type Landmark, type LandmarkId } from '@/lib/atlasMap'

export type AtlasPhase = 'greeting' | 'map' | 'entering'
export interface LandmarkView {
  active: boolean
  visited: boolean
  label: string
}

interface Props {
  phase: AtlasPhase
  views: Record<LandmarkId, LandmarkView>
  route: LandmarkId[] | null
  hovered: LandmarkId | null
  selected: LandmarkId | null
  /** Increments each time Atlas speaks: the compass and the coordinate grid respond. */
  pulse: number
  reduced: boolean
  resetSignal: number
  onHover: (id: LandmarkId | null) => void
  onSelect: (id: LandmarkId | null) => void
  onEntered: () => void
}

const GOLD = new THREE.Color('#c9a24a')
const GOLD_HI = new THREE.Color('#e3c37a')
const STEEL = new THREE.Color('#3a4558')
const CYAN = new THREE.Color('#5fd4e6')
const MAP_SIZE = 90
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

const ground = (x: number, z: number, lift = 0) => new THREE.Vector3(x, terrainHeight(x, z) + lift, z)

/** Road between two landmarks: a gently bowed curve sampled along the ground. */
function roadPoints(a: Landmark, b: Landmark, lift = 0.09, n = 48): THREE.Vector3[] {
  const mx = (a.x + b.x) / 2
  const mz = (a.z + b.z) / 2
  const dx = b.x - a.x
  const dz = b.z - a.z
  const bow = 0.12 * Math.sign(Math.sin(a.x * 3.1 + b.z * 1.7) || 1)
  const cx = mx - dz * bow
  const cz = mz + dx * bow
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x
    const z = (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * cz + t * t * b.z
    pts.push(ground(x, z, lift))
  }
  return pts
}

// ---------------------------------------------------------------- terrain
function Terrain({ pulseRef }: { pulseRef: React.MutableRefObject<{ r: number; a: number }> }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 180, 180)
    g.rotateX(-Math.PI / 2)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)))
    g.computeVertexNormals()
    return g
  }, [])
  const uniforms = useMemo(() => ({ uRipple: { value: 0 }, uRippleAmp: { value: 0 } }), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#0a111d', roughness: 0.92, metalness: 0.05 })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRipple = uniforms.uRipple
      shader.uniforms.uRippleAmp = uniforms.uRippleAmp
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nuniform float uRipple;\nuniform float uRippleAmp;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          float r = length(vWorld.xz);
          // topographic contours every 0.5 units of height (gold)
          float h = vWorld.y * 2.0;
          float contour = 1.0 - min(abs(fract(h - 0.5) - 0.5) / fwidth(h), 1.0);
          // coordinate grid every 5 units (cyan), with a heavier line every 15
          vec2 g = vWorld.xz / 5.0;
          vec2 gd = abs(fract(g - 0.5) - 0.5) / fwidth(g);
          float grid = 1.0 - min(min(gd.x, gd.y), 1.0);
          vec2 g3 = vWorld.xz / 15.0;
          vec2 gd3 = abs(fract(g3 - 0.5) - 0.5) / fwidth(g3);
          float grid3 = 1.0 - min(min(gd3.x, gd3.y), 1.0);
          // the ring of light that travels out from the citadel when Atlas speaks
          float ripple = uRippleAmp * smoothstep(2.5, 0.0, abs(r - uRipple));
          float fade = smoothstep(44.0, 18.0, r);
          vec3 gold = vec3(0.79, 0.64, 0.29);
          vec3 cyan = vec3(0.37, 0.83, 0.90);
          gl_FragColor.rgb += fade * (contour * gold * 0.22 + grid * cyan * (0.035 + 0.35 * ripple) + grid3 * cyan * 0.05);
          gl_FragColor.rgb += ripple * cyan * 0.08;
          gl_FragColor.rgb *= mix(0.15, 1.0, fade);`,
        )
    }
    return m
  }, [uniforms])
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  useFrame(() => {
    uniforms.uRipple.value = pulseRef.current.r
    uniforms.uRippleAmp.value = pulseRef.current.a
  })
  return <mesh geometry={geo} material={mat} receiveShadow={false} />
}

// ---------------------------------------------------------------- roads + suggested route
function Roads({ views, route }: { views: Props['views']; route: LandmarkId[] | null }) {
  const objs = useMemo(() => {
    const lines: THREE.Line[] = []
    for (const [a, b] of ROADS) {
      const pts = roadPoints(byId(a), byId(b))
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const lit = views[a].active && views[b].active
      const mat = new THREE.LineBasicMaterial({ color: lit ? GOLD : STEEL, transparent: true, opacity: lit ? 0.55 : 0.35, depthWrite: false })
      lines.push(new THREE.Line(geo, mat))
    }
    return lines
  }, [views])
  useEffect(
    () => () =>
      objs.forEach((l) => {
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      }),
    [objs],
  )
  return (
    <group>
      {objs.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
      {route && route.length > 1 && <RouteLine route={route} />}
    </group>
  )
}

function RouteLine({ route }: { route: LandmarkId[] }) {
  const { line, pts } = useMemo(() => {
    const all: THREE.Vector3[] = []
    for (let i = 0; i < route.length - 1; i++) {
      const seg = roadPoints(byId(route[i]!), byId(route[i + 1]!), 0.16)
      all.push(...(i ? seg.slice(1) : seg))
    }
    const geo = new THREE.BufferGeometry().setFromPoints(all)
    const mat = new THREE.LineDashedMaterial({ color: CYAN, dashSize: 0.7, gapSize: 0.45, transparent: true, opacity: 0.95, depthWrite: false })
    const l = new THREE.Line(geo, mat)
    l.computeLineDistances()
    return { line: l, pts: all }
  }, [route])
  const runner = useRef<THREE.Mesh>(null)
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )
  // a light travels along the route toward the landmark Atlas suggests
  useFrame(({ clock }) => {
    if (!runner.current) return
    const k = (clock.elapsedTime * 0.22) % 1
    const idx = Math.min(pts.length - 1, Math.floor(k * (pts.length - 1)))
    runner.current.position.copy(pts[idx]!)
    runner.current.position.y += 0.15
  })
  return (
    <group>
      <primitive object={line} />
      <mesh ref={runner}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- data flow particles
function DataFlow({ views }: { views: Props['views'] }) {
  const COUNT = 48
  const ref = useRef<THREE.InstancedMesh>(null)
  const paths = useMemo(() => ROADS.filter(([a, b]) => views[a].active && views[b].active).map(([a, b]) => roadPoints(byId(a), byId(b), 0.2, 32)), [views])
  const seeds = useMemo(() => Array.from({ length: COUNT }, (_, i) => ({ road: i % Math.max(1, paths.length), offset: (i * 0.618) % 1, speed: 0.05 + ((i * 37) % 10) / 160 })), [paths.length])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.elapsedTime
    seeds.forEach((s, i) => {
      const path = paths[s.road]
      if (!path) {
        m.makeScale(0, 0, 0)
      } else {
        const k = (s.offset + t * s.speed) % 1
        const f = k * (path.length - 1)
        const i0 = Math.floor(f)
        v.copy(path[i0]!).lerp(path[Math.min(path.length - 1, i0 + 1)]!, f - i0)
        m.makeTranslation(v.x, v.y, v.z)
      }
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <sphereGeometry args={[0.07, 6, 5]} />
      <meshBasicMaterial color={GOLD_HI} transparent opacity={0.85} toneMapped={false} />
    </instancedMesh>
  )
}

// ---------------------------------------------------------------- landmarks
function Structure({ kind, mat }: { kind: Landmark['kind']; mat: THREE.Material }) {
  switch (kind) {
    case 'citadel':
      return (
        <group>
          <mesh material={mat} position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.35, 0.6, 3.2, 8]} />
          </mesh>
          <mesh material={mat} position={[0, 3.35, 0]}>
            <coneGeometry args={[0.42, 0.7, 8]} />
          </mesh>
        </group>
      )
    case 'harbor':
      return (
        <group>
          <mesh material={mat} position={[-0.5, 0.45, 0]}>
            <boxGeometry args={[1.1, 0.6, 0.7]} />
          </mesh>
          <mesh material={mat} position={[0.6, 0.35, 0.3]}>
            <boxGeometry args={[0.7, 0.4, 0.5]} />
          </mesh>
          <mesh material={mat} position={[0.2, 1.3, -0.3]}>
            <cylinderGeometry args={[0.05, 0.05, 2.2, 6]} />
          </mesh>
        </group>
      )
    case 'ridge':
      return (
        <group>
          <mesh material={mat} position={[-0.4, 0.8, 0]}>
            <coneGeometry args={[0.8, 1.6, 4]} />
          </mesh>
          <mesh material={mat} position={[0.6, 0.55, 0.3]}>
            <coneGeometry args={[0.55, 1.1, 4]} />
          </mesh>
        </group>
      )
    case 'valley':
      return (
        <group>
          <mesh material={mat} position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.9, 0.12, 8, 32]} />
          </mesh>
          <mesh material={mat} position={[0, 0.9, 0]}>
            <octahedronGeometry args={[0.35]} />
          </mesh>
        </group>
      )
    case 'horizon':
      return (
        <group>
          <mesh material={mat} position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.06, 0.18, 3, 6]} />
          </mesh>
          <mesh material={mat} position={[0, 3.1, 0]}>
            <sphereGeometry args={[0.28, 16, 12]} />
          </mesh>
        </group>
      )
    case 'district':
      return (
        <group>
          {[
            [-0.55, 1.4, -0.2],
            [0.1, 2.0, 0.25],
            [0.65, 1.0, -0.3],
          ].map(([x, h, z], i) => (
            <mesh key={i} material={mat} position={[x!, h! / 2, z!]}>
              <boxGeometry args={[0.45, h!, 0.45]} />
            </mesh>
          ))}
        </group>
      )
    case 'crossing':
      return (
        <mesh material={mat} position={[0, 0.1, 0]}>
          <torusGeometry args={[0.9, 0.12, 8, 24, Math.PI]} />
        </mesh>
      )
    case 'frontier':
      return (
        <group>
          {[-0.8, 0, 0.8].map((x, i) => (
            <mesh key={i} material={mat} position={[x, 0.5 + (i === 1 ? 0.25 : 0), 0]}>
              <coneGeometry args={[0.32, 1 + (i === 1 ? 0.5 : 0), 3]} />
            </mesh>
          ))}
        </group>
      )
    case 'clinic':
      return (
        <group>
          <mesh material={mat} position={[0, 0.5, 0]}>
            <boxGeometry args={[1.2, 1, 1.2]} />
          </mesh>
          <mesh material={mat} position={[0, 1.15, 0]}>
            <boxGeometry args={[0.7, 0.3, 0.2]} />
          </mesh>
          <mesh material={mat} position={[0, 1.15, 0]}>
            <boxGeometry args={[0.2, 0.3, 0.7]} />
          </mesh>
        </group>
      )
    case 'chamber':
      return (
        <group>
          <mesh material={mat} position={[0, 0.2, 0]}>
            <cylinderGeometry args={[1, 1, 0.4, 24]} />
          </mesh>
          <mesh material={mat} position={[0, 0.4, 0]}>
            <sphereGeometry args={[0.85, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        </group>
      )
    case 'fortress':
      return (
        <group>
          {[
            [-0.7, -0.7],
            [0.7, -0.7],
            [-0.7, 0.7],
            [0.7, 0.7],
          ].map(([x, z], i) => (
            <mesh key={i} material={mat} position={[x!, 0.65, z!]}>
              <boxGeometry args={[0.4, 1.3, 0.4]} />
            </mesh>
          ))}
          <mesh material={mat} position={[0, 0.35, 0]}>
            <boxGeometry args={[1.5, 0.7, 1.5]} />
          </mesh>
        </group>
      )
    case 'gate':
      return (
        <group>
          <mesh material={mat} position={[-0.6, 0.8, 0]}>
            <boxGeometry args={[0.3, 1.6, 0.3]} />
          </mesh>
          <mesh material={mat} position={[0.6, 0.8, 0]}>
            <boxGeometry args={[0.3, 1.6, 0.3]} />
          </mesh>
          <mesh material={mat} position={[0, 1.7, 0]}>
            <boxGeometry args={[1.6, 0.25, 0.35]} />
          </mesh>
        </group>
      )
    case 'observatory':
      return (
        <group>
          <mesh material={mat} position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.55, 0.65, 1.2, 16]} />
          </mesh>
          <mesh material={mat} position={[0, 1.2, 0]}>
            <sphereGeometry args={[0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        </group>
      )
    case 'archive':
      return (
        <group>
          {[0, 1, 2].map((i) => (
            <mesh key={i} material={mat} position={[0, 0.2 + i * 0.42, 0]} rotation={[0, i * 0.25, 0]}>
              <boxGeometry args={[1.3 - i * 0.2, 0.32, 0.9 - i * 0.1]} />
            </mesh>
          ))}
        </group>
      )
  }
}

function LandmarkMesh({
  lm,
  view,
  hovered,
  selected,
  target,
  onHover,
  onSelect,
}: {
  lm: Landmark
  view: LandmarkView
  hovered: boolean
  selected: boolean
  target: boolean
  onHover: Props['onHover']
  onSelect: Props['onSelect']
}) {
  const group = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  const base = useMemo(() => terrainHeight(lm.x, lm.z), [lm])
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: view.active ? GOLD : STEEL,
        metalness: view.active ? 0.85 : 0.5,
        roughness: view.active ? 0.32 : 0.6,
        emissive: view.active ? new THREE.Color('#3a2a08') : new THREE.Color('#06080c'),
      }),
    [view.active],
  )
  const plinth = useMemo(() => new THREE.MeshStandardMaterial({ color: '#10161f', metalness: 0.6, roughness: 0.5 }), [])
  useEffect(() => () => mat.dispose(), [mat])
  useEffect(() => () => plinth.dispose(), [plinth])
  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    // hovered or selected landmarks rise slightly; everything eases, nothing snaps
    const lift = hovered || selected ? 0.55 : 0
    g.position.y += (base + lift - g.position.y) * Math.min(1, dt * 8)
    mat.emissiveIntensity += ((hovered || selected ? 2.2 : 1) - mat.emissiveIntensity) * Math.min(1, dt * 8)
    if (beam.current) {
      const m = beam.current.material as THREE.MeshBasicMaterial
      m.opacity = target ? 0.22 + 0.12 * Math.sin(clock.elapsedTime * 3) : view.active ? 0.07 : 0
    }
  })
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onHover(lm.id)
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    onHover(null)
    document.body.style.cursor = ''
  }
  return (
    <group ref={group} position={[lm.x, base, lm.z]}>
      <mesh material={plinth} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[1.7, 1.9, 0.24, 6]} />
      </mesh>
      {view.visited && (
        <mesh position={[0, 0.26, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.75, 1.88, 6]} />
          <meshBasicMaterial color={CYAN} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      )}
      <group position={[0, 0.24, 0]}>
        <Structure kind={lm.kind} mat={mat} />
      </group>
      <mesh ref={beam} position={[0, 4.2, 0]}>
        <cylinderGeometry args={[0.05, 0.22, 7, 8, 1, true]} />
        <meshBasicMaterial color={target ? CYAN : GOLD_HI} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* generous invisible hit area so small landmarks are easy to point at */}
      <mesh
        position={[0, 1.4, 0]}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={(e) => {
          e.stopPropagation()
          if (e.delta < 6) onSelect(lm.id)
        }}
      >
        <cylinderGeometry args={[2.1, 2.1, 3.2, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- the citadel compass
function compassTexture(): THREE.CanvasTexture {
  const s = 512
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const cx = s / 2
  g.clearRect(0, 0, s, s)
  g.strokeStyle = 'rgba(227,195,122,0.75)'
  g.lineWidth = 3
  for (const r of [cx * 0.96, cx * 0.7]) {
    g.beginPath()
    g.arc(cx, cx, r, 0, Math.PI * 2)
    g.stroke()
  }
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180
    const major = d % 45 === 0
    const r1 = cx * 0.96
    const r2 = r1 - (major ? 34 : 14)
    g.lineWidth = major ? 4 : 1.5
    g.beginPath()
    g.moveTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1)
    g.lineTo(cx + Math.cos(a) * r2, cx + Math.sin(a) * r2)
    g.stroke()
  }
  g.fillStyle = 'rgba(227,195,122,0.9)'
  for (let i = 0; i < 4; i++) {
    g.save()
    g.translate(cx, cx)
    g.rotate((i * Math.PI) / 2)
    g.beginPath()
    g.moveTo(0, -cx * 0.66)
    g.lineTo(16, -cx * 0.12)
    g.lineTo(-16, -cx * 0.12)
    g.closePath()
    g.fill()
    g.restore()
  }
  g.font = '600 46px Sora, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('N', cx, cx * 0.18)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function CitadelCompass({ pulseRef, spinRef }: { pulseRef: React.MutableRefObject<{ r: number; a: number }>; spinRef: React.MutableRefObject<number> }) {
  const tex = useMemo(() => compassTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const ring = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const y = useMemo(() => terrainHeight(0, 0) + 0.27, [])
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * (0.05 + spinRef.current)
    if (matRef.current) matRef.current.opacity = 0.55 + 0.45 * pulseRef.current.a
  })
  return (
    <mesh ref={ring} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[3.4, 64]} />
      <meshBasicMaterial ref={matRef} map={tex} transparent opacity={0.6} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

// ---------------------------------------------------------------- camera, controls, phases
const GREET_POS = new THREE.Vector3(0, 58, 0.01)
const MAP_POS = new THREE.Vector3(21, 31, 39)
const MAP_TARGET = new THREE.Vector3(-2, 0, 6)

function Rig({ phase, reduced, resetSignal, onEntered, pulseRef, spinRef, sweepRef }: Pick<Props, 'phase' | 'reduced' | 'resetSignal' | 'onEntered'> & { pulseRef: React.MutableRefObject<{ r: number; a: number }>; spinRef: React.MutableRefObject<number>; sweepRef: React.RefObject<THREE.PointLight> }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.minDistance = 12
    c.maxDistance = 64
    c.minPolarAngle = 0.35
    c.maxPolarAngle = 1.2
    c.screenSpacePanning = false
    c.rotateSpeed = 0.55
    c.zoomSpeed = 0.8
    c.panSpeed = 0.7
    c.enabled = false
    return c
  }, [camera, gl])
  useEffect(() => () => controls.dispose(), [controls])
  const greetStart = useRef(performance.now())
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; dur: number; done?: () => void } | null>(null)
  const fly = (to: THREE.Vector3, target: THREE.Vector3, dur: number, done?: () => void) => {
    if (reduced) {
      camera.position.copy(to)
      controls.target.copy(target)
      controls.update()
      done?.()
      return
    }
    anim.current = { from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: target, start: performance.now(), dur, done }
  }

  useEffect(() => {
    if (phase === 'greeting') {
      greetStart.current = performance.now()
      camera.position.copy(GREET_POS)
      controls.target.set(0, 0, 0)
      controls.enabled = false
      controls.update()
    } else if (phase === 'map') {
      controls.enabled = false
      fly(MAP_POS.clone(), MAP_TARGET.clone(), 2400, () => {
        controls.enabled = true
      })
    } else if (phase === 'entering') {
      controls.enabled = false
      spinRef.current = reduced ? 0 : 2.4 // the compass turns and locks as the camera dives in
      fly(new THREE.Vector3(1.6, 5.2, 4.2), new THREE.Vector3(0, 1.2, 0), 1300, () => onEntered())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    if (resetSignal && phase === 'map') fly(MAP_POS.clone(), MAP_TARGET.clone(), 900)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  useFrame((_, dt) => {
    if (phase === 'greeting' && !reduced) {
      // while Atlas speaks: a slow, controlled descent and quarter-turn over the map
      const k = Math.min(1, (performance.now() - greetStart.current) / 9000)
      const e = easeInOut(k)
      const ang = e * 0.5
      const rad = 0.01 + e * 18
      camera.position.set(Math.sin(ang) * rad, 58 - e * 14, Math.cos(ang) * rad)
      controls.target.set(0, 0, 0)
    }
    const a = anim.current
    if (a) {
      const k = Math.min(1, (performance.now() - a.start) / a.dur)
      const e = easeInOut(k)
      camera.position.lerpVectors(a.from, a.to, e)
      controls.target.lerpVectors(a.tFrom, a.tTo, e)
      if (phase === 'entering' && sweepRef.current) {
        // one light sweeps across the citadel during the dive
        sweepRef.current.intensity = 60 * Math.sin(Math.PI * k)
        sweepRef.current.position.set(-8 + 16 * k, 4, 3)
      }
      if (k >= 1) {
        anim.current = null
        a.done?.()
      }
    }
    // keep the view on the map: the target may not leave the terrain, the camera may not go under it
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -24, 24)
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -24, 24)
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, -1, 3)
    controls.update()
    const floor = terrainHeight(camera.position.x, camera.position.z) + 2
    if (camera.position.y < floor) camera.position.y = floor
    // the speaking pulse travels outward and fades
    const p = pulseRef.current
    if (p.a > 0) {
      p.r += dt * 26
      p.a = Math.max(0, p.a - dt * 0.55)
    }
    if (spinRef.current > 0 && phase !== 'entering') spinRef.current = Math.max(0, spinRef.current - dt * 2)
  })
  return null
}

// ---------------------------------------------------------------- labels (DOM, positioned per frame)
function LabelSync({ layer }: { layer: React.RefObject<HTMLDivElement> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  const anchors = useMemo(() => LANDMARKS.map((l) => ({ id: l.id, p: ground(l.x, l.z, l.kind === 'citadel' ? 4.4 : 3.1) })), [])
  useFrame(() => {
    const el = layer.current
    if (!el) return
    for (const a of anchors) {
      const node = el.querySelector<HTMLElement>(`[data-lm="${a.id}"]`)
      if (!node) continue
      v.copy(a.p).project(camera)
      const visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
      node.style.opacity = visible ? '' : '0'
      // nearer landmarks get larger labels, so the map reads with depth
      const d = camera.position.distanceTo(a.p)
      node.style.setProperty('--depth', String(THREE.MathUtils.clamp(1.25 - d / 70, 0.7, 1.1)))
    }
  })
  return null
}

function Scene(props: Props & { layer: React.RefObject<HTMLDivElement> }) {
  const pulseRef = useRef({ r: 0, a: 0 })
  const spinRef = useRef(0)
  const sweep = useRef<THREE.PointLight>(null)
  useEffect(() => {
    if (props.pulse > 0 && !props.reduced) {
      pulseRef.current = { r: 0, a: 1 }
      spinRef.current = Math.max(spinRef.current, 0.9)
    }
  }, [props.pulse, props.reduced])
  const target = props.route ? props.route[props.route.length - 1] : null
  return (
    <>
      <color attach="background" args={['#020306']} />
      <fog attach="fog" args={['#020306', 38, 78]} />
      <hemisphereLight args={['#3a4f78', '#050608', 0.8]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[18, 30, 12]} intensity={1.5} color="#ffe6bf" />
      <directionalLight position={[-24, 10, -6]} intensity={0.55} color="#5fd4e6" />
      <pointLight ref={sweep} position={[-8, 4, 3]} intensity={0} color="#fff3d6" distance={18} decay={1.4} />
      <Terrain pulseRef={pulseRef} />
      <Roads views={props.views} route={props.phase === 'greeting' ? null : props.route} />
      {!props.reduced && <DataFlow views={props.views} />}
      <CitadelCompass pulseRef={pulseRef} spinRef={spinRef} />
      {LANDMARKS.map((lm) => (
        <LandmarkMesh key={lm.id} lm={lm} view={props.views[lm.id]} hovered={props.hovered === lm.id} selected={props.selected === lm.id} target={target === lm.id && props.phase !== 'greeting'} onHover={props.onHover} onSelect={props.onSelect} />
      ))}
      {/* clicking open ground clears the selection */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} onClick={(e) => e.delta < 6 && props.onSelect(null)}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Rig phase={props.phase} reduced={props.reduced} resetSignal={props.resetSignal} onEntered={props.onEntered} pulseRef={pulseRef} spinRef={spinRef} sweepRef={sweep} />
      <LabelSync layer={props.layer} />
    </>
  )
}

/** Render only while the map can be seen: pause when the tab is hidden or the canvas scrolls away. */
function useVisible(ref: React.RefObject<HTMLElement>) {
  const [vis, setVis] = useState(true)
  useEffect(() => {
    const el = ref.current
    let inView = true
    const update = () => setVis(inView && document.visibilityState === 'visible')
    const io = new IntersectionObserver(([e]) => {
      inView = !!e?.isIntersecting
      update()
    })
    if (el) io.observe(el)
    document.addEventListener('visibilitychange', update)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [ref])
  return vis
}

export default function AtlasScene(props: Props & { labels: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const visible = useVisible(wrap)
  useEffect(() => () => void (document.body.style.cursor = ''), [])
  return (
    <div className="atlas-canvas" ref={wrap}>
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: GREET_POS.toArray(), fov: 42, near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        frameloop={visible ? 'always' : 'never'}
        onPointerMissed={() => props.onSelect(null)}
      >
        <Scene {...props} layer={layer} />
      </Canvas>
      <div className="atlas-labels" ref={layer}>
        {props.labels}
      </div>
    </div>
  )
}
