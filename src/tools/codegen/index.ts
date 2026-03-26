/**
 * Cinder MCP – Code Generation Tools (US-006 through US-010)
 *
 * Eight tools that emit idiomatic Cinder 0.9.x C++ code.
 * Every tool returns complete, compilable snippets wrapped in markdown
 * code fences so the LLM can present them cleanly.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ShaderTypeEnum = z.enum([
  "basic",
  "phong",
  "wireframe",
  "particle",
  "postprocess",
  "custom",
]);

const BatchGeometryEnum = z.enum([
  "sphere",
  "cube",
  "torus",
  "plane",
  "circle",
  "custom",
]);

const BatchShaderEnum = z.enum([
  "basic",
  "phong",
  "wireframe",
  "particle",
  "postprocess",
]);

const FboFormatEnum = z.enum(["RGBA8", "RGBA16F", "RGBA32F"]);

const AudioNodeTypeEnum = z.enum([
  "FilePlayerNode",
  "BufferPlayerNode",
  "GenSineNode",
  "GenNoiseNode",
  "GainNode",
  "PanNode",
  "MonitorNode",
  "MonitorSpectralNode",
]);

const AudioFeatureEnum = z.enum([
  "amplitude",
  "frequency_bands",
  "spectral_centroid",
]);

const EmitterTypeEnum = z.enum(["point", "line", "circle", "sphere"]);

const ForceEnum = z.enum(["gravity", "wind", "turbulence", "attract"]);

const RenderModeEnum = z.enum(["points", "billboards", "trails"]);

const ParamControlTypeEnum = z.enum([
  "slider_float",
  "slider_int",
  "checkbox",
  "color",
  "direction",
  "button",
  "separator",
]);

const UniformTypeEnum = z.enum([
  "float",
  "int",
  "vec2",
  "vec3",
  "vec4",
  "bool",
  "color",
]);

// Composite schemas
const CustomUniformSchema = z.object({
  name: z.string(),
  type: z.string(),
});

const AudioNodeSchema = z.object({
  type: AudioNodeTypeEnum,
  name: z.string(),
});

const AudioConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
});

const VisualParamSchema = z.object({
  name: z.string(),
  type: z.string(),
  min: z.number(),
  max: z.number(),
});

const ParamControlSchema = z.object({
  name: z.string(),
  type: ParamControlTypeEnum,
  default_value: z.union([z.string(), z.number(), z.boolean()]),
  min: z.number().optional(),
  max: z.number().optional(),
});

const UniformSchema = z.object({
  name: z.string(),
  type: UniformTypeEnum,
  min: z.number().optional(),
  max: z.number().optional(),
});

// Tool-level input schemas
const GenerateShaderSchema = z.object({
  type: ShaderTypeEnum,
  name: z.string().min(1),
  custom_uniforms: z.array(CustomUniformSchema).optional(),
});

const GenerateBatchSchema = z.object({
  geometry: BatchGeometryEnum,
  shader_type: BatchShaderEnum,
  name: z.string().min(1),
});

const GenerateFboPipelineSchema = z.object({
  passes: z.number().int().min(1).max(8),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  format: FboFormatEnum,
  ping_pong: z.boolean(),
});

const GenerateAudioGraphSchema = z.object({
  nodes: z.array(AudioNodeSchema).min(1),
  connections: z.array(AudioConnectionSchema).min(1),
});

const GenerateAudioReactiveSchema = z.object({
  audio_features: z.array(AudioFeatureEnum).min(1),
  visual_params: z.array(VisualParamSchema).min(1),
  smoothing: z.number().min(0).max(1),
});

const GenerateParticleSystemSchema = z.object({
  max_particles: z.number().int().min(1),
  emitter_type: EmitterTypeEnum,
  forces: z.array(ForceEnum),
  render_mode: RenderModeEnum,
  instanced: z.boolean(),
});

const GenerateParamsUiSchema = z.object({
  panel_name: z.string().min(1),
  controls: z.array(ParamControlSchema).min(1),
});

const GenerateParamsFromUniformsSchema = z.object({
  uniforms: z.array(UniformSchema).min(1),
});

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDefinition[] = [
  {
    name: "generate_shader",
    description:
      "Generate a Cinder-compatible GLSL 150 vertex + fragment shader pair. Supports basic, phong, wireframe, particle, postprocess, and custom shader types.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["basic", "phong", "wireframe", "particle", "postprocess", "custom"],
          description: "Shader type to generate",
        },
        name: { type: "string", description: "Name for the shader" },
        custom_uniforms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
            },
            required: ["name", "type"],
          },
          description: "Custom uniforms (only used with 'custom' type)",
        },
      },
      required: ["type", "name"],
    },
  },
  {
    name: "generate_batch",
    description:
      "Generate C++ code for creating a ci::gl::BatchRef with inline GLSL shaders and Cinder geometry primitives.",
    inputSchema: {
      type: "object" as const,
      properties: {
        geometry: {
          type: "string",
          enum: ["sphere", "cube", "torus", "plane", "circle", "custom"],
          description: "Geometry type",
        },
        shader_type: {
          type: "string",
          enum: ["basic", "phong", "wireframe", "particle", "postprocess"],
          description: "Shader type for the batch",
        },
        name: { type: "string", description: "Variable name for the batch" },
      },
      required: ["geometry", "shader_type", "name"],
    },
  },
  {
    name: "generate_fbo_pipeline",
    description:
      "Generate a multi-pass FBO render pipeline with optional ping-pong buffering for Cinder 0.9.x.",
    inputSchema: {
      type: "object" as const,
      properties: {
        passes: { type: "number", description: "Number of render passes (1-8)" },
        width: { type: "number", description: "FBO width in pixels" },
        height: { type: "number", description: "FBO height in pixels" },
        format: {
          type: "string",
          enum: ["RGBA8", "RGBA16F", "RGBA32F"],
          description: "Color buffer format",
        },
        ping_pong: {
          type: "boolean",
          description: "Use ping-pong FBO swapping between passes",
        },
      },
      required: ["passes", "width", "height", "format", "ping_pong"],
    },
  },
  {
    name: "generate_audio_graph",
    description:
      "Generate Cinder audio graph setup code with node creation and connections using the >> operator.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "FilePlayerNode",
                  "BufferPlayerNode",
                  "GenSineNode",
                  "GenNoiseNode",
                  "GainNode",
                  "PanNode",
                  "MonitorNode",
                  "MonitorSpectralNode",
                ],
              },
              name: { type: "string" },
            },
            required: ["type", "name"],
          },
          description: "Audio nodes to create",
        },
        connections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
            },
            required: ["from", "to"],
          },
          description: "Connections between nodes (from >> to)",
        },
      },
      required: ["nodes", "connections"],
    },
  },
  {
    name: "generate_audio_reactive",
    description:
      "Generate code that maps audio analysis features (amplitude, frequency bands, spectral centroid) to visual parameters with smoothing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        audio_features: {
          type: "array",
          items: {
            type: "string",
            enum: ["amplitude", "frequency_bands", "spectral_centroid"],
          },
          description: "Audio features to extract",
        },
        visual_params: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              min: { type: "number" },
              max: { type: "number" },
            },
            required: ["name", "type", "min", "max"],
          },
          description: "Visual parameters driven by audio",
        },
        smoothing: {
          type: "number",
          description: "Smoothing factor (0-1, higher = smoother)",
        },
      },
      required: ["audio_features", "visual_params", "smoothing"],
    },
  },
  {
    name: "generate_particle_system",
    description:
      "Generate a complete particle system class with emitter, forces, aging, and configurable rendering (points, billboards, or trails). Optionally uses GPU instancing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        max_particles: { type: "number", description: "Maximum particle count" },
        emitter_type: {
          type: "string",
          enum: ["point", "line", "circle", "sphere"],
          description: "Emitter shape",
        },
        forces: {
          type: "array",
          items: {
            type: "string",
            enum: ["gravity", "wind", "turbulence", "attract"],
          },
          description: "Forces to apply each frame",
        },
        render_mode: {
          type: "string",
          enum: ["points", "billboards", "trails"],
          description: "How particles are rendered",
        },
        instanced: {
          type: "boolean",
          description: "Use GPU instancing via VboMesh",
        },
      },
      required: [
        "max_particles",
        "emitter_type",
        "forces",
        "render_mode",
        "instanced",
      ],
    },
  },
  {
    name: "generate_params_ui",
    description:
      "Generate a Cinder params::InterfaceGl panel with typed controls (sliders, checkboxes, color pickers, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        panel_name: { type: "string", description: "Title of the params panel" },
        controls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "slider_float",
                  "slider_int",
                  "checkbox",
                  "color",
                  "direction",
                  "button",
                  "separator",
                ],
              },
              default_value: {},
              min: { type: "number" },
              max: { type: "number" },
            },
            required: ["name", "type", "default_value"],
          },
          description: "Controls to add to the panel",
        },
      },
      required: ["panel_name", "controls"],
    },
  },
  {
    name: "generate_params_from_uniforms",
    description:
      "Auto-generate a params::InterfaceGl panel AND uniform-setting code from a list of shader uniforms.",
    inputSchema: {
      type: "object" as const,
      properties: {
        uniforms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: {
                type: "string",
                enum: ["float", "int", "vec2", "vec3", "vec4", "bool", "color"],
              },
              min: { type: "number" },
              max: { type: "number" },
            },
            required: ["name", "type"],
          },
          description: "Shader uniforms to expose as params",
        },
      },
      required: ["uniforms"],
    },
  },
];

// ---------------------------------------------------------------------------
// Shader generation helpers
// ---------------------------------------------------------------------------

const CINDER_COMMON_VERT_UNIFORMS = `uniform mat4 ciModelViewProjection;
uniform mat4 ciModelView;
uniform mat3 ciNormalMatrix;`;

function shaderBasic(name: string) {
  const vert = `// ${name} – basic vertex shader
#version 150

${CINDER_COMMON_VERT_UNIFORMS}

in vec4 ciPosition;
in vec3 ciNormal;

out vec3 vNormal;

void main() {
    vNormal = ciNormalMatrix * ciNormal;
    gl_Position = ciModelViewProjection * ciPosition;
}`;

  const frag = `// ${name} – basic fragment shader
#version 150

uniform vec4 uColor;

in vec3 vNormal;
out vec4 oColor;

void main() {
    vec3 normal = normalize(vNormal);
    float lighting = max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.15);
    oColor = vec4(uColor.rgb * lighting, uColor.a);
}`;

  return { vert, frag };
}

function shaderPhong(name: string) {
  const vert = `// ${name} – Blinn-Phong vertex shader
#version 150

${CINDER_COMMON_VERT_UNIFORMS}

in vec4 ciPosition;
in vec3 ciNormal;

out vec3 vNormal;
out vec3 vPosition;

void main() {
    vPosition = (ciModelView * ciPosition).xyz;
    vNormal = ciNormalMatrix * ciNormal;
    gl_Position = ciModelViewProjection * ciPosition;
}`;

  const frag = `// ${name} – Blinn-Phong fragment shader
#version 150

uniform vec4 uDiffuse;
uniform vec4 uSpecular;
uniform vec4 uAmbient;
uniform vec3 uLightPos;
uniform float uShininess;

in vec3 vNormal;
in vec3 vPosition;
out vec4 oColor;

void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vPosition);
    vec3 V = normalize(-vPosition);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), uShininess);

    vec4 color = uAmbient + uDiffuse * diff + uSpecular * spec;
    oColor = vec4(color.rgb, uDiffuse.a);
}`;

  return { vert, frag };
}

function shaderWireframe(name: string) {
  const vert = `// ${name} – wireframe vertex shader
#version 150

${CINDER_COMMON_VERT_UNIFORMS}

in vec4 ciPosition;
in vec3 ciNormal;

out vec3 vNormal;

void main() {
    vNormal = ciNormalMatrix * ciNormal;
    gl_Position = ciModelViewProjection * ciPosition;
}`;

  const geom = `// ${name} – wireframe geometry shader
#version 150

layout(triangles) in;
layout(triangle_strip, max_vertices = 3) out;

in vec3 vNormal[];
out vec3 gNormal;
out vec3 gBarycentric;

void main() {
    for (int i = 0; i < 3; i++) {
        gBarycentric = vec3(0.0);
        gBarycentric[i] = 1.0;
        gNormal = vNormal[i];
        gl_Position = gl_in[i].gl_Position;
        EmitVertex();
    }
    EndPrimitive();
}`;

  const frag = `// ${name} – wireframe fragment shader
#version 150

uniform vec4 uLineColor;
uniform vec4 uFillColor;
uniform float uLineWidth;

in vec3 gNormal;
in vec3 gBarycentric;
out vec4 oColor;

void main() {
    vec3 d = fwidth(gBarycentric);
    vec3 a3 = smoothstep(vec3(0.0), d * uLineWidth, gBarycentric);
    float edge = min(min(a3.x, a3.y), a3.z);
    oColor = mix(uLineColor, uFillColor, edge);
}`;

  return { vert, frag, geom };
}

function shaderParticle(name: string) {
  const vert = `// ${name} – particle vertex shader
#version 150

${CINDER_COMMON_VERT_UNIFORMS}

in vec4 ciPosition;
in vec4 ciColor;

uniform float uPointSize;

out vec4 vColor;

void main() {
    vColor = ciColor;
    vec4 viewPos = ciModelView * ciPosition;
    gl_PointSize = uPointSize / -viewPos.z;
    gl_Position = ciModelViewProjection * ciPosition;
}`;

  const frag = `// ${name} – particle fragment shader
#version 150

in vec4 vColor;
out vec4 oColor;

void main() {
    // circular point sprite
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;
    float alpha = 1.0 - smoothstep(0.5, 1.0, dist);
    oColor = vec4(vColor.rgb, vColor.a * alpha);
}`;

  return { vert, frag };
}

function shaderPostprocess(name: string) {
  const vert = `// ${name} – postprocess vertex shader
#version 150

${CINDER_COMMON_VERT_UNIFORMS}

in vec4 ciPosition;
in vec2 ciTexCoord0;

out vec2 vTexCoord;

void main() {
    vTexCoord = ciTexCoord0;
    gl_Position = ciModelViewProjection * ciPosition;
}`;

  const frag = `// ${name} – postprocess fragment shader
#version 150

uniform sampler2D uTexture;
uniform vec2 uResolution;

in vec2 vTexCoord;
out vec4 oColor;

void main() {
    vec4 color = texture(uTexture, vTexCoord);
    // --- insert postprocess effect here ---
    oColor = color;
}`;

  return { vert, frag };
}

function shaderCustom(
  name: string,
  customUniforms: Array<{ name: string; type: string }>,
) {
  const uniformLines = customUniforms
    .map((u) => `uniform ${u.type} ${u.name};`)
    .join("\n");

  const vert = `// ${name} – custom vertex shader
#version 150

${CINDER_COMMON_VERT_UNIFORMS}
${uniformLines}

in vec4 ciPosition;
in vec3 ciNormal;
in vec2 ciTexCoord0;

out vec3 vNormal;
out vec2 vTexCoord;

void main() {
    vNormal = ciNormalMatrix * ciNormal;
    vTexCoord = ciTexCoord0;
    gl_Position = ciModelViewProjection * ciPosition;
}`;

  const frag = `// ${name} – custom fragment shader
#version 150

${uniformLines}

in vec3 vNormal;
in vec2 vTexCoord;
out vec4 oColor;

void main() {
    oColor = vec4(1.0);
}`;

  return { vert, frag };
}

// ---------------------------------------------------------------------------
// Tool 1: generate_shader
// ---------------------------------------------------------------------------

function generateShader(args: z.infer<typeof GenerateShaderSchema>): string {
  const { type, name, custom_uniforms } = args;

  let shaders: { vert: string; frag: string; geom?: string };

  switch (type) {
    case "basic":
      shaders = shaderBasic(name);
      break;
    case "phong":
      shaders = shaderPhong(name);
      break;
    case "wireframe":
      shaders = shaderWireframe(name);
      break;
    case "particle":
      shaders = shaderParticle(name);
      break;
    case "postprocess":
      shaders = shaderPostprocess(name);
      break;
    case "custom":
      shaders = shaderCustom(name, (custom_uniforms ?? []) as Array<{ name: string; type: string }>);
      break;
  }

  let output = `### Vertex Shader – \`${name}\`\n\n\`\`\`glsl\n${shaders.vert}\n\`\`\`\n\n`;
  if (shaders.geom) {
    output += `### Geometry Shader – \`${name}\`\n\n\`\`\`glsl\n${shaders.geom}\n\`\`\`\n\n`;
  }
  output += `### Fragment Shader – \`${name}\`\n\n\`\`\`glsl\n${shaders.frag}\n\`\`\``;

  return output;
}

// ---------------------------------------------------------------------------
// Tool 2: generate_batch
// ---------------------------------------------------------------------------

function geomConstructor(geometry: string): string {
  switch (geometry) {
    case "sphere":
      return "geom::Sphere()";
    case "cube":
      return "geom::Cube()";
    case "torus":
      return "geom::Torus().radius(1.0f, 0.3f)";
    case "plane":
      return "geom::Plane()";
    case "circle":
      return "geom::Circle()";
    case "custom":
      return "/* your custom VboMesh here */";
    default:
      return "geom::Sphere()";
  }
}

