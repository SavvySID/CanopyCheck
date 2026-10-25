// CanopyCheck checker pipeline.
//   1. Build cloud-masked Sentinel-2 median composites for each project and its
//      reference area, one per dry season.
//   2. Train a forest / non-forest classifier on ESA WorldCover 2021 labels.
//   3. Measure forest cover per year, render evidence images, and write
//      web/public/data/projects.json plus a hashed evidence file per project.
// Any checker can re-run this script on the same public imagery and get the same numbers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { makeGrid, utmEpsg, search, sign, readLonLatOnGrid, gridLonLatBounds } from './lib/s2.mjs';
import { composite } from './lib/composite.mjs';
import { SITES, YEARS, BOX_M, RES } from './sites.mjs';

const OUT = path.resolve('web/public/data');
const BANDS = ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'];
const FEATURES = [...BANDS, 'NDVI', 'NDMI', 'NBR', 'NDVI_TEXTURE'];
const TRAIN_YEAR = 2021;
const THRESHOLDS = { healthyPct: 95, atRiskPct: 85 };
const log = (...a) => console.log(...a);

function boxGrid(lat, lon) {
  const epsg = utmEpsg(lat, lon);
  const probe = makeGrid(epsg, 0, 0, 1, 1, RES);
  const [e, n] = probe.fromLonLat(lon, lat);
  const snap = (v) => Math.round(v / 60) * 60;
  const px = BOX_M / RES;
  return makeGrid(epsg, snap(e - BOX_M / 2), snap(n + BOX_M / 2), px, px, RES);
}

function features(c, p) {
  const b = Object.fromEntries(BANDS.map((k) => [k, c.bands[k][p]]));
  const nd = (x, y) => (x - y) / (x + y + 1e-6);
  return [...BANDS.map((k) => b[k]), nd(b.B08, b.B04), nd(b.B08, b.B11), nd(b.B08, b.B12), c.tex[p]];
}

// Canopy texture: local (5x5) standard deviation of NDVI. Forest canopy is rough,
// pasture and crops are smooth even when they are just as green.
function addTexture(c, width, height, r = 2) {
  const n = width * height;
  const ndvi = new Float32Array(n);
  for (let p = 0; p < n; p++) ndvi[p] = c.valid[p] ? (c.bands.B08[p] - c.bands.B04[p]) / (c.bands.B08[p] + c.bands.B04[p] + 1e-6) : NaN;
  c.tex = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0, s2 = 0, k = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) {
          const v = ndvi[yy * width + xx];
          if (Number.isNaN(v)) continue;
          s += v; s2 += v * v; k++;
        }
      }
      c.tex[y * width + x] = k > 1 ? Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2)) : 0;
    }
  }
}

// 5x5 majority filter: removes isolated misclassified pixels (salt-and-pepper noise).
function majority(mask, width, height, r = 2) {
  const out = new Int8Array(mask.length).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] < 0) continue;
      let f = 0, v = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) {
          const m = mask[yy * width + xx];
          if (m < 0) continue;
          v++; f += m;
        }
      }
      out[p] = f * 2 > v ? 1 : f * 2 < v ? 0 : mask[p];
    }
  }
  return out;
}

// Seeded RNG so every checker draws the same training sample.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function trainLogistic(X, y, iters = 600, lr = 0.5, l2 = 1e-4) {
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const x of X) x.forEach((v, j) => (mean[j] += v / X.length));
  for (const x of X) x.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / X.length));
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));
  const w = new Array(d).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < Z.length; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / Z.length + l2 * w[j]);
    b -= lr * (gb / Z.length);
  }
  return { mean, std, w, b };
}

function predict(model, x) {
  let z = model.b;
  for (let j = 0; j < x.length; j++) z += model.w[j] * ((x[j] - model.mean[j]) / model.std[j]);
  return 1 / (1 + Math.exp(-z));
}

