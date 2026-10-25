import { effectiveStatus, fmt, pct, short, statusClass, statusFor } from '../util.js';
import { Card, InfoTip, OvercreditedFlag, StatusChip } from '../ui.jsx';
import CompareSlider from './CompareSlider.jsx';
import HistoryChart from './HistoryChart.jsx';

const PROTOTYPE_NOTE =
  'Status thresholds are prototype policies used for this demonstration. They are not a universal carbon-market standard or an official carbon-credit certification methodology.';

const STATUS_EFFECT = {
  Healthy: 'Credits can be transferred and retired normally.',
  'At Risk': 'Credits stay tradable, with a warning shown to buyers.',
  Frozen:
    'Transfers, retirement and new issuance are blocked on-chain while the project is Frozen. This pipeline does not credit regrowth back, so the freeze stays unless the measurement is corrected or the loss is compensated.',
};

function Metric({ label, value, unit, context, source, tone }) {
  return (
    <div className="metric">
      <dt className="metric-label">{label}</dt>
      <dd className={`metric-value${tone ? ` ${tone}` : ''}`}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </dd>
      {context && <dd className="metric-context">{context}</dd>}
      {source && <dd className="metric-source">{source}</dd>}
    </div>
  );
}

// Where the project sits on the prototype status scale, and why.
function StatusRule({ remaining, status, thresholds, baselineYear }) {
  const { healthyPct: h, atRiskPct: a } = thresholds;
  const lo = Math.min(60, Math.floor((remaining ?? 60) - 5));
  const pos = (v) => ((Math.min(100, Math.max(lo, v)) - lo) / (100 - lo)) * 100;
  let reason = 'No accepted measurement yet.';
  if (remaining != null) {
    const base = `${pct(remaining)} of the ${baselineYear} baseline forest remains,`;
    reason =
      remaining >= h ? `${base} at or above the ${h}% threshold.` : remaining >= a ? `${base} between ${a}% and ${h}%.` : `${base} below the ${a}% freeze threshold.`;
  }
  return (
    <div className="status-rule">
      <p className="sr-text">
        <span className="sr-why">Why {status}:</span> {reason} {STATUS_EFFECT[status] ?? ''}{' '}
        <InfoTip label="About these status thresholds" triggerClassName="tip-icon" trigger={<span aria-hidden="true">i</span>}>
          <strong className="tip-title">Prototype policy</strong>
          <span>{PROTOTYPE_NOTE}</span>
        </InfoTip>
      </p>
      <div
        className="sr-scale"
        role="img"
        aria-label={`Status scale: below ${a}% of baseline Frozen, ${a} to ${h}% At Risk, ${h}% and above Healthy. This project: ${pct(remaining)}.`}
      >
        <span className="sr-zone zone-frozen" style={{ width: `${pos(a)}%` }}>Frozen</span>
        <span className="sr-zone zone-risk" style={{ width: `${pos(h) - pos(a)}%` }}>At Risk</span>
        <span className="sr-zone zone-healthy" style={{ width: `${100 - pos(h)}%` }}>Healthy</span>
        {remaining != null && <span className="sr-marker" style={{ left: `${pos(remaining)}%` }} />}
      </div>
      <div className="sr-ticks" aria-hidden="true">
        <span className="sr-tick sr-tick-start" style={{ left: '0%' }}>{lo}%</span>
        <span className="sr-tick" style={{ left: `${pos(a)}%` }}>{a}%</span>
        <span className="sr-tick" style={{ left: `${pos(h)}%` }}>{h}%</span>
        <span className="sr-tick sr-tick-end" style={{ left: '100%' }}>100%</span>
      </div>
    </div>
  );
}

