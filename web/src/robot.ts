import { decodeEventLog, keccak256, maxUint256, parseUnits, toHex, type Address, type Hash, type TransactionReceipt } from 'viem'
import { abis, addresses, publicClient, type Wallet } from './chain'
import { DOCK, PACK, SHELVES, type CarrySpec, type OrderSpec, type Point } from './warehouse'

export type Role = 'picker' | 'carrier'
export type TxLog = { who: string; action: string; hash: Hash; at: number }

export const OPEN = 1
export const SUBMITTED = 3
const PAID = 4
export const SUBJOB_REWARD = parseUnits('3', 6)
const CHARGE_BELOW = 35
const DRAIN_PER_STEP = 2.5 // high enough that a carrier needs the dock after ~1 delivery, so the demo shows it

export type Job = { id: bigint; poster: Address; worker: Address; reward: bigint; parentId: bigint; status: number; spec: string }

// Physical handoff: the tote ID travels with the tote, never on-chain.
const toteForJob = new Map<bigint, string>()

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path)
  const body = await r.json()
  if (!r.ok) throw new Error(body.error ?? r.statusText)
  return body as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One shared, cached read of recent jobs so N robots don't each hammer the RPC (HSK rate-limits per IP).
let jobsCache: { at: number; jobs: Promise<Job[]> } | null = null
export function readJobs(lastN = 12): Promise<Job[]> {
  if (jobsCache && Date.now() - jobsCache.at < 2000) return jobsCache.jobs
  const jobs = fetchJobs(lastN)
  jobsCache = { at: Date.now(), jobs }
  jobs.catch(() => (jobsCache = null))
  return jobs
}

async function fetchJobs(lastN: number): Promise<Job[]> {
  const count = (await publicClient.readContract({ address: addresses.market, abi: abis.market, functionName: 'jobCount' })) as bigint
  const ids: bigint[] = []
  for (let i = count; i > 0n && ids.length < lastN; i--) ids.push(i)
  return Promise.all(
    ids.map(async (id) => {
      const [poster, worker, reward, parentId, status, , spec] = (await publicClient.readContract({
        address: addresses.market, abi: abis.market, functionName: 'jobs', args: [id],
      })) as [Address, Address, bigint, bigint, number, Hash, string]
      return { id, poster, worker, reward, parentId, status, spec }
    }),
  )
}

// HSK's load-balanced RPC can report a stale nonce right after a receipt, so each wallet counts its own.
const nonces = new Map<Address, number>()
async function nextNonce(a: Address) {
  const n = nonces.get(a) ?? (await publicClient.getTransactionCount({ address: a, blockTag: 'pending' }))
  nonces.set(a, n + 1)
  return n
}

/** Simulate first (so a lost race reverts locally, not on chain), then send and wait. */
export async function sendTx(wallet: Wallet, who: string, log: (l: TxLog) => void, contract: 'market' | 'dock' | 'usdc', functionName: string, args: unknown[]) {
  const { request } = await publicClient.simulateContract({
    account: wallet.account, address: addresses[contract], abi: abis[contract], functionName, args,
  })
  let hash: Hash
  try {
    hash = await wallet.writeContract({ ...request, nonce: await nextNonce(wallet.account.address) })
  } catch (e) {
    nonces.delete(wallet.account.address) // resync from chain so a failed send doesn't leave a nonce gap
    throw e
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') throw new Error(`${who} ${functionName} reverted`)
  log({ who, action: `${functionName}(${args.map((a) => String(a).slice(0, 18)).join(', ')})`, hash, at: Date.now() })
  return receipt
}

/** Job id from the mined JobPosted event — simulation results can come from a lagging RPC node. */
function postedJobId(receipt: TransactionReceipt): bigint {
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== addresses.market.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: abis.market, data: l.data, topics: l.topics })
      if (ev.eventName === 'JobPosted') return (ev.args as unknown as { id: bigint }).id
    } catch { /* other event */ }
  }
  throw new Error('JobPosted event not found')
}

export class Robot {
  pos: Point
  battery = 100
  status = 'booting'
  private target: Point | null = null
  get destination(): Point | null { return this.target }
  private arrived: (() => void) | null = null

  readonly name: string
  readonly role: Role
  readonly wallet: Wallet
  private readonly log: (l: TxLog) => void

  constructor(name: string, role: Role, wallet: Wallet, start: Point, log: (l: TxLog) => void) {
    this.name = name
    this.role = role
    this.wallet = wallet
    this.log = log
    this.pos = { ...start }
  }