function inlineGlsl(code: string): string {
  // Strip the #version line and shader comment for CI_GLSL embedding
  const lines = code.split("\n").filter(
    (l) => !l.startsWith("#version") && !l.startsWith("//"),
  );
  return lines.join("\n").trim();
}

function generateBatch(args: z.infer<typeof GenerateBatchSchema>): string {
  const { geometry, shader_type, name } = args;

  let shaders: { vert: string; frag: string; geom?: string };
  switch (shader_type) {
    case "basic":
      shaders = shaderBasic(name);
      break;
    case "phong":
      shaders = shaderPhong(name);
      break;
    case "wireframe":
      shaders = shaderWireframe(name);
      break;
    case "particle":
      shaders = shaderParticle(name);
      break;
    case "postprocess":
      shaders = shaderPostprocess(name);
      break;
  }

  const geom = geomConstructor(geometry);

  let formatCode = `gl::GlslProg::Format()
        .vertex(CI_GLSL(150,
            ${inlineGlsl(shaders.vert).split("\n").join("\n            ")}
        ))
        .fragment(CI_GLSL(150,
            ${inlineGlsl(shaders.frag).split("\n").join("\n            ")}
        ))`;

  if (shaders.geom) {
    formatCode += `
        .geometry(CI_GLSL(150,
            ${inlineGlsl(shaders.geom).split("\n").join("\n            ")}
        ))`;
  }

  const code = `#include "cinder/gl/gl.h"
#include "cinder/app/App.h"

using namespace ci;
using namespace ci::app;

// --- Member declarations ---
gl::BatchRef m${name};

// --- In setup() ---
void setup() {
    auto shader = gl::GlslProg::create(
        ${formatCode}
    );

    m${name} = gl::Batch::create(${geom}, shader);
}

// --- In draw() ---
void draw() {
    gl::clear(Color::black());
    gl::setMatricesWindowPersp(getWindowSize());

    m${name}->draw();
}`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Tool 3: generate_fbo_pipeline
// ---------------------------------------------------------------------------

function fboInternalFormat(format: string): string {
  switch (format) {
    case "RGBA8":
      return "GL_RGBA8";
    case "RGBA16F":
      return "GL_RGBA16F";
    case "RGBA32F":
      return "GL_RGBA32F";
    default:
      return "GL_RGBA8";
  }
}

function generateFboPipeline(
  args: z.infer<typeof GenerateFboPipelineSchema>,
): string {
  const { passes, width, height, format, ping_pong } = args;
  const glFormat = fboInternalFormat(format);

  let members = "";
  let setupCode = "";
  let drawCode = "";

  if (ping_pong) {
    members = `gl::FboRef mFboPing;
gl::FboRef mFboPong;
gl::GlslProgRef mPassShader[${passes}];`;

    setupCode = `void setup() {
    auto fmt = gl::Fbo::Format()
        .colorTexture(gl::Texture::Format().internalFormat(${glFormat}));

    mFboPing = gl::Fbo::create(${width}, ${height}, fmt);
    mFboPong = gl::Fbo::create(${width}, ${height}, fmt);

    // Create a shader for each pass
${Array.from({ length: passes }, (_, i) => `    mPassShader[${i}] = gl::GlslProg::create(/* pass ${i} vertex */, /* pass ${i} fragment */);`).join("\n")}
}`;

    drawCode = `void draw() {
    gl::FboRef readFbo = mFboPing;
    gl::FboRef writeFbo = mFboPong;
${Array.from(
  { length: passes },
  (_, i) => `
    // --- Pass ${i} ---
    writeFbo->bindFramebuffer();
    gl::clear(ColorA::zero());
    gl::ScopedTextureBind texBind${i}(readFbo->getColorTexture(), 0);
    gl::ScopedGlslProg shaderBind${i}(mPassShader[${i}]);
    mPassShader[${i}]->uniform("uTexture", 0);
    mPassShader[${i}]->uniform("uResolution", vec2(${width}, ${height}));
    gl::drawSolidRect(Rectf(0, 0, ${width}, ${height}));
    writeFbo->unbindFramebuffer();
    std::swap(readFbo, writeFbo);`,
).join("\n")}

    // Draw final result to screen
    gl::clear(Color::black());
    gl::draw(readFbo->getColorTexture(), getWindowBounds());
}`;
  } else {
    members = `gl::FboRef mFbo[${passes}];
gl::GlslProgRef mPassShader[${passes}];`;

    setupCode = `void setup() {
    auto fmt = gl::Fbo::Format()
        .colorTexture(gl::Texture::Format().internalFormat(${glFormat}));

${Array.from({ length: passes }, (_, i) => `    mFbo[${i}] = gl::Fbo::create(${width}, ${height}, fmt);`).join("\n")}

    // Create a shader for each pass
${Array.from({ length: passes }, (_, i) => `    mPassShader[${i}] = gl::GlslProg::create(/* pass ${i} vertex */, /* pass ${i} fragment */);`).join("\n")}
}`;

    drawCode = `void draw() {
${Array.from(
  { length: passes },
  (_, i) => {
    const texLine =
      i === 0
        ? `    // First pass: render scene`
        : `    gl::ScopedTextureBind texBind${i}(mFbo[${i - 1}]->getColorTexture(), 0);
    mPassShader[${i}]->uniform("uTexture", 0);`;
    return `
    // --- Pass ${i} ---
    mFbo[${i}]->bindFramebuffer();
    gl::clear(ColorA::zero());
    gl::ScopedGlslProg shaderBind${i}(mPassShader[${i}]);
    ${texLine}
    mPassShader[${i}]->uniform("uResolution", vec2(${width}, ${height}));
    gl::drawSolidRect(Rectf(0, 0, ${width}, ${height}));
    mFbo[${i}]->unbindFramebuffer();`;
  },
).join("\n")}

    // Draw final result to screen
    gl::clear(Color::black());
    gl::draw(mFbo[${passes - 1}]->getColorTexture(), getWindowBounds());
}`;
  }

  const code = `#include "cinder/gl/gl.h"
