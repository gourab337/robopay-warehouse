// Dev-server plugin standing in for the robot's onboard prover: runs the Noir circuit + bb on the Mac CPU.
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'

const run = promisify(execFile)
const ZK = resolve(__dirname, '../zk')
const COMMIT = resolve(__dirname, '../zk_commit')
const PATH = `${homedir()}/.nargo/bin:${homedir()}/.bb:${process.env.PATH}`
// The packing station's scan secret; its pedersen hash is the StationCommitment deployed in JobMarket.
const STATION_SECRET = '777'
const STATION_COMMITMENT = '0x0ca459d2d41ed0e8a64700e7171f724ab1616f2c7c652bc8614a4f4b46a05b7f'

// nargo/bb share one target dir, so run jobs one at a time.
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>) => {
  const p = queue.then(fn)
  queue = p.catch(() => {})
  return p
}
const sh = (cmd: string, args: string[], cwd: string) => run(cmd, args, { cwd, env: { ...process.env, PATH } })

async function commit(tote: string, job: string) {
  writeFileSync(join(COMMIT, 'Prover.toml'), `tote_id = "${tote}"\njob_id = "${job}"\n`)
  const { stdout } = await sh('nargo', ['execute'], COMMIT)
  const m = stdout.match(/Circuit output: (0x[0-9a-f]+)/)
  if (!m) throw new Error(`no commitment in nargo output: ${stdout}`)
  return '0x' + m[1].slice(2).padStart(64, '0')
}

async function prove(tote: string, job: string, carrier: string) {
  const toml = [
    `tote_id = "${tote}"`, `station_secret = "${STATION_SECRET}"`, `job_id = "${job}"`, `carrier = "${carrier}"`,
    `tote_commitment = "${await commit(tote, job)}"`, `station_commitment = "${STATION_COMMITMENT}"`,
  ].join('\n')
  writeFileSync(join(ZK, 'Prover.toml'), toml + '\n')
  await sh('nargo', ['execute'], ZK)
  await sh('bb', ['prove', '-b', 'target/proof_of_delivery.json', '-w', 'target/proof_of_delivery.gz', '-o', 'target', '-t', 'evm'], ZK)
  return '0x' + readFileSync(join(ZK, 'target/proof')).toString('hex')
}

export function proverPlugin(): Plugin {
  return {
    name: 'robot-prover',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://x')
        if (url.pathname !== '/api/commit' && url.pathname !== '/api/prove') return next()
        const q = (k: string) => {
          const v = url.searchParams.get(k) ?? ''
          if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(v)) throw new Error(`bad ${k}`)
          return v
        }
        try {
          const body = url.pathname === '/api/commit'
            ? { commitment: await serial(() => commit(q('tote'), q('job'))) }
            : { proof: await serial(() => prove(q('tote'), q('job'), q('carrier'))) }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: (e as Error).message }))
        }
      })
    },
  }
}
