// Live provider smoke test — opt-in NETWORK. Confirms the pinned NAIP items are
// still discoverable and the 3DEP service answers for the manifest bounds.
//   node tools/smoke-hd-providers.mjs --manifest tools/hd-course/manifests/bandon-dunes-hole-01.json
//
// This is the deferred live capstone — it is intentionally NOT part of `npm test`
// (which stays offline). Run it explicitly before a real build.

import { loadManifest } from './hd-course/config.mjs';
import { searchNaipCandidates, selectPinnedAcquisition, assetHref } from './hd-course/naip.mjs';
import { assertCogDrift } from './hd-course/cog-source.mjs';

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const manifestPath = opt('manifest');
  if (!manifestPath) { console.error('usage: smoke-hd-providers --manifest <path>'); process.exit(2); }
  const manifest = loadManifest(manifestPath);

  // A rough bbox is fine for discovery; the build recomputes exact bounds.
  // Callers can pass an explicit --bbox west,south,east,north.
  const bboxArg = opt('bbox');
  if (!bboxArg) { console.error('pass --bbox west,south,east,north (the padded hole extent)'); process.exit(2); }
  const [west, south, east, north] = bboxArg.split(',').map(Number);

  console.log('Discovering NAIP candidates…');
  const features = await searchNaipCandidates({ bbox: { west, south, east, north }, endpoint: manifest.providers.imagery });
  const picked = selectPinnedAcquisition(features, manifest);
  console.log(`  found ${features.length} candidates; pinned selection: ${picked.map((f) => f.id).join(', ')}`);

  for (const f of picked) {
    const url = assetHref(f);
    const { total, etag } = await assertCogDrift({ url });
    console.log(`  ${f.id}: ${(total / 1e6).toFixed(1)} MB, etag ${etag}`);
  }

  console.log('Smoke test OK — pinned NAIP items are reachable by range.');
}

main().catch((e) => { process.stderr.write(`${e.stack || e}\n`); process.exit(1); });
