---
title: "Data Visualization Patterns"
category: "2D Graphics"
namespace: "cinder::gl"
tags: [dataviz, charts, visualization, hud, path, text]
---

# Data Visualization Patterns

Patterns for building charts, graphs, and HUD overlays in Cinder using Path2d, gl drawing primitives, and text rendering.

## Line Charts & Paths

Use `Path2d` to build smooth line charts:
- `moveTo()` for the first point
- `lineTo()` for linear segments
- `curveTo()` for cubic Bezier smooth curves
- Convert to `gl::draw(path)` for stroke rendering

## Bar Charts

Use `gl::drawSolidRect()` or `gl::Batch` with `geom::Rect()` for bar chart rectangles. Color-code with `gl::color()` or per-vertex colors.

## Scatter Plots

Use `gl::drawSolidCircle()` for individual points, or a `gl::VboMesh` with `GL_POINTS` for large datasets.

## HUD Text

- `gl::drawString(text, position, color, font)` — Simple text rendering
- `gl::drawStringCentered()` — Centered text
- `gl::drawStringRight()` — Right-aligned text
- `TextBox` for multi-line text with wrapping

## Code Examples

### Animated Line Chart

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Rand.h"
#include "cinder/Perlin.h"

using namespace ci;
using namespace ci::app;

class LineChartApp : public App {
public:
    static const int NUM_POINTS = 100;
    std::vector<float> mData;
    Perlin mPerlin;

    void setup() override {
        mPerlin = Perlin(3, 12345);
        mData.resize(NUM_POINTS, 0.0f);
    }

    void update() override {
        // Generate animated data using Perlin noise
        float time = getElapsedSeconds() * 0.3f;
        for (int i = 0; i < NUM_POINTS; i++) {
            mData[i] = mPerlin.noise(i * 0.05f, time) * 0.5f + 0.5f;
        }
    }

    void draw() override {
        gl::clear(Color(0.08f, 0.08f, 0.1f));

        float margin = 60.0f;
        float chartW = getWindowWidth() - margin * 2;
        float chartH = getWindowHeight() - margin * 2;

        // Draw grid
        gl::color(0.15f, 0.15f, 0.2f);
        for (int i = 0; i <= 10; i++) {
            float y = margin + chartH * (i / 10.0f);
            gl::drawLine(vec2(margin, y),
                         vec2(margin + chartW, y));
        }
        for (int i = 0; i <= NUM_POINTS; i += 10) {
            float x = margin + chartW * ((float)i / NUM_POINTS);
            gl::drawLine(vec2(x, margin),
                         vec2(x, margin + chartH));
        }

        // Build line path
        Path2d line;
        for (int i = 0; i < NUM_POINTS; i++) {
            float x = margin + chartW * ((float)i / (NUM_POINTS - 1));
            float y = margin + chartH * (1.0f - mData[i]);

            if (i == 0) line.moveTo(x, y);
            else line.lineTo(x, y);
        }

        // Draw filled area under curve
        Path2d area = line;
        area.lineTo(margin + chartW, margin + chartH);
        area.lineTo(margin, margin + chartH);
        area.close();

        gl::enableAlphaBlending();
        gl::color(ColorA(0.2f, 0.6f, 1.0f, 0.15f));
        gl::drawSolid(area);

        // Draw line
        gl::color(0.3f, 0.7f, 1.0f);
        gl::draw(line);

        // Draw data points
        for (int i = 0; i < NUM_POINTS; i += 5) {
            float x = margin + chartW * ((float)i / (NUM_POINTS - 1));
            float y = margin + chartH * (1.0f - mData[i]);
            gl::drawSolidCircle(vec2(x, y), 3.0f);
        }

        // Axis labels
        gl::color(0.6f, 0.6f, 0.7f);
        gl::drawString("Time", vec2(getWindowCenter().x, margin + chartH + 30),
                        Color(0.6f, 0.6f, 0.7f), Font("Arial", 14));
        gl::drawStringCentered("Noise Signal",
            vec2(getWindowCenter().x, margin - 25),
            Color::white(), Font("Arial", 18));

        gl::disableAlphaBlending();
    }
};