#include "cinder/app/App.h"

using namespace ci;
using namespace ci::app;

// --- Member declarations ---
${members}

${setupCode}

${drawCode}`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Tool 4: generate_audio_graph
// ---------------------------------------------------------------------------

function audioNodeClass(type: string): string {
  return `audio::${type}`;
}

function audioNodeRef(type: string): string {
  return `audio::${type}Ref`;
}

function generateAudioGraph(
  args: z.infer<typeof GenerateAudioGraphSchema>,
): string {
  const { nodes, connections } = args;

  const memberDecls = nodes
    .map((n) => `${audioNodeRef(n.type)} m${n.name};`)
    .join("\n");

  const nodeCreation = nodes
    .map((n) => `    m${n.name} = ctx->makeNode(new ${audioNodeClass(n.type)}());`)
    .join("\n");

  const connectionCode = connections
    .map((c) => `    m${c.from} >> m${c.to};`)
    .join("\n");

  const enableCalls = nodes
    .filter((n) =>
      [
        "FilePlayerNode",
        "BufferPlayerNode",
        "GenSineNode",
        "GenNoiseNode",
      ].includes(n.type),
    )
    .map((n) => `    m${n.name}->enable();`)
    .join("\n");

  const code = `#include "cinder/app/App.h"
#include "cinder/audio/audio.h"

