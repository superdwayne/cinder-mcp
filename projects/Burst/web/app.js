// BURST — Motion-reactive spectrum particle canvas
// Pure vanilla JS + Canvas 2D

(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────────────────────
    const MAX_PARTICLES = 20000;
    const MOTION_SAMPLE_STEP = 6;        // subsample every N pixels
    const VIDEO_W = 640;
    const VIDEO_H = 480;
    const FRICTION = 0.95;
    const TITLE_VISIBLE_MS = 3000;
    const TITLE_FADE_MS = 1000;

    // ── State ──────────────────────────────────────────────────────────
    let particles = [];
    let video, canvas, ctx;
    let offCanvas, offCtx;
    let prevFrameData = null;
    let facingMode = 'environment';       // rear camera default for installations
    let motionThreshold = 25;
    let gravity = 5;
    let particleBaseSize = 15;
    let lastTime = 0;
    let cameraReady = false;

    // ── DOM refs ───────────────────────────────────────────────────────
    const sensitivitySlider = document.getElementById('sensitivity');
    const sizeSlider = document.getElementById('size');
    const gravitySlider = document.getElementById('gravity');
    const flipBtn = document.getElementById('flipBtn');
    const titleEl = document.getElementById('title');
    const controlsBody = document.getElementById('controls-body');
    const controlsHeader = document.getElementById('controls-header');
    const toggleArrow = document.getElementById('toggle-arrow');

    // ── Initialisation ─────────────────────────────────────────────────
    function init() {
        video = document.getElementById('video');
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d');

        // Offscreen canvas for motion detection at video resolution
        offCanvas = document.createElement('canvas');
        offCanvas.width = VIDEO_W;
        offCanvas.height = VIDEO_H;
        offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

        resize();
        window.addEventListener('resize', resize);

        bindControls();
        startCamera();

        // Title fade
        setTimeout(function () {
            titleEl.classList.add('hidden');
            setTimeout(function () {
                titleEl.style.display = 'none';
            }, TITLE_FADE_MS);
        }, TITLE_VISIBLE_MS);

        requestAnimationFrame(loop);
    }

    // ── Resize ─────────────────────────────────────────────────────────
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    // ── Controls ───────────────────────────────────────────────────────
    function bindControls() {
        sensitivitySlider.addEventListener('input', function () {
            motionThreshold = parseInt(this.value, 10);
        });
        sizeSlider.addEventListener('input', function () {
            particleBaseSize = parseInt(this.value, 10);
        });
        gravitySlider.addEventListener('input', function () {
            gravity = parseInt(this.value, 10);
        });
        flipBtn.addEventListener('click', function () {
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            stopCamera();
            startCamera();
        });

        // Collapsible panel
        controlsHeader.addEventListener('click', function () {
            controlsBody.classList.toggle('collapsed');
            toggleArrow.classList.toggle('collapsed');
        });
    }

    // ── Camera ─────────────────────────────────────────────────────────
    async function startCamera() {
        cameraReady = false;
        prevFrameData = null;

        try {
            const constraints = {
                video: {
                    facingMode: facingMode,
                    width: { ideal: VIDEO_W },
                    height: { ideal: VIDEO_H }
                },
                audio: false
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await video.play();
            cameraReady = true;
        } catch (err) {
            console.warn('Camera access denied or unavailable:', err);
            // Show a friendly message on canvas
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = '20px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('Camera access required. Please allow camera permissions.', canvas.width / 2, canvas.height / 2);
        }
    }

    function stopCamera() {
        if (video.srcObject) {
            var tracks = video.srcObject.getTracks();
            for (var i = 0; i < tracks.length; i++) {
                tracks[i].stop();
            }
            video.srcObject = null;
        }
    }

    // ── Motion Detection ───────────────────────────────────────────────
    function detectMotion() {
        if (!cameraReady || video.readyState < 2) return [];

        // Draw current video frame to offscreen canvas
        offCtx.drawImage(video, 0, 0, VIDEO_W, VIDEO_H);
        var currentFrame = offCtx.getImageData(0, 0, VIDEO_W, VIDEO_H);
        var currentData = currentFrame.data;

        var motionPoints = [];

        if (prevFrameData !== null) {
            var prevData = prevFrameData;

            for (var y = 0; y < VIDEO_H; y += MOTION_SAMPLE_STEP) {
                for (var x = 0; x < VIDEO_W; x += MOTION_SAMPLE_STEP) {
                    var idx = (y * VIDEO_W + x) * 4;

                    var dr = Math.abs(currentData[idx]     - prevData[idx]);
                    var dg = Math.abs(currentData[idx + 1] - prevData[idx + 1]);
                    var db = Math.abs(currentData[idx + 2] - prevData[idx + 2]);
                    var diff = (dr + dg + db) / 3;

                    if (diff > motionThreshold) {
                        motionPoints.push({ x: x, y: y });
                    }
                }
            }
        }

        prevFrameData = currentData;
        return motionPoints;
    }

    // ── Spawn Particles ────────────────────────────────────────────────
    function spawnFromMotion(motionPoints) {
        var time = performance.now() / 1000;
        var baseHue = (time * 0.08) % 1;      // slowly drifting base hue

        var len = motionPoints.length;
        for (var i = 0; i < len; i++) {
            if (particles.length >= MAX_PARTICLES) break;

            var pt = motionPoints[i];
            var count = 1 + Math.floor(Math.random() * 2);

            for (var j = 0; j < count; j++) {
                if (particles.length >= MAX_PARTICLES) break;

                // Mirror X so movements feel natural
                var screenX = (1 - pt.x / VIDEO_W) * canvas.width;
                var screenY = (pt.y / VIDEO_H) * canvas.height;

                var angle = Math.random() * Math.PI * 2;
                var speed = 0.5 + Math.random() * 2.5;

                // Smooth spectrum: position + time + small noise
                var hue = baseHue
                    + (screenX / canvas.width) * 0.4
                    + (screenY / canvas.height) * 0.2
                    + (Math.random() - 0.5) * 0.1;
                hue = hue - Math.floor(hue); // wrap to [0,1)

                var life = 0.6 + Math.random() * 1.4;
                var size = particleBaseSize * (0.5 + Math.random() * 1.0);

                particles.push({
                    x: screenX + (Math.random() - 0.5) * 4,
                    y: screenY + (Math.random() - 0.5) * 4,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: life,
                    maxLife: life,
                    size: size,
                    hue: hue
                });
            }
        }
    }

    // ── Update Particles ───────────────────────────────────────────────
    function updateParticles(dt) {
        var grav = gravity * dt;
        var len = particles.length;
        var alive = 0;

        for (var i = 0; i < len; i++) {
            var p = particles[i];
            p.vy += grav;
            p.vx *= FRICTION;
            p.vy *= FRICTION;
            p.x += p.vx;
            p.y += p.vy;
            p.life -= dt;

            if (p.life > 0) {
                particles[alive] = p;
                alive++;
            }
        }

        particles.length = alive;
    }

    // ── HSV to RGB ─────────────────────────────────────────────────────
    // Returns [r, g, b] each 0-255
    function hsvToRgb(h, s, v) {
        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);
        var r, g, b;

        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }

        return [
            Math.round(r * 255),
            Math.round(g * 255),
            Math.round(b * 255)
        ];
    }

    // ── Render ─────────────────────────────────────────────────────────
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw camera feed (mirrored)
        if (cameraReady && video.readyState >= 2) {
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        // Draw particles with additive blending
        if (particles.length === 0) return;

        ctx.globalCompositeOperation = 'lighter';

        var len = particles.length;
        for (var i = 0; i < len; i++) {
            var p = particles[i];
            var t = p.life / p.maxLife;
            if (t <= 0) continue;

            var alpha = t * t * 0.7;           // quadratic fade
            var size = p.size * Math.max(t, 0.3);
            var rgb = hsvToRgb(p.hue, 0.9, 1.0);

            // Soft radial gradient for brush-stroke feel
            var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
            grad.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')');
            grad.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';
    }

    // ── Main Loop ──────────────────────────────────────────────────────
    function loop(timestamp) {
        var dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 1 / 60;
        lastTime = timestamp;

        var motionPoints = detectMotion();
        spawnFromMotion(motionPoints);
        updateParticles(dt);
        render();

        requestAnimationFrame(loop);
    }

    // ── Start ──────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