function writePng(file, width, height, fill) {
  const png = new PNG({ width, height });
  for (let p = 0; p < width * height; p++) {
    const [r, g, b, a] = fill(p);
    png.data[p * 4] = r; png.data[p * 4 + 1] = g; png.data[p * 4 + 2] = b; png.data[p * 4 + 3] = a;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

const stretch = (v) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.max(0, v) / 0.16, 1 / 1.6))));

async function worldCover(grid) {
  const items = await search('esa-worldcover', gridLonLatBounds(grid), '2021-01-01/2021-12-31');
  if (!items.length) throw new Error('no WorldCover tile');
  return readLonLatOnGrid(await sign('esa-worldcover', items[0].assets.map.href), grid);
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sites = SITES.map((s) => ({ ...s, grid: boxGrid(...s.center), refGrid: boxGrid(...s.referenceCenter) }));

  // 1. Composites for every project + reference area and year.
  for (const s of sites) {
    log(`\n== ${s.name}`);
    s.comps = {};
    s.refComps = {};
    for (const year of YEARS) {
      const window = `${year}-${s.season[0]}/${year}-${s.season[1]}`;
      const [c, rc] = await Promise.all([
        composite(s.grid, window, BANDS, { log }),
        composite(s.refGrid, window, BANDS),
      ]);
      if (c && rc) {
        addTexture(c, s.grid.width, s.grid.height);
        addTexture(rc, s.refGrid.width, s.refGrid.height);
        s.comps[year] = c; s.refComps[year] = rc;
      } else log(`  ${year}: insufficient clear imagery, skipped`);
    }
  }

  // 2. Classifier trained on WorldCover 2021 labels (class 10 = tree cover).
  log('\n== Training forest classifier on ESA WorldCover 2021 labels');
  const samples = { 1: [], 0: [] };
  for (const s of sites) {
    for (const [grid, comps] of [[s.grid, s.comps], [s.refGrid, s.refComps]]) {
      const c = comps[TRAIN_YEAR];
      if (!c) continue;
      const wc = await worldCover(grid);
      for (let p = 0; p < wc.length; p++) {
        if (!c.valid[p] || wc[p] === 0) continue;
        samples[wc[p] === 10 ? 1 : 0].push(features(c, p));
      }
    }
  }
  const rand = rng(42);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const perClass = Math.min(6000, samples[0].length, samples[1].length);
  const data = shuffle([
    ...shuffle(samples[1]).slice(0, perClass).map((x) => [x, 1]),
    ...shuffle(samples[0]).slice(0, perClass).map((x) => [x, 0]),
  ]);
  const split = Math.floor(data.length * 0.7);
  const train = data.slice(0, split);
  const test = data.slice(split);
  const model = trainLogistic(train.map((d) => d[0]), train.map((d) => d[1]));
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const [x, y] of test) {
    const yhat = predict(model, x) >= 0.5 ? 1 : 0;
    if (yhat && y) tp++; else if (yhat && !y) fp++; else if (!yhat && !y) tn++; else fn++;
  }
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  const classifier = {
    type: 'logistic-regression',
    features: FEATURES,
    labels: 'ESA WorldCover 2021 — tree cover (class 10) vs other',
    trainPixels: train.length,
    testPixels: test.length,
    accuracy: r2(((tp + tn) / test.length) * 100) / 100,
    precision: r2(precision * 100) / 100,
    recall: r2(recall * 100) / 100,
    f1: r2(((2 * precision * recall) / (precision + recall)) * 100) / 100,
    available: { forest: samples[1].length, other: samples[0].length },
    model,
  };
  log(`  held-out accuracy ${(classifier.accuracy * 100).toFixed(1)}% precision ${(precision * 100).toFixed(1)}% recall ${(recall * 100).toFixed(1)}% (${test.length} test px)`);

  // 3. Forest cover, evidence images and summaries.
  const classify = (c, width, height) => {
    const m = new Int8Array(c.valid.length).fill(-1);
    for (let p = 0; p < m.length; p++) if (c.valid[p]) m[p] = predict(model, features(c, p)) >= 0.5 ? 1 : 0;
    return majority(m, width, height);
  };
  // Intact-forest accounting: a pixel counts as forest only if it was forest at the
  // baseline and in every later clear observation. Cleared land that greens up again
  // (pasture, regrowth) is not credited back as protected forest. Pixels without a
  // clear view in a given year keep their previous state.
  const advance = (state, m) => {
    if (!state) return Int8Array.from(m);
    const next = Int8Array.from(state);
    for (let p = 0; p < next.length; p++) if (next[p] === 1 && m[p] === 0) next[p] = 0;
    return next;
  };
  const cover = (state, c) => {
    let known = 0, f = 0, clear = 0;
    for (let p = 0; p < state.length; p++) {
      if (c.valid[p]) clear++;
      if (state[p] >= 0) { known++; f += state[p]; }
    }
    return { validPct: (clear / state.length) * 100, forestPct: known ? (f / known) * 100 : 0 };
  };

  const projects = [];
  for (const s of sites) {
    const dir = path.join(OUT, s.id);
    fs.mkdirSync(dir, { recursive: true });
    const years = Object.keys(s.comps).map(Number).sort();
    const areaHa = (BOX_M * BOX_M) / 10_000;
    const { width, height } = s.grid;
    let baseMask = null;
    let mask = null;
    let refMask = null;
    const rows = [];
    for (const year of years) {
      const c = s.comps[year];
      mask = advance(mask, classify(c, width, height));
      refMask = advance(refMask, classify(s.refComps[year], s.refGrid.width, s.refGrid.height));
      const pc = cover(mask, c);
      const rc = cover(refMask, s.refComps[year]);
      if (!baseMask) baseMask = mask;
      writePng(path.join(dir, `${year}-rgb.png`), width, height, (p) => c.valid[p]
        ? [stretch(c.bands.B04[p]), stretch(c.bands.B03[p]), stretch(c.bands.B02[p]), 255]
        : [40, 40, 40, 255]);
      writePng(path.join(dir, `${year}-forest.png`), width, height, (p) => mask[p] === 1 ? [34, 197, 94, 110] : [0, 0, 0, 0]);
      const isBase = year === years[0];
      if (!isBase) {
        writePng(path.join(dir, `${year}-loss.png`), width, height, (p) => baseMask[p] === 1 && mask[p] === 0 ? [239, 68, 68, 210] : [0, 0, 0, 0]);
      }
      rows.push({
        year,
        window: `${year}-${s.season[0]}/${year}-${s.season[1]}`,
        scenes: c.scenes,
        validPct: r1(pc.validPct),
        forestPct: r1(pc.forestPct),
        forestHa: r1((pc.forestPct / 100) * areaHa),
        refForestPct: r1(rc.forestPct),
        refValidPct: r1(rc.validPct),
        rgb: `data/${s.id}/${year}-rgb.png`,
        forest: `data/${s.id}/${year}-forest.png`,
        loss: isBase ? null : `data/${s.id}/${year}-loss.png`,
      });
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const span = last.year - first.year;
    const remainingPct = (last.forestPct / first.forestPct) * 100;
    const projectAnnualLossPct = ((first.forestPct - last.forestPct) / first.forestPct / span) * 100;
    const refAnnualLossPct = ((first.refForestPct - last.refForestPct) / first.refForestPct / span) * 100;
    const status = remainingPct >= THRESHOLDS.healthyPct ? 'Healthy' : remainingPct >= THRESHOLDS.atRiskPct ? 'At Risk' : 'Frozen';
    const overcredited = s.claimedThreatPctPerYear > 2 * Math.max(refAnnualLossPct, 0);
    const summary = {
      baselineYear: first.year,
      latestYear: last.year,
      baselineForestHa: first.forestHa,
      latestForestHa: last.forestHa,
      remainingPct: r1(remainingPct),
      projectAnnualLossPct: r2(projectAnnualLossPct),
      refAnnualLossPct: r2(refAnnualLossPct),
      status,
      overcredited,
    };
    const lostHa = r1(first.forestHa - last.forestHa);
    const plainSummary = [
      `Between the ${first.year} and ${last.year} dry seasons, estimated forest cover inside the ${areaHa.toLocaleString('en-US')} ha project boundary went from ${first.forestHa} ha to ${last.forestHa} ha` +
        (lostHa > 0 ? ` (${lostHa} ha lost, ${r1(100 - remainingPct)}% of the baseline forest).` : lostHa < 0 ? ` (no net loss detected).` : '.'),
      status === 'Frozen'
        ? `That is below the 85% threshold, so the project's credits are frozen: they cannot be transferred or retired until a later check shows recovery or the loss is compensated.`
        : status === 'At Risk'
          ? `That is between 85% and 95% of the baseline, so the credits stay tradable but carry an At Risk warning.`
          : `At least 95% of the baseline forest remains, so the credits are Healthy.`,
      `The nearby reference area lost ${Math.max(0, r2(refAnnualLossPct))}% of its forest per year, while the developer claimed a ${s.claimedThreatPctPerYear}% annual threat` +
        (overcredited
          ? `. Because the claim is more than twice the observed reference rate, the project is flagged as possibly overcredited. This is an indicator for review, not proof of fraud.`
          : `, which is consistent with the observed rate.`),
      `Measurements use cloud-masked Sentinel-2 imagery (${last.validPct}% of the boundary had clear observations in ${last.year}); they show land-cover change, not its cause.`,
    ].join(' ');

    const evidence = {
      project: s.id,
      methodVersion: 'canopycheck-0.1',
      crs: `EPSG:${s.grid.epsg}`,
      grid: { minE: s.grid.minE, maxN: s.grid.maxN, width, height, res: RES },
      referenceGrid: { minE: s.refGrid.minE, maxN: s.refGrid.maxN, width, height, res: RES },
      classifier: { type: classifier.type, features: FEATURES, model },
      years: rows.map(({ rgb, forest, loss, ...r }) => r),
      summary,
    };
    const evidenceJson = JSON.stringify(evidence, null, 2);
    fs.writeFileSync(path.join(dir, 'evidence.json'), evidenceJson);
    const evidenceHash = '0x' + crypto.createHash('sha256').update(evidenceJson).digest('hex');

    const bounds = (g) => {
      const [w, so, e, n] = gridLonLatBounds(g);
      return [[+so.toFixed(5), +w.toFixed(5)], [+n.toFixed(5), +e.toFixed(5)]];
    };
    projects.push({
      id: s.id, name: s.name, region: s.region, country: s.country, continent: s.continent,
      center: s.center, boundary: bounds(s.grid), reference: bounds(s.refGrid), imageBounds: bounds(s.grid),
      areaHa, claimedThreatPctPerYear: s.claimedThreatPctPerYear,
      years: rows, summary, plainSummary, evidenceHash, evidence: `data/${s.id}/evidence.json`,
    });
    log(`\n${s.name}: ${rows.map((r) => `${r.year} ${r.forestPct}% (ref ${r.refForestPct}%, clear ${r.validPct}%)`).join(' → ')}`);
    log(`  remaining ${summary.remainingPct}% → ${status}${overcredited ? ' + OVERCREDITED' : ''}; ref loss ${summary.refAnnualLossPct}%/yr vs claimed ${s.claimedThreatPctPerYear}%/yr`);
  }

  const { model: _m, ...publicClassifier } = classifier;
  fs.writeFileSync(path.join(OUT, 'projects.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'Sentinel-2 L2A via Microsoft Planetary Computer',
    classifier: publicClassifier,
    thresholds: THRESHOLDS,
    projects,
  }, null, 2));
  log(`\nWrote ${path.join(OUT, 'projects.json')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
