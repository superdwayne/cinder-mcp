/*
 *  BlockBounce — Real-time Projection Mapping Physics Demo
 *
 *  Detects physical colored blocks via webcam + OpenCV, creates Box2D
 *  static bodies from their contours, and bounces dynamic balls off them.
 *  Includes corner-pin calibration for projector alignment, jitter
 *  prevention via spatial tracking, and FBO-based motion-blur trails.
 *
 *  Award-winning visual edition: neon glows, color-cycling balls,
 *  impact particles, cinematic camera treatment, pulsing contour outlines.
 *
 *  Built for Cinder 0.9.x  |  Requires: OpenCV, Box2D CinderBlock
 */

#include "cinder/app/App.h"
#include "cinder/app/RendererGl.h"
#include "cinder/gl/gl.h"
#include "cinder/Capture.h"
#include "cinder/Surface.h"
#include "cinder/CinderImGui.h"
#include "cinder/Rand.h"
#include "cinder/Timeline.h"
#include "cinder/Log.h"

// OpenCV — undefine macOS macros that clash with OpenCV enums
#ifdef NO
#undef NO
#endif
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/calib3d.hpp>

// Box2D
#include <Box2D/Box2D.h>

using namespace ci;
using namespace ci::app;
using namespace std;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
static const int   CAPTURE_WIDTH       = 1280;
static const int   CAPTURE_HEIGHT      = 720;
static const float BOX2D_SCALE         = 30.0f;   // pixels-per-metre
static const int   VELOCITY_ITERATIONS = 8;
static const int   POSITION_ITERATIONS = 3;
static const int   STABLE_FRAME_LIMIT  = 10;       // frames before freezing
static const int   MAX_PARTICLES       = 500;

// ---------------------------------------------------------------------------
//  BallInfo — per-ball visual data
// ---------------------------------------------------------------------------
struct BallInfo {
    b2Body* body;
    float   hue;        // 0-1, slowly cycles
    float   spawnTime;  // for age-based effects
    float   radius;     // individual ball radius
    b2Vec2  prevVel;    // for collision detection
};

// ---------------------------------------------------------------------------
//  Particle — impact effect
// ---------------------------------------------------------------------------
struct Particle {
    vec2  pos;
    vec2  vel;
    float life;     // 1→0, counts down
    float hue;
    float size;
};

// ---------------------------------------------------------------------------
//  TrackedBlock
// ---------------------------------------------------------------------------
struct TrackedBlock {
    cv::RotatedRect     rect;
    vector<cv::Point>   contour;      // actual shape points (in window coords)
    vec2                centroid;
    float               angle        = 0.0f;
    int                 framesStable = 0;
    bool                frozen       = false;
    b2Body*             body         = nullptr;
    int                 id           = -1;
};

// ---------------------------------------------------------------------------
//  HSV → RGB helper (for vivid ball colors)
// ---------------------------------------------------------------------------
static Color hsvToRgb( float h, float s, float v )
{
    return Color( CM_HSV, h, s, v );
}

// ---------------------------------------------------------------------------
//  BlockBounceApp
// ---------------------------------------------------------------------------
class BlockBounceApp : public App {
public:
    void setup()     override;
    void update()    override;
    void draw()      override;
    void mouseDown( MouseEvent event ) override;
    void keyDown( KeyEvent event )     override;
    void cleanup()   override;

private:
    // --- Webcam ---
    CaptureRef                      mCapture;
    gl::TextureRef                  mCameraTexture;
    vector<Capture::DeviceRef>      mDevices;
    int                             mSelectedDevice = 0;

    // --- FBO ping-pong for trails ---
    gl::FboRef          mTrailFbo[2];
    int                 mCurrentFbo = 0;

    // --- Box2D ---
    b2World*            mWorld = nullptr;
    vector<TrackedBlock> mBlocks;
    vector<BallInfo>    mBalls;
    int                 mNextBlockId = 0;

    // --- Particles ---
    vector<Particle>    mParticles;

    // --- ImGui ---
    bool                mShowUI = false;   // hidden by default for clean recording

    // --- Calibration ---
    vector<vec2>        mCalibrationPoints;
    cv::Mat             mPerspectiveMatrix;
    bool                mCalibrationMode = false;

    // --- Debug ---
    bool                mShowDebug = false;  // off by default for demo
    gl::TextureRef      mDebugTexture;       // small contour overlay

    // --- Detection (edge-based) ---
    int     mCannyLow = 50;          // Canny edge low threshold
    int     mCannyHigh = 150;        // Canny edge high threshold
    int     mDilateSize = 15;        // how much to grow edges into solid regions
    int     mFrameCount = 0;

    // --- Physics knobs ---
    float mGravityX       = 0.0f;
    float mGravityY       = 20.0f;   // higher gravity for dramatic falling
    float mBallRestitution = 0.85f;  // satisfying bounces
    float mBallRadiusMin  = 20.0f;
    float mBallRadiusMax  = 40.0f;
    float mBallRadius     = 30.0f;   // for UI slider (midpoint)
    float mBallDensity    = 0.3f;    // light
    float mBallDamping    = 0.5f;    // air drag
    int   mBallCount      = 15;
    float mBallSpawnRate  = 1.0f;
    float mSpawnAccum     = 0.0f;

    // --- Tracking ---
    float mJitterThreshold = 5.0f;
    float mMinContourArea  = 2000.0f;
    int   mBallStuckFrames = 0;
    vec2  mLastBallPos     = vec2( 0 );

    // --- Title overlay ---
    float mTitleAlpha = 1.0f;
    float mStartTime  = 0.0f;

    // --- Contour color ---
    float mContourHue = 0.48f;  // electric cyan

    // --- Wall bodies ---
    b2Body* mFloor   = nullptr;
    b2Body* mCeiling = nullptr;
    b2Body* mLeftWall  = nullptr;
    b2Body* mRightWall = nullptr;

