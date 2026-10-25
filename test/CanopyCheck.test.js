const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const Status = { Unverified: 0n, Healthy: 1n, AtRisk: 2n, Frozen: 3n };
const EVIDENCE = ethers.id("evidence-v1");
const BOUNDARY = ethers.id("boundary-1");

async function deploy() {
  const [owner, developer, buyer, a, b, c, outsider] = await ethers.getSigners();
  const CanopyCheck = await ethers.getContractFactory("CanopyCheck");
  const canopy = await CanopyCheck.deploy([a.address, b.address, c.address], 2, 100);
  // Baseline: 90.00% forest in 2019, developer claims a 2%/yr threat.
  await canopy.registerProject("Demo Forest", developer.address, BOUNDARY, "ipfs://meta", 2019, 9000, 200);
  await canopy.issueCredits(1, 1000);
  return { canopy, owner, developer, buyer, a, b, c, outsider };
}

describe("CanopyCheck", function () {
  describe("registry", function () {
    it("registers a project as Healthy and mints credits to the developer", async function () {
      const { canopy, developer } = await loadFixture(deploy);
      const p = await canopy.projects(1);
      expect(p.status).to.equal(Status.Healthy);
      expect(p.baselineCoverBps).to.equal(9000);
      expect(await canopy.balanceOf(developer.address, 1)).to.equal(1000);
    });

    it("rejects registering the same boundary twice (no double issuance)", async function () {
      const { canopy, developer } = await loadFixture(deploy);
      await expect(canopy.registerProject("Copy", developer.address, BOUNDARY, "", 2019, 9000, 200))
        .to.be.revertedWithCustomError(canopy, "BoundaryAlreadyRegistered").withArgs(1);
    });

    it("only lets the owner register and issue", async function () {
      const { canopy, outsider, developer } = await loadFixture(deploy);
      await expect(canopy.connect(outsider).registerProject("X", developer.address, ethers.id("b2"), "", 2019, 9000, 0))
        .to.be.revertedWithCustomError(canopy, "OwnableUnauthorizedAccount");
      await expect(canopy.connect(outsider).issueCredits(1, 1)).to.be.revertedWithCustomError(canopy, "OwnableUnauthorizedAccount");
    });
  });

  describe("checker oracle", function () {
    it("needs two agreeing checkers before a result is accepted", async function () {
      const { canopy, a, b } = await loadFixture(deploy);
      await canopy.connect(a).submitReport(1, 2021, 8000, 300, EVIDENCE);
      expect((await canopy.projects(1)).lastPeriod).to.equal(2019);
      await expect(canopy.connect(b).submitReport(1, 2021, 8050, 300, EVIDENCE))
        .to.emit(canopy, "CheckAccepted")
        .withArgs(1, 2021, 8000, 8888, Status.AtRisk, false, EVIDENCE);
    });

    it("ignores an outlier and accepts the two checkers that agree", async function () {
      const { canopy, a, b, c } = await loadFixture(deploy);
      await canopy.connect(c).submitReport(1, 2021, 9000, 300, EVIDENCE); // faulty checker claims no loss
      await canopy.connect(a).submitReport(1, 2021, 7000, 300, EVIDENCE);
      expect((await canopy.projects(1)).lastPeriod).to.equal(2019);
      await canopy.connect(b).submitReport(1, 2021, 7000, 300, EVIDENCE);
      const p = await canopy.projects(1);
      expect(p.lastCoverBps).to.equal(7000);
      expect(p.status).to.equal(Status.Frozen);
    });

    it("maps remaining forest to Healthy / At Risk / Frozen", async function () {
      const { canopy, a, b } = await loadFixture(deploy);
      const check = async (period, cover) => {
        await canopy.connect(a).submitReport(1, period, cover, 300, EVIDENCE);
        await canopy.connect(b).submitReport(1, period, cover, 300, EVIDENCE);
        return (await canopy.projects(1)).status;
      };
      expect(await check(2021, 8600)).to.equal(Status.Healthy); // 95.5% of baseline
      expect(await check(2022, 8000)).to.equal(Status.AtRisk); // 88.9%
      expect(await check(2023, 7600)).to.equal(Status.Frozen); // 84.4%
      expect(await check(2024, 8700)).to.equal(Status.Healthy); // regrowth unfreezes
    });

    it("flags overcredited when the claimed threat exceeds twice the reference loss", async function () {
      const { canopy, a, b } = await loadFixture(deploy);
      await canopy.connect(a).submitReport(1, 2021, 9000, 50, EVIDENCE);
      await canopy.connect(b).submitReport(1, 2021, 9000, 50, EVIDENCE);
      expect((await canopy.projects(1)).overcredited).to.equal(true);
    });

    it("blocks outsiders, double reports and stale periods", async function () {
      const { canopy, a, b, outsider } = await loadFixture(deploy);
      await expect(canopy.connect(outsider).submitReport(1, 2021, 9000, 0, EVIDENCE))
        .to.be.revertedWithCustomError(canopy, "NotChecker");
      await canopy.connect(a).submitReport(1, 2021, 9000, 0, EVIDENCE);
      await expect(canopy.connect(a).submitReport(1, 2021, 9000, 0, EVIDENCE))
        .to.be.revertedWithCustomError(canopy, "AlreadyReported");
      await canopy.connect(b).submitReport(1, 2021, 9000, 0, EVIDENCE);
      await expect(canopy.connect(a).submitReport(1, 2021, 9000, 0, EVIDENCE))
        .to.be.revertedWithCustomError(canopy, "StalePeriod");
      await expect(canopy.connect(a).submitReport(1, 2018, 9000, 0, EVIDENCE))
        .to.be.revertedWithCustomError(canopy, "StalePeriod");
    });
  });

  describe("status-aware credits", function () {
    async function freeze(canopy, a, b) {
      await canopy.connect(a).submitReport(1, 2025, 6000, 300, EVIDENCE);
      await canopy.connect(b).submitReport(1, 2025, 6000, 300, EVIDENCE);
    }

    it("retires credits by burning them and recording the beneficiary", async function () {
      const { canopy, developer, buyer } = await loadFixture(deploy);
      await canopy.connect(developer).safeTransferFrom(developer.address, buyer.address, 1, 100, "0x");
      await expect(canopy.connect(buyer).retire(1, 40, "Acme Corp 2026 footprint"))
        .to.emit(canopy, "Retired").withArgs(0, 1, buyer.address, 40, "Acme Corp 2026 footprint");
      expect(await canopy.balanceOf(buyer.address, 1)).to.equal(60);
      expect((await canopy.projects(1)).retired).to.equal(40);
      await expect(canopy.connect(buyer).retire(1, 61, "again")).to.be.revertedWithCustomError(canopy, "ERC1155InsufficientBalance");
    });

    it("blocks transfers, retirement and new issuance while Frozen", async function () {
      const { canopy, developer, buyer, a, b } = await loadFixture(deploy);
      await freeze(canopy, a, b);
      await expect(canopy.connect(developer).safeTransferFrom(developer.address, buyer.address, 1, 1, "0x"))
        .to.be.revertedWithCustomError(canopy, "ProjectFrozen").withArgs(1);
      await expect(canopy.connect(developer).retire(1, 1, "x")).to.be.revertedWithCustomError(canopy, "ProjectFrozen");
      await expect(canopy.issueCredits(1, 1)).to.be.revertedWithCustomError(canopy, "ProjectFrozen");
    });

    it("keeps At Risk credits tradable", async function () {
      const { canopy, developer, buyer, a, b } = await loadFixture(deploy);
      await canopy.connect(a).submitReport(1, 2023, 8000, 300, EVIDENCE);
      await canopy.connect(b).submitReport(1, 2023, 8000, 300, EVIDENCE);
      expect((await canopy.projects(1)).status).to.equal(Status.AtRisk);
      await canopy.connect(developer).safeTransferFrom(developer.address, buyer.address, 1, 5, "0x");
      expect(await canopy.balanceOf(buyer.address, 1)).to.equal(5);
    });
  });
});
