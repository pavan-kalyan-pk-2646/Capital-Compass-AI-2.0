/**
 * The Capital Compass — cinematic intro and the product's only 3D element.
 *
 * Timeline (seconds): void → compass awakening → money field → investment gravity → needle lock → command center
 *   0.0–0.5  darkness: deep navy, nothing but atmosphere                           'emerging'
 *   0.5–2.0  signal: a radial coordinate structure draws itself — the possible
 *            directions a decision can take                                        'signal'
 *   1.2–3.6  the instrument emerges: a slow dolly and tilt from an oblique angle;
 *            the needle spins, then searches in damped swings                      'searching' → 'aligning'
 *   3.6      alignment: the needle settles on its heading, the engravings warm up
 *            and one light passes across the glass                                 'locked'
 *   4.0      the page reveals the title                                            'settled'
 * No camera shake, no flares: restrained, like a title sequence for an instrument.
 * On a weak GPU (slow first frames) or with reduced motion the intro is skipped and the
 * settled instrument is shown. `skip` jumps straight to the settled pose.
 * After the intro the canvas renders on demand only (pointer parallax, then idle), and stops
 * entirely when scrolled out of view. Procedural geometry, canvas-drawn textures and a local
 * RoomEnvironment: no models, HDRs or fonts are downloaded.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import MoneyBag from './MoneyBag'

const BRASS = '#c9a24a'
const VOID = '#000000'
const HEADING = -0.62 // north-east: the settled decision heading
const SIGNAL_AT = 0.55
const SPIN_END = 2.6
const LOCK_AT = 4.25
const SETTLE_AT = 5.1
const INTRO_END = 6.2
const DOMAINS = [
  { at: 0, letter: 'N', word: 'Invest' },
  { at: 90, letter: 'E', word: 'Borrow' },
  { at: 180, letter: 'S', word: 'Protect' },
  { at: 270, letter: 'W', word: 'Achieve' },
]

export type IntroPhase = 'emerging' | 'signal' | 'searching' | 'aligning' | 'locked' | 'settled'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
const easeInOut = (x: number) => {
  const v = clamp01(x)
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Dial face. With `glow` only the gold engravings are drawn (on black) for the emissive map. */
function dialTexture(glow: boolean): THREE.CanvasTexture {
  const size = 640
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const cx = size / 2
  if (glow) {
    g.fillStyle = '#000'
    g.fillRect(0, 0, size, size)
  } else {
    const grad = g.createRadialGradient(cx, cx * 0.8, 30, cx, cx, cx)
    grad.addColorStop(0, '#131d31')
    grad.addColorStop(1, '#05080f')
    g.fillStyle = grad
    g.beginPath()
    g.arc(cx, cx, cx, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = glow ? 'rgba(227,195,122,0.5)' : 'rgba(201,162,74,0.32)'
  g.lineWidth = 2
  for (const r of [cx * 0.94, cx * 0.62, cx * 0.3]) {
    g.beginPath()
    g.arc(cx, cx, r, 0, Math.PI * 2)
    g.stroke()
  }
  for (let d = 0; d < 360; d += 2) {
    const a = ((d - 90) * Math.PI) / 180
    const major = d % 30 === 0
    const mid = d % 10 === 0
    if (glow && !mid) continue
    const r1 = cx * 0.94
    const r2 = r1 - (major ? 46 : mid ? 26 : 12)
    g.strokeStyle = major ? '#e3c37a' : mid ? 'rgba(227,195,122,0.75)' : 'rgba(180,191,209,0.3)'
    g.lineWidth = major ? 4 : mid ? 2.5 : 1.5
    g.beginPath()
    g.moveTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1)
    g.lineTo(cx + Math.cos(a) * r2, cx + Math.sin(a) * r2)
    g.stroke()
    if (major && d % 90 !== 0 && !glow) {
      g.fillStyle = 'rgba(180,191,209,0.6)'
      g.font = '500 26px "IBM Plex Sans", sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const rr = r2 - 26
      g.fillText(String(d), cx + Math.cos(a) * rr, cx + Math.sin(a) * rr)
    }
  }
  g.save()
  g.translate(cx, cx)
  for (let i = 0; i < 8; i++) {
    g.rotate(Math.PI / 4)
    const alpha = glow ? (i % 2 === 0 ? 0.35 : 0.15) : i % 2 === 0 ? 0.2 : 0.09
    g.fillStyle = `rgba(201,162,74,${alpha})`
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(-22, -cx * (i % 2 === 0 ? 0.3 : 0.2))
    g.lineTo(0, -cx * (i % 2 === 0 ? 0.6 : 0.4))
    g.lineTo(22, -cx * (i % 2 === 0 ? 0.3 : 0.2))
    g.closePath()
    g.fill()
  }
  g.restore()
  for (const dm of DOMAINS) {
    const a = ((dm.at - 90) * Math.PI) / 180
    const r = cx * 0.73
    g.save()
    g.translate(cx + Math.cos(a) * r, cx + Math.sin(a) * r)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#e3c37a'
    g.font = '600 64px Sora, "IBM Plex Sans", sans-serif'
    g.fillText(dm.letter, 0, -14)
    if (!glow) {
      g.fillStyle = 'rgba(232,236,243,0.8)'
      g.font = '500 28px "IBM Plex Sans", sans-serif'
      g.fillText(dm.word, 0, 34)
    }
    g.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Soft radial glow used as the backlight halo behind the instrument. */
function haloTexture(): THREE.CanvasTexture {
  const s = 320
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255,226,160,0.9)')
  grad.addColorStop(0.18, 'rgba(227,180,90,0.45)')
  grad.addColorStop(0.45, 'rgba(160,110,40,0.12)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * The signal: concentric range rings and 36 bearings around the instrument — the space of
 * directions a decision can take. The four cardinal bearings are brass. Drawn as thin lines.
 */
function signalGrid() {
  const g = new THREE.Group()
  g.position.z = -0.22
  const ringMat = new THREE.LineBasicMaterial({ color: '#5f86c8', transparent: true, opacity: 0, depthWrite: false, fog: false })
  const axisMat = new THREE.LineBasicMaterial({ color: '#c9a24a', transparent: true, opacity: 0, depthWrite: false, fog: false })
  const geos: THREE.BufferGeometry[] = []
  for (const r of [3.1, 4.2, 5.6, 7.4, 9.6]) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0))
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    geos.push(geo)
    g.add(new THREE.Line(geo, ringMat))
  }
  const rays: number[] = []
  const axes: number[] = []
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    const target = i % 9 === 0 ? axes : rays
    target.push(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0, Math.cos(a) * 9.6, Math.sin(a) * 9.6, 0)
  }
  for (const [arr, mat] of [
    [rays, ringMat],
    [axes, axisMat],
  ] as const) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    geos.push(geo)
    g.add(new THREE.LineSegments(geo, mat))
  }
  return {
    group: g,
    mats: [ringMat, axisMat],
    dispose: () => {
      geos.forEach((x) => x.dispose())
      ringMat.dispose()
      axisMat.dispose()
    },
  }
}

