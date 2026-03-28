# Echo — Living Particle Mirror

Interactive installation where your body becomes 50,000 flowing particles.

Stand in front of the camera. Your silhouette attracts particles like gravity.
Move and they scatter. Stand still and they orbit your shape like a constellation.

## Tech
- Cinder 0.9.x + OpenCV
- GPU transform feedback for 50k particles
- Canny edge detection for silhouette
- Curl noise for organic motion
- Two-pass Gaussian bloom
- Velocity-based color (cool blue → warm orange → hot white)

## Build
```bash
cd projects/Echo && mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Debug -Dcinder_DIR=$CINDER_PATH/lib/macosx/Debug
cmake --build . -j8
open Debug/Echo/Echo.app
```

## Controls
- `H` — toggle control panel
- `F` — toggle fullscreen
- `Esc` — quit
