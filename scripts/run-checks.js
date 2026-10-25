// Replays the CanopyCheck flow on a chain using the pipeline's measurements:
// deploy -> register projects -> issue/trade/retire credits -> three checkers submit
// each year's results (checker C is deliberately faulty) -> status updates -> blocked
// actions on frozen credits. Writes web/public/data/chain.json for the dashboard.
//
//   npx hardhat run scripts/run-checks.js                      (in-process Hardhat chain)
//   RPC_URL=… PRIVATE_KEY=… npx hardhat run scripts/run-checks.js --network testnet
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const DATA = path.resolve("web/public/data");
const STATUS = ["Unverified", "Healthy", "At Risk", "Frozen"];
const QUORUM = 2;
const TOLERANCE_BPS = 100; // checkers must agree within 1 percentage point
const FAULTY_OFFSET_BPS = 1500; // checker C reports 15 points more forest than measured

async function accounts() {
  const signers = await ethers.getSigners();
  if (signers.length >= 8) return signers;
  // Single funded key (testnet): create the other demo actors and fund them for gas.
  const [owner] = signers;
  const extra = Array.from({ length: 7 }, () => ethers.Wallet.createRandom().connect(ethers.provider));
  for (const w of extra) {
    await (await owner.sendTransaction({ to: w.address, value: ethers.parseEther(process.env.FUND_EACH ?? "0.02") })).wait();
  }
  return [owner, ...extra];
}

function revertReason(canopy, err) {
  const data = err?.data ?? err?.error?.data ?? err?.info?.error?.data;
  try {
    const parsed = canopy.interface.parseError(data);
    if (parsed) return `${parsed.name}(${parsed.args.map(String).join(", ")})`;
  } catch {}
  return err?.shortMessage ?? err?.message ?? String(err);
}

