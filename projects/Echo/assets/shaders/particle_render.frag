#version 150

in vec3 vColor;
out vec4 oColor;

void main() {
    // Soft circle
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;

    // Soft edge falloff
    float alpha = 1.0 - smoothstep(0.2, 0.5, dist);

    oColor = vec4(vColor * alpha, alpha * 0.8);
}
