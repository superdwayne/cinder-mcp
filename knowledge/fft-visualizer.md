---
title: "FFT & Audio Visualization"
category: "Audio"
namespace: "cinder::audio"
tags: [fft, audio, visualization, spectrum, waveform, frequency]
---

# FFT & Audio Visualization

Extracting FFT data from audio and mapping it to visual output using Cinder's audio node graph.

## MonitorSpectralNode

`audio::MonitorSpectralNode` performs FFT analysis on its input signal:

- Set FFT size: `setFftSize(1024)` (power of 2, default 1024)
- Get spectrum: `getMagSpectrum()` returns `std::vector<float>` of magnitude bins
- Number of bins: `getNumBins()` (FFT size / 2)
- Frequency lookup: `getFreqForBin(index)` returns Hz for a bin index
- Smoothing: `setSmoothingFactor(0.5f)` for temporal smoothing

## Audio Graph Setup Pattern

```
InputNode -> MonitorSpectralNode -> GainNode -> OutputNode
```

1. Create `audio::Context` via `audio::master()`
2. Create input (file player, microphone, oscillator)
3. Connect MonitorSpectralNode as a tap
4. Enable context

## Frequency-to-Visual Mapping

- Low frequencies (20-250 Hz): bass, kick drums — map to large/slow elements
- Mid frequencies (250-4000 Hz): vocals, instruments — map to medium elements
- High frequencies (4000-20000 Hz): cymbals, sibilance — map to small/fast elements
- Use logarithmic scaling for perceptually even frequency distribution

## Code Examples

### Spectrum Bar Visualizer

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/audio/audio.h"

using namespace ci;
using namespace ci::app;

class SpectrumApp : public App {
public:
    audio::InputDeviceNodeRef    mInputNode;
    audio::MonitorSpectralNodeRef mSpectralNode;

    void setup() override {
        auto ctx = audio::master();

        // Use microphone input
        mInputNode = ctx->createInputDeviceNode();

        // FFT analysis node
        auto spectralFmt = audio::MonitorSpectralNode::Format()
            .fftSize(2048)
            .windowSize(1024);
        mSpectralNode = ctx->makeNode(
            new audio::MonitorSpectralNode(spectralFmt)
        );

        // Connect: mic -> spectral -> output
        mInputNode >> mSpectralNode;
        mInputNode->enable();
        ctx->enable();
    }

    void draw() override {
        gl::clear(Color(0.05f, 0.05f, 0.1f));

        auto& spectrum = mSpectralNode->getMagSpectrum();
        if (spectrum.empty()) return;

        float barWidth = (float)getWindowWidth() / spectrum.size();
        float maxHeight = getWindowHeight() * 0.8f;

        for (size_t i = 0; i < spectrum.size(); i++) {
            float magnitude = spectrum[i];
            float height = magnitude * maxHeight;

            // Color based on frequency range
            float hue = lmap((float)i, 0.0f,
                             (float)spectrum.size(), 0.0f, 0.7f);
            gl::color(Color(CM_HSV, hue, 0.9f, 0.9f));

            Rectf bar(
                i * barWidth,
                getWindowHeight() - height,
                (i + 1) * barWidth - 1,
                getWindowHeight()
            );
            gl::drawSolidRect(bar);
        }
    }
};

