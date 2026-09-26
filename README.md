# RoboPay Warehouse — robots hiring and paying robots on HSK Chain

Built at **EAG Ethereum Hackathon @ Sydney 2026** by team **USYDRobotics**.
Tracks: **AI x Ethereum & Agent Economy** (primary), Smart Devices & Open Hardware, **HSK Chain Track** (AI Agents / Payment / Stablecoins).

## Why
Warehouses run mixed fleets from different vendors: picker arms, carrier AMRs, charging docks. Each vendor's fleet is a walled garden. There is no neutral way for one vendor's robot to hire another vendor's robot, or pay a third-party dock, without a central platform in the middle.

## What
Every robot is an autonomous agent with its own wallet on HSK Chain.

1. Warehouse posts an order (e.g. "pick SKU-351 @ B2") and escrows 10 mUSDC.
2. A **picker robot** (fleet A) accepts, drives to the shelf, picks.
3. The picker **hires a carrier robot** (fleet B) with its *own* money: it posts a 3 mUSDC sub-job linked to the order.
4. Carrier moves the tote to packing and submits proof → picker confirms receipt → carrier is paid.
5. Picker submits the order → warehouse confirms → picker is paid 10 (keeps 7 margin).
6. Low battery → robot drives to the **charging dock** and pays per unit of charge.

## What's on-chain (beyond a transfer)
- **Nested escrow:** a robot is both worker and employer. `parentId` links a sub-job to its order, so the whole robot supply chain is auditable on-chain.
- **Pay-on-receipt:** payment releases only when the next party confirms receipt — fleets from different vendors don't need to trust each other.
- **On-chain reputation:** `completed[robot]` counts paid jobs per robot wallet.
- **Machine-to-machine payment:** robots pay `ChargingDock` directly.

## Deployed — HSK Chain Testnet (chain 133)
| Contract | Address |
|---|---|
| MockUSDC | [`0xF763a140d2eb8D11C6417Ff5bE8EfD2935ecF5eb`](https://testnet-explorer.hskchain.net/address/0xF763a140d2eb8D11C6417Ff5bE8EfD2935ecF5eb) |
| JobMarket | [`0xe9783178a61fBB6c78D844B81aF545fE743e8F40`](https://testnet-explorer.hskchain.net/address/0xe9783178a61fBB6c78D844B81aF545fE743e8F40) |
| ChargingDock | [`0x4F6dFf548a79aA4b6BfEA0afAa05054E1f0Cfd8f`](https://testnet-explorer.hskchain.net/address/0x4F6dFf548a79aA4b6BfEA0afAa05054E1f0Cfd8f) |

## Architecture
```
contracts/  Foundry + OpenZeppelin
  MockUSDC.sol      6-decimal testnet stablecoin (open mint, demo only)
  JobMarket.sol     post / accept / submit / confirm / cancel, parentId, reputation
  ChargingDock.sol  charge(units) → pays dock operator
web/        Vite + React + viem
  robot.ts          autonomous robot agent: finds work, moves, signs its own txs
  warehouse.ts      warehouse map (shelves, packing, dock)
  chain.ts          HSK chain config; addresses read from forge broadcast
  App.tsx           2D warehouse sim + fleet table + live on-chain tx log
```
No hardware needed for the demo — robots are simulated; the agent loop is the part that would run on a real robot (ROS bridge).

## Run
```bash
# contracts
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git
forge test
ROBOTS=0xpicker1,0xpicker2,0xcarrier1,0xcarrier2 \
  forge script script/Deploy.s.sol --rpc-url https://testnet.hsk.xyz --private-key $WAREHOUSE_KEY --broadcast --slow

# web
cd ../web
cp .env.example .env   # fill burner keys (testnet only — they are bundled into the browser)
pnpm install && pnpm dev
```
Click **Start robots**, then **Post order**. Use `VITE_CHAIN=anvil` for a local chain.

## Roadmap
- ROS bridge to drive real robots with the same agent loop
- Robot identity registry + reputation-weighted hiring
- LLM planner that negotiates sub-job prices
- Dispute window instead of instant confirm; real stablecoin on HSK mainnet
