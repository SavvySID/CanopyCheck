// Cloud-masked, multi-date median composite on a fixed grid.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { search, sign, readOnGrid, gridLonLatBounds, pool } from './s2.mjs';

const COLLECTION = 'sentinel-2-l2a';
// Scene Classification Layer classes kept as clear observations:
// 4 vegetation, 5 bare soil, 6 water, 11 snow. Everything else (no data,
// saturated, dark/shadow, cloud shadow, clouds, cirrus, unclassified) is masked.
const CLEAR = new Set([4, 5, 6, 11]);

function epsgOf(item) {
  const p = item.properties;
  if (p['proj:epsg']) return p['proj:epsg'];
  if (p['proj:code']) return Number(String(p['proj:code']).split(':')[1]);
  return null;
}

function contains(outer, inner) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function boaOffset(item) {
  // Processing baseline 04.00+ (from Jan 2022) adds +1000 to L2A digital numbers.
  const pb = parseFloat(item.properties['s2:processing_baseline'] ?? '0');
  return pb >= 4 ? 1000 : 0;
}

// Composites are cached on disk so re-runs don't re-download imagery.
const CACHE = path.resolve('.cache');

export async function composite(grid, datetime, bands, opts = {}) {
  const key = crypto.createHash('sha1')
    .update(JSON.stringify({ g: [grid.epsg, grid.minE, grid.maxN, grid.width, grid.height, grid.res], datetime, bands, o: { ...opts, log: undefined } }))
    .digest('hex');
  const meta = path.join(CACHE, `${key}.json`);
  const bin = path.join(CACHE, `${key}.bin`);
  const n = grid.width * grid.height;
  if (fs.existsSync(meta)) {
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (!m) return null;
    const buf = fs.readFileSync(bin);
    const floats = new Float32Array(buf.buffer, buf.byteOffset, bands.length * n);
    const out = Object.fromEntries(bands.map((b, i) => [b, floats.slice(i * n, (i + 1) * n)]));
    const valid = new Uint8Array(buf.buffer.slice(buf.byteOffset + bands.length * n * 4, buf.byteOffset + bands.length * n * 4 + n));
    return { ...m, bands: out, valid };
  }
  const c = await buildComposite(grid, datetime, bands, opts);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(meta, JSON.stringify(c && { validPct: c.validPct, scenes: c.scenes }));
  if (c) {
    const floats = new Float32Array(bands.length * n);
    bands.forEach((b, i) => floats.set(c.bands[b], i * n));
    fs.writeFileSync(bin, Buffer.concat([Buffer.from(floats.buffer), Buffer.from(c.valid.buffer)]));
  }
  return c;
}

async function buildComposite(grid, datetime, bands, { maxScenes = 3, maxCloud = 60, candidates = 8, minClear = 0.15, log = () => {} } = {}) {
  const bbox = gridLonLatBounds(grid);
  const found = await search(COLLECTION, bbox, datetime, { 'eo:cloud_cover': { lt: maxCloud } });
  const seen = new Set();
  const items = found
    .filter((it) => epsgOf(it) === grid.epsg && contains(it.bbox, bbox))
    // The archive holds some acquisitions twice (reprocessed); keep one per acquisition time.
    .filter((it) => !seen.has(it.properties.datetime) && seen.add(it.properties.datetime))
    .sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover'])
    .slice(0, candidates);
  if (!items.length) return null;

  // Rank candidate scenes by how much of *our window* is clear, not by tile-wide cloud cover.
  const scls = await pool(items, 4, async (it) => readOnGrid(await sign(COLLECTION, it.assets.SCL.href), grid));
  const ranked = items.map((it, i) => {
    const scl = scls[i];
    let clear = 0;
    for (let p = 0; p < scl.length; p++) if (CLEAR.has(scl[p])) clear++;
    return { item: it, scl, clear: clear / scl.length };
  }).filter((s) => s.clear >= minClear).sort((a, b) => b.clear - a.clear).slice(0, maxScenes);
  if (!ranked.length) return null;
  log(`  ${datetime}: ${ranked.map((s) => `${s.item.id.slice(0, 24)}… clear ${(s.clear * 100).toFixed(0)}%`).join(' | ')}`);

  const n = grid.width * grid.height;
  const stacks = await pool(ranked, 3, async (s) => {
    const off = boaOffset(s.item);
    const data = {};
    await Promise.all(bands.map(async (b) => {
      const raw = await readOnGrid(await sign(COLLECTION, s.item.assets[b].href), grid);
      const arr = new Float32Array(n);
      for (let p = 0; p < n; p++) arr[p] = raw[p] === 0 ? NaN : Math.max(0, raw[p] - off) / 10000;
      data[b] = arr;
    }));
    const clear = new Uint8Array(n);
    for (let p = 0; p < n; p++) clear[p] = CLEAR.has(s.scl[p]) && !Number.isNaN(data[bands[0]][p]) ? 1 : 0;
    return { data, clear };
  });

  const out = Object.fromEntries(bands.map((b) => [b, new Float32Array(n).fill(NaN)]));
  const valid = new Uint8Array(n);
  const buf = [];
  let validCount = 0;
  for (let p = 0; p < n; p++) {
    const obs = stacks.filter((s) => s.clear[p]);
    if (!obs.length) continue;
    valid[p] = 1;
    validCount++;
    for (const b of bands) {
      buf.length = 0;
      for (const s of obs) buf.push(s.data[b][p]);
      buf.sort((x, y) => x - y);
      const m = buf.length >> 1;
      out[b][p] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2;
    }
  }
  return {
    bands: out,
    valid,
    validPct: (validCount / n) * 100,
    scenes: ranked.map((s) => s.item.id),
  };
}
