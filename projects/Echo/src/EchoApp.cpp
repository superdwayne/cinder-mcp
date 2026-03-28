/*
 *  ECHO  --  A Living Particle Mirror
 *  ====================================
 *  Interactive installation that transforms the human silhouette into
 *  50,000 flowing, glowing particles. Built with Cinder 0.9.3.
 *
 *  Controls:
 *    H   - toggle settings panel
 *    F   - toggle fullscreen
 *    D   - toggle debug overlay (silhouette mask)
 *    Esc - quit
 *
 *  (c) 2026 — creative technology installation
 */

#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/Capture.h"
#include "cinder/Surface.h"
#include "cinder/CinderImGui.h"
#include "cinder/Rand.h"
#include "cinder/Log.h"
#include "cinder/ip/Resize.h"

// Fix macro clash between Cinder and OpenCV
#ifdef NO
#undef NO
#endif

#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

using namespace ci;
using namespace ci::app;
using namespace std;

// ---------------------------------------------------------------------------
// Particle data
// ---------------------------------------------------------------------------
struct Particle {
    vec2  pos;
    vec2  vel;
    Color color;
    float size;
    float life;
};

// GPU-side vertex layout (tightly packed for VBO upload)
struct GpuParticle {
    vec2  pos;      // 8 bytes
    vec3  color;    // 12 bytes
    float size;     // 4 bytes
};

// ---------------------------------------------------------------------------
// EchoApp
// ---------------------------------------------------------------------------
class EchoApp : public App {
public:
    void setup()  override;
    void update() override;
    void draw()   override;
    void keyDown( KeyEvent event ) override;

private:
    // -- helpers --
    void initCamera();
    void initParticles();
    void initRendering();
    void initFbos();
    void processCamera();
    void updateParticles( float dt );
    void uploadParticles();
    void renderScene();
    void renderBloom();
    void renderComposite();
    void renderTitle();
    void renderUI();
    void renderDebug();
    void renderVignette();

    // -- camera --
    CaptureRef                  mCapture;
    gl::TextureRef              mCameraTexture;
    vector<Capture::DeviceRef>  mDevices;
    int                         mSelectedDevice = 0;

    // -- particles --
    static const int            NUM_PARTICLES = 50000;
    vector<Particle>            mParticles;
    gl::VboRef                  mParticleVbo;
    gl::VboMeshRef              mParticleMesh;
    gl::BatchRef                mParticleBatch;
    gl::GlslProgRef             mParticleShader;

    // -- silhouette --
    gl::TextureRef              mSilhouetteTexture;
    cv::Mat                     mPrevGray;
    cv::Mat                     mSilhouetteMask;
    cv::Mat                     mMotionField;
    float                       mGlobalMotion = 0.0f;

    // -- FBOs for bloom --
    gl::FboRef                  mSceneFbo;
    gl::FboRef                  mBloomFbo[2];
    gl::GlslProgRef             mBloomShader;

    // -- silhouette data (CPU, downscaled) --
    static const int            SIL_W = 160;
    static const int            SIL_H = 90;
    float                       mSilData[160 * 90]; // SIL_W * SIL_H

    // -- settings --
    float   mAttractionStrength = 4000.0f;  // very strong pull to body
    float   mNoiseScale         = 0.002f;
    float   mNoiseSpeed         = 0.3f;
    float   mDamping            = 0.92f;   // more damping = particles settle on body
    float   mCameraOpacity      = 0.3f;
    float   mBloomIntensity     = 1.5f;
    float   mVignetteStrength   = 0.6f;
    int     mBrightnessThreshold = 140;     // pixels darker than this = body
    bool    mShowUI             = true;
    bool    mShowDebug          = true;
    float   mTitleAlpha         = 1.0f;

    // -- time --
    float   mTime               = 0.0f;
};

// ===========================================================================
//  SETUP
// ===========================================================================
void EchoApp::setup()
{
    CI_LOG_I( "ECHO -- setting up" );

    initCamera();
    initParticles();
    initRendering();
    initFbos();

    // ImGui
    ImGui::Initialize();

    // Enable point sprite / program point size
    glEnable( GL_PROGRAM_POINT_SIZE );
    glEnable( GL_POINT_SPRITE );

    // Zero silhouette data
    memset( mSilData, 0, sizeof( mSilData ) );

    CI_LOG_I( "ECHO -- setup complete" );
}

