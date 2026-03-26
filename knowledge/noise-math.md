---
title: "Noise, Math & Transforms"
category: "Math"
namespace: "cinder"
tags: [perlin, noise, math, easing, transform, matrix, lerp]
---

# Noise, Math & Transforms

Math utilities, Perlin noise, easing functions, and the transform matrix stack.

## Perlin Noise (ci::Perlin)

`ci::Perlin` provides classic Perlin noise:

- `noise(float x)` — 1D noise
- `noise(float x, float y)` / `noise(vec2)` — 2D noise
- `noise(float x, float y, float z)` / `noise(vec3)` — 3D noise
- `dnoise(float x, float y)` — Derivative of 2D noise (returns `vec2`)
- `dfBm(vec2)` / `dfBm(vec3)` — Fractal Brownian motion (layered noise)
- Constructor: `Perlin(octaves, seed)` — default 4 octaves

## Math Utilities

- `ci::lmap(value, inMin, inMax, outMin, outMax)` — Linear remap
- `ci::clamp(value, min, max)` — Constrain value to range
- `ci::lerp(a, b, t)` — Linear interpolation
- `ci::constrain(value, min, max)` — Alias for clamp
- `glm::mix(a, b, t)` — GLM lerp for vectors/quaternions
- `ci::toDegrees()` / `ci::toRadians()` — Angle conversion

## Easing Functions

Cinder provides standard easing functions in `cinder/Easing.h`:

- `EaseInQuad`, `EaseOutQuad`, `EaseInOutQuad`
- `EaseInCubic`, `EaseOutCubic`, `EaseInOutCubic`
- `EaseInExpo`, `EaseOutExpo`, `EaseInOutExpo`
- `EaseInElastic`, `EaseOutElastic`, `EaseInOutElastic`
- `EaseInBounce`, `EaseOutBounce`, `EaseInOutBounce`
- `EaseInBack`, `EaseOutBack`, `EaseInOutBack`

Use with `ci::Timeline` or call directly: `EaseInOutQuad()(t)` where t is [0,1].

## Transform Stack

OpenGL-style matrix stack operations:

- `gl::pushModelMatrix()` / `gl::popModelMatrix()` — Save/restore model transform
- `gl::translate(vec3)` — Translate
- `gl::rotate(radians, axis)` — Rotate around axis
- `gl::scale(vec3)` — Scale
- `gl::setMatricesWindowPersp(size, fov, near, far)` — Perspective camera
- `gl::setMatricesWindow(size)` — Orthographic 2D camera
- `gl::ScopedModelMatrix` — RAII push/pop

## Code Examples

### Perlin Noise Flow Field

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Perlin.h"
#include "cinder/Rand.h"

using namespace ci;
using namespace ci::app;

class NoiseFieldApp : public App {
public:
    Perlin               mPerlin;
    std::vector<vec2>    mParticles;
    static const int     NUM_PARTICLES = 5000;

    void setup() override {
        mPerlin = Perlin(4, 42);  // 4 octaves, seed 42

        // Initialize random particle positions
        for (int i = 0; i < NUM_PARTICLES; i++) {
            mParticles.push_back(vec2(
                Rand::randFloat(0, getWindowWidth()),
                Rand::randFloat(0, getWindowHeight())
            ));
        }
    }

    void update() override {
        float time = getElapsedSeconds() * 0.1f;
        float scale = 0.005f;

        for (auto& p : mParticles) {
            // Sample 2D noise to get flow direction
            float angle = mPerlin.noise(
                p.x * scale, p.y * scale, time
            ) * M_PI * 4.0f;

            vec2 velocity(cos(angle), sin(angle));
            p += velocity * 1.5f;

            // Wrap around screen edges
            if (p.x < 0) p.x += getWindowWidth();
            if (p.x > getWindowWidth()) p.x -= getWindowWidth();
            if (p.y < 0) p.y += getWindowHeight();
            if (p.y > getWindowHeight()) p.y -= getWindowHeight();
        }
    }

