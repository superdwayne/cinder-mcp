#version 150

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uBloomIntensity;
uniform int uHorizontal; // 0 = vertical, 1 = horizontal

in vec2 vTexCoord;
out vec4 oColor;

void main() {
    vec2 texelSize = 1.0 / uResolution;

    // 9-tap Gaussian blur
    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

    vec4 result = texture(uTexture, vTexCoord) * weights[0];

    vec2 dir = uHorizontal == 1 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);

    for (int i = 1; i < 5; ++i) {
        vec2 offset = dir * texelSize * float(i) * 2.0;
        result += texture(uTexture, vTexCoord + offset) * weights[i];
        result += texture(uTexture, vTexCoord - offset) * weights[i];
    }

    oColor = result * uBloomIntensity;
}