// ---------------------------------------------------------------------------
void EchoApp::initCamera()
{
    mDevices = Capture::getDevices();

    if ( mDevices.empty() ) {
        CI_LOG_E( "No capture devices found!" );
        return;
    }

    // Prefer iPhone Continuity Camera — look for "iPhone" in name
    int preferredIdx = 0;
    for ( size_t i = 0; i < mDevices.size(); ++i ) {
        string name = mDevices[i]->getName();
        CI_LOG_I( "Camera device [" << i << "]: " << name );
        if ( name.find( "iPhone" ) != string::npos ||
             name.find( "iphone" ) != string::npos ) {
            preferredIdx = static_cast<int>( i );
        }
    }
    mSelectedDevice = preferredIdx;

    try {
        mCapture = Capture::create( 1280, 720, mDevices[mSelectedDevice] );
        mCapture->start();
        CI_LOG_I( "Started capture on: " << mDevices[mSelectedDevice]->getName() );
    }
    catch ( ci::Exception& exc ) {
        CI_LOG_E( "Failed to start capture: " << exc.what() );
    }
}

// ---------------------------------------------------------------------------
void EchoApp::initParticles()
{
    float w = static_cast<float>( getWindowWidth() );
    float h = static_cast<float>( getWindowHeight() );

    mParticles.resize( NUM_PARTICLES );
    for ( auto& p : mParticles ) {
        p.pos   = vec2( Rand::randFloat( 0.0f, w ), Rand::randFloat( 0.0f, h ) );
        p.vel   = vec2( Rand::randFloat( -20.0f, 20.0f ), Rand::randFloat( -20.0f, 20.0f ) );
        p.color = Color( 0.2f, 0.4f, 1.0f );
        p.size  = Rand::randFloat( 1.0f, 3.0f );
        p.life  = 0.0f;
    }
}

// ---------------------------------------------------------------------------
void EchoApp::initRendering()
{
    // -- Particle shader (inline GLSL 150) --
    mParticleShader = gl::GlslProg::create(
        // vertex
        CI_GLSL( 150,
            uniform mat4 ciModelViewProjection;

            in vec2  particlePos;
            in vec3  particleColor;
            in float particleSize;

            out vec3 vColor;

            void main() {
                vColor      = particleColor;
                gl_Position = ciModelViewProjection * vec4( particlePos, 0.0, 1.0 );
                gl_PointSize = particleSize;
            }
        ),
        // fragment
        CI_GLSL( 150,
            in vec3 vColor;
            out vec4 oColor;

            void main() {
                vec2 coord = gl_PointCoord - vec2( 0.5 );
                float dist = length( coord );
                if ( dist > 0.5 ) discard;
                float alpha = 1.0 - smoothstep( 0.1, 0.5, dist );
                oColor = vec4( vColor * alpha, alpha * 0.7 );
            }
        )
    );

    // -- Bloom blur shader (two-pass Gaussian, direction via uniform) --
    mBloomShader = gl::GlslProg::create(
        // vertex
        CI_GLSL( 150,
            uniform mat4 ciModelViewProjection;
            in vec4 ciPosition;
            in vec2 ciTexCoord0;
            out vec2 vTexCoord;

            void main() {
                vTexCoord   = ciTexCoord0;
                gl_Position = ciModelViewProjection * ciPosition;
            }
        ),
        // fragment — 9-tap Gaussian
        CI_GLSL( 150,
            uniform sampler2D uTexture;
            uniform vec2      uDirection; // (1/w, 0) or (0, 1/h)
            uniform float     uIntensity;
            in vec2 vTexCoord;
            out vec4 oColor;

            void main() {
                // 9-tap Gaussian weights (sigma ~3.5)
                float weights[5] = float[]( 0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216 );

                vec3 result = texture( uTexture, vTexCoord ).rgb * weights[0];
                for ( int i = 1; i < 5; ++i ) {
                    vec2 offset = uDirection * float( i );
                    result += texture( uTexture, vTexCoord + offset ).rgb * weights[i];
                    result += texture( uTexture, vTexCoord - offset ).rgb * weights[i];
                }
                oColor = vec4( result * uIntensity, 1.0 );
            }
        )
    );

    // -- Particle VBO --
    size_t bufferSize = NUM_PARTICLES * sizeof( GpuParticle );
    mParticleVbo = gl::Vbo::create( GL_ARRAY_BUFFER, bufferSize, nullptr, GL_DYNAMIC_DRAW );

    // Build VboMesh with custom layout
    geom::BufferLayout layout;
    layout.append( geom::Attrib::CUSTOM_0, 2, sizeof( GpuParticle ), offsetof( GpuParticle, pos   ) ); // particlePos
    layout.append( geom::Attrib::CUSTOM_1, 3, sizeof( GpuParticle ), offsetof( GpuParticle, color ) ); // particleColor
    layout.append( geom::Attrib::CUSTOM_2, 1, sizeof( GpuParticle ), offsetof( GpuParticle, size  ) ); // particleSize

    mParticleMesh = gl::VboMesh::create( NUM_PARTICLES, GL_POINTS, { { layout, mParticleVbo } } );

    // Bind custom attribute names to the shader
    mParticleShader->uniform( "ciModelViewProjection", gl::getModelViewProjection() );

    mParticleBatch = gl::Batch::create( mParticleMesh, mParticleShader, {
        { geom::Attrib::CUSTOM_0, "particlePos"   },
        { geom::Attrib::CUSTOM_1, "particleColor" },
        { geom::Attrib::CUSTOM_2, "particleSize"  },
    } );
}

