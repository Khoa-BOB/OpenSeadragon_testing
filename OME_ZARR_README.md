# OME-Zarr Viewer with OpenSeadragon

This project includes a custom OpenSeadragon viewer for OME-Zarr images served via nginx.

## Setup

### 1. Dependencies

The project uses:

- `openseadragon` - For tile-based image viewing
- `zarr@0.6.3` - For reading Zarr format data

Dependencies are already installed via `package.json`.

### 2. Nginx Configuration

Ensure your nginx server is configured to serve the OME-Zarr files with CORS headers:

```nginx
location /zarr/ {
    alias /path/to/your/zarr/files/;
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods 'GET, OPTIONS';
    add_header Access-Control-Allow-Headers 'Range';
}
```

### 3. OME-Zarr Structure

The viewer expects OME-Zarr images with the following structure:

```
mosaic.ome.zarr/
├── .zattrs          # Metadata (multiscales, omero)
├── 0/               # Highest resolution
│   ├── .zarray     # Array metadata
│   └── c.y.x       # Chunks (channel.row.col)
├── 1/               # Resolution level 1
├── 2/               # Resolution level 2
└── ...
```

## Usage

### Basic Usage

The viewer is implemented in `src/views/OpenSeadragonTest.vue`:

```vue
<script setup>
import { createOmeZarrTileSource } from '../utils/omeZarrTileSource.js'

// URL to your OME-Zarr image
const zarrUrl = 'http://localhost:8080/zarr/mosaic.ome.zarr'

// Create and initialize the tile source
const omeZarrSource = await createOmeZarrTileSource(zarrUrl)
const tileSourceConfig = omeZarrSource.createTileSource()
</script>
```

### Customization

#### Change the Zarr URL

Edit the `zarrUrl` in [OpenSeadragonTest.vue](src/views/OpenSeadragonTest.vue#L23):

```javascript
const zarrUrl = 'http://localhost:8080/zarr/your-image.ome.zarr'
```

#### Adjust OpenSeadragon Settings

Modify the viewer configuration in [OpenSeadragonTest.vue](src/views/OpenSeadragonTest.vue#L32-L47):

```javascript
const viewer = OpenSeadragon({
  id: 'openseadragon-viewer',
  showNavigator: true, // Show mini-map navigator
  animationTime: 0.5, // Animation duration
  maxZoomPixelRatio: 2, // Maximum zoom level
  // ... more options
})
```

#### Channel Rendering

Currently, the viewer renders a single channel (channel 0) as grayscale. To change this, edit `getTileImage()` in [omeZarrTileSource.js](src/utils/omeZarrTileSource.js#L88-L101):

```javascript
// Read different channel
const channel = 1 // Change to 1 or 2 for other channels

// Or blend multiple channels (RGB)
// You would need to modify dataToCanvas() to handle RGB data
```

## Architecture

### Components

1. **OmeZarrTileSource** (`src/utils/omeZarrTileSource.js`)
   - Loads OME-Zarr metadata
   - Opens Zarr arrays for each resolution level
   - Provides tiles to OpenSeadragon on demand
   - Caches tiles for performance

2. **OpenSeadragonTest.vue** (`src/views/OpenSeadragonTest.vue`)
   - Vue component that initializes the viewer
   - Handles loading states and errors
   - Displays the OME-Zarr image

### How It Works

1. **Initialization**:
   - Fetches `.zattrs` metadata from nginx
   - Parses multiscales pyramid structure
   - Opens Zarr arrays for each resolution level using zarr.js

2. **Tile Loading**:
   - OpenSeadragon requests tiles for the current viewport
   - `getTileImage()` reads the appropriate Zarr chunk
   - Chunk data is decoded (blosc/lz4 compression)
   - Data is converted to a canvas and returned as image

3. **Caching**:
   - Tiles are cached in memory to avoid re-fetching
   - Cache key: `${level}-${x}-${y}`

## Troubleshooting

### CORS Errors

If you see CORS errors in the console:

- Verify nginx CORS headers are set correctly
- Check that nginx is running: `curl http://localhost:8080/zarr/mosaic.ome.zarr/.zattrs`

### Tiles Not Loading

- Open browser console and check for errors
- Verify the Zarr URL is correct
- Check network tab to see if chunks are being fetched
- Ensure `.zarray` and `.zattrs` files are accessible

### Performance Issues

- Reduce tile cache if memory is limited
- Adjust `maxZoomPixelRatio` to limit maximum zoom
- Consider serving Zarr files with HTTP/2 for better performance

## Future Enhancements

Potential improvements:

- [ ] RGB channel blending for multi-channel images
- [ ] Channel selection UI
- [ ] Contrast/brightness adjustment
- [ ] Support for different data types (uint16, float32, etc.)
- [ ] Web Worker for chunk decoding
- [ ] Progressive tile loading
- [ ] Multi-image viewer (side-by-side comparison)

## References

- [OpenSeadragon Documentation](https://openseadragon.github.io/)
- [OME-Zarr Specification](https://ngff.openmicroscopy.org/)
- [zarr.js Documentation](https://github.com/freeman-lab/zarr.js)
