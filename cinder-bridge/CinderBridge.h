#pragma once

#include "cinder/osc/Osc.h"
#include "cinder/gl/gl.h"
#include "cinder/app/App.h"
#include "cinder/params/Params.h"
#include "cinder/Surface.h"
#include "cinder/ImageIo.h"
#include "cinder/Timeline.h"
#include "cinder/audio/audio.h"

#include <functional>
#include <map>
#include <string>
#include <mutex>
#include <queue>
#include <sstream>
#include <vector>
#include <fstream>

namespace cinderbridge {

// ---------------------------------------------------------------------------
// Variant type used for exposed variables
// ---------------------------------------------------------------------------
struct ExposedVar {
    enum Type { FLOAT, INT, BOOL, VEC2, VEC3, VEC4, STRING };
    Type  type;
    void* ptr;
};

// ---------------------------------------------------------------------------
// Uniform metadata discovered at runtime
// ---------------------------------------------------------------------------
struct UniformInfo {
    std::string name;
    GLenum      glType;
    GLint       location;
    GLint       size;
};

// ---------------------------------------------------------------------------
// Command queued from OSC thread -> main thread
// ---------------------------------------------------------------------------
struct QueuedCommand {
    std::string                                           name;
    ci::osc::Message                                      msg;
    std::function<std::string(const ci::osc::Message&)>   handler;
    std::string                                           commandId;
};

// ---------------------------------------------------------------------------
// CinderBridge
// ---------------------------------------------------------------------------
class CinderBridge {
public:
    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------
    CinderBridge(const std::string& appName, int port = 9090)
        : mAppName(appName)
        , mPort(port)
        , mReceiver(port)
        , mSender(port + 1, "127.0.0.1")
        , mClearColor(ci::ColorA(0, 0, 0, 1))
    {
        registerOscHandlers();
        try {
            mReceiver.bind();
            mReceiver.listen();
        } catch (const std::exception& e) {
            CI_LOG_E("CinderBridge receiver bind failed: " << e.what());
        }
        try {
            mSender.bind();
        } catch (...) {}
    }

    // -----------------------------------------------------------------------
    // Per-frame update — call from App::update()
    // -----------------------------------------------------------------------
    void update() {
        std::vector<QueuedCommand> cmds;
        {
            std::lock_guard<std::mutex> lock(mQueueMutex);
            cmds.swap(mCommandQueue);
        }
        for (auto& cmd : cmds) {
            std::string result;
            try {
                result = cmd.handler(cmd.msg);
                sendAck(cmd.commandId, "ok", result);
            } catch (const std::exception& ex) {
                sendAck(cmd.commandId, "error", ex.what());
            }
        }
    }

    // -----------------------------------------------------------------------
    // Expose API
    // -----------------------------------------------------------------------
    void expose(const std::string& name, float* v)       { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::FLOAT,  v}; }
    void expose(const std::string& name, int* v)         { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::INT,    v}; }
    void expose(const std::string& name, bool* v)        { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::BOOL,   v}; }
    void expose(const std::string& name, ci::vec2* v)    { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::VEC2,   v}; }
    void expose(const std::string& name, ci::vec3* v)    { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::VEC3,   v}; }
    void expose(const std::string& name, ci::vec4* v)    { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::VEC4,   v}; }
    void expose(const std::string& name, std::string* v) { std::lock_guard<std::mutex> l(mVarMutex); mVars[name] = {ExposedVar::STRING, v}; }

    // -----------------------------------------------------------------------
    // Custom command handler registration
    // -----------------------------------------------------------------------
    void onCommand(const std::string& name, std::function<std::string(const ci::osc::Message&)> callback) {
        std::lock_guard<std::mutex> lock(mHandlerMutex);
        mCustomHandlers[name] = callback;
        mReceiver.setListener("/" + name, [this, name](const ci::osc::Message& msg) {
            enqueue(name, msg, mCustomHandlers[name]);
        });
    }

    // -----------------------------------------------------------------------
    // Auto-discovery
    // -----------------------------------------------------------------------
    std::vector<UniformInfo> autoDiscoverUniforms() {
        std::lock_guard<std::mutex> lock(mUniformMutex);
        mUniforms.clear();

        GLint currentProgram = 0;
        glGetIntegerv(GL_CURRENT_PROGRAM, &currentProgram);
        if (currentProgram == 0) return mUniforms;

        GLint count = 0;
        glGetProgramiv(currentProgram, GL_ACTIVE_UNIFORMS, &count);

        for (GLint i = 0; i < count; ++i) {
            char nameBuf[256];
            GLsizei length = 0;
            GLint   size   = 0;
            GLenum  type   = 0;
            glGetActiveUniform(currentProgram, i, sizeof(nameBuf), &length, &size, &type, nameBuf);
            GLint loc = glGetUniformLocation(currentProgram, nameBuf);

            UniformInfo info;
            info.name     = std::string(nameBuf, length);
            info.glType   = type;
            info.location = loc;
            info.size     = size;
            mUniforms.push_back(info);
        }
        return mUniforms;
    }

    void autoDiscoverParams() {
        // Params are tracked through the expose() API.
        // This method is a placeholder for future ci::params scanning.
    }

    // -----------------------------------------------------------------------
    // Getters
    // -----------------------------------------------------------------------
    const std::string& appName()    const { return mAppName; }
    int                port()       const { return mPort; }
    ci::ColorA         clearColor() const { return mClearColor; }

    // Store params reference for get/set
    void registerParams(ci::params::InterfaceGlRef params) {
        mParams = params;
    }

