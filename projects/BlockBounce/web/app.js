// BlockBounce — Web version of Cinder physics demo
// Camera feed + edge detection + physics balls bouncing off real objects

// ─── Global State ───────────────────────────────────────────────────────────

let video, canvas, ctx, offscreen, offCtx;
let cvReady = false;
let engine, world;
let balls = [];
let blockBodies = [];
let wallBodies = [];

// Tuning parameters (bound to sliders)
let cannyLow = 80;
let cannyHigh = 180;
let minArea = 3000;
let ballRadius = 15;
let ballBounce = 0.92;
let maxBalls = 15;

// Camera
let facingMode = 'environment';
let currentStream = null;

// Performance: process OpenCV every N frames
let frameCount = 0;
const PROCESS_EVERY = 3;
let lastContours = [];

// Auto-spawn timer
let spawnAccum = 0;
const SPAWN_INTERVAL = 15; // frames between auto-spawns

// Video dimensions (internal processing resolution)
const CAM_WIDTH = 640;
const CAM_HEIGHT = 480;

// ─── OpenCV Ready Callback ──────────────────────────────────────────────────

function onOpenCvReady() {
  cvReady = true;
  init();
}

// Make it global for the script onload
window.onOpenCvReady = onOpenCvReady;

// ─── Initialization ─────────────────────────────────────────────────────────

async function init() {
  // Wait for Matter.js
  if (typeof Matter === 'undefined') {
    setTimeout(init, 100);
    return;
  }

  // Setup canvas
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Offscreen canvas for OpenCV processing at camera resolution
  offscreen = document.createElement('canvas');
  offscreen.width = CAM_WIDTH;
  offscreen.height = CAM_HEIGHT;
  offCtx = offscreen.getContext('2d', { willReadFrequently: true });

  // Setup video element
  video = document.getElementById('video');

  // Setup Matter.js
  setupPhysics();

  // Setup controls
  setupControls();

  // Setup touch/click to spawn
  setupSpawnInteraction();

  // Start camera
  await startCamera();

  // Hide loading
  const loading = document.getElementById('loading');
  loading.classList.add('hidden');
  setTimeout(() => { loading.style.display = 'none'; }, 500);

  // Spawn initial ball
  spawnBall();

  // Start game loop
  requestAnimationFrame(gameLoop);
}

// ─── Canvas Sizing ──────────────────────────────────────────────────────────

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Update wall positions if physics exists
  if (world) {
    updateWalls();
  }
}

// ─── Camera ─────────────────────────────────────────────────────────────────

async function startCamera() {
  // Stop existing stream
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }

  try {
    const constraints = {
      video: {
        facingMode: facingMode,
        width: { ideal: CAM_WIDTH },
        height: { ideal: CAM_HEIGHT }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    video.srcObject = stream;

    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });
  } catch (err) {
    console.error('Camera access denied:', err);
    // Show a message on the canvas
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Camera access required.', canvas.width / 2, canvas.height / 2 - 20);
    ctx.fillText('Please allow camera permissions and reload.', canvas.width / 2, canvas.height / 2 + 10);
  }
}

async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
}

// ─── Matter.js Setup ────────────────────────────────────────────────────────

function setupPhysics() {
  // Set decomp for concave bodies
  if (typeof decomp !== 'undefined') {
    Matter.Common.setDecomp(decomp);
  }

  engine = Matter.Engine.create({
    gravity: { x: 0, y: 1.2, scale: 0.001 }
  });
  world = engine.world;

  updateWalls();
}

