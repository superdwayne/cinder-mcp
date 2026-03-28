// GHOST — Particles Are Your Body
// Particles are placed directly on detected body pixels.
// Move and they follow. Stop and they settle on you.

#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/CinderImGui.h"
#include "cinder/Capture.h"
#include "cinder/Rand.h"
#include "cinder/Log.h"

#ifdef NO
  #undef NO
#endif
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

using namespace ci;
using namespace ci::app;
using namespace std;

static const int NUM_PARTICLES = 8000;

// ─── Particle ────────────────────────────────────────────────────────────────
struct Particle {
    vec2  pos;       // current screen position
    vec2  target;    // where it wants to be (on body)
    vec3  color;
    float size;
    bool  hasTarget; // is assigned to a body pixel
};

struct GpuParticle {
    vec2  pos;
    vec3  color;
    float size;
};

// ─── App ─────────────────────────────────────────────────────────────────────
class GhostApp : public App {
public:
    void setup()  override;
    void update() override;
    void draw()   override;
    void keyDown(KeyEvent event) override;

private:
    // Camera
    CaptureRef                 mCapture;
    gl::TextureRef             mCamTex;
    vector<Capture::DeviceRef> mDevices;
    int                        mSelectedDevice = 0;

    // Particles
    vector<Particle>  mParticles;
    gl::VboRef        mVbo;
    gl::GlslProgRef   mShader;

    // Body detection
    vector<vec2>      mBodyPixels;    // screen-space body pixel positions (updated each frame)
    int               mBrightnessThreshold = 200;
    float             mMinContourArea = 1500.0f;

    // Ghost FBO — accumulates particle traces
    gl::FboRef        mGhostFbo;
    float             mGhostFade = 0.005f;  // how fast ghosts disappear

    // Settings
    float mLerpSpeed      = 0.12f;   // how fast particles chase their target (0=frozen, 1=instant)
    float mScatterAmount  = 3.0f;    // jitter on body for organic look
    float mCameraOpacity  = 0.25f;
    float mParticleAlpha  = 0.8f;
    bool  mShowUI         = true;
    bool  mShowDebug      = true;

    // Helpers
    void initCamera();
    void processFrame(const Surface8uRef& surf);
    void assignParticlesToBody();
    void updateParticles();
    void uploadParticles();

    cv::Mat surfaceToMat(const Surface8uRef& surface);
};

// ─── Setup ───────────────────────────────────────────────────────────────────
void GhostApp::setup()
{
    CI_LOG_I("GHOST — starting");

    initCamera();

    // Init particles at random positions
    mParticles.resize(NUM_PARTICLES);
    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();
    for (auto& p : mParticles) {
        p.pos       = vec2(Rand::randFloat(0, w), Rand::randFloat(0, h));
        p.target    = p.pos;
        p.color     = vec3(0.3f, 0.5f, 1.0f);
        p.size      = 2.0f;
        p.hasTarget = false;
    }

    // Particle VBO
    mVbo = gl::Vbo::create(GL_ARRAY_BUFFER, NUM_PARTICLES * sizeof(GpuParticle), nullptr, GL_DYNAMIC_DRAW);

    // Particle shader — don't use custom VBO at all
    // Just draw particles as simple circles using gl::drawSolidCircle
    // This is simpler and guaranteed to work
    mShader = nullptr; // not using custom shader

    // Ghost persistence FBO
    auto fmt = gl::Fbo::Format().colorTexture(
        gl::Texture2d::Format().internalFormat(GL_RGBA8)
    );
    mGhostFbo = gl::Fbo::create(getWindowWidth(), getWindowHeight(), fmt);
    {
        gl::ScopedFramebuffer fbo(mGhostFbo);
        gl::clear(ColorA(0, 0, 0, 0));
    }

    glEnable(GL_PROGRAM_POINT_SIZE);
    glEnable(GL_POINT_SPRITE);

    ImGui::Initialize();
    CI_LOG_I("GHOST — ready");
}

// ─── Camera ──────────────────────────────────────────────────────────────────
void GhostApp::initCamera()
{
    mDevices = Capture::getDevices();
    int idx = 0;
    for (size_t i = 0; i < mDevices.size(); ++i) {
        CI_LOG_I("Camera [" << i << "]: " << mDevices[i]->getName());
        if (mDevices[i]->getName().find("iPhone") != string::npos) idx = (int)i;
    }
    mSelectedDevice = idx;
    if (!mDevices.empty()) {
        try {
            mCapture = Capture::create(1280, 720, mDevices[idx]);
            mCapture->start();
            CI_LOG_I("Using: " << mDevices[idx]->getName());
        } catch (ci::Exception& e) {
            CI_LOG_E("Camera failed: " << e.what());
        }
    }
}