private:
    // -----------------------------------------------------------------------
    // Ack sender
    // -----------------------------------------------------------------------
    void sendAck(const std::string& commandId, const std::string& status, const std::string& message) {
        ci::osc::Message ack;
        ack.setAddress("/ack");
        ack.append(commandId);
        ack.append(status);
        ack.append(message);
        try { mSender.send(ack); } catch (...) {}
    }

    // -----------------------------------------------------------------------
    // Queue a command for main-thread execution
    // -----------------------------------------------------------------------
    void enqueue(const std::string& name, const ci::osc::Message& msg,
                 std::function<std::string(const ci::osc::Message&)> handler)
    {
        std::string commandId = (msg.getNumArgs() > 0) ? msg.getArgString(0) : "";
        std::lock_guard<std::mutex> lock(mQueueMutex);
        mCommandQueue.push_back({name, msg, handler, commandId});
    }

    // -----------------------------------------------------------------------
    // Register all built-in OSC handlers
    // -----------------------------------------------------------------------
    void registerOscHandlers() {

        // -- /set_uniform [commandId, name, type, ...values] -----------------
        mReceiver.setListener("/set_uniform", [this](const ci::osc::Message& msg) {
            enqueue("set_uniform", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string uName = m.getArgString(1);
                std::string uType = m.getArgString(2);

                GLint currentProg = 0;
                glGetIntegerv(GL_CURRENT_PROGRAM, &currentProg);
                GLint loc = glGetUniformLocation(currentProg, uName.c_str());
                if (loc == -1) return "uniform not found: " + uName;

                if (uType == "float") {
                    glUniform1f(loc, m.getArgFloat(3));
                } else if (uType == "int") {
                    glUniform1i(loc, m.getArgInt32(3));
                } else if (uType == "vec2") {
                    glUniform2f(loc, m.getArgFloat(3), m.getArgFloat(4));
                } else if (uType == "vec3") {
                    glUniform3f(loc, m.getArgFloat(3), m.getArgFloat(4), m.getArgFloat(5));
                } else if (uType == "vec4") {
                    glUniform4f(loc, m.getArgFloat(3), m.getArgFloat(4), m.getArgFloat(5), m.getArgFloat(6));
                } else {
                    return "unknown type: " + uType;
                }
                return "set " + uName;
            });
        });

        // -- /get_uniforms [commandId] ---------------------------------------
        mReceiver.setListener("/get_uniforms", [this](const ci::osc::Message& msg) {
            enqueue("get_uniforms", msg, [this](const ci::osc::Message&) -> std::string {
                auto uniforms = autoDiscoverUniforms();
                std::ostringstream ss;
                ss << "[";
                for (size_t i = 0; i < uniforms.size(); ++i) {
                    if (i > 0) ss << ",";
                    ss << "{\"name\":\"" << uniforms[i].name
                       << "\",\"type\":" << uniforms[i].glType
                       << ",\"location\":" << uniforms[i].location
                       << ",\"size\":" << uniforms[i].size << "}";
                }
                ss << "]";
                return ss.str();
            });
        });

        // -- /set_param [commandId, name, value] -----------------------------
        mReceiver.setListener("/set_param", [this](const ci::osc::Message& msg) {
            enqueue("set_param", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string pName = m.getArgString(1);
                std::lock_guard<std::mutex> lock(mVarMutex);
                auto it = mVars.find(pName);
                if (it == mVars.end()) return "param not found: " + pName;
                auto& v = it->second;
                switch (v.type) {
                    case ExposedVar::FLOAT:  *static_cast<float*>(v.ptr)  = m.getArgFloat(2);  break;
                    case ExposedVar::INT:    *static_cast<int*>(v.ptr)    = m.getArgInt32(2);   break;
                    case ExposedVar::BOOL:   *static_cast<bool*>(v.ptr)   = (m.getArgInt32(2) != 0); break;
                    case ExposedVar::STRING: *static_cast<std::string*>(v.ptr) = m.getArgString(2); break;
                    default: return "unsupported type for set_param";
                }
                return "set " + pName;
            });
        });

        // -- /get_params [commandId] -----------------------------------------
        mReceiver.setListener("/get_params", [this](const ci::osc::Message& msg) {
            enqueue("get_params", msg, [this](const ci::osc::Message&) -> std::string {
                std::lock_guard<std::mutex> lock(mVarMutex);
                std::ostringstream ss;
                ss << "[";
                bool first = true;
                for (auto& kv : mVars) {
                    if (!first) ss << ",";
                    first = false;
                    ss << "{\"name\":\"" << kv.first << "\",\"type\":\"";
                    auto& v = kv.second;
                    switch (v.type) {
                        case ExposedVar::FLOAT:  ss << "float\",\"value\":" << *static_cast<float*>(v.ptr);  break;
                        case ExposedVar::INT:    ss << "int\",\"value\":" << *static_cast<int*>(v.ptr);      break;
                        case ExposedVar::BOOL:   ss << "bool\",\"value\":" << (*static_cast<bool*>(v.ptr) ? "true" : "false"); break;
                        case ExposedVar::STRING: ss << "string\",\"value\":\"" << *static_cast<std::string*>(v.ptr) << "\""; break;
                        default: ss << "unknown\",\"value\":null"; break;
                    }
                    ss << "}";
                }
                ss << "]";
                return ss.str();
            });
        });

        // -- /animate_param [commandId, name, targetValue, durationMs] -------
        mReceiver.setListener("/animate_param", [this](const ci::osc::Message& msg) {
            enqueue("animate_param", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string pName     = m.getArgString(1);
                float       target    = m.getArgFloat(2);
                float       durMs     = m.getArgFloat(3);
                float       durSec    = durMs / 1000.0f;

                std::lock_guard<std::mutex> lock(mVarMutex);
                auto it = mVars.find(pName);
                if (it == mVars.end()) return "param not found: " + pName;
                if (it->second.type != ExposedVar::FLOAT) return "animate only supports float params";

                float* ptr = static_cast<float*>(it->second.ptr);
                ci::app::timeline().apply(ptr, target, durSec, ci::EaseInOutQuad());
                return "animating " + pName;
            });
        });

        // -- /screenshot [commandId, filePath] -------------------------------
        mReceiver.setListener("/screenshot", [this](const ci::osc::Message& msg) {
            enqueue("screenshot", msg, [](const ci::osc::Message& m) -> std::string {
                std::string filePath = m.getArgString(1);
                auto surface = ci::app::copyWindowSurface();
                ci::writeImage(filePath, surface);
                return filePath;
            });
        });

        // -- /set_window_size [commandId, width, height] ---------------------
        mReceiver.setListener("/set_window_size", [this](const ci::osc::Message& msg) {
            enqueue("set_window_size", msg, [](const ci::osc::Message& m) -> std::string {
                int w = m.getArgInt32(1);
                int h = m.getArgInt32(2);
                ci::app::getWindow()->setSize(ci::ivec2(w, h));
                return "window resized to " + std::to_string(w) + "x" + std::to_string(h);
            });
        });

        // -- /toggle_fullscreen [commandId] ----------------------------------
        mReceiver.setListener("/toggle_fullscreen", [this](const ci::osc::Message& msg) {
            enqueue("toggle_fullscreen", msg, [](const ci::osc::Message&) -> std::string {
                bool fs = ci::app::getWindow()->isFullScreen();
                ci::app::getWindow()->setFullScreen(!fs);
                return fs ? "windowed" : "fullscreen";
            });
        });

        // -- /set_camera [commandId, eyeX..Z, targetX..Z, fov, near, far] ---
        mReceiver.setListener("/set_camera", [this](const ci::osc::Message& msg) {
            enqueue("set_camera", msg, [this](const ci::osc::Message& m) -> std::string {
                ci::vec3 eye(m.getArgFloat(1), m.getArgFloat(2), m.getArgFloat(3));
                ci::vec3 target(m.getArgFloat(4), m.getArgFloat(5), m.getArgFloat(6));
                float fov  = m.getArgFloat(7);
                float near = m.getArgFloat(8);
                float far  = m.getArgFloat(9);

                mCamera.lookAt(eye, target);
                mCamera.setPerspective(fov, ci::app::getWindowAspectRatio(), near, far);
                return "camera updated";
            });
        });

        // -- /set_clear_color [commandId, r, g, b, a] -----------------------
        mReceiver.setListener("/set_clear_color", [this](const ci::osc::Message& msg) {
            enqueue("set_clear_color", msg, [this](const ci::osc::Message& m) -> std::string {
                mClearColor = ci::ColorA(m.getArgFloat(1), m.getArgFloat(2), m.getArgFloat(3), m.getArgFloat(4));
                ci::gl::clear(mClearColor);
                return "clear color set";
            });
        });

        // -- /set_framerate [commandId, fps] ---------------------------------
        mReceiver.setListener("/set_framerate", [this](const ci::osc::Message& msg) {
            enqueue("set_framerate", msg, [](const ci::osc::Message& m) -> std::string {
                float fps = m.getArgFloat(1);
                ci::app::setFrameRate(fps);
                return "framerate set to " + std::to_string(fps);
            });
        });

        // -- /get_state [commandId] ------------------------------------------
        mReceiver.setListener("/get_state", [this](const ci::osc::Message& msg) {
            enqueue("get_state", msg, [this](const ci::osc::Message&) -> std::string {
                std::ostringstream ss;
                ss << "{\"app\":\"" << mAppName << "\""
                   << ",\"port\":" << mPort
                   << ",\"fps\":" << ci::app::getAverageFps()
                   << ",\"windowWidth\":" << ci::app::getWindowWidth()
                   << ",\"windowHeight\":" << ci::app::getWindowHeight()
                   << ",\"fullscreen\":" << (ci::app::isFullScreen() ? "true" : "false")
                   << ",\"clearColor\":[" << mClearColor.r << "," << mClearColor.g << "," << mClearColor.b << "," << mClearColor.a << "]"
                   << "}";
                return ss.str();
            });
        });

        // -- /hot_reload_shader [commandId, shaderName, vertPath, fragPath] --
        mReceiver.setListener("/hot_reload_shader", [this](const ci::osc::Message& msg) {
            enqueue("hot_reload_shader", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string name     = m.getArgString(1);
                std::string vertPath = m.getArgString(2);
                std::string fragPath = m.getArgString(3);

                try {
                    auto glsl = ci::gl::GlslProg::create(
                        ci::loadFile(vertPath),
                        ci::loadFile(fragPath)
                    );
                    std::lock_guard<std::mutex> lock(mShaderMutex);
                    mShaders[name] = glsl;
                    return "shader reloaded: " + name;
                } catch (const ci::gl::GlslProgCompileExc& ex) {
                    return std::string("compile error: ") + ex.what();
                }
            });
        });

        // -- /audio/set_gain [commandId, nodeName, gain] ---------------------
        mReceiver.setListener("/audio/set_gain", [this](const ci::osc::Message& msg) {
            enqueue("audio/set_gain", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string nodeName = m.getArgString(1);
                float gain = m.getArgFloat(2);
                std::lock_guard<std::mutex> lock(mAudioMutex);
                auto it = mAudioGainNodes.find(nodeName);
                if (it == mAudioGainNodes.end()) return "audio node not found: " + nodeName;
                it->second->setValue(gain);
                return "gain set on " + nodeName;
            });
        });

        // -- /audio/set_pan [commandId, nodeName, pan] -----------------------
        mReceiver.setListener("/audio/set_pan", [this](const ci::osc::Message& msg) {
            enqueue("audio/set_pan", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string nodeName = m.getArgString(1);
                float pan = m.getArgFloat(2);
                std::lock_guard<std::mutex> lock(mAudioMutex);
                auto it = mAudioPanNodes.find(nodeName);
                if (it == mAudioPanNodes.end()) return "pan node not found: " + nodeName;
                it->second->setPos(pan);
                return "pan set on " + nodeName;
            });
        });

        // -- /audio/play [commandId, nodeName] -------------------------------
        mReceiver.setListener("/audio/play", [this](const ci::osc::Message& msg) {
            enqueue("audio/play", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string nodeName = m.getArgString(1);
                std::lock_guard<std::mutex> lock(mAudioMutex);
                auto it = mAudioPlayerNodes.find(nodeName);
                if (it == mAudioPlayerNodes.end()) return "player not found: " + nodeName;
                it->second->start();
                return "playing " + nodeName;
            });
        });

        // -- /audio/stop [commandId, nodeName] -------------------------------
        mReceiver.setListener("/audio/stop", [this](const ci::osc::Message& msg) {
            enqueue("audio/stop", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string nodeName = m.getArgString(1);
                std::lock_guard<std::mutex> lock(mAudioMutex);
                auto it = mAudioPlayerNodes.find(nodeName);
                if (it == mAudioPlayerNodes.end()) return "player not found: " + nodeName;
                it->second->stop();
                return "stopped " + nodeName;
            });
        });

        // -- /audio/get_spectrum [commandId, nodeName] -----------------------
        mReceiver.setListener("/audio/get_spectrum", [this](const ci::osc::Message& msg) {
            enqueue("audio/get_spectrum", msg, [this](const ci::osc::Message& m) -> std::string {
                std::string nodeName = m.getArgString(1);
                std::lock_guard<std::mutex> lock(mAudioMutex);
                auto it = mAudioMonitorNodes.find(nodeName);
                if (it == mAudioMonitorNodes.end()) return "monitor node not found: " + nodeName;

                auto spectrum = it->second->getMagSpectrum();
                std::ostringstream ss;
                ss << "[";
                for (size_t i = 0; i < spectrum.size(); ++i) {
                    if (i > 0) ss << ",";
                    ss << spectrum[i];
                }
                ss << "]";
                return ss.str();
            });
        });
    }

    // -----------------------------------------------------------------------
    // Audio node registration (call from app setup)
    // -----------------------------------------------------------------------
