// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CanopyCheck
/// @notice Forest carbon credits whose tradability follows independent satellite checks.
///         One ERC-1155 token id per project. Registered checkers submit forest-cover
///         measurements; when `quorum` of them agree within `toleranceBps`, the result is
///         accepted and the project status is recomputed. Frozen credits cannot move or be
///         retired. Retirement burns the credit, so a retired tonne can never be resold.
contract CanopyCheck is ERC1155, Ownable {
    enum Status {
        Unverified,
        Healthy,
        AtRisk,
        Frozen
    }

    struct Project {
        string name;
        address developer;
        bytes32 boundaryHash; // hash of the canonical project boundary
        string metadataURI;
        uint16 baselineYear;
        uint16 baselineCoverBps; // forest share of the boundary at baseline, in basis points
        uint16 claimedThreatBps; // developer's claimed annual deforestation threat
        uint16 lastPeriod;
        uint16 lastCoverBps;
        uint16 lastRefLossBps; // observed annual forest loss in the reference area
        Status status;
        bool overcredited;
        uint256 issued;
        uint256 retired;
    }

    struct Report {
        address checker;
        uint16 coverBps;
        uint16 refLossBps;
        bytes32 evidenceHash;
    }

    struct Retirement {
        uint256 projectId;
        address holder;
        uint256 amount;
        string beneficiary;
        uint64 timestamp;
    }

    /// Forest remaining versus baseline: >= 95% Healthy, >= 85% At Risk, below that Frozen.
    uint16 public constant HEALTHY_BPS = 9500;
    uint16 public constant AT_RISK_BPS = 8500;

    uint8 public immutable quorum;
    uint16 public immutable toleranceBps;

    uint256 public projectCount;
    mapping(uint256 => Project) public projects;
    mapping(bytes32 => uint256) public projectByBoundary;
    mapping(address => bool) public isChecker;
    mapping(uint256 => mapping(uint16 => Report[])) private _reports;
    mapping(uint256 => mapping(uint16 => mapping(address => bool))) public hasReported;
    Retirement[] public retirements;

    event CheckerSet(address indexed checker, bool enabled);
    event ProjectRegistered(uint256 indexed id, string name, address indexed developer, bytes32 boundaryHash, uint16 baselineCoverBps, uint16 claimedThreatBps);
    event CreditsIssued(uint256 indexed id, address indexed to, uint256 amount);
    event ReportSubmitted(uint256 indexed id, uint16 indexed period, address indexed checker, uint16 coverBps, uint16 refLossBps, bytes32 evidenceHash);
    event CheckAccepted(uint256 indexed id, uint16 indexed period, uint16 coverBps, uint16 remainingBps, Status status, bool overcredited, bytes32 evidenceHash);
    event StatusChanged(uint256 indexed id, Status from, Status to);
    event Retired(uint256 indexed retirementId, uint256 indexed id, address indexed holder, uint256 amount, string beneficiary);

    error UnknownProject(uint256 id);
    error BoundaryAlreadyRegistered(uint256 existingId);
    error InvalidValue();
    error NotChecker(address account);
    error StalePeriod(uint16 period, uint16 lastPeriod);
    error AlreadyReported(address checker, uint16 period);
    error ProjectFrozen(uint256 id);

    constructor(address[] memory checkers, uint8 quorum_, uint16 toleranceBps_) ERC1155("") Ownable(msg.sender) {
        if (quorum_ < 2 || quorum_ > checkers.length) revert InvalidValue();
        quorum = quorum_;
        toleranceBps = toleranceBps_;
        for (uint256 i = 0; i < checkers.length; i++) {
            isChecker[checkers[i]] = true;
            emit CheckerSet(checkers[i], true);
        }
    }

    // ---------------------------------------------------------------- registry

    function setChecker(address checker, bool enabled) external onlyOwner {
        isChecker[checker] = enabled;
        emit CheckerSet(checker, enabled);
    }

    function registerProject(
        string calldata name,
        address developer,
        bytes32 boundaryHash,
        string calldata metadataURI,
        uint16 baselineYear,
        uint16 baselineCoverBps,
        uint16 claimedThreatBps
    ) external onlyOwner returns (uint256 id) {
        if (developer == address(0) || boundaryHash == bytes32(0) || baselineCoverBps == 0 || baselineCoverBps > 10_000) {
            revert InvalidValue();
        }
        uint256 existing = projectByBoundary[boundaryHash];
        if (existing != 0) revert BoundaryAlreadyRegistered(existing);

        id = ++projectCount;
        projectByBoundary[boundaryHash] = id;
        Project storage p = projects[id];
        p.name = name;
        p.developer = developer;
        p.boundaryHash = boundaryHash;
        p.metadataURI = metadataURI;
        p.baselineYear = baselineYear;
        p.baselineCoverBps = baselineCoverBps;
        p.claimedThreatBps = claimedThreatBps;
        p.lastPeriod = baselineYear;
        p.lastCoverBps = baselineCoverBps;
        p.status = Status.Healthy;
        emit ProjectRegistered(id, name, developer, boundaryHash, baselineCoverBps, claimedThreatBps);
    }

    function issueCredits(uint256 id, uint256 amount) external onlyOwner {
        Project storage p = _project(id);
        if (p.status == Status.Frozen) revert ProjectFrozen(id);
        p.issued += amount;
        _mint(p.developer, id, amount, "");
        emit CreditsIssued(id, p.developer, amount);
    }

    // ---------------------------------------------------------------- checker oracle

    /// @notice Submit a measurement for `period` (the observation year). Accepted once
    ///         `quorum` checkers agree within `toleranceBps` on both values.
    function submitReport(uint256 id, uint16 period, uint16 coverBps, uint16 refLossBps, bytes32 evidenceHash) external {
        if (!isChecker[msg.sender]) revert NotChecker(msg.sender);
        Project storage p = _project(id);
        if (period <= p.lastPeriod) revert StalePeriod(period, p.lastPeriod);
        if (hasReported[id][period][msg.sender]) revert AlreadyReported(msg.sender, period);
        if (coverBps > 10_000 || evidenceHash == bytes32(0)) revert InvalidValue();

        hasReported[id][period][msg.sender] = true;
        Report[] storage reports = _reports[id][period];
        reports.push(Report(msg.sender, coverBps, refLossBps, evidenceHash));
        emit ReportSubmitted(id, period, msg.sender, coverBps, refLossBps, evidenceHash);

        // Count reports that agree with this one; accept the most conservative values.
        uint256 agreeing;
        uint16 minCover = coverBps;
        uint16 minRefLoss = refLossBps;
        for (uint256 i = 0; i < reports.length; i++) {
            Report storage r = reports[i];
            if (_within(r.coverBps, coverBps) && _within(r.refLossBps, refLossBps)) {
                agreeing++;
                if (r.coverBps < minCover) minCover = r.coverBps;
                if (r.refLossBps < minRefLoss) minRefLoss = r.refLossBps;
            }
        }
        if (agreeing >= quorum) _accept(id, p, period, minCover, minRefLoss, evidenceHash);
    }

    function _accept(uint256 id, Project storage p, uint16 period, uint16 coverBps, uint16 refLossBps, bytes32 evidenceHash) private {
        uint16 remaining = uint16((uint256(coverBps) * 10_000) / p.baselineCoverBps);
        if (remaining > 10_000) remaining = 10_000;
        Status next = remaining >= HEALTHY_BPS ? Status.Healthy : remaining >= AT_RISK_BPS ? Status.AtRisk : Status.Frozen;
        // A claimed threat more than twice the observed reference-area loss is flagged for review.
        bool overcredited = uint256(p.claimedThreatBps) > 2 * uint256(refLossBps);

        Status prev = p.status;
        p.lastPeriod = period;
        p.lastCoverBps = coverBps;
        p.lastRefLossBps = refLossBps;
        p.status = next;
        p.overcredited = overcredited;
        emit CheckAccepted(id, period, coverBps, remaining, next, overcredited, evidenceHash);
        if (prev != next) emit StatusChanged(id, prev, next);
    }

    // ---------------------------------------------------------------- credits

    /// @notice Permanently retire credits on behalf of `beneficiary`. Burns them.
    function retire(uint256 id, uint256 amount, string calldata beneficiary) external returns (uint256 retirementId) {
        Project storage p = _project(id);
        if (p.status == Status.Frozen) revert ProjectFrozen(id);
        _burn(msg.sender, id, amount);
        p.retired += amount;
        retirementId = retirements.length;
        retirements.push(Retirement(id, msg.sender, amount, beneficiary, uint64(block.timestamp)));
        emit Retired(retirementId, id, msg.sender, amount, beneficiary);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                if (projects[ids[i]].status == Status.Frozen) revert ProjectFrozen(ids[i]);
            }
        }
        super._update(from, to, ids, values);
    }

    // ---------------------------------------------------------------- views

    function reportsFor(uint256 id, uint16 period) external view returns (Report[] memory) {
        return _reports[id][period];
    }

    function remainingBps(uint256 id) external view returns (uint16) {
        Project storage p = _project(id);
        return uint16((uint256(p.lastCoverBps) * 10_000) / p.baselineCoverBps);
    }

    function retirementCount() external view returns (uint256) {
        return retirements.length;
    }

    function uri(uint256 id) public view override returns (string memory) {
        return projects[id].metadataURI;
    }

    function _project(uint256 id) private view returns (Project storage p) {
        p = projects[id];
        if (p.developer == address(0)) revert UnknownProject(id);
    }

    function _within(uint16 a, uint16 b) private view returns (bool) {
        return (a > b ? a - b : b - a) <= toleranceBps;
    }
}