CINDER_APP(SpectrumApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(1024, 400); })
```

### Circular FFT Display

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/audio/audio.h"

using namespace ci;
using namespace ci::app;

class CircularFFTApp : public App {
public:
    audio::InputDeviceNodeRef     mInput;
    audio::MonitorSpectralNodeRef mSpectral;
    audio::MonitorNodeRef         mMonitor;

    void setup() override {
        auto ctx = audio::master();
        mInput = ctx->createInputDeviceNode();

        auto fmt = audio::MonitorSpectralNode::Format().fftSize(512);
        mSpectral = ctx->makeNode(new audio::MonitorSpectralNode(fmt));
        mMonitor = ctx->makeNode(new audio::MonitorNode());

        mInput >> mSpectral;
        mInput >> mMonitor;
        mInput->enable();
        ctx->enable();
    }

    void draw() override {
        gl::clear(Color::black());
        gl::enableAlphaBlending();

        auto& spectrum = mSpectral->getMagSpectrum();
        if (spectrum.empty()) return;

        vec2 center = getWindowCenter();
        float baseRadius = 100.0f;
        float maxExtension = 200.0f;
        int numBins = spectrum.size();

        // Draw circular spectrum
        for (int i = 0; i < numBins; i++) {
            float angle = lmap((float)i, 0.0f, (float)numBins,
                               0.0f, (float)(M_PI * 2.0));
            float nextAngle = lmap((float)(i + 1), 0.0f, (float)numBins,
                                   0.0f, (float)(M_PI * 2.0));

            float mag = spectrum[i];
            float outerR = baseRadius + mag * maxExtension;

            vec2 innerA = center + vec2(cos(angle), sin(angle)) * baseRadius;
            vec2 outerA = center + vec2(cos(angle), sin(angle)) * outerR;
            vec2 innerB = center + vec2(cos(nextAngle), sin(nextAngle)) * baseRadius;
            vec2 outerB = center + vec2(cos(nextAngle), sin(nextAngle)) * outerR;

            float hue = lmap((float)i, 0.0f, (float)numBins, 0.0f, 1.0f);
            gl::color(ColorA(CM_HSV, hue, 0.8f, 0.9f, 0.7f));

            // Draw quad for each bin
            gl::begin(GL_TRIANGLE_STRIP);
            gl::vertex(innerA);
            gl::vertex(outerA);
            gl::vertex(innerB);
            gl::vertex(outerB);
            gl::end();
        }

        // Draw center circle
        gl::color(ColorA(1, 1, 1, 0.1f));
        gl::drawStrokedCircle(center, baseRadius, 1.0f);
    }
};

CINDER_APP(CircularFFTApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(800, 800); })
```

### Waveform Renderer

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/audio/audio.h"

using namespace ci;
using namespace ci::app;

class WaveformApp : public App {
public:
    audio::InputDeviceNodeRef mInput;
    audio::MonitorNodeRef     mMonitor;

    void setup() override {
        auto ctx = audio::master();
        mInput = ctx->createInputDeviceNode();

        auto monitorFmt = audio::MonitorNode::Format().windowSize(1024);
        mMonitor = ctx->makeNode(new audio::MonitorNode(monitorFmt));

        mInput >> mMonitor;
        mInput->enable();
        ctx->enable();
    }

    void draw() override {
        gl::clear(Color(0.05f, 0.02f, 0.1f));

        const audio::Buffer& buffer = mMonitor->getBuffer();
        if (buffer.isEmpty()) return;

        const float* data = buffer.getChannel(0);
        size_t numFrames = buffer.getNumFrames();

        float width = getWindowWidth();
        float centerY = getWindowHeight() * 0.5f;
        float amplitude = getWindowHeight() * 0.35f;

        // Draw waveform as a smooth path
        Path2d waveform;
        for (size_t i = 0; i < numFrames; i++) {
            float x = lmap((float)i, 0.0f, (float)numFrames, 0.0f, width);
            float y = centerY + data[i] * amplitude;

            if (i == 0) waveform.moveTo(x, y);
            else waveform.lineTo(x, y);
        }

        gl::color(0.3f, 0.8f, 1.0f);
        gl::draw(waveform);

        // Draw mirrored waveform
        Path2d mirrored;
        for (size_t i = 0; i < numFrames; i++) {
            float x = lmap((float)i, 0.0f, (float)numFrames, 0.0f, width);
            float y = centerY - data[i] * amplitude;

            if (i == 0) mirrored.moveTo(x, y);
            else mirrored.lineTo(x, y);
        }

        gl::color(ColorA(0.3f, 0.8f, 1.0f, 0.3f));
        gl::draw(mirrored);

        // Center line
        gl::color(ColorA(1, 1, 1, 0.15f));
        gl::drawLine(vec2(0, centerY), vec2(width, centerY));
    }
};

CINDER_APP(WaveformApp, RendererGl,
    [](App::Settings* s) { s->setWindowSize(1024, 400); })
```
