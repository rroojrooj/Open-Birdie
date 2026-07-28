# Curated course presentation

This directory contains reviewed authoring inputs. The app does not read it at
runtime. Run `npm run prepare:course-art` to validate and stage the closed runtime
tree under `build/course-art`.

Each pack is selected by stable OpenStreetMap identity. Legacy names are only a
geographically bounded migration aid. `references.json` records authoring
provenance and is intentionally excluded from staged and packaged output.

Assets must be local, self-contained PNG/JPEG/WebP/KTX2/GLB files. The staging
command validates path ownership, magic bytes, dimensions, structure, hashes, and
budgets before atomically publishing the runtime tree.
