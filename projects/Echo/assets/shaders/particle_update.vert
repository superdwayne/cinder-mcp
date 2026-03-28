#version 150

// Input attributes (current state)
in vec3 iPosition;    // xy = position, z = unused
in vec3 iVelocity;    // xy = velocity, z = life
in vec3 iColor;       // rgb
in float iSize;

// Output (next state, captured by transform feedback)
out vec3 oPosition;
out vec3 oVelocity;
out vec3 oColor;
out float oSize;

// Uniforms
uniform float uDeltaTime;
uniform float uTime;
uniform sampler2D uSilhouetteTex;   // body silhouette mask (white = body)
uniform sampler2D uMotionTex;       // motion/velocity field
uniform vec2 uResolution;           // screen resolution
uniform float uAttractionStrength;  // how strongly particles are pulled to silhouette
uniform float uChaos;               // global chaos level (from motion amount)
uniform float uNoiseScale;

// Simple noise function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 curlNoise(vec2 p) {
    float e = 0.01;
    float n = noise(p);
    float nx = noise(p + vec2(e, 0.0));
    float ny = noise(p + vec2(0.0, e));
    return vec2(-(ny - n) / e, (nx - n) / e);
}

void main() {
    vec2 pos = iPosition.xy;
    vec2 vel = iVelocity.xy;
    float life = iVelocity.z;

    // Sample silhouette at particle position
    vec2 uv = pos / uResolution;
    uv = clamp(uv, 0.0, 1.0);
    float silhouette = texture(uSilhouetteTex, uv).r;

    // Sample motion field
    vec2 motion = texture(uMotionTex, uv).rg * 2.0 - 1.0;

    // === ATTRACTION TO SILHOUETTE EDGES ===
    // Sample neighbors to find edge gradient
    float dx = 1.0 / uResolution.x;
    float dy = 1.0 / uResolution.y;
    float sl = texture(uSilhouetteTex, uv + vec2(-dx * 3.0, 0.0)).r;
    float sr = texture(uSilhouetteTex, uv + vec2( dx * 3.0, 0.0)).r;
    float su = texture(uSilhouetteTex, uv + vec2(0.0, -dy * 3.0)).r;
    float sd = texture(uSilhouetteTex, uv + vec2(0.0,  dy * 3.0)).r;
    vec2 grad = vec2(sr - sl, sd - su);

    // Pull particles toward body silhouette
    vec2 attraction = grad * uAttractionStrength;

    // If particle is ON the silhouette, push outward slightly to create edge halo
    if (silhouette > 0.5) {
        attraction *= -0.3;
    }

    // === CURL NOISE for organic motion ===
    vec2 noiseForce = curlNoise(pos * uNoiseScale + uTime * 0.3) * 50.0;

    // === MOTION RESPONSE ===
    // Push particles in the direction of body motion
    vec2 motionForce = motion * 200.0 * uChaos;

    // === COMBINE FORCES ===
    vec2 totalForce = attraction + noiseForce * (0.3 + uChaos * 0.7) + motionForce;

    // Damping
    vel = vel * 0.96 + totalForce * uDeltaTime;

    // Clamp velocity
    float speed = length(vel);
    if (speed > 500.0) vel = vel / speed * 500.0;

    // Update position
    pos += vel * uDeltaTime;

    // Wrap around screen edges
    if (pos.x < 0.0) pos.x += uResolution.x;
    if (pos.x > uResolution.x) pos.x -= uResolution.x;
    if (pos.y < 0.0) pos.y += uResolution.y;
    if (pos.y > uResolution.y) pos.y -= uResolution.y;

    // === COLOR based on velocity ===
    // Slow = cool blue/purple, fast = warm orange/white
    float speedNorm = clamp(speed / 300.0, 0.0, 1.0);
    vec3 coolColor = vec3(0.2, 0.4, 1.0);   // blue
    vec3 warmColor = vec3(1.0, 0.5, 0.1);   // orange
    vec3 hotColor  = vec3(1.0, 1.0, 1.0);   // white
    vec3 color = mix(coolColor, warmColor, smoothstep(0.0, 0.5, speedNorm));
    color = mix(color, hotColor, smoothstep(0.5, 1.0, speedNorm));

    // Particles on/near silhouette glow brighter
    if (silhouette > 0.3) {
        color = mix(color, vec3(1.0), 0.3);
    }

    // === SIZE based on velocity ===
    float size = mix(1.5, 4.0, speedNorm);
    if (silhouette > 0.5) size *= 1.5;

    // === LIFE ===
    life = clamp(life + uDeltaTime, 0.0, 10.0);

    // Output
    oPosition = vec3(pos, 0.0);
    oVelocity = vec3(vel, life);
    oColor = color;
    oSize = size;
}
