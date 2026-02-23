<template>
  <div class="openseadragon-viewer">
    <h1>OpenSeadragon DZI Viewer</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <!-- ── Drawing Controls ─────────────────────────────────────────────────── -->
    <!-- In draw mode the canvas captures pointer events and OSD pan/zoom is   -->
    <!-- suspended, letting the user draw freely on the image.                 -->
    <div class="drawing-controls" :class="{ 'draw-mode-active': drawMode }">
      <h3>Hand Drawing</h3>
      <div class="controls-row">
        <!-- Clicking this button toggles between draw mode and normal navigation -->
        <button @click="toggleDrawMode" :class="['draw-toggle-btn', { active: drawMode }]">
          {{ drawMode ? '✎ Stop Drawing' : '✎ Start Drawing' }}
        </button>

        <div class="input-group">
          <label>Pen Color:</label>
          <!-- Native colour picker; v-model keeps drawColor in sync -->
          <input v-model="drawColor" type="color" class="color-picker" title="Pick pen colour" />
        </div>

        <div class="input-group">
          <!-- Show current value inline so the user doesn't need to guess -->
          <label>Pen Width: {{ drawLineWidth }}px</label>
          <input
            v-model.number="drawLineWidth"
            type="range"
            min="1"
            max="20"
            step="1"
            class="width-slider"
          />
        </div>

        <!-- Removes the last committed stroke (most-recent-first undo) -->
        <button @click="undoLastStroke" class="undo-btn" :disabled="strokes.length === 0">
          Undo
        </button>
        <button @click="clearAllStrokes" class="clear-btn" :disabled="strokes.length === 0">
          Clear All
        </button>
      </div>

      <!-- Status bar: usage hint in draw mode, stroke count when idle -->
      <div class="drawing-status">
        <template v-if="drawMode">
          Draw mode active — click and drag on the image to draw. Click "Stop Drawing" to resume
          panning.
        </template>
        <template v-else>
          {{ strokes.length }} stroke{{ strokes.length !== 1 ? 's' : '' }} drawn. Click "Start
          Drawing" to annotate.
        </template>
      </div>
    </div>

    <!-- ── ROI Controls ──────────────────────────────────────────────────── -->
    <!-- All coordinates are in image pixel space (same system as mouse display). -->
    <div class="roi-controls">
      <h3>Regions of Interest (ROI)</h3>
      <div class="controls-row">
        <div class="input-group">
          <label>X:</label>
          <input v-model.number="newRoi.x" type="number" placeholder="X (top-left)" />
        </div>
        <div class="input-group">
          <label>Y:</label>
          <input v-model.number="newRoi.y" type="number" placeholder="Y (top-left)" />
        </div>
        <div class="input-group">
          <label>Width:</label>
          <input v-model.number="newRoi.width" type="number" placeholder="Width" />
        </div>
        <div class="input-group">
          <label>Height:</label>
          <input v-model.number="newRoi.height" type="number" placeholder="Height" />
        </div>
        <div class="input-group">
          <label>Label:</label>
          <!-- Leave blank to auto-generate "ROI N" -->
          <input v-model="newRoi.label" type="text" placeholder="(auto)" class="label-input" />
        </div>
        <button @click="addRoi" class="add-btn">Add ROI</button>
        <button @click="clearAllRois" class="clear-btn">Clear All</button>
        <!-- Populates X/Y from the current mouse position over the viewer -->
        <button @click="useMouseCoordsForRoi" class="use-coords-btn" :disabled="mouseCoords.x === null">
          Use Mouse Coords
        </button>
      </div>

      <!-- List of existing ROIs with their colour swatch and a remove button -->
      <div v-if="roiList.length > 0" class="points-list">
        <div v-for="(roi, index) in roiList" :key="index" class="point-item">
          <span class="roi-color-swatch" :style="{ backgroundColor: roi.color }"></span>
          <span>
            {{ roi.label }}: ({{ roi.x }}, {{ roi.y }}) &nbsp; {{ roi.width }}×{{ roi.height }} px
          </span>
          <button @click="removeRoi(index)" class="remove-btn">×</button>
        </div>
      </div>
      <div v-else class="no-points">
        No ROIs added yet. Enter image-pixel coordinates and dimensions, then click "Add ROI".
      </div>
    </div>

    <div id="viewer" class="viewer-container">
      <!-- Coordinate Display Overlay -->
      <div v-if="mouseCoords.x !== null" class="coord-display">
        X: {{ mouseCoords.x }} | Y: {{ mouseCoords.y }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import OpenSeadragon from 'openseadragon'

const dziUrl = ref('http://localhost:8080/dzi/')
const error = ref(null)
let viewer = null

// ─── Drawing State ────────────────────────────────────────────────────────────
// Each stroke: { points: [{x, y}], color, lineWidth }
// Points are stored in IMAGE PIXEL space so they remain anchored to the image
// regardless of how the user pans or zooms.
const strokes = ref([])          // all committed (finished) strokes
const drawMode = ref(false)      // true while the user is in freehand draw mode
const drawColor = ref('#FF4444') // active pen colour (hex string)
const drawLineWidth = ref(3)     // active pen width in screen pixels
let drawingOverlay = null        // handle returned by createDrawingOverlay()

// Mouse coordinates tracking
const mouseCoords = ref({
  x: null,
  y: null,
})

// ─── ROI State ───────────────────────────────────────────────────────────────
// Each ROI object: { x, y, width, height, label, color }
// x/y are the top-left corner in image pixel space; width/height are in image pixels.
const roiList = ref([])
const newRoi = ref({ x: 0, y: 0, width: 100, height: 100, label: '' })
let roiOverlay = null

// Colour palette — automatically cycles when more ROIs are added than colours
const ROI_COLORS = ['#FF4444', '#44BBFF', '#44FF88', '#FFCC00', '#FF44FF', '#FF8800']

// ─── Drawing Management Functions ────────────────────────────────────────────

// Toggle draw mode on/off.
// When active: the drawing canvas captures pointer events and OSD pan/zoom is
// suspended so the user can draw without accidentally moving the image.
function toggleDrawMode() {
  drawMode.value = !drawMode.value
  if (drawingOverlay) {
    drawingOverlay.setDrawMode(drawMode.value)
  }
}

// Remove the most recently committed stroke (undo, last-in-first-out).
function undoLastStroke() {
  if (strokes.value.length === 0) return
  strokes.value = strokes.value.slice(0, -1)
  // Redraw so the removed stroke disappears immediately
  if (drawingOverlay) {
    drawingOverlay.redraw()
  }
}

// Erase every stroke and clear the drawing canvas.
function clearAllStrokes() {
  strokes.value = []
  if (drawingOverlay) {
    drawingOverlay.redraw()
  }
}

// ─── ROI Management Functions ─────────────────────────────────────────────────

// Build a new ROI object from the form and push it onto the list.
function addRoi() {
  if (!newRoi.value.width || !newRoi.value.height) {
    alert('Please enter valid width and height')
    return
  }

  const roi = {
    x: newRoi.value.x,
    y: newRoi.value.y,
    width: newRoi.value.width,
    height: newRoi.value.height,
    // Auto-generate a numbered label when the user leaves the field blank
    label: newRoi.value.label.trim() || `ROI ${roiList.value.length + 1}`,
    // Pick the next colour in the palette (wraps around)
    color: ROI_COLORS[roiList.value.length % ROI_COLORS.length],
  }

  roiList.value.push(roi)

  // Tell the canvas overlay to re-render with the updated list
  if (roiOverlay) {
    roiOverlay.setRois(roiList.value)
  }

  console.log('Added ROI:', roi)
}

// Copy the current mouse image-pixel position into the ROI origin inputs.
// Lets the user hover over the desired top-left corner and click this button.
function useMouseCoordsForRoi() {
  if (mouseCoords.value.x !== null && mouseCoords.value.y !== null) {
    newRoi.value.x = mouseCoords.value.x
    newRoi.value.y = mouseCoords.value.y
  }
}

// Remove a single ROI by its index in roiList
function removeRoi(index) {
  roiList.value.splice(index, 1)

  if (roiOverlay) {
    roiOverlay.setRois(roiList.value)
  }
}

// Remove every ROI at once and clear the overlay
function clearAllRois() {
  roiList.value = []

  if (roiOverlay) {
    roiOverlay.setRois([])
  }
}

// ─── ROI Canvas Overlay ───────────────────────────────────────────────────────
// Creates a transparent <canvas> that floats directly above the OSD viewer.
// On every pan/zoom event the canvas is cleared and all ROI rectangles are
// re-projected from image pixel coordinates into the current canvas pixel space.
function createRoiOverlay(viewer) {
  const container = viewer.container

  // The canvas uses position:absolute so the parent must be position:relative.
  if (!container.style.position || container.style.position === 'static') {
    container.style.position = 'relative'
  }

  // A full-size transparent canvas that forwards all pointer events to OSD.
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.left = '0'
  canvas.style.top = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'none' // pan/zoom gestures pass through to OSD
  canvas.style.zIndex = '1001'        // sits above the heatmap canvas (z-index 1000)
  canvas.id = 'roi-overlay'
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  let rois = [] // reference to the current array of ROI objects

  // Match the canvas's internal pixel buffer to its CSS display size.
  // Must be called before every draw to stay in sync after window resizes.
  function resize() {
    const r = container.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(r.width))
    canvas.height = Math.max(1, Math.floor(r.height))
  }

  // Convert a point from image pixel space to canvas pixel space.
  // OSD coordinate pipeline:
  //   image px  →  viewport (normalised 0–1)  →  canvas px
  function imagePointToCanvasPx(x, y) {
    const vpPoint = viewer.viewport.imageToViewportCoordinates(x, y)
    const px = viewer.viewport.pixelFromPoint(vpPoint, true)
    return { x: px.x, y: px.y }
  }

  function redraw() {
    resize()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Guard: nothing to draw if viewport is not ready or no ROIs exist
    if (!viewer.viewport || rois.length === 0) return

    for (const roi of rois) {
      // Project the two defining corners into canvas space.
      // This automatically reflects the current zoom/pan state so ROIs
      // always appear exactly over the correct region of the image.
      const topLeft = imagePointToCanvasPx(roi.x, roi.y)
      const bottomRight = imagePointToCanvasPx(roi.x + roi.width, roi.y + roi.height)

      const rectX = topLeft.x
      const rectY = topLeft.y
      const rectW = bottomRight.x - topLeft.x
      const rectH = bottomRight.y - topLeft.y

      // ── Semi-transparent fill ─────────────────────────────────────────────
      // Appending '22' to a 6-digit hex colour gives ~13 % opacity (hex 0x22 = 34/255).
      ctx.fillStyle = roi.color + '22'
      ctx.fillRect(rectX, rectY, rectW, rectH)

      // ── Solid border ──────────────────────────────────────────────────────
      ctx.strokeStyle = roi.color
      ctx.lineWidth = 2
      ctx.setLineDash([]) // ensure a solid line (reset any leftover dash pattern)
      ctx.strokeRect(rectX, rectY, rectW, rectH)

      // ── Label badge ───────────────────────────────────────────────────────
      // Measure text width so the coloured background pill fits snugly.
      ctx.font = 'bold 13px sans-serif'
      const textWidth = ctx.measureText(roi.label).width

      // Coloured pill drawn above the top-left corner for readability.
      // 'CC' suffix = ~80 % opacity.
      ctx.fillStyle = roi.color + 'CC'
      ctx.fillRect(rectX, rectY - 20, textWidth + 8, 20)

      // White text sits on top of the coloured pill.
      ctx.fillStyle = '#ffffff'
      ctx.fillText(roi.label, rectX + 4, rectY - 5)
    }
  }

  // Replace the current ROI list and immediately re-render.
  // Called whenever the user adds, removes, or clears ROIs.
  function setRois(newRois) {
    rois = newRois || []
    redraw()
  }

  resize() // establish initial canvas dimensions

  // Re-render whenever OSD changes the view (pan, zoom, rotate, open, resize)
  viewer.addHandler('animation', redraw)
  viewer.addHandler('resize', redraw)

  // Keep in sync when the browser window itself is resized
  const roiResizeHandler = () => {
    resize()
    redraw()
  }
  window.addEventListener('resize', roiResizeHandler)

  return {
    canvas,
    setRois,
    redraw,
    destroy: () => {
      window.removeEventListener('resize', roiResizeHandler)
      canvas.remove()
    },
  }
}