    // --- Helpers ---
    void    createWalls();
    void    destroyWalls();
    void    createBlockBody( TrackedBlock& block );
    void    removeBlockBody( TrackedBlock& block );
    BallInfo spawnBall( vec2 pos );
    void    removeOffscreenBalls();
    void    matchAndUpdateBlocks( const vector<cv::RotatedRect>& detections, const vector<vector<cv::Point>>& contourShapes );

    void    spawnImpactParticles( vec2 pos, float hue, int count );
    void    updateParticles( float dt );
    void    drawGlowBall( vec2 pos, float radius, float hue );
    void    drawNeonContours();
    void    drawVignette();
    void    drawTitleOverlay();

    cv::Mat    surfaceToMat( const Surface8uRef& surface );
    gl::TextureRef matToTexture( const cv::Mat& mat );
    cv::Point2f vec2ToCv( const vec2& v );
    vec2        cvToVec2( const cv::Point2f& p );

    inline b2Vec2 toPhysics( vec2 v ) const {
        return b2Vec2( v.x / BOX2D_SCALE, v.y / BOX2D_SCALE );
    }
    inline vec2 fromPhysics( b2Vec2 v ) const {
        return vec2( v.x * BOX2D_SCALE, v.y * BOX2D_SCALE );
    }
};

// ===========================================================================
//  setup
// ===========================================================================
void BlockBounceApp::setup()
{
    mStartTime = (float)getElapsedSeconds();

    // ---- Webcam — list devices and let user pick via ImGui ----
    mDevices = Capture::getDevices();
    for ( size_t i = 0; i < mDevices.size(); ++i ) {
        CI_LOG_I( "Camera [" << i << "]: " << mDevices[i]->getName() );
    }
    // Pick iPhone camera if available, otherwise first device
    int deviceIdx = 0;
    for ( size_t i = 0; i < mDevices.size(); ++i ) {
        if ( mDevices[i]->getName().find( "iPhone" ) != string::npos ) {
            deviceIdx = (int)i;
            break;
        }
    }
    mSelectedDevice = deviceIdx;
    if ( !mDevices.empty() ) {
        try {
            mCapture = Capture::create( CAPTURE_WIDTH, CAPTURE_HEIGHT, mDevices[deviceIdx] );
            mCapture->start();
            CI_LOG_I( "Using camera: " << mDevices[deviceIdx]->getName() );
        }
        catch ( ci::Exception& exc ) {
            CI_LOG_E( "Failed to init capture: " << exc.what() );
        }
    }

    // ---- Box2D world ----
    b2Vec2 gravity( mGravityX, mGravityY );
    mWorld = new b2World( gravity );

    // ---- ImGui ----
    ImGui::Initialize();
}

// ===========================================================================
//  cleanup
// ===========================================================================
void BlockBounceApp::cleanup()
{
    // Destroy all ball bodies
    for ( auto& ball : mBalls ) {
        mWorld->DestroyBody( ball.body );
    }
    mBalls.clear();

    // Destroy all block bodies
    for ( auto& block : mBlocks ) {
        removeBlockBody( block );
    }
    mBlocks.clear();

    destroyWalls();

    delete mWorld;
    mWorld = nullptr;
}

// ===========================================================================
//  Wall creation / destruction
// ===========================================================================
void BlockBounceApp::createWalls()
{
    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();
    float thick = 20.0f;

    float pw = w / BOX2D_SCALE;
    float ph = h / BOX2D_SCALE;
    float pt = thick / BOX2D_SCALE;

    auto makeWall = [&]( float cx, float cy, float hx, float hy ) -> b2Body* {
        b2BodyDef bd;
        bd.type = b2_staticBody;
        bd.position.Set( cx, cy );
        b2Body* body = mWorld->CreateBody( &bd );

        b2PolygonShape shape;
        shape.SetAsBox( hx, hy );

        b2FixtureDef fd;
        fd.shape = &shape;
        fd.friction = 0.3f;
        body->CreateFixture( &fd );
        return body;
    };

    // No floor — ball falls through and respawns
    // No ceiling — ball enters from top
    // Side walls keep ball in frame
    mLeftWall  = makeWall( -pt,       ph * 0.5f,   pt, ph * 0.5f );
    mRightWall = makeWall( pw + pt,   ph * 0.5f,   pt, ph * 0.5f );
}

void BlockBounceApp::destroyWalls()
{
    if ( mFloor )     { mWorld->DestroyBody( mFloor );     mFloor     = nullptr; }
    if ( mCeiling )   { mWorld->DestroyBody( mCeiling );   mCeiling   = nullptr; }
    if ( mLeftWall )  { mWorld->DestroyBody( mLeftWall );  mLeftWall  = nullptr; }
    if ( mRightWall ) { mWorld->DestroyBody( mRightWall ); mRightWall = nullptr; }
}

// ===========================================================================
//  mouseDown — calibration clicks or manual ball spawn
// ===========================================================================
void BlockBounceApp::mouseDown( MouseEvent event )
{
    vec2 pos = event.getPos();

    if ( mCalibrationMode ) {
        if ( mCalibrationPoints.size() < 4 ) {
            mCalibrationPoints.push_back( pos );
            CI_LOG_I( "Calibration point " << mCalibrationPoints.size() << ": " << pos );
        }
        if ( mCalibrationPoints.size() == 4 ) {
            vector<cv::Point2f> src = {
                cv::Point2f( 0, 0 ),
                cv::Point2f( (float)CAPTURE_WIDTH, 0 ),
                cv::Point2f( (float)CAPTURE_WIDTH, (float)CAPTURE_HEIGHT ),
                cv::Point2f( 0, (float)CAPTURE_HEIGHT )
            };
            vector<cv::Point2f> dst;
            for ( auto& p : mCalibrationPoints ) {
                dst.push_back( cv::Point2f( p.x, p.y ) );
            }
            mPerspectiveMatrix = cv::getPerspectiveTransform( src, dst );
            mCalibrationMode = false;
            CI_LOG_I( "Calibration complete — perspective matrix computed." );
        }
    }
    else {
        // Click to spawn a ball at mouse position
        spawnBall( pos );
    }
}

