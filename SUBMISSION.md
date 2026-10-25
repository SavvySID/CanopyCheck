# CanopyCheck: Devpost submission text

## Name
CanopyCheck

## Tagline
Satellite-verified carbon credits. If the forest disappears, the credit freezes.

## Track alignment
**Track: Carbon Markets & Emissions Transparency.** The track asks for blockchain-based carbon credit verification, smart contracts that prevent double counting, and transparent carbon trading. CanopyCheck covers all three:
- **Verification:** forest credits are checked against public Sentinel-2 satellite imagery by an ML forest classifier. Independent checkers submit results to a 2-of-3 on-chain oracle.
- **No double counting:** a forest boundary can be registered only once, so the same land can't be credited twice. Retiring a credit burns it and records the beneficiary on-chain, so a retired tonne can't be resold or claimed again.
- **Transparent trading:** credits are ERC-1155 tokens whose transferability follows the latest accepted satellite check. Credits from a project that has lost too much forest are frozen: no transfers, no retirement, no new issuance.

## Inspiration
Forest carbon credits are supposed to fund forests that would otherwise be cut down. A 2023 investigation found that many rainforest credits from a major certifier likely didn't represent real reductions, largely because projects overstated how much forest was under threat. Buyers today can't easily check whether the forest behind their credit still exists. Even when it's gone, the credit keeps trading.

## What it does
1. **Register:** a project's boundary hash, baseline forest cover and claimed annual deforestation threat are recorded on-chain. A duplicate boundary is rejected.
2. **Measure:** a checker pipeline reads Sentinel-2 imagery from Microsoft Planetary Computer and removes clouds and shadows using the Scene Classification Layer. It builds a median composite for each dry season and classifies every 10 m pixel as forest or not forest. The classifier is trained on ESA WorldCover labels and uses spectral bands, vegetation indices and canopy texture. Intact-forest accounting means cleared land that turns into green pasture isn't counted as forest again.
3. **Check the threat claim:** the same measurement runs on a nearby reference area. If the developer claims more than twice the deforestation rate the reference area actually shows, the project is flagged **Overcredited**. That's an indicator for review, not an accusation of fraud.
4. **Agree on-chain:** three checkers submit `(project, year, forest cover, reference loss, evidence hash)`. The contract accepts a value only when two agree within 1 percentage point, ignores outliers, and rejects stale or duplicate reports.
5. **Enforce:** forest remaining versus baseline: ≥ 95% **Healthy**, 85–95% **At Risk** (tradable, with a warning), < 85% **Frozen**.
6. **Show:** a public dashboard has a satellite map of the projects, a before/after imagery slider with red forest-loss overlays, forest-cover history, the threat check, every checker vote with transaction hashes, and the blocked transfer and retire attempts.

## How we built it
- **Satellite pipeline (Node.js):** STAC search and signed public Cloud-Optimized GeoTIFFs from Microsoft Planetary Computer. Only small windows are read, using HTTP range requests (`geotiff`, `proj4`). The pipeline does SCL cloud masking, multi-date median compositing, and handles the Sentinel-2 processing-baseline offset change in 2022.
- **ML classifier:** logistic regression on 6 Sentinel-2 bands plus NDVI, NDMI, NBR and NDVI canopy texture. It's trained on ESA WorldCover 2021 tree-cover labels with a seeded 70/30 split, so every checker reproduces the same model. A 5×5 majority filter and intact-forest accounting reduce noise.
- **Evidence:** each project gets a JSON evidence file with grids, scenes, model weights and yearly measurements. Its SHA-256 hash goes on-chain.
- **Smart contract (Solidity 0.8.28, OpenZeppelin ERC-1155, Hardhat):** project registry, a checker oracle with quorum and tolerance, status rules, frozen-credit enforcement in `_update`, and burn-on-retire with retirement records. There are 11 automated tests.
- **Replay script:** deploys the contract and runs the full lifecycle using the real measurements: registration, issuance, a sale, a retirement, yearly checks including a deliberately faulty checker, and blocked actions on frozen credits. The results are exported for the dashboard.
- **Dashboard:** Vite + React + Leaflet with Esri World Imagery, hand-built SVG charts and a before/after comparison slider.