function Env() {
  // Keep the intro lightweight: direct lights are enough for the cinematic metal.
  const { scene } = useThree()
  useEffect(() => {
    scene.environment = null
    scene.fog = new THREE.Fog(VOID, 8, 18)
    return () => { scene.fog = null }
  }, [scene])
  return null
}

/** Needle heading after the spin: damped searching swings, then a hard lock onto HEADING. */
function needleTarget(t: number): number {
  if (t < LOCK_AT - 0.25) {
    const k = clamp01((t - SPIN_END) / (LOCK_AT - SPIN_END))
    const amp = 1.9 * (1 - k) + 0.12
    return HEADING + amp * Math.sin(t * 4.2) * Math.cos(t * 1.7)
  }
  return HEADING
}

interface Shared {
  lite: boolean
  frames: number
  lastFrame: number
  slowFrames: number
  needleSettled: boolean
  t: number
  start: number
  pointer: { x: number; y: number }
  lastMove: number
  visible: boolean
  phase: IntroPhase
  skip: boolean
}

function Needle({ shared }: { shared: React.MutableRefObject<Shared> }) {
  const ref = useRef<THREE.Group>(null)
  const st = useRef({ angle: Math.PI * 0.85, vel: 0, handed: false })
  const geo = useMemo(() => {
    const mk = (tip: number) => {
      const s = new THREE.Shape()
      s.moveTo(0, tip)
      s.lineTo(0.15, 0)
      s.lineTo(-0.15, 0)
      s.closePath()
      return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 })
    }
    return { north: mk(1.72), south: mk(-1.4) }
  }, [])
  useEffect(
    () => () => {
      geo.north.dispose()
      geo.south.dispose()
    },
    [geo],
  )

  useFrame((_, dt) => {
    const S = shared.current
    const s = st.current
    const d = Math.min(dt, 0.05)
    const t = S.t
    if (S.lite || S.skip) {
      s.angle = HEADING
      s.vel = 0
    } else if (t < SPIN_END) {
      // out of control: fast spin that slowly loses speed
      // uncertainty: a steady spin that slowly loses speed
      s.vel = 8 - 2.4 * t
      s.angle = Math.PI * 0.85 + 8 * t - 1.2 * t * t
    } else {
      if (!s.handed) {
        // hand over to the spring without unwinding every turn
        s.angle = needleTarget(t) + wrap(s.angle - needleTarget(t))
        s.vel = Math.min(s.vel, 7)
        s.handed = true
      }
      const target = needleTarget(t)
      const diff = target - s.angle
      const stiff = t >= LOCK_AT - 0.25 ? 70 : 34 // alignment: firm, with one small overshoot
      s.vel += diff * stiff * d
      s.vel *= Math.pow(t >= LOCK_AT - 0.25 ? 0.006 : 0.03, d)
      s.angle += s.vel * d
    }
    S.needleSettled = S.lite || S.skip || (t > LOCK_AT && Math.abs(HEADING - s.angle) < 0.002 && Math.abs(s.vel) < 0.01)
    if (ref.current) ref.current.rotation.z = s.angle
  })

  return (
    <group ref={ref} position={[0, 0, 0.22]}>
      <mesh geometry={geo.north}>
        <meshPhysicalMaterial color={BRASS} metalness={1} roughness={0.18} clearcoat={0.6} emissive="#3a2508" emissiveIntensity={0.4} />
      </mesh>
      <mesh geometry={geo.south}>
        <meshPhysicalMaterial color="#aeb5c2" metalness={0.95} roughness={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.05]}>
        <cylinderGeometry args={[0.12, 0.12, 0.12, 32]} />
        <meshPhysicalMaterial color={BRASS} metalness={1} roughness={0.15} clearcoat={1} />
      </mesh>
    </group>
  )
}

