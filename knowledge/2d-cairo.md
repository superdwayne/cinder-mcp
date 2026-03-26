---
title: "2D Drawing with Cairo"
category: "2D Graphics"
namespace: "cinder::cairo"
tags: [cairo, 2d, vector, path, gradient, text, drawing]
---

# 2D Drawing with Cairo

Cairo-based 2D vector rendering in Cinder. Useful for resolution-independent graphics, PDF export, text layout, and complex path operations.

## Path2d & Shape2d

- **Path2d** — A single open or closed contour with moveTo, lineTo, curveTo, quadTo, arc, close
- **Shape2d** — Container for multiple Path2d contours forming a compound shape

## Cairo::Context

The `cairo::Context` wraps a Cairo drawing context. Key operations:

- Path commands: `moveTo()`, `lineTo()`, `curveTo()`, `arc()`, `rectangle()`, `circle()`
- Drawing: `fill()`, `stroke()`, `fillPreserve()`, `strokePreserve()`, `paint()`
- Style: `setLineWidth()`, `setLineCap()`, `setLineJoin()`, `setDash()`
- Source: `setSource(Color)`, `setSource(Pattern)`, `setSourceRgba()`
- State: `save()`, `restore()`, `translate()`, `rotate()`, `scale()`
- Text: `showText()`, `textExtents()`, `setFont()`, `setFontSize()`

## Patterns & Gradients

- **GradientLinear** — Linear gradient between two points with color stops
- **GradientRadial** — Radial gradient between two circles with color stops
- **PatternSurface** — Pattern from an existing cairo surface

## Code Examples

### Custom Shape Drawing

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/cairo/Cairo.h"

using namespace ci;
using namespace ci::app;

class CairoShapeApp : public App {
public:
    gl::Texture2dRef mTexture;

    void setup() override {
        renderCairo();
    }

    void renderCairo() {
        cairo::SurfaceImage surface(getWindowWidth(), getWindowHeight());
        cairo::Context ctx(surface);

        // Background
        ctx.setSourceRgb(0.1, 0.1, 0.15);
        ctx.paint();

        // Draw a star shape using Path2d
        Path2d star;
        int points = 5;
        float outerR = 200.0f, innerR = 80.0f;
        vec2 center = getWindowCenter();

        for (int i = 0; i < points * 2; i++) {
            float angle = (float)i * M_PI / points - M_PI / 2.0f;
            float r = (i % 2 == 0) ? outerR : innerR;
            vec2 pt = center + vec2(cos(angle), sin(angle)) * r;
            if (i == 0) star.moveTo(pt);
            else star.lineTo(pt);
        }
        star.close();

        ctx.setLineWidth(3.0);
        ctx.setSourceRgba(1.0, 0.8, 0.2, 1.0);
        ctx.appendPath(star);
        ctx.fillPreserve();
        ctx.setSourceRgba(1.0, 0.5, 0.0, 1.0);
        ctx.stroke();

        // Draw circles at each vertex
        ctx.setSourceRgba(1.0, 1.0, 1.0, 0.7);
        for (int i = 0; i < star.getNumPoints(); i++) {
            ctx.circle(star.getPoint(i), 5.0);
            ctx.fill();
        }

        mTexture = gl::Texture2d::create(surface.getSurface());
    }

    void draw() override {
        gl::clear(Color::black());
        if (mTexture) gl::draw(mTexture);
    }
};

CINDER_APP(CairoShapeApp, RendererGl)
```

### Gradient Fills

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/cairo/Cairo.h"

using namespace ci;
using namespace ci::app;

class GradientApp : public App {
public:
    gl::Texture2dRef mTexture;

    void setup() override {
        cairo::SurfaceImage surface(getWindowWidth(), getWindowHeight());
        cairo::Context ctx(surface);

        // Linear gradient background
        cairo::GradientLinear bgGrad(
            vec2(0, 0), vec2(0, getWindowHeight())
        );
        bgGrad.addColorStop(0.0, Color(0.1f, 0.0f, 0.2f));
        bgGrad.addColorStop(1.0, Color(0.0f, 0.1f, 0.3f));
        ctx.setSource(bgGrad);
        ctx.paint();

        // Radial gradient circle
        vec2 center = getWindowCenter();
        cairo::GradientRadial radGrad(
            center, 20.0, center, 200.0
        );
        radGrad.addColorStop(0.0, ColorA(1.0f, 0.4f, 0.0f, 1.0f));
        radGrad.addColorStop(0.5, ColorA(1.0f, 0.0f, 0.4f, 0.8f));
        radGrad.addColorStop(1.0, ColorA(0.0f, 0.0f, 0.5f, 0.0f));

        ctx.setSource(radGrad);
        ctx.circle(center, 200.0);
        ctx.fill();

        // Linear gradient rectangle
        Rectf rect(50, 50, 250, 150);
        cairo::GradientLinear boxGrad(
            rect.getUpperLeft(), rect.getLowerRight()
        );
        boxGrad.addColorStop(0.0, Color(0.0f, 1.0f, 0.5f));
        boxGrad.addColorStop(1.0, Color(0.0f, 0.5f, 1.0f));
        ctx.setSource(boxGrad);
        ctx.rectangle(rect);
        ctx.fill();

        mTexture = gl::Texture2d::create(surface.getSurface());
    }

    void draw() override {
        gl::clear(Color::black());
        if (mTexture) gl::draw(mTexture);
    }
};

CINDER_APP(GradientApp, RendererGl)
```

### Text Rendering with Cairo

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/cairo/Cairo.h"

using namespace ci;
using namespace ci::app;

class CairoTextApp : public App {
public:
    gl::Texture2dRef mTexture;

    void setup() override {
        cairo::SurfaceImage surface(getWindowWidth(), getWindowHeight());
        cairo::Context ctx(surface);

        ctx.setSourceRgb(0.05, 0.05, 0.08);
        ctx.paint();

        // Title text
        ctx.setFont(cairo::FontFace("Helvetica"));
        ctx.setFontSize(48.0);
        ctx.setSourceRgb(1.0, 1.0, 1.0);

        std::string title = "Cinder + Cairo";
        cairo::TextExtents extents = ctx.textExtents(title);
        double x = (getWindowWidth() - extents.width()) / 2.0;
        ctx.moveTo(x, 100.0);
        ctx.showText(title);

        // Body text with different sizes
        ctx.setFontSize(18.0);
        ctx.setSourceRgba(0.8, 0.8, 0.9, 0.8);

        std::vector<std::string> lines = {
            "High-quality 2D vector rendering",
            "Resolution-independent graphics",
            "Gradient fills and complex paths",
            "PDF and SVG export support"
        };

        double y = 180.0;
        for (const auto& line : lines) {
            ctx.moveTo(60.0, y);
            ctx.showText(line);
            y += 32.0;
        }

        // Decorative underline
        ctx.setLineWidth(2.0);
        ctx.setSourceRgba(1.0, 0.6, 0.0, 0.6);
        ctx.moveTo(60.0, 115.0);
        ctx.lineTo(getWindowWidth() - 60.0, 115.0);
        ctx.stroke();

        mTexture = gl::Texture2d::create(surface.getSurface());
    }

    void draw() override {
        gl::clear(Color::black());
        if (mTexture) gl::draw(mTexture);
    }
};

CINDER_APP(CairoTextApp, RendererGl)
```