async function main() {
  const { projects } = JSON.parse(fs.readFileSync(path.join(DATA, "projects.json"), "utf8"));
  const [owner, devA, devB, devC, buyer, checkerA, checkerB, checkerC] = await accounts();
  const developers = [devA, devB, devC];
  const checkers = [
    { name: "Checker A (university lab)", signer: checkerA, faulty: false },
    { name: "Checker C (simulated faulty)", signer: checkerC, faulty: true },
    { name: "Checker B (NGO)", signer: checkerB, faulty: false },
  ];

  const CanopyCheck = await ethers.getContractFactory("CanopyCheck", owner);
  const canopy = await CanopyCheck.deploy([checkerA.address, checkerB.address, checkerC.address], QUORUM, TOLERANCE_BPS);
  await canopy.waitForDeployment();
  const deployTx = canopy.deploymentTransaction().hash;
  const address = await canopy.getAddress();
  console.log(`CanopyCheck deployed at ${address} on ${network.name}`);

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contract: address,
    deployTx,
    generatedAt: new Date().toISOString(),
    checkers: [
      { name: "Checker A (university lab)", address: checkerA.address },
      { name: "Checker B (NGO)", address: checkerB.address },
      { name: "Checker C (simulated faulty)", address: checkerC.address },
    ],
    quorum: QUORUM,
    toleranceBps: TOLERANCE_BPS,
    projects: {},
  };

  const send = async (txPromise) => (await txPromise).wait();
  const attempt = async (fn) => {
    try {
      const r = await (await fn()).wait();
      return { tx: r.hash, revertReason: null };
    } catch (err) {
      return { tx: null, revertReason: revertReason(canopy, err) };
    }
  };

  for (const [i, p] of projects.entries()) {
    const dev = developers[i % developers.length];
    const base = p.years[0];
    const boundaryHash = ethers.id(JSON.stringify(p.boundary));
    const baselineCoverBps = Math.round(base.forestPct * 100);
    const claimedThreatBps = Math.round(p.claimedThreatPctPerYear * 100);
    const reg = await send(canopy.registerProject(p.name, dev.address, boundaryHash, p.evidence, base.year, baselineCoverBps, claimedThreatBps));
    const onchainId = Number(await canopy.projectCount());
    const rec = { onchainId, registerTx: reg.hash, boundaryHash, baselineCoverBps, claimedThreatBps, checks: [], actions: [] };
    out.projects[p.id] = rec;

    const issued = await send(canopy.issueCredits(onchainId, 10_000));
    rec.actions.push({ type: "Issued", detail: `10,000 credits minted to the developer at registration (${base.year} baseline)`, tx: issued.hash, revertReason: null });
    const sold = await send(canopy.connect(dev).safeTransferFrom(dev.address, buyer.address, onchainId, 2_500, "0x"));
    rec.actions.push({ type: "Transfer", detail: "Developer sold 2,500 credits to a buyer while the project was Healthy", tx: sold.hash, revertReason: null });
    const retired = await send(canopy.connect(buyer).retire(onchainId, 500, "Demo buyer — 2025 operational emissions"));
    rec.actions.push({ type: "Retired", detail: "Buyer retired 500 credits (burned on-chain, cannot be resold)", tx: retired.hash, revertReason: null });

    // Yearly checks after the baseline.
    for (const y of p.years.slice(1)) {
      const coverBps = Math.round(y.forestPct * 100);
      const refLoss = (base.refForestPct - y.refForestPct) / base.refForestPct / (y.year - base.year);
      const refLossBps = Math.max(0, Math.round(refLoss * 10_000));
      const evidenceHash = ethers.id(`${p.evidenceHash}:${y.year}`);
      const check = { period: y.year, submissions: [], acceptedCoverBps: null, statusAfter: null, finalizeTx: null };
      for (const c of checkers) {
        const reported = c.faulty ? Math.min(10_000, coverBps + FAULTY_OFFSET_BPS) : coverBps;
        const r = await send(canopy.connect(c.signer).submitReport(onchainId, y.year, reported, refLossBps, evidenceHash));
        const accepted = r.logs.map((l) => { try { return canopy.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "CheckAccepted");
        check.submissions.push({ checker: c.signer.address, name: c.name, coverBps: reported, refLossBps, evidenceHash, tx: r.hash, block: r.blockNumber, outcome: c.faulty ? "outlier" : "agreed" });
        if (accepted) {
          check.acceptedCoverBps = Number(accepted.args.coverBps);
          check.statusAfter = STATUS[Number(accepted.args.status)];
          check.finalizeTx = r.hash;
        }
      }
      rec.checks.push(check);
      console.log(`  ${p.name} ${y.year}: cover ${coverBps} bps -> ${check.statusAfter}`);
    }

    const state = await canopy.projects(onchainId);
    rec.status = STATUS[Number(state.status)];
    rec.overcredited = state.overcredited;

    // What the buyer can do with the remaining 2,000 credits under the final status.
    const transfer = await attempt(() => canopy.connect(buyer).safeTransferFrom(buyer.address, dev.address, onchainId, 100, "0x"));
    const retire = await attempt(() => canopy.connect(buyer).retire(onchainId, 100, "Demo buyer — 2026 emissions"));
    if (rec.status === "Frozen") {
      rec.actions.push({ type: "TransferBlocked", detail: "Buyer tried to resell 100 Frozen credits — the contract rejected it", tx: transfer.tx, revertReason: transfer.revertReason });
      rec.actions.push({ type: "RetireBlocked", detail: "Buyer tried to retire 100 Frozen credits against its emissions — the contract rejected it", tx: retire.tx, revertReason: retire.revertReason });
    } else {
      rec.actions.push({ type: "Transfer", detail: `Buyer moved 100 credits while ${rec.status}${rec.status === "At Risk" ? " (allowed, with a warning)" : ""}`, tx: transfer.tx, revertReason: transfer.revertReason });
      rec.actions.push({ type: "Retired", detail: `Buyer retired 100 more credits while ${rec.status}`, tx: retire.tx, revertReason: retire.revertReason });
    }
    const after = await canopy.projects(onchainId);
    rec.issued = Number(after.issued);
    rec.retired = Number(after.retired);
    console.log(`${p.name}: ${rec.status}${rec.overcredited ? " + overcredited" : ""}`);
  }

  // Double issuance: registering the same land again is rejected.
  const first = projects[0];
  const dup = await attempt(() => canopy.registerProject(`${first.name} (copy)`, devB.address, ethers.id(JSON.stringify(first.boundary)), "", first.years[0].year, 9000, 200));
  out.projects[first.id].actions.push({ type: "DuplicateRegistrationBlocked", detail: "Someone tried to register the same forest boundary a second time to issue credits twice — rejected", tx: dup.tx, revertReason: dup.revertReason });

  fs.writeFileSync(path.join(DATA, "chain.json"), JSON.stringify(out, null, 2));
  console.log(`Wrote ${path.join(DATA, "chain.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
