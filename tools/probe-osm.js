'use strict';
// One-off probe: how big is the picked course way's polygon, and how many
// golf=hole ways fall strictly inside it (Overpass poly filter)?
const WAY_ID = +(process.argv[2] || 1019045811);

(async () => {
  const op = async (q) => {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'Open-Birdie/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return res.json();
  };

  const r1 = await op(`[out:json];way(${WAY_ID});out tags geom;`);
  const way = r1.elements[0];
  console.log('tags:', JSON.stringify(way.tags));
  const lats = way.geometry.map((g) => g.lat), lons = way.geometry.map((g) => g.lon);
  const dlat = Math.max(...lats) - Math.min(...lats), dlon = Math.max(...lons) - Math.min(...lons);
  console.log(`polygon: ${way.geometry.length} pts, bbox ${(dlat * 111).toFixed(2)} x ${(dlon * 111 * Math.cos(lats[0] * Math.PI / 180)).toFixed(2)} km`);

  // poly filter wants "lat lon lat lon ..."; thin the ring to <=150 pts
  const step = Math.ceil(way.geometry.length / 150);
  const ring = way.geometry.filter((_, i) => i % step === 0);
  const polyStr = ring.map((g) => `${g.lat} ${g.lon}`).join(' ');
  const r2 = await op(`[out:json];way["golf"="hole"](poly:"${polyStr}");out tags;`);
  const refs = r2.elements.map((e) => (e.tags || {}).ref).sort((a, b) => a - b);
  console.log(`holes strictly inside polygon: ${r2.elements.length}`);
  console.log('refs:', refs.join(','));
  console.log('names:', r2.elements.slice(0, 6).map((e) => (e.tags || {}).name).join(' | '));
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
