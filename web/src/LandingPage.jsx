import { useEffect, useState } from 'react';
import { demoDisclaimer, effectiveStatus, fmt, pct } from './util.js';
import { Logo, StatusChip } from './ui.jsx';

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

const STEPS = [
  {
    title: 'Register',
    text: 'The registry records each project’s boundary, its baseline forest cover and the deforestation threat the developer claims. The same boundary cannot be registered twice, so the same forest cannot be credited twice.',
  },
  {
    title: 'Measure',
    text: 'Checkers build cloud-masked Sentinel-2 composites for every dry season and classify each 10 m pixel as forest or not. The same measurement runs on a nearby reference area to test the threat claim.',
  },
  {
    title: 'Agree',
    text: 'Three registered checkers submit their results to a smart contract. A result is accepted only when two of them agree within one percentage point; an outlier is ignored.',
  },
  {
    title: 'Enforce',
    text: 'Below 95% of the baseline forest a project is At Risk; below 85% its credits freeze and cannot be transferred, retired or newly issued. Retiring a credit burns it, so it cannot be claimed again.',
  },
];

const LIMITS = [
  'Satellite measurements show land-cover change. They are evidence for review, not field confirmation, and they do not show the cause.',
  'An Overcredited flag means the claimed threat is more than twice the loss observed nearby. It is a prompt for further investigation, not a finding of fraud.',
  'The 95% and 85% thresholds are prototype policies for this demonstration, not a carbon-market standard or certification methodology.',
  'The three demo projects are fictional names on illustrative 3 × 3 km boxes over real imagery. They are not registered carbon projects.',
  'In this demo the three checkers are local accounts driven by one replay script, and one is deliberately faulty. Real independence would need separate organisations running the checker.',
];

function HeroFigure({ project }) {
  if (!project) return <div className="lp-figure lp-figure-empty" aria-hidden="true" />;
  const first = project.years[0];
  const last = project.years[project.years.length - 1];
  return (
    <figure className="lp-figure">
      <div className="lp-split">
        <img src={first.rgb} alt={`Sentinel-2 true-colour composite of ${project.name}, ${first.year}`} />
        <div className="lp-split-after">
          <img src={last.rgb} alt={`Sentinel-2 true-colour composite of ${project.name}, ${last.year}`} />
          {last.loss && <img className="lp-loss" src={last.loss} alt="" />}
        </div>
        <span className="lp-split-tag lp-split-tag-left">{first.year}</span>
        <span className="lp-split-tag lp-split-tag-right">{last.year}</span>
      </div>
      <figcaption>
        <strong>{project.name}</strong> (demo) · {project.region}, {project.country}. Left: {first.year} dry season. Right: {last.year}, with forest
        cleared since {first.year} in red (model estimate, not field-confirmed). {pct(project.summary.remainingPct)} of the baseline forest remains.
      </figcaption>
    </figure>
  );
}

