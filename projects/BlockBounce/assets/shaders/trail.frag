#version 150

uniform sampler2D uTexture;
uniform float uFadeAmount;  // 0.92 = slow fade, 0.8 = fast fade

in vec2 vTexCoord;
out vec4 oColor;

void main() {
    vec4 color = texture(uTexture, vTexCoord);
    oColor = color * uFadeAmount;
}
