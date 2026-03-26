---
title: "Textures & Image Processing"
category: "Images"
namespace: "cinder::gl, cinder::ip"
tags: [texture, image, surface, channel, processing, fbo]
---

# Textures & Image Processing

Loading textures, manipulating images on the CPU with `ci::ip`, and render-to-texture with FBOs.

## Texture Types

- **gl::Texture2d** — Standard 2D texture. Created from Surface, file, or raw data.
- **gl::TextureCubeMap** — Six-face cubemap for environment mapping or skyboxes.
- **gl::Texture3d** — 3D volume texture for volumetric effects.

## Image Processing (ci::ip)

CPU-side image manipulation operating on `Surface8u` / `Surface32f`:

- `ip::resize()` — Bilinear/bicubic resize
- `ip::flipVertical()` / `ip::flipHorizontal()` — Mirror operations
- `ip::threshold()` — Binary threshold
- `ip::grayscale()` — Convert to grayscale
- `ip::blend()` — Alpha-composite two surfaces
- `ip::fill()` — Fill a surface with a color

## Surface & Channel

- **Surface8u** / **Surface32f** — RGB(A) image buffer, 8-bit or float
- **Channel8u** / **Channel32f** — Single-channel grayscale buffer
- Use `Surface::getChannel()` to extract individual channels
- Use `Channel` constructors for custom single-channel data (e.g., heightmaps)

## Code Examples

### Texture from File with Error Handling

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/ImageIo.h"
#include "cinder/Log.h"

using namespace ci;
using namespace ci::app;

class TexLoadApp : public App {
public:
    gl::Texture2dRef mTexture;

    void setup() override {
        try {
            auto img = loadImage(loadAsset("photo.jpg"));
            auto fmt = gl::Texture2d::Format()
                .mipmap(true)
                .minFilter(GL_LINEAR_MIPMAP_LINEAR)
                .magFilter(GL_LINEAR)
                .wrap(GL_CLAMP_TO_EDGE, GL_CLAMP_TO_EDGE);

            mTexture = gl::Texture2d::create(img, fmt);
            CI_LOG_I("Texture loaded: " << mTexture->getWidth()
                     << "x" << mTexture->getHeight());
        }
        catch (const std::exception& e) {
            CI_LOG_E("Failed to load texture: " << e.what());
        }
    }

    void draw() override {
        gl::clear(Color::black());
        if (mTexture) {
            gl::draw(mTexture, getWindowBounds());
        }
    }
};

CINDER_APP(TexLoadApp, RendererGl)
```

### Image Processing Pipeline

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/ImageIo.h"
#include "cinder/ip/Resize.h"
#include "cinder/ip/Flip.h"
#include "cinder/ip/Threshold.h"
#include "cinder/ip/Grayscale.h"

using namespace ci;
using namespace ci::app;

class ImgProcApp : public App {
public:
    gl::Texture2dRef mOriginal;
    gl::Texture2dRef mProcessed;

    void setup() override {
        Surface8u original(loadImage(loadAsset("input.png")));

        // Processing pipeline
        // 1. Resize to 512x512
        Surface8u resized = ip::resizeCopy(original, original.getBounds(),
                                            ivec2(512, 512));

        // 2. Convert to grayscale
        Surface8u gray(resized.getWidth(), resized.getHeight(), false);
        ip::grayscale(resized, &gray);

        // 3. Apply threshold
        ip::threshold(&gray, 128.0f / 255.0f);

        // 4. Flip vertically
        ip::flipVertical(&gray);

        mOriginal = gl::Texture2d::create(original);
        mProcessed = gl::Texture2d::create(gray);
    }

    void draw() override {
        gl::clear(Color(0.2f, 0.2f, 0.2f));
        float halfW = getWindowWidth() * 0.5f;

        gl::draw(mOriginal,
                 Rectf(0, 0, halfW, getWindowHeight()));
        gl::draw(mProcessed,
                 Rectf(halfW, 0, getWindowWidth(), getWindowHeight()));
    }
};

CINDER_APP(ImgProcApp, RendererGl)
```

### Render-to-Texture with FBO

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class FboApp : public App {
public:
    gl::FboRef       mFbo;
    gl::BatchRef     mSceneBatch;
    gl::Texture2dRef mFboTexture;

    void setup() override {
        // Create FBO with color and depth attachments
        auto fboFmt = gl::Fbo::Format()
            .colorTexture(
                gl::Texture2d::Format()
                    .minFilter(GL_LINEAR)
                    .magFilter(GL_LINEAR)
                    .internalFormat(GL_RGBA8)
            )
            .depthBuffer();

        mFbo = gl::Fbo::create(1024, 1024, fboFmt);

        auto shader = gl::getStockShader(gl::ShaderDef().lambert().color());
        mSceneBatch = gl::Batch::create(
            geom::Torus() >> geom::ColorFromAttrib(geom::Attrib::NORMAL),
            shader
        );

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void draw() override {
        // Pass 1: Render scene to FBO
        {
            gl::ScopedFramebuffer scopedFbo(mFbo);
            gl::ScopedViewport scopedViewport(ivec2(0), mFbo->getSize());
            gl::clear(Color(0.05f, 0.05f, 0.1f));

            gl::setMatricesWindowPersp(mFbo->getSize(), 60.0f, 0.1f, 100.0f);
            gl::translate(mFbo->getSize() / 2);
            gl::rotate(getElapsedSeconds(), vec3(1, 1, 0));
            gl::scale(vec3(200));

            mSceneBatch->draw();
        }

        // Pass 2: Draw FBO texture to screen
        gl::clear(Color::black());
        gl::setMatricesWindow(getWindowSize());
        gl::draw(mFbo->getColorTexture(), getWindowBounds());
    }
};

CINDER_APP(FboApp, RendererGl)
```
