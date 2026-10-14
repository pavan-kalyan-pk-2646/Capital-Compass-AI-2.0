/** Static SVG compass used when WebGL is unavailable. */
export default function CompassFallback() {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5)
  const words = [
    { a: 0, l: 'N', w: 'Invest' },
    { a: 90, l: 'E', w: 'Borrow' },
    { a: 180, l: 'S', w: 'Protect' },
    { a: 270, l: 'W', w: 'Achieve' },
  ]
  return (
    <svg viewBox="-260 -260 520 520" width="100%" height="100%" role="img" aria-label="Capital Compass dial">
      <circle r="250" fill="#0b1322" stroke="#c9a24a" strokeWidth="14" />
      <circle r="232" fill="none" stroke="rgba(201,162,74,.35)" strokeWidth="2" />
      {ticks.map((d) => {
        const a = ((d - 90) * Math.PI) / 180
        const r2 = d % 30 === 0 ? 206 : 220
        return <line key={d} x1={Math.cos(a) * 232} y1={Math.sin(a) * 232} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2} stroke={d % 30 === 0 ? '#e3c37a' : 'rgba(180,191,209,.4)'} strokeWidth={d % 30 === 0 ? 3 : 1.5} />
      })}
      {words.map((w) => {
        const a = ((w.a - 90) * Math.PI) / 180
        return (
          <g key={w.l} transform={`translate(${Math.cos(a) * 165} ${Math.sin(a) * 165})`} textAnchor="middle">
            <text y="-4" fill="#e3c37a" fontFamily="Sora" fontSize="34" fontWeight="600">
              {w.l}
            </text>
            <text y="22" fill="#b4bfd1" fontSize="15">
              {w.w}
            </text>
          </g>
        )
      })}
      <g transform="rotate(35)">
        <path d="M0 -190 L14 0 L-14 0 Z" fill="#c9a24a" />
        <path d="M0 150 L14 0 L-14 0 Z" fill="#c7cdd8" />
        <circle r="12" fill="#c9a24a" />
      </g>
    </svg>
  )
}