// ===========================================================================
//  keyDown
// ===========================================================================
void BlockBounceApp::keyDown( KeyEvent event )
{
    switch ( event.getCode() ) {
        case KeyEvent::KEY_r:
            mCalibrationPoints.clear();
            mCalibrationMode = true;
            mPerspectiveMatrix = cv::Mat();
            CI_LOG_I( "Calibration reset." );
            break;
        case KeyEvent::KEY_d:
            mShowDebug = !mShowDebug;
            break;
        case KeyEvent::KEY_h:
            mShowUI = !mShowUI;
            break;
        case KeyEvent::KEY_b:
            // Spawn a burst of 5 balls from random positions at the top
            for ( int i = 0; i < 5; ++i ) {
                float rx = Rand::randFloat( 100.0f, getWindowWidth() - 100.0f );
                spawnBall( vec2( rx, -40.0f ) );
            }
            break;
        case KeyEvent::KEY_SPACE:
            // Spawn a single ball from random top position
            spawnBall( vec2( Rand::randFloat( 100.0f, getWindowWidth() - 100.0f ), -40.0f ) );
            break;
        case KeyEvent::KEY_ESCAPE:
            quit();
            break;
        default:
            break;
    }
}

// ===========================================================================
//  spawnImpactParticles
// ===========================================================================
void BlockBounceApp::spawnImpactParticles( vec2 pos, float hue, int count )
{
    for ( int i = 0; i < count && (int)mParticles.size() < MAX_PARTICLES; ++i ) {
        Particle p;
        p.pos  = pos;
        float angle = Rand::randFloat( 0.0f, (float)M_PI * 2.0f );
        float speed = Rand::randFloat( 80.0f, 300.0f );
        p.vel  = vec2( cos( angle ) * speed, sin( angle ) * speed );
        p.life = 1.0f;
        p.hue  = hue + Rand::randFloat( -0.05f, 0.05f );
        if ( p.hue < 0.0f ) p.hue += 1.0f;
        if ( p.hue > 1.0f ) p.hue -= 1.0f;
        p.size = Rand::randFloat( 2.0f, 6.0f );
        mParticles.push_back( p );
    }
}

// ===========================================================================
//  updateParticles
// ===========================================================================
void BlockBounceApp::updateParticles( float dt )
{
    for ( auto it = mParticles.begin(); it != mParticles.end(); ) {
        it->life -= dt * 2.0f;  // 0.5 second lifetime
        if ( it->life <= 0.0f ) {
            it = mParticles.erase( it );
        }
        else {
            it->pos += it->vel * dt;
            it->vel *= 0.96f;   // drag
            it->size *= 0.98f;  // shrink
            ++it;
        }
    }
}

// ===========================================================================
//  drawGlowBall — multi-layer glow rendering
// ===========================================================================
void BlockBounceApp::drawGlowBall( vec2 pos, float radius, float hue )
{
    Color baseColor = hsvToRgb( hue, 0.9f, 1.0f );
    Color brightColor = Color(
        baseColor.r * 0.5f + 0.5f,
        baseColor.g * 0.5f + 0.5f,
        baseColor.b * 0.5f + 0.5f
    );

    // Large soft outer glow (additive)
    gl::color( ColorA( baseColor.r, baseColor.g, baseColor.b, 0.15f ) );
    gl::drawSolidCircle( pos, radius * 3.0f );

    // Medium glow
    gl::color( ColorA( baseColor.r, baseColor.g, baseColor.b, 0.4f ) );
    gl::drawSolidCircle( pos, radius * 1.8f );

    // Solid core — bright white-tinted
    gl::color( ColorA( brightColor.r, brightColor.g, brightColor.b, 1.0f ) );
    gl::drawSolidCircle( pos, radius );

    // Bright highlight spot (pure white, offset top-left)
    gl::color( ColorA( 1.0f, 1.0f, 1.0f, 0.8f ) );
    gl::drawSolidCircle( pos + vec2( -radius * 0.25f, -radius * 0.25f ), radius * 0.35f );
}

// ===========================================================================
//  drawNeonContours — pulsing neon glow on detected shapes
// ===========================================================================
void BlockBounceApp::drawNeonContours()
{
    float t = (float)getElapsedSeconds();
    float pulse = 0.7f + 0.3f * sin( t * 3.0f );  // subtle pulse

    // Electric cyan base: hue ~0.48
    Color contourColor = hsvToRgb( mContourHue, 0.85f, pulse );

    for ( auto& block : mBlocks ) {
        if ( block.contour.size() < 3 ) continue;

        // Build polyline from contour
        PolyLine2f poly;
        for ( auto& pt : block.contour ) {
            poly.push_back( vec2( (float)pt.x, (float)pt.y ) );
        }
        poly.setClosed( true );

        // Outer glow line — wide, low opacity
        gl::color( ColorA( contourColor.r, contourColor.g, contourColor.b, 0.2f ) );
        gl::lineWidth( 6.0f );
        gl::draw( poly );

        // Inner bright line — thin, full opacity
        gl::color( ColorA( contourColor.r, contourColor.g, contourColor.b, 1.0f ) );
        gl::lineWidth( 2.0f );
        gl::draw( poly );
    }

    // Reset line width
    gl::lineWidth( 1.0f );
}

