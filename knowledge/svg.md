---
title: "SVG Loading & Rendering"
category: "2D Graphics"
namespace: "cinder::svg"
tags: [svg, vector, loading, rendering, 2d]
---

# SVG Loading & Rendering

Cinder can load and render SVG files using `ci::svg::Doc`. SVG nodes can be traversed, manipulated, and rendered to either OpenGL or Cairo contexts.

## ci::svg::Doc

The `svg::Doc` class parses an SVG file and provides access to the document tree:

- Load from file: `svg::Doc::create(loadAsset("file.svg"))`
- Load from data source: `svg::Doc::create(dataSource)`
- Query size: `getWidth()`, `getHeight()`, `getBounds()`
- Find nodes by ID: `findNode("id")`
- Iterate children: `getNumChildren()`, range-based for

## Rendering

- Use `gl::draw(svgDoc)` for simple rendering
- Use `gl::draw(svgDoc, rect)` to fit into a rect
- Render individual nodes for selective display

## Node Traversal

SVG nodes form a tree. Each node has:
- `getId()` — SVG id attribute
- `getTransform()` — Local transform matrix
- `getBoundingBox()` — Axis-aligned bounding rect
- Cast to specific types: `svg::Group`, `svg::Path`, `svg::Rect`, etc.

## Code Examples

### SVG Load and Draw

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/svg/Svg.h"

using namespace ci;
using namespace ci::app;

class SvgApp : public App {
public:
    svg::DocRef mSvgDoc;

    void setup() override {
        try {
            mSvgDoc = svg::Doc::create(loadAsset("illustration.svg"));
            CI_LOG_I("SVG loaded: " << mSvgDoc->getWidth()
                     << "x" << mSvgDoc->getHeight());
        }
        catch (const std::exception& e) {
            CI_LOG_E("SVG load failed: " << e.what());
        }
    }

    void draw() override {
        gl::clear(Color::white());

        if (mSvgDoc) {
            // Fit SVG to window while maintaining aspect ratio
            Rectf svgBounds(0, 0, mSvgDoc->getWidth(), mSvgDoc->getHeight());
            Rectf windowBounds = getWindowBounds();
            Rectf fitRect = svgBounds.getCenteredFit(windowBounds, true);

            gl::pushModelMatrix();
            gl::translate(fitRect.getUpperLeft());
            gl::scale(fitRect.getSize() / svgBounds.getSize());
            gl::draw(*mSvgDoc);
            gl::popModelMatrix();
        }
    }
};

CINDER_APP(SvgApp, RendererGl)
```

### SVG Rendered to Texture

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/svg/Svg.h"
#include "cinder/cairo/Cairo.h"

using namespace ci;
using namespace ci::app;

class SvgTextureApp : public App {
public:
    gl::Texture2dRef mSvgTexture;

    void setup() override {
        auto svgDoc = svg::Doc::create(loadAsset("icon.svg"));
        int texWidth = 512, texHeight = 512;

        // Render SVG to Cairo surface, then to GL texture
        cairo::SurfaceImage cairoSurface(texWidth, texHeight, true);
        cairo::Context ctx(cairoSurface);

        // Clear with transparency
        ctx.setSourceRgba(0, 0, 0, 0);
        ctx.setOperator(cairo::OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(cairo::OPERATOR_OVER);

        // Scale SVG to fit texture
        float scaleX = (float)texWidth / svgDoc->getWidth();
        float scaleY = (float)texHeight / svgDoc->getHeight();
        float scale = std::min(scaleX, scaleY);
        ctx.scale(scale, scale);

        // Render SVG
        ctx.render(*svgDoc);

        mSvgTexture = gl::Texture2d::create(cairoSurface.getSurface());
    }

    void draw() override {
        gl::clear(Color(0.2f, 0.2f, 0.25f));
        gl::enableAlphaBlending();

        if (mSvgTexture) {
            gl::draw(mSvgTexture, getWindowCenter() - mSvgTexture->getSize() / 2);
        }

        gl::disableAlphaBlending();
    }
};

CINDER_APP(SvgTextureApp, RendererGl)
```

### Animated SVG Elements by Node ID

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/svg/Svg.h"

using namespace ci;
using namespace ci::app;

class AnimSvgApp : public App {
public:
    svg::DocRef mDoc;

    void setup() override {
        mDoc = svg::Doc::create(loadAsset("diagram.svg"));
    }

    void draw() override {
        gl::clear(Color::white());
        if (!mDoc) return;

        gl::pushModelMatrix();
        gl::translate(getWindowCenter());

        float t = getElapsedSeconds();

        // Draw the full SVG as base
        gl::pushModelMatrix();
        gl::scale(vec2(0.5f));
        gl::translate(-mDoc->getWidth() / 2.0f, -mDoc->getHeight() / 2.0f);
        gl::draw(*mDoc);
        gl::popModelMatrix();

        // Animate specific nodes if they exist
        // Nodes are found by their SVG id attribute
        const svg::Node* gear = mDoc->findNode("gear-icon");
        if (gear) {
            gl::pushModelMatrix();
            Rectf bounds = gear->getBoundingBox();
            vec2 center = bounds.getCenter();
            gl::translate(center * 0.5f - mDoc->getSize() * 0.25f);
            gl::rotate(t * 2.0f);
            gl::translate(-center * 0.5f);
            // Individual node rendering would go here
            gl::popModelMatrix();
        }

        gl::popModelMatrix();
    }
};

CINDER_APP(AnimSvgApp, RendererGl)
```