using namespace ci;
using namespace ci::app;

// --- Member declarations ---
${memberDecls}

void setup() {
    auto ctx = audio::Context::master();

    // Create nodes
${nodeCreation}

    // Connect graph
${connectionCode}

    // Connect to output
    // (ensure your graph ends with: ... >> ctx->getOutput())

    // Enable source nodes
${enableCalls}

    ctx->enable();
}`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Tool 5: generate_audio_reactive
// ---------------------------------------------------------------------------

function generateAudioReactive(
  args: z.infer<typeof GenerateAudioReactiveSchema>,
): string {
  const { audio_features, visual_params, smoothing } = args;

  const needsMonitor = audio_features.includes("amplitude");
  const needsSpectral =
    audio_features.includes("frequency_bands") ||
    audio_features.includes("spectral_centroid");

  let memberDecls = "";
  if (needsMonitor) {
    memberDecls += "audio::MonitorNodeRef mMonitorNode;\n";
  }
  if (needsSpectral) {
    memberDecls += "audio::MonitorSpectralNodeRef mSpectralNode;\n";
  }

  // Visual param member declarations
  memberDecls += "\n// Visual parameters\n";
  for (const p of visual_params) {
    memberDecls += `${p.type} m${p.name} = ${p.min};\n`;
  }

  // Audio feature extraction vars
  let featureDecls = "";
  if (audio_features.includes("amplitude")) {
    featureDecls += "float mAmplitude = 0.0f;\n";
  }
  if (audio_features.includes("frequency_bands")) {
    featureDecls += "std::vector<float> mFrequencyBands;\n";
  }
  if (audio_features.includes("spectral_centroid")) {
    featureDecls += "float mSpectralCentroid = 0.0f;\n";
  }

  // Setup code
  let setupCode = "void setup() {\n    auto ctx = audio::Context::master();\n";
  setupCode += "    auto inputNode = ctx->createInputDeviceNode();\n\n";

  if (needsMonitor) {
    setupCode += "    mMonitorNode = ctx->makeNode(new audio::MonitorNode());\n";
  }
  if (needsSpectral) {
    setupCode +=
      "    mSpectralNode = ctx->makeNode(new audio::MonitorSpectralNode());\n";
  }

  setupCode += "\n    // Build audio graph\n";
  if (needsMonitor && needsSpectral) {
    setupCode += "    inputNode >> mMonitorNode;\n";
    setupCode += "    inputNode >> mSpectralNode;\n";
  } else if (needsMonitor) {
    setupCode += "    inputNode >> mMonitorNode;\n";
  } else if (needsSpectral) {
    setupCode += "    inputNode >> mSpectralNode;\n";
  }

  setupCode += "\n    inputNode->enable();\n    ctx->enable();\n}\n";

  // Update code
  let updateCode = "void update() {\n";

  if (audio_features.includes("amplitude")) {
    updateCode += `    float rawAmplitude = mMonitorNode->getVolume();
    mAmplitude = glm::lerp(mAmplitude, rawAmplitude, ${(1.0 - smoothing).toFixed(2)}f);\n\n`;
  }

  if (audio_features.includes("frequency_bands")) {
    updateCode += `    mFrequencyBands = mSpectralNode->getMagSpectrum();\n\n`;
  }

  if (audio_features.includes("spectral_centroid")) {
    updateCode += `    {
        auto& spectrum = mSpectralNode->getMagSpectrum();
        float weightedSum = 0.0f, totalMag = 0.0f;
        for (size_t i = 0; i < spectrum.size(); i++) {
            weightedSum += i * spectrum[i];
            totalMag += spectrum[i];
        }
        float rawCentroid = (totalMag > 0.0f) ? weightedSum / totalMag : 0.0f;
        mSpectralCentroid = glm::lerp(mSpectralCentroid, rawCentroid, ${(1.0 - smoothing).toFixed(2)}f);
    }\n\n`;
  }

  // Map features to visual params
  updateCode += "    // Map audio features to visual parameters\n";
  for (let i = 0; i < visual_params.length; i++) {
    const p = visual_params[i];
    const feature = audio_features[i % audio_features.length];
    let sourceVar = "mAmplitude";
    if (feature === "frequency_bands")
      sourceVar = "(mFrequencyBands.empty() ? 0.0f : mFrequencyBands[0])";
    if (feature === "spectral_centroid") sourceVar = "mSpectralCentroid";
    updateCode += `    m${p.name} = glm::lerp(static_cast<${p.type}>(${p.min}), static_cast<${p.type}>(${p.max}), static_cast<${p.type}>(glm::clamp(${sourceVar}, 0.0f, 1.0f)));\n`;
  }

  updateCode += "}\n";

  const code = `#include "cinder/app/App.h"
