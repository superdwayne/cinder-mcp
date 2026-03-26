---
title: "Geometry — Primitives & Modifiers"
category: "Geometry"
namespace: "cinder::geom"
tags: [geometry, mesh, primitives, modifiers, trimesh, procedural]
---

# Geometry — Primitives & Modifiers

Cinder's `ci::geom` namespace provides composable geometry sources and modifiers for procedural mesh generation.

## Primitives

Built-in geometry sources implement `geom::Source`:

- **Sphere** — UV sphere with `radius()` and `subdivisions()`
- **Cube** — Axis-aligned box with `size()`
- **Torus** — Ring shape with `radius()`, `ratio()`, and subdivision controls
- **Cylinder** / **Cone** — With `height()`, `radius()`, `direction()`
- **Plane** — Flat quad with `size()` and `subdivisions()`
- **Circle** — Flat disc with `radius()` and `subdivisions()`
- **Icosahedron** — 20-face polyhedron, good base for subdivision
- **Capsule** — Cylinder with hemisphere caps
- **Helix** — Spiral geometry
- **WireCube** / **WireSphere** / **WireCircle** — Wireframe variants

## Modifiers

Modifiers transform geometry sources inline via the `>>` operator:

- **Twist(angle, axis)** — Twists geometry along an axis
- **Translate(vec3)** — Offsets all vertices
- **Scale(vec3)** — Scales geometry
- **Rotate(float, vec3)** — Rotates around an axis
- **ColorFromAttrib(attrib)** — Maps an attribute to vertex color
- **Invert()** — Flips winding order (inverts normals)
- **AttribFn** — Custom per-vertex attribute modifier via lambda

## TriMesh

`ci::TriMesh` is a CPU-side mesh container for manual vertex/index construction. Convert to VboMesh for GPU rendering.

## Code Examples

### Procedural Geometry with Modifiers

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class GeomApp : public App {
public:
    gl::BatchRef mTorusBatch;
    gl::BatchRef mSphereBatch;
    gl::BatchRef mPlaneBatch;

    void setup() override {
        auto lambert = gl::ShaderDef().lambert().color();
        auto shader = gl::getStockShader(lambert);

        // Torus with twist modifier
        mTorusBatch = gl::Batch::create(
            geom::Torus().radius(1.5f, 0.4f)
                .subdivisionsAxis(64).subdivisionsHeight(32)
                >> geom::Twist(2.0f * M_PI)
                >> geom::ColorFromAttrib(geom::Attrib::NORMAL),
            shader
        );

        // Sphere with scale
        mSphereBatch = gl::Batch::create(
            geom::Sphere().radius(1.0f).subdivisions(48)
                >> geom::Scale(vec3(1.0f, 1.5f, 1.0f)),
            shader
        );

        // Subdivided plane
        mPlaneBatch = gl::Batch::create(
            geom::Plane().size(vec2(4)).subdivisions(ivec2(20))
                >> geom::Translate(vec3(0, -2, 0)),
            shader
        );

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void draw() override {
        gl::clear(Color(0.15f, 0.15f, 0.18f));
        gl::setMatricesWindowPersp(getWindowSize(), 60.0f, 0.1f, 100.0f);
        gl::translate(getWindowCenter().x, getWindowCenter().y, -8.0f);

        float t = getElapsedSeconds();
        gl::rotate(t * 0.5f, vec3(0, 1, 0));

        mTorusBatch->draw();
        mSphereBatch->draw();
        mPlaneBatch->draw();
    }
};

CINDER_APP(GeomApp, RendererGl)
```

### Custom TriMesh with Normals

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/TriMesh.h"

using namespace ci;
using namespace ci::app;

class TriMeshApp : public App {
public:
    gl::BatchRef mBatch;

    void setup() override {
        // Build a custom triangle mesh (pyramid)
        TriMesh mesh(
            TriMesh::Format()
                .positions()
                .normals()
                .colors(4)
        );

        vec3 top(0, 1, 0);
        vec3 fl(-1, -1,  1);
        vec3 fr( 1, -1,  1);
        vec3 br( 1, -1, -1);
        vec3 bl(-1, -1, -1);

        auto addFace = [&](vec3 a, vec3 b, vec3 c, ColorA col) {
            vec3 normal = normalize(cross(b - a, c - a));
            uint32_t idx = mesh.getNumVertices();
            mesh.appendPosition(a);
            mesh.appendPosition(b);
            mesh.appendPosition(c);
            mesh.appendNormal(normal);
            mesh.appendNormal(normal);
            mesh.appendNormal(normal);
            mesh.appendColorRgba(col);
            mesh.appendColorRgba(col);
            mesh.appendColorRgba(col);
            mesh.appendTriangle(idx, idx + 1, idx + 2);
        };

        addFace(top, fl, fr, ColorA(1, 0, 0, 1));   // front
        addFace(top, fr, br, ColorA(0, 1, 0, 1));   // right
        addFace(top, br, bl, ColorA(0, 0, 1, 1));   // back
        addFace(top, bl, fl, ColorA(1, 1, 0, 1));   // left

        auto shader = gl::getStockShader(gl::ShaderDef().lambert().color());
        mBatch = gl::Batch::create(mesh, shader);

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void draw() override {
        gl::clear(Color::black());
        gl::setMatricesWindowPersp(getWindowSize());
        gl::translate(getWindowCenter());
        gl::scale(vec3(100));
        gl::rotate(getElapsedSeconds(), vec3(0, 1, 0));
        mBatch->draw();
    }
};

CINDER_APP(TriMeshApp, RendererGl)
```

### Composing geom::Source with the >> Operator

```cpp
#include "cinder/app/App.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

class ComposeApp : public App {
public:
    gl::BatchRef mBatch;

    void setup() override {
        // Chain multiple modifiers using >> operator
        auto source = geom::Icosahedron()
            >> geom::Scale(vec3(2.0f))
            >> geom::Rotate(glm::radians(45.0f), vec3(1, 0, 0))
            >> geom::Translate(vec3(0, 0, -5))
            >> geom::ColorFromAttrib(geom::Attrib::POSITION);

        auto shader = gl::getStockShader(gl::ShaderDef().lambert().color());
        mBatch = gl::Batch::create(source, shader);

        gl::enableDepthRead();
        gl::enableDepthWrite();
    }

    void draw() override {
        gl::clear(Color(0.1f, 0.1f, 0.12f));
        gl::setMatricesWindowPersp(getWindowSize(), 60.0f, 0.1f, 50.0f);
        gl::translate(getWindowCenter());
        gl::rotate(getElapsedSeconds() * 0.3f, vec3(0, 1, 0));
        mBatch->draw();
    }
};

CINDER_APP(ComposeApp, RendererGl)
```
