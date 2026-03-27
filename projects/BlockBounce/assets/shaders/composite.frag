#version 150

uniform sampler2D uScene;
uniform sampler2D uGlow;
uniform sampler2D uCamera;
uniform float uCameraOpacity;  // low opacity camera bg
uniform float uGlowMix;

in vec2 vTexCoord;
out vec4 oColor;

void main() {
    vec4 scene = texture(uScene, vTexCoord);
    vec4 glow = texture(uGlow, vTexCoord);
    vec4 cam = texture(uCamera, vTexCoord);

    // Background camera feed at low opacity
    vec4 base = cam * uCameraOpacity;

    // Add scene and glow
    oColor = base + scene + glow * uGlowMix;
    oColor.a = 1.0;
}