// ─── Drawing Canvas Overlay ───────────────────────────────────────────────────
// Creates a transparent <canvas> that sits above all other overlays.
// In draw mode it captures pointer events so the user can paint strokes;
// in navigation mode it passes all events through to OSD.
// Strokes are stored in image pixel space and re-projected each frame,
// so they stay perfectly aligned with the image during pan/zoom.
function createDrawingOverlay(viewer) {
  const container = viewer.container

  // position:relative is required so the absolute canvas stays inside the viewer.
  if (!container.style.position || container.style.position === 'static') {
    container.style.position = 'relative'
  }

  // Full-size canvas, initially invisible to pointer events (navigation mode).
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.left = '0'
  canvas.style.top = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'none' // toggled to 'auto' in draw mode
  canvas.style.zIndex = '1002'        // above ROI (1001) and heatmap (1000) overlays
  canvas.id = 'drawing-overlay'
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  let liveStroke = null     // the stroke currently being drawn (not yet committed)
  let isPointerDown = false // true while a pointer button is held

  // Resize the canvas buffer to match its CSS display size.
  // Setting canvas.width/height clears the canvas, so this must be called at
  // the start of every redraw() to avoid blur on non-1× DPR displays.
  function resize() {
    const r = container.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(r.width))
    canvas.height = Math.max(1, Math.floor(r.height))
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  // Image pixel → canvas pixel (used when RENDERING stored strokes).
  // Pipeline: image px → viewport (normalised 0–1) → canvas px
  function imageToCanvas(x, y) {
    const vp = viewer.viewport.imageToViewportCoordinates(x, y)
    const px = viewer.viewport.pixelFromPoint(vp, true)
    return { x: px.x, y: px.y }
  }

  // Canvas pixel → image pixel (used when RECORDING pointer positions).
  // Pipeline: canvas px → viewport (normalised) → image px
  // Because the canvas fills the viewer container, canvas-relative coords equal
  // viewer-container-relative coords, so we can pass them directly to OSD.
  function canvasToImage(cx, cy) {
    const vp = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(cx, cy))
    const img = viewer.viewport.viewportToImageCoordinates(vp)
    return { x: img.x, y: img.y }
  }

  // ── Stroke rendering ──────────────────────────────────────────────────────

  // Draw one stroke onto the canvas.
  // Points are in image pixel space; imageToCanvas() projects them each frame
  // so the path tracks the image during pan/zoom automatically.
  function drawStroke(stroke) {
    if (!stroke || stroke.points.length < 2) return

    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.lineWidth
    ctx.lineCap = 'round'  // smooth, rounded stroke ends
    ctx.lineJoin = 'round' // smooth joins at every bend

    ctx.beginPath()
    const first = imageToCanvas(stroke.points[0].x, stroke.points[0].y)
    ctx.moveTo(first.x, first.y)

    for (let i = 1; i < stroke.points.length; i++) {
      const pt = imageToCanvas(stroke.points[i].x, stroke.points[i].y)
      ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()
  }

  // Clear and repaint every stroke.
  // Called on every OSD animation frame and whenever strokes are added/removed.
  function redraw() {
    resize() // resize always comes first to clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!viewer.viewport) return

    // Re-project and draw all committed strokes
    for (const stroke of strokes.value) {
      drawStroke(stroke)
    }

    // Draw the in-progress stroke at reduced opacity so the user can see it is
    // a "live preview" and not yet committed.
    if (liveStroke) {
      ctx.globalAlpha = 0.75
      drawStroke(liveStroke)
      ctx.globalAlpha = 1.0
    }
  }

  // ── Pointer event handlers ────────────────────────────────────────────────
  // These only fire when canvas.style.pointerEvents === 'auto' (draw mode).

  function onPointerDown(e) {
    e.preventDefault()
    // Pointer capture ensures we keep receiving pointermove/up even if the
    // cursor leaves the canvas element during a fast drag.
    canvas.setPointerCapture(e.pointerId)
    isPointerDown = true

    // Convert the click position to image coordinates and start a new stroke.
    const rect = canvas.getBoundingClientRect()
    const { x, y } = canvasToImage(e.clientX - rect.left, e.clientY - rect.top)
    liveStroke = {
      points: [{ x, y }],
      color: drawColor.value,
      lineWidth: drawLineWidth.value,
    }
    redraw()
  }

  function onPointerMove(e) {
    if (!isPointerDown || !liveStroke) return
    e.preventDefault()

    const rect = canvas.getBoundingClientRect()
    const { x, y } = canvasToImage(e.clientX - rect.left, e.clientY - rect.top)

    // Only append a point when the pointer has moved by more than half a pixel
    // in image space — avoids duplicate points and keeps stroke data compact.
    const last = liveStroke.points.at(-1)
    if (Math.abs(x - last.x) > 0.5 || Math.abs(y - last.y) > 0.5) {
      liveStroke.points.push({ x, y })
      redraw()
    }
  }

  function onPointerUp(e) {
    if (!isPointerDown) return
    isPointerDown = false

    // Commit the stroke only when it contains at least two distinct points
    // (a single tap produces only one point and should be ignored).
    if (liveStroke && liveStroke.points.length >= 2) {
      // Spread into a new array so Vue's reactivity detects the change
      // and the stroke count in the UI updates immediately.
      strokes.value = [...strokes.value, liveStroke]
    }
    liveStroke = null
    redraw()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  // pointercancel fires on mobile when the OS interrupts (e.g. incoming call);
  // treat it the same as pointerup so we don't get a stuck liveStroke.
  canvas.addEventListener('pointercancel', onPointerUp)

  // Re-project all strokes whenever OSD changes the view (pan, zoom, rotate)
  viewer.addHandler('animation', redraw)
  viewer.addHandler('resize', redraw)

  const drawResizeHandler = () => { resize(); redraw() }
  window.addEventListener('resize', drawResizeHandler)

  resize() // establish the initial canvas dimensions

  return {
    redraw,

    // Toggle draw mode on or off.
    // active = true  → canvas intercepts pointer events, OSD navigation paused
    // active = false → canvas passes through events, OSD navigation resumed
    setDrawMode(active) {
      canvas.style.pointerEvents = active ? 'auto' : 'none'
      // Suspend OSD's built-in pan/zoom while drawing so mouse events are not
      // consumed by both the drawing canvas and the viewer simultaneously.
      viewer.setMouseNavEnabled(!active)
      // Crosshair cursor in draw mode gives the user clear visual feedback.
      canvas.style.cursor = active ? 'crosshair' : 'default'
    },

    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('resize', drawResizeHandler)
      // Always restore OSD navigation when the component unmounts
      viewer.setMouseNavEnabled(true)
      canvas.remove()
    },
  }
}

