import { useEffect, useRef, useState } from 'react'
import { formatUnits, maxUint256, parseUnits, type Address } from 'viem'
import { abis, addresses, chain, explorerTx, publicClient, walletFor } from './chain'
import { Robot, SUBMITTED, readJobs, sendTx, type TxLog } from './robot'
import { DOCK, GRID, PACK, SHELVES, type OrderSpec, type Point } from './warehouse'
import './app.css'

const ORDER_REWARD = parseUnits('10', 6)
const keys = (v: string | undefined) => (v ?? '').split(',').filter(Boolean)
const warehouse = walletFor(import.meta.env.VITE_WAREHOUSE_KEY)
const FLEET_COLOR = { picker: '#ffb020', carrier: '#19c3ff' }
const KYC_ABI = [{ type: 'function', name: 'isHuman', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }, { type: 'uint8' }] }] as const
const DPR = 2

type Stats = Record<string, { usdc: string; done: string }>

/** Human-readable event for the feed, derived from the tx log line. */
function describe(l: TxLog): { icon: string; text: string; zk?: boolean } {
  const fn = l.action.split('(')[0]
  const id = l.action.match(/^\w+\((\d+)/)?.[1]
  switch (fn) {
    case 'post': return l.who === 'warehouse' ? { icon: '📦', text: 'posted an order · 10 mUSDC escrowed' } : { icon: '🤝', text: 'hired a carrier robot · 3 mUSDC' }
    case 'accept': return { icon: '✋', text: `accepted job #${id}` }
    case 'setToteCommitment': return { icon: '🔒', text: `committed to tote for job #${id} (hash only)` }
    case 'submitWithProof': return { icon: '🛡️', text: `ZK proof verified on-chain → paid for job #${id}`, zk: true }
    case 'submit': return { icon: '✅', text: `delivered order #${id}` }
    case 'confirm': return { icon: '💸', text: `released payment for job #${id}` }
    case 'charge': return { icon: '⚡', text: 'paid the charging dock' }
    case 'approve': return { icon: '🔑', text: 'approved spending' }
    default: return { icon: '•', text: l.action }
  }
}

export default function App() {
  const [logs, setLogs] = useState<TxLog[]>([])
  const [, setFrame] = useState(0)
  const [stats, setStats] = useState<Stats>({})
  const [started, setStarted] = useState(false)
  const [kycLevel, setKycLevel] = useState<number | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const log = (l: TxLog) => setLogs((prev) => [l, ...prev].slice(0, 60))

  const robots = useRef<Robot[]>([])
  if (robots.current.length === 0) {
    robots.current = [
      ...keys(import.meta.env.VITE_PICKER_KEYS).map((k, i) => new Robot(`picker${i + 1}`, 'picker', walletFor(k), { x: 1 + i, y: 1 }, log)),
      ...keys(import.meta.env.VITE_CARRIER_KEYS).map((k, i) => new Robot(`carrier${i + 1}`, 'carrier', walletFor(k), { x: 15 + i, y: 11 }, log)),
    ]
  }

  const start = async () => {
    setStarted(true)
    await sendTx(warehouse, 'warehouse', log, 'usdc', 'approve', [addresses.market, maxUint256])
    robots.current.forEach((r) => r.run())
    // Warehouse pays picker once the order is submitted as packed.
    for (;;) {
      const done = (await readJobs()).filter((j) => j.status === SUBMITTED && j.poster === warehouse.account.address)
      for (const j of done) await sendTx(warehouse, 'warehouse', log, 'market', 'confirm', [j.id]).catch(() => {})
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  const postOrder = () => {
    const shelves = Object.keys(SHELVES)
    const spec: OrderSpec = { sku: `SKU-${Math.floor(Math.random() * 900 + 100)}`, shelf: shelves[Math.floor(Math.random() * shelves.length)] }
    sendTx(warehouse, 'warehouse', log, 'market', 'post', [JSON.stringify(spec), ORDER_REWARD, 0n]).catch((e) => alert(e.message))
  }

  // Movement + render loop.
  useEffect(() => {
    const id = setInterval(() => {
      robots.current.forEach((r) => r.tick())
      setFrame((f) => f + 1)
    }, 250)
    return () => clearInterval(id)
  }, [])

  // Balances + reputation from chain.
  useEffect(() => {
    const read = (fn: string, contract: 'usdc' | 'market', a: Address) =>
      publicClient.readContract({ address: addresses[contract], abi: abis[contract], functionName: fn, args: [a] }) as Promise<bigint>
    const poll = async () => {
      const all = [{ name: 'warehouse', a: warehouse.account.address }, ...robots.current.map((r) => ({ name: r.name, a: r.wallet.account.address }))]
      const entries = await Promise.all(
        all.map(async ({ name, a }) => [name, { usdc: formatUnits(await read('balanceOf', 'usdc', a), 6), done: String(await read('completed', 'market', a)) }] as const),
      )
      setStats(Object.fromEntries(entries))
    }
    poll()
    // Operator compliance straight from the KYC SBT that JobMarket enforces.
    ;(async () => {
      const kyc = (await publicClient.readContract({ address: addresses.market, abi: abis.market, functionName: 'kyc' })) as Address
      const [ok, lvl] = await publicClient.readContract({ address: kyc, abi: KYC_ABI, functionName: 'isHuman', args: [warehouse.account.address] })
      setKycLevel(ok ? lvl : 0)
    })()
    const id = setInterval(poll, 6000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => draw(canvas.current, robots.current))

  const count = (fn: string, who?: (w: string) => boolean) => logs.filter((l) => l.action.startsWith(fn + '(') && (!who || who(l.who))).length
  const jobsDone = robots.current.reduce((n, r) => n + Number(stats[r.name]?.done ?? 0), 0)
  const kpis = [
    { n: jobsDone, l: 'jobs completed by robots' },
    { n: count('post', (w) => w !== 'warehouse'), l: 'robot → robot hires' },
    { n: count('submitWithProof'), l: 'ZK delivery proofs verified' },
    { n: count('charge'), l: 'machine payments to dock' },
  ]
  const visibleLogs = logs.filter((l) => !l.action.startsWith('approve('))

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <span className="logo">RoboPay</span>
          <span className="tag">Robots hiring and paying robots</span>
        </div>
        <div className="pills">
          <span className="pill"><i className="dot" />{chain.name} · {chain.id}</span>
          <span className="pill">ZK proof of delivery · Noir</span>
          <span className="pill">
            operator {kycLevel === null ? 'KYC …' : kycLevel > 0 ? <b style={{ color: 'var(--g)' }}>KYC L{kycLevel} ✓</b> : <b style={{ color: 'var(--r)' }}>not KYC'd</b>}
          </span>
        </div>
      </header>

      <section className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.l}>
            <div className="n">{k.n}</div>
            <div className="l">{k.l}</div>
          </div>
        ))}
      </section>

      <section className="main">
        <div className="card">
          <h3><span>Warehouse floor</span><span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>live simulation</span></h3>
          <canvas ref={canvas} width={GRID.cols * GRID.cell * DPR} height={GRID.rows * GRID.cell * DPR} />
          <div className="controls">
            <button onClick={start} disabled={started}>▶ Start robots</button>
            <button className="primary" onClick={postOrder} disabled={!started}>Post order · 10 mUSDC</button>
            <span className="hint">{started ? 'Each robot signs its own HSK transactions.' : 'Robots approve the market from their own wallets on start.'}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          <div className="card">
            <h3><span>Fleet</span><span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>mUSDC · jobs</span></h3>
            <div className="fleet">
              <div className="bot">
                <div className="av" style={{ background: 'linear-gradient(135deg,#9945ff,#14f195)' }}>WH</div>
                <div>
                  <div className="name">warehouse <span className="badge" style={{ background: 'rgba(20,241,149,.12)', color: 'var(--g)' }}>{kycLevel ? `KYC L${kycLevel}` : 'KYC'}</span></div>
                  <div className="st">posts orders · pays on delivery</div>
                </div>
                <div className="right"><div className="bal">{fmt(stats.warehouse?.usdc)}</div></div>
              </div>
              {robots.current.map((r) => (
                <div className="bot" key={r.name}>
                  <div className="av" style={{ background: FLEET_COLOR[r.role] }}>{r.name[0].toUpperCase() + r.name.slice(-1)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="name">
                      {r.name}
                      <span className="badge" style={{ background: 'rgba(255,255,255,.06)', color: FLEET_COLOR[r.role] }}>{r.role === 'picker' ? 'fleet A' : 'fleet B'}</span>
                    </div>
                    <div className="st" title={r.status}>{r.status}</div>
                    <div className="batt"><i style={{ width: `${r.battery}%`, background: r.battery < 35 ? 'var(--r)' : 'var(--g)' }} /></div>
                  </div>
                  <div className="right">
                    <div className="bal">{fmt(stats[r.name]?.usdc)}</div>
                    <div>{stats[r.name]?.done ?? '–'} done</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3><span>On-chain activity</span><span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{visibleLogs.length} tx</span></h3>
            <div className="feed">
              {visibleLogs.length === 0 && <div className="empty">Start the robots and post an order.</div>}
              {visibleLogs.map((l) => {
                const d = describe(l)
                const url = explorerTx(l.hash)
                return (
                  <div className={`ev${d.zk ? ' zk' : ''}`} key={l.hash}>
                    <div className="ic">{d.icon}</div>
                    <div className="t"><b>{l.who}</b> {d.text}<div className="when">{new Date(l.at).toLocaleTimeString()}</div></div>
                    {url ? <a href={url} target="_blank" rel="noreferrer">tx ↗</a> : <span className="when">{l.hash.slice(0, 8)}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

const fmt = (v?: string) => (v === undefined ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }))

function draw(c: HTMLCanvasElement | null, robots: Robot[]) {
  const ctx = c?.getContext('2d')
  if (!c || !ctx) return
  const s = GRID.cell
  const W = GRID.cols * s, H = GRID.rows * s
  const mid = (p: Point) => ({ x: p.x * s + s / 2, y: p.y * s + s / 2 })
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0e0b18'); bg.addColorStop(1, '#08120f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,.08)'
  for (let x = 1; x < GRID.cols; x++) for (let y = 1; y < GRID.rows; y++) { ctx.beginPath(); ctx.arc(x * s, y * s, 1, 0, Math.PI * 2); ctx.fill() }

  const zone = (p: Point, color: string, label: string, glow = false) => {
    const x = p.x * s + 3, y = p.y * s + 3, w = s - 6
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 18 }
    ctx.fillStyle = color + '33'; ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(x, y, w, w, 7); ctx.fill(); ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#f4f2ff'; ctx.font = '600 10px "JetBrains Mono", monospace'; ctx.textAlign = 'center'
    ctx.fillText(label, x + w / 2, y + w / 2 + 3.5)
  }
  Object.entries(SHELVES).forEach(([name, p]) => zone(p, '#8b87a3', name))
  zone(PACK, '#14f195', 'PACK', true)
  zone(DOCK, '#9945ff', '⚡', true)

  for (const r of robots) {
    const color = FLEET_COLOR[r.role]
    const { x: cx, y: cy } = mid(r.pos)
    // Dotted path to where the robot is heading.
    if (r.destination) {
      const d = mid(r.destination)
      ctx.setLineDash([3, 5]); ctx.strokeStyle = color + 'aa'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(d.x, cy); ctx.lineTo(d.x, d.y); ctx.stroke()
      ctx.setLineDash([])
    }
    // Body with glow.
    ctx.shadowColor = color; ctx.shadowBlur = 16
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(cx, cy, s / 3.1, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // Battery ring.
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(cx, cy, s / 2.35, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = r.battery < 35 ? '#ff4d6d' : '#14f195'
    ctx.beginPath(); ctx.arc(cx, cy, s / 2.35, -Math.PI / 2, -Math.PI / 2 + (r.battery / 100) * Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#0b0a10'; ctx.font = '700 10px "JetBrains Mono", monospace'; ctx.textAlign = 'center'
    ctx.fillText(r.name[0].toUpperCase() + r.name.slice(-1), cx, cy + 3.5)
  }
}
