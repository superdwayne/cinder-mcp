// RESONANCE v3 — Pure Raymarched Audio-Reactive Experience
// Everything visual lives in a single fullscreen fragment shader.
// The C++ side handles audio analysis and passes uniforms.
// SDF raymarching, volumetric god rays, fresnel glow — all GPU math.

#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/CinderImGui.h"
#include "cinder/audio/audio.h"
#include "cinder/Rand.h"
#include "cinder/Log.h"

using namespace ci;
using namespace ci::app;
using namespace std;

// ═══════════════════════════════════════════════════════════════════════════
// Shader Sources
// ═══════════════════════════════════════════════════════════════════════════

static const char* kVertShader = R"glsl(
#version 150
in vec4 ciPosition;
in vec2 ciTexCoord0;
out vec2 vUV;
void main() {
    vUV = ciTexCoord0;
    gl_Position = ciPosition;
}
)glsl";

static const char* kFragShader = R"glsl(
#version 150

uniform float uTime;
uniform vec2  uResolution;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uVolume;
uniform float uBeat;

in vec2 vUV;
out vec4 oColor;

mat2 rot(float a) { float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

float sdSphere(vec3 p, float r) { return length(p)-r; }
float sdTorus(vec3 p, vec2 t) { return length(vec2(length(p.xz)-t.x,p.y))-t.y; }
float sdOct(vec3 p, float s) { p=abs(p); return (p.x+p.y+p.z-s)*0.57735027; }

float smin(float a, float b, float k) {
    float h = clamp(0.5+0.5*(b-a)/k, 0.0, 1.0);
    return mix(b,a,h) - k*h*(1.0-h);
}

// FBM noise
float hash3(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
                   mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
                   mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { float v=0.,a=.5; for(int i=0;i<4;i++){v+=a*noise(p);p*=2.1;a*=.5;} return v; }

// The scene
float scene(vec3 p) {
    float t = uTime;
    float vol = uVolume * 10.0;
    float bass = uBass * 10.0;
    float mid = uMid * 10.0;
    float high = uHigh * 10.0;
    float beat = uBeat;

    // === CORE: pulsing displaced sphere ===
    float disp = fbm(p*1.5 + t*0.4) * (0.4 + bass*0.3);
    disp += sin(p.x*10.0+t*3.0)*0.03*high;
    disp += sin(p.y*8.0+t*2.0)*0.04*mid;
    float core = sdSphere(p, 1.2 + vol*0.3 + beat*1.5) + disp;

    // === RINGS: three tori on different axes ===
    vec3 r1p = p; r1p.xz *= rot(t*0.6+bass); r1p.xy *= rot(t*0.4);
    float ring1 = sdTorus(r1p, vec2(2.8+bass*0.5, 0.06+bass*0.08));

    vec3 r2p = p; r2p.xy *= rot(t*0.5+mid*0.5); r2p.yz *= rot(t*0.7);
    float ring2 = sdTorus(r2p, vec2(3.2+mid*0.6, 0.05+mid*0.07));

    vec3 r3p = p; r3p.yz *= rot(t*0.8+high); r3p.xz *= rot(t*0.45);
    float ring3 = sdTorus(r3p, vec2(3.6+high*0.7, 0.04+high*0.06));

    // === SHARDS: 12 orbiting octahedra ===
    float shards = 1e10;
    for(int i=0; i<12; i++) {
        float fi = float(i);
        float a = fi*0.5236 + t*0.25;
        float r = 3.5 + beat*2.0 + sin(t*0.4+fi*0.7)*0.8;
        float y = sin(a*0.6+t*0.3+fi)*1.5;
        vec3 sp = p - vec3(cos(a)*r, y, sin(a)*r);
        sp.xz *= rot(t*1.2+fi); sp.xy *= rot(t*0.8+fi*0.3);
        shards = min(shards, sdOct(sp, 0.25+vol*0.15+beat*0.5));
    }

    // === FRACTAL LATTICE: repeating boxes ===
    vec3 bp = p;
    bp.xz *= rot(t*0.12);
    bp.xy *= rot(t*0.09);
    vec3 rp = mod(bp+3.0, 6.0)-3.0; // repeat space
    float lattice = length(rp) - 0.03 - vol*0.02; // thin beams at grid intersections
    // Only show lattice beyond a certain radius (so it doesn't fill the core)
    lattice = max(lattice, -(length(p)-5.0-vol));

    // === COMBINE with smooth blending ===
    float d = core;
    d = smin(d, ring1, 0.3);
    d = smin(d, ring2, 0.3);
    d = smin(d, ring3, 0.3);
    d = min(d, shards);
    d = min(d, lattice);

    return d;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(scene(p+e.xyy)-scene(p-e.xyy),
                          scene(p+e.yxy)-scene(p-e.yxy),
                          scene(p+e.yyx)-scene(p-e.yyx)));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - uResolution*0.5) / uResolution.y;
    float t = uTime;
    float vol = uVolume * 10.0;

    // === CAMERA: orbiting, breathing with audio ===
    float camDist = 10.0 - uVolume*4.0 + sin(t*0.15)*2.0;
    float ca = t*0.18 + uBeat*0.5;
    vec3 ro = vec3(sin(ca)*camDist, 3.0+sin(t*0.25)*2.0, cos(ca)*camDist);
    vec3 ta = vec3(0.0);
    vec3 fwd = normalize(ta-ro);
    vec3 rgt = normalize(cross(fwd, vec3(0,1,0)));
    vec3 upp = cross(rgt, fwd);
    vec3 rd = normalize(uv.x*rgt + uv.y*upp + (1.5-uBeat*0.3)*fwd);

    // === RAYMARCH with GLOW ACCUMULATION ===
    // This is the key trick: accumulate glow from near-misses
    float totalDist = 0.0;
    float hitDist = -1.0;
    vec3 glow = vec3(0.0);

    for(int i = 0; i < 120; i++) {
        vec3 p = ro + rd * totalDist;
        float d = scene(p);

        // Accumulate glow from near-misses — THIS makes everything spectacular
        float glowAmount = 0.015 / (abs(d) + 0.01);
        float distFromCenter = length(p);

        // Color the glow based on position and audio
        vec3 glowCol = mix(vec3(0.1,0.3,1.0), vec3(1.0,0.2,0.5), sin(distFromCenter*0.3+t)*0.5+0.5);
        glowCol = mix(glowCol, vec3(1.0,0.5,0.1), clamp(uBass*5.0,0.0,1.0));
        glowCol = mix(glowCol, vec3(0.0,1.0,0.8), clamp(uMid*5.0,0.0,1.0));
        glowCol = mix(glowCol, vec3(1.0,1.0,1.0), clamp(uHigh*8.0,0.0,1.0));

        glow += glowCol * glowAmount * (1.0 + uBeat*2.0);

        if(d < 0.001) { hitDist = totalDist; break; }
        totalDist += d * 0.8; // slightly conservative stepping
        if(totalDist > 40.0) break;
    }

    vec3 col = vec3(0.0);

    // === SURFACE HIT ===
    if(hitDist > 0.0) {
        vec3 p = ro + rd * hitDist;
        vec3 n = calcNormal(p);

        // Three orbiting lights
        vec3 l1 = normalize(vec3(sin(t*0.7)*3.0, 2.0, cos(t*0.7)*3.0));
        vec3 l2 = normalize(vec3(-sin(t*0.5)*2.0, -1.0, cos(t*0.3)*4.0));
        vec3 l3 = normalize(vec3(0.0, sin(t*0.4)*3.0, -2.0));

        float diff1 = max(dot(n,l1),0.0);
        float diff2 = max(dot(n,l2),0.0);
        float diff3 = max(dot(n,l3),0.0);

        float spec1 = pow(max(dot(reflect(-l1,n),-rd),0.0), 64.0);
        float spec2 = pow(max(dot(reflect(-l2,n),-rd),0.0), 32.0);

        float fresnel = pow(1.0-max(dot(n,-rd),0.0), 4.0);
        float rim = pow(1.0-max(dot(n,-rd),0.0), 2.5);

        // Audio-reactive base color
        vec3 baseCol = vec3(0.05, 0.15, 0.4);
        baseCol = mix(baseCol, vec3(0.9,0.2,0.05), clamp(uBass*5.0,0.0,1.0));
        baseCol = mix(baseCol, vec3(0.0,0.7,0.6), clamp(uMid*5.0,0.0,1.0));
        baseCol = mix(baseCol, vec3(0.8,0.9,1.0), clamp(uHigh*8.0,0.0,1.0));

        vec3 glowCol = mix(vec3(0.2,0.5,1.0), vec3(1.0,0.3,0.7), fresnel);

        // Light contributions
        col += baseCol * diff1 * vec3(0.9,0.9,1.0) * 0.6;
        col += baseCol * diff2 * vec3(1.0,0.6,0.3) * 0.3;
        col += baseCol * diff3 * vec3(0.3,1.0,0.7) * 0.2;
        col += spec1 * vec3(1.0) * 0.8;
        col += spec2 * vec3(1.0,0.8,0.6) * 0.4;
        col += fresnel * glowCol * 1.2;
        col += rim * glowCol * 0.5;
        col += baseCol * 0.05; // ambient

        // Beat flash on surface
        col += vec3(1.0,0.95,0.9) * uBeat * 0.8;
    }

    // === ADD ACCUMULATED GLOW (the magic) ===
    col += glow * 0.06;

    // === VOLUMETRIC FOG ===
    float fog = 1.0 - exp(-totalDist * 0.02);
    vec3 fogCol = vec3(0.02, 0.04, 0.1) * (1.0 + uVolume*3.0);
    col = mix(col, fogCol, fog);

    // === BACKGROUND: subtle nebula ===
    if(hitDist < 0.0) {
        float n = fbm(rd*3.0 + t*0.05);
        col += vec3(0.02,0.03,0.08) * n * (1.0 + uVolume*5.0);
        // Stars
        float stars = pow(hash21(floor(uv*800.0)), 20.0);
        col += stars * 0.5 * (1.0 + uBeat);
    }

    // === GOD RAYS ===
    vec2 sc = vec2(0.5);
    vec2 tc = gl_FragCoord.xy / uResolution;
    vec2 dtc = (tc-sc)*0.03;
    float gr = 0.0;
    vec2 stc = tc;
    for(int i=0; i<20; i++) {
        stc -= dtc;
        gr += smoothstep(0.4, 0.0, length(stc-sc)) * (1.0-float(i)/20.0);
    }
    col += vec3(0.15,0.3,0.7) * gr * uVolume * 4.0;

    // === CHROMATIC ABERRATION on beat ===
    float ab = uBeat * 0.4;
    col.r *= 1.0 + length(uv)*ab;
    col.b *= 1.0 - length(uv)*ab*0.5;

    // === SCANLINES (subtle) ===
    col *= 0.96 + 0.04*sin(gl_FragCoord.y*2.0);

    // === VIGNETTE ===
    col *= 1.0 - smoothstep(0.4, 1.6, length(uv*1.4));

    // === ACES TONE MAPPING ===
    col = col*(2.51*col+0.03)/(col*(2.43*col+0.59)+0.14);

    // === GAMMA ===
    col = pow(max(col, vec3(0.0)), vec3(1.0/2.2));

    oColor = vec4(col, 1.0);
}
)glsl";

