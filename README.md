# ⛳ Open-Birdie

A golf course simulator built entirely on **open data and free infrastructure**, playable
with any launch monitor that speaks the **GSPro Open Connect** protocol — including the
**Uneekor EYEMINI LITE** via Uneekor VIEW + GSPconnect.

- **Real courses** from OpenStreetMap (fairways, greens, bunkers, water, trees, hole routings)
- **Real terrain** from AWS Terrain Tiles open elevation data — slopes affect flight, bounce, roll, and putts
- **Real physics** — drag + Magnus lift flight model calibrated against tour launch-monitor numbers,
  spin-axis draws/fades, backspin zip-back on greens, gravity-fed breaks on slopes
- **Full round play** — 18 holes, scorecard with a round-complete summary, pick up to bail on a hole, water/OB penalties, gimmes, cup capture
- Desktop app (Electron) — no browser needed; a tablet/phone on the same network can mirror via the built-in web server (set `BIRDIE_HOST=0.0.0.0` to allow LAN access — localhost-only by default)

> **Independent open-source project — not affiliated with, endorsed by, or sponsored by
> Uneekor, GSPro, TrackMan, OpenStreetMap, or AWS.** All trademarks belong to their
> respective owners and are used nominatively for interoperability only. Provided **"AS IS",
> with no warranty and no liability** — see **[DISCLAIMER.md](DISCLAIMER.md)** and **[LICENSE](LICENSE)**.
> Golf is a physical activity that can cause injury or property/equipment damage; **use at your own risk.**

## Install

Download the latest **Open-Birdie-Setup-_x.y.z_.exe** from
[Releases](https://github.com/rroojrooj/Open-Birdie/releases) and run it. It installs
per-user (no admin prompt), adds Start Menu + desktop shortcuts, and launches when done.

Open-Birdie isn't code-signed yet, so the first run trips Windows SmartScreen
("Windows protected your PC"). Click **More info → Run anyway** — it's a one-time prompt.

## Launch

Double-click **Open-Birdie** on the Desktop, or from this folder:

```
npm start            # desktop app
npm run start:server # headless server only (view at http://localhost:8222)
```

## Connect your Uneekor EYEMINI LITE

1. **Close GSPro if it's running** — Open-Birdie listens on the same port (TCP 921).
   The console will say `Port 921 is in use` if there's a clash.
2. Start Open-Birdie.
3. In **Uneekor VIEW**, pick **GSPro** as the connected sim, exactly as you do today.
   GSPconnect will connect to `127.0.0.1:921` and find Open-Birdie answering.
4. The **LM badge** (top right) turns green when GSPconnect connects. Hit balls.

> **Using the free bridge (no GSPconnect)?** The desktop app auto-starts the bundled
> Uneekor VIEW feed bridge ([`tools/uneekor-watch.js`](tools/uneekor-watch.js)) whenever it
> finds your VIEW `ShotData` folder — the LM badge goes green by itself, just swing. No paid
> GSPconnect needed. Set `BIRDIE_NO_WATCH=1` to turn it off. (Headless `npm run start:server`
> users: run `npm run watch` alongside it.)

Everything runs on this PC; no firewall changes needed. (If GSPconnect ever runs on a
*different* PC, allow inbound TCP 921 in Windows Firewall.)

## Playing

| Control | Action |
| --- | --- |
| Mouse drag / wheel | look around / zoom (between shots) |
| AIM slider | rotate the aim line (shots are relative to it) |
| Club buttons | tells GSPconnect your club; also loads practice presets |
| Practice shot | hit simulated shots without the launch monitor |
| Course button | search and load any OSM-mapped course |
| Next ▶ / Pick up | advance to the next hole; pick up to concede a hole you aren't finishing |
| Hole pills / HOLE | tap a played hole to review it on the scorecard |
| Scorecard | scores, round-complete summary, restart / new round |
| F11 | toggle fullscreen |

Putts are detected automatically when on the green (low speed + low launch).
Anything stopped inside the gimme distance (8 ft default) is conceded for +1 stroke.
A ball rolled near the cup at holeable speed drops in.

## Courses

Search by name (e.g. *St Andrews Old Course*, *Pebble Beach Golf Links*). Quality depends on
OpenStreetMap mapping — famous courses are usually excellent. A course needs `golf=hole`
routing lines to be playable; the loader tells you if they're missing. First load downloads
geometry + elevation (10–90 s) and caches it in `data/courses/` — afterwards it's instant
and works offline.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `BIRDIE_PORT` | 8222 | web UI / API port |
| `BIRDIE_OC_PORT` | 921 | GSPro Open Connect listener |
| `BIRDIE_HOST` | 127.0.0.1 | web UI/API bind address. Localhost-only by default (the API is unauthenticated); set `0.0.0.0` to mirror on your LAN — **trusted networks only** |
| `BIRDIE_SPEED_SCALE` | 1 | multiplier for incoming ball speed; set `2.23694` if your monitor reports m/s (shots play ~2.2× short otherwise) |
| `BIRDIE_NO_WATCH` | (unset) | set to `1` to skip auto-starting the Uneekor VIEW feed bridge |

Gimme distance: `POST /api/settings {"gimmeYd": feet}` (UI toggle coming later).

## Dev tools

```
npm run calibrate                  # flight model vs tour TrackMan targets
node tools/test-shot.js driver     # fake GSPconnect shot over real TCP 921
node tools/test-shot.js --speed 150 --vla 13 --spin 2700 --axis -4
node tools/test-load.js "Course name"   # test course download/parse
```

## Open data credits

- Course geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
  via [Overpass API](https://overpass-api.de/) and [Nominatim](https://nominatim.org/)
- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen terrarium)

## Known limitations / roadmap

- Visuals are "good indie sim" tier, not premium-sim grade: flat-shaded splat terrain, low-poly trees.
  Next: grass textures, normal maps, better tree models, bunker depth.
- Driver apex runs ~15% high vs tour averages (carries are calibrated within ~3%).
- Pin positions come from OSM hole lines (one per green; double greens use the mapped point).
- No wind UI yet (the physics supports it).

## License & disclaimer

Open-Birdie is free and open-source software under the **[MIT License](LICENSE)**.

It is an **independent project, not affiliated with, authorized by, or endorsed by** Uneekor,
GSPro, TrackMan, the OpenStreetMap Foundation, AWS, or any other referenced party. The Software
implements the publicly documented GSPro Open Connect interface for interoperability and contains
no third-party proprietary code or assets. All product names and trademarks are the property of
their respective owners and are used solely nominatively.

The Software is provided **"AS IS", without warranty of any kind**, and the authors accept
**no liability** for any damages, personal injury, or damage to equipment or property arising
from its use. **You** are responsible for your own safety and for complying with the terms of
service / EULAs of your launch monitor, its first-party software, and every third-party data
source the app contacts (OpenStreetMap/ODbL, Overpass, Nominatim, AWS Terrain Tiles).

Read the full terms in **[DISCLAIMER.md](DISCLAIMER.md)**