// ===========================================================================
//  drawVignette — darken edges for cinematic feel
// ===========================================================================
void BlockBounceApp::drawVignette()
{
    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();
    float cx = w * 0.5f;
    float cy = h * 0.5f;
    float maxR = glm::length( vec2( cx, cy ) );

    // Draw a series of concentric dark rectangles (approximation of radial vignette)
    // We'll use 8 semi-transparent black rects from edge inward
    int steps = 12;
    for ( int i = 0; i < steps; ++i ) {
        float t = (float)i / (float)steps;
        // Only darken the outer 40%
        float innerT = 0.6f;
        if ( t < innerT ) continue;

        float alpha = ( t - innerT ) / ( 1.0f - innerT );
        alpha = alpha * alpha * 0.5f;  // quadratic falloff, max 50% darkness

        float margin = t * glm::min( cx, cy ) * 0.1f;
        gl::color( ColorA( 0, 0, 0, alpha ) );
        gl::drawSolidRect( Rectf( 0, 0, w, margin ) );                     // top
        gl::drawSolidRect( Rectf( 0, h - margin, w, h ) );                 // bottom
        gl::drawSolidRect( Rectf( 0, margin, margin, h - margin ) );       // left
        gl::drawSolidRect( Rectf( w - margin, margin, w, h - margin ) );   // right
    }
}

// ===========================================================================
//  drawTitleOverlay — "BLOCKBOUNCE" fading in on startup
// ===========================================================================
void BlockBounceApp::drawTitleOverlay()
{
    float elapsed = (float)getElapsedSeconds() - mStartTime;
    if ( elapsed > 4.0f ) return;  // fully gone after 4s

    float alpha = 1.0f;
    if ( elapsed > 2.0f ) {
        alpha = 1.0f - ( elapsed - 2.0f ) / 2.0f;  // fade out from 2s to 4s
    }
    if ( alpha <= 0.0f ) return;

    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();

    // Title glow (behind text)
    string title = "BLOCKBOUNCE";
    Font titleFont( "Helvetica-Bold", 96 );
    vec2 titleSize = gl::TextureFont::create( titleFont )->measureString( title );
    vec2 titlePos = vec2( ( w - titleSize.x ) * 0.5f, h * 0.45f );

    // Outer glow pass
    gl::color( ColorA( 0.0f, 0.8f, 1.0f, alpha * 0.3f ) );
    for ( int dx = -3; dx <= 3; ++dx ) {
        for ( int dy = -3; dy <= 3; ++dy ) {
            gl::drawString( title, titlePos + vec2( (float)dx, (float)dy ),
                           ColorA( 0.0f, 0.8f, 1.0f, alpha * 0.15f ), titleFont );
        }
    }

    // Main text
    gl::drawString( title, titlePos,
                   ColorA( 1.0f, 1.0f, 1.0f, alpha ), titleFont );

    // Subtitle
    Font subFont( "Helvetica", 24 );
    gl::drawString( "real-time projection mapping", vec2( titlePos.x + 40.0f, titlePos.y + 80.0f ),
                   ColorA( 0.5f, 0.9f, 1.0f, alpha * 0.7f ), subFont );
}

// ===========================================================================
//  update
// ===========================================================================
void BlockBounceApp::update()
{
    float dt = 1.0f / 60.0f;

    // ---- Create walls on first frame ----
    if ( !mFloor && getWindowWidth() > 0 && getWindowHeight() > 0 ) {
        createWalls();
    }

    // ---- Update gravity if slider changed ----
    mWorld->SetGravity( b2Vec2( mGravityX, mGravityY ) );

    // ---- Grab camera frame ----
    if ( mCapture && mCapture->checkNewFrame() ) {
        Surface8uRef surf = mCapture->getSurface();
        if ( surf ) {
            mCameraTexture = gl::Texture2d::create( *surf );

            if ( mCalibrationMode ) { /* just show camera */ }
            else {
            // --- OpenCV processing ---
            cv::Mat frame = surfaceToMat( surf );
            cv::Mat mask;
            mFrameCount++;

            cv::Mat gray;
            cv::cvtColor( frame, gray, cv::COLOR_BGR2GRAY );
            cv::GaussianBlur( gray, gray, cv::Size( 5, 5 ), 0 );

            cv::Mat edges;
            cv::Canny( gray, edges, mCannyLow, mCannyHigh );

            cv::Mat elem = cv::getStructuringElement( cv::MORPH_ELLIPSE,
                cv::Size( mDilateSize, mDilateSize ) );
            cv::dilate( edges, mask, elem, cv::Point( -1, -1 ), 2 );

            vector<vector<cv::Point>> fillContours;
            cv::findContours( mask.clone(), fillContours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE );
            mask = cv::Mat::zeros( mask.size(), CV_8UC1 );
            cv::drawContours( mask, fillContours, -1, cv::Scalar( 255 ), cv::FILLED );

            cv::Mat elemSmall = cv::getStructuringElement( cv::MORPH_ELLIPSE, cv::Size( 7, 7 ) );
            cv::Mat elemLarge = cv::getStructuringElement( cv::MORPH_ELLIPSE, cv::Size( 15, 15 ) );
            cv::erode(  mask, mask, elemSmall, cv::Point( -1, -1 ), 3 );
            cv::dilate( mask, mask, elemLarge, cv::Point( -1, -1 ), 3 );
            cv::erode(  mask, mask, elemSmall, cv::Point( -1, -1 ), 1 );

            vector<vector<cv::Point>> contours;
            cv::findContours( mask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE );

            float sx = (float)getWindowWidth()  / (float)CAPTURE_WIDTH;
            float sy = (float)getWindowHeight() / (float)CAPTURE_HEIGHT;

            vector<cv::RotatedRect> detections;
            vector<vector<cv::Point>> scaledContours;
            for ( auto& contour : contours ) {
                double area = cv::contourArea( contour );
                if ( area >= mMinContourArea && contour.size() >= 5 ) {
                    vector<cv::Point> hull;
                    cv::convexHull( contour, hull );

                    vector<cv::Point> approx;
                    double epsilon = 0.015 * cv::arcLength( hull, true );
                    cv::approxPolyDP( hull, approx, epsilon, true );
                    if ( approx.size() < 3 ) continue;

                    vector<cv::Point> scaled;
                    for ( auto& pt : approx ) {
                        scaled.push_back( cv::Point( (int)(pt.x * sx), (int)(pt.y * sy) ) );
                    }

                    cv::RotatedRect rr = cv::minAreaRect( contour );
                    rr.center.x *= sx;
                    rr.center.y *= sy;
                    rr.size.width  *= sx;
                    rr.size.height *= sy;

                    detections.push_back( rr );
                    scaledContours.push_back( scaled );
                }
            }

            // Simple approach: destroy all old blocks, create new ones
            for ( auto& block : mBlocks ) removeBlockBody( block );
            mBlocks.clear();
            for ( size_t di = 0; di < detections.size(); ++di ) {
                TrackedBlock newBlock;
                newBlock.rect     = detections[di];
                newBlock.contour  = scaledContours[di];
                newBlock.centroid = vec2( detections[di].center.x, detections[di].center.y );
                newBlock.id       = mNextBlockId++;
                createBlockBody( newBlock );
                mBlocks.push_back( newBlock );
            }

            // Build debug overlay texture
            if ( mShowDebug ) {
                cv::Mat debugImg;
                cv::cvtColor( mask, debugImg, cv::COLOR_GRAY2BGR );
                cv::drawContours( debugImg, contours, -1, cv::Scalar( 0, 255, 0 ), 2 );
                for ( auto& rr : detections ) {
                    cv::Point2f verts[4];
                    rr.points( verts );
                    for ( int j = 0; j < 4; ++j ) {
                        cv::line( debugImg, verts[j], verts[( j + 1 ) % 4],
                                  cv::Scalar( 0, 255, 255 ), 2 );
                    }
                }
                mDebugTexture = matToTexture( debugImg );
            }
        } // end else (not calibration)
        }
    }

    // ---- Detect collisions (velocity change) and spawn particles ----
    float collisionThreshold = 3.0f;
    for ( auto& ball : mBalls ) {
        b2Vec2 curVel = ball.body->GetLinearVelocity();
        b2Vec2 dv( curVel.x - ball.prevVel.x, curVel.y - ball.prevVel.y );
        float dvMag = dv.Length();
        if ( dvMag > collisionThreshold ) {
            vec2 pos = fromPhysics( ball.body->GetPosition() );
            int count = (int)glm::clamp( dvMag * 1.5f, 8.0f, 15.0f );
            spawnImpactParticles( pos, ball.hue, count );
        }
        ball.prevVel = curVel;
    }

    // ---- Update ball hues (slow cycling) ----
    for ( auto& ball : mBalls ) {
        ball.hue += 0.001f;
        if ( ball.hue > 1.0f ) ball.hue -= 1.0f;
    }

    // ---- Update particles ----
    updateParticles( dt );

    // ---- Step physics ----
    mWorld->Step( dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS );

    // ---- Remove off-screen balls ----
    removeOffscreenBalls();

    // ---- Continuously drop balls, staggered ----
    mSpawnAccum += 1.0f;
    if ( (int)mBalls.size() < mBallCount && mSpawnAccum >= 15.0f ) {
        float rx = Rand::randFloat( 100.0f, getWindowWidth() - 100.0f );
        spawnBall( vec2( rx, -40.0f ) );
        mSpawnAccum = 0.0f;
    }
}

