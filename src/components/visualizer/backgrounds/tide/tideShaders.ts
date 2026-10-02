// src/components/visualizer/backgrounds/tide/tideShaders.ts
// GLSL ES 1.00 sources for the tide fluid solver. The pass order mirrors the reference
// implementation (React Bits Micro Slats): splat -> curl/vorticity -> divergence -> pressure ->
// project -> advect, plus a scale pass used to clear the buffers. Everything stays ES 1.00 so the
// pipeline also runs on plain WebGL 1 contexts.

export const TIDE_VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const TIDE_FLUID_VERTEX_SHADER = `
attribute vec2 a_position;
uniform vec2 u_texel;
varying vec2 v_uv;
varying vec2 v_left;
varying vec2 v_right;
varying vec2 v_top;
varying vec2 v_bottom;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    v_left = v_uv - vec2(u_texel.x, 0.0);
    v_right = v_uv + vec2(u_texel.x, 0.0);
    v_top = v_uv + vec2(0.0, u_texel.y);
    v_bottom = v_uv - vec2(0.0, u_texel.y);
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FLUID_HEADER = `
precision highp float;
varying vec2 v_uv;
varying vec2 v_left;
varying vec2 v_right;
varying vec2 v_top;
varying vec2 v_bottom;
`;

/** Adds a gaussian blob of force or ink to a field. One draw call per splat, no uniform arrays. */
export const TIDE_SPLAT_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_target;
uniform float u_aspect;
uniform vec2 u_point;
uniform vec3 u_value;
uniform float u_radius;
void main() {
    vec2 offset = v_uv - u_point;
    offset.x *= u_aspect;
    float falloff = exp(-dot(offset, offset) / max(u_radius, 0.00001));
    gl_FragColor = vec4(texture2D(u_target, v_uv).xyz + u_value * falloff, 1.0);
}
`;

export const TIDE_CURL_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_velocity;
void main() {
    float left = texture2D(u_velocity, v_left).y;
    float right = texture2D(u_velocity, v_right).y;
    float top = texture2D(u_velocity, v_top).x;
    float bottom = texture2D(u_velocity, v_bottom).x;
    gl_FragColor = vec4(0.5 * (right - left - top + bottom), 0.0, 0.0, 1.0);
}
`;

export const TIDE_VORTICITY_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_velocity;
uniform sampler2D u_curl;
uniform float u_swirl;
uniform float u_dt;
void main() {
    float left = texture2D(u_curl, v_left).x;
    float right = texture2D(u_curl, v_right).x;
    float top = texture2D(u_curl, v_top).x;
    float bottom = texture2D(u_curl, v_bottom).x;
    float middle = texture2D(u_curl, v_uv).x;
    vec2 force = 0.5 * vec2(abs(top) - abs(bottom), abs(right) - abs(left));
    force = force / (length(force) + 0.0001) * u_swirl * middle;
    force.y = -force.y;
    vec2 velocity = texture2D(u_velocity, v_uv).xy + force * u_dt;
    gl_FragColor = vec4(clamp(velocity, vec2(-1000.0), vec2(1000.0)), 0.0, 1.0);
}
`;

export const TIDE_DIVERGENCE_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_velocity;
void main() {
    vec2 middle = texture2D(u_velocity, v_uv).xy;
    float left = v_left.x < 0.0 ? -middle.x : texture2D(u_velocity, v_left).x;
    float right = v_right.x > 1.0 ? -middle.x : texture2D(u_velocity, v_right).x;
    float top = v_top.y > 1.0 ? -middle.y : texture2D(u_velocity, v_top).y;
    float bottom = v_bottom.y < 0.0 ? -middle.y : texture2D(u_velocity, v_bottom).y;
    gl_FragColor = vec4(0.5 * (right - left + top - bottom), 0.0, 0.0, 1.0);
}
`;

export const TIDE_PRESSURE_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
void main() {
    float left = texture2D(u_pressure, v_left).x;
    float right = texture2D(u_pressure, v_right).x;
    float top = texture2D(u_pressure, v_top).x;
    float bottom = texture2D(u_pressure, v_bottom).x;
    float divergence = texture2D(u_divergence, v_uv).x;
    gl_FragColor = vec4((left + right + top + bottom - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const TIDE_PROJECT_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_pressure;
uniform sampler2D u_velocity;
void main() {
    float left = texture2D(u_pressure, v_left).x;
    float right = texture2D(u_pressure, v_right).x;
    float top = texture2D(u_pressure, v_top).x;
    float bottom = texture2D(u_pressure, v_bottom).x;
    vec2 velocity = texture2D(u_velocity, v_uv).xy - vec2(right - left, top - bottom);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

export const TIDE_ADVECT_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_dt;
uniform float u_fade;
void main() {
    vec2 from = v_uv - u_dt * texture2D(u_velocity, v_uv).xy * u_texel;
    // Time based decay like the reference: dividing by (1 + fade * dt) keeps the falloff frame rate independent.
    gl_FragColor = texture2D(u_source, from) / (1.0 + u_fade * u_dt);
}
`;

/** Multiply-by-a-constant pass: used to damp the pressure field and to clear the buffers. */
export const TIDE_SCALE_FRAGMENT_SHADER = `${FLUID_HEADER}
uniform sampler2D u_source;
uniform float u_value;
void main() {
    gl_FragColor = texture2D(u_source, v_uv) * u_value;
}
`;