#include "cinder/audio/audio.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

// --- Member declarations ---
${memberDecls}
${featureDecls}

${setupCode}

${updateCode}`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Tool 6: generate_particle_system
// ---------------------------------------------------------------------------

function generateParticleSystem(
  args: z.infer<typeof GenerateParticleSystemSchema>,
): string {
  const { max_particles, emitter_type, forces, render_mode, instanced } = args;

  const hasGravity = forces.includes("gravity");
  const hasWind = forces.includes("wind");
  const hasTurbulence = forces.includes("turbulence");
  const hasAttract = forces.includes("attract");

  let emitterCode = "";
  switch (emitter_type) {
    case "point":
      emitterCode = `        p.position = mEmitterPos;`;
      break;
    case "line":
      emitterCode = `        p.position = mEmitterPos + vec3(randFloat(-mEmitterSize, mEmitterSize), 0.0f, 0.0f);`;
      break;
    case "circle":
      emitterCode = `        float angle = randFloat(0.0f, glm::two_pi<float>());
        float r = mEmitterSize * sqrt(randFloat(0.0f, 1.0f));
        p.position = mEmitterPos + vec3(cos(angle) * r, sin(angle) * r, 0.0f);`;
      break;
    case "sphere":
      emitterCode = `        vec3 dir = randVec3();
        p.position = mEmitterPos + dir * mEmitterSize * randFloat(0.0f, 1.0f);`;
      break;
  }

  let forceCode = "";
  if (hasGravity) {
    forceCode += "            p.velocity += mGravity * dt;\n";
  }
  if (hasWind) {
    forceCode += "            p.velocity += mWind * dt;\n";
  }
  if (hasTurbulence) {
    forceCode +=
      "            p.velocity += mPerlin.dfBm(p.position * mTurbulenceScale) * mTurbulenceStrength * dt;\n";
  }
  if (hasAttract) {
    forceCode += `            vec3 toAttractor = mAttractorPos - p.position;
            float dist = glm::length(toAttractor);
            if (dist > 0.01f) {
                p.velocity += glm::normalize(toAttractor) * mAttractorStrength / (dist * dist) * dt;
            }\n`;
  }

  let renderDecl = "";
  let renderSetup = "";
  let renderDraw = "";

  if (instanced) {
    renderDecl = `gl::VboRef mInstanceDataVbo;
    gl::BatchRef mParticleBatch;
    gl::GlslProgRef mParticleShader;`;

    renderSetup = `        // Instance buffer setup
        std::vector<vec3> positions(${max_particles});
        mInstanceDataVbo = gl::Vbo::create(GL_ARRAY_BUFFER, positions, GL_DYNAMIC_DRAW);

        geom::BufferLayout instanceLayout;
        instanceLayout.append(geom::Attrib::CUSTOM_0, 3, sizeof(vec3), 0, 1);

        auto mesh = gl::VboMesh::create(geom::Sphere().radius(0.05f));
        mesh->appendVbo(instanceLayout, mInstanceDataVbo);

        mParticleShader = gl::GlslProg::create(
            gl::GlslProg::Format()
                .vertex(CI_GLSL(150,
                    uniform mat4 ciModelViewProjection;
                    in vec4 ciPosition;
                    in vec3 iPosition; // instance position (CUSTOM_0)
                    void main() {
                        gl_Position = ciModelViewProjection * (ciPosition + vec4(iPosition, 0.0));
                    }
                ))
                .fragment(CI_GLSL(150,
                    out vec4 oColor;
                    void main() {
                        oColor = vec4(1.0);
                    }
                ))
        );

        mParticleBatch = gl::Batch::create(mesh, mParticleShader, {
            { geom::Attrib::CUSTOM_0, "iPosition" }
        });`;

    renderDraw = `        // Update instance buffer
        std::vector<vec3> positions;
        positions.reserve(mParticles.size());
        for (auto& p : mParticles) {
            if (p.alive) positions.push_back(p.position);
        }
        mInstanceDataVbo->bufferData(positions.size() * sizeof(vec3), positions.data(), GL_DYNAMIC_DRAW);

        gl::ScopedGlslProg scoped(mParticleShader);
        mParticleBatch->drawInstanced(static_cast<GLsizei>(positions.size()));`;
  } else {
    switch (render_mode) {
      case "points":
        renderDraw = `        gl::VertBatch vb(GL_POINTS);
        for (auto& p : mParticles) {
            if (!p.alive) continue;
            float alpha = 1.0f - (p.age / p.lifetime);
            vb.color(ColorA(p.color, alpha));
            vb.vertex(p.position);
        }
        gl::pointSize(4.0f);
        vb.draw();`;
        break;
      case "billboards":
        renderDraw = `        for (auto& p : mParticles) {
            if (!p.alive) continue;
            float alpha = 1.0f - (p.age / p.lifetime);
            float size = p.size * alpha;
            gl::ScopedColor sc(ColorA(p.color, alpha));
            gl::drawSolidRect(Rectf(
                vec2(p.position) - vec2(size),
                vec2(p.position) + vec2(size)
            ));
        }`;
        break;
      case "trails":
        renderDraw = `        gl::VertBatch vb(GL_LINE_STRIP);
        for (auto& p : mParticles) {
            if (!p.alive) continue;
            float alpha = 1.0f - (p.age / p.lifetime);
            vb.color(ColorA(p.color, alpha));
            vb.vertex(p.position);
        }
        vb.draw();`;
        break;
    }
  }

  const code = `#include "cinder/app/App.h"