// ---------------------------------------------------------------------------
void EchoApp::initFbos()
{
    int w = getWindowWidth();
    int h = getWindowHeight();

    // Scene FBO — full resolution, 16-bit float for HDR particles
    auto sceneFmt = gl::Fbo::Format()
        .colorTexture( gl::Texture2d::Format().internalFormat( GL_RGBA16F ) );
    mSceneFbo = gl::Fbo::create( w, h, sceneFmt );

    // Bloom FBOs — half resolution
    int bw = w / 2;
    int bh = h / 2;
    auto bloomFmt = gl::Fbo::Format()
        .colorTexture( gl::Texture2d::Format()
            .internalFormat( GL_RGBA16F )
            .minFilter( GL_LINEAR )
            .magFilter( GL_LINEAR )
            .wrap( GL_CLAMP_TO_EDGE ) );
    mBloomFbo[0] = gl::Fbo::create( bw, bh, bloomFmt );
    mBloomFbo[1] = gl::Fbo::create( bw, bh, bloomFmt );
}

// ===========================================================================
//  UPDATE
// ===========================================================================
void EchoApp::update()
{
    mTime = static_cast<float>( getElapsedSeconds() );
    float dt = 1.0f / 60.0f;

    // Title fade (4 seconds visible, then fade over 1 second)
    if ( mTime < 4.0f ) {
        mTitleAlpha = 1.0f;
    } else if ( mTime < 5.0f ) {
        mTitleAlpha = 1.0f - ( mTime - 4.0f );
    } else {
        mTitleAlpha = 0.0f;
    }

    processCamera();
    updateParticles( dt );
    uploadParticles();
}

