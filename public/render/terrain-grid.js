// Pure browser height sampler — parity with lib/elevation.makeTerrain h().
// No three.js dependency. The renderer's placement sampler (hAt) and the physics
// terrain must agree, so this mirrors makeTerrain's raw-h + edgeBlendM blend
// exactly. HD patches take precedence over legacy green patches over the base.

const FEATHER_M = 4;

function gridSampler(grid) {
  const { minX, minY, cellM, nx, ny, heights } = grid;
  const maxX = minX + (nx - 1) * cellM;
  const maxY = minY + (ny - 1) * cellM;
  const cell = (x, y) => {
    let fx = (x - minX) / cellM; let fy = (y - minY) / cellM;
    fx = Math.min(Math.max(fx, 0), nx - 1.001);
    fy = Math.min(Math.max(fy, 0), ny - 1.001);
    const i = Math.floor(fx); const j = Math.floor(fy);
    return {
      dx: fx - i, dy: fy - j,
      h00: heights[j * nx + i], h10: heights[j * nx + i + 1],
      h01: heights[(j + 1) * nx + i], h11: heights[(j + 1) * nx + i + 1],
    };
  };
  return {
    minX, minY, maxX, maxY,
    contains: (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY,
    inset: (x, y) => Math.min(x - minX, maxX - x, y - minY, maxY - y),
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

export function makeTerrainSampler(base, patches = []) {
  const baseS = gridSampler(base);
  const entries = patches.map((p) => ({ s: gridSampler(p), edgeBlendM: p.edgeBlendM }));
  const lerp = (a, b, w) => a + (b - a) * w;
  const weightOf = (e, x, y) => {
    const blend = e.edgeBlendM ?? FEATHER_M;
    return blend <= 0 ? 1 : Math.min(1, e.s.inset(x, y) / blend);
  };
  const pick = (x, y) => {
    for (const e of entries) if (e.s.contains(x, y)) return { e, w: weightOf(e, x, y) };
    return null;
  };
  return {
    h(x, y) {
      const sel = pick(x, y);
      return sel ? lerp(baseS.h(x, y), sel.e.s.h(x, y), sel.w) : baseS.h(x, y);
    },
    grad(x, y) {
      const sel = pick(x, y);
      if (!sel) return baseS.grad(x, y);
      const b = baseS.grad(x, y); const g = sel.e.s.grad(x, y);
      return { dx: lerp(b.dx, g.dx, sel.w), dy: lerp(b.dy, g.dy, sel.w) };
    },
  };
}
