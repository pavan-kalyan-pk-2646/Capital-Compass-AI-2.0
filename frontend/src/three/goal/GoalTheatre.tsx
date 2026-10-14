/**
 * The Goal Survival Theatre: one 3D world, many stations, all drawn from the API response.
 *
 * Stations (see model.ts STATIONS): A Monte Carlo universe · B goal terrain · C scenario towers ·
 * D constellation · E goal distance engine · F percentile mountain · G risk topology ·
 * I survival core + K resilience ring · J decision timeline · L before → after.
 * The camera flies between named states; labels are DOM elements projected from the render loop.
 * Selecting a stress scenario changes the whole world: paths, terrain, ridges, goal plane, core.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type { GoalSurvival, PathDensity, TheatreScenario } from '@/services/types'
import { DEPTH, TargetPlane, Universe } from '@/three/goal/Universe'
import { Mountain, Terrain } from '@/three/goal/Landscape'
import { constellation, CORE_VIEW, CORE_YAW, makeScale, riskPeaks, timelineScale, STATIONS, timeline, type Scale, type ScenarioKey, type Station, type StationKey } from '@/three/goal/model'
import { Constellation, Core, DecisionWorlds, GoalEngine, RiskTopology, Timeline, Towers } from '@/three/goal/Stations'

export type CameraMode = 'overview' | 'montecarlo' | 'terrain' | 'scenarios' | 'goal' | 'risk' | 'decision'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Camera for a ring station: between the centre and the station, looking outward at it. */
function outward(st: Station, dist: number, h: number, ty: number) {
  const len = Math.hypot(st.x, st.z) || 1
  const dx = st.x / len
  const dz = st.z / len
  return { pos: v(st.x - dx * dist, h, st.z - dz * dist), target: v(st.x, ty, st.z) }
}
export const CAMERAS: Record<CameraMode, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  overview: { pos: v(0, 100, 108), target: v(0, 0, -6) },
  montecarlo: outward(STATIONS.universe, 47, 15, 5),
  terrain: outward(STATIONS.terrain, 36, 32, 0),
  scenarios: outward(STATIONS.towers, 38, 13, 5),
  goal: { pos: v(Math.cos(CORE_VIEW) * 44, 24, Math.sin(CORE_VIEW) * 44), target: v(0, 8, 0) },
  risk: outward(STATIONS.risk, 28, 22, 2),
  decision: outward(STATIONS.decision, 46, 26, 3),
}

/** Which stations' labels belong to each camera view. */
export const MODE_STATIONS: Record<CameraMode, StationKey[]> = {
  overview: [],
  montecarlo: ['universe', 'mountain'],
  terrain: ['terrain'],
  scenarios: ['towers'],
  goal: ['core'],
  risk: ['risk'],
  decision: ['decision', 'timeline'],
}

export interface Anchor {
  id: string
  station: StationKey
  pos: THREE.Vector3
  node: ReactNode
  className?: string
  /** shown in the overview as the station's name */
  title?: boolean
}

interface Props {
  data: GoalSurvival | null
  running: boolean
  scenario: ScenarioKey
  hoveredScenario: ScenarioKey | null
  mode: CameraMode
  resetSignal: number
  selectedPath: number | null
  reduced: boolean
  maxPaths: number
  anchors: Anchor[]
  onScenario: (k: ScenarioKey) => void
  onHoverScenario: (k: ScenarioKey | null) => void
  onSelectPath: (i: number | null) => void
}