    void draw() override {
        gl::clear(ColorA(0, 0, 0, 0.02f));
        gl::color(1.0f, 0.8f, 0.3f, 0.15f);
        gl::enableAlphaBlending();

        for (const auto& p : mParticles) {
            gl::drawSolidCircle(p, 1.5f);
        }
    }
};

CINDER_APP(NoiseFieldApp, RendererGl,
    [](App::Settings* settings) {
        settings->setWindowSize(1024, 768);
    })
```

### Easing Animations

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Easing.h"
#include "cinder/Timeline.h"

using namespace ci;
using namespace ci::app;

class EasingApp : public App {
public:
    Anim<vec2>  mPosition;
    Anim<float> mRadius;
    Anim<Color> mColor;

    void setup() override {
        mPosition = vec2(100, getWindowCenter().y);
        mRadius = 20.0f;
        mColor = Color(1, 0, 0);

        startAnimation();
    }

    void startAnimation() {
        float duration = 2.0f;

        // Animate position with ease-in-out cubic
        timeline().apply(&mPosition,
            vec2(getWindowWidth() - 100, getWindowCenter().y),
            duration, EaseInOutCubic()
        ).finishFn([this]() {
            // Chain: return to start with bounce
            timeline().apply(&mPosition,
                vec2(100, getWindowCenter().y),
                duration, EaseOutBounce()
            ).finishFn([this]() { startAnimation(); });
        });

        // Animate radius with elastic ease
        timeline().apply(&mRadius, 60.0f, duration, EaseOutElastic());
        timeline().appendTo(&mRadius, 20.0f, duration, EaseInOutQuad());

        // Animate color
        timeline().apply(&mColor, Color(0, 0.5f, 1.0f), duration, EaseInOutQuad());
        timeline().appendTo(&mColor, Color(1, 0, 0), duration, EaseInOutQuad());
    }

    void draw() override {
        gl::clear(Color(0.1f, 0.1f, 0.12f));
        gl::color(mColor());
        gl::drawSolidCircle(mPosition(), mRadius());
    }
};

CINDER_APP(EasingApp, RendererGl)
```

### Transform Hierarchies (Solar System)

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class SolarApp : public App {
public:
    gl::BatchRef mSphere;

    void setup() override {
        auto shader = gl::getStockShader(gl::ShaderDef().lambert().color());
        mSphere = gl::Batch::create(
            geom::Sphere().subdivisions(32), shader
        );

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void draw() override {
        gl::clear(Color::black());
        gl::setMatricesWindowPersp(getWindowSize(), 60.0f, 0.1f, 200.0f);
        gl::translate(getWindowCenter().x, getWindowCenter().y, -50.0f);

        float t = getElapsedSeconds();

        // Sun
        {
            gl::ScopedModelMatrix sunScope;
            gl::scale(vec3(5.0f));
            gl::color(1.0f, 0.9f, 0.3f);
            mSphere->draw();
        }

        // Earth orbit
        {
            gl::ScopedModelMatrix earthOrbit;
            gl::rotate(t * 0.5f, vec3(0, 1, 0));
            gl::translate(vec3(15, 0, 0));

            // Earth
            {
                gl::ScopedModelMatrix earthSpin;
                gl::rotate(t * 2.0f, vec3(0, 1, 0));
                gl::scale(vec3(2.0f));
                gl::color(0.2f, 0.5f, 1.0f);
                mSphere->draw();
            }

            // Moon orbiting Earth
            {
                gl::ScopedModelMatrix moonOrbit;
                gl::rotate(t * 3.0f, vec3(0, 1, 0));
                gl::translate(vec3(4, 0, 0));
                gl::scale(vec3(0.6f));
                gl::color(0.7f, 0.7f, 0.7f);
                mSphere->draw();
            }
        }

        // Mars orbit
        {
            gl::ScopedModelMatrix marsOrbit;
            gl::rotate(t * 0.3f, vec3(0, 1, 0));
            gl::translate(vec3(25, 0, 0));
            gl::rotate(t * 1.5f, vec3(0, 1, 0));
            gl::scale(vec3(1.5f));
            gl::color(0.9f, 0.4f, 0.2f);
            mSphere->draw();
        }
    }
};

CINDER_APP(SolarApp, RendererGl)
```