function updateWalls() {
  // Remove old walls
  wallBodies.forEach(b => Matter.Composite.remove(world, b));
  wallBodies = [];

  const w = canvas.width;
  const h = canvas.height;
  const thickness = 60;

  // Side walls only — no floor so ball falls through
  const leftWall = Matter.Bodies.rectangle(-thickness / 2, h / 2, thickness, h * 2, {
    isStatic: true,
    friction: 0.1,
    restitution: 0.5
  });
  const rightWall = Matter.Bodies.rectangle(w + thickness / 2, h / 2, thickness, h * 2, {
    isStatic: true,
    friction: 0.1,
    restitution: 0.5
  });
  // Top wall to prevent ball escaping upward
  const topWall = Matter.Bodies.rectangle(w / 2, -thickness / 2, w * 2, thickness, {
    isStatic: true,
    friction: 0.1,
    restitution: 0.5
  });

  wallBodies = [leftWall, rightWall, topWall];
  Matter.Composite.add(world, wallBodies);
}

// ─── Ball ───────────────────────────────────────────────────────────────────

function spawnBall(x, y) {
  // Default position: random from top
  if (x === undefined) {
    x = canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.4;
  }
  if (y === undefined) {
    y = 30 + Math.random() * 20;
  }

  // Random radius variation
  const r = ballRadius * (0.7 + Math.random() * 0.6);

  const ball = Matter.Bodies.circle(x, y, r, {
    density: 0.001,
    restitution: ballBounce,
    friction: 0.1,
    frictionAir: 0.008,
    render: { visible: false },
    label: 'ball'
  });

  // Slight random initial velocity
  Matter.Body.setVelocity(ball, {
    x: (Math.random() - 0.5) * 4,
    y: 2 + Math.random() * 3
  });

  // Store hue for color cycling
  ball._hue = Math.random();
  ball._radius = r;

  Matter.Composite.add(world, ball);
  balls.push(ball);
}

function spawnBurst(count) {
  count = count || 5;
  for (let i = 0; i < count; i++) {
    const rx = 100 + Math.random() * (canvas.width - 200);
    spawnBall(rx, -40);
  }
}

function removeOffscreenBalls() {
  const limitY = canvas.height + 100;
  const limitX = canvas.width + 100;

  for (let i = balls.length - 1; i >= 0; i--) {
    const pos = balls[i].position;
    if (pos.y > limitY || pos.x < -100 || pos.x > limitX || pos.y < -200) {
      Matter.Composite.remove(world, balls[i]);
      balls.splice(i, 1);
    }
  }
}

// ─── Touch / Click to Spawn ─────────────────────────────────────────────────

function setupSpawnInteraction() {
  // Click to spawn ball at position
  canvas.addEventListener('click', (e) => {
    spawnBall(e.clientX, e.clientY);
  });

  // Touch to spawn (mobile)
  canvas.addEventListener('touchstart', (e) => {
    // Spawn a ball for each touch point
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      spawnBall(touch.clientX, touch.clientY);
    }
  }, { passive: true });
}

// ─── OpenCV Processing ──────────────────────────────────────────────────────

function processFrame() {
  if (!cvReady || !video || video.readyState < 2) {
    return lastContours;
  }

  // Draw video to offscreen canvas at camera resolution
  offCtx.drawImage(video, 0, 0, CAM_WIDTH, CAM_HEIGHT);
  const imageData = offCtx.getImageData(0, 0, CAM_WIDTH, CAM_HEIGHT);

  let src = null, gray = null, edges = null, dilated = null, hierarchy = null, contours = null, kernel = null;

  try {
    src = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    edges = new cv.Mat();
    dilated = new cv.Mat();
    hierarchy = new cv.Mat();
    contours = new cv.MatVector();

    // Grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Blur to reduce noise
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // Canny edge detection
    cannyHigh = cannyLow * 3;
    cv.Canny(gray, edges, cannyLow, cannyHigh);

    // Dilate edges to connect nearby edges into closed contours
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15));
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 2);

    // Find contours
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Scale factors: camera coords -> canvas coords
    const scaleX = canvas.width / CAM_WIDTH;
    const scaleY = canvas.height / CAM_HEIGHT;

    const result = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      if (area < minArea) continue;

      // Simplify contour
      const epsilon = 0.02 * cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, epsilon, true);

      if (approx.rows >= 3) {
        const points = [];
        for (let j = 0; j < approx.rows; j++) {
          points.push({
            x: approx.data32S[j * 2] * scaleX,
            y: approx.data32S[j * 2 + 1] * scaleY
          });
        }
        result.push(points);
      }

      approx.delete();
    }

    lastContours = result;
    return result;

  } catch (err) {
    console.error('OpenCV processing error:', err);
    return lastContours;
  } finally {
    // CRITICAL: delete all mats to prevent memory leaks
    if (src) src.delete();
    if (gray) gray.delete();
    if (edges) edges.delete();
    if (dilated) dilated.delete();
    if (hierarchy) hierarchy.delete();
    if (kernel) kernel.delete();
    if (contours) {
      for (let i = 0; i < contours.size(); i++) {
        contours.get(i).delete();
      }
      contours.delete();
    }
  }
}