CINDER_APP(LineChartApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(900, 500); })
```

### Bar Chart with Labels

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Rand.h"

using namespace ci;
using namespace ci::app;

class BarChartApp : public App {
public:
    struct BarData {
        std::string label;
        float value;
        Color color;
    };

    std::vector<BarData> mBars;

    void setup() override {
        mBars = {
            { "Jan", 0.65f, Color(0.2f, 0.6f, 1.0f) },
            { "Feb", 0.45f, Color(0.3f, 0.7f, 0.9f) },
            { "Mar", 0.80f, Color(0.1f, 0.8f, 0.6f) },
            { "Apr", 0.55f, Color(0.2f, 0.9f, 0.4f) },
            { "May", 0.92f, Color(1.0f, 0.8f, 0.2f) },
            { "Jun", 0.70f, Color(1.0f, 0.5f, 0.2f) },
            { "Jul", 0.38f, Color(1.0f, 0.3f, 0.3f) },
            { "Aug", 0.85f, Color(0.8f, 0.2f, 0.6f) },
        };
    }

    void draw() override {
        gl::clear(Color(0.06f, 0.06f, 0.09f));

        float margin = 60.0f;
        float chartW = getWindowWidth() - margin * 2;
        float chartH = getWindowHeight() - margin * 2 - 40;
        float barGap = 10.0f;
        float barWidth = (chartW - barGap * (mBars.size() - 1)) / mBars.size();
        float baseY = margin + chartH;

        // Draw horizontal gridlines and labels
        gl::color(0.15f, 0.15f, 0.2f);
        for (int i = 0; i <= 5; i++) {
            float y = baseY - chartH * (i / 5.0f);
            gl::drawLine(vec2(margin, y), vec2(margin + chartW, y));

            int pct = i * 20;
            gl::drawStringRight(std::to_string(pct) + "%",
                vec2(margin - 10, y - 7),
                Color(0.5f, 0.5f, 0.6f), Font("Arial", 12));
        }

        // Draw bars
        for (size_t i = 0; i < mBars.size(); i++) {
            float x = margin + i * (barWidth + barGap);
            float height = mBars[i].value * chartH;

            // Bar shadow
            gl::color(ColorA(0, 0, 0, 0.3f));
            gl::drawSolidRect(Rectf(
                x + 3, baseY - height + 3,
                x + barWidth + 3, baseY + 3
            ));

            // Bar fill
            gl::color(mBars[i].color);
            gl::drawSolidRect(Rectf(
                x, baseY - height,
                x + barWidth, baseY
            ));

            // Value label
            gl::drawStringCentered(
                std::to_string((int)(mBars[i].value * 100)) + "%",
                vec2(x + barWidth / 2, baseY - height - 15),
                Color::white(), Font("Arial", 12));

            // Category label
            gl::drawStringCentered(mBars[i].label,
                vec2(x + barWidth / 2, baseY + 15),
                Color(0.7f, 0.7f, 0.8f), Font("Arial", 13));
        }

        // Title
        gl::drawStringCentered("Monthly Performance",
            vec2(getWindowCenter().x, 25),
            Color::white(), Font("Arial", 20));
    }
};

CINDER_APP(BarChartApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(900, 500); })
```

### HUD Overlay

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class HudApp : public App {
public:
    gl::BatchRef mScene;
    float mRotation = 0;

    void setup() override {
        auto shader = gl::getStockShader(gl::ShaderDef().lambert().color());
        mScene = gl::Batch::create(
            geom::Torus().ratio(0.3f).subdivisionsAxis(64)
                >> geom::ColorFromAttrib(geom::Attrib::NORMAL),
            shader
        );
        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void update() override {
        mRotation += 0.01f;
    }

    void draw() override {
        gl::clear(Color(0.05f, 0.05f, 0.08f));

        // 3D Scene
        gl::setMatricesWindowPersp(getWindowSize(), 60.0f, 0.1f, 100.0f);
        gl::translate(getWindowCenter().x, getWindowCenter().y, -5.0f);
        gl::rotate(mRotation, vec3(1, 1, 0));
        mScene->draw();

        // Switch to 2D for HUD
        gl::setMatricesWindow(getWindowSize());
        gl::disableDepthRead();
        gl::enableAlphaBlending();

        // HUD background panels
        gl::color(ColorA(0, 0, 0, 0.6f));
        gl::drawSolidRect(Rectf(10, 10, 220, 120));
        gl::drawSolidRect(Rectf(
            getWindowWidth() - 180, 10,
            getWindowWidth() - 10, 70
        ));

        // Stats panel (top-left)
        float fps = getAverageFps();
        gl::drawString("FPS: " + std::to_string((int)fps),
            vec2(20, 20), Color(0.3f, 1.0f, 0.3f), Font("Menlo", 14));
        gl::drawString("Frame: " + std::to_string(getElapsedFrames()),
            vec2(20, 40), Color(0.8f, 0.8f, 0.8f), Font("Menlo", 14));
        gl::drawString("Time: " +
            std::to_string((int)getElapsedSeconds()) + "s",
            vec2(20, 60), Color(0.8f, 0.8f, 0.8f), Font("Menlo", 14));
        gl::drawString("Window: " +
            std::to_string(getWindowWidth()) + "x" +
            std::to_string(getWindowHeight()),
            vec2(20, 80), Color(0.6f, 0.6f, 0.7f), Font("Menlo", 12));

        // Status panel (top-right)
        gl::drawStringRight("RECORDING",
            vec2(getWindowWidth() - 20, 20),
            Color(1.0f, 0.3f, 0.3f), Font("Menlo", 14));
        gl::drawStringRight("Live",
            vec2(getWindowWidth() - 20, 42),
            Color(0.3f, 1.0f, 0.5f), Font("Menlo", 12));

        // Crosshair at center
        vec2 c = getWindowCenter();
        gl::color(ColorA(1, 1, 1, 0.3f));
        gl::drawLine(vec2(c.x - 20, c.y), vec2(c.x + 20, c.y));
        gl::drawLine(vec2(c.x, c.y - 20), vec2(c.x, c.y + 20));

        gl::disableAlphaBlending();
        gl::enableDepthRead();
    }
};

CINDER_APP(HudApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(900, 600); })
```