function Notches() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = 72
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3(1, 1, 1)
    const z = new THREE.Vector3(0, 0, 1)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      p.set(Math.cos(a) * 2.47, Math.sin(a) * 2.47, -0.06)
      q.setFromAxisAngle(z, a)
      m.compose(p, q, s)
      ref.current?.setMatrixAt(i, m)
    }
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true
  }, [])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry args={[0.06, 0.035, 0.14]} />
      <meshStandardMaterial color="#b08c3c" metalness={1} roughness={0.28} />
    </instancedMesh>
  )
}


function moneyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 900; c.height = 500
  const g = c.getContext('2d')!
  g.fillStyle = '#153c2a'; g.fillRect(0,0,c.width,c.height)
  g.strokeStyle = 'rgba(220,210,150,.65)'; g.lineWidth = 8; g.strokeRect(18,18,c.width-36,c.height-36)
  g.strokeStyle = 'rgba(180,220,170,.22)'; g.lineWidth = 2; g.strokeRect(42,42,c.width-84,c.height-84)
  g.fillStyle = '#d9d3a6'; g.font = 'bold 105px Georgia'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('100',450,245)
  g.fillStyle = 'rgba(224,221,184,.75)'; g.font='bold 30px Arial'; g.fillText('CAPITAL COMPASS',450,92); g.fillText('FUTURE VALUE',450,408)
  g.beginPath(); g.arc(450,245,105,0,Math.PI*2); g.strokeStyle='rgba(224,221,184,.2)'; g.stroke()
  const t = new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t
}