// ─── Physics Update ─────────────────────────────────────────────────────────

function updatePhysics(contours) {
  // Remove old block bodies
  blockBodies.forEach(b => Matter.Composite.remove(world, b));
  blockBodies = [];

  // Create new bodies from contours
  for (const points of contours) {
    if (points.length < 3) continue;

    // Compute centroid
    let cx = 0, cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;

    // Create vertices relative to centroid (Matter.js expects this)
    const vertices = points.map(p => ({ x: p.x - cx, y: p.y - cy }));

    try {
      const body = Matter.Bodies.fromVertices(cx, cy, [vertices], {
        isStatic: true,
        restitution: 0.5,
        friction: 0.3,
        label: 'block'
      });

      if (body) {
        blockBodies.push(body);
        Matter.Composite.add(world, body);
      }
    } catch (e) {
      // fromVertices failed (concavity issue) — fall back to bounding box
      try {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        const bw = maxX - minX;
        const bh = maxY - minY;
        if (bw > 10 && bh > 10) {
          const body = Matter.Bodies.rectangle(
            minX + bw / 2, minY + bh / 2, bw, bh,
            { isStatic: true, restitution: 0.5, friction: 0.3, label: 'block-fallback' }
          );
          blockBodies.push(body);
          Matter.Composite.add(world, body);
        }
      } catch (e2) {
        // Silently skip
      }
    }
  }

  // Remove off-screen balls
  removeOffscreenBalls();

  // Auto-spawn balls up to maxBalls
  spawnAccum++;
  if (balls.length < maxBalls && spawnAccum >= SPAWN_INTERVAL) {
    const rx = 100 + Math.random() * (canvas.width - 200);
    spawnBall(rx, -40);
    spawnAccum = 0;
  }
}

