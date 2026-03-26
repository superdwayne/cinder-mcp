---
title: "Platform-Specific Code"
category: "Platform"
namespace: "cinder"
tags: [platform, macos, windows, retina, hidpi, native, dialog, cocoa]
---

# Platform-Specific Code

Handling platform differences between macOS and Windows in Cinder applications.

## Preprocessor Guards

Cinder defines platform macros:

- `CINDER_MAC` — macOS (also `CINDER_COCOA`, `CINDER_COCOA_TOUCH` for iOS)
- `CINDER_MSW` — Windows
- `CINDER_LINUX` — Linux
- `CINDER_GL_ES` — OpenGL ES (mobile)

Use `#if defined(CINDER_MAC)` for platform-conditional code.

## macOS Specifics

- **Retina/HiDPI**: Enable with `setHighDensityDisplayEnabled(true)`. Use `toPixels()` for GPU resources.
- **File dialogs**: `getOpenFilePath()`, `getSaveFilePath()`, `getFolderPath()` use native NSOpenPanel/NSSavePanel.
- **Cocoa integration**: Access NSWindow via `getWindow()->getNative()` (cast to `NSWindow*`).
- **Bundle resources**: Use `loadResource()` to load from app bundle.

## Windows Specifics

- **COM initialization**: Cinder handles COM init for media playback.
- **Native dialogs**: Same `getOpenFilePath()` / `getSaveFilePath()` API wraps Win32 dialogs.
- **DPI awareness**: Windows 10+ DPI awareness is handled by Cinder when HiDPI is enabled.
- **ANGLE**: Optional ANGLE renderer for DirectX-backed OpenGL ES on Windows.

## Cross-Platform File Dialogs

Cinder provides cross-platform file dialog functions:

- `getOpenFilePath(initialPath, extensions)` — Open file picker
- `getSaveFilePath(initialPath, extensions)` — Save file picker
- `getFolderPath(initialPath)` — Folder picker

## Code Examples

### Native File Dialog with Platform Detection

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/ImageIo.h"
#include "cinder/Log.h"

#if defined(CINDER_MAC)
    #include "cinder/cocoa/CinderCocoa.h"
#endif

using namespace ci;
using namespace ci::app;

class PlatformApp : public App {
public:
    gl::Texture2dRef mTexture;
    std::string      mPlatformInfo;

    void setup() override {
        // Detect platform
        #if defined(CINDER_MAC)
            mPlatformInfo = "macOS — Content scale: "
                + std::to_string(getWindowContentScale());
        #elif defined(CINDER_MSW)
            mPlatformInfo = "Windows — DPI scale: "
                + std::to_string(getWindowContentScale());
        #elif defined(CINDER_LINUX)
            mPlatformInfo = "Linux";
        #endif

        CI_LOG_I("Platform: " << mPlatformInfo);
    }

    void keyDown(KeyEvent event) override {
        if (event.getChar() == 'o') {
            // Cross-platform file open dialog
            auto path = getOpenFilePath(
                getHomeDirectory(),
                { "png", "jpg", "jpeg", "bmp", "tga", "gif" }
            );

            if (!path.empty()) {
                try {
                    auto img = loadImage(path);
                    mTexture = gl::Texture2d::create(img,
                        gl::Texture2d::Format().mipmap(true));
                    CI_LOG_I("Loaded: " << path);
                }
                catch (const std::exception& e) {
                    CI_LOG_E("Load failed: " << e.what());
                }
            }
        }

        if (event.getChar() == 's' && mTexture) {
            auto path = getSaveFilePath(
                getHomeDirectory() / "export.png",
                { "png", "jpg" }
            );

            if (!path.empty()) {
                // Read back texture and save
                Surface8u surface(mTexture->createSource());
                writeImage(path, surface);
                CI_LOG_I("Saved: " << path);
            }
        }
    }

    void draw() override {
        gl::clear(Color(0.1f, 0.1f, 0.13f));

        if (mTexture) {
            Rectf bounds(vec2(0), mTexture->getSize());
            gl::draw(mTexture,
                     bounds.getCenteredFit(getWindowBounds(), true));
        }

        gl::drawString(mPlatformInfo, vec2(10, 10), Color::white());
        gl::drawString("Press 'O' to open, 'S' to save",
                        vec2(10, 30), Color(0.6f, 0.6f, 0.6f));
    }
};

CINDER_APP(PlatformApp, RendererGl,
    [](App::Settings* s) {
        s->setWindowSize(800, 600);
        s->setHighDensityDisplayEnabled(true);
    })
```

### Platform-Conditional Rendering

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class PlatformRenderApp : public App {
public:
    gl::FboRef mFbo;

    void setup() override {
        // Use pixel dimensions for FBO on HiDPI displays
        ivec2 fboSize = toPixels(getWindowSize());

        CI_LOG_I("Window (points): " << getWindowSize());
        CI_LOG_I("FBO (pixels): " << fboSize);

        auto fmt = gl::Fbo::Format()
            .colorTexture()
            .depthBuffer();

        #if defined(CINDER_MAC)
            // macOS: use RGBA16F for wider color gamut on P3 displays
            fmt.colorTexture(
                gl::Texture2d::Format()
                    .internalFormat(GL_RGBA16F)
                    .minFilter(GL_LINEAR)
                    .magFilter(GL_LINEAR)
            );
        #elif defined(CINDER_MSW)
            // Windows: standard RGBA8
            fmt.colorTexture(
                gl::Texture2d::Format()
                    .internalFormat(GL_RGBA8)
                    .minFilter(GL_LINEAR)
                    .magFilter(GL_LINEAR)
            );
        #endif

        mFbo = gl::Fbo::create(fboSize.x, fboSize.y, fmt);

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void draw() override {
        // Render to FBO at pixel resolution
        {
            gl::ScopedFramebuffer fbo(mFbo);
            gl::ScopedViewport vp(ivec2(0), mFbo->getSize());
            gl::clear(Color(0.05f, 0.05f, 0.1f));

            gl::setMatricesWindowPersp(mFbo->getSize());
            gl::translate(vec2(mFbo->getSize()) * 0.5f);
            gl::rotate(getElapsedSeconds(), vec3(1, 1, 0));

            float scale = mFbo->getWidth() * 0.15f;
            gl::scale(vec3(scale));

            gl::color(Color(CM_HSV,
                fmod(getElapsedSeconds() * 0.1f, 1.0f), 0.8f, 0.9f));
            gl::drawSolidCube(vec3(0), vec3(1));
        }

        // Display FBO at window resolution
        gl::clear(Color::black());
        gl::setMatricesWindow(getWindowSize());
        gl::draw(mFbo->getColorTexture(), getWindowBounds());

        // Platform info
        std::string info;
        #if defined(CINDER_MAC)
            info = "macOS Retina";
        #elif defined(CINDER_MSW)
            info = "Windows";
        #else
            info = "Other";
        #endif
        info += " | Scale: " + std::to_string(getWindowContentScale());
        gl::drawString(info, vec2(10, 10), Color::white());
    }
};

CINDER_APP(PlatformRenderApp, RendererGl,
    [](App::Settings* s) {
        s->setWindowSize(800, 600);
        s->setHighDensityDisplayEnabled(true);
    })
```
