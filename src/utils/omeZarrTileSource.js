import { openArray, HTTPStore } from 'zarr'

/**
 * Custom OpenSeadragon TileSource for OME-Zarr images
 */
export class OmeZarrTileSource {
  constructor(zarrUrl, options = {}) {
    this.zarrUrl = zarrUrl
    this.metadata = null
    this.zarrArrays = []
    this.tileCache = new Map()
    this.maxCacheSize = options.maxCacheSize || 100 // Maximum tiles to cache
    this.minValue = null
    this.maxValue = null
    this.autoNormalize = options.autoNormalize !== false // Default true
  }

  /**
   * Initialize and load OME-Zarr metadata
   */
  async initialize() {
    try {
      // Fetch the .zattrs metadata
      const zattrsUrl = `${this.zarrUrl}/.zattrs`
      console.log('Fetching metadata from:', zattrsUrl)

      const response = await fetch(zattrsUrl)

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: Failed to fetch .zattrs from ${zattrsUrl}. Check if nginx is running and CORS is configured.`,
        )
      }

      this.metadata = await response.json()
      console.log('OME-Zarr Metadata:', this.metadata)

      if (!this.metadata.multiscales || !this.metadata.multiscales[0]) {
        throw new Error('Invalid OME-Zarr metadata: missing multiscales')
      }

      // Get multiscales information
      const multiscales = this.metadata.multiscales[0]
      this.datasets = multiscales.datasets
      this.axes = multiscales.axes

      // Open zarr arrays for each resolution level
      for (const dataset of this.datasets) {
        console.log(`Loading resolution level: ${dataset.path}`)
        const store = new HTTPStore(`${this.zarrUrl}/${dataset.path}`, {
          fetchOptions: { mode: 'cors' },
        })

        try {
          const zarrArray = await openArray({ store })
          console.log(`Loaded array for ${dataset.path}:`, {
            shape: zarrArray.shape,
            chunks: zarrArray.chunks,
            dtype: zarrArray.dtype,
          })

          this.zarrArrays.push({
            path: dataset.path,
            array: zarrArray,
            scale: dataset.coordinateTransformations?.[0]?.scale || [1, 1, 1],
          })
        } catch (err) {
          console.error(`Failed to load zarr array for ${dataset.path}:`, err)
          throw new Error(`Failed to load zarr array for ${dataset.path}: ${err.message}`)
        }
      }

      console.log('Zarr arrays loaded:', this.zarrArrays.length)

      return this.createTileSource()
    } catch (error) {
      console.error('Error initializing OME-Zarr:', error)
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        zarrUrl: this.zarrUrl,
      })
      throw error
    }
  }

  /**
   * Create OpenSeadragon-compatible tile source configuration
   */
  createTileSource() {
    // Get highest resolution (level 0)
    const highestRes = this.zarrArrays[0]
    const shape = highestRes.array.shape
    const chunks = highestRes.array.chunks

    // Assuming shape is [channels, height, width] or [height, width]
    const hasChannels = shape.length === 3
    const height = hasChannels ? shape[1] : shape[0]
    const width = hasChannels ? shape[2] : shape[1]
    const tileWidth = hasChannels ? chunks[2] : chunks[1]
    const tileHeight = hasChannels ? chunks[1] : chunks[0]

    console.log('Image dimensions:', { width, height, tileWidth, tileHeight })
    console.log('Pyramid levels:', this.zarrArrays.length)

    // Store instance reference for closure
    const self = this

    const tileSource = {
      height: height,
      width: width,
      tileWidth: tileWidth,
      tileHeight: tileHeight,
      tileSize: Math.max(tileWidth, tileHeight),
      minLevel: 0,
      maxLevel: this.zarrArrays.length - 1,
      getTileUrl: function (level, x, y) {
        // Return a placeholder URL - actual loading happens in downloadTileStart
        return `tile://${level}/${x}/${y}`
      },
      downloadTileStart: function (context) {
        // Call the async tile loading method
        self.getTileImage(context).catch((error) => {
          console.error('Tile download failed:', error)
          context.finish(null, null, error.message)
        })
      },
    }

