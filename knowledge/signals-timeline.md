---
title: "Signals & Timeline Animation"
category: "System"
namespace: "cinder::signals, cinder::Timeline"
tags: [signals, events, timeline, animation, anim, slots]
---

# Signals & Timeline Animation

Event-driven programming with signals/slots and smooth value animation with Timeline and Anim<T>.

## Signals

Cinder uses `ci::signals::Signal` for type-safe event dispatch. App-level signals:

- `getWindow()->getSignalMouseDown()` — Mouse button pressed
- `getWindow()->getSignalMouseUp()` — Mouse button released
- `getWindow()->getSignalMouseMove()` — Mouse moved
- `getWindow()->getSignalMouseDrag()` — Mouse dragged
- `getWindow()->getSignalKeyDown()` — Key pressed
- `getWindow()->getSignalKeyUp()` — Key released
- `getWindow()->getSignalResize()` — Window resized
- `getWindow()->getSignalFileDrop()` — Files dropped on window
- `App::get()->getSignalUpdate()` — Before each update() call

### Connection Management

- `signal.connect(callback)` returns a `Connection`
- `Connection::disconnect()` to remove
- `ScopedConnection` auto-disconnects when destroyed
- Connect with priority: `signal.connect(slot, priority)` (lower = earlier)

## Timeline & Anim<T>

`ci::Timeline` provides tweened animation for any value type:

- `timeline().apply(&animValue, target, duration, easeFn)` — Animate to target
- `timeline().appendTo(&animValue, target, duration, easeFn)` — Chain after current
- `.delay(seconds)` — Add delay before animation starts
- `.finishFn(callback)` — Callback when animation completes
- `.updateFn(callback)` — Callback each frame during animation
- `.loop(true)` / `.pingPong(true)` — Repeat modes

### Anim<T>

`Anim<T>` is a wrapper that stores both current and target values:

- Works with `float`, `vec2`, `vec3`, `Color`, `ColorA`, `Rectf`, etc.
- Access current value: `myAnim()` or `myAnim.value()`
- Implicit conversion to `T`

### Cuepoints

- `timeline().add(callback, time)` — Fire callback at a specific time
- Useful for sequencing events

## Code Examples

### Mouse Interaction Handler with Signals

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class SignalApp : public App {
public:
    std::vector<vec2>                mClickPoints;
    vec2                             mMousePos;
    bool                             mDragging = false;
    std::vector<signals::Connection> mConnections;

    void setup() override {
        // Connect signals with explicit connection tracking
        mConnections.push_back(
            getWindow()->getSignalMouseDown().connect(
                [this](MouseEvent& event) {
                    mClickPoints.push_back(event.getPos());
                    mDragging = true;
                    CI_LOG_I("Click at: " << event.getPos());
                }
            )
        );

        mConnections.push_back(
            getWindow()->getSignalMouseUp().connect(
                [this](MouseEvent& event) {
                    mDragging = false;
                }
            )
        );

        mConnections.push_back(
            getWindow()->getSignalMouseMove().connect(
                [this](MouseEvent& event) {
                    mMousePos = event.getPos();
                }
            )
        );

        mConnections.push_back(
            getWindow()->getSignalMouseDrag().connect(
                [this](MouseEvent& event) {
                    mMousePos = event.getPos();
                    mClickPoints.push_back(event.getPos());
                }
            )
        );

        mConnections.push_back(
            getWindow()->getSignalKeyDown().connect(
                [this](KeyEvent& event) {
                    if (event.getCode() == KeyEvent::KEY_c) {
                        mClickPoints.clear();
                    }
                    if (event.getCode() == KeyEvent::KEY_ESCAPE) {
                        quit();
                    }
                }
            )
        );

        mConnections.push_back(
            getWindow()->getSignalResize().connect(
                [this]() {
                    CI_LOG_I("Window resized to: " << getWindowSize());
                }
            )
        );

        mConnections.push_back(
            getWindow()->getSignalFileDrop().connect(
                [this](FileDropEvent& event) {
                    for (const auto& file : event.getFiles()) {
                        CI_LOG_I("Dropped: " << file);
                    }
                }
            )
        );
    }

    void cleanup() override {
        for (auto& conn : mConnections) {
            conn.disconnect();
        }
    }

    void draw() override {
        gl::clear(Color(0.1f, 0.1f, 0.12f));

        // Draw click trail
        if (mClickPoints.size() > 1) {
            gl::color(0.3f, 0.7f, 1.0f);
            Path2d path;
            path.moveTo(mClickPoints.front());
            for (size_t i = 1; i < mClickPoints.size(); i++) {
                path.lineTo(mClickPoints[i]);
            }
            gl::draw(path);
        }

        // Draw points
        for (const auto& pt : mClickPoints) {
            gl::color(1.0f, 0.5f, 0.0f);
            gl::drawSolidCircle(pt, 4.0f);
        }

        // Cursor
        gl::color(1, 1, 1, 0.5f);
        gl::drawStrokedCircle(mMousePos, mDragging ? 20.0f : 10.0f);
    }
};

