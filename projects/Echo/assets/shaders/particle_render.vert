#version 150

in vec3 iPosition;
in vec3 iColor;
in float iSize;

out vec3 vColor;

uniform mat4 ciModelViewProjection;

void main() {
    vColor = iColor;
    gl_Position = ciModelViewProjection * vec4(iPosition.xy, 0.0, 1.0);
    gl_PointSize = iSize;
}
