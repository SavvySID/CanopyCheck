import { fmt, pct } from '../util.js';

const W = 640;
const H = 280;
const M = { l: 46, r: 18, t: 18, b: 36 };
const LOW_QUALITY = 60;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export default function HistoryChart({ project, thresholds }) {
  const years = project.years ?? [];
  if (!years.length) return null;

  const base = years[0].forestPct;
  const healthyLine = (base * thresholds.healthyPct) / 100;
  const freezeLine = (base * thresholds.atRiskPct) / 100;
  const values = years.flatMap((y) => [y.forestPct, y.refForestPct]).filter(finite).concat([freezeLine, base]);
  const yMin = Math.max(0, Math.floor((Math.min(...values) - 4) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((Math.max(...values) + 2) / 5) * 5);
  const span = yMax - yMin || 1;

  const x = (i) => (years.length === 1 ? (M.l + W - M.r) / 2 : M.l + (i * (W - M.l - M.r)) / (years.length - 1));
  const y = (v) => M.t + ((yMax - v) / span) * (H - M.t - M.b);
  const path = (key) =>
    years
      .map((yr, i) => (finite(yr[key]) ? `${x(i)},${y(yr[key])}` : null))
      .filter(Boolean)
      .map((pt, i) => `${i ? 'L' : 'M'}${pt}`)
      .join(' ');
  const step = span > 30 ? 10 : 5;
  const ticks = [];
  for (let v = yMin; v <= yMax; v += step) ticks.push(v);

  return (
    <div className="chart-block">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Forest cover history for the project and the reference area">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={M.l - 8} y={y(v) + 4} className="axis" textAnchor="end">{v}%</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={y(healthyLine)} y2={y(healthyLine)} className="th th-risk" />
        <text x={W - M.r} y={y(healthyLine) - 5} className="th-label th-risk-label" textAnchor="end">{thresholds.healthyPct}% of baseline · At Risk below</text>
        <line x1={M.l} x2={W - M.r} y1={y(freezeLine)} y2={y(freezeLine)} className="th th-freeze" />
        <text x={W - M.r} y={y(freezeLine) - 5} className="th-label th-freeze-label" textAnchor="end">{thresholds.atRiskPct}% of baseline · Frozen below</text>

        <path d={path('refForestPct')} className="line line-ref" />
        <path d={path('forestPct')} className="line line-project" />

        {years.map((yr, i) => {
          const low = yr.validPct < LOW_QUALITY;
          return (
            <g key={yr.year}>
              {finite(yr.refForestPct) && <circle cx={x(i)} cy={y(yr.refForestPct)} r="3.5" className="pt-ref" />}
              <circle cx={x(i)} cy={y(yr.forestPct)} r="5" className={low ? 'pt-project pt-low' : 'pt-project'}>
                <title>{`${yr.year}: ${pct(yr.forestPct)} forest, ${pct(yr.validPct, 0)} valid pixels${low ? ' (low quality)' : ''}`}</title>
              </circle>
              {low && <text x={x(i)} y={y(yr.forestPct) - 10} className="low-label" textAnchor="middle">low quality</text>}
              <text x={x(i)} y={H - 12} className="axis" textAnchor="middle">{yr.year}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="lg lg-project" /> Project forest cover</span>
        <span><i className="lg lg-ref-line" /> Reference area</span>
        <span><i className="lg lg-th" /> Status thresholds ({thresholds.healthyPct}% / {thresholds.atRiskPct}% of baseline, prototype policy)</span>
        <span><i className="lg lg-low" /> Fewer than {LOW_QUALITY}% clear pixels</span>
      </div>
      <p className="source-note">
        Estimated forest cover as a share of each {fmt(project.areaHa)} ha area, one dry-season composite per year (model estimate). Land cleared after
        the baseline is not counted as forest again if it greens up.
      </p>
      <details className="data-details">
        <summary>Yearly values ({years.length} observations)</summary>
      <div className="table-wrap">
        <table className="data-table rtable">
          <thead>
            <tr>
              <th>Year</th>
              <th>Forest cover (%)</th>
              <th>Forest area (ha)</th>
              <th>Reference forest (%)</th>
              <th>Clear pixels (%)</th>
            </tr>
          </thead>
          <tbody>
            {years.map((yr) => (
              <tr key={yr.year}>
                <td data-label="Year">{yr.year}</td>
                <td data-label="Forest cover (%)">{pct(yr.forestPct)}</td>
                <td data-label="Forest area (ha)">{fmt(yr.forestHa, 1)}</td>
                <td data-label="Reference forest (%)">{pct(yr.refForestPct)}</td>
                <td data-label="Clear pixels (%)">
                  {pct(yr.validPct, 0)}
                  {yr.validPct < LOW_QUALITY && <span className="lowq"> low quality</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
    </div>
  );
}