// ===========================================================================
//  draw
// ===========================================================================
void BlockBounceApp::draw()
{
    float winW = (float)getWindowWidth();
    float winH = (float)getWindowHeight();
    float t    = (float)getElapsedSeconds();

    // ---------------------------------------------------------------
    //  Calibration mode — show camera + instructions
    // ---------------------------------------------------------------
    if ( mCalibrationMode ) {
        gl::clear( Color::black() );

        if ( mCameraTexture ) {
            gl::draw( mCameraTexture, Rectf( 0, 0, winW, winH ) );
        }

        gl::color( Color( 1.0f, 0.2f, 0.2f ) );
        for ( size_t i = 0; i < mCalibrationPoints.size(); ++i ) {
            gl::drawSolidCircle( mCalibrationPoints[i], 8.0f );
            if ( i > 0 ) {
                gl::drawLine( mCalibrationPoints[i - 1], mCalibrationPoints[i] );
            }
        }
        if ( mCalibrationPoints.size() == 4 ) {
            gl::drawLine( mCalibrationPoints[3], mCalibrationPoints[0] );
        }

        gl::color( Color::white() );
        gl::drawString(
            "CALIBRATION: Click 4 corners (TL, TR, BR, BL).  "
            "Points placed: " + to_string( mCalibrationPoints.size() ) + "/4   [R] Reset",
            vec2( 20, 20 ),
            Color::white(),
            Font( "Arial", 18 )
        );

        // ImGui panel (always shown in calibration)
        ImGui::SetNextWindowSize( ImVec2( 350, 0 ), ImGuiCond_FirstUseEver );
        ImGui::Begin( "BlockBounce" );
        ImGui::SliderInt( "Edge low", &mCannyLow, 10, 200 );
        ImGui::SliderInt( "Edge high", &mCannyHigh, 50, 300 );
        ImGui::SliderInt( "Fill size", &mDilateSize, 5, 40 );
        ImGui::Separator();
        ImGui::SliderFloat( "Min area", &mMinContourArea, 50, 50000 );
        ImGui::SliderFloat( "Jitter px", &mJitterThreshold, 1, 50 );
        ImGui::Separator();
        ImGui::SliderFloat( "Gravity", &mGravityY, 1, 40 );
        ImGui::SliderFloat( "Bounce", &mBallRestitution, 0.5f, 1.0f );
        ImGui::SliderFloat( "Ball min R", &mBallRadiusMin, 5, 40 );
        ImGui::SliderFloat( "Ball max R", &mBallRadiusMax, 10, 60 );
        ImGui::SliderFloat( "Air drag", &mBallDamping, 0, 2.0f );
        ImGui::SliderInt( "Ball count", &mBallCount, 1, 50 );
        ImGui::Separator();
        ImGui::Checkbox( "Debug view", &mShowDebug );
        ImGui::Checkbox( "Calibration mode", &mCalibrationMode );
        ImGui::Separator();
        ImGui::Text( "Camera" );
        {
            vector<string> names;
            for ( auto& d : mDevices ) names.push_back( d->getName() );
            auto getter = []( void* data, int idx, const char** out ) -> bool {
                auto* v = (vector<string>*)data;
                *out = (*v)[idx].c_str();
                return true;
            };
            int prev = mSelectedDevice;
            ImGui::Combo( "Device", &mSelectedDevice, getter, &names, (int)names.size() );
            if ( mSelectedDevice != prev && mSelectedDevice < (int)mDevices.size() ) {
                if ( mCapture ) mCapture->stop();
                try {
                    mCapture = Capture::create( CAPTURE_WIDTH, CAPTURE_HEIGHT, mDevices[mSelectedDevice] );
                    mCapture->start();
                    mFrameCount = 0;
                } catch ( ci::Exception& e ) {
                    CI_LOG_E( "Camera switch failed: " << e.what() );
                }
            }
        }
        ImGui::End();

        // Still draw balls during calibration
        for ( auto& ball : mBalls ) {
            vec2 pos = fromPhysics( ball.body->GetPosition() );
            drawGlowBall( pos, ball.radius, ball.hue );
        }
        return;
    }

    // ---------------------------------------------------------------
    //  Lazy-init trail FBOs
    // ---------------------------------------------------------------
    if ( !mTrailFbo[0] ) {
        gl::Fbo::Format fboFmt;
        fboFmt.colorTexture(
            gl::Texture2d::Format().internalFormat( GL_RGBA8 ).minFilter( GL_LINEAR ).magFilter( GL_LINEAR )
        );
        mTrailFbo[0] = gl::Fbo::create( (int)winW, (int)winH, fboFmt );
        mTrailFbo[1] = gl::Fbo::create( (int)winW, (int)winH, fboFmt );
        for ( int i = 0; i < 2; ++i ) {
            gl::ScopedFramebuffer fb( mTrailFbo[i] );
            gl::clear( ColorA( 0, 0, 0, 0 ) );
        }
    }

    // ---------------------------------------------------------------
    //  Trail FBO pass — accumulate colored ball glows with slow fade
    // ---------------------------------------------------------------
    int prevFbo = 1 - mCurrentFbo;
    {
        gl::ScopedFramebuffer scopedFbo( mTrailFbo[mCurrentFbo] );
        gl::ScopedViewport    scopedVp( ivec2( 0 ), mTrailFbo[mCurrentFbo]->getSize() );
        gl::setMatricesWindow( mTrailFbo[mCurrentFbo]->getSize() );

        gl::clear( ColorA( 0, 0, 0, 0 ) );

        // Draw previous trail with slow cinematic fade
        gl::color( ColorA( 1, 1, 1, 0.94f ) );
        gl::draw( mTrailFbo[prevFbo]->getColorTexture(),
                  Rectf( 0, 0, winW, winH ) );

        // Draw colored ball glows into trail
        {
            gl::ScopedBlendAdditive additiveBlend;
            for ( auto& ball : mBalls ) {
                vec2 pos = fromPhysics( ball.body->GetPosition() );
                Color ballColor = hsvToRgb( ball.hue, 0.9f, 1.0f );

                // Soft glow in trail
                gl::color( ColorA( ballColor.r, ballColor.g, ballColor.b, 0.25f ) );
                gl::drawSolidCircle( pos, ball.radius * 2.0f );

                // Core in trail
                gl::color( ColorA( ballColor.r, ballColor.g, ballColor.b, 0.5f ) );
                gl::drawSolidCircle( pos, ball.radius * 0.8f );
            }
        }
    }
    mCurrentFbo = 1 - mCurrentFbo;

    // ---------------------------------------------------------------
    //  Main scene draw
    // ---------------------------------------------------------------
    gl::setMatricesWindow( getWindowSize() );
    gl::clear( Color::black() );

    // Live camera feed as background (40% opacity — darker, cinematic)
    if ( mCameraTexture ) {
        gl::color( ColorA( 1, 1, 1, 0.4f ) );
        gl::draw( mCameraTexture, Rectf( 0, 0, winW, winH ) );
    }

    // Draw trail FBO (normal blend)
    gl::color( Color::white() );
    gl::draw( mTrailFbo[1 - mCurrentFbo]->getColorTexture(),
              Rectf( 0, 0, winW, winH ) );

    // ---------------------------------------------------------------
    //  Neon contour outlines (additive blend for glow)
    // ---------------------------------------------------------------
    {
        gl::ScopedBlendAdditive additiveBlend;
        drawNeonContours();
    }

    // ---------------------------------------------------------------
    //  Glowing color-cycling balls (additive blend)
    // ---------------------------------------------------------------
    {
        gl::ScopedBlendAdditive additiveBlend;
        for ( auto& ball : mBalls ) {
            vec2 pos = fromPhysics( ball.body->GetPosition() );
            drawGlowBall( pos, ball.radius, ball.hue );
        }
    }

    // ---------------------------------------------------------------
    //  Impact particles (additive blend)
    // ---------------------------------------------------------------
    {
        gl::ScopedBlendAdditive additiveBlend;
        for ( auto& p : mParticles ) {
            Color pColor = hsvToRgb( p.hue, 0.8f, 1.0f );
            float alpha = p.life * 0.8f;
            gl::color( ColorA( pColor.r, pColor.g, pColor.b, alpha ) );
            gl::drawSolidCircle( p.pos, p.size * p.life );
        }
    }

    // ---------------------------------------------------------------
    //  Vignette overlay
    // ---------------------------------------------------------------
    drawVignette();

    // ---------------------------------------------------------------
    //  Title overlay (fades out after 3 seconds)
    // ---------------------------------------------------------------
    drawTitleOverlay();

    // ---------------------------------------------------------------
    //  Debug overlay — small camera + contour view in top-right corner
    // ---------------------------------------------------------------
    if ( mShowDebug && mDebugTexture ) {
        float debugW = 240.0f;
        float debugH = 180.0f;
        float margin = 10.0f;
        Rectf debugRect(
            winW - debugW - margin, margin,
            winW - margin, margin + debugH
        );

        gl::color( Color::white() );
        gl::draw( mDebugTexture, debugRect );
        gl::color( Color( 0.0f, 1.0f, 0.0f ) );
        gl::drawStrokedRect( debugRect );

        string stats = "Blocks: " + to_string( mBlocks.size() )
                     + "  Balls: " + to_string( mBalls.size() )
                     + "  Particles: " + to_string( mParticles.size() );
        gl::drawString( stats, vec2( debugRect.x1 + 4, debugRect.y2 + 4 ),
                        Color( 0.0f, 1.0f, 0.0f ), Font( "Arial", 13 ) );
    }

    // ---------------------------------------------------------------
    //  ImGui panel (toggled with H key, hidden by default)
    // ---------------------------------------------------------------
    if ( mShowUI ) {
        ImGui::SetNextWindowSize( ImVec2( 380, 0 ), ImGuiCond_FirstUseEver );
        ImGui::Begin( "BlockBounce" );

        ImGui::Text( "DETECTION" );
        ImGui::SliderInt( "Edge low", &mCannyLow, 10, 200 );
        ImGui::SliderInt( "Edge high", &mCannyHigh, 50, 300 );
        ImGui::SliderInt( "Fill size", &mDilateSize, 5, 40 );
        ImGui::SliderFloat( "Min area", &mMinContourArea, 500, 20000 );

        ImGui::Separator();
        ImGui::Text( "PHYSICS" );
        ImGui::SliderFloat( "Gravity", &mGravityY, 1, 40 );
        ImGui::SliderFloat( "Bounce", &mBallRestitution, 0.5f, 1.0f );
        ImGui::SliderFloat( "Ball min R", &mBallRadiusMin, 5, 40 );
        ImGui::SliderFloat( "Ball max R", &mBallRadiusMax, 10, 60 );
        ImGui::SliderFloat( "Air drag", &mBallDamping, 0, 2.0f );
        ImGui::SliderInt( "Ball count", &mBallCount, 1, 50 );

        ImGui::Separator();
        ImGui::Text( "VISUALS" );
        ImGui::SliderFloat( "Contour hue", &mContourHue, 0.0f, 1.0f );
        ImGui::Checkbox( "Debug view", &mShowDebug );
        ImGui::Checkbox( "Calibration mode", &mCalibrationMode );

        ImGui::Separator();
        ImGui::Text( "CAMERA" );
        {
            vector<string> names;
            for ( auto& d : mDevices ) names.push_back( d->getName() );
            auto getter = []( void* data, int idx, const char** out ) -> bool {
                auto* v = (vector<string>*)data;
                *out = (*v)[idx].c_str();
                return true;
            };
            int prev = mSelectedDevice;
            ImGui::Combo( "Device", &mSelectedDevice, getter, &names, (int)names.size() );
            if ( mSelectedDevice != prev && mSelectedDevice < (int)mDevices.size() ) {
                if ( mCapture ) mCapture->stop();
                try {
                    mCapture = Capture::create( CAPTURE_WIDTH, CAPTURE_HEIGHT, mDevices[mSelectedDevice] );
                    mCapture->start();
                    mFrameCount = 0;
                } catch ( ci::Exception& e ) {
                    CI_LOG_E( "Camera switch failed: " << e.what() );
                }
            }
        }

        ImGui::Separator();
        ImGui::TextDisabled( "[H] Toggle UI  [D] Debug  [R] Calibrate  [Esc] Quit" );
        ImGui::Text( "Balls: %d  Particles: %d  Blocks: %d",
                    (int)mBalls.size(), (int)mParticles.size(), (int)mBlocks.size() );
        ImGui::End();
    }
}

