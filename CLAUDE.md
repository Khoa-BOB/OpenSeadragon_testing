# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install          # Install dependencies
npm run dev          # Dev server with hot reload
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Run oxlint then eslint (both with --fix)
npm run format       # Prettier format src/
```

No test runner is configured in this project.

## Architecture

This is a Vue 3 + Vite single-page application for viewing large microscopy images (DZI and OME-Zarr formats), developed in context of St. Jude research.

### Routing

There is a single route (`/`) mapped to `src/views/OpenSeadragonTest.vue`. `src/App.vue` is a thin shell containing only `<RouterView />`.

### Core Files

**`src/views/OpenSeadragonTest.vue`** — The main (and only) view. Initializes an OpenSeadragon viewer pointing to a DZI image served by nginx at `http://localhost:8080/dzi/mosaic.dzi`. Contains:
- A canvas-based heatmap overlay rendered on top of the OSD viewer (`createHeatmapOverlay`)
- Mouse coordinate tracking in image pixel space (`setupMouseTracking`)
- Heatmap point management (add/remove/clear points with X, Y, and intensity `w`)

**`src/utils/omeZarrTileSource.js`** — Custom OpenSeadragon tile source for OME-Zarr images (alternative to DZI). Key details:
- `OmeZarrTileSource` class: fetches `.zattrs`, opens zarr arrays for each resolution level via `zarr.js`
- Level inversion: OSD level 0 = lowest res, OME-Zarr level 0 = highest res — handled by `zarrLevelIndex = total - 1 - level`
- Renders single channel (channel 0) as grayscale with auto min/max normalization per tile
- FIFO tile cache (default 100 tiles)
- `createOmeZarrTileSource(zarrUrl, options)` is the factory function to use from components

### External Dependencies for Runtime

The viewer expects nginx running at `http://localhost:8080` with:
- DZI files at `/dzi/` (e.g., `/dzi/mosaic.dzi`)
- OME-Zarr files at `/zarr/` (e.g., `/zarr/mosaic.ome.zarr`) with CORS headers

### Module Alias

`@` resolves to `./src` (configured in `vite.config.js`).

### Linting

Two linters run in sequence: `oxlint` first, then `eslint`. Both are configured to auto-fix. Prettier is separate (`npm run format`).