#include "cinder/gl/gl.h"
#include "cinder/Rand.h"
${hasTurbulence ? '#include "cinder/Perlin.h"' : ""}

using namespace ci;
using namespace ci::app;

class ParticleSystem {
public:
    struct Particle {
        vec3 position;
        vec3 velocity;
        Color color;
        float size;
        float age;
        float lifetime;
        bool alive;
    };

    static const int MAX_PARTICLES = ${max_particles};

    // Emitter settings
    vec3 mEmitterPos = vec3(0.0f);
    float mEmitterSize = 1.0f;
    float mEmitRate = 100.0f;
${hasGravity ? "    vec3 mGravity = vec3(0.0f, -9.8f, 0.0f);\n" : ""}${hasWind ? "    vec3 mWind = vec3(1.0f, 0.0f, 0.0f);\n" : ""}${hasTurbulence ? "    Perlin mPerlin;\n    float mTurbulenceScale = 0.1f;\n    float mTurbulenceStrength = 2.0f;\n" : ""}${hasAttract ? "    vec3 mAttractorPos = vec3(0.0f);\n    float mAttractorStrength = 5.0f;\n" : ""}
    ${renderDecl}

    std::vector<Particle> mParticles;
    float mEmitAccumulator = 0.0f;

    void setup() {
        mParticles.resize(MAX_PARTICLES);
        for (auto& p : mParticles) p.alive = false;
${renderSetup}
    }

