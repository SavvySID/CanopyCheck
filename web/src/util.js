export const STATUS_COLORS = {
  Healthy: '#3ddc84',
  'At Risk': '#f5b942',
  Frozen: '#ff6b6b',
  Unverified: '#8a9a91',
};

export function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const pct = (n, digits = 1) => (n == null ? '—' : `${fmt(n, digits)}%`);
export const bpsToPct = (bps, digits = 2) => (bps == null ? '—' : `${fmt(bps / 100, digits)}%`);

export function short(value, head = 6, tail = 4) {
  if (!value) return '—';
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function statusClass(status) {
  return `status-${(status || 'Unverified').toLowerCase().replace(/\s+/g, '-')}`;
}

// The on-chain status wins once checkers have verified the project.
export function effectiveStatus(project, chainProject) {
  if (chainProject?.status && chainProject.status !== 'Unverified') return chainProject.status;
  return project?.summary?.status ?? 'Unverified';
}

// Claimed threat vs observed reference-area loss, for the Overcredited explanation.
export function overcreditInfo(project) {
  const claimed = project?.claimedThreatPctPerYear;
  const observed = project?.summary?.refAnnualLossPct;
  if (claimed == null || observed == null) return null;
  const claimedText = `${fmt(claimed, 1)}%/year`;
  const observedText = `${fmt(observed, 2)}%/year`;
  return {
    claimedText,
    observedText,
    text: `Claimed deforestation threat: ${claimedText}. Observed reference-area loss: ${observedText}. This discrepancy flags a potentially overstated threat and requires further verification.`,
  };
}

// Header disclaimer that names the network the on-chain data actually came from.
export function demoDisclaimer(chain) {
  if (!chain) return 'Prototype · demo data · not real carbon credits';
  if (chain.chainId === 31337 || chain.network === 'hardhat' || chain.network === 'localhost') {
    return 'Prototype · local Hardhat demo · not real carbon credits';
  }
  return `Prototype · ${chain.network} (chain ${chain.chainId}) demo · not real carbon credits`;
}

export function statusFor(remainingPct, thresholds) {
  if (remainingPct == null) return 'Unverified';
  if (remainingPct >= thresholds.healthyPct) return 'Healthy';
  if (remainingPct >= thresholds.atRiskPct) return 'At Risk';
  return 'Frozen';
}

// Extent of the PNG evidence images; falls back to the union of project and reference boxes.
export function imageExtent(project) {
  if (project.imageBounds) return project.imageBounds;
  const b = project.boundary;
  const r = project.reference || project.boundary;
  return [
    [Math.min(b[0][0], r[0][0]), Math.min(b[0][1], r[0][1])],
    [Math.max(b[1][0], r[1][0]), Math.max(b[1][1], r[1][1])],
  ];
}

const EXPLORERS = {
  1: 'https://etherscan.io',
  137: 'https://polygonscan.com',
  80002: 'https://amoy.polygonscan.com',
  11155111: 'https://sepolia.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  421614: 'https://sepolia.arbiscan.io',
};

export function explorerUrl(chainId, kind, value) {
  const base = EXPLORERS[chainId];
  return base && value ? `${base}/${kind}/${value}` : null;
}
