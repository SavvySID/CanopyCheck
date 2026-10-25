# CanopyCheck

**Satellite-verified carbon credits. If the forest disappears, the credit freezes.**

**Track:** Carbon Markets & Emissions Transparency, IEEE ClimateChain Global Hackathon 2026

CanopyCheck checks forest carbon credits against free public satellite imagery. Independent checkers run the same open pipeline on Sentinel-2 data. It uses cloud masking, multi-date compositing and a machine-learning forest classifier trained on ESA WorldCover labels. They submit the measured forest cover to a smart contract. When two of three checkers agree, the contract updates the project's status. Credits from a project that has lost too much forest are **frozen**: they can't be transferred or retired. Retired credits are burned, and the same forest boundary can't be registered twice, so a credit can't be counted twice.

> Prototype. The three demo projects are fictional names on illustrative 3 × 3 km boxes drawn over **real Sentinel-2 imagery**. They aren't registered carbon projects, and the credits are local or testnet tokens, not real offsets.

## The problem

Companies buy forest carbon credits to offset emissions. A credit is supposed to mean that a forest was protected. Buyers can't easily check two things:

1. **Is the forest still there?** It may have been cleared or burned after the credits were sold.
2. **Was the threat real?** Investigations in 2023 found that many rainforest credits came from projects that overstated how much forest was at risk, which inflated the number of credits they could issue.

Verification is slow, expensive and usually closed. Once a credit is sold, nothing in the market reacts when the forest behind it disappears.

## What CanopyCheck does

| Step | What happens |
|---|---|
| Register | The registry records a project's boundary hash, baseline forest cover and the developer's claimed annual deforestation threat. A boundary that is already registered is rejected. |
| Measure | Checkers build cloud-masked dry-season composites from Sentinel-2 and classify each 10 m pixel as forest or not forest. They measure the project area and a nearby **reference area**. |
| Agree | Each checker submits `(project, year, forestCoverBps, referenceLossBps, evidenceHash)`. A result is accepted only when **2 of 3 checkers agree within 1 percentage point**. Outliers are ignored, and stale or duplicate reports are rejected. |
| Enforce | Forest remaining versus baseline: **≥ 95% Healthy**, **85–95% At Risk** (tradable, with a warning), **< 85% Frozen** (no transfers, no retirement, no new issuance). Regrowth unfreezes the project. |
| Threat check | If the claimed threat is more than **twice** the loss rate observed in the reference area, the project is flagged **Overcredited**. That's an indicator for review, not proof of fraud. |
| Show | The dashboard shows a map, before/after satellite comparisons with loss overlays, forest-cover history, the threat check, the on-chain checker votes and blocked actions. |

## Results on real imagery (2019 → 2026 dry seasons)

| Demo project | Location | Forest 2019 → 2026 | Remaining | Reference loss vs claimed threat | Status |
|---|---|---|---|---|---|
| Jaci Frontier Forest | Rondônia, Brazil | 95.8% → 77.9% (862 → 701 ha) | 81.3% | 6.02%/yr vs 2.0%/yr | **Frozen** (from 2025) |
| Candeias Riverside Forest | Rondônia, Brazil | 94.9% → 78.8% (854 → 709 ha) | 83.0% | 5.28%/yr vs 1.5%/yr | **Frozen** (from 2023) |
| Kalimantan Highland Forest | Kalimantan, Indonesia | 99.6% → 98.0% (896 → 882 ha) | 98.4% | 0.19%/yr vs 2.5%/yr | **Healthy**, flagged **Overcredited** |

The classifier was trained on 8,400 pixels and tested on 3,600 held-out pixels labelled by ESA WorldCover 2021. On those pixels it agreed with the labels 94.2% of the time, with 93.8% precision and 94.6% recall. This is a random pixel split from the same six areas and the same year, measured before the majority filter. It is likely optimistic, and because WorldCover is itself a modelled map it is not field validation. Every dry-season composite had 99.9–100% clear coverage of its project box. The numbers come from `npm run satellite`. See `web/public/data/projects.json` and the per-project `evidence.json`.

