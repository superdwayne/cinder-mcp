---
title: "GL Setup — VBO, VAO & Texture Patterns"
category: "OpenGL"
namespace: "cinder::gl"
tags: [vbo, vao, texture, mesh, gpu, setup]
---

# GL Setup — VBO, VAO & Texture Patterns

Core patterns for creating and managing GPU resources in Cinder: Vertex Buffer Objects, Vertex Array Objects, textures, and BatchRef with custom meshes.

## VBO & VboMesh

`ci::gl::Vbo` is a raw GPU buffer. `ci::gl::VboMesh` wraps one or more VBOs with an attribute layout describing positions, normals, tex coords, and colors. `ci::gl::Vao` captures the attribute pointer state so it can be rebound efficiently.

## Texture2d

`ci::gl::Texture2d` wraps an OpenGL 2D texture. Create from a `Surface`, image file, or raw data. Use `Texture2d::Format` to control wrap modes, filtering, mipmapping, and internal format.

## BatchRef

`ci::gl::Batch` pairs a `VboMesh` (or `geom::Source`) with a `GlslProg` for efficient single-call rendering. Use `Batch::create()` with either a geom source or a pre-built VboMesh.

## Code Examples

### Custom VBO Mesh with Positions, Normals, and TexCoords

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class CustomMeshApp : public App {
public:
    gl::VboMeshRef mMesh;
    gl::BatchRef   mBatch;
    gl::GlslProgRef mGlsl;

    void setup() override {
        // Define vertex data
        std::vector<vec3> positions = {
            vec3(-1, -1, 0), vec3(1, -1, 0),
            vec3(1,  1, 0),  vec3(-1, 1, 0)
        };
        std::vector<vec3> normals(4, vec3(0, 0, 1));
        std::vector<vec2> texCoords = {
            vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)
        };
        std::vector<uint16_t> indices = { 0, 1, 2, 0, 2, 3 };

        // Create layout
        auto layout = gl::VboMesh::Layout()
            .usage(GL_STATIC_DRAW)
            .attrib(geom::Attrib::POSITION, 3)
            .attrib(geom::Attrib::NORMAL, 3)
            .attrib(geom::Attrib::TEX_COORD_0, 2);

        mMesh = gl::VboMesh::create(
            positions.size(), GL_TRIANGLES,
            { layout }, indices.size(), GL_UNSIGNED_SHORT
        );

        mMesh->bufferAttrib(geom::Attrib::POSITION, positions);
        mMesh->bufferAttrib(geom::Attrib::NORMAL, normals);
        mMesh->bufferAttrib(geom::Attrib::TEX_COORD_0, texCoords);
        mMesh->bufferIndices(indices.size(), indices.data());

        mGlsl = gl::getStockShader(gl::ShaderDef().texture().lambert());
        mBatch = gl::Batch::create(mMesh, mGlsl);
    }

    void draw() override {
        gl::clear(Color::black());
        gl::setMatricesWindowPersp(getWindowSize());
        gl::translate(getWindowCenter());
        gl::scale(vec3(100));
        mBatch->draw();
    }
};

CINDER_APP(CustomMeshApp, RendererGl)
```

### Texture Loading with Mipmaps and Format Options

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/ImageIo.h"

using namespace ci;
using namespace ci::app;

class TextureApp : public App {
public:
    gl::Texture2dRef mTexture;

    void setup() override {
        auto fmt = gl::Texture2d::Format()
            .mipmap(true)
            .minFilter(GL_LINEAR_MIPMAP_LINEAR)
            .magFilter(GL_LINEAR)
            .wrap(GL_REPEAT, GL_REPEAT)
            .maxAnisotropy(gl::Texture2d::getMaxAnisotropyMax())
            .internalFormat(GL_RGBA8);

        mTexture = gl::Texture2d::create(
            loadImage(loadAsset("texture.png")), fmt
        );
    }

    void draw() override {
        gl::clear(Color(0.1f, 0.1f, 0.1f));
        gl::draw(mTexture, getWindowBounds());
    }
};

CINDER_APP(TextureApp, RendererGl)
```

### Multi-Texture Setup with Custom Shader

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/ImageIo.h"

using namespace ci;
using namespace ci::app;

class MultiTexApp : public App {
public:
    gl::Texture2dRef mDiffuseTex;
    gl::Texture2dRef mNormalTex;
    gl::GlslProgRef  mGlsl;
    gl::BatchRef     mBatch;

    void setup() override {
        auto fmt = gl::Texture2d::Format().mipmap(true)
            .minFilter(GL_LINEAR_MIPMAP_LINEAR);

        mDiffuseTex = gl::Texture2d::create(
            loadImage(loadAsset("diffuse.png")), fmt
        );
        mNormalTex = gl::Texture2d::create(
            loadImage(loadAsset("normal.png")), fmt
        );

        mGlsl = gl::GlslProg::create(
            loadAsset("shader.vert"), loadAsset("shader.frag")
        );

        mGlsl->uniform("uDiffuseMap", 0);
        mGlsl->uniform("uNormalMap", 1);

        mBatch = gl::Batch::create(geom::Sphere().subdivisions(64), mGlsl);
    }

    void draw() override {
        gl::clear(Color::black());
        gl::setMatricesWindowPersp(getWindowSize());

        mDiffuseTex->bind(0);
        mNormalTex->bind(1);

        gl::pushModelMatrix();
        gl::translate(getWindowCenter());
        gl::scale(vec3(150));
        mBatch->draw();
        gl::popModelMatrix();

        mNormalTex->unbind(1);
        mDiffuseTex->unbind(0);
    }
};

CINDER_APP(MultiTexApp, RendererGl)
```