function ThreatCard({ project, overcredited }) {
  const s = project.summary;
  const claimed = project.claimedThreatPctPerYear;
  const ref = s.refAnnualLossPct;
  const observed = s.projectAnnualLossPct;
  const max = Math.max(claimed, ref, observed, 0.1);
  const ratio = ref > 0 ? claimed / ref : null;
  const rows = [
    { label: 'Claimed threat', source: 'Developer claim', value: claimed, cls: 'bar-claimed' },
    { label: 'Reference-area loss', source: 'Model estimate', value: ref, cls: 'bar-ref' },
    { label: 'Project-area loss', source: 'Model estimate', value: observed, cls: 'bar-project' },
  ];
  return (
    <Card
      kicker="Threat check"
      title="Claimed threat vs observed reference-area loss"
      actions={overcredited ? <OvercreditedFlag project={project} interactive /> : null}
    >
      <div className="bars">
        {rows.map((r) => (
          <div key={r.label} className="bar-row">
            <div className="bar-label">
              <span>
                {r.label} <span className="metric-source">{r.source}</span>
              </span>
              <strong>{fmt(r.value, 2)} %/yr</strong>
            </div>
            <div className="bar-track">
              <div className={`bar-fill ${r.cls}`} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {overcredited ? (
        <p className="note note-flag">
          The claimed threat is {ratio ? `about ${fmt(ratio, ratio >= 10 ? 0 : 1)}×` : 'far above'} the loss observed in comparable nearby forest
          (flag rule: more than 2×), so the number of credits issued may be overstated. This is a warning for further investigation, not proof of
          fraud.
        </p>
      ) : (
        <p className="note">
          The flag is raised only when the claimed threat exceeds twice the reference-area loss. Here the claim ({fmt(claimed, 2)} %/yr) is below
          2 × {fmt(ref, 2)} = {fmt(2 * ref, 2)} %/yr ({s.baselineYear}–{s.latestYear} average), so no overcredited flag is raised.
        </p>
      )}
    </Card>
  );
}

export default function ProjectPanel({ project, chainProject, thresholds, classifier }) {
  const s = project.summary;
  const status = effectiveStatus(project, chainProject);
  const overcredited = chainProject?.overcredited ?? s.overcredited;
  const remainingTone = statusClass(statusFor(s.remainingPct, thresholds));
  const change = s.latestForestHa - s.baselineForestHa;
  const changeText = `${change < 0 ? '−' : '+'}${fmt(Math.abs(change), 1)} ha`;

  return (
    <>
      <Card className="project-head-card">
        <div className="ph">
          <div className="ph-main">
            <div className="kicker">{project.region}, {project.country} · {project.continent}</div>
            <h2 className="ph-title">{project.name}</h2>
            <p className="ph-meta">
              {fmt(project.areaHa)} ha boundary · baseline {s.baselineYear} · latest observation {s.latestYear} · Sentinel-2 dry-season composites
            </p>
          </div>
          <div className="ph-chips">
            <StatusChip status={status} />
            {overcredited && <OvercreditedFlag project={project} interactive />}
          </div>
        </div>
        <dl className="metrics">
          <Metric label="Forest remaining" value={pct(s.remainingPct)} context={`of the ${s.baselineYear} baseline forest`} source="Model estimate" tone={remainingTone} />
          <Metric
            label={`Forest area, ${s.latestYear}`}
            value={fmt(s.latestForestHa, 1)}
            unit="ha"
            context={`${fmt(s.baselineForestHa, 1)} ha in ${s.baselineYear} (${changeText})`}
            source="Model estimate"
          />
          <Metric label="Project-area loss" value={fmt(s.projectAnnualLossPct, 2)} unit="%/yr" context={`average ${s.baselineYear}–${s.latestYear}`} source="Model estimate" />
          <Metric
            label="Reference-area loss"
            value={fmt(s.refAnnualLossPct, 2)}
            unit="%/yr"
            context={`developer claimed ${fmt(project.claimedThreatPctPerYear, 1)} %/yr`}
            source="Estimate vs claim"
          />
        </dl>
        <StatusRule remaining={s.remainingPct} status={status} thresholds={thresholds} baselineYear={s.baselineYear} />
      </Card>

      <Card kicker="What changed" title="Summary of the satellite evidence">
        <p className="summary-text">{project.plainSummary}</p>
        <div className="summary-foot">
          <span className="muted">Generated from the measured values above. It describes land-cover change, not its cause.</span>
          {project.evidence ? (
            <a className="mono hash" href={project.evidence} target="_blank" rel="noreferrer" title={project.evidenceHash}>
              evidence.json · sha256 {short(project.evidenceHash, 10, 8)}
            </a>
          ) : (
            <span className="mono muted" title={project.evidenceHash}>evidence sha256 {short(project.evidenceHash, 10, 8)}</span>
          )}
        </div>
      </Card>

      <Card kicker="Satellite evidence" title="Before / after comparison">
        <CompareSlider project={project} classifier={classifier} />
      </Card>

      <Card kicker="Forest-cover history" title="Project vs reference area">
        <HistoryChart project={project} thresholds={thresholds} />
      </Card>

      <ThreatCard project={project} overcredited={overcredited} />
    </>
  );
}