// ═══════════════════════════════════════════════════════════════════════════
// Application
// ═══════════════════════════════════════════════════════════════════════════

class ResonanceApp : public App {
public:
    void setup()  override;
    void update() override;
    void draw()   override;
    void keyDown(KeyEvent event) override;

private:
    // Audio nodes
    audio::InputDeviceNodeRef       mInputNode;
    audio::MonitorNodeRef           mMonitorNode;
    audio::MonitorSpectralNodeRef   mSpectralNode;

    // Smoothed frequency bands
    float mBass     = 0.0f;
    float mMid      = 0.0f;
    float mHigh     = 0.0f;
    float mVolume   = 0.0f;
    float mPrevBass = 0.0f;

    // Beat detection
    float mBeatAccum = 0.0f;
    bool  mBassHit   = false;

    // Shader + fullscreen quad
    gl::GlslProgRef mShader;
    gl::BatchRef    mQuad;

    // ImGui
    bool  mShowGui          = false;
    float mVolumeThreshold  = 0.001f;
    float mSensitivity      = 1.0f;

    // Helpers
    void analyzeAudio();
};

// ─────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────
void ResonanceApp::setup()
{
    // --- Audio pipeline ---
    auto ctx = audio::Context::master();
    mInputNode = ctx->createInputDeviceNode();
    mMonitorNode  = ctx->makeNode(new audio::MonitorNode());
    mSpectralNode = ctx->makeNode(
        new audio::MonitorSpectralNode(
            audio::MonitorSpectralNode::Format().fftSize(2048)));

    mInputNode >> mMonitorNode;
    mInputNode >> mSpectralNode;
    mInputNode->enable();
    ctx->enable();

    // --- Shader ---
    try {
        mShader = gl::GlslProg::create(kVertShader, kFragShader);
    }
    catch (const gl::GlslProgCompileExc& e) {
        CI_LOG_E("Shader compile error: " << e.what());
        quit();
        return;
    }

    // --- Fullscreen quad ---
    mQuad = gl::Batch::create(geom::Rect(Rectf(-1, -1, 1, 1)), mShader);

    // --- ImGui ---
    ImGui::Initialize();
}