// ---------------------------------------------------------------- camera
function Rig({ mode, resetSignal, reduced }: { mode: CameraMode; resetSignal: number; reduced: boolean }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.minDistance = 6
    c.maxDistance = 190
    c.maxPolarAngle = 1.48
    c.rotateSpeed = 0.6
    c.zoomSpeed = 0.9
    c.panSpeed = 0.8
    return c
  }, [camera, gl])
  useEffect(() => () => controls.dispose(), [controls])
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3; t0: number; dur: number } | null>(null)

  const { size } = useThree()
  // views are framed for a landscape canvas; on a portrait phone step back so the station fits
  const fit = Math.round(THREE.MathUtils.clamp(1.45 / (size.width / Math.max(1, size.height)), 1, mode === 'overview' ? 1.15 : 2.2) * 10) / 10
  useEffect(() => {
    const base = CAMERAS[mode]
    const goal = { pos: base.target.clone().add(base.pos.clone().sub(base.target).multiplyScalar(fit)), target: base.target }
    if (reduced) {
      camera.position.copy(goal.pos)
      controls.target.copy(goal.target)
      controls.update()
      return
    }
    const dist = camera.position.distanceTo(goal.pos)
    flight.current = { from: camera.position.clone(), to: goal.pos.clone(), tf: controls.target.clone(), tt: goal.target.clone(), t0: performance.now(), dur: THREE.MathUtils.clamp(dist * 22, 900, 2600) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, resetSignal, fit])

  useFrame(() => {
    const f = flight.current
    if (f) {
      const k = Math.min(1, (performance.now() - f.t0) / f.dur)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      camera.position.lerpVectors(f.from, f.to, e)
      // fly over the world between stations instead of cutting through it
      camera.position.y += Math.sin(Math.PI * e) * Math.min(28, f.from.distanceTo(f.to) * 0.25)
      controls.target.lerpVectors(f.tf, f.tt, e)
      if (k >= 1) flight.current = null
    }
    if (camera.position.y < 1.2) camera.position.y = 1.2
    controls.update()
  })
  return null
}

/**
 * On wide screens the inspector panel covers the right of the canvas, so the projection centre is
 * moved left by half its width: every view frames its station in the space that is still visible.
 */
const INSPECTOR_SHIFT = 135
function ViewShift() {
  const { camera, size } = useThree()
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera
    const shift = size.width > 820 ? INSPECTOR_SHIFT : 0
    const v = cam.view
    if (shift === 0) {
      if (v?.enabled) {
        cam.clearViewOffset()
      }
      return
    }
    if (!v?.enabled || v.fullWidth !== size.width || v.fullHeight !== size.height || v.offsetX !== shift) {
      cam.aspect = size.width / size.height
      cam.setViewOffset(size.width, size.height, shift, 0, size.width, size.height)
    }
  })
  return null
}

// ---------------------------------------------------------------- labels
function LabelSync({ layer, anchors, mode }: { layer: React.RefObject<HTMLDivElement>; anchors: Anchor[]; mode: CameraMode }) {
  const { camera, size } = useThree()
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const nodes = useRef<Map<string, HTMLElement>>(new Map())
  useEffect(() => {
    const m = new Map<string, HTMLElement>()
    layer.current?.querySelectorAll<HTMLElement>('[data-a]').forEach((el) => m.set(el.dataset.a!, el))
    nodes.current = m
  }, [anchors, layer])
  useFrame(() => {
    const scope = MODE_STATIONS[mode]
    for (const a of anchors) {
      const el = nodes.current.get(a.id)
      if (!el) continue
      // each view shows its own station's labels; the overview shows only station names
      const inScope = mode === 'overview' ? !!a.title : scope.includes(a.station)
      if (!inScope) {
        el.style.opacity = '0'
        continue
      }
      tmp.copy(a.pos).project(camera)
      const d = camera.position.distanceTo(a.pos)
      const on = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && d < 160
      el.style.opacity = on ? '1' : '0'
      el.style.transform = `translate(${(((tmp.x + 1) / 2) * size.width).toFixed(1)}px, ${(((1 - tmp.y) / 2) * size.height).toFixed(1)}px) translate(-50%, -100%)`
      el.style.zIndex = String(Math.round(1000 - d))
    }
  })
  return null
}

// ---------------------------------------------------------------- percentile lines in the universe
const PCOL: Record<string, string> = { p5: '#f0566a', p25: '#6fa8ff', p50: '#e3c37a', p75: '#6fa8ff', p95: '#3ccb8f' }

