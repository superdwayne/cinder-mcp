/*
 *  BlockBounce — Real-time Projection Mapping Physics Demo
 *
 *  Detects physical colored blocks via webcam + OpenCV, creates Box2D
 *  static bodies from their contours, and bounces dynamic balls off them.
 *  Includes corner-pin calibration for projector alignment, jitter
 *  prevention via spatial tracking, and FBO-based motion-blur trails.
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
// background_segm no longer needed — using simple frame differencing

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
    vector<b2Body*>     mBalls;
    int                 mNextBlockId = 0;

    // --- ImGui ---

    // --- Calibration ---
    vector<vec2>        mCalibrationPoints;
    cv::Mat             mPerspectiveMatrix;
    bool                mCalibrationMode = false;

    // --- Debug ---
    bool                mShowDebug = true;
    gl::TextureRef      mDebugTexture;   // small contour overlay

    // --- Detection (edge-based) ---
    int     mCannyLow = 50;          // Canny edge low threshold
    int     mCannyHigh = 150;        // Canny edge high threshold
    int     mDilateSize = 15;        // how much to grow edges into solid regions
    int     mFrameCount = 0;

    // --- Physics knobs (ping-pong feel) ---
    float mGravityX       = 0.0f;
    float mGravityY       = 15.0f;   // faster fall
    float mBallRestitution = 0.92f;  // very bouncy like ping-pong
    float mBallRadius     = 35.0f;
    float mBallDensity    = 0.3f;    // light
    float mBallDamping    = 0.5f;    // air drag
    int   mBallCount      = 10;
    float mBallSpawnRate  = 1.0f;
    float mSpawnAccum     = 0.0f;

    // --- Tracking ---
    float mJitterThreshold = 5.0f;
    float mMinContourArea  = 2000.0f;
    int   mBallStuckFrames = 0;
    vec2  mLastBallPos     = vec2( 0 );

    // --- (CinderBridge can be added later) ---

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
    b2Body* spawnBall( vec2 pos );
    void    removeOffscreenBalls();
    void    matchAndUpdateBlocks( const vector<cv::RotatedRect>& detections, const vector<vector<cv::Point>>& contourShapes );

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

    // ---- Box2D world (no bodies yet — walls created lazily in update) ----
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
    for ( auto* ball : mBalls ) {
        mWorld->DestroyBody( ball );
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

    // CinderBridge cleanup would go here
}

// ===========================================================================
//  Wall creation / destruction
// ===========================================================================
void BlockBounceApp::createWalls()
{
    float w = (float)getWindowWidth();
    float h = (float)getWindowHeight();
    float thick = 20.0f;

    // Use simple SetAsBox with half-widths directly in physics units
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
            // Source corners from camera (full frame)
            vector<cv::Point2f> src = {
                cv::Point2f( 0, 0 ),
                cv::Point2f( (float)CAPTURE_WIDTH, 0 ),
                cv::Point2f( (float)CAPTURE_WIDTH, (float)CAPTURE_HEIGHT ),
                cv::Point2f( 0, (float)CAPTURE_HEIGHT )
            };
            // Destination corners from user clicks
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
        // Click does nothing outside calibration
    }
}

// ===========================================================================
//  keyDown
// ===========================================================================
void BlockBounceApp::keyDown( KeyEvent event )
{
    switch ( event.getCode() ) {
        case KeyEvent::KEY_r:
            // Reset calibration
            mCalibrationPoints.clear();
            mCalibrationMode = true;
            mPerspectiveMatrix = cv::Mat();
            CI_LOG_I( "Calibration reset." );
            break;
        case KeyEvent::KEY_d:
            mShowDebug = !mShowDebug;
            break;
        case KeyEvent::KEY_b:
            break;
        case KeyEvent::KEY_SPACE:
            break;
        case KeyEvent::KEY_ESCAPE:
            quit();
            break;
        default:
            break;
    }
}

// ===========================================================================
//  update
// ===========================================================================
void BlockBounceApp::update()
{
    // ---- Create walls on first frame (window is guaranteed sized) ----
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

            // Skip OpenCV processing in calibration mode
            if ( mCalibrationMode ) { /* just show camera */ }
            else {
            // --- OpenCV processing ---
            cv::Mat frame = surfaceToMat( surf );
            cv::Mat mask;
            mFrameCount++;

            // Edge-based detection — finds objects by their edges
            // A blank wall has no strong edges; a post-it / object does
            cv::Mat gray;
            cv::cvtColor( frame, gray, cv::COLOR_BGR2GRAY );
            cv::GaussianBlur( gray, gray, cv::Size( 5, 5 ), 0 );

            // Canny edge detection
            cv::Mat edges;
            cv::Canny( gray, edges, mCannyLow, mCannyHigh );

            // Dilate edges to connect them into solid regions
            cv::Mat elem = cv::getStructuringElement( cv::MORPH_ELLIPSE,
                cv::Size( mDilateSize, mDilateSize ) );
            cv::dilate( edges, mask, elem, cv::Point( -1, -1 ), 2 );

            // Fill holes — find contours and fill them
            vector<vector<cv::Point>> fillContours;
            cv::findContours( mask.clone(), fillContours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE );
            mask = cv::Mat::zeros( mask.size(), CV_8UC1 );
            cv::drawContours( mask, fillContours, -1, cv::Scalar( 255 ), cv::FILLED );

            // Aggressive cleanup — kill all noise, keep only real objects
            cv::Mat elemSmall = cv::getStructuringElement( cv::MORPH_ELLIPSE, cv::Size( 7, 7 ) );
            cv::Mat elemLarge = cv::getStructuringElement( cv::MORPH_ELLIPSE, cv::Size( 15, 15 ) );
            cv::erode(  mask, mask, elemSmall, cv::Point( -1, -1 ), 3 );  // destroy noise
            cv::dilate( mask, mask, elemLarge, cv::Point( -1, -1 ), 3 );  // regrow real objects
            cv::erode(  mask, mask, elemSmall, cv::Point( -1, -1 ), 1 );  // clean edges

            // Find contours
            vector<vector<cv::Point>> contours;
            cv::findContours( mask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE );

            // Scale factors
            float sx = (float)getWindowWidth()  / (float)CAPTURE_WIDTH;
            float sy = (float)getWindowHeight() / (float)CAPTURE_HEIGHT;

            // Filter, simplify with convex hull, scale
            vector<cv::RotatedRect> detections;
            vector<vector<cv::Point>> scaledContours;
            for ( auto& contour : contours ) {
                double area = cv::contourArea( contour );
                if ( area >= mMinContourArea && contour.size() >= 5 ) {
                    // Convex hull for cleaner shape
                    vector<cv::Point> hull;
                    cv::convexHull( contour, hull );

                    // Simplify to reduce vertices
                    vector<cv::Point> approx;
                    double epsilon = 0.015 * cv::arcLength( hull, true );
                    cv::approxPolyDP( hull, approx, epsilon, true );
                    if ( approx.size() < 3 ) continue;

                    // Scale to window coords
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

            // Simple approach: destroy all old blocks, create new ones from current frame
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

    // ---- Step physics (runs even during calibration so balls fall) ----
    mWorld->Step( 1.0f / 60.0f, VELOCITY_ITERATIONS, POSITION_ITERATIONS );

    // ---- Remove off-screen balls ----
    removeOffscreenBalls();

    // ---- Continuously drop balls, one at a time, staggered ----
    mSpawnAccum += 1.0f;
    if ( (int)mBalls.size() < mBallCount && mSpawnAccum >= 20.0f ) {
        // Spawn at random x position along the top
        float rx = Rand::randFloat( 100.0f, getWindowWidth() - 100.0f );
        spawnBall( vec2( rx, -20.0f ) );
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

    // ---------------------------------------------------------------
    //  Calibration mode — show camera + instructions
    // ---------------------------------------------------------------
    if ( mCalibrationMode ) {
        gl::clear( Color::black() );

        if ( mCameraTexture ) {
            gl::draw( mCameraTexture, Rectf( 0, 0, winW, winH ) );
        }

        // Draw already-placed calibration points
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

        // Instructions
        gl::color( Color::white() );
        gl::drawString(
            "CALIBRATION: Click 4 corners (TL, TR, BR, BL).  "
            "Points placed: " + to_string( mCalibrationPoints.size() ) + "/4   [R] Reset",
            vec2( 20, 20 ),
            Color::white(),
            Font( "Arial", 18 )
        );

        // ImGui panel
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
        ImGui::SliderFloat( "Ball size", &mBallRadius, 5, 40 );
        ImGui::SliderFloat( "Air drag", &mBallDamping, 0, 2.0f );
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
                    // camera switched
                } catch ( ci::Exception& e ) {
                    CI_LOG_E( "Camera switch failed: " << e.what() );
                }
            }
        }
        ImGui::End();

        // Still draw balls during calibration (white ping-pong)
        for ( auto* ball : mBalls ) {
            vec2 pos = fromPhysics( ball->GetPosition() );
            gl::color( Color( 0.95f, 0.95f, 0.97f ) );
            gl::drawSolidCircle( pos, mBallRadius );
            gl::color( Color( 1.0f, 1.0f, 1.0f ) );
            gl::drawSolidCircle( pos + vec2( -mBallRadius * 0.25f, -mBallRadius * 0.25f ), mBallRadius * 0.35f );
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
    //  Trail FBO pass — accumulate ball positions with alpha fade
    // ---------------------------------------------------------------
    int prevFbo = 1 - mCurrentFbo;
    {
        gl::ScopedFramebuffer scopedFbo( mTrailFbo[mCurrentFbo] );
        gl::ScopedViewport    scopedVp( ivec2( 0 ), mTrailFbo[mCurrentFbo]->getSize() );
        gl::setMatricesWindow( mTrailFbo[mCurrentFbo]->getSize() );

        gl::clear( ColorA( 0, 0, 0, 0 ) );

        // Draw previous trail with slight fade
        gl::color( ColorA( 1, 1, 1, 0.92f ) );
        gl::draw( mTrailFbo[prevFbo]->getColorTexture(),
                  Rectf( 0, 0, winW, winH ) );

        // Draw balls into trail (white)
        gl::color( ColorA( 0.9f, 0.9f, 0.95f, 0.6f ) );
        for ( auto* ball : mBalls ) {
            vec2 pos = fromPhysics( ball->GetPosition() );
            gl::drawSolidCircle( pos, mBallRadius * 0.8f );
        }
    }
    mCurrentFbo = 1 - mCurrentFbo;

    // ---------------------------------------------------------------
    //  Main scene draw
    // ---------------------------------------------------------------
    gl::setMatricesWindow( getWindowSize() );
    gl::clear( Color::black() );

    // Live camera feed as background
    if ( mCameraTexture ) {
        gl::color( ColorA( 1, 1, 1, 0.6f ) );
        gl::draw( mCameraTexture, Rectf( 0, 0, winW, winH ) );
    }

    // Draw trail FBO
    gl::color( Color::white() );
    gl::draw( mTrailFbo[1 - mCurrentFbo]->getColorTexture(),
              Rectf( 0, 0, winW, winH ) );

    // Draw white ping-pong balls — clean, no glow
    for ( auto* ball : mBalls ) {
        vec2 pos = fromPhysics( ball->GetPosition() );

        // Solid white ball
        gl::color( Color( 0.95f, 0.95f, 0.97f ) );
        gl::drawSolidCircle( pos, mBallRadius );

        // Highlight spot
        gl::color( Color( 1.0f, 1.0f, 1.0f ) );
        gl::drawSolidCircle( pos + vec2( -mBallRadius * 0.25f, -mBallRadius * 0.25f ), mBallRadius * 0.3f );
    }

    // Contour outlines hidden — physics bodies still active invisibly

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

        // Stats overlay
        string stats = "Blocks: " + to_string( mBlocks.size() )
                     + "  Balls: " + to_string( mBalls.size() );
        gl::drawString( stats, vec2( debugRect.x1 + 4, debugRect.y2 + 4 ),
                        Color( 0.0f, 1.0f, 0.0f ), Font( "Arial", 13 ) );
    }

    // HUD
    gl::color( Color::white() );
    gl::drawString(
        "[D] Debug  [R] Recalibrate  [Space] Burst  [Esc] Quit",
        vec2( 20, winH - 30 ),
        Color( 0.6f, 0.6f, 0.6f ),
        Font( "Arial", 14 )
    );

    // ImGui panel
    ImGui::SetNextWindowSize( ImVec2( 350, 0 ), ImGuiCond_FirstUseEver );
    ImGui::Begin( "BlockBounce" );
    ImGui::SliderInt( "Edge low", &mCannyLow, 10, 200 );
    ImGui::SliderInt( "Edge high", &mCannyHigh, 50, 300 );
    ImGui::SliderInt( "Fill size", &mDilateSize, 5, 40 );
    ImGui::Separator();
    ImGui::SliderFloat( "Min area", &mMinContourArea, 500, 20000 );
    ImGui::Separator();
    ImGui::SliderFloat( "Gravity", &mGravityY, 1, 40 );
    ImGui::SliderFloat( "Bounce", &mBallRestitution, 0.5f, 1.0f );
    ImGui::SliderFloat( "Ball size", &mBallRadius, 5, 40 );
    ImGui::SliderFloat( "Air drag", &mBallDamping, 0, 2.0f );
    ImGui::Separator();
    ImGui::Checkbox( "Debug view", &mShowDebug );
    ImGui::Checkbox( "Calibration mode", &mCalibrationMode );
    ImGui::End();
}

// ===========================================================================
//  matchAndUpdateBlocks  —  spatial tracking with jitter prevention
// ===========================================================================
void BlockBounceApp::matchAndUpdateBlocks( const vector<cv::RotatedRect>& detections, const vector<vector<cv::Point>>& contourShapes )
{
    // Build a list of new centroids
    vector<vec2> newCentroids;
    newCentroids.reserve( detections.size() );
    for ( auto& rr : detections ) {
        newCentroids.push_back( vec2( rr.center.x, rr.center.y ) );
    }

    vector<bool> detectionUsed( detections.size(), false );
    vector<bool> blockMatched( mBlocks.size(), false );

    // Greedy nearest-match
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

    // Remove unmatched old blocks
    for ( int bi = (int)mBlocks.size() - 1; bi >= 0; --bi ) {
        if ( !blockMatched[bi] ) {
            removeBlockBody( mBlocks[bi] );
            mBlocks.erase( mBlocks.begin() + bi );
        }
    }

    // Add new detections
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
    bd.position.Set( 0, 0 );  // contour points are already in world coords
    block.body  = mWorld->CreateBody( &bd );

    // Convert contour points to Box2D coords
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
//  spawnBall — dynamic circle body
// ===========================================================================
b2Body* BlockBounceApp::spawnBall( vec2 pos )
{
    b2BodyDef bd;
    bd.type     = b2_dynamicBody;
    bd.position = toPhysics( pos );
    bd.bullet   = true;            // precise collision for fast-moving small ball
    bd.linearDamping  = mBallDamping;
    bd.angularDamping = 0.3f;

    b2Body* body = mWorld->CreateBody( &bd );

    b2CircleShape shape;
    shape.m_radius = mBallRadius / BOX2D_SCALE;

    b2FixtureDef fd;
    fd.shape       = &shape;
    fd.density     = mBallDensity;   // light like a ping-pong ball
    fd.friction    = 0.1f;           // low friction — slides off surfaces
    fd.restitution = mBallRestitution;
    body->CreateFixture( &fd );

    // Drop straight down
    body->SetLinearVelocity( b2Vec2( 0.0f, 5.0f ) );

    mBalls.push_back( body );
    return body;
}

// ===========================================================================
//  removeOffscreenBalls
// ===========================================================================
void BlockBounceApp::removeOffscreenBalls()
{
    float limitY = (float)getWindowHeight() + 100.0f;
    float limitX = (float)getWindowWidth()  + 100.0f;

    for ( auto it = mBalls.begin(); it != mBalls.end(); ) {
        vec2 pos = fromPhysics( (*it)->GetPosition() );
        if ( pos.y > limitY || pos.x < -100.0f || pos.x > limitX || pos.y < -200.0f ) {
            mWorld->DestroyBody( *it );
            it = mBalls.erase( it );
        }
        else {
            ++it;
        }
    }
}

// ===========================================================================
//  surfaceToMat — Cinder Surface8u → cv::Mat (BGR)
// ===========================================================================
cv::Mat BlockBounceApp::surfaceToMat( const Surface8uRef& surface )
{
    // Cinder Surface8u is typically RGB or RGBA, row-major
    int w = surface->getWidth();
    int h = surface->getHeight();

    cv::Mat mat( h, w, CV_8UC3 );

    auto iter = surface->getIter();
    int row = 0;
    while ( iter.line() ) {
        int col = 0;
        while ( iter.pixel() ) {
            mat.at<cv::Vec3b>( row, col ) = cv::Vec3b(
                iter.b(),   // OpenCV uses BGR
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
//  matToTexture — cv::Mat (BGR) → ci::gl::Texture2dRef
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
//  App entry point
// ===========================================================================
CINDER_APP( BlockBounceApp, RendererGl( RendererGl::Options().msaa( 4 ) ),
    []( App::Settings* settings ) {
        settings->setWindowSize( 1280, 720 );
        settings->setTitle( "BlockBounce" );
        settings->setFrameRate( 60.0f );
    }
)