// ---------------------------------------------------------------------------
void EchoApp::processCamera()
{
    if ( !mCapture || !mCapture->checkNewFrame() )
        return;

    // Grab surface and create texture for display
    Surface8uRef surface = mCapture->getSurface();
    if ( !surface )
        return;

    mCameraTexture = gl::Texture2d::create( *surface );

    // Convert to OpenCV Mat
    int w = surface->getWidth();
    int h = surface->getHeight();
    cv::Mat frame( h, w, CV_8UC3 );

    // Copy from Surface (RGBX) to OpenCV (BGR)
    auto iter = surface->getIter();
    int row = 0;
    while ( iter.line() ) {
        int col = 0;
        while ( iter.pixel() ) {
            frame.at<cv::Vec3b>( row, col ) = cv::Vec3b(
                iter.b(), iter.g(), iter.r()
            );
            ++col;
        }
        ++row;
    }

    // Flip horizontally for mirror effect
    cv::flip( frame, frame, 1 );

    // Convert to grayscale
    cv::Mat gray;
    cv::cvtColor( frame, gray, cv::COLOR_BGR2GRAY );

    // Blur to reduce noise
    cv::GaussianBlur( gray, gray, cv::Size( 5, 5 ), 0 );

    // ---- Motion detection ----
    if ( !mPrevGray.empty() ) {
        cv::Mat motionMask;
        cv::absdiff( gray, mPrevGray, motionMask );
        cv::threshold( motionMask, motionMask, 25, 255, cv::THRESH_BINARY );
        cv::GaussianBlur( motionMask, motionMask, cv::Size( 21, 21 ), 0 );
        mMotionField = motionMask;

        // Global motion amount (0..1)
        double motionMean = cv::mean( motionMask )[0] / 255.0;
        mGlobalMotion = static_cast<float>( std::min( std::max( motionMean * 5.0, 0.0 ), 1.0 ) );
    }

    // ---- Silhouette extraction ----
    // Method: adaptive threshold — body is darker than the bright wall
    cv::Mat mask;

    // Heavy blur to smooth out texture/noise
    cv::Mat blurred;
    cv::GaussianBlur( gray, blurred, cv::Size( 21, 21 ), 0 );

    // Threshold: anything darker than mBrightnessThreshold = body
    cv::threshold( blurred, mask, mBrightnessThreshold, 255, cv::THRESH_BINARY_INV );

    // Clean up: erode to remove noise, dilate to fill gaps
    cv::Mat elemS = cv::getStructuringElement( cv::MORPH_ELLIPSE, cv::Size( 7, 7 ) );
    cv::Mat elemL = cv::getStructuringElement( cv::MORPH_ELLIPSE, cv::Size( 15, 15 ) );
    cv::erode( mask, mask, elemS, cv::Point(-1,-1), 2 );
    cv::dilate( mask, mask, elemL, cv::Point(-1,-1), 3 );
    cv::erode( mask, mask, elemS, cv::Point(-1,-1), 1 );

    // Smooth edges
    cv::GaussianBlur( mask, mask, cv::Size( 11, 11 ), 0 );
    cv::threshold( mask, mask, 100, 255, cv::THRESH_BINARY );

    mSilhouetteMask = mask;

    // ---- Downscale to SIL_W x SIL_H for particle attraction ----
    cv::Mat smallMask;
    cv::resize( mask, smallMask, cv::Size( SIL_W, SIL_H ), 0, 0, cv::INTER_AREA );

    for ( int y = 0; y < SIL_H; ++y ) {
        for ( int x = 0; x < SIL_W; ++x ) {
            mSilData[y * SIL_W + x] = ( smallMask.at<uchar>( y, x ) > 128 ) ? 1.0f : 0.0f;
        }
    }

    // Upload silhouette as texture (for debug display)
    if ( !mSilhouetteMask.empty() ) {
        cv::Mat rgb;
        cv::cvtColor( mSilhouetteMask, rgb, cv::COLOR_GRAY2RGB );
        auto surface = Surface8u::create( rgb.data, rgb.cols, rgb.rows,
                                          (int)rgb.step, SurfaceChannelOrder::RGB );
        mSilhouetteTexture = gl::Texture2d::create( *surface );
    }

    // Store previous frame
    mPrevGray = gray.clone();
}