public:
    void registerGainNode(const std::string& name, ci::audio::GainNodeRef node) {
        std::lock_guard<std::mutex> lock(mAudioMutex);
        mAudioGainNodes[name] = node;
    }
    void registerPanNode(const std::string& name, ci::audio::Pan2dNodeRef node) {
        std::lock_guard<std::mutex> lock(mAudioMutex);
        mAudioPanNodes[name] = node;
    }
    void registerPlayerNode(const std::string& name, ci::audio::SamplePlayerNodeRef node) {
        std::lock_guard<std::mutex> lock(mAudioMutex);
        mAudioPlayerNodes[name] = node;
    }
    void registerMonitorNode(const std::string& name, ci::audio::MonitorSpectralNodeRef node) {
        std::lock_guard<std::mutex> lock(mAudioMutex);
        mAudioMonitorNodes[name] = node;
    }

    ci::gl::GlslProgRef getShader(const std::string& name) {
        std::lock_guard<std::mutex> lock(mShaderMutex);
        auto it = mShaders.find(name);
        return (it != mShaders.end()) ? it->second : nullptr;
    }

    ci::CameraPersp& camera() { return mCamera; }

private:
    // Identity
    std::string mAppName;
    int         mPort;

    // OSC
    ci::osc::ReceiverTcp mReceiver;
    ci::osc::SenderTcp   mSender;

    // Command queue (OSC thread -> main thread)
    std::mutex                  mQueueMutex;
    std::vector<QueuedCommand>  mCommandQueue;

    // Exposed variables
    std::mutex                              mVarMutex;
    std::map<std::string, ExposedVar>       mVars;

    // Custom handlers
    std::mutex                                                                      mHandlerMutex;
    std::map<std::string, std::function<std::string(const ci::osc::Message&)>>      mCustomHandlers;

    // Uniforms
    std::mutex                   mUniformMutex;
    std::vector<UniformInfo>     mUniforms;

    // Shaders
    std::mutex                                          mShaderMutex;
    std::map<std::string, ci::gl::GlslProgRef>          mShaders;

    // Audio nodes
    std::mutex                                                      mAudioMutex;
    std::map<std::string, ci::audio::GainNodeRef>                   mAudioGainNodes;
    std::map<std::string, ci::audio::Pan2dNodeRef>                  mAudioPanNodes;
    std::map<std::string, ci::audio::SamplePlayerNodeRef>           mAudioPlayerNodes;
    std::map<std::string, ci::audio::MonitorSpectralNodeRef>        mAudioMonitorNodes;

    // Render state
    ci::CameraPersp mCamera;
    ci::ColorA      mClearColor;

    // Params UI
    ci::params::InterfaceGlRef mParams;
};

} // namespace cinderbridge