function PercentileLines({ scale, sc }: { scale: Scale; sc: TheatreScenario }) {
  const tubes = useMemo(
    () =>
      (['p5', 'p25', 'p50', 'p75', 'p95'] as const).map((k) => {
        const pts = sc.percentiles[k].map((w, i) => new THREE.Vector3(scale.x(sc.percentiles.month[i]!), scale.y(w), -DEPTH / 2 - 0.6))
        return { k, geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, k === 'p50' ? 0.11 : 0.05, 8, false) }
      }),
    [sc, scale],
  )
  useEffect(() => () => tubes.forEach((t) => t.geo.dispose()), [tubes])
  return (
    <group>
      {tubes.map((t) => (
        <mesh key={t.k} geometry={t.geo}>
          <meshBasicMaterial color={PCOL[t.k]} toneMapped={false} transparent opacity={t.k === 'p50' ? 1 : 0.75} />
        </mesh>
      ))}
    </group>
  )
}

function StationGroup({ st, visible = true, children }: { st: Station; visible?: boolean; children: ReactNode }) {
  return (
    <group position={[st.x, 0, st.z]} rotation={[0, st.yaw, 0]} visible={visible}>
      {children}
    </group>
  )
}

function Floor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#04060b" metalness={0.5} roughness={0.8} />
      </mesh>
      <gridHelper args={[260, 52, '#162238', '#0b1220']} position={[0, -0.2, 0]} />
    </group>
  )
}

