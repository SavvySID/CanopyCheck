// Site-selection helper: coarse NDVI scan of a region for two years, listing the
// 3 km cells with the biggest drop in dense vegetation. Usage:
//   node scripts/scan.mjs <lat> <lon> <yearA> <yearB> <months e.g. 06-01:09-30> [sizeKm]
import { makeGrid, utmEpsg } from './lib/s2.mjs';
import { composite } from './lib/composite.mjs';

const [lat, lon, ya, yb, months = '06-01:09-30', sizeKm = '15'] = process.argv.slice(2);
const [m0, m1] = months.split(':');
const res = 60;
const cell = 3000 / res;
const epsg = utmEpsg(+lat, +lon);
const probe = makeGrid(epsg, 0, 0, 1, 1, res);
const [ce, cn] = probe.fromLonLat(+lon, +lat);
const size = Math.round((+sizeKm * 1000) / res / cell) * cell;
const grid = makeGrid(epsg, Math.round((ce - (size * res) / 2) / 60) * 60, Math.round((cn + (size * res) / 2) / 60) * 60, size, size, res);

async function forest(year) {
  const c = await composite(grid, `${year}-${m0}/${year}-${m1}`, ['B04', 'B08'], { log: console.log, maxScenes: 4 });
  if (!c) throw new Error(`no imagery ${year}`);
  const f = new Int8Array(size * size).fill(-1);
  for (let p = 0; p < f.length; p++) {
    if (!c.valid[p]) continue;
    const ndvi = (c.bands.B08[p] - c.bands.B04[p]) / (c.bands.B08[p] + c.bands.B04[p]);
    f[p] = ndvi > 0.75 ? 1 : 0;
  }
  console.log(`${year} valid ${c.validPct.toFixed(1)}%`);
  return f;
}

const [fa, fb] = await Promise.all([forest(ya), forest(yb)]);
const cells = [];
for (let cy = 0; cy < size / cell; cy++) {
  for (let cx = 0; cx < size / cell; cx++) {
    let both = 0, a = 0, b = 0;
    for (let r = cy * cell; r < (cy + 1) * cell; r++) {
      for (let c = cx * cell; c < (cx + 1) * cell; c++) {
        const p = r * size + c;
        if (fa[p] < 0 || fb[p] < 0) continue;
        both++; a += fa[p]; b += fb[p];
      }
    }
    if (both < cell * cell * 0.5) continue;
    const e = grid.minE + (cx + 0.5) * cell * res;
    const n = grid.maxN - (cy + 0.5) * cell * res;
    const [clon, clat] = grid.toLonLat(e, n);
    cells.push({ cx, cy, lat: +clat.toFixed(4), lon: +clon.toFixed(4), validPct: Math.round((both / (cell * cell)) * 100), forestA: Math.round((a / both) * 100), forestB: Math.round((b / both) * 100) });
  }
}
cells.sort((x, y) => (y.forestA - y.forestB) - (x.forestA - x.forestB));
console.table(cells.slice(0, 12));
console.log('most stable dense cells:');
console.table(cells.filter((c) => c.forestA > 80).sort((x, y) => (x.forestA - x.forestB) - (y.forestA - y.forestB)).slice(0, 5));
