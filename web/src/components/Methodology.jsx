import { demoDisclaimer, fmt } from '../util.js';

const asPct = (v) => (v == null ? '—' : `${fmt(v * 100, 1)}%`);

export default function Methodology({ data, chain }) {
  const c = data.classifier ?? {};
  return (
    <footer className="methodology">
      <div className="method-grid">
        <section>
          <h3>Data</h3>
          <ul>
            <li>{data.source}, 10 m bands, dry-season windows per year.</li>
            <li>Clouds, cloud shadow and cirrus are removed with the Sentinel-2 Scene Classification Layer (SCL).</li>
            <li>The remaining observations in each window are combined into a per-pixel median composite.</li>
            <li>Each year reports the share of valid (cloud-free) pixels. Years under 60% are flagged as low quality.</li>
          </ul>
        </section>
        <section>
          <h3>Forest classifier</h3>
          <ul>
            <li>Model: {c.type ?? '—'} on {c.features?.join(', ') ?? '—'}.</li>
            <li>Labels: {c.labels ?? '—'}.</li>
            <li>
              Evaluation: balanced pixel sample from the 2021 composites, random 70/30 split ({fmt(c.trainPixels)} train, {fmt(c.testPixels)} test).
              Agreement with the WorldCover labels: accuracy {asPct(c.accuracy)}, precision {asPct(c.precision)}, recall {asPct(c.recall)}, F1{' '}
              {asPct(c.f1)}. Measured before the filter below.
            </li>
            <li>
              Test pixels come from the same areas and year as training pixels, so this is likely optimistic. WorldCover is itself a modelled map, so this
              is not field validation.
            </li>
            <li>A 5 × 5 majority filter removes isolated misclassified pixels.</li>
            <li>
              Intact-forest accounting: a pixel counts as forest only if it was forest at the baseline and in every later year. Cleared land that greens up
              again (pasture, regrowth) is not credited back as protected forest.
            </li>
            <li>Forest area = forest pixels × 0.01 ha (10 m × 10 m).</li>
          </ul>
        </section>
        <section>
          <h3>Verification</h3>
          <ul>
            <li>
              Checkers run the same open pipeline and submit forest cover in basis points with an evidence hash. In this demo all three are local accounts
              driven by one replay script, and checker C is deliberately faulty.
            </li>
            <li>
              {chain ? `${chain.quorum} of ${chain.checkers?.length ?? 3}` : '2 of 3'} submissions must agree within the tolerance before the contract
              accepts a value and updates status.
            </li>
            <li>A boundary can only be registered once, so the same forest can't be credited twice.</li>
            <li>Frozen projects cannot transfer or retire credits.</li>
          </ul>
        </section>
        <section>
          <h3>Limits</h3>
          <ul>
            <li>Demo project boundaries are illustrative and are not real registered carbon projects.</li>
            <li>Forest loss shows land-cover change, not intent or fraud. The cause (logging, fire, clearing) needs further evidence.</li>
            <li>The reference-area comparison is an indicator of an overstated threat, not a formal finding.</li>
            <li>{demoDisclaimer(chain)}. No real credits are issued or traded.</li>
          </ul>
        </section>
      </div>
      <div className="foot-line">
        CanopyCheck prototype · data generated {data.generatedAt ? new Date(data.generatedAt).toISOString().slice(0, 10) : '—'} · Map imagery © Esri
      </div>
    </footer>
  );
}
