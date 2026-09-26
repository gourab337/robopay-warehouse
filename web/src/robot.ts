import { keccak256, maxUint256, parseUnits, toHex, type Address, type Hash } from 'viem'
import { abis, addresses, publicClient, type Wallet } from './chain'
import { DOCK, PACK, SHELVES, type CarrySpec, type OrderSpec, type Point } from './warehouse'

export type Role = 'picker' | 'carrier'
export type TxLog = { who: string; action: string; hash: Hash; at: number }

export const OPEN = 1
export const SUBMITTED = 3
export const SUBJOB_REWARD = parseUnits('3', 6)
const CHARGE_BELOW = 35
const DRAIN_PER_STEP = 1.5

export type Job = { id: bigint; poster: Address; worker: Address; reward: bigint; parentId: bigint; status: number; spec: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function readJobs(lastN = 30): Promise<Job[]> {
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
  const { request, result } = await publicClient.simulateContract({
    account: wallet.account, address: addresses[contract], abi: abis[contract], functionName, args,
  })
  const hash = await wallet.writeContract({ ...request, nonce: await nextNonce(wallet.account.address) })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') throw new Error(`${who} ${functionName} reverted`)
  log({ who, action: `${functionName}(${args.map(String).join(', ')})`, hash, at: Date.now() })
  return result
}

export class Robot {
  pos: Point
  battery = 100
  status = 'booting'
  private target: Point | null = null
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

  private tx(contract: 'market' | 'dock' | 'usdc', fn: string, args: unknown[]) {
    return sendTx(this.wallet, this.name, this.log, contract, fn, args)
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
        const mine = jobs.filter((j) => j.status === OPEN && (this.role === 'picker' ? j.parentId === 0n : j.parentId !== 0n))
        for (const job of mine.sort(() => Math.random() - 0.5)) {
          if (await this.tryAccept(job.id)) {
            await (this.role === 'picker' ? this.pick(job) : this.carry(job))
            break
          }
        }
      } catch (e) {
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
    await this.tx('dock', 'charge', [BigInt(Math.ceil(100 - this.battery))])
    this.battery = 100
  }

  /** Picker: fetch item, then hire a carrier robot with its own money. */
  private async pick(order: Job) {
    const spec = JSON.parse(order.spec) as OrderSpec
    await this.moveTo(SHELVES[spec.shelf], `picking ${spec.sku} @ ${spec.shelf}`)
    this.status = 'hiring carrier'
    const carry: CarrySpec = { from: spec.shelf, to: 'PACK' }
    const subId = (await this.tx('market', 'post', [JSON.stringify(carry), SUBJOB_REWARD, order.id])) as bigint
    this.status = `waiting for carrier (job #${subId})`
    for (;;) {
      const sub = (await readJobs()).find((j) => j.id === subId)
      if (sub?.status === SUBMITTED) break
      await sleep(1500)
    }
    this.status = 'paying carrier'
    await this.tx('market', 'confirm', [subId])
    await this.tx('market', 'submit', [order.id, keccak256(toHex(`${spec.sku} packed`))])
  }

  /** Carrier: move the tote from shelf to packing. */
  private async carry(job: Job) {
    const spec = JSON.parse(job.spec) as CarrySpec
    await this.moveTo(SHELVES[spec.from], `collecting tote @ ${spec.from}`)
    await this.moveTo(PACK, 'carrying tote → pack')
    await this.tx('market', 'submit', [job.id, keccak256(toHex(`job ${job.id} tote@PACK`))])
  }
}