// ─── HSV to RGB helper ──────────────────────────────────────────────────────

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function render() {
  const w = canvas.width;
  const h = canvas.height;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Draw video as background
  if (video && video.readyState >= 2) {
    ctx.save();

    // Mirror if using front camera
    if (facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // Slight dim overlay so balls are more visible
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
  }

  // Draw all balls with glow effect
  for (const ball of balls) {
    const pos = ball.position;
    const r = ball._radius || ballRadius;

    // Cycle hue slowly
    ball._hue = (ball._hue + 0.001) % 1;
    const color = hsvToRgb(ball._hue, 0.9, 1.0);

    // Outer glow
    const glowGrad = ctx.createRadialGradient(pos.x, pos.y, r * 0.5, pos.x, pos.y, r * 2.5);
    glowGrad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.3)`);
    glowGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Ball body — bright color
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    const brightR = Math.min(255, color.r * 0.5 + 128);
    const brightG = Math.min(255, color.g * 0.5 + 128);
    const brightB = Math.min(255, color.b * 0.5 + 128);
    ctx.fillStyle = `rgb(${brightR}, ${brightG}, ${brightB})`;
    ctx.fill();

    // Highlight — top-left shine
    const grad = ctx.createRadialGradient(
      pos.x - r * 0.3, pos.y - r * 0.3, r * 0.1,
      pos.x - r * 0.1, pos.y - r * 0.1, r * 0.7
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Ball count display
  if (balls.length > 1) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`${balls.length} balls`, w - 12, 20);
    ctx.restore();
  }
}

// ─── Game Loop ──────────────────────────────────────────────────────────────

function gameLoop() {
  frameCount++;

  // Process OpenCV every Nth frame for performance
  let contours = lastContours;
  if (frameCount % PROCESS_EVERY === 0) {
    contours = processFrame();
  }

  // Update physics bodies
  if (frameCount % PROCESS_EVERY === 0) {
    updatePhysics(contours);
  } else {
    // Still remove off-screen balls every frame
    removeOffscreenBalls();
  }

  // Step physics
  Matter.Engine.update(engine, 1000 / 60);

  // Render
  render();

  requestAnimationFrame(gameLoop);
}

// ─── Controls ───────────────────────────────────────────────────────────────

function setupControls() {
  // Toggle panel
  const toggleBtn = document.getElementById('toggle-controls');
  const body = document.getElementById('controls-body');
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent spawning a ball
    body.classList.toggle('collapsed');
  });

  // Prevent clicks on controls panel from spawning balls
  document.getElementById('controls').addEventListener('click', (e) => {
    e.stopPropagation();
  });
  document.getElementById('controls').addEventListener('touchstart', (e) => {
    e.stopPropagation();
  });

  // Canny slider
  const cannySlider = document.getElementById('canny-slider');
  const cannyVal = document.getElementById('canny-val');
  cannySlider.addEventListener('input', () => {
    cannyLow = parseInt(cannySlider.value);
    cannyVal.textContent = cannyLow;
  });

  // Min area slider
  const areaSlider = document.getElementById('area-slider');
  const areaVal = document.getElementById('area-val');
  areaSlider.addEventListener('input', () => {
    minArea = parseInt(areaSlider.value);
    areaVal.textContent = minArea;
  });

  // Ball size slider
  const ballSizeSlider = document.getElementById('ball-size-slider');
  const ballSizeVal = document.getElementById('ball-size-val');
  ballSizeSlider.addEventListener('input', () => {
    ballRadius = parseInt(ballSizeSlider.value);
    ballSizeVal.textContent = ballRadius;
  });

  // Bounce slider
  const bounceSlider = document.getElementById('bounce-slider');
  const bounceVal = document.getElementById('bounce-val');
  bounceSlider.addEventListener('input', () => {
    ballBounce = parseInt(bounceSlider.value) / 100;
    bounceVal.textContent = ballBounce.toFixed(2);
    // Update existing balls
    for (const ball of balls) {
      ball.restitution = ballBounce;
    }
  });

  // Ball count slider
  const ballCountSlider = document.getElementById('ball-count-slider');
  const ballCountVal = document.getElementById('ball-count-val');
  if (ballCountSlider) {
    ballCountSlider.addEventListener('input', () => {
      maxBalls = parseInt(ballCountSlider.value);
      ballCountVal.textContent = maxBalls;
    });
  }

  // Flip camera button
  document.getElementById('flip-btn').addEventListener('click', flipCamera);

  // Burst button (spawn 5 at once)
  document.getElementById('burst-btn').addEventListener('click', () => spawnBurst(5));

  // Clear button
  document.getElementById('clear-btn').addEventListener('click', () => {
    for (const ball of balls) {
      Matter.Composite.remove(world, ball);
    }
    balls = [];
  });
}

// ─── Safety: wait for OpenCV if already loaded ──────────────────────────────

// If OpenCV loaded before our script (race condition)
if (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined') {
  cvReady = true;
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
}

// If OpenCV loads via Module pattern
if (typeof cv === 'object' && cv.onRuntimeInitialized === undefined) {
  // Already ready
} else if (typeof cv === 'object') {
  const existingCallback = cv.onRuntimeInitialized;
  cv.onRuntimeInitialized = () => {
    if (existingCallback) existingCallback();
    cvReady = true;
    init();
  };
}