// ─── OpenCV: detect body pixels ──────────────────────────────────────────────
void GhostApp::processFrame(const Surface8uRef& surf)
{
    cv::Mat frame = surfaceToMat(surf);
    cv::Mat gray, blurred, mask;

    cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(gray, blurred, cv::Size(21, 21), 0);

    // Dark = body, light = wall
    cv::threshold(blurred, mask, mBrightnessThreshold, 255, cv::THRESH_BINARY_INV);

    // Cleanup
    cv::Mat elemS = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(7, 7));
    cv::Mat elemL = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(13, 13));
    cv::erode(mask, mask, elemS, cv::Point(-1,-1), 2);
    cv::dilate(mask, mask, elemL, cv::Point(-1,-1), 3);
    cv::erode(mask, mask, elemS, cv::Point(-1,-1), 1);

    // Collect body pixel positions (subsampled for performance)
    float sx = (float)getWindowWidth()  / (float)mask.cols;
    float sy = (float)getWindowHeight() / (float)mask.rows;

    mBodyPixels.clear();
    int step = 2; // sample every 2nd pixel
    for (int y = 0; y < mask.rows; y += step) {
        const uchar* row = mask.ptr<uchar>(y);
        for (int x = 0; x < mask.cols; x += step) {
            if (row[x] > 128) {
                mBodyPixels.push_back(vec2(x * sx, y * sy));
            }
        }
    }
}

// ─── Assign particles to body pixels ─────────────────────────────────────────
void GhostApp::assignParticlesToBody()
{
    int numBody = (int)mBodyPixels.size();

    if (numBody == 0) {
        // No body detected — particles drift slowly
        for (auto& p : mParticles) {
            p.hasTarget = false;
        }
        return;
    }

    // Distribute particles evenly across body pixels
    for (int i = 0; i < NUM_PARTICLES; ++i) {
        auto& p = mParticles[i];
        // Map this particle to a body pixel (wrap around if more particles than pixels)
        int bodyIdx = i % numBody;
        vec2 bodyPos = mBodyPixels[bodyIdx];

        // Add slight random scatter for organic look
        bodyPos.x += Rand::randFloat(-mScatterAmount, mScatterAmount);
        bodyPos.y += Rand::randFloat(-mScatterAmount, mScatterAmount);

        p.target = bodyPos;
        p.hasTarget = true;
    }
}

// ─── Update particles ────────────────────────────────────────────────────────
void GhostApp::updateParticles()
{
    for (auto& p : mParticles) {
        if (p.hasTarget) {
            // Lerp toward target — creates smooth follow effect
            p.pos = glm::mix(p.pos, p.target, mLerpSpeed);

            // Color: particles on body glow white/cyan
            float d = glm::distance(p.pos, p.target);
            float settled = glm::clamp(1.0f - d / 50.0f, 0.0f, 1.0f);
            // Settled = bright white, moving = blue trail
            p.color = glm::mix(vec3(0.2f, 0.5f, 1.0f), vec3(0.9f, 0.95f, 1.0f), settled);
            p.size = glm::mix(4.0f, 6.0f, settled);
        } else {
            // No body — gentle drift
            p.pos.x += Rand::randFloat(-0.5f, 0.5f);
            p.pos.y += Rand::randFloat(-0.5f, 0.5f);
            p.color = vec3(0.15f, 0.25f, 0.5f);
            p.size = 3.0f;

            // Wrap edges
            float w = (float)getWindowWidth();
            float h = (float)getWindowHeight();
            if (p.pos.x < 0) p.pos.x += w;
            if (p.pos.x > w) p.pos.x -= w;
            if (p.pos.y < 0) p.pos.y += h;
            if (p.pos.y > h) p.pos.y -= h;
        }
    }
}

// ─── Upload to GPU ───────────────────────────────────────────────────────────
void GhostApp::uploadParticles()
{
    auto ptr = reinterpret_cast<GpuParticle*>(mVbo->mapWriteOnly());
    if (!ptr) return;
    for (int i = 0; i < NUM_PARTICLES; ++i) {
        ptr[i].pos   = mParticles[i].pos;
        ptr[i].color = mParticles[i].color;
        ptr[i].size  = mParticles[i].size;
    }
    mVbo->unmap();
}

// ─── Update ──────────────────────────────────────────────────────────────────
void GhostApp::update()
{
    if (mCapture && mCapture->checkNewFrame()) {
        Surface8uRef surf = mCapture->getSurface();
        if (surf) {
            mCamTex = gl::Texture2d::create(*surf);
            processFrame(surf);
        }
    }

    assignParticlesToBody();
    updateParticles();
    uploadParticles();
}

