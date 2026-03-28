// BURST — Motion-driven particle explosions
// Frame differencing detects motion, particles burst from movement points.
// All particles rendered in ONE draw call via GL_POINTS VBO.

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

static const int MAX_PARTICLES = 30000;

// Particle data (CPU side)
struct Particle {
    vec2  pos;
    vec2  vel;
    float life;
    float maxLife;
    float size;
    vec3  color;
};

// What gets uploaded to GPU per particle (tightly packed)
struct GpuVert {
    vec2  pos;
    vec4  color; // rgba
    float size;
};

class BurstApp : public App {
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
    int                        mDeviceIndex = 0;

    // Motion detection
    cv::Mat mPrevGray;
    bool    mHasPrev = false;

    // Particles
    vector<Particle> mParticles;

    // GPU rendering — single VBO + shader
    gl::VboRef      mVbo;
    gl::GlslProgRef mShader;
    int             mAliveCount = 0;

    // Trail FBO
    gl::FboRef mTrailFbo;

    // Settings
    int   mMotionThreshold = 25;
    float mGravity         = 5.0f;   // gentle — paint doesn't fall hard
    float mDrag            = 0.95f;  // slows quickly — brush stroke feel
    float mCameraOpacity   = 0.5f;
    float mTrailFade       = 0.15f;
    bool  mMirrorCamera    = true;
    bool  mShowUI          = false;

    void initCamera();
    void processMotion(const Surface8uRef& surf);
    void updateParticles();
    void uploadToGpu();
    cv::Mat surfaceToMat(const Surface8uRef& surface);
};

void BurstApp::setup()
{
    // Particle shader — vertex takes pos, color, size as interleaved floats
    // Uses gl_PointCoord for soft circle in fragment
    try {
        mShader = gl::GlslProg::create(
            // Vertex
            "#version 150\n"
            "uniform mat4 ciModelViewProjection;\n"
            "in vec2 aPos;\n"
            "in vec4 aColor;\n"
            "in float aSize;\n"
            "out vec4 vColor;\n"
            "void main() {\n"
            "    vColor = aColor;\n"
            "    gl_Position = ciModelViewProjection * vec4(aPos, 0.0, 1.0);\n"
            "    gl_PointSize = aSize;\n"
            "}\n",
            // Fragment
            "#version 150\n"
            "in vec4 vColor;\n"
            "out vec4 oColor;\n"
            "void main() {\n"
            "    vec2 c = gl_PointCoord - vec2(0.5);\n"
            "    float d = length(c);\n"
            "    if (d > 0.5) discard;\n"
            "    float a = 1.0 - smoothstep(0.0, 0.5, d);\n"
            "    a = a * a;\n" // softer falloff — painterly
            "    oColor = vec4(vColor.rgb, vColor.a * a * 0.7);\n"
            "}\n"
        );
    }
    catch (const gl::GlslProgCompileExc& e) {
        CI_LOG_E("Shader error: " << e.what());
        // Fallback — GLSL 150 might not support custom 'in' names via string
        // We'll handle this below
        mShader = nullptr;
    }

    // VBO for all particles
    mVbo = gl::Vbo::create(GL_ARRAY_BUFFER, MAX_PARTICLES * sizeof(GpuVert), nullptr, GL_DYNAMIC_DRAW);

    mParticles.reserve(MAX_PARTICLES);

    // Trail FBO
    auto fmt = gl::Fbo::Format().colorTexture();
    mTrailFbo = gl::Fbo::create(getWindowWidth(), getWindowHeight(), fmt);
    { gl::ScopedFramebuffer f(mTrailFbo); gl::clear(Color::black()); }

    glEnable(GL_PROGRAM_POINT_SIZE);
    glEnable(GL_POINT_SPRITE);

    ImGui::Initialize();
    initCamera();
}

void BurstApp::initCamera()
{
    try {
        mDevices = Capture::getDevices();
        for (size_t i = 0; i < mDevices.size(); i++)
            CI_LOG_I("Camera [" << i << "]: " << mDevices[i]->getName());

        // Use first camera (MacBook webcam)
        mDeviceIndex = 0;
        mCapture = Capture::create(1280, 720, mDevices[mDeviceIndex]);
        mCapture->start();
        CI_LOG_I("Using: " << mDevices[mDeviceIndex]->getName());
    }
    catch (ci::Exception& e) {
        CI_LOG_E("Camera failed: " << e.what());
    }
}

