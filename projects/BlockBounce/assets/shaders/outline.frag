#version 150

uniform vec4 uColor;
uniform float uPulse;  // 0.0-1.0 animated pulse

out vec4 oColor;

void main() {
    float glow = 0.8 + 0.2 * sin(uPulse * 6.283185);
    oColor = uColor * glow;
}
