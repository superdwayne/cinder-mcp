# CinderBridge

Header-only C++ library that connects any Cinder application to the Cinder MCP server via OSC.

## Quick Start

Three lines to integrate:

```cpp
#include "CinderBridge.h"

// In your App::setup()
cinderbridge::CinderBridge bridge("my-app");

// In your App::update()
bridge.update();
```

## How It Works

CinderBridge listens for OSC commands on a configurable TCP port (default `9090`) and sends acknowledgements back on `port + 1`. The MCP server communicates with your app through these OSC messages.

All OSC callbacks are queued and executed on the main thread during `update()`, ensuring thread safety with Cinder's OpenGL context.

## Exposing Parameters

```cpp
float myRadius = 10.0f;
int   myCount  = 5;
bool  myFlag   = true;

bridge.expose("radius", &myRadius);
bridge.expose("count",  &myCount);
bridge.expose("flag",   &myFlag);
```

Exposed parameters can be read/written by the MCP server using `set_param` and `get_params`.

## Audio Nodes

Register audio nodes for remote control:

```cpp
bridge.registerGainNode("master", gainNode);
bridge.registerPlayerNode("bgm", playerNode);
bridge.registerMonitorNode("spectrum", monitorNode);
```

## Custom Commands

```cpp
bridge.onCommand("my_command", [](const ci::osc::Message& msg) -> std::string {
    // Handle custom OSC command
    return "done";
});
```

## Supported Commands

| OSC Address           | Description                          |
|-----------------------|--------------------------------------|
| `/set_uniform`        | Set a GL uniform by name             |
| `/get_uniforms`       | List all active uniforms             |
| `/set_param`          | Set an exposed parameter             |
| `/get_params`         | List all exposed parameters          |
| `/animate_param`      | Animate a float param over time      |
| `/screenshot`         | Capture frame to PNG                 |
| `/set_window_size`    | Resize the app window                |
| `/toggle_fullscreen`  | Toggle fullscreen mode               |
| `/set_camera`         | Set camera eye, target, FOV          |
| `/set_clear_color`    | Set background clear color           |
| `/set_framerate`      | Set target framerate                 |
| `/get_state`          | Full app state dump                  |
| `/hot_reload_shader`  | Recompile shader from files          |
| `/audio/set_gain`     | Set gain on an audio node            |
| `/audio/set_pan`      | Set pan on a pan node                |
| `/audio/play`         | Start audio playback                 |
| `/audio/stop`         | Stop audio playback                  |
| `/audio/get_spectrum` | Get FFT spectrum data                |

## Installation

Copy `CinderBridge.h` into your project's `blocks/CinderBridge/` folder, or add it as a CinderBlock using `cinderblock.xml`. Requires the OSC block (included with Cinder).
