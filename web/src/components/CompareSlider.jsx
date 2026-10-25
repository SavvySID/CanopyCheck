import { useEffect, useRef, useState } from 'react';
import { imageExtent, pct } from '../util.js';

function BaseImage({ src, year }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className="cmp-img cmp-placeholder">
        <span>Imagery for {year} is not available in this build</span>
      </div>
    );
  }
  return <img className="cmp-img" src={src} alt={`Sentinel-2 true-colour composite, ${year}`} draggable={false} onError={() => setFailed(true)} />;
}

function Overlay({ src, className }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;
  return <img className={`cmp-img cmp-overlay ${className}`} src={src} alt="" draggable={false} onError={() => setFailed(true)} />;
}

// Only draw a box that overlaps the image; otherwise it would sit outside the frame.
function overlaps(box, ext) {
  return box && box[0][0] < ext[1][0] && box[1][0] > ext[0][0] && box[0][1] < ext[1][1] && box[1][1] > ext[0][1];
}

// Acquisition dates from Sentinel-2 product ids, e.g. S2A_MSIL2A_20190708T143751_….
function sceneDates(scenes = []) {
  const dates = scenes
    .map((id) => /_(\d{4})(\d{2})(\d{2})T/.exec(id))
    .filter(Boolean)
    .map((m) => Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .sort((a, b) => a - b);
  return [...new Set(dates)].map((t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
}

function windowText(window) {
  const [a, b] = (window ?? '').split('/');
  if (!a || !b) return window ?? '—';
  const f = (d, withYear) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return `${f(a, false)} – ${f(b, true)}`;
}

function boxStyle(box, ext) {
  if (!box) return null;
  const w = ext[1][1] - ext[0][1];
  const h = ext[1][0] - ext[0][0];
  return {
    left: `${((box[0][1] - ext[0][1]) / w) * 100}%`,
    width: `${((box[1][1] - box[0][1]) / w) * 100}%`,
    top: `${((ext[1][0] - box[1][0]) / h) * 100}%`,
    height: `${((box[1][0] - box[0][0]) / h) * 100}%`,
  };
}

export default function CompareSlider({ project, classifier }) {
  const years = project.years ?? [];
  const [beforeYear, setBeforeYear] = useState(years[0]?.year);
  const [afterYear, setAfterYear] = useState(years[years.length - 1]?.year);
  const [pos, setPos] = useState(50);
  const [showLoss, setShowLoss] = useState(true);
  const [showForest, setShowForest] = useState(false);
  const box = useRef(null);
  const dragging = useRef(false);

  useEffect(() => {
    setBeforeYear(years[0]?.year);
    setAfterYear(years[years.length - 1]?.year);
    setPos(50);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const before = years.find((y) => y.year === beforeYear) ?? years[0];
  const after = years.find((y) => y.year === afterYear) ?? years[years.length - 1];
  if (!before || !after) return null;

  const baseYear = years[0]?.year;
  const ext = imageExtent(project);
  const midLat = ((ext[0][0] + ext[1][0]) / 2) * (Math.PI / 180);
  const ratio = Math.min(2.4, Math.max(0.6, ((ext[1][1] - ext[0][1]) * Math.cos(midLat)) / (ext[1][0] - ext[0][0])));

  const moveTo = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div className="compare-block">
      <div className="cmp-controls">
        <div className="cmp-group">
        <label>
          Before
          <select value={before.year} onChange={(e) => setBeforeYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y.year} value={y.year}>{y.year}</option>
            ))}
          </select>
        </label>
        <label>
          After
          <select value={after.year} onChange={(e) => setAfterYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y.year} value={y.year}>{y.year}</option>
            ))}
          </select>
        </label>
        </div>
        <div className="cmp-group">
          <label className="toggle">
            <input type="checkbox" checked={showLoss} onChange={(e) => setShowLoss(e.target.checked)} />
            <i className="lg lg-loss" aria-hidden="true" /> Detected loss
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showForest} onChange={(e) => setShowForest(e.target.checked)} />
            <i className="lg lg-forest" aria-hidden="true" /> Forest mask
          </label>
        </div>
      </div>

      <div
        ref={box}
        className="compare"
        style={{ aspectRatio: ratio }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <div className="cmp-side cmp-side-before">
          <BaseImage src={before.rgb} year={before.year} />
          {showForest && <Overlay src={before.forest} className="ov-forest" />}
        </div>
        <div className="cmp-side cmp-side-after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          <BaseImage src={after.rgb} year={after.year} />
          {showForest && <Overlay src={after.forest} className="ov-forest" />}
          {showLoss && <Overlay src={after.loss} className="ov-loss" />}
        </div>
        <div className="cmp-box cmp-box-project" style={boxStyle(project.boundary, ext)}><span>Project</span></div>
        {overlaps(project.reference, ext) && (
          <div className="cmp-box cmp-box-ref" style={boxStyle(project.reference, ext)}><span>Reference</span></div>
        )}
        <div className="cmp-divider" style={{ left: `${pos}%` }}>
          <span className="cmp-handle" aria-hidden="true">⇆</span>
        </div>
        <span className="cmp-tag cmp-tag-left">{before.year}</span>
        <span className="cmp-tag cmp-tag-right">{after.year}</span>
      </div>

      <input
        className="cmp-range"
        type="range"
        min="0"
        max="100"
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Before/after comparison position"
      />

      <ul className="cmp-legend">
        {showLoss && (
          <li>
            <i className="lg lg-loss" aria-hidden="true" />
            <span>
              <b>Detected loss</b> (right side): forest in {baseYear} that was classified as non-forest in at least one later year up to{' '}
              {after.year}
              {after.year === baseYear ? ' — none, because this is the baseline year' : ''}. Cleared land is not counted back if it greens up. It
              is measured against the {baseYear} baseline, not the left-hand year.
            </span>
          </li>
        )}
        {showForest && (
          <li>
            <i className="lg lg-forest" aria-hidden="true" />
            <span><b>Forest mask</b>: pixels still counted as intact forest in the year shown on each side (forest at the baseline and in every later year).</span>
          </li>
        )}
        <li>
          <i className="lg lg-solid" aria-hidden="true" />
          <span><b>Project boundary</b> ({project.areaHa?.toLocaleString('en-US')} ha). The images cover the project area only.</span>
        </li>
      </ul>

      <div className="table-wrap">
        <table className="data-table rtable obs-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Composite</th>
              <th>Window</th>
              <th>Acquisitions used</th>
              <th>Clear pixels</th>
            </tr>
          </thead>
          <tbody>
            {[['Before', before], ['After', after]].map(([side, y]) => (
              <tr key={side}>
                <td data-label="Side">{side}</td>
                <td data-label="Composite"><b>{y.year}</b></td>
                <td data-label="Window">{windowText(y.window)}</td>
                <td data-label="Acquisitions used">{sceneDates(y.scenes).join(', ') || '—'} ({y.scenes?.length ?? 0})</td>
                <td data-label="Clear pixels">
                  {pct(y.validPct, 1)}
                  {y.validPct < 60 && <span className="lowq"> low quality</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="source-note">
        Source: Sentinel-2 L2A (Copernicus) via Microsoft Planetary Computer, 10 m. Per-pixel median of the clearest acquisitions; clouds and
        shadows removed with the Scene Classification Layer. Forest / non-forest is a model estimate
        {classifier?.accuracy != null
          ? ` (${classifier.type ?? 'classifier'}; ${pct(classifier.accuracy * 100)} pixel agreement with ESA WorldCover 2021 labels on a random hold-out from the same areas and year, which is likely optimistic and is not field validation)`
          : ''}
        , so individual pixels, especially along field edges, can be misclassified.
      </p>
    </div>
  );
}