function loadImage() {
  error.value = null

  try {
    if (!viewer) {
      // Initialize OpenSeadragon viewer
      viewer = OpenSeadragon({
        id: 'viewer',
        prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
        tileSources: 'http://localhost:8080/dzi/mosaic.dzi',

        // Show built-in navigation controls
        showNavigator: true,
        navigatorPosition: 'BOTTOM_RIGHT',
        showZoomControl: true,
        showHomeControl: true,
        showFullPageControl: true,

        // Show built-in rotation controls
        showRotationControl: true,
        showFlipControl: true,

        // Show sequence controls (for multi-image collections)
        showSequenceControl: false,

        // Enable rotation and flipping
        degrees: 0,

        // Animation settings
        animationTime: 0.5,
        blendTime: 0.1,
        maxZoomPixelRatio: 2,
        minZoomLevel: 0.5,
        visibilityRatio: 1,
        constrainDuringPan: true,

        // Gesture settings for rotation
        gestureSettingsTouch: {
          pinchRotate: true,
        },
      })

      viewer.addHandler('open-failed', (event) => {
        error.value =
          'Failed to load DZI image. Please check the URL and ensure the server is running.'
        console.error('Open failed:', event)
      })

      viewer.addHandler('open', () => {
        console.log('DZI image loaded successfully')

        // Get actual image dimensions
        const tiledImage = viewer.world.getItemAt(0)
        if (tiledImage) {
          const imgWidth = tiledImage.source.dimensions.x
          const imgHeight = tiledImage.source.dimensions.y
          console.log('Image dimensions:', imgWidth, 'x', imgHeight)

          // Create the ROI canvas overlay once the image is open.
          // Done here (inside the 'open' handler) so the viewport is fully
          // initialised before we try to project image coordinates.
          if (!roiOverlay) {
            roiOverlay = createRoiOverlay(viewer)
            // Render any ROIs that may have been queued before the image opened
            roiOverlay.setRois(roiList.value)
            console.log('ROI overlay created')
          }

          // Create the drawing canvas overlay.
          // Must be done after the image opens so the viewport coordinate system
          // (needed by imageToCanvas / canvasToImage) is fully initialised.
          if (!drawingOverlay) {
            drawingOverlay = createDrawingOverlay(viewer)
            console.log('Drawing overlay created')
          }
        }

        // Add mouse tracking for coordinates
        setupMouseTracking(viewer)
      })
    } else {
      // Update existing viewer with new image
      viewer.open(dziUrl.value)
    }
  } catch (err) {
    error.value = `Error: ${err.message}`
    console.error('Error loading image:', err)
  }
}