export default function Landing() {
  const [data, setData] = useState(null);
  const [chain, setChain] = useState(null);

  useEffect(() => {
    loadJson('data/projects.json').then(setData).catch(() => setData({ projects: [] }));
    loadJson('data/chain.json').then(setChain).catch(() => setChain(null));
  }, []);

  const projects = data?.projects ?? [];
  const statusOf = (p) => effectiveStatus(p, chain?.projects?.[p.id]);
  const featured = projects.find((p) => statusOf(p) === 'Frozen') ?? projects[0];
  const frozen = projects.filter((p) => statusOf(p) === 'Frozen').length;
  const flagged = projects.filter((p) => chain?.projects?.[p.id]?.overcredited ?? p.summary?.overcredited).length;
  const continents = new Set(projects.map((p) => p.continent)).size;
  const accuracy = data?.classifier?.accuracy;

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="brand lp-brand" href="./">
          <Logo />
          <span>CanopyCheck</span>
        </a>
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#projects">Projects</a>
          <a href="#limits">Limits</a>
        </nav>
        <a className="lp-btn lp-btn-small" href="app.html">Open dashboard</a>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <p className="kicker">Forest carbon credit verification</p>
            <h1>If the forest disappears, the credit freezes.</h1>
            <p className="lp-lead">
              CanopyCheck tests forest carbon credits against public Sentinel-2 satellite imagery. Independent checkers measure forest cover with an
              open model, a smart contract records each result, and credits from a project that has lost too much forest can no longer be sold or
              retired.
            </p>
            <div className="lp-actions">
              <a className="lp-btn" href="app.html">Open the monitoring dashboard</a>
              <a className="lp-link" href="#how">How it works</a>
            </div>
            <p className="lp-fine">{demoDisclaimer(chain)}. Demo projects use fictional names over real imagery.</p>
          </div>
          <HeroFigure project={featured} />
        </section>

        {data && projects.length > 0 && (
          <dl className="lp-facts" aria-label="Current demo results">
            <div><dt>Demo projects</dt><dd>{projects.length}</dd><dd className="lp-fact-note">on {continents} continent{continents === 1 ? '' : 's'}</dd></div>
            <div><dt>Projects frozen on-chain</dt><dd>{frozen}</dd><dd className="lp-fact-note">forest below 85% of baseline</dd></div>
            <div><dt>Flagged overcredited</dt><dd>{flagged}</dd><dd className="lp-fact-note">claim more than 2× reference-area loss</dd></div>
            {accuracy != null && (
              <div><dt>Classifier accuracy</dt><dd>{pct(accuracy * 100)}</dd><dd className="lp-fact-note">agreement with ESA WorldCover labels, random pixel hold-out</dd></div>
            )}
          </dl>
        )}

        <section className="lp-section">
          <h2>Credits keep trading after the forest is gone</h2>
          <div className="lp-cols">
            <p>
              A forest carbon credit is supposed to stand for forest that was protected. Once it is sold, it is rarely checked again, and nothing in
              the market reacts if the trees behind it are cleared or burned.
            </p>
            <p>
              Investigations in 2023 reported that many rainforest credits rested on overstated deforestation threats, which inflated how many credits
              a project could issue. Buyers had no simple way to test either problem themselves.
            </p>
          </div>
        </section>

        <section className="lp-section" id="how">
          <h2>How it works</h2>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="lp-step-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section" id="projects">
          <div className="lp-section-head">
            <h2>Monitored projects</h2>
            <a className="lp-link" href="app.html">All evidence in the dashboard</a>
          </div>
          {projects.length ? (
            <div className="table-wrap">
              <table className="data-table rtable lp-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Location</th>
                    <th>Forest area</th>
                    <th>Remaining</th>
                    <th>Status</th>
                    <th><span className="visually-hidden">Evidence</span></th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const s = p.summary;
                    const flaggedHere = chain?.projects?.[p.id]?.overcredited ?? s.overcredited;
                    return (
                      <tr key={p.id}>
                        <td data-label="Project"><b>{p.name}</b></td>
                        <td data-label="Location">{p.region}, {p.country}</td>
                        <td data-label="Forest area">
                          {fmt(s.baselineForestHa, 1)} → {fmt(s.latestForestHa, 1)} ha <span className="muted">({s.baselineYear}–{s.latestYear})</span>
                        </td>
                        <td data-label="Remaining">{pct(s.remainingPct)}</td>
                        <td data-label="Status">
                          <span className="lp-status">
                            <StatusChip status={statusOf(p)} small />
                            {flaggedHere && <span className="chip chip-flag chip-sm">⚑ Overcredited?</span>}
                          </span>
                        </td>
                        <td data-label="Evidence"><a href={`app.html#${p.id}`}>View evidence</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{data ? 'No project data in this build. Run npm run satellite to generate it.' : 'Loading projects…'}</p>
          )}
        </section>

        <section className="lp-section" id="limits">
          <h2>What CanopyCheck does not claim</h2>
          <ul className="lp-limits">
            {LIMITS.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      </main>

      <footer className="lp-foot">
        <p>
          Imagery: Copernicus Sentinel-2 (ESA), accessed through Microsoft Planetary Computer. Training labels: ESA WorldCover 2021. Dashboard
          basemap: Esri World Imagery.
        </p>
        <p>Built for the IEEE ClimateChain Global Hackathon 2026 · Track: Carbon Markets &amp; Emissions Transparency.</p>
      </footer>
    </div>
  );
}