/** Before a result exists: the instrument waits. No paths and no numbers are drawn. */
function Dormant({ running, reduced }: { running: boolean; reduced: boolean }) {
  const ring = useRef<THREE.Mesh>(null)
  const pulse = useRef<THREE.Mesh>(null)
  useFrame(({ clock }, dt) => {
    if (ring.current) ring.current.rotation.z += dt * (running ? 1.2 : 0.15)
    if (pulse.current && !reduced) {
      const k = running ? (clock.elapsedTime * 0.8) % 1 : 0
      pulse.current.scale.setScalar(1 + k * 8)
      ;(pulse.current.material as THREE.MeshBasicMaterial).opacity = running ? 0.5 * (1 - k) : 0
    }
  })
  return (
    <group position={[0, 0, STATIONS.core.z]}>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[3.6, 4.2, 0.8, 64]} />
        <meshStandardMaterial color="#11151d" metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh position={[0, 4.2, 0]}>
        <sphereGeometry args={[1.9, 48, 32]} />
        <meshPhysicalMaterial color="#1b2230" metalness={1} roughness={0.25} clearcoat={1} />
      </mesh>
      <mesh ref={ring} position={[0, 4.2, 0]}>
        <torusGeometry args={[3, 0.06, 10, 120]} />
        <meshStandardMaterial color="#c9a24a" metalness={1} roughness={0.25} />
      </mesh>
      {/* while the backend runs: a ring of light leaves the core (the request is in flight) */}
      <mesh ref={pulse} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1, 1.15, 96]} />
        <meshBasicMaterial color="#5fd4e6" transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function World(props: Props & { layer: React.RefObject<HTMLDivElement>; compact: boolean }) {
  // phones draw only the stations of the current view (the overview still shows everything)
  const focus = props.compact && props.mode !== 'overview' ? MODE_STATIONS[props.mode] : null
  const shown = (k: StationKey) => !focus || focus.includes(k)
  const th = props.data?.theatre ?? null
  const scale = useMemo(() => (th ? makeScale(th) : null), [th])
  const tlScale = useMemo(() => (th ? timelineScale(th) : null), [th])
  const sc = th ? (th.scenarios.find((s) => s.scenario === props.scenario) ?? th.scenarios[0]!) : null
  const normal = th?.scenarios[0] ?? null
  // 0 → 1 as a new result is revealed; read by the render loop, never re-renders React
  const reveal = useRef(0)
  useEffect(() => {
    reveal.current = props.reduced ? 1 : 0
  }, [th, props.reduced])
  useFrame((_, dt) => {
    if (th && reveal.current < 1) reveal.current = Math.min(1, reveal.current + dt / 2.6)
  })
  const graph = useMemo(() => (th && sc ? constellation(th, sc) : null), [th, sc])
  const gates = useMemo(() => (props.data && sc ? timeline(props.data, sc) : []), [props.data, sc])
  const peaks = useMemo(() => (th ? riskPeaks(th, th.risk_dna) : []), [th])
  const density: PathDensity | null = sc?.density ?? null

  return (
    <>
      <color attach="background" args={['#03050a']} />
      <fog attach="fog" args={['#03050a', 70, 230]} />
      <hemisphereLight args={['#33507e', '#020305', 0.7]} />
      <directionalLight position={[30, 60, 40]} intensity={1.6} color="#ffe9c4" />
      <directionalLight position={[-40, 20, -30]} intensity={0.5} color="#5fd4e6" />
      <pointLight position={[0, 14, STATIONS.core.z]} intensity={60} distance={40} decay={1.6} color="#e3c37a" />
      <Floor />
      {!th || !scale || !tlScale || !sc || !normal ? (
        <Dormant running={props.running} reduced={props.reduced} />
      ) : (
        <>
          <StationGroup st={STATIONS.universe} visible={shown('universe')}>
            <Universe scale={scale} scene={sc} maxPaths={props.maxPaths} months={sc.percentiles.month} reveal={reveal} reduced={props.reduced} selected={props.selectedPath} onSelect={props.onSelectPath} />
            <TargetPlane scale={scale} target={sc.target} width={scale.width + 2} depth={DEPTH + 2} />
            <PercentileLines scale={scale} sc={sc} />
          </StationGroup>
          <StationGroup st={STATIONS.mountain} visible={shown('mountain')}>
            <Mountain scale={scale} p={sc.percentiles} />
          </StationGroup>
          {density && (
            <StationGroup st={STATIONS.terrain} visible={shown('terrain')}>
              <Terrain scale={scale} density={density} target={sc.target} reduced={props.reduced} />
            </StationGroup>
          )}
          <StationGroup st={STATIONS.towers} visible={shown('towers')}>
            <Towers scenarios={th.scenarios} selected={props.scenario} hovered={props.hoveredScenario} onSelect={props.onScenario} onHover={props.onHoverScenario} />
          </StationGroup>
          <StationGroup st={{ ...STATIONS.core, yaw: CORE_YAW }} visible={shown('core')}>
            <Core probability={sc.success_probability} dna={th.risk_dna} reduced={props.reduced} />
            <GoalEngine scale={scale} start={th.start_corpus} p50={sc.ending.p50} target={sc.target} />
            {graph && <Constellation nodes={graph.nodes} edges={graph.edges} reduced={props.reduced} />}
          </StationGroup>
          <StationGroup st={STATIONS.timeline} visible={shown('timeline')}>
            <Timeline scale={tlScale} gates={gates} target={sc.target} />
          </StationGroup>
          <StationGroup st={STATIONS.risk} visible={shown('risk')}>
            <RiskTopology peaks={peaks} />
          </StationGroup>
          <StationGroup st={STATIONS.decision} visible={shown('decision')}>
            <DecisionWorlds scale={scale} current={normal.percentiles} optimized={th.optimized} />
          </StationGroup>
        </>
      )}
      <ViewShift />
      <Rig mode={props.mode} resetSignal={props.resetSignal} reduced={props.reduced} />
      <LabelSync layer={props.layer} anchors={props.anchors} mode={props.mode} />
    </>
  )
}

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

export default function GoalTheatre(props: Props & { compact: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const visible = useVisible(wrap)
  useEffect(() => () => void (document.body.style.cursor = ''), [])
  return (
    <div className="gt-canvas" ref={wrap}>
      <Canvas
        dpr={props.compact ? [1, 1.25] : [1, 1.6]}
        camera={{ position: CAMERAS.overview.pos.toArray(), fov: 42, near: 0.1, far: 600 }}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        frameloop={visible ? 'always' : 'never'}
        raycaster={{ params: { Line: { threshold: 0.18 }, Points: { threshold: 0.2 }, Mesh: {}, LOD: {}, Sprite: {} } }}
        onPointerMissed={() => props.onSelectPath(null)}
      >
        <World {...props} layer={layer} />
      </Canvas>
      <div className="gt-labels" ref={layer} aria-hidden="true">
        {props.anchors.map((a) => (
          <div key={a.id} data-a={a.id} className={`gt-label ${a.className ?? ''}`}>
            {a.node}
          </div>
        ))}
      </div>
    </div>
  )
}