## Target users
- **Carbon credit buyers** (companies, funds and marketplaces) who need evidence that their offsets are real before they buy them and while they hold them.
- **Registries and marketplaces** that want credit status to update automatically instead of relying on manual reviews every few years.
- **Auditors, NGOs and researchers** who can run the same open checker on the same public data.
- **Policymakers** tracking Article 6 and COP 31 commitments, who need transparent forest-credit data.

## Scalability and adoption
- **Global, free data:** Sentinel-2 covers every forest on Earth every 5 days at 10 m resolution, at no cost. The pipeline reads only the pixels it needs, so checking one project takes about a minute on a laptop.
- **No new infrastructure for buyers:** credits are standard ERC-1155 tokens. Any wallet or marketplace that supports ERC-1155 inherits the frozen-credit rule automatically.
- **Open checker network:** anyone can run the checker and reproduce a result. Universities and NGOs can join as checkers, with quorum and tolerance set by governance.
- **Easy integration:** existing registries can keep their methodologies and use CanopyCheck as a continuous monitoring layer that publishes a status per project.

## Challenges
- Tropical cloud cover: we rank scenes by how clear our window is, not by tile-wide cloud cover, and composite several dates.
- Telling green pasture from forest: single-date spectra confuse them. We added a canopy-texture feature, a majority filter and intact-forest accounting.
- Sentinel-2's 2022 processing-baseline change adds a +1000 offset to newer data. Without correcting it, results across years wouldn't be comparable.

## What's next
Sentinel-1 radar for persistently cloudy regions · NASA GEDI lidar to turn forest area into carbon estimates · validation against Hansen/UMD Global Forest Change · real polygon boundaries with spatial-overlap checks · IPFS-pinned evidence · reserve-credit buffers for natural disturbances · an open checker network of universities and NGOs · public testnet and then mainnet deployment.

## Honest scope
The three demo projects are fictional names on illustrative 3 × 3 km boxes over **real** Sentinel-2 imagery. They aren't registered carbon projects. The contract runs on a local Hardhat chain in the demo. Checker C is deliberately faulty to show the quorum working.

## Built with
JavaScript · Node.js · Solidity · OpenZeppelin · Hardhat · ethers.js · Sentinel-2 · Microsoft Planetary Computer · ESA WorldCover · geotiff.js · proj4 · React · Vite · Leaflet

---

# Demo video script (about 4 minutes)

1. **Problem (0:00–0:30).** "Companies buy forest carbon credits to offset emissions. Investigations found many of them didn't represent real reductions. Forests were cleared after the credits were sold, or the threat was exaggerated. Buyers can't check, and the credit keeps trading." Show the landing page: the 2019/2026 satellite split and the key figures. Then click "Open the monitoring dashboard".
2. **Map (0:30–0:55).** Show the three projects on satellite imagery: two in Rondônia, Brazil and one in Kalimantan, Indonesia. Point out the status colours and the dashed reference areas.
3. **Satellite evidence (0:55–1:50).** Open the Frozen/At Risk project. Drag the before/after slider from 2019 to 2025 and turn on the loss overlay to show the clearings in red. Show the forest-cover chart crossing the thresholds. Read the plain-language summary.
4. **How it's measured (1:50–2:20).** Show the terminal running `npm run satellite`, which prints scenes, clear percentages and classifier accuracy. Mention the ESA WorldCover labels, cloud masking, canopy texture and that regrowth isn't credited.
5. **On-chain verification (2:20–3:05).** Show the terminal running `npm test` (11 passing) and `npm run checks`. On the dashboard, show the three checker submissions for each year: A and B agree, faulty checker C is ignored, and the status changes.
6. **Enforcement and double counting (3:05–3:35).** Show the blocked transfer and blocked retire attempts on the Frozen project with their revert reasons, and the rejected duplicate registration.
7. **Threat check (3:35–3:55).** Open the Kalimantan project: it's Healthy, but the developer claimed a 2.5%/yr threat while the reference area lost 0%. It's flagged Overcredited, as an indicator for review, not proof of fraud.
8. **Close (3:55–4:15).** "Public satellite data, reproducible checks and on-chain enforcement. If the forest disappears, the credit freezes." Show the repo link.