## Architecture

```text
Sentinel-2 L2A (Microsoft Planetary Computer, public COGs)
        │  small windows read over HTTP range requests
        ▼
scripts/lib/composite.mjs   SCL cloud/shadow mask → per-pixel median of the clearest scenes
        ▼
scripts/fetch-satellite.mjs  logistic-regression forest classifier
        │                    (features: 6 bands + NDVI, NDMI, NBR; labels: ESA WorldCover 2021)
        │                    → forest %, hectares, loss maps, reference-area loss rate
        │                    → evidence.json per project (sha256 = evidenceHash)
        ▼
contracts/CanopyCheck.sol   ERC-1155 credits + project registry + 2-of-3 checker oracle
        │                    status rules, frozen-credit enforcement, burn-on-retire
        ▼
scripts/run-checks.js       replays registration, trading, yearly checks (incl. a faulty
        │                    checker) and blocked actions → chain.json
        ▼
web/ (Vite + React + Leaflet) public dashboard
```

## Run it

Requires Node 20+. No API keys: the satellite data is public.

```bash
npm install
npm test              # 11 contract tests (Hardhat)
npm run satellite     # fetch imagery, train the classifier, measure forest cover (~5 min)
npm run checks        # deploy + replay the on-chain flow on an in-process Hardhat chain
npm run dev           # landing page at http://localhost:5173, dashboard at /app.html
```

To deploy to a public testnet such as Polygon Amoy or Sepolia, use one funded key. The script creates and funds the other demo accounts:

```bash
RPC_URL=https://rpc-amoy.polygon.technology PRIVATE_KEY=0x... npx hardhat run scripts/run-checks.js --network testnet
```

## Smart contract

`contracts/CanopyCheck.sol` (Solidity 0.8.28, OpenZeppelin ERC-1155 + Ownable)

- `registerProject` stores the boundary hash, baseline cover, claimed threat and metadata. It reverts with `BoundaryAlreadyRegistered` on a repeat boundary.
- `issueCredits` mints to the developer. It's blocked while Frozen.
- `submitReport` is checker-only and follows a one-report-per-checker-per-period rule. Periods must increase. A result is accepted once `quorum` reports agree within `toleranceBps`, using the most conservative agreeing values.
- `retire` burns credits and stores a `Retirement` record with the beneficiary. It's blocked while Frozen.
- `_update` blocks transfers of Frozen credits. This also covers `safeBatchTransferFrom`.

## Why blockchain?

Verification results, status changes and retirements are public and tamper-evident. Enforcement is automatic: a frozen credit can't be sold or claimed against emissions anywhere the token moves, without relying on a registry to update a spreadsheet. Detailed evidence stays off-chain. Only its hash goes on-chain, so anyone can re-run the pipeline and check that their numbers match.

## Honest limitations

- The demo areas are small illustrative boxes, not real project boundaries.
- The classifier is a logistic regression. Its held-out metrics are measured against WorldCover labels, which have their own errors. WorldCover's "tree cover" class includes plantations.
- The rules use fixed thresholds chosen for the demo, not a carbon-market standard. Natural disturbance (fire, storms), buffer pools and recovery rules need a real methodology.
- Boundary-hash uniqueness only catches identical boundaries. Overlapping polygons need a spatial check.
- The three checkers in the demo are local accounts. Checker C is deliberately faulty, to show the quorum working. Real independence needs separate organizations and accountability.
- Evidence files are content-hashed. IPFS pinning is planned.

## Future work

Sentinel-1 radar for cloudy regions · NASA GEDI lidar for biomass and carbon estimates · Hansen/UMD validation · polygon boundaries and overlap checks · IPFS evidence · reserve-credit buffers · an open checker network of universities and NGOs · integration with on-chain carbon markets.

## License

MIT