// ---------------------------------------------------------------------------
void EchoApp::updateParticles( float dt )
{
    float w = static_cast<float>( getWindowWidth() );
    float h = static_cast<float>( getWindowHeight() );
    float time = mTime;

    // Compute body centroid from silhouette data (average of all body pixels)
    vec2 bodyCentroid = vec2( w * 0.5f, h * 0.5f );
    float bodyPixelCount = 0;
    vec2 bodySum = vec2( 0 );
    for ( int sy2 = 0; sy2 < SIL_H; ++sy2 ) {
        for ( int sx2 = 0; sx2 < SIL_W; ++sx2 ) {
            if ( mSilData[sy2 * SIL_W + sx2] > 0.5f ) {
                bodySum += vec2( sx2 * w / SIL_W, sy2 * h / SIL_H );
                bodyPixelCount += 1.0f;
            }
        }
    }
    bool hasBody = bodyPixelCount > 50.0f;
    if ( hasBody ) {
        bodyCentroid = bodySum / bodyPixelCount;
    }

    for ( auto& p : mParticles ) {
        // -- Sample silhouette at particle position --
        int sx = glm::clamp( static_cast<int>( p.pos.x / w * SIL_W ), 0, SIL_W - 1 );
        int sy = glm::clamp( static_cast<int>( p.pos.y / h * SIL_H ), 0, SIL_H - 1 );
        float sil = mSilData[sy * SIL_W + sx];

        // -- Gradient for attraction direction --
        float sl = ( sx > 0 )         ? mSilData[sy * SIL_W + sx - 1] : 0.0f;
        float sr = ( sx < SIL_W - 1 ) ? mSilData[sy * SIL_W + sx + 1] : 0.0f;
        float su = ( sy > 0 )         ? mSilData[( sy - 1 ) * SIL_W + sx] : 0.0f;
        float sd = ( sy < SIL_H - 1 ) ? mSilData[( sy + 1 ) * SIL_W + sx] : 0.0f;
        vec2 grad = vec2( sr - sl, sd - su );

        bool onBody = sil > 0.5f;

        // -- ATTRACTION --
        vec2 attraction = vec2( 0 );

        if ( onBody ) {
            // On body: use gradient to slide toward densest part, gentle
            attraction = grad * mAttractionStrength * 0.2f;
        } else if ( glm::length( grad ) > 0.01f ) {
            // Near an edge: strong pull toward body via gradient
            attraction = grad * mAttractionStrength;
        } else if ( hasBody ) {
            // Far from body: fly directly toward body centroid
            vec2 toBody = bodyCentroid - p.pos;
            float dist = glm::length( toBody );
            if ( dist > 1.0f ) {
                // Stronger pull when farther away
                float pullStrength = mAttractionStrength * 0.5f * glm::clamp( dist / 500.0f, 0.2f, 1.0f );
                attraction = glm::normalize( toBody ) * pullStrength;
            }
        }

        // -- Curl noise --
        float nx = p.pos.x * mNoiseScale + time * mNoiseSpeed;
        float ny = p.pos.y * mNoiseScale + time * mNoiseSpeed;
        float n1 = sinf( nx * 1.7f + ny * 2.3f + time )
                  * cosf( ny * 1.3f + time * 0.7f );
        float n2 = cosf( nx * 2.1f + ny * 1.9f + time * 0.8f )
                  * sinf( ny * 1.1f + time * 1.2f );
        vec2 noiseForce = vec2( n1, n2 );

        // On body: very gentle noise (particles settle into shape)
        // Off body: stronger noise (particles wander until attracted)
        if ( onBody ) {
            noiseForce *= 15.0f;  // gentle shimmer
        } else {
            float chaos = mGlobalMotion;
            noiseForce *= 40.0f * ( 0.3f + chaos * 2.0f );
        }

        // -- Breathing --
        float breathe = sinf( time * 0.4f + p.pos.y * 0.002f ) * 0.1f;
        noiseForce *= ( 1.0f + breathe );

        // -- Total force --
        vec2 force = attraction + noiseForce;

        // -- Update velocity & position --
        // Heavy damping on body = particles settle into shape
        float damp = onBody ? 0.85f : mDamping;
        p.vel = p.vel * damp + force * dt;

        // Clamp speed
        float speed = glm::length( p.vel );
        if ( speed > 400.0f ) {
            p.vel *= 400.0f / speed;
            speed = 400.0f;
        }

        p.pos += p.vel * dt;

        // -- Wrap edges --
        if ( p.pos.x < 0.0f )  p.pos.x += w;
        if ( p.pos.x > w )     p.pos.x -= w;
        if ( p.pos.y < 0.0f )  p.pos.y += h;
        if ( p.pos.y > h )     p.pos.y -= h;

        // -- Color by speed (cool blue -> warm orange -> hot white) --
        float speedNorm = glm::clamp( speed / 300.0f, 0.0f, 1.0f );
        Color coolColor ( 0.15f, 0.35f, 1.0f );
        Color warmColor ( 1.0f,  0.45f, 0.08f );
        Color hotColor  ( 1.0f,  1.0f,  1.0f );

        if ( speedNorm < 0.5f ) {
            float t = speedNorm * 2.0f;
            p.color = Color(
                coolColor.r + ( warmColor.r - coolColor.r ) * t,
                coolColor.g + ( warmColor.g - coolColor.g ) * t,
                coolColor.b + ( warmColor.b - coolColor.b ) * t
            );
        } else {
            float t = ( speedNorm - 0.5f ) * 2.0f;
            p.color = Color(
                warmColor.r + ( hotColor.r - warmColor.r ) * t,
                warmColor.g + ( hotColor.g - warmColor.g ) * t,
                warmColor.b + ( hotColor.b - warmColor.b ) * t
            );
        }

        // ON BODY: much brighter, white-hot
        if ( sil > 0.3f ) {
            float blend = 0.6f;
            p.color = Color(
                p.color.r + ( 1.0f - p.color.r ) * blend,
                p.color.g + ( 1.0f - p.color.g ) * blend,
                p.color.b + ( 1.0f - p.color.b ) * blend
            );
        }

        // -- Size: body particles are BIG and bright, background particles are tiny --
        if ( sil > 0.5f ) {
            p.size = 4.0f + speedNorm * 3.0f;  // large on body
        } else {
            p.size = 1.0f + speedNorm * 2.0f;  // small background wanderers
        }

        p.life += dt;
    }
}

