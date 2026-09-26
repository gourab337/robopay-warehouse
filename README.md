# RoboPay Warehouse — robots hiring and paying robots on HSK Chain

Built at **EAG Ethereum Hackathon @ Sydney 2026** by team **USYDRobotics**.
Demo: 3-minute live run on HSK Chain testnet · [launch video](video/robopay-launch.mp4)

## Launch video
[`video/robopay-launch.mp4`](video/robopay-launch.mp4) (57s, 1080p). Rendered frame by frame from `video/film.html` with `video/render.cjs` (Playwright) + ffmpeg; original soundtrack synthesized in `video/music.py` (no samples).

## Track selection
| Track | How RoboPay fits |
|---|---|
| **Sydney Hackathon** | Built in person at EAG Ethereum Hackathon @ Sydney, 26 Sep 2026 |
| **HSK Chain** (AI Agents · Payment · Stablecoins) | All contracts deployed and running on HSK Chain testnet (chain 133); integrates HashKey's **KYC SBT** interface to gate operators; every robot action in the demo is an HSK transaction; settlement in a 6-decimal stablecoin |
| **AI × Ethereum & Agent Economy** | Each robot is an autonomous agent with its own wallet: finds work, subcontracts other agents, pays for energy, earns on-chain reputation |
| **Smart Devices, Open Hardware & Privacy Hardware** | Robots and charging docks are devices that hold wallets and transact; ZK proof of delivery keeps tote/SKU/floor-plan data off-chain; ROS 2 bridge (`ros/robopay_bridge`) runs the same agent on real robots via Nav2 |
| **Real-World Ethereum Applications** | A real logistics workflow (pick → carry → pack → recharge) settled in stablecoins, letting warehouses mix vendor fleets without a platform middleman |

## Why
Warehouses run mixed fleets from different vendors: picker arms, carrier AMRs, charging docks. Each vendor's fleet is a walled garden. There is no neutral way for one vendor's robot to hire another vendor's robot, or pay a third-party dock, without a central platform in the middle.

## What
Every robot is an autonomous agent with its own wallet on HSK Chain.

1. Warehouse posts an order (e.g. "pick SKU-351 @ B2") and escrows 10 mUSDC.
2. A **picker robot** (fleet A) accepts, drives to the shelf, picks.
3. The picker **hires a carrier robot** (fleet B) with its *own* money: it posts a 3 mUSDC sub-job linked to the order.
4. The picker commits to the tote on-chain (`pedersen(tote_id, job_id)`) without revealing it.
5. Carrier moves the tote to packing, generates a **zero-knowledge proof of delivery** (Noir, ~1.6s on a laptop CPU) and calls `submitWithProof` → the on-chain Honk verifier checks it → carrier is paid automatically. No one has to confirm; payment is released by math.
6. Picker submits the order → warehouse confirms → picker is paid 10 (keeps 7 margin).
7. Low battery → robot drives to the **charging dock** and pays per unit of charge.

## What's on-chain (beyond a transfer)
- **Nested escrow:** a robot is both worker and employer. `parentId` links a sub-job to its order, so the whole robot supply chain is auditable on-chain.
- **ZK proof of delivery:** the carrier proves it knows the packing station's scan secret and the committed tote, bound to the job ID and its own address (no replay). Tote ID and station secret never go on-chain. A valid proof releases escrow directly.
- **Pay-on-receipt fallback:** jobs without a ZK proof release only when the poster confirms receipt.
- **On-chain reputation:** `completed[robot]` counts paid jobs per robot wallet.
- **Machine-to-machine payment:** robots pay `ChargingDock` directly.
- **HashKey KYC SBT compliance:** only KYC-verified operators (`IKycSBT.isHuman`, level ≥ BASIC) can post top-level orders; robots can only subcontract work they have accepted. Compliance at the operator layer, autonomy at the machine layer. The contract targets HashKey's live testnet SBT (`0xA45f42F09A7Ae50e556467cf65cF3Cf45711114E`) via `KYC_SBT=...`; because the testnet KYC on-ramp isn't self-serve, the demo deploys `MockKycSBT` with the same interface and approves only the warehouse operator.

