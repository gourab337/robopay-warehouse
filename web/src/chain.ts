import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import JobMarketArtifact from '../../contracts/out/JobMarket.sol/JobMarket.json'
import ChargingDockArtifact from '../../contracts/out/ChargingDock.sol/ChargingDock.json'
import MockUSDCArtifact from '../../contracts/out/MockUSDC.sol/MockUSDC.json'

export const hskTestnet = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'HSK Explorer', url: 'https://testnet-explorer.hskchain.net' } },
})

export const chain = import.meta.env.VITE_CHAIN === 'anvil' ? foundry : hskTestnet
export const explorerTx = (hash: string) =>
  chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined

export const abis = {
  market: JobMarketArtifact.abi as Abi,
  dock: ChargingDockArtifact.abi as Abi,
  usdc: MockUSDCArtifact.abi as Abi,
}

// Addresses come straight from the forge broadcast of script/Deploy.s.sol.
const broadcasts = import.meta.glob('../../contracts/broadcast/Deploy.s.sol/*/run-latest.json', { eager: true, import: 'default' }) as Record<
  string,
  { transactions: { contractName: string | null; contractAddress: string | null; transactionType: string }[] }
>
const run = Object.entries(broadcasts).find(([path]) => path.includes(`/${chain.id}/`))?.[1]
if (!run) throw new Error(`No Deploy.s.sol broadcast for chain ${chain.id} — run the deploy script first`)
const addr = (name: string) => {
  const tx = run.transactions.find((t) => t.transactionType === 'CREATE' && t.contractName === name)
  if (!tx?.contractAddress) throw new Error(`${name} not in broadcast`)
  return tx.contractAddress as Address
}
export const addresses = { market: addr('JobMarket'), dock: addr('ChargingDock'), usdc: addr('MockUSDC') }

export const publicClient = createPublicClient({ chain, transport: http() })

export function walletFor(privateKey: string) {
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  return createWalletClient({ account, chain, transport: http() })
}
export type Wallet = ReturnType<typeof walletFor>