// ---------------------------------------------------------------------------
void EchoApp::uploadParticles()
{
    auto ptr = reinterpret_cast<GpuParticle*>( mParticleVbo->mapWriteOnly() );
    if ( !ptr ) return;

    for ( int i = 0; i < NUM_PARTICLES; ++i ) {
        const auto& p = mParticles[i];
        ptr[i].pos   = p.pos;
        ptr[i].color = vec3( p.color.r, p.color.g, p.color.b );
        ptr[i].size  = p.size;
    }
    mParticleVbo->unmap();
}

// ===========================================================================
//  DRAW
// ===========================================================================
void EchoApp::draw()
{
    // -- 1) Render particles into scene FBO --
    renderScene();

    // -- 2) Bloom pass --
    renderBloom();

    // -- 3) Composite everything --
    renderComposite();

    // -- 4) Title overlay --
    if ( mTitleAlpha > 0.001f ) {
        renderTitle();
    }

    // -- 5) Debug overlay --
    if ( mShowDebug ) {
        renderDebug();
    }

    // -- 6) ImGui --
    renderUI();
}

// ---------------------------------------------------------------------------
void EchoApp::renderScene()
{
    gl::ScopedFramebuffer fbo( mSceneFbo );
    gl::ScopedViewport    vp( ivec2( 0 ), mSceneFbo->getSize() );
    gl::clear( ColorA( 0, 0, 0, 0 ) );

    gl::ScopedMatrices matrices;
    gl::setMatricesWindow( mSceneFbo->getSize() );

    // Additive blending for particles
    gl::ScopedBlendAdditive blend;

    // Draw particles
    mParticleBatch->draw();
}

// ---------------------------------------------------------------------------
void EchoApp::renderBloom()
{
    // Horizontal pass: scene -> bloom[0]
    {
        gl::ScopedFramebuffer fbo( mBloomFbo[0] );
        gl::ScopedViewport    vp( ivec2( 0 ), mBloomFbo[0]->getSize() );
        gl::clear( Color::black() );

        gl::ScopedMatrices matrices;
        gl::setMatricesWindow( mBloomFbo[0]->getSize() );

        gl::ScopedGlslProg shader( mBloomShader );
        mBloomShader->uniform( "uTexture",   0 );
        mBloomShader->uniform( "uDirection",  vec2( 1.0f / mBloomFbo[0]->getWidth(), 0.0f ) );
        mBloomShader->uniform( "uIntensity",  mBloomIntensity );

        gl::ScopedTextureBind tex( mSceneFbo->getColorTexture(), 0 );
        gl::drawSolidRect( mBloomFbo[0]->getBounds() );
    }

    // Vertical pass: bloom[0] -> bloom[1]
    {
        gl::ScopedFramebuffer fbo( mBloomFbo[1] );
        gl::ScopedViewport    vp( ivec2( 0 ), mBloomFbo[1]->getSize() );
        gl::clear( Color::black() );

        gl::ScopedMatrices matrices;
        gl::setMatricesWindow( mBloomFbo[1]->getSize() );

        gl::ScopedGlslProg shader( mBloomShader );
        mBloomShader->uniform( "uTexture",   0 );
        mBloomShader->uniform( "uDirection",  vec2( 0.0f, 1.0f / mBloomFbo[1]->getHeight() ) );
        mBloomShader->uniform( "uIntensity",  mBloomIntensity );

        gl::ScopedTextureBind tex( mBloomFbo[0]->getColorTexture(), 0 );
        gl::drawSolidRect( mBloomFbo[1]->getBounds() );
    }
}