// ===========================================================================
//  matchAndUpdateBlocks  —  spatial tracking with jitter prevention
// ===========================================================================
void BlockBounceApp::matchAndUpdateBlocks( const vector<cv::RotatedRect>& detections, const vector<vector<cv::Point>>& contourShapes )
{
    vector<vec2> newCentroids;
    newCentroids.reserve( detections.size() );
    for ( auto& rr : detections ) {
        newCentroids.push_back( vec2( rr.center.x, rr.center.y ) );
    }

    vector<bool> detectionUsed( detections.size(), false );
    vector<bool> blockMatched( mBlocks.size(), false );

    for ( size_t bi = 0; bi < mBlocks.size(); ++bi ) {
        float bestDist = FLT_MAX;
        int   bestIdx  = -1;
        for ( size_t di = 0; di < detections.size(); ++di ) {
            if ( detectionUsed[di] ) continue;
            float d = glm::distance( mBlocks[bi].centroid, newCentroids[di] );
            if ( d < bestDist ) {
                bestDist = d;
                bestIdx  = (int)di;
            }
        }

        float matchRadius = mJitterThreshold * 3.0f;
        if ( bestIdx >= 0 && bestDist < matchRadius ) {
            blockMatched[bi]        = true;
            detectionUsed[bestIdx]  = true;

            if ( bestDist < mJitterThreshold ) {
                mBlocks[bi].framesStable++;
                if ( mBlocks[bi].framesStable >= STABLE_FRAME_LIMIT && !mBlocks[bi].frozen ) {
                    mBlocks[bi].frozen = true;
                }
            }
            else {
                mBlocks[bi].framesStable = 0;
                mBlocks[bi].frozen       = false;
                mBlocks[bi].rect         = detections[bestIdx];
                mBlocks[bi].contour      = contourShapes[bestIdx];
                mBlocks[bi].centroid     = newCentroids[bestIdx];
                mBlocks[bi].angle        = detections[bestIdx].angle;

                removeBlockBody( mBlocks[bi] );
                createBlockBody( mBlocks[bi] );
            }
        }
    }

    for ( int bi = (int)mBlocks.size() - 1; bi >= 0; --bi ) {
        if ( !blockMatched[bi] ) {
            removeBlockBody( mBlocks[bi] );
            mBlocks.erase( mBlocks.begin() + bi );
        }
    }

    for ( size_t di = 0; di < detections.size(); ++di ) {
        if ( !detectionUsed[di] ) {
            TrackedBlock newBlock;
            newBlock.rect     = detections[di];
            newBlock.contour  = contourShapes[di];
            newBlock.centroid = newCentroids[di];
            newBlock.angle    = detections[di].angle;
            newBlock.id       = mNextBlockId++;
            createBlockBody( newBlock );
            mBlocks.push_back( newBlock );
        }
    }
}