// ─────────────────────────────────────────────────────────────────────────
// Audio Analysis
// ─────────────────────────────────────────────────────────────────────────
void ResonanceApp::analyzeAudio()
{
    const auto& spectrum = mSpectralNode->getMagSpectrum();
    if (spectrum.empty()) return;

    float nyquist  = (float)audio::Context::master()->getSampleRate() / 2.0f;
    float binWidth = nyquist / (float)spectrum.size();
    int   numBins  = (int)spectrum.size();

    float bass = 0.0f, mid = 0.0f, high = 0.0f;
    int   cBass = 0, cMid = 0, cHigh = 0;

    for (int i = 0; i < numBins; ++i) {
        float freq = (float)i * binWidth;
        float mag  = spectrum[i];
        if      (freq < 200.0f)  { bass += mag; cBass++; }
        else if (freq < 2000.0f) { mid  += mag; cMid++;  }
        else                     { high += mag; cHigh++; }
    }
    if (cBass > 0) bass /= (float)cBass;
    if (cMid  > 0) mid  /= (float)cMid;
    if (cHigh > 0) high /= (float)cHigh;

    // Apply sensitivity
    bass *= mSensitivity;
    mid  *= mSensitivity;
    high *= mSensitivity;

    // Smooth
    const float blend = 0.3f;
    mPrevBass = mBass;
    mBass    = glm::mix(mBass,    bass, blend);
    mMid     = glm::mix(mMid,     mid,  blend);
    mHigh    = glm::mix(mHigh,    high, blend);
    mVolume  = glm::mix(mVolume,  mMonitorNode->getVolume() * mSensitivity, blend);

    // Beat detection — transient bass hit
    mBassHit = (mBass > mPrevBass * 1.5f) && (mBass > mVolumeThreshold);

    // Beat accumulator — spikes on hits, decays slowly
    if (mBassHit) {
        mBeatAccum = glm::clamp(mBeatAccum + 0.6f, 0.0f, 1.0f);
    }
    mBeatAccum *= 0.95f;
}

