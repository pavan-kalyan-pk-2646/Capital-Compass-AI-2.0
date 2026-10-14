import { useMemo } from 'react'

const NODES: [id: string, label: string][] = [
  ['TWIN','Digital Twin'],['ROUTER','Decision Router'],['SIM','10K Futures'],['COMMIT','AI Committee'],['RED','Red Team'],['CRITIC','Critic'],['FINAL','Final Decision']
]
export default function Architecture3D({ active }: { active?: string | null }) {
  const dots = useMemo(() => Array.from({length: 28}, (_,i) => ({ left: `${(i*37)%100}%`, top: `${(i*61)%100}%`, delay: `${(i%9)*.22}s` })), [])
  return <section className="arch-3d" aria-label="Three dimensional architecture view">
    <div className="arch-3d-grid" />
    {dots.map((d,i)=><i key={i} className="arch-particle" style={{ left: d.left, top: d.top, animationDelay: d.delay }}/>) }
    <div className="arch-3d-core"><div className="core-ring ring-a"/><div className="core-ring ring-b"/><div className="core-ring ring-c"/><div className="core-orb"><span>CC</span></div></div>
    <div className="arch-3d-nodes">
      {NODES.map(([id,label],i)=><div key={id} className={`arch-3d-node n-${i} ${active===id.toLowerCase() || active===id ? 'hot':''}`}><span className="node-dot"/><b>{label}</b><small>{id}</small></div>)}
    </div>
    <div className="arch-3d-caption"><span className="sd-dot"/> LIVE DECISION GEOMETRY <em>{active ? `· ${active}` : '· waiting for backend event'}</em></div>
  </section>
}