// ===========================================================================
//  createBlockBody — Box2D chain shape from actual contour
// ===========================================================================
void BlockBounceApp::createBlockBody( TrackedBlock& block )
{
    if ( block.body ) return;
    if ( block.contour.size() < 3 ) return;

    b2BodyDef bd;
    bd.type     = b2_staticBody;
    bd.position.Set( 0, 0 );
    block.body  = mWorld->CreateBody( &bd );

    vector<b2Vec2> chainVerts;
    chainVerts.reserve( block.contour.size() );
    for ( auto& pt : block.contour ) {
        chainVerts.push_back( b2Vec2( pt.x / BOX2D_SCALE, pt.y / BOX2D_SCALE ) );
    }

    b2ChainShape chain;
    chain.CreateLoop( chainVerts.data(), (int)chainVerts.size() );

    b2FixtureDef fd;
    fd.shape       = &chain;
    fd.friction    = 0.3f;
    fd.restitution = 0.5f;
    block.body->CreateFixture( &fd );
}

// ===========================================================================
//  removeBlockBody
// ===========================================================================
void BlockBounceApp::removeBlockBody( TrackedBlock& block )
{
    if ( block.body ) {
        mWorld->DestroyBody( block.body );
        block.body = nullptr;
    }
}

// ===========================================================================
//  spawnBall — dynamic circle body with unique hue and random radius
// ===========================================================================
BallInfo BlockBounceApp::spawnBall( vec2 pos )
{
    float radius = Rand::randFloat( mBallRadiusMin, mBallRadiusMax );

    b2BodyDef bd;
    bd.type     = b2_dynamicBody;
    bd.position = toPhysics( pos );
    bd.bullet   = true;
    bd.linearDamping  = mBallDamping;
    bd.angularDamping = 0.3f;

    b2Body* body = mWorld->CreateBody( &bd );

    b2CircleShape shape;
    shape.m_radius = radius / BOX2D_SCALE;

    b2FixtureDef fd;
    fd.shape       = &shape;
    fd.density     = mBallDensity;
    fd.friction    = 0.1f;
    fd.restitution = mBallRestitution;
    body->CreateFixture( &fd );

    body->SetLinearVelocity( b2Vec2( Rand::randFloat( -2.0f, 2.0f ), 5.0f ) );

    BallInfo info;
    info.body      = body;
    info.hue       = Rand::randFloat( 0.0f, 1.0f );
    info.spawnTime = (float)getElapsedSeconds();
    info.radius    = radius;
    info.prevVel   = body->GetLinearVelocity();

    mBalls.push_back( info );
    return info;
}

