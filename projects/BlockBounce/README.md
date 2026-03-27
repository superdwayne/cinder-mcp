# BlockBounce

Real-time physics demo that bounces digital balls off physical objects detected by your camera. Point a camera at a wall, stick post-its or place objects on it, and watch ping-pong balls bounce off them in real-time.

## Live Demo

**Web version:** [blockbounce-seven.vercel.app](https://blockbounce-seven.vercel.app)

Works on any device with a camera and browser. No install needed.

## How It Works

```
Camera Feed → Edge Detection → Contour Extraction → Physics Bodies → Ball Collision
```

1. **Camera** captures a live feed of a wall
2. **Canny edge detection** (OpenCV) finds object boundaries — a blank wall has no edges, a post-it does
3. **Contour extraction** converts edges into polygon shapes
4. **Physics engine** turns those polygons into solid collision bodies
5. **Balls** drop from the top, bouncing off the detected shapes in real-time
6. Move an object on the wall — collision updates instantly every frame

## Features

- Edge-based detection — no background calibration needed, works immediately
- Real contour shapes — balls bounce off the actual silhouette, not bounding boxes
- Real-time tracking — move objects and collisions follow instantly
- Multiple balls dropping continuously
- Ping-pong ball physics — light, bouncy, with air drag
- Camera selector — supports iPhone Continuity Camera, webcam, or any video source
- Adjustable sensitivity, ball size, bounce, gravity via ImGui panel

## Two Versions

### Native (Cinder + OpenCV + Box2D)

Full-performance C++ application.

**Requirements:**
- macOS with Xcode
- [Cinder 0.9.3](https://libcinder.org/download)
- OpenCV 4 (`brew install opencv`)
- CMake (`brew install cmake`)

**Build:**
```bash
export CINDER_PATH=/path/to/cinder_0.9.3_mac
cd projects/BlockBounce
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Debug -Dcinder_DIR=$CINDER_PATH/lib/macosx/Debug
cmake --build . -j8
open Debug/BlockBounce/BlockBounce.app
```

**Controls:**
- `D` — toggle debug view (shows edge detection overlay)
- `R` — enter calibration mode
- `Esc` — quit
- ImGui panel — adjust edge sensitivity, ball physics, camera selection

### Web (OpenCV.js + Matter.js)

Browser-based version. Same concept, runs anywhere.

**Tech stack:**
- OpenCV.js — edge detection and contour finding
- Matter.js — 2D physics engine
- Canvas API — rendering
- WebRTC — camera access

**Run locally:**
```bash
cd projects/BlockBounce/web
npx serve .
```

**Deploy:**
```bash
cd projects/BlockBounce/web
vercel --prod
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Camera      │────▶│  OpenCV      │────▶│  Physics    │
│  (iPhone/    │     │  Canny Edge  │     │  (Box2D /   │
│   Webcam)    │     │  Contours    │     │  Matter.js) │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                                          ┌──────▼──────┐
                                          │  Renderer   │
                                          │  (GL/Canvas)│
                                          └─────────────┘
```

## Use Cases

- **Interactive installations** — project onto a wall, let visitors place objects that deflect projected particles
- **Creative coding demos** — real-time bridge between physical and digital
- **Educational physics** — visualize collision, gravity, and restitution with tangible objects
- **Projection mapping** — calibrate to a projector and bounce light off real objects

## Built With

Part of the [Cinder MCP](https://github.com/superdwayne/cinder-mcp) project — a 57-tool MCP server that turns Claude Code into a creative coding copilot for libcinder.org.
