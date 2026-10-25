import { useCallback, useEffect, useMemo, useState } from 'react';
import MapView from './components/MapView.jsx';
import ProjectList from './components/ProjectList.jsx';
import ProjectPanel from './components/ProjectPanel.jsx';
import ChainCard from './components/ChainCard.jsx';
import Methodology from './components/Methodology.jsx';
import { demoDisclaimer } from './util.js';
import { Logo } from './ui.jsx';

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chain, setChain] = useState(null);
  const [chainState, setChainState] = useState('loading');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    loadJson('data/projects.json')
      .then((d) => {
        setData(d);
        const fromHash = decodeURIComponent(window.location.hash.slice(1));
        const initial = d.projects?.find((p) => p.id === fromHash) ?? d.projects?.[0];
        setSelectedId(initial?.id ?? null);
      })
      .catch((e) => setError(e.message));
    loadJson('data/chain.json')
      .then((c) => {
        setChain(c);
        setChainState('ok');
      })
      .catch(() => setChainState('missing'));
  }, []);

  const select = useCallback((id) => {
    setSelectedId(id);
    if (window.history?.replaceState) window.history.replaceState(null, '', `#${id}`);
    // Single-column layout: bring the project details into view after a selection.
    if (window.matchMedia?.('(max-width: 980px)').matches) {
      requestAnimationFrame(() => document.getElementById('project-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, []);

  const projects = data?.projects ?? [];
  const project = useMemo(() => projects.find((p) => p.id === selectedId) ?? null, [projects, selectedId]);
  const chainProject = chain?.projects?.[selectedId] ?? null;
  const thresholds = data?.thresholds ?? { healthyPct: 95, atRiskPct: 85 };
  const latestYear = projects.length ? Math.max(...projects.map((p) => p.summary?.latestYear ?? 0)) : null;
  const duplicateRejections = Object.values(chain?.projects ?? {}).flatMap((p) => p.actions ?? []).filter((a) => a.type === 'DuplicateRegistrationBlocked' && a.revertReason).length;

  return (
    <div className="app">
      <header className="site-head">
        <a className="brand brand-link" href="./" title="CanopyCheck overview">
          <Logo />
          <div>
            <h1>CanopyCheck</h1>
            <p className="tagline">Satellite-verified carbon credits. If the forest disappears, the credit freezes.</p>
          </div>
        </a>
        <div className="head-meta">
          <span className="badge badge-track">Track: Carbon Markets &amp; Emissions Transparency</span>
          <span className="badge badge-honest">{demoDisclaimer(chain)}</span>
        </div>
      </header>

      {data && (
        <dl className="integrity" aria-label="Monitoring summary">
          <div><dt>Projects monitored</dt><dd>{projects.length}</dd></div>
          <div><dt>Latest imagery</dt><dd>{latestYear} dry season · Sentinel-2</dd></div>
          {chain && <div><dt>Checker quorum</dt><dd>{chain.quorum} of {chain.checkers?.length ?? 3}, ±{chain.toleranceBps / 100} pt</dd></div>}
          {chain && <div><dt>Duplicate-boundary check</dt><dd>{duplicateRejections} registration attempt{duplicateRejections === 1 ? '' : 's'} rejected</dd></div>}
        </dl>
      )}

      {(data?.mock || chain?.mock) && (
        <div className="notice">
          Showing placeholder demo data. Run the satellite pipeline and on-chain checks to replace it with measured results.
        </div>
      )}

      {error && (
        <div className="notice notice-error">
          Could not load project data ({error}). Generate it with <code>npm run satellite</code>.
        </div>
      )}

      {!data && !error && <div className="loading">Loading satellite evidence…</div>}

      {data && (
        <main className="layout">
          <section className="map-col">
            <div className="card map-card">
              <MapView projects={projects} chain={chain} selectedId={selectedId} onSelect={select} />
            </div>
            <ProjectList projects={projects} chain={chain} selectedId={selectedId} onSelect={select} />
          </section>

          <section className="detail-col" id="project-detail">
            {project ? (
              <>
                <ProjectPanel project={project} chainProject={chainProject} thresholds={thresholds} classifier={data.classifier} />
                <ChainCard chain={chain} chainState={chainState} project={project} chainProject={chainProject} />
              </>
            ) : (
              <div className="card empty">Select a project on the map.</div>
            )}
          </section>
        </main>
      )}

      {data && <Methodology data={data} chain={chain} />}
    </div>
  );
}