// ─── Draw ────────────────────────────────────────────────────────────────────
void GhostApp::draw()
{
    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();

    // ── Ghost FBO: fade previous + draw current particles ──
    {
        gl::ScopedFramebuffer fbo(mGhostFbo);
        gl::ScopedViewport vp(ivec2(0), mGhostFbo->getSize());
        gl::setMatricesWindow(mGhostFbo->getSize());

        // Fade previous ghosts slowly
        gl::enableAlphaBlending();
        gl::color(ColorA(0, 0, 0, mGhostFade));
        gl::drawSolidRect(Rectf(0, 0, w, h));

        // Draw current particles into ghost buffer
        gl::ScopedBlendAdditive blend;
        for (const auto& p : mParticles) {
            if (p.hasTarget) {
                gl::color(ColorA(p.color.x, p.color.y, p.color.z, 0.4f));
                gl::drawSolidCircle(p.pos, p.size * 0.5f);
            }
        }
    }

    // ── Main draw ──
    gl::setMatricesWindow(getWindowSize());
    gl::clear(Color::black());

    // Camera background
    if (mCamTex) {
        gl::color(ColorA(1, 1, 1, mCameraOpacity));
        gl::draw(mCamTex, Rectf(0, 0, w, h));
    }

    // Ghost traces
    gl::enableAlphaBlending();
    gl::color(Color::white());
    gl::draw(mGhostFbo->getColorTexture(), Rectf(0, 0, w, h));

    // Current particles — simple circles, guaranteed visible
    {
        gl::ScopedBlendAdditive blend;
        for (const auto& p : mParticles) {
            gl::color(ColorA(p.color.x, p.color.y, p.color.z, 0.9f));
            gl::drawSolidCircle(p.pos, p.size);
        }
    }

    // ── Debug: silhouette pixel count ──
    if (mShowDebug) {
        gl::color(Color(0, 1, 0));
        string info = "Body pixels: " + to_string(mBodyPixels.size())
                     + "  FPS: " + to_string((int)getAverageFps())
                     + "  Threshold: " + to_string(mBrightnessThreshold);
        gl::drawString(info, vec2(20, 20), Color(0, 1, 0), Font("Arial", 18));

        // Draw only every 100th body pixel to avoid flooding the screen
        for (size_t i = 0; i < mBodyPixels.size(); i += 100) {
            gl::drawSolidCircle(mBodyPixels[i], 2.0f);
        }
    }

    // ── ImGui ──
    if (mShowUI) {
        ImGui::SetNextWindowSize(ImVec2(350, 0), ImGuiCond_FirstUseEver);
        ImGui::Begin("GHOST");

        ImGui::SliderInt("Body Threshold", &mBrightnessThreshold, 50, 220);
        ImGui::SliderFloat("Follow Speed", &mLerpSpeed, 0.01f, 0.5f);
        ImGui::SliderFloat("Scatter", &mScatterAmount, 0.0f, 20.0f);
        ImGui::SliderFloat("Ghost Fade", &mGhostFade, 0.001f, 0.05f);
        ImGui::SliderFloat("Camera Opacity", &mCameraOpacity, 0.0f, 0.6f);
        ImGui::Separator();
        ImGui::Checkbox("Debug", &mShowDebug);
        ImGui::Text("FPS: %.1f", getAverageFps());
        ImGui::Text("Body pixels: %d", (int)mBodyPixels.size());

        // Camera selector
        ImGui::Separator();
        {
            vector<string> names;
            for (auto& d : mDevices) names.push_back(d->getName());
            auto getter = [](void* data, int idx, const char** out) -> bool {
                auto* v = (vector<string>*)data;
                *out = (*v)[idx].c_str();
                return true;
            };
            int prev = mSelectedDevice;
            ImGui::Combo("Camera", &mSelectedDevice, getter, &names, (int)names.size());
            if (mSelectedDevice != prev) {
                if (mCapture) mCapture->stop();
                try {
                    mCapture = Capture::create(1280, 720, mDevices[mSelectedDevice]);
                    mCapture->start();
                } catch (ci::Exception& e) {
                    CI_LOG_E("Camera switch failed: " << e.what());
                }
            }
        }

        ImGui::End();
    }
}

// ─── Keys ────────────────────────────────────────────────────────────────────
void GhostApp::keyDown(KeyEvent event)
{
    switch (event.getCode()) {
        case KeyEvent::KEY_h: mShowUI = !mShowUI; break;
        case KeyEvent::KEY_d: mShowDebug = !mShowDebug; break;
        case KeyEvent::KEY_f: setFullScreen(!isFullScreen()); break;
        case KeyEvent::KEY_ESCAPE: quit(); break;
    }
}

// ─── OpenCV helpers ──────────────────────────────────────────────────────────
cv::Mat GhostApp::surfaceToMat(const Surface8uRef& surface)
{
    int w = surface->getWidth();
    int h = surface->getHeight();
    cv::Mat mat(h, w, CV_8UC3);
    auto iter = surface->getIter();
    int row = 0;
    while (iter.line()) {
        int col = 0;
        while (iter.pixel()) {
            mat.at<cv::Vec3b>(row, col) = cv::Vec3b(iter.b(), iter.g(), iter.r());
            ++col;
        }
        ++row;
    }
    return mat;
}

// ─── Entry ───────────────────────────────────────────────────────────────────
CINDER_APP(GhostApp, RendererGl(RendererGl::Options().msaa(0)), [](App::Settings* settings) {
    settings->setWindowSize(1920, 1080);
    settings->setTitle("GHOST");
    settings->setFrameRate(60.0f);
})
