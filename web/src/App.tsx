import { useEffect, useRef, useState } from 'react'
import { formatUnits, maxUint256, parseUnits, type Address } from 'viem'
import { abis, addresses, chain, explorerTx, publicClient, walletFor } from './chain'
import { Robot, SUBMITTED, readJobs, sendTx, type TxLog } from './robot'
import { DOCK, GRID, PACK, SHELVES, type OrderSpec } from './warehouse'

const ORDER_REWARD = parseUnits('10', 6)
const keys = (v: string | undefined) => (v ?? '').split(',').filter(Boolean)
const warehouse = walletFor(import.meta.env.VITE_WAREHOUSE_KEY)
const FLEET_COLOR = { picker: '#f59e0b', carrier: '#3b82f6' }

type Stats = Record<string, { usdc: string; done: string }>

export default function App() {
  const [logs, setLogs] = useState<TxLog[]>([])
  const [, setFrame] = useState(0)
  const [stats, setStats] = useState<Stats>({})
  const [started, setStarted] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const log = (l: TxLog) => setLogs((prev) => [l, ...prev].slice(0, 40))

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
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => draw(canvas.current, robots.current))

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, fontFamily: 'ui-monospace, monospace', background: '#0b0f17', color: '#e5e7eb', minHeight: '100vh' }}>
      <div>
        <h2 style={{ margin: '0 0 8px' }}>RoboPay Warehouse — robots paying robots on {chain.name}</h2>
        <canvas ref={canvas} width={GRID.cols * GRID.cell} height={GRID.rows * GRID.cell} style={{ borderRadius: 8 }} />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={start} disabled={started}>Start robots</button>
          <button onClick={postOrder} disabled={!started}>Post order (10 mUSDC)</button>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 320 }}>
        <h3>Fleet</h3>
        <table style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th align="left">wallet</th><th align="left">status</th><th>batt</th><th>mUSDC</th><th>jobs done</th></tr></thead>
          <tbody>
            <tr><td>warehouse</td><td>posts orders</td><td /><td align="center">{stats.warehouse?.usdc}</td><td /></tr>
            {robots.current.map((r) => (
              <tr key={r.name}>
                <td style={{ color: FLEET_COLOR[r.role] }}>{r.name}</td>
                <td>{r.status}</td>
                <td align="center">{Math.round(r.battery)}%</td>
                <td align="center">{stats[r.name]?.usdc}</td>
                <td align="center">{stats[r.name]?.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>On-chain log</h3>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {logs.map((l) => (
            <div key={l.hash}>
              <span style={{ color: '#9ca3af' }}>{new Date(l.at).toLocaleTimeString()}</span> <b>{l.who}</b> {l.action.slice(0, 60)}{' '}
              {explorerTx(l.hash) ? <a href={explorerTx(l.hash)} target="_blank" style={{ color: '#34d399' }}>tx↗</a> : l.hash.slice(0, 10)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function draw(c: HTMLCanvasElement | null, robots: Robot[]) {
  const ctx = c?.getContext('2d')
  if (!c || !ctx) return
  const s = GRID.cell
  ctx.fillStyle = '#111827'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.strokeStyle = '#1f2937'
  for (let x = 0; x <= GRID.cols; x++) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, c.height); ctx.stroke() }
  for (let y = 0; y <= GRID.rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(c.width, y * s); ctx.stroke() }
  const tile = (p: { x: number; y: number }, color: string, label: string) => {
    ctx.fillStyle = color
    ctx.fillRect(p.x * s + 2, p.y * s + 2, s - 4, s - 4)
    ctx.fillStyle = '#fff'
    ctx.font = '11px monospace'
    ctx.fillText(label, p.x * s + 5, p.y * s + s / 2 + 4)
  }
  Object.entries(SHELVES).forEach(([name, p]) => tile(p, '#4b5563', name))
  tile(PACK, '#059669', 'PACK')
  tile(DOCK, '#7c3aed', '⚡')
  for (const r of robots) {
    const cx = r.pos.x * s + s / 2, cy = r.pos.y * s + s / 2
    ctx.fillStyle = FLEET_COLOR[r.role]
    ctx.beginPath(); ctx.arc(cx, cy, s / 2.6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = r.battery < 35 ? '#ef4444' : '#22c55e'
    ctx.fillRect(cx - s / 2.6, cy + s / 2.4, (r.battery / 100) * (s / 1.3), 3)
    ctx.fillStyle = '#000'
    ctx.font = 'bold 10px monospace'
    ctx.fillText(r.name.replace(/[a-z]+/, (m) => m[0].toUpperCase()), cx - 7, cy + 4)
  }
}