// ---------------------------------------------------------------------------
void EchoApp::renderComposite()
{
    gl::setMatricesWindow( getWindowSize() );
    gl::clear( Color::black() );

    Rectf windowRect = getWindowBounds();

    // (A) Camera feed at low opacity (mirror background)
    if ( mCameraTexture && mCameraOpacity > 0.001f ) {
        gl::ScopedBlendAlpha alphaBlend;
        gl::color( ColorA( 1, 1, 1, mCameraOpacity ) );

        // Draw mirrored (flipped horizontally)
        gl::ScopedModelMatrix model;
        gl::translate( vec2( getWindowWidth(), 0 ) );
        gl::scale( vec2( -1.0f, 1.0f ) );
        gl::draw( mCameraTexture, windowRect );

        gl::color( Color::white() );
    }

    // (B) Scene (particles) with additive blending
    {
        gl::ScopedBlendAdditive addBlend;
        gl::color( Color::white() );
        gl::draw( mSceneFbo->getColorTexture(), windowRect );
    }

    // (C) Bloom with additive blending
    {
        gl::ScopedBlendAdditive addBlend;
        gl::color( Color::white() );
        gl::draw( mBloomFbo[1]->getColorTexture(), windowRect );
    }

    // (D) Vignette overlay
    renderVignette();
}

// ---------------------------------------------------------------------------
void EchoApp::renderVignette()
{
    if ( mVignetteStrength < 0.001f )
        return;

    float w = static_cast<float>( getWindowWidth() );
    float h = static_cast<float>( getWindowHeight() );
    vec2 center( w * 0.5f, h * 0.5f );
    float maxDist = glm::length( center );

    // Draw a fullscreen quad with a dark radial gradient using a simple inline shader
    // For maximum reliability, just draw concentric semi-transparent rects
    // Actually: use a stock shader with vertex colors — render a mesh

    // Simple approach: draw dark overlay at edges using 4 gradient rects
    // Even simpler: use a glsl shader inline

    static gl::GlslProgRef vignetteShader = nullptr;
    if ( !vignetteShader ) {
        vignetteShader = gl::GlslProg::create(
            CI_GLSL( 150,
                uniform mat4 ciModelViewProjection;
                in vec4 ciPosition;
                in vec2 ciTexCoord0;
                out vec2 vTexCoord;
                void main() {
                    vTexCoord = ciTexCoord0;
                    gl_Position = ciModelViewProjection * ciPosition;
                }
            ),
            CI_GLSL( 150,
                uniform float uStrength;
                uniform vec2  uResolution;
                in vec2  vTexCoord;
                out vec4 oColor;
                void main() {
                    vec2 uv = vTexCoord;
                    vec2 center = vec2( 0.5 );
                    float dist = distance( uv, center ) * 1.414; // normalize to 0..1
                    float vignette = smoothstep( 0.2, 1.4, dist ) * uStrength;
                    oColor = vec4( 0.0, 0.0, 0.0, vignette );
                }
            )
        );
    }

    gl::ScopedBlendAlpha alphaBlend;
    gl::ScopedGlslProg shader( vignetteShader );
    vignetteShader->uniform( "uStrength",    mVignetteStrength );
    vignetteShader->uniform( "uResolution",  vec2( w, h ) );

    gl::drawSolidRect( getWindowBounds() );
}

// ---------------------------------------------------------------------------
void EchoApp::renderTitle()
{
    if ( mTitleAlpha <= 0.001f )
        return;

    // Draw "ECHO" centered on screen
    // Use Cinder's built-in text rendering
    gl::ScopedBlendAlpha blend;

    string titleText = "E  C  H  O";

    auto font = Font( "Helvetica-Light", 120.0f );
    vec2 titleSize = gl::TextureFont::create( font )->measureString( titleText );
    vec2 pos(
        ( getWindowWidth()  - titleSize.x ) * 0.5f,
        ( getWindowHeight() - titleSize.y ) * 0.5f + titleSize.y * 0.7f
    );

    gl::color( ColorA( 1, 1, 1, mTitleAlpha ) );

    auto texFont = gl::TextureFont::create( font );
    texFont->drawString( titleText, pos );

    // Subtitle
    auto subFont = Font( "Helvetica-Light", 24.0f );
    auto subTexFont = gl::TextureFont::create( subFont );
    string subText = "a  living  particle  mirror";
    vec2 subSize = subTexFont->measureString( subText );
    vec2 subPos(
        ( getWindowWidth() - subSize.x ) * 0.5f,
        pos.y + 60.0f
    );
    gl::color( ColorA( 0.6f, 0.7f, 1.0f, mTitleAlpha * 0.6f ) );
    subTexFont->drawString( subText, subPos );

    gl::color( Color::white() );
}