  /** Advance one grid step toward target. Called by the render loop. */
  tick() {
    if (!this.target) return
    const t = this.target
    if (this.pos.x !== t.x) this.pos.x += Math.sign(t.x - this.pos.x)
    else if (this.pos.y !== t.y) this.pos.y += Math.sign(t.y - this.pos.y)
    this.battery = Math.max(0, this.battery - DRAIN_PER_STEP)
    if (this.pos.x === t.x && this.pos.y === t.y) {
      this.target = null
      this.arrived?.()
    }
  }

  private moveTo(p: Point, status: string) {
    this.status = status
    this.target = { ...p }
    return new Promise<void>((r) => (this.arrived = r))
  }

  /** retries > 0 for calls that depend on our own just-mined tx: HSK's load-balanced RPC can lag a block. */
  private async tx(contract: 'market' | 'dock' | 'usdc', fn: string, args: unknown[], retries = 0) {
    for (let i = 0; ; i++) {
      try {
        return await sendTx(this.wallet, this.name, this.log, contract, fn, args)
      } catch (e) {
        if (i >= retries) throw e
        await sleep(1500)
      }
    }
  }

  async run() {
    this.status = 'approving'
    await this.tx('usdc', 'approve', [addresses.market, maxUint256])
    await this.tx('usdc', 'approve', [addresses.dock, maxUint256])
    for (;;) {
      try {
        if (this.battery < CHARGE_BELOW) await this.recharge()
        this.status = 'looking for work'
        const jobs = await readJobs()
        const mine = jobs.filter((j) => j.status === OPEN && (this.role === 'picker' ? j.parentId === 0n : toteForJob.has(j.id)))
        for (const job of mine.sort(() => Math.random() - 0.5)) {
          if (await this.tryAccept(job.id)) {
            await (this.role === 'picker' ? this.pick(job) : this.carry(job))
            break
          }
        }
      } catch (e) {
        console.error(this.name, e)
        this.status = `error: ${(e as Error).message.slice(0, 60)}`
      }
      await sleep(1500)
    }
  }

  private async tryAccept(id: bigint) {
    try {
      this.status = `accepting job #${id}`
      await this.tx('market', 'accept', [id])
      return true
    } catch {
      return false // another robot won the race
    }
  }

  private async recharge() {
    await this.moveTo(DOCK, 'low battery → dock')
    this.status = 'paying dock'
    await this.tx('dock', 'charge', [BigInt(Math.ceil((100 - this.battery) / 5))]) // 1 unit = 5% battery
    this.battery = 100
  }

  /** Picker: fetch item, then hire a carrier robot with its own money. */
  private async pick(order: Job) {
    const spec = JSON.parse(order.spec) as OrderSpec
    await this.moveTo(SHELVES[spec.shelf], `picking ${spec.sku} @ ${spec.shelf}`)
    this.status = 'hiring carrier'
    const carry: CarrySpec = { from: spec.shelf, to: 'PACK' }
    const subId = postedJobId(await this.tx('market', 'post', [JSON.stringify(carry), SUBJOB_REWARD, order.id]))
    // Commit to the tote on-chain without revealing it; the carrier must prove delivery of exactly this tote.
    const tote = String(Math.floor(Math.random() * 1e9))
    this.status = 'committing tote (ZK)'
    const { commitment } = await api<{ commitment: string }>(`/api/commit?tote=${tote}&job=${subId}`)
    await this.tx('market', 'setToteCommitment', [subId, commitment], 6)
    toteForJob.set(subId, tote)
    this.status = `waiting for carrier (job #${subId})`
    const deadline = Date.now() + 120_000
    for (;;) {
      const sub = (await readJobs()).find((j) => j.id === subId)
      if (sub && sub.status >= SUBMITTED) break
      if (Date.now() > deadline) throw new Error(`carrier for job #${subId} timed out`)
      await sleep(1500)
    }
    if ((await readJobs()).find((j) => j.id === subId)?.status !== PAID) {
      this.status = 'paying carrier'
      await this.tx('market', 'confirm', [subId], 6)
    }
    await this.tx('market', 'submit', [order.id, keccak256(toHex(`${spec.sku} packed`))], 6)
  }

  /** Carrier: move the tote from shelf to packing. */
  private async carry(job: Job) {
    const spec = JSON.parse(job.spec) as CarrySpec
    await this.moveTo(SHELVES[spec.from], `collecting tote @ ${spec.from}`)
    await this.moveTo(PACK, 'carrying tote → pack')
    // Station scan reveals its secret to the robot; robot proves delivery in ZK and is paid by the verifier.
    this.status = 'generating ZK proof'
    const t0 = Date.now()
    const { proof } = await api<{ proof: string }>(`/api/prove?tote=${toteForJob.get(job.id)}&job=${job.id}&carrier=${this.wallet.account.address}`)
    this.status = `proof ${((Date.now() - t0) / 1000).toFixed(1)}s → verifying on-chain`
    await this.tx('market', 'submitWithProof', [job.id, proof], 6)
  }
}
