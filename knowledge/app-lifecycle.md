---
title: "App Setup & Lifecycle"
category: "App"
namespace: "cinder::app"
tags: [app, lifecycle, setup, window, retina, hidpi, multiwindow, filedrop]
---

# App Setup & Lifecycle

Application configuration, window management, multi-window support, and platform display considerations.

## prepareSettings

The `prepareSettings` callback (passed to `CINDER_APP` macro or overridden) configures the app before the window is created:

- `settings->setWindowSize(width, height)` — Initial window dimensions
- `settings->setFullScreen(true)` — Launch fullscreen
- `settings->setHighDensityDisplayEnabled(true)` — Retina/HiDPI support
- `settings->setMultiTouchEnabled(true)` — Enable multi-touch events
- `settings->setResizable(true/false)` — Allow window resize
- `settings->setFrameRate(60.0f)` — Target frame rate
- `settings->setTitle("My App")` — Window title

## Lifecycle Methods

- `setup()` — Called once after GL context is ready. Load resources, create geometry.
- `update()` — Called every frame before draw. Update simulation state.
- `draw()` — Called every frame. All rendering goes here.
- `cleanup()` — Called before app destruction. Release resources.
- `resize()` — Called when window size changes.

## Multi-Window Support

Create additional windows with `createWindow()`:

- Each window has its own GL context (shared)
- Connect to per-window signals for events
- Use `getWindow()` to get the current window in callbacks

## High-Density Display (Retina)

When `setHighDensityDisplayEnabled(true)`:

- `getWindowSize()` returns points (logical pixels)
- `toPixels(getWindowSize())` returns actual pixel dimensions
- `getWindowContentScale()` returns the scale factor (2.0 on Retina)
- FBOs and textures should use pixel dimensions

## Code Examples

### Full App Setup with Configuration

```cpp
#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/Log.h"
#include "cinder/params/Params.h"

using namespace ci;
using namespace ci::app;

class FullSetupApp : public App {
public:
    params::InterfaceGlRef mParams;
    float  mRadius = 50.0f;
    ColorA mColor = ColorA(1, 0.5f, 0, 1);
    int    mSubdivisions = 32;
    bool   mWireframe = false;
    float  mRotationSpeed = 1.0f;

    void setup() override {
        CI_LOG_I("App setup — window: " << getWindowSize()
                 << ", content scale: " << getWindowContentScale());

        // Debug parameter UI
        mParams = params::InterfaceGl::create("Settings", ivec2(220, 200));
        mParams->addParam("Radius", &mRadius)
            .min(10.0f).max(200.0f).step(1.0f);
        mParams->addParam("Color", &mColor);
        mParams->addParam("Subdivisions", &mSubdivisions)
            .min(3).max(128);
        mParams->addParam("Wireframe", &mWireframe);
        mParams->addParam("Rotation Speed", &mRotationSpeed)
            .min(0.0f).max(5.0f).step(0.1f);

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void update() override {
        // Simulation / state updates
    }

    void draw() override {
        gl::clear(Color(0.1f, 0.1f, 0.12f));
        gl::setMatricesWindowPersp(getWindowSize(), 60.0f, 0.1f, 1000.0f);

        gl::translate(getWindowCenter());
        gl::rotate(getElapsedSeconds() * mRotationSpeed, vec3(0, 1, 0));

        gl::color(mColor);

        if (mWireframe) {
            gl::enableWireframe();
        }

        gl::drawSphere(vec3(0), mRadius, mSubdivisions);

        if (mWireframe) {
            gl::disableWireframe();
        }

        // Draw params UI
        mParams->draw();
    }

    void resize() override {
        CI_LOG_I("Resized to: " << getWindowSize());
    }

    void cleanup() override {
        CI_LOG_I("App cleanup");
    }
};

CINDER_APP(FullSetupApp, RendererGl,
    [](App::Settings* settings) {
        settings->setWindowSize(1280, 720);
        settings->setTitle("Cinder Full Setup");
        settings->setHighDensityDisplayEnabled(true);
        settings->setResizable(true);
        settings->setFrameRate(60.0f);
    })
```

### Multi-Window App