// ─────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────
void ResonanceApp::update()
{
    analyzeAudio();
}

// ─────────────────────────────────────────────────────────────────────────
// Draw
// ─────────────────────────────────────────────────────────────────────────
void ResonanceApp::draw()
{
    gl::clear();

    // Pass all uniforms to the shader
    mShader->bind();
    mShader->uniform("uTime",       (float)getElapsedSeconds());
    mShader->uniform("uResolution", vec2(getWindowWidth(), getWindowHeight()));
    mShader->uniform("uBass",       mBass);
    mShader->uniform("uMid",        mMid);
    mShader->uniform("uHigh",       mHigh);
    mShader->uniform("uVolume",     mVolume);
    mShader->uniform("uBeat",       mBeatAccum);

    // Draw the single fullscreen quad — the shader does everything
    mQuad->draw();

    // --- ImGui overlay ---
    if (mShowGui) {
        ImGui::Begin("RESONANCE v3", &mShowGui);

        ImGui::Text("FPS: %.1f", getAverageFps());
        ImGui::Separator();

        ImGui::SliderFloat("Volume Threshold", &mVolumeThreshold, 0.0001f, 0.05f, "%.4f");
        ImGui::SliderFloat("Sensitivity",      &mSensitivity,     0.1f,    5.0f,   "%.2f");
        ImGui::Separator();

        ImGui::Text("Audio Bands:");
        ImGui::ProgressBar(glm::clamp(mBass   * 10.0f, 0.0f, 1.0f), ImVec2(-1, 0), "Bass");
        ImGui::ProgressBar(glm::clamp(mMid    * 10.0f, 0.0f, 1.0f), ImVec2(-1, 0), "Mid");
        ImGui::ProgressBar(glm::clamp(mHigh   * 10.0f, 0.0f, 1.0f), ImVec2(-1, 0), "High");
        ImGui::ProgressBar(glm::clamp(mVolume * 5.0f,  0.0f, 1.0f), ImVec2(-1, 0), "Volume");
        ImGui::Separator();

        ImGui::Text("Beat: %.2f %s", mBeatAccum, mBassHit ? "HIT!" : "");

        ImGui::End();
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────
void ResonanceApp::keyDown(KeyEvent event)
{
    switch (event.getCode()) {
        case KeyEvent::KEY_h:
            mShowGui = !mShowGui;
            break;
        case KeyEvent::KEY_f:
            setFullScreen(!isFullScreen());
            break;
        case KeyEvent::KEY_ESCAPE:
            quit();
            break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════════

CINDER_APP(ResonanceApp, RendererGl(RendererGl::Options().msaa(0)),
    [](App::Settings* settings) {
        settings->setWindowSize(1920, 1080);
        settings->setTitle("RESONANCE");
        settings->setFrameRate(60.0f);
    })