cv::Mat BurstApp::surfaceToMat(const Surface8uRef& surface)
{
    int w = surface->getWidth(), h = surface->getHeight();
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

void BurstApp::processMotion(const Surface8uRef& surf)
{
    cv::Mat frame = surfaceToMat(surf);
    cv::Mat gray;
    cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(gray, gray, cv::Size(11, 11), 0);

    if (!mHasPrev) {
        mPrevGray = gray.clone();
        mHasPrev = true;
        return;
    }

    cv::Mat diff, mask;
    cv::absdiff(gray, mPrevGray, diff);
    cv::threshold(diff, mask, mMotionThreshold, 255, cv::THRESH_BINARY);

    float sx = (float)getWindowWidth() / (float)mask.cols;
    float sy = (float)getWindowHeight() / (float)mask.rows;

    int step = 6;
    for (int y = 0; y < mask.rows; y += step) {
        const uchar* row = mask.ptr<uchar>(y);
        for (int x = 0; x < mask.cols; x += step) {
            if (row[x] > 128 && (int)mParticles.size() < MAX_PARTICLES) {
                float screenX = mMirrorCamera ? (float)(mask.cols - x) * sx : (float)x * sx;
                float screenY = (float)y * sy;

                // Spectrum brush stroke — flowing colour based on time + position
                float baseHue = fmod((float)getElapsedSeconds() * 0.08f, 1.0f);

                int count = 2 + (int)(Rand::randFloat() * 2);
                for (int i = 0; i < count; i++) {
                    Particle p;
                    p.pos = vec2(screenX + Rand::randFloat(-2,2), screenY + Rand::randFloat(-2,2));

                    // Gentle outward drift — brush-like, not explosive
                    float angle = Rand::randFloat(0, 6.283f);
                    float speed = Rand::randFloat(0.5f, 3.0f);
                    p.vel = vec2(cos(angle), sin(angle)) * speed;

                    p.maxLife = Rand::randFloat(0.6f, 2.0f);
                    p.life = p.maxLife;
                    p.size = Rand::randFloat(8.0f, 22.0f); // bigger for brush feel

                    // Smooth spectrum — hue flows with time and position
                    float hue = fmod(baseHue
                                     + screenX / (float)getWindowWidth() * 0.4f
                                     + screenY / (float)getWindowHeight() * 0.2f
                                     + Rand::randFloat(-0.05f, 0.05f), 1.0f);
                    float h6 = hue * 6.0f;
                    float c = 1.0f, xc = c * (1.0f - fabsf(fmodf(h6, 2.0f) - 1.0f));
                    vec3 rgb;
                    if      (h6 < 1) rgb = vec3(c, xc, 0);
                    else if (h6 < 2) rgb = vec3(xc, c, 0);
                    else if (h6 < 3) rgb = vec3(0, c, xc);
                    else if (h6 < 4) rgb = vec3(0, xc, c);
                    else if (h6 < 5) rgb = vec3(xc, 0, c);
                    else             rgb = vec3(c, 0, xc);
                    p.color = rgb * 1.2f;

                    mParticles.push_back(p);
                }
            }
        }
    }

    mPrevGray = gray.clone();
}

void BurstApp::updateParticles()
{
    float dt = 1.0f / 60.0f;
    for (auto& p : mParticles) {
        p.vel.y += mGravity * dt;
        p.vel *= mDrag;
        p.pos += p.vel;
        p.life -= dt;
    }
    mParticles.erase(
        remove_if(mParticles.begin(), mParticles.end(),
            [](const Particle& p) { return p.life <= 0; }),
        mParticles.end());
}

void BurstApp::uploadToGpu()
{
    mAliveCount = (int)mParticles.size();
    if (mAliveCount == 0) return;

    auto ptr = reinterpret_cast<GpuVert*>(mVbo->mapWriteOnly());
    if (!ptr) return;

    for (int i = 0; i < mAliveCount; i++) {
        auto& p = mParticles[i];
        float t = glm::clamp(p.life / p.maxLife, 0.0f, 1.0f);
        ptr[i].pos   = p.pos;
        ptr[i].color = vec4(p.color.x, p.color.y, p.color.z, t);
        ptr[i].size  = p.size * glm::max(t, 0.3f);
    }
    mVbo->unmap();
}

void BurstApp::update()
{
    if (mCapture && mCapture->checkNewFrame()) {
        Surface8uRef surf = mCapture->getSurface();
        if (surf) {
            mCamTex = gl::Texture2d::create(*surf);
            processMotion(surf);
        }
    }
    updateParticles();
    uploadToGpu();
}

void BurstApp::draw()
{
    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();

    // Helper lambda to draw all particles via VBO in one call
    auto drawPointsVBO = [&]() {
        if (mAliveCount == 0) return;

        if (mShader) {
            mShader->bind();
            gl::setDefaultShaderVars();

            mVbo->bind();
            GLint posLoc   = mShader->getAttribLocation("aPos");
            GLint colorLoc = mShader->getAttribLocation("aColor");
            GLint sizeLoc  = mShader->getAttribLocation("aSize");

            if (posLoc >= 0) {
                glEnableVertexAttribArray(posLoc);
                glVertexAttribPointer(posLoc, 2, GL_FLOAT, GL_FALSE, sizeof(GpuVert),
                    (void*)offsetof(GpuVert, pos));
            }
            if (colorLoc >= 0) {
                glEnableVertexAttribArray(colorLoc);
                glVertexAttribPointer(colorLoc, 4, GL_FLOAT, GL_FALSE, sizeof(GpuVert),
                    (void*)offsetof(GpuVert, color));
            }
            if (sizeLoc >= 0) {
                glEnableVertexAttribArray(sizeLoc);
                glVertexAttribPointer(sizeLoc, 1, GL_FLOAT, GL_FALSE, sizeof(GpuVert),
                    (void*)offsetof(GpuVert, size));
            }

            glDrawArrays(GL_POINTS, 0, mAliveCount);

            if (posLoc >= 0) glDisableVertexAttribArray(posLoc);
            if (colorLoc >= 0) glDisableVertexAttribArray(colorLoc);
            if (sizeLoc >= 0) glDisableVertexAttribArray(sizeLoc);
            mVbo->unbind();
        } else {
            // Fallback: draw circles (slow but guaranteed to work)
            for (int i = 0; i < mAliveCount; i++) {
                auto& p = mParticles[i];
                float t = glm::clamp(p.life / p.maxLife, 0.0f, 1.0f);
                gl::color(ColorA(p.color.x, p.color.y, p.color.z, t * 0.9f));
                gl::drawSolidCircle(p.pos, p.size * t);
            }
        }
    };

    // --- Main screen ---
    gl::setMatricesWindow(getWindowSize());
    gl::clear(Color::black());

    // Camera feed — clear and full
    if (mCamTex) {
        gl::color(Color::white());
        if (mMirrorCamera)
            gl::draw(mCamTex, Rectf(w, 0, 0, h));
        else
            gl::draw(mCamTex, Rectf(0, 0, w, h));
    }

    // Particles on top — burst and disappear, no trails
    {
        gl::ScopedBlendAdditive blend;
        drawPointsVBO();
    }

    // ImGui
    if (mShowUI) {
        ImGui::SetNextWindowSize(ImVec2(300, 0), ImGuiCond_FirstUseEver);
        ImGui::Begin("BURST");
        ImGui::Text("FPS: %.0f | Particles: %d", getAverageFps(), mAliveCount);
        ImGui::SliderInt("Motion Threshold", &mMotionThreshold, 5, 80);
        ImGui::SliderFloat("Gravity", &mGravity, 0, 100);
        ImGui::SliderFloat("Drag", &mDrag, 0.9f, 1.0f);
        ImGui::SliderFloat("Trail Fade", &mTrailFade, 0.01f, 0.15f);
        ImGui::SliderFloat("Camera", &mCameraOpacity, 0.0f, 1.0f);
        ImGui::Checkbox("Mirror", &mMirrorCamera);
        ImGui::Separator();
        // Camera selector
        vector<string> names;
        for (auto& d : mDevices) names.push_back(d->getName());
        auto getter = [](void* data, int idx, const char** out) -> bool {
            auto* v = (vector<string>*)data; *out = (*v)[idx].c_str(); return true;
        };
        int prev = mDeviceIndex;
        ImGui::Combo("Device", &mDeviceIndex, getter, &names, (int)names.size());
        if (mDeviceIndex != prev) {
            if (mCapture) mCapture->stop();
            mCapture = Capture::create(1280, 720, mDevices[mDeviceIndex]);
            mCapture->start();
            mHasPrev = false;
        }
        ImGui::End();
    }
}

void BurstApp::keyDown(KeyEvent event)
{
    switch (event.getCode()) {
        case KeyEvent::KEY_h: mShowUI = !mShowUI; break;
        case KeyEvent::KEY_f: setFullScreen(!isFullScreen()); break;
        case KeyEvent::KEY_ESCAPE: quit(); break;
    }
}

CINDER_APP(BurstApp, RendererGl(RendererGl::Options().msaa(0)),
    [](App::Settings* settings) {
        settings->setWindowSize(1920, 1080);
        settings->setTitle("BURST");
        settings->setFrameRate(60.0f);
    })