    void emit(int count) {
        int emitted = 0;
        for (auto& p : mParticles) {
            if (emitted >= count) break;
            if (p.alive) continue;

            p.alive = true;
${emitterCode}
            p.velocity = randVec3() * randFloat(0.5f, 2.0f);
            p.color = Color(randFloat(), randFloat(), randFloat());
            p.size = randFloat(0.02f, 0.1f);
            p.age = 0.0f;
            p.lifetime = randFloat(1.0f, 4.0f);
            emitted++;
        }
    }

    void update(float dt) {
        // Emit new particles
        mEmitAccumulator += mEmitRate * dt;
        int toEmit = static_cast<int>(mEmitAccumulator);
        if (toEmit > 0) {
            emit(toEmit);
            mEmitAccumulator -= toEmit;
        }

        // Update existing particles
        for (auto& p : mParticles) {
            if (!p.alive) continue;

            p.age += dt;
            if (p.age >= p.lifetime) {
                p.alive = false;
                continue;
            }

            // Apply forces
${forceCode}
            p.position += p.velocity * dt;
        }
    }

    void draw() {
${renderDraw}
    }
};`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Tool 7: generate_params_ui
// ---------------------------------------------------------------------------

function cppTypeForControl(type: string): string {
  switch (type) {
    case "slider_float":
      return "float";
    case "slider_int":
      return "int";
    case "checkbox":
      return "bool";
    case "color":
      return "Color";
    case "direction":
      return "vec3";
    case "button":
      return "";
    case "separator":
      return "";
    default:
      return "float";
  }
}

function cppDefaultValue(type: string, val: string | number | boolean): string {
  switch (type) {
    case "slider_float":
      return `${Number(val).toFixed(2)}f`;
    case "slider_int":
      return `${Number(val)}`;
    case "checkbox":
      return val ? "true" : "false";
    case "color":
      return `Color(1.0f, 1.0f, 1.0f)`;
    case "direction":
      return `vec3(0.0f, 1.0f, 0.0f)`;
    default:
      return `${val}`;
  }
}

function generateParamsUi(
  args: z.infer<typeof GenerateParamsUiSchema>,
): string {
  const { panel_name, controls } = args;

  // Member declarations
  const members = controls
    .filter((c) => c.type !== "button" && c.type !== "separator")
    .map(
      (c) =>
        `${cppTypeForControl(c.type)} m${c.name} = ${cppDefaultValue(c.type, c.default_value)};`,
    )
    .join("\n");

  const panelMember = `params::InterfaceGlRef mParams;`;

  // addParam calls
  const addCalls = controls
    .map((c) => {
      if (c.type === "separator") {
        return `    mParams->addSeparator();`;
      }
      if (c.type === "button") {
        return `    mParams->addButton("${c.name}", [this]() { /* button action */ });`;
      }
      if (c.type === "slider_float" || c.type === "slider_int") {
        const minMax =
          c.min !== undefined && c.max !== undefined
            ? `, "min=${c.min} max=${c.max}"`
            : "";
        return `    mParams->addParam("${c.name}", &m${c.name}${minMax});`;
      }
      return `    mParams->addParam("${c.name}", &m${c.name});`;
    })
    .join("\n");

  const code = `#include "cinder/app/App.h"