// ===========================================================================
//  removeOffscreenBalls
// ===========================================================================
void BlockBounceApp::removeOffscreenBalls()
{
    float limitY = (float)getWindowHeight() + 100.0f;
    float limitX = (float)getWindowWidth()  + 100.0f;

    for ( auto it = mBalls.begin(); it != mBalls.end(); ) {
        vec2 pos = fromPhysics( it->body->GetPosition() );
        if ( pos.y > limitY || pos.x < -100.0f || pos.x > limitX || pos.y < -200.0f ) {
            mWorld->DestroyBody( it->body );
            it = mBalls.erase( it );
        }
        else {
            ++it;
        }
    }
}

// ===========================================================================
//  surfaceToMat — Cinder Surface8u -> cv::Mat (BGR)
// ===========================================================================
cv::Mat BlockBounceApp::surfaceToMat( const Surface8uRef& surface )
{
    int w = surface->getWidth();
    int h = surface->getHeight();

    cv::Mat mat( h, w, CV_8UC3 );

    auto iter = surface->getIter();
    int row = 0;
    while ( iter.line() ) {
        int col = 0;
        while ( iter.pixel() ) {
            mat.at<cv::Vec3b>( row, col ) = cv::Vec3b(
                iter.b(),
                iter.g(),
                iter.r()
            );
            ++col;
        }
        ++row;
    }
    return mat;
}

// ===========================================================================
//  matToTexture — cv::Mat (BGR) -> ci::gl::Texture2dRef
// ===========================================================================
gl::TextureRef BlockBounceApp::matToTexture( const cv::Mat& mat )
{
    if ( mat.empty() ) return nullptr;

    cv::Mat rgb;
    if ( mat.channels() == 3 ) {
        cv::cvtColor( mat, rgb, cv::COLOR_BGR2RGB );
    }
    else if ( mat.channels() == 1 ) {
        cv::cvtColor( mat, rgb, cv::COLOR_GRAY2RGB );
    }
    else {
        rgb = mat.clone();
    }

    auto surface = Surface8u::create( rgb.data, rgb.cols, rgb.rows,
                                      (int)rgb.step, SurfaceChannelOrder::RGB );
    return gl::Texture2d::create( *surface );
}

// ===========================================================================
//  Coordinate conversion helpers
// ===========================================================================
cv::Point2f BlockBounceApp::vec2ToCv( const vec2& v )
{
    return cv::Point2f( v.x, v.y );
}

vec2 BlockBounceApp::cvToVec2( const cv::Point2f& p )
{
    return vec2( p.x, p.y );
}

// ===========================================================================
//  App entry point — 1920x1080 for cinematic recording
// ===========================================================================
CINDER_APP( BlockBounceApp, RendererGl( RendererGl::Options().msaa( 4 ) ),
    []( App::Settings* settings ) {
        settings->setWindowSize( 1920, 1080 );
        settings->setTitle( "BlockBounce" );
        settings->setFrameRate( 60.0f );
    }
)
