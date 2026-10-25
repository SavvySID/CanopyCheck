// Sentinel-2 L2A access through Microsoft Planetary Computer (no API key needed).
// Reads small windows from the public Cloud-Optimized GeoTIFFs and resamples them
// onto a fixed UTM grid so every year and every checker sees the same pixels.
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';

const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const SAS = 'https://planetarycomputer.microsoft.com/api/sas/v1/token';

const tokens = new Map();
async function fetchToken(collection) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SAS}/${collection}`);
    if (res.ok) {
      const j = await res.json();
      return { token: j.token, expires: Date.parse(j['msft:expiry']) };
    }
    if (res.status !== 429 || attempt >= 6) throw new Error(`SAS token ${collection}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

async function token(collection) {
  const cached = tokens.get(collection);
  // Share one in-flight request so parallel reads don't each ask for a token.
  if (cached && (cached.pending || cached.expires > Date.now() + 60_000)) {
    return cached.pending ? (await cached.pending).token : cached.token;
  }
  const pending = fetchToken(collection);
  tokens.set(collection, { pending });
  try {
    const t = await pending;
    tokens.set(collection, t);
    return t.token;
  } catch (err) {
    tokens.delete(collection);
    throw err;
  }
}

export async function sign(collection, href) {
  return `${href}?${await token(collection)}`;
}

export async function search(collection, bbox, datetime, query = {}, limit = 100) {
  const res = await fetch(`${STAC}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: [collection], bbox, datetime, query, limit }),
  });
  if (!res.ok) throw new Error(`STAC search ${collection}: ${res.status} ${await res.text()}`);
  return (await res.json()).features ?? [];
}

export function utmEpsg(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  return (lat >= 0 ? 32600 : 32700) + zone;
}

function projDef(epsg) {
  const zone = epsg % 100;
  const south = epsg >= 32700 ? ' +south' : '';
  return `+proj=utm +zone=${zone}${south} +datum=WGS84 +units=m +no_defs`;
}

// A Grid is a north-up raster in UTM metres: origin is the top-left corner.
export function makeGrid(epsg, minE, maxN, width, height, res) {
  const def = projDef(epsg);
  return {
    epsg, minE, maxN, width, height, res,
    maxE: minE + width * res,
    minN: maxN - height * res,
    toLonLat: (e, n) => proj4(def, 'WGS84', [e, n]),
    fromLonLat: (lon, lat) => proj4('WGS84', def, [lon, lat]),
  };
}

export function gridLonLatBounds(grid) {
  const corners = [
    grid.toLonLat(grid.minE, grid.minN), grid.toLonLat(grid.maxE, grid.minN),
    grid.toLonLat(grid.minE, grid.maxN), grid.toLonLat(grid.maxE, grid.maxN),
  ];
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

const tiffCache = new Map();
async function openTiff(url) {
  const key = url.split('?')[0];
  if (!tiffCache.has(key)) tiffCache.set(key, fromUrl(url, { allowFullFile: false }));
  return tiffCache.get(key);
}

// Read a raster that shares the grid's CRS, resampled (nearest) onto the grid.
export async function readOnGrid(url, grid) {
  const tiff = await openTiff(url);
  const count = await tiff.getImageCount();
  const base = await tiff.getImage(0);
  const [ox, oy] = base.getOrigin();
  const baseRes = base.getResolution()[0];
  // Pick the coarsest overview that is still at least as fine as the grid.
  let image = base;
  let res = baseRes;
  for (let i = 1; i < count; i++) {
    const img = await tiff.getImage(i);
    const r = baseRes * (base.getWidth() / img.getWidth());
    if (r <= grid.res + 1e-6) { image = img; res = r; }
  }
  const x0 = Math.floor((grid.minE - ox) / res);
  const y0 = Math.floor((oy - grid.maxN) / res);
  const x1 = Math.ceil((grid.maxE - ox) / res);
  const y1 = Math.ceil((oy - grid.minN) / res);
  const [raw] = await image.readRasters({ window: [x0, y0, x1, y1], fillValue: 0 });
  const w = x1 - x0;
  const out = new Float32Array(grid.width * grid.height);
  for (let r = 0; r < grid.height; r++) {
    const n = grid.maxN - (r + 0.5) * grid.res;
    const sy = Math.floor((oy - n) / res) - y0;
    for (let c = 0; c < grid.width; c++) {
      const e = grid.minE + (c + 0.5) * grid.res;
      const sx = Math.floor((e - ox) / res) - x0;
      out[r * grid.width + c] = raw[sy * w + sx];
    }
  }
  return out;
}

// Read a lon/lat (EPSG:4326) raster such as ESA WorldCover, sampled at grid pixel centres.
export async function readLonLatOnGrid(url, grid) {
  const tiff = await openTiff(url);
  const image = await tiff.getImage(0);
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const [w0, s0, e0, n0] = gridLonLatBounds(grid);
  const x0 = Math.floor((w0 - ox) / rx) - 1;
  const y0 = Math.floor((oy - n0) / Math.abs(ry)) - 1;
  const x1 = Math.ceil((e0 - ox) / rx) + 1;
  const y1 = Math.ceil((oy - s0) / Math.abs(ry)) + 1;
  const [raw] = await image.readRasters({ window: [x0, y0, x1, y1], fillValue: 0 });
  const w = x1 - x0;
  const out = new Uint8Array(grid.width * grid.height);
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      const [lon, lat] = grid.toLonLat(grid.minE + (c + 0.5) * grid.res, grid.maxN - (r + 0.5) * grid.res);
      const sx = Math.floor((lon - ox) / rx) - x0;
      const sy = Math.floor((oy - lat) / Math.abs(ry)) - y0;
      out[r * grid.width + c] = raw[sy * w + sx] ?? 0;
    }
  }
  return out;
}

export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