CINDER_APP(SignalApp, RendererGl)
```

### Timeline Animation Sequence

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Timeline.h"
#include "cinder/Easing.h"

using namespace ci;
using namespace ci::app;

class TimelineApp : public App {
public:
    Anim<vec2>   mPos;
    Anim<float>  mScale;
    Anim<ColorA> mColor;
    Anim<float>  mRotation;

    void setup() override {
        mPos = getWindowCenter();
        mScale = 1.0f;
        mColor = ColorA(1, 0, 0, 1);
        mRotation = 0.0f;

        buildSequence();
    }

    void buildSequence() {
        float w = getWindowWidth();
        float h = getWindowHeight();

        // Step 1: Move to top-left + grow
        timeline().apply(&mPos, vec2(150, 150), 1.0f, EaseInOutCubic());
        timeline().apply(&mScale, 2.0f, 1.0f, EaseOutBack());
        timeline().apply(&mColor, ColorA(0, 0.8f, 1, 1), 1.0f);

        // Step 2: Move to top-right + spin
        timeline().appendTo(&mPos, vec2(w - 150, 150), 1.0f, EaseInOutQuad());
        timeline().appendTo(&mRotation, (float)M_PI * 2.0f, 1.0f, EaseInOutQuad());
        timeline().appendTo(&mColor, ColorA(1, 0.8f, 0, 1), 1.0f);

        // Step 3: Move to bottom-center + shrink
        timeline().appendTo(&mPos, vec2(w / 2, h - 150), 1.0f, EaseInOutExpo());
        timeline().appendTo(&mScale, 0.5f, 1.0f, EaseInOutElastic());
        timeline().appendTo(&mColor, ColorA(0, 1, 0.5f, 1), 1.0f);

        // Step 4: Return to center
        timeline().appendTo(&mPos, getWindowCenter(), 1.0f, EaseOutBounce())
            .finishFn([this]() {
                // Loop the sequence
                mRotation = 0.0f;
                buildSequence();
            });
        timeline().appendTo(&mScale, 1.0f, 1.0f, EaseInOutQuad());
        timeline().appendTo(&mColor, ColorA(1, 0, 0, 1), 1.0f);
    }

    void draw() override {
        gl::clear(Color(0.08f, 0.08f, 0.1f));

        gl::pushModelMatrix();
        gl::translate(mPos());
        gl::rotate(mRotation());
        gl::scale(vec2(mScale()));

        gl::color(mColor());
        gl::drawSolidRoundedRect(Rectf(-40, -40, 40, 40), 8.0f);

        gl::popModelMatrix();
    }
};

CINDER_APP(TimelineApp, RendererGl)
```

### Multi-Signal Setup with ScopedConnection

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Timeline.h"
#include "cinder/Easing.h"

using namespace ci;
using namespace ci::app;

class MultiSignalApp : public App {
public:
    // ScopedConnections auto-disconnect on destruction
    signals::ScopedConnection mUpdateConn;
    signals::ScopedConnection mResizeConn;

    Anim<float>  mOpacity;
    Anim<vec2>   mBallPos;
    float        mFps = 0;
    vec2         mWindowSize;

    void setup() override {
        mOpacity = 1.0f;
        mBallPos = getWindowCenter();
        mWindowSize = getWindowSize();

        // Connect update signal for FPS tracking
        mUpdateConn = App::get()->getSignalUpdate().connect(
            [this]() {
                mFps = getAverageFps();
            }
        );

        // Connect resize signal to re-center ball
        mResizeConn = getWindow()->getSignalResize().connect(
            [this]() {
                mWindowSize = getWindowSize();
                timeline().apply(&mBallPos, getWindowCenter(),
                                 0.5f, EaseOutBack());
            }
        );

        // Start a pulsing opacity animation
        timeline().apply(&mOpacity, 0.3f, 1.5f, EaseInOutSine())
            .pingPong(true).loop(true);
    }

    void mouseDown(MouseEvent event) override {
        // Animate ball to click position
        timeline().apply(&mBallPos, vec2(event.getPos()),
                         0.8f, EaseOutElastic());
    }

    void draw() override {
        gl::clear(Color(0.05f, 0.05f, 0.08f));

        // Draw animated ball
        gl::color(ColorA(0.2f, 0.7f, 1.0f, mOpacity()));
        gl::drawSolidCircle(mBallPos(), 40.0f);

        // HUD: FPS counter
        gl::color(1, 1, 1);
        gl::drawString("FPS: " + std::to_string((int)mFps),
                        vec2(10, 10), Color::white(),
                        Font("Arial", 16));
        gl::drawString("Click to move ball",
                        vec2(10, 30), Color(0.6f, 0.6f, 0.6f),
                        Font("Arial", 14));
    }
};

CINDER_APP(MultiSignalApp, RendererGl)
```