// ---------------------------------------------------------------------------
void EchoApp::renderDebug()
{
    // Show silhouette mask as overlay
    if ( mSilhouetteTexture ) {
        gl::ScopedBlendAlpha blend;
        gl::color( ColorA( 0.0f, 1.0f, 0.3f, 0.3f ) );
        gl::draw( mSilhouetteTexture, getWindowBounds() );
        gl::color( Color::white() );
    }

    // Show motion amount
    gl::drawString(
        "Motion: " + to_string( mGlobalMotion ),
        vec2( 20, getWindowHeight() - 40 ),
        Color( 1, 1, 0 ),
        Font( "Helvetica", 18.0f )
    );
}

// ---------------------------------------------------------------------------
void EchoApp::renderUI()
{
    if ( !mShowUI )
        return;

    ImGui::Begin( "ECHO Controls" );

    ImGui::Text( "FPS: %.1f", getAverageFps() );
    ImGui::Text( "Particles: %d", NUM_PARTICLES );
    ImGui::Text( "Motion: %.2f", mGlobalMotion );
    ImGui::Separator();

    // Camera selector
    if ( !mDevices.empty() ) {
        vector<string> deviceNames;
        for ( const auto& d : mDevices ) {
            deviceNames.push_back( d->getName() );
        }
        // Build combo items
        string comboItems;
        for ( const auto& n : deviceNames ) {
            comboItems += n + string( 1, '\0' );
        }
        comboItems += string( 1, '\0' );

        if ( ImGui::Combo( "Camera", &mSelectedDevice, comboItems.c_str() ) ) {
            // Restart capture with new device
            if ( mCapture ) {
                mCapture->stop();
            }
            try {
                mCapture = Capture::create( 1280, 720, mDevices[mSelectedDevice] );
                mCapture->start();
                mPrevGray = cv::Mat();  // reset motion tracking
                CI_LOG_I( "Switched to camera: " << mDevices[mSelectedDevice]->getName() );
            }
            catch ( ci::Exception& exc ) {
                CI_LOG_E( "Camera switch failed: " << exc.what() );
            }
        }
    }

    ImGui::Separator();
    ImGui::Text( "Particle Physics" );
    ImGui::SliderFloat( "Attraction",   &mAttractionStrength, 100.0f,  2000.0f );
    ImGui::SliderFloat( "Noise Scale",  &mNoiseScale,         0.001f,  0.01f   );
    ImGui::SliderFloat( "Noise Speed",  &mNoiseSpeed,         0.1f,    2.0f    );
    ImGui::SliderFloat( "Damping",      &mDamping,            0.90f,   0.99f   );

    ImGui::Separator();
    ImGui::Text( "Visual" );
    ImGui::SliderFloat( "Camera Opacity",  &mCameraOpacity,    0.0f,  0.5f );
    ImGui::SliderFloat( "Bloom Intensity", &mBloomIntensity,   0.5f,  3.0f );
    ImGui::SliderFloat( "Vignette",        &mVignetteStrength, 0.0f,  1.0f );

    ImGui::Separator();
    ImGui::Text( "Silhouette Detection" );
    ImGui::SliderInt( "Body Threshold", &mBrightnessThreshold, 50, 220 );

    ImGui::Separator();
    ImGui::Checkbox( "Debug View", &mShowDebug );

    ImGui::End();
}

// ===========================================================================
//  INPUT
// ===========================================================================
void EchoApp::keyDown( KeyEvent event )
{
    switch ( event.getCode() ) {
        case KeyEvent::KEY_h:
            mShowUI = !mShowUI;
            break;
        case KeyEvent::KEY_f:
            setFullScreen( !isFullScreen() );
            break;
        case KeyEvent::KEY_d:
            mShowDebug = !mShowDebug;
            break;
        case KeyEvent::KEY_ESCAPE:
            quit();
            break;
        default:
            break;
    }
}

// ===========================================================================
//  APP ENTRY
// ===========================================================================
CINDER_APP( EchoApp, RendererGl( RendererGl::Options().msaa( 0 ) ),
    []( App::Settings* settings ) {
        settings->setWindowSize( 1920, 1080 );
        settings->setTitle( "ECHO" );
        settings->setFrameRate( 60.0f );
    }
)
