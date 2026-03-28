#version 150

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uCamera;
uniform float uCameraOpacity;
uniform float uVignetteStrength;
uniform float uTime;

in vec2 vTexCoord;
out vec4 oColor;

void main() {
    vec4 scene = texture(uScene, vTexCoord);
    vec4 bloom = texture(uBloom, vTexCoord);
    vec4 cam = texture(uCamera, vTexCoord);

    // Dark camera background
    vec3 base = cam.rgb * uCameraOpacity;

    // Add particles + bloom
    vec3 color = base + scene.rgb + bloom.rgb;

    // Vignette
    vec2 uv = vTexCoord;
    float vignette = 1.0 - smoothstep(0.4, 1.4, length(uv - 0.5) * 2.0);
    vignette = mix(1.0, vignette, uVignetteStrength);
    color *= vignette;

    // Subtle color grade — lift shadows slightly blue
    color.b += 0.02;

    // Tone mapping
    color = color / (color + vec3(1.0));

    oColor = vec4(color, 1.0);
}