function MoneyField({ active }: { active: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const tex = useMemo(() => moneyTexture(), [])
  const bills = useMemo(() => Array.from({length:10}, (_,i) => ({
    x: ((i*37)%17)-8, y: ((i*19)%13)-6, z: ((i*29)%11)-5, rx:(i%5)*.35, ry:(i%7)*.24, rz:(i%9)*.18, s:.42+((i*13)%8)/18,
  })), [])
  const coins = useMemo(() => Array.from({length:12}, (_,i) => ({
    x: ((i*17)%19)-9, y: ((i*31)%15)-7, z: ((i*23)%13)-6, s:.16+((i*11)%7)/35, a:(i%9)*.7,
  })), [])
  useEffect(() => () => tex.dispose(), [tex])
  useFrame((_,dt) => {
    const g=ref.current; if(!g) return
    const t=performance.now()/1000
    const strength=active ? 1 : 0
    g.children.forEach((child,i)=>{
      const bill=i<10
      const idx=bill?i:i-10
      const base=bill?bills[idx]:coins[idx]
      if(!base) return
      const phase=idx*.57
      const burst=Math.min(1,Math.max(0,(t%6.5-0.45)/1.8))*strength
      const settle=Math.min(1,Math.max(0,(t%6.5-3.2)/1.8))*strength
      const orbit=settle*(1+.18*Math.sin(t+phase))
      const tx=base.x*orbit + Math.cos(t*.65+phase)*(1.2+settle*1.5)
      const ty=base.y*orbit + Math.sin(t*.7+phase)*(.8+settle*1.2)
      const tz=base.z*orbit
      child.position.x += (tx-child.position.x)*Math.min(1,dt*2.8)
      child.position.y += (ty-child.position.y)*Math.min(1,dt*2.8)
      child.position.z += (tz-child.position.z)*Math.min(1,dt*2.8)
      child.rotation.x += dt*(bill ? .55 : 1.2)
      child.rotation.y += dt*(bill?-.7:1.6)
      child.rotation.z += dt*(bill ? .35 : -.5)
      const pulse=0.45+0.55*Math.sin(t*2+phase)
      child.scale.setScalar(base.s*(.25+.75*Math.min(1,burst+.25))*pulse/0.75)
    })
    g.rotation.y += dt*.035
  })
  return <group ref={ref} position={[0,0,-1]}>
    {bills.map((b,i)=><mesh key={'b'+i} position={[b.x,b.y,b.z]} rotation={[b.rx,b.ry,b.rz]} scale={b.s*.2}>
      <boxGeometry args={[1.8,.95,.035]} /><meshPhysicalMaterial map={tex} color="#9fc49f" roughness={.5} metalness={.08} clearcoat={.2}/>
    </mesh>)}
    {coins.map((c,i)=><mesh key={'c'+i} position={[c.x,c.y,c.z]} scale={c.s*.2}>
      <cylinderGeometry args={[1,1,.18,32]} /><meshPhysicalMaterial color="#e5b94f" emissive="#6a3d08" emissiveIntensity={.22} metalness={1} roughness={.2} clearcoat={.7}/>
    </mesh>)}
  </group>
}

function GoldDataStreams({ active }: { active: boolean }) {
  const group=useRef<THREE.Group>(null)
  const points=useMemo(()=>Array.from({length:8},(_,i)=>new THREE.Vector3(-8+i*1.45, -3.8+(i%3)*.7, -2)),[])
  useFrame((_,dt)=>{ if(!group.current) return; const t=performance.now()/1000; group.current.children.forEach((c,i)=>{ c.position.y += Math.sin(t*1.5+i)*dt*.12; c.rotation.z += dt*.08; const k=active ? .7+.3*Math.sin(t*2+i) : 0; (c as THREE.Mesh).scale.set(k,k,k) }) })
  return <group ref={group}>{points.map((p,i)=><mesh key={i} position={p} scale={active ? .7 : 0}><boxGeometry args={[.65,.12,.05]}/><meshBasicMaterial color={i%3===0?'#ffe2a0':i%3===1?'#8fd6ff':'#b78cff'} transparent opacity={.7}/></mesh>)}</group>
}

// Camera path: macro on the rim → slide across the face → pull back to a frontal hero shot
const CAM_PATH = new THREE.CatmullRomCurve3([new THREE.Vector3(1.8, -1.8, 11.0), new THREE.Vector3(0.7, -0.5, 9.7), new THREE.Vector3(0, 0.08, 9.0)], false, 'centripetal')
const LOOK_FROM = new THREE.Vector3(0.5, 0.4, 0)
const LOOK_TO = new THREE.Vector3(0, 0, 0)
const HERO_Z = 8.65

function Scene({ reduced, skip, onPhase }: { reduced: boolean; skip: boolean; onPhase?: (p: IntroPhase) => void }) {
  const group = useRef<THREE.Group>(null)
  const dial = useRef<THREE.Group>(null)
  const dialMat = useRef<THREE.MeshStandardMaterial>(null)
  const key = useRef<THREE.DirectionalLight>(null)
  const rim = useRef<THREE.SpotLight>(null)
  const amb = useRef<THREE.AmbientLight>(null)
  const sweep = useRef<THREE.PointLight>(null)
  const halo = useRef<THREE.Mesh>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const tex = useMemo(() => ({ face: dialTexture(false), glow: dialTexture(true), halo: haloTexture() }), [])
  useEffect(
    () => () => {
      tex.face.dispose()
      tex.glow.dispose()
      tex.halo.dispose()
    },
    [tex],
  )
  const { camera, size, invalidate, gl } = useThree()
  const look = useMemo(() => new THREE.Vector3(), [])
  const gridRef = useRef<THREE.Group>(null)
  const grid = useMemo(() => signalGrid(), [])
  const gridMats = grid.mats
  useEffect(() => () => grid.dispose(), [grid])
  const shared = useRef<Shared>({
    lite: false,
    frames: 0,
    lastFrame: 0,
    slowFrames: 0,
    needleSettled: reduced,
    t: reduced ? 99 : 0,
    start: -1,
    pointer: { x: 0, y: 0 },
    lastMove: -10,
    visible: true,
    phase: reduced ? 'settled' : 'emerging',
    skip: reduced,
  })
  const phaseCb = useRef(onPhase)
  phaseCb.current = onPhase

  // keep the instrument fully in frame on portrait screens
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const fit = aspect >= 1 ? 36 : (2 * Math.atan(Math.tan((18 * Math.PI) / 180) / aspect) * 180) / Math.PI
    cam.fov = Math.min(fit, 70)
    cam.updateProjectionMatrix()
    invalidate()
  }, [camera, size, invalidate])

  useEffect(() => {
    if (skip) {
      shared.current.skip = true
      invalidate()
    }
  }, [skip, invalidate])

  useEffect(() => {
    if (reduced) phaseCb.current?.('settled')
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      shared.current.pointer = {
        x: Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))),
        y: Math.max(-1, Math.min(1, -(e.clientY - (r.top + r.height / 2)) / (r.height / 2))),
      }
      shared.current.lastMove = performance.now() / 1000
      if (shared.current.visible) invalidate()
    }
    const io = new IntersectionObserver(([en]) => {
      shared.current.visible = !!en?.isIntersecting
      if (shared.current.visible) invalidate()
    })
    io.observe(el)
    window.addEventListener('pointermove', onMove)
    invalidate()
    return () => {
      io.disconnect()
      window.removeEventListener('pointermove', onMove)
    }
  }, [gl, invalidate, reduced])

  useFrame((state, dt) => {
    const S = shared.current
    const now = performance.now() / 1000
    if (S.start < 0) S.start = now
    // weak GPU: if early frames are slow, skip straight to the settled instrument
    if (S.frames > 0 && now - S.lastFrame > 0.2) S.slowFrames += 1
    S.frames += 1
    S.lastFrame = now
    if (!S.lite && S.frames <= 6 && S.slowFrames >= 2) S.lite = true
    const jump = reduced || S.lite || S.skip
    S.t = jump ? 99 : now - S.start
    const t = S.t

    // phase changes for the DOM
    const phase: IntroPhase = t >= SETTLE_AT ? 'settled' : t >= LOCK_AT ? 'locked' : t >= SPIN_END ? 'aligning' : t >= 3.15 ? 'searching' : t >= SIGNAL_AT ? 'signal' : 'emerging'
    if (phase !== S.phase) {
      S.phase = phase
      phaseCb.current?.(phase)
    }

    // ---- camera: a slow dolly from an oblique angle to the frontal hero shot
    const travel = easeInOut(t / 4.8)
    if (t < 4.8) {
      CAM_PATH.getPoint(travel, camera.position)
      camera.position.z += 1.4 * Math.sin(easeInOut(t / 4.8) * Math.PI)
    } else {
      const k = jump ? 1 : easeOut((t - 4.8) / 0.7)
      camera.position.set(0, 0.15 * (1 - k), 9.0 - (9.0 - HERO_Z) * k)
    }
    look.copy(LOOK_FROM).lerp(LOOK_TO, easeInOut(t / 4.2))
    const hit = t - LOCK_AT
    camera.up.set(0, 1, 0)
    camera.lookAt(look)
    camera.rotateZ(0.07 * (1 - easeInOut(t / (LOCK_AT - 0.35))))

    // ---- light: darkness, a rim light on the metal, then the key light at the lock
    const reveal = easeOut((t - 0.65) / 2.2)
    const lit = jump ? 1 : easeOut((t - 1.7) / 2.5)
    if (amb.current) amb.current.intensity = 0.01 + 0.07 * lit
    if (key.current) key.current.intensity = 0.05 + 1.25 * lit
    if (rim.current) rim.current.intensity = jump ? 50 : 120 * reveal * (1 - 0.55 * lit)
    // emergence: the instrument comes out of the navy fog as the reflections come up
    const emerge = jump ? 1 : easeInOut((t - 0.45) / 2.7)
    state.scene.environmentIntensity = 0.04 + 0.96 * emerge
    const fog = state.scene.fog as THREE.Fog | null
    if (fog) {
      fog.near = 3.5 + 4.5 * emerge
      fog.far = 11 + 8 * emerge
    }

    // ---- the instrument rises from edge-on to facing camera
    const g = group.current
    if (g) {
      const face = jump ? 1 : easeInOut((t - 0.5) / 3.7)
      const baseX = -1.05 + (1.05 - 0.08) * face
      const settle = jump ? 1 : easeOut((t - 4.0) / 1.1)
      const px = S.pointer.y * 0.1 * settle
      const py = S.pointer.x * 0.14 * settle
      const k = Math.min(1, dt * 4)
      g.rotation.x += (baseX + px - g.rotation.x) * (jump || t < LOCK_AT + 0.2 ? 1 : k)
      g.rotation.y += (py - g.rotation.y) * k
      g.rotation.z = jump ? 0 : 0.25 * (1 - face)
    }
    if (dial.current) dial.current.rotation.z = jump ? 0 : -0.6 * (1 - easeOut(t / 4.0))

    // ---- the lock: engravings flare gold, the halo blooms, then both calm down
    const flare = jump ? 0 : hit > 0 ? Math.exp(-hit * .65) : 0
    if (dialMat.current) dialMat.current.emissiveIntensity = 0.3 + 0.9 * flare
    if (haloMat.current) haloMat.current.opacity = jump ? 0.22 : 0.03 * reveal + 0.19 * lit + 0.18 * flare
    if (halo.current) halo.current.scale.setScalar(1 + 0.06 * flare)

    // one light passes across the glass and bezel right after the lock
    if (sweep.current) {
      const p = (t - (LOCK_AT + 0.05)) / 0.9
      const on = !jump && p > 0 && p < 1
      sweep.current.intensity = on ? 48 * Math.sin(Math.PI * p) : 0
      if (on) sweep.current.position.set(-4.5 + 9 * p, 2.4 - 1.4 * p, 2.4)
    }

    // ---- signal: the coordinate structure draws outward, then rests faintly
    if (gridRef.current) {
      const gp = jump ? 1 : easeOut((t - SIGNAL_AT) / 1.8)
      gridRef.current.scale.setScalar(0.35 + 0.65 * gp)
      const fade = jump ? 1 : 1 - 0.55 * easeOut((t - LOCK_AT) / 0.7)
      gridMats.forEach((m, i) => (m.opacity = gp * fade * (i === 0 ? 0.32 : 0.55)))
    }

    // keep rendering only while something moves
    const moving = t < INTRO_END || !S.needleSettled || now - S.lastMove < 1.4
    if (moving && S.visible && !reduced) state.invalidate()
    if (jump && S.frames < 8) state.invalidate() // render the settled pose once more
  })

  const scale = 1
  return (
    <>
      <ambientLight ref={amb} intensity={0.01} />
      <directionalLight ref={key} position={[3, 4, 6]} intensity={0.05} color="#fff3dc" />
      <spotLight ref={rim} position={[5.5, -2.5, 1.2]} angle={0.5} penumbra={0.8} intensity={0} color="#ffd9a0" distance={14} decay={1.4} />
      <pointLight position={[-4, -2, 4]} intensity={3} color="#4f7fd0" distance={12} />
      <pointLight ref={sweep} position={[-4.5, 2.4, 2.4]} intensity={0} color="#fff6e1" distance={9} decay={1.6} />
      <mesh ref={halo} position={[0, 0, -2.2]}>
        <planeGeometry args={[11, 11]} />
        <meshBasicMaterial ref={haloMat} map={tex.halo} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </mesh>
      <MoneyField active={true} />
      <MoneyBag />
      <GoldDataStreams active={true} />
      <group ref={group} scale={scale}>
        <mesh>
          <torusGeometry args={[2.32, 0.13, 20, 96]} />
          <meshPhysicalMaterial color={BRASS} metalness={1} roughness={0.2} clearcoat={0.7} clearcoatRoughness={0.15} />
        </mesh>
        <mesh position={[0, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2.38, 2.38, 0.16, 72, 1, true]} />
          <meshStandardMaterial color="#8a6d2c" metalness={1} roughness={0.32} side={THREE.DoubleSide} />
        </mesh>
        <primitive object={grid.group} ref={gridRef} />
        <Notches />
        <group ref={dial}>
          <mesh position={[0, 0, 0.02]}>
            <circleGeometry args={[2.2, 72]} />
            <meshStandardMaterial ref={dialMat} map={tex.face} color="#98a2b4" emissive="#e3c37a" emissiveMap={tex.glow} emissiveIntensity={0.32} metalness={0} roughness={0.9} envMapIntensity={0.12} />
          </mesh>
        </group>
        <mesh position={[0, 0, -0.14]}>
          <circleGeometry args={[2.4, 64]} />
          <meshStandardMaterial color="#05080f" metalness={0.6} roughness={0.5} />
        </mesh>
        <Needle shared={shared} />
        {/* domed glass cover */}
        <mesh position={[0, 0, -6.48]} rotation={[Math.PI / 2, 0, 0]}>
          <sphereGeometry args={[7.04, 56, 8, 0, Math.PI * 2, 0, 0.32]} />
          <meshPhysicalMaterial color="#c9d8f0" transparent opacity={0.09} roughness={0.03} metalness={0} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.5} depthWrite={false} />
        </mesh>
      </group>
    </>
  )
}

export default function CompassScene({ onPhase, skip = false }: { onPhase?: (p: IntroPhase) => void; skip?: boolean }) {
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return (
    <Canvas
      dpr={[1, 1.15]}
      camera={{ position: [2.4, -2.6, 15.2], fov: 36, near: 0.05, far: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      frameloop="demand"
    >
      <Env />
      <Scene reduced={reduced} skip={skip} onPhase={onPhase} />
    </Canvas>
  )
}
