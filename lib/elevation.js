'use strict';
// Real terrain elevation from AWS Terrain Tiles (Mapzen "terrarium" PNGs) —
// open data on S3, no API key. elevation_m = (R*256 + G + B/256) - 32768.
// Produces a regular height grid in the course's local-meter frame plus
// bilinear h(x,y) / gradient samplers used by both physics and rendering.

const { PNG } = require('pngjs');

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ZOOM = 14;            // ~9.5*cos(lat) m/px — matches SRTM/NED source resolution
const TILE = 256;
const GRID_CELL_M = 5;      // grid spacing; widened automatically if course is huge
const MAX_NODES = 768;      // per axis
const PAD_M = 80;
const SMOOTH_SIGMA = 2;     // cells (~10 m) — irons out SRTM stair-steps

function lonLatToMercPx(lon, lat, z) {
  const world = TILE * Math.pow(2, z);
  const latRad = (lat * Math.PI) / 180;
  return {
    px: ((lon + 180) / 360) * world,
    py: ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * world,
  };
}

async function fetchTile(z, x, y) {
  const res = await fetch(TILE_URL(z, x, y), { headers: { 'User-Agent': 'Open-Birdie/0.1' } });
  if (!res.ok) throw new Error(`terrain tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return PNG.sync.read(buf);
}

/**
 * Fetch a height grid covering local-meter bounds around origin (lat0, lon0).
 * mPerLat / mPerLon must match the course projection (lib/course.js).
 * Returns {minX, minY, cellM, nx, ny, baseM, heights[ny*nx]} (heights rel. to baseM).
 */
async function fetchElevationGrid({ lat0, lon0, mPerLat, mPerLon, minX, minY, maxX, maxY }) {
  minX -= PAD_M; minY -= PAD_M; maxX += PAD_M; maxY += PAD_M;

  let cellM = GRID_CELL_M;
  while ((maxX - minX) / cellM + 1 > MAX_NODES || (maxY - minY) / cellM + 1 > MAX_NODES) cellM *= 2;
  const nx = Math.floor((maxX - minX) / cellM) + 1;
  const ny = Math.floor((maxY - minY) / cellM) + 1;

  // tile range covering the grid corners
  const corners = [
    [minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY],
  ].map(([x, y]) => lonLatToMercPx(lon0 + x / mPerLon, lat0 + y / mPerLat, ZOOM));
  const txMin = Math.floor(Math.min(...corners.map((c) => c.px)) / TILE);
  const txMax = Math.floor(Math.max(...corners.map((c) => c.px)) / TILE);
  const tyMin = Math.floor(Math.min(...corners.map((c) => c.py)) / TILE);
  const tyMax = Math.floor(Math.max(...corners.map((c) => c.py)) / TILE);
  const tilesX = txMax - txMin + 1, tilesY = tyMax - tyMin + 1;
  if (tilesX * tilesY > 36) throw new Error(`area needs ${tilesX * tilesY} terrain tiles — too large`);

  // fetch all tiles, assemble elevation mosaic (meters)
  const mosaicW = tilesX * TILE, mosaicH = tilesY * TILE;
  const mosaic = new Float32Array(mosaicW * mosaicH);
  const jobs = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      jobs.push(fetchTile(ZOOM, tx, ty).then((png) => {
        const ox = (tx - txMin) * TILE, oy = (ty - tyMin) * TILE;
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const i = (y * TILE + x) * 4;
            mosaic[(oy + y) * mosaicW + (ox + x)] =
              png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
          }
        }
      }));
    }
  }
  await Promise.all(jobs);

  const sampleMosaic = (px, py) => {
    const fx = Math.min(Math.max(px - txMin * TILE, 0), mosaicW - 1.001);
    const fy = Math.min(Math.max(py - tyMin * TILE, 0), mosaicH - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const dx = fx - x0, dy = fy - y0;
    const h00 = mosaic[y0 * mosaicW + x0], h10 = mosaic[y0 * mosaicW + x0 + 1];
    const h01 = mosaic[(y0 + 1) * mosaicW + x0], h11 = mosaic[(y0 + 1) * mosaicW + x0 + 1];
    return h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy) + h01 * (1 - dx) * dy + h11 * dx * dy;
  };

  // sample every grid node through its true lat/lon (reconciles the course's
  // equirectangular frame with the tiles' Mercator frame, no reprojection step)
  let heights = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = lat0 + (minY + j * cellM) / mPerLat;
    for (let i = 0; i < nx; i++) {
      const lon = lon0 + (minX + i * cellM) / mPerLon;
      const { px, py } = lonLatToMercPx(lon, lat, ZOOM);
      heights[j * nx + i] = sampleMosaic(px, py);
    }
  }

  heights = gaussianSmooth(heights, nx, ny, SMOOTH_SIGMA);

  const baseM = heights[Math.floor(ny / 2) * nx + Math.floor(nx / 2)];
  const rel = new Array(nx * ny);
  for (let k = 0; k < heights.length; k++) rel[k] = Math.round((heights[k] - baseM) * 100) / 100;

  return { minX, minY, cellM, nx, ny, baseM: Math.round(baseM * 10) / 10, heights: rel };
}

function gaussianSmooth(src, nx, ny, sigma) {
  const radius = Math.max(1, Math.round(3 * sigma));
  const kernel = [];
  let ksum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w); ksum += w;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= ksum;

  const tmp = new Float32Array(nx * ny);
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const ii = Math.min(Math.max(i + k, 0), nx - 1);
        s += src[j * nx + ii] * kernel[k + radius];
      }
      tmp[j * nx + i] = s;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const jj = Math.min(Math.max(j + k, 0), ny - 1);
        s += tmp[jj * nx + i] * kernel[k + radius];
      }
      out[j * nx + i] = s;
    }
  }
  return out;
}

/** Bilinear height + gradient samplers over a grid from fetchElevationGrid. */
function makeTerrain(grid) {
  const { minX, minY, cellM, nx, ny, heights } = grid;
  const cell = (x, y) => {
    let fx = (x - minX) / cellM, fy = (y - minY) / cellM;
    fx = Math.min(Math.max(fx, 0), nx - 1.001);
    fy = Math.min(Math.max(fy, 0), ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy);
    return {
      dx: fx - i, dy: fy - j,
      h00: heights[j * nx + i], h10: heights[j * nx + i + 1],
      h01: heights[(j + 1) * nx + i], h11: heights[(j + 1) * nx + i + 1],
    };
  };
  return {
    flat: false,
    h(x, y) {
      const c = cell(x, y);
      return c.h00 * (1 - c.dx) * (1 - c.dy) + c.h10 * c.dx * (1 - c.dy) +
             c.h01 * (1 - c.dx) * c.dy + c.h11 * c.dx * c.dy;
    },
    grad(x, y) {
      const c = cell(x, y);
      return {
        dx: ((c.h10 - c.h00) * (1 - c.dy) + (c.h11 - c.h01) * c.dy) / cellM,
        dy: ((c.h01 - c.h00) * (1 - c.dx) + (c.h11 - c.h10) * c.dx) / cellM,
      };
    },
  };
}

function flatTerrain() {
  return { flat: true, h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };
}

module.exports = { fetchElevationGrid, makeTerrain, flatTerrain };
