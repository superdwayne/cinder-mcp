#version 150

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uGlowIntensity;
uniform float uGlowRadius;

in vec2 vTexCoord;
out vec4 oColor;

void main() {
    vec4 sum = vec4(0.0);
    vec4 center = texture(uTexture, vTexCoord);

    // Two-pass Gaussian blur approximation for glow
    float radius = uGlowRadius;
    float quality = 3.0;
    float directions = 16.0;

    for (float d = 0.0; d < 6.283185; d += 6.283185 / directions) {
        for (float i = 1.0 / quality; i <= 1.0; i += 1.0 / quality) {
            vec2 offset = vec2(cos(d), sin(d)) * radius * i / uResolution;
            sum += texture(uTexture, vTexCoord + offset);
        }
    }

    sum /= quality * directions;
    oColor = center + sum * uGlowIntensity;
}