```cpp
#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class MultiWindowApp : public App {
public:
    app::WindowRef mControlWindow;
    float mHue = 0.0f;

    void setup() override {
        // The main window is created automatically
        getWindow()->setTitle("Render Window");

        // Create a second window for controls
        mControlWindow = createWindow(
            Window::Format().size(400, 300).title("Control Panel")
        );

        // Connect draw signal for the second window
        mControlWindow->getSignalDraw().connect(
            [this]() { drawControlWindow(); }
        );

        // Connect mouse events on control window
        mControlWindow->getSignalMouseDrag().connect(
            [this](MouseEvent& event) {
                mHue = (float)event.getX() /
                       mControlWindow->getWidth();
            }
        );
    }

    void drawControlWindow() {
        gl::clear(Color(0.2f, 0.2f, 0.2f));

        // Draw color picker bar
        for (int x = 0; x < mControlWindow->getWidth(); x++) {
            float h = (float)x / mControlWindow->getWidth();
            gl::color(Color(CM_HSV, h, 1.0f, 1.0f));
            gl::drawLine(vec2(x, 50), vec2(x, 100));
        }

        // Draw current selection
        float indicatorX = mHue * mControlWindow->getWidth();
        gl::color(1, 1, 1);
        gl::drawStrokedRect(Rectf(indicatorX - 3, 45,
                                   indicatorX + 3, 105));

        gl::drawString("Drag to change hue",
                        vec2(10, 120), Color::white());
    }

    void draw() override {
        // Main render window
        gl::clear(Color(CM_HSV, mHue, 0.6f, 0.15f));
        gl::setMatricesWindowPersp(getWindowSize());

        gl::color(Color(CM_HSV, mHue, 0.9f, 0.9f));
        gl::translate(getWindowCenter());
        gl::rotate(getElapsedSeconds(), vec3(0, 1, 0));
        gl::drawSolidRect(Rectf(-100, -100, 100, 100));
    }
};

CINDER_APP(MultiWindowApp, RendererGl,
    [](App::Settings* settings) {
        settings->setWindowSize(800, 600);
    })
```

### File Drop Handler

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/ImageIo.h"
#include "cinder/Log.h"

using namespace ci;
using namespace ci::app;

class FileDropApp : public App {
public:
    gl::Texture2dRef              mTexture;
    std::string                   mStatusText = "Drop an image file here";
    std::vector<fs::path>         mDroppedFiles;

    void setup() override {
        // File drop can also be handled via signal
        getWindow()->getSignalFileDrop().connect(
            [this](FileDropEvent& event) {
                handleDrop(event);
            }
        );
    }

    void handleDrop(const FileDropEvent& event) {
        mDroppedFiles.clear();

        for (size_t i = 0; i < event.getNumFiles(); i++) {
            auto filePath = event.getFile(i);
            mDroppedFiles.push_back(filePath);
            CI_LOG_I("Dropped file: " << filePath);

            // Try to load as image
            std::string ext = filePath.extension().string();
            if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" ||
                ext == ".bmp" || ext == ".tga") {
                try {
                    auto surface = loadImage(filePath);
                    auto fmt = gl::Texture2d::Format()
                        .mipmap(true)
                        .minFilter(GL_LINEAR_MIPMAP_LINEAR);
                    mTexture = gl::Texture2d::create(surface, fmt);
                    mStatusText = "Loaded: " + filePath.filename().string()
                        + " (" + std::to_string(mTexture->getWidth())
                        + "x" + std::to_string(mTexture->getHeight()) + ")";
                }
                catch (const std::exception& e) {
                    mStatusText = "Error: " + std::string(e.what());
                    CI_LOG_E("Load error: " << e.what());
                }
            } else {
                mStatusText = "Unsupported format: " + ext;
            }
        }
    }

    void draw() override {
        gl::clear(Color(0.12f, 0.12f, 0.15f));

        if (mTexture) {
            Rectf texBounds(vec2(0), mTexture->getSize());
            Rectf fitBounds = texBounds.getCenteredFit(
                getWindowBounds(), true
            );
            gl::draw(mTexture, fitBounds);
        }

        // Status text
        gl::color(1, 1, 1);
        gl::drawString(mStatusText, vec2(10, getWindowHeight() - 30),
                        Color::white(), Font("Arial", 14));

        // Drop zone border
        if (!mTexture) {
            gl::color(0.3f, 0.3f, 0.4f);
            gl::drawStrokedRect(
                Rectf(20, 20, getWindowWidth() - 20,
                       getWindowHeight() - 50)
            );
        }
    }
};

CINDER_APP(FileDropApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(800, 600); })
```
