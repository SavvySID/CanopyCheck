import { effectiveStatus, fmt, pct } from '../util.js';
import { OvercreditedFlag, StatusChip } from '../ui.jsx';

export default function ProjectList({ projects, chain, selectedId, onSelect }) {
  return (
    <div className="project-list" role="list">
      {projects.map((p) => {
        const chainProject = chain?.projects?.[p.id];
        const status = effectiveStatus(p, chainProject);
        const overcredited = chainProject?.overcredited ?? p.summary?.overcredited;
        return (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className={`project-card${p.id === selectedId ? ' is-selected' : ''}`}
            onClick={() => onSelect(p.id)}
            aria-pressed={p.id === selectedId}
          >
            <div className="pc-top">
              <span className="pc-name">{p.name}</span>
              <StatusChip status={status} small />
            </div>
            <div className="pc-meta">
              {p.region}, {p.country} · {p.continent}
            </div>
            <div className="pc-stats">
              <span>{fmt(p.areaHa)} ha</span>
              <span>{pct(p.summary?.remainingPct)} of baseline forest</span>
              {chainProject?.checks?.length > 0 && <span>last check {chainProject.checks[chainProject.checks.length - 1].period}</span>}
              {overcredited && <OvercreditedFlag small project={p} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