// Setup mouse tracking to show image coordinates
function setupMouseTracking(viewer) {
  new OpenSeadragon.MouseTracker({
    element: viewer.container,
    moveHandler: function (event) {
      const webPoint = event.position
      const viewportPoint = viewer.viewport.pointFromPixel(webPoint)
      const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint)

      // Update mouse coordinates (rounded to integers)
      mouseCoords.value.x = Math.floor(imagePoint.x)
      mouseCoords.value.y = Math.floor(imagePoint.y)
    },
    exitHandler: function () {
      // Clear coordinates when mouse leaves viewer
      mouseCoords.value.x = null
      mouseCoords.value.y = null
    },
  })
}

onMounted(() => {
  loadImage()
})

onUnmounted(() => {
  // Destroy overlays before the viewer itself to avoid stale event handlers.
  // drawingOverlay.destroy() also re-enables OSD navigation before removal.
  if (drawingOverlay) {
    drawingOverlay.destroy()
    drawingOverlay = null
  }
  if (roiOverlay) {
    roiOverlay.destroy()
    roiOverlay = null
  }
  if (viewer) {
    viewer.destroy()
    viewer = null
  }
})
</script>

<style scoped>
.openseadragon-viewer {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 20px;
  color: #333;
  font-size: 24px;
}

.controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.url-input {
  flex: 1;
  padding: 10px;
  border: 2px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  font-family: monospace;
}

.url-input:focus {
  outline: none;
  border-color: #4caf50;
}

.load-btn {
  padding: 10px 20px;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.load-btn:hover {
  background-color: #45a049;
}

.load-btn:active {
  background-color: #3d8b40;
}

.error {
  padding: 12px;
  margin-bottom: 20px;
  background-color: #ffebee;
  border-left: 4px solid #f44336;
  color: #c62828;
  border-radius: 4px;
}

/* ── Drawing Controls ────────────────────────────────────────────────────── */
.drawing-controls {
  background-color: #fff8f0;
  border: 2px solid #ffcc80;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  transition: border-color 0.2s, background-color 0.2s;
}

/* Highlight the panel when draw mode is active so the state is obvious */
.drawing-controls.draw-mode-active {
  background-color: #fff3e0;
  border-color: #ff9800;
}

.drawing-controls h3 {
  margin: 0 0 15px 0;
  color: #333;
  font-size: 18px;
}

.controls-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-group label {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.input-group input {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
  width: 120px;
}

.input-group input:focus {
  outline: none;
  border-color: #4caf50;
}

.add-btn {
  padding: 8px 16px;
  background-color: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.add-btn:hover {
  background-color: #1976d2;
}

.clear-btn {
  padding: 8px 16px;
  background-color: #ff9800;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.clear-btn:hover {
  background-color: #f57c00;
}

.use-coords-btn {
  padding: 8px 16px;
  background-color: #9c27b0;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.use-coords-btn:hover:not(:disabled) {
  background-color: #7b1fa2;
}

.use-coords-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.points-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.point-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.remove-btn {
  background-color: #f44336;
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: background-color 0.2s;
}

.remove-btn:hover {
  background-color: #d32f2f;
}

.no-points {
  padding: 12px;
  color: #666;
  font-style: italic;
  text-align: center;
  background-color: white;
  border: 1px dashed #ccc;
  border-radius: 4px;
}

.viewer-container {
  position: relative;
  width: 100%;
  height: 600px;
  border: 2px solid #ddd;
  border-radius: 4px;
  background-color: #000;
  overflow: hidden;
}

/* Coordinate Display */
.coord-display {
  position: absolute;
  top: 10px;
  left: 10px;
  background-color: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 14px;
  font-weight: 500;
  z-index: 2000;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* ── Drawing-specific widgets ────────────────────────────────────────────── */

/* Start/Stop toggle button */
.draw-toggle-btn {
  padding: 8px 16px;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  transition: background-color 0.2s;
}

.draw-toggle-btn:hover {
  background-color: #388e3c;
}

/* Active state: button turns red to signal "click to stop" */
.draw-toggle-btn.active {
  background-color: #e53935;
}

.draw-toggle-btn.active:hover {
  background-color: #c62828;
}

/* Native <input type="color"> */
.color-picker {
  width: 60px;
  height: 34px;
  padding: 2px;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
}

/* Range slider for pen width — reset browser defaults */
.width-slider {
  width: 120px;
  cursor: pointer;
  padding: 0;
  border: none;
  background: none;
}

/* Undo button */
.undo-btn {
  padding: 8px 16px;
  background-color: #607d8b;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.undo-btn:hover:not(:disabled) {
  background-color: #455a64;
}

/* Shared disabled state for undo and clear-all */
.undo-btn:disabled,
.clear-btn:disabled {
  background-color: #bdbdbd;
  cursor: not-allowed;
}

/* Status bar below the controls row */
.drawing-status {
  font-size: 13px;
  color: #666;
  font-style: italic;
  margin-top: 8px;
}

/* Drawing canvas: pointer-events toggled by JS; z-index set inline */
:deep(#drawing-overlay) {
  z-index: 1002 !important;
}

/* ── ROI Controls ─────────────────────────────────────────────────────────── */
.roi-controls {
  background-color: #f0f4ff;
  border: 2px solid #b0c4ff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.roi-controls h3 {
  margin: 0 0 15px 0;
  color: #333;
  font-size: 18px;
}

/* Wider text box for the optional label field */
.label-input {
  width: 100px;
}

/* Small coloured square shown next to each ROI entry in the list */
.roi-color-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  margin-right: 8px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.15);
  vertical-align: middle;
}

/* ROI canvas sits above the heatmap canvas */
:deep(#roi-overlay) {
  z-index: 1001 !important;
  pointer-events: none;
}
</style>