    return tileSource
  }

  /**
   * Get a tile and convert it to an image
   */
  async getTileImage(context) {
    const { level, x, y } = context.tile
    const cacheKey = `${level}-${x}-${y}`

    try {
      // Check cache first
      if (this.tileCache.has(cacheKey)) {
        const canvas = this.tileCache.get(cacheKey)
        const img = new Image()
        img.onload = function () {
          context.finish(img)
        }
        img.onerror = function () {
          context.finish(null, null, 'Failed to load cached tile')
        }
        img.src = canvas.toDataURL()
        return
      }

      console.log(`Loading tile: level=${level}, x=${x}, y=${y}`)

      // CRITICAL FIX: Invert level for OME-Zarr (level 0 = highest res in OME-Zarr)
      // OpenSeadragon: level 0 = lowest res, OME-Zarr: level 0 = highest res
      const zarrLevelIndex = this.zarrArrays.length - 1 - level

      if (zarrLevelIndex < 0 || zarrLevelIndex >= this.zarrArrays.length) {
        throw new Error(
          `Invalid zarr level index: ${zarrLevelIndex} (total levels: ${this.zarrArrays.length})`,
        )
      }

      const zarrLevel = this.zarrArrays[zarrLevelIndex]
      const array = zarrLevel.array
      const shape = array.shape
      const chunks = array.chunks

      const hasChannels = shape.length === 3
      const tileWidth = hasChannels ? chunks[2] : chunks[1]
      const tileHeight = hasChannels ? chunks[1] : chunks[0]

      // Read the chunk data
      let tileData
      if (hasChannels) {
        // Read single channel (0) for now - you can modify to blend RGB channels
        const channel = 0
        const yStart = y * tileHeight
        const xStart = x * tileWidth
        const yEnd = Math.min(yStart + tileHeight, shape[1])
        const xEnd = Math.min(xStart + tileWidth, shape[2])

        tileData = await array.get([channel, [yStart, yEnd], [xStart, xEnd]])
      } else {
        const yStart = y * tileHeight
        const xStart = x * tileWidth
        const yEnd = Math.min(yStart + tileHeight, shape[0])
        const xEnd = Math.min(xStart + tileWidth, shape[1])

        tileData = await array.get([
          [yStart, yEnd],
          [xStart, xEnd],
        ])
      }

      // Convert to canvas
      const canvas = this.dataToCanvas(tileData, tileWidth, tileHeight)

      // Cache the tile with size management
      this.addToCache(cacheKey, canvas)

      // Return as Image element for OpenSeadragon
      const img = new Image()
      img.onload = function () {
        console.log(`Tile loaded successfully: ${level}/${x}/${y}`)
        context.finish(img)
      }
      img.onerror = function (err) {
        console.error(`Image creation failed for tile ${level}/${x}/${y}:`, err)
        context.finish(null, null, 'Failed to create image from canvas')
      }
      img.src = canvas.toDataURL()
    } catch (error) {
      console.error(`Error loading tile ${level}/${x}/${y}:`, error)
      console.error('Tile error details:', {
        level,
        x,
        y,
        zarrLevelIndex: this.zarrArrays.length - 1 - level,
        totalLevels: this.zarrArrays.length,
        message: error.message,
        stack: error.stack,
      })
      context.finish(null, null, error.message || 'Unknown error')
    }
  }

  /**
   * Add tile to cache with size limit
   */
  addToCache(key, canvas) {
    // Remove oldest entry if cache is full (FIFO)
    if (this.tileCache.size >= this.maxCacheSize) {
      const firstKey = this.tileCache.keys().next().value
      this.tileCache.delete(firstKey)
    }
    this.tileCache.set(key, canvas)
  }

  /**
   * Convert array data to canvas with pixel normalization
   */
  dataToCanvas(data, width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    const imageData = ctx.createImageData(width, height)

    // Get actual dimensions from data
    const actualHeight = data.shape[0]
    const actualWidth = data.shape[1]

    // Auto-compute min/max for normalization if enabled
    let min = this.minValue
    let max = this.maxValue

    if (this.autoNormalize && (min === null || max === null)) {
      min = Infinity
      max = -Infinity
      for (let y = 0; y < actualHeight; y++) {
        for (let x = 0; x < actualWidth; x++) {
          const value = data.get(y, x)
          if (value < min) min = value
          if (value > max) max = value
        }
      }
      // Cache the values for consistent normalization
      if (this.minValue === null) this.minValue = min
      if (this.maxValue === null) this.maxValue = max

      console.log('Auto-normalized pixel range:', { min, max })
    }

    // Use stored values if available
    min = this.minValue || min || 0
    max = this.maxValue || max || 255
    const range = max - min || 1 // Avoid division by zero

    // Convert grayscale to RGBA with normalization
    for (let y = 0; y < actualHeight; y++) {
      for (let x = 0; x < actualWidth; x++) {
        const rawValue = data.get(y, x)
        // Normalize to 0-255 range
        const normalizedValue = Math.min(255, Math.max(0, ((rawValue - min) / range) * 255))
        const value = Math.round(normalizedValue)

        const idx = (y * actualWidth + x) * 4
        imageData.data[idx] = value // R
        imageData.data[idx + 1] = value // G
        imageData.data[idx + 2] = value // B
        imageData.data[idx + 3] = 255 // A
      }
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  /**
   * Get OME metadata (channels, etc.)
   */
  getOmeroMetadata() {
    return this.metadata?.omero || null
  }
}

/**
 * Factory function to create and initialize OME-Zarr tile source
 */
export async function createOmeZarrTileSource(zarrUrl, options = {}) {
  const tileSource = new OmeZarrTileSource(zarrUrl, options)
  await tileSource.initialize()
  return tileSource
}