## Deployed — HSK Chain Testnet (chain 133)
| Contract | Address |
|---|---|
| MockUSDC | [`0xB3d41620d0f2b58187bBc0879D340CE4266596E0`](https://testnet-explorer.hskchain.net/address/0xB3d41620d0f2b58187bBc0879D340CE4266596E0) |
| JobMarket | [`0xF0f0c15a7e05e81C11Dcbd1E2036A7fa83993351`](https://testnet-explorer.hskchain.net/address/0xF0f0c15a7e05e81C11Dcbd1E2036A7fa83993351) |
| ChargingDock | [`0xcB1Fa73A9AC9081A97a034514B12d22b838b7CE4`](https://testnet-explorer.hskchain.net/address/0xcB1Fa73A9AC9081A97a034514B12d22b838b7CE4) |
| HonkVerifier (ZK) | [`0x965410B5922680efF96d80856629Df07Bd9fcC46`](https://testnet-explorer.hskchain.net/address/0x965410B5922680efF96d80856629Df07Bd9fcC46) |
| KYC SBT (demo mock, see below) | [`0xeba7B6A010ecC6e607694d10Ea83611141c904cC`](https://testnet-explorer.hskchain.net/address/0xeba7B6A010ecC6e607694d10Ea83611141c904cC) |

## Architecture
```
contracts/  Foundry + OpenZeppelin
  MockUSDC.sol      6-decimal testnet stablecoin (open mint, demo only)
  JobMarket.sol     post / accept / submit / confirm / cancel, parentId, reputation,
                    setToteCommitment + submitWithProof (ZK-gated payment)
  HonkVerifier.sol  generated by Barretenberg from the Noir circuit
  ChargingDock.sol  charge(units) → pays dock operator
  IKycSBT.sol       HashKey KYC SBT interface; MockKycSBT.sol = demo stand-in
zk/         Noir circuit: proof of delivery (pedersen commitments, bound to job + carrier)
zk_commit/  Noir helper that computes the tote commitment
web/        Vite + React + viem
  prover.ts         dev-server plugin = the robot's onboard prover (nargo + bb on CPU)
  robot.ts          autonomous robot agent: finds work, moves, signs its own txs
  warehouse.ts      warehouse map (shelves, packing, dock)
  chain.ts          HSK chain config; addresses read from forge broadcast
  App.tsx           2D warehouse sim + fleet table + live on-chain tx log
ros/robopay_bridge/  ROS 2 (rclpy) node: same agent loop on a real robot — Nav2 goals + HSK wallet + ZK proof
```
No hardware needed for the demo — robots are simulated; the agent loop is the part that would run on a real robot (ROS bridge).

## Run
```bash
# toolchain: Foundry, Noir 1.0.0-beta.22 (noirup -v 1.0.0-beta.22), bb 5.0.0-nightly.20260522 (bbup -v ...)
cd zk && nargo test && cd ..
# contracts
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git
forge test
STATION_COMMITMENT=0x0ca459d2d41ed0e8a64700e7171f724ab1616f2c7c652bc8614a4f4b46a05b7f \
ROBOTS=0xpicker1,0xpicker2,0xcarrier1,0xcarrier2 \
  forge script script/Deploy.s.sol --rpc-url https://testnet.hsk.xyz --private-key $WAREHOUSE_KEY --broadcast --slow

# web
cd ../web
cp .env.example .env   # fill burner keys (testnet only — they are bundled into the browser)
pnpm install && pnpm dev
```
Click **Start robots**, then **Post order**. Use `VITE_CHAIN=anvil` for a local chain.

## Honest limits (hackathon prototype)
- The packing station's scan secret is a demo constant; in production it lives in the scanner's secure element and rotates per scan.
- Tote IDs are random < 1e9, so a commitment could be brute-forced; production would add a random salt.
- Anyone can `accept` a sub-job between `post` and `setToteCommitment`; production would post and commit in one call.
- Robots are simulated; mUSDC is a testnet token with no value.
- KYC uses a mock SBT in the demo (HashKey's testnet KYC on-ramp is not self-serve); switching to the live SBT is one env var.
- HSK's load-balanced RPC can lag a block, so robots derive job IDs from mined events and retry calls that depend on their own previous tx.

## Roadmap
- Run `ros/robopay_bridge` on a real AMR / in Gazebo (written, syntax-checked, not yet run on hardware)
- Robot identity registry + reputation-weighted hiring
- LLM planner that negotiates sub-job prices
- Post-and-commit in one call, salted commitments, rotating station secrets
- Dispute window instead of instant confirm; real stablecoin on HSK mainnet
