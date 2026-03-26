---
title: "Video Playback & Capture"
category: "Video"
namespace: "cinder::qtime, cinder::Capture"
tags: [video, movie, webcam, capture, playback, texture]
---

# Video Playback & Capture

Video playback with `ci::qtime::MovieGl` and webcam capture with `ci::Capture`.

## MovieGl (Video Playback)

`ci::qtime::MovieGl` plays video files and provides each frame as a GL texture:

- Load: `qtime::MovieGl::create(loadAsset("video.mp4"))`
- Playback: `play()`, `stop()`, `seekToTime()`, `setLoop()`
- Query: `isPlaying()`, `isDone()`, `getCurrentTime()`, `getDuration()`
- Texture: `getTexture()` returns current frame as `gl::Texture2dRef`

## Capture (Webcam)

`ci::Capture` provides access to webcam/camera devices:

- List devices: `Capture::getDevices()`
- Create: `Capture::create(width, height)`
- Check: `checkNewFrame()` returns true when a new frame is available
- Get frame: `getSurface()` returns the current frame as a `Surface8u`

## Pattern: Video as Texture

The common pattern is to call `getTexture()` or create a texture from the capture surface each frame, then use it like any other texture for mapping onto geometry or post-processing.

## Code Examples

### Movie Playback with Controls

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/qtime/QuickTimeGl.h"

using namespace ci;
using namespace ci::app;

class MovieApp : public App {
public:
    qtime::MovieGlRef mMovie;
    gl::Texture2dRef  mFrameTexture;

    void setup() override {
        try {
            mMovie = qtime::MovieGl::create(loadAsset("clip.mp4"));
            mMovie->setLoop(true);
            mMovie->play();
        }
        catch (const std::exception& e) {
            CI_LOG_E("Movie load error: " << e.what());
        }
    }

    void keyDown(KeyEvent event) override {
        if (!mMovie) return;

        switch (event.getCode()) {
            case KeyEvent::KEY_SPACE:
                mMovie->isPlaying() ? mMovie->stop() : mMovie->play();
                break;
            case KeyEvent::KEY_LEFT:
                mMovie->seekToTime(
                    std::max(0.0f, mMovie->getCurrentTime() - 5.0f)
                );
                break;
            case KeyEvent::KEY_RIGHT:
                mMovie->seekToTime(
                    std::min(mMovie->getDuration(),
                             mMovie->getCurrentTime() + 5.0f)
                );
                break;
            case KeyEvent::KEY_r:
                mMovie->seekToStart();
                mMovie->play();
                break;
        }
    }

    void draw() override {
        gl::clear(Color::black());

        if (mMovie) {
            mFrameTexture = mMovie->getTexture();
        }

        if (mFrameTexture) {
            Rectf texBounds(vec2(0), mFrameTexture->getSize());
            Rectf drawBounds = texBounds.getCenteredFit(
                getWindowBounds(), true
            );
            gl::draw(mFrameTexture, drawBounds);

            // Draw progress bar
            float progress = mMovie->getCurrentTime() / mMovie->getDuration();
            gl::color(0.3f, 0.3f, 0.3f);
            gl::drawSolidRect(Rectf(
                10, getWindowHeight() - 20,
                getWindowWidth() - 10, getWindowHeight() - 10
            ));
            gl::color(1.0f, 0.5f, 0.0f);
            gl::drawSolidRect(Rectf(
                10, getWindowHeight() - 20,
                10 + (getWindowWidth() - 20) * progress,
                getWindowHeight() - 10
            ));
            gl::color(1, 1, 1);
        }
    }
};

CINDER_APP(MovieApp, RendererGl)
```

### Webcam to Texture

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Capture.h"

using namespace ci;
using namespace ci::app;

class WebcamApp : public App {
public:
    CaptureRef       mCapture;
    gl::Texture2dRef mTexture;

    void setup() override {
        try {
            // List available devices
            auto devices = Capture::getDevices();
            for (const auto& dev : devices) {
                CI_LOG_I("Camera: " << dev->getName());
            }

            mCapture = Capture::create(1280, 720);
            mCapture->start();
        }
        catch (const CaptureExc& e) {
            CI_LOG_E("Capture error: " << e.what());
        }
    }

    void update() override {
        if (mCapture && mCapture->checkNewFrame()) {
            if (!mTexture) {
                mTexture = gl::Texture2d::create(
                    *mCapture->getSurface(),
                    gl::Texture2d::Format().loadTopDown()
                );
            } else {
                mTexture->update(*mCapture->getSurface());
            }
        }
    }

    void draw() override {
        gl::clear(Color::black());
        if (mTexture) {
            gl::draw(mTexture,
                     getWindowBounds());
        }
    }
};

CINDER_APP(WebcamApp, RendererGl)
```

### Video Processing (Webcam + Shader)

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Capture.h"

using namespace ci;
using namespace ci::app;

class VideoFxApp : public App {
public:
    CaptureRef       mCapture;
    gl::Texture2dRef mTexture;
    gl::GlslProgRef  mShader;
    gl::FboRef       mFbo;

    void setup() override {
        mCapture = Capture::create(1280, 720);
        mCapture->start();

        // Edge detection shader
        mShader = gl::GlslProg::create(
            gl::GlslProg::Format()
                .vertex(CI_GLSL(150,
                    uniform mat4 ciModelViewProjection;
                    in vec4 ciPosition;
                    in vec2 ciTexCoord0;
                    out vec2 vTexCoord;
                    void main() {
                        vTexCoord = ciTexCoord0;
                        gl_Position = ciModelViewProjection * ciPosition;
                    }
                ))
                .fragment(CI_GLSL(150,
                    uniform sampler2D uTexture;
                    uniform vec2 uPixelSize;
                    in vec2 vTexCoord;
                    out vec4 oColor;
                    void main() {
                        vec4 c  = texture(uTexture, vTexCoord);
                        vec4 cx = texture(uTexture, vTexCoord + vec2(uPixelSize.x, 0));
                        vec4 cy = texture(uTexture, vTexCoord + vec2(0, uPixelSize.y));
                        vec3 edge = abs(c.rgb - cx.rgb) + abs(c.rgb - cy.rgb);
                        oColor = vec4(edge * 3.0, 1.0);
                    }
                ))
        );

        mFbo = gl::Fbo::create(1280, 720);
    }

    void update() override {
        if (mCapture && mCapture->checkNewFrame()) {
            if (!mTexture) {
                mTexture = gl::Texture2d::create(
                    *mCapture->getSurface(),
                    gl::Texture2d::Format().loadTopDown()
                );
            } else {
                mTexture->update(*mCapture->getSurface());
            }
        }
    }

    void draw() override {
        gl::clear(Color::black());
        if (!mTexture) return;

        // Render processed video to FBO
        {
            gl::ScopedFramebuffer fbo(mFbo);
            gl::ScopedViewport vp(ivec2(0), mFbo->getSize());
            gl::clear(Color::black());
            gl::setMatricesWindow(mFbo->getSize());

            gl::ScopedGlslProg shader(mShader);
            mShader->uniform("uTexture", 0);
            mShader->uniform("uPixelSize",
                             vec2(1.0f / mTexture->getWidth(),
                                  1.0f / mTexture->getHeight()));
            mTexture->bind(0);
            gl::drawSolidRect(mFbo->getBounds());
        }

        gl::setMatricesWindow(getWindowSize());
        gl::draw(mFbo->getColorTexture(), getWindowBounds());
    }
};

CINDER_APP(VideoFxApp, RendererGl)
```