#include "cinder/params/Params.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

// --- Member declarations ---
${panelMember}
${members}

// --- In setup() ---
void setup() {
    mParams = params::InterfaceGl::create("${panel_name}", ivec2(200, 300));

${addCalls}
}

// --- In draw() ---
void draw() {
    gl::clear(Color::black());

    // ... your drawing code using the param values ...

    mParams->draw();
}`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Tool 8: generate_params_from_uniforms
// ---------------------------------------------------------------------------

function uniformToCppType(uType: string): string {
  switch (uType) {
    case "float":
      return "float";
    case "int":
      return "int";
    case "vec2":
      return "vec2";
    case "vec3":
      return "vec3";
    case "vec4":
      return "vec4";
    case "bool":
      return "bool";
    case "color":
      return "Color";
    default:
      return "float";
  }
}

function uniformDefaultValue(uType: string): string {
  switch (uType) {
    case "float":
      return "0.0f";
    case "int":
      return "0";
    case "vec2":
      return "vec2(0.0f)";
    case "vec3":
      return "vec3(0.0f)";
    case "vec4":
      return "vec4(0.0f, 0.0f, 0.0f, 1.0f)";
    case "bool":
      return "false";
    case "color":
      return "Color(1.0f, 1.0f, 1.0f)";
    default:
      return "0.0f";
  }
}

function isColorUniform(name: string, type: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    (type === "vec3" || type === "vec4" || type === "color") &&
    (lowerName.includes("color") ||
      lowerName.includes("colour") ||
      lowerName.includes("tint"))
  );
}

function generateParamsFromUniforms(
  args: z.infer<typeof GenerateParamsFromUniformsSchema>,
): string {
  const { uniforms } = args;

  // Member declarations
  const members = uniforms
    .map((u) => {
      const cppType = isColorUniform(u.name, u.type)
        ? "Color"
        : uniformToCppType(u.type);
      const defaultVal = isColorUniform(u.name, u.type)
        ? "Color(1.0f, 1.0f, 1.0f)"
        : uniformDefaultValue(u.type);
      return `${cppType} m${u.name} = ${defaultVal};`;
    })
    .join("\n");

  // addParam calls
  const addCalls = uniforms
    .map((u) => {
      if (u.type === "bool") {
        return `    mParams->addParam("${u.name}", &m${u.name});`;
      }
      if (isColorUniform(u.name, u.type)) {
        return `    mParams->addParam("${u.name}", &m${u.name});`;
      }
      if (u.type === "vec3") {
        return `    mParams->addParam("${u.name}", &m${u.name});`;
      }
      if (u.type === "float" || u.type === "int") {
        const minMax =
          u.min !== undefined && u.max !== undefined
            ? `, "min=${u.min} max=${u.max}"`
            : "";
        return `    mParams->addParam("${u.name}", &m${u.name}${minMax});`;
      }
      return `    mParams->addParam("${u.name}", &m${u.name});`;
    })
    .join("\n");

  // Uniform setting calls
  const uniformSetCalls = uniforms
    .map((u) => {
      if (isColorUniform(u.name, u.type) && u.type === "vec3") {
        return `    shader->uniform("${u.name}", vec3(m${u.name}));`;
      }
      if (isColorUniform(u.name, u.type) && u.type === "vec4") {
        return `    shader->uniform("${u.name}", vec4(vec3(m${u.name}), 1.0f));`;
      }
      return `    shader->uniform("${u.name}", m${u.name});`;
    })
    .join("\n");

  const code = `#include "cinder/app/App.h"
#include "cinder/params/Params.h"
#include "cinder/gl/gl.h"

using namespace ci;
using namespace ci::app;

// --- Member declarations ---
params::InterfaceGlRef mParams;
gl::GlslProgRef mShader;
${members}

// --- In setup() ---
void setup() {
    mParams = params::InterfaceGl::create("Uniforms", ivec2(200, 400));

${addCalls}

    // Load your shader here
    // mShader = gl::GlslProg::create(...);
}

// --- In draw() – set uniforms before drawing ---
void draw() {
    gl::clear(Color::black());

    if (mShader) {
        gl::ScopedGlslProg scoped(mShader);

        // Set uniforms from params
${uniformSetCalls}

        // ... draw your geometry ...
    }

    mParams->draw();
}`;

  return `\`\`\`cpp\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "generate_shader": {
      const parsed = GenerateShaderSchema.parse(args);
      return generateShader(parsed);
    }
    case "generate_batch": {
      const parsed = GenerateBatchSchema.parse(args);
      return generateBatch(parsed);
    }
    case "generate_fbo_pipeline": {
      const parsed = GenerateFboPipelineSchema.parse(args);
      return generateFboPipeline(parsed);
    }
    case "generate_audio_graph": {
      const parsed = GenerateAudioGraphSchema.parse(args);
      return generateAudioGraph(parsed);
    }
    case "generate_audio_reactive": {
      const parsed = GenerateAudioReactiveSchema.parse(args);
      return generateAudioReactive(parsed);
    }
    case "generate_particle_system": {
      const parsed = GenerateParticleSystemSchema.parse(args);
      return generateParticleSystem(parsed);
    }
    case "generate_params_ui": {
      const parsed = GenerateParamsUiSchema.parse(args);
      return generateParamsUi(parsed);
    }
    case "generate_params_from_uniforms": {
      const parsed = GenerateParamsFromUniformsSchema.parse(args);
      return generateParamsFromUniforms(parsed);
    }
    default:
      throw new Error(`Unknown codegen tool: ${name}`);
  }
}
