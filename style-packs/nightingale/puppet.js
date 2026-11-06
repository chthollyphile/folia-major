import mesh from './puppetData.js';

// Reassemble the original atlas through its rest-pose mesh; bend it gently in song time.
export function createPuppet(image) {
    const canvas = new OffscreenCanvas(840, 900);
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Nightingale requires WebGL for the original puppet mesh');
    const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `
        attribute vec2 aPosition; attribute vec2 aUv; attribute float aBone;
        uniform float uTime; uniform float uMotion; uniform float uSing;
        varying vec2 vUv;
        void main() {
            vec2 p = aPosition;
            float upper = smoothstep(-650.0, 260.0, p.y);
            float breath = sin(uTime * 2.35) * 1.8 + uSing * 2.2;
            float sway = sin(uTime * 1.48) * (4.2 + uSing * 3.2);
            p.x += upper * sway * uMotion;
            p.y += upper * breath * uMotion;
            float head = smoothstep(35.0, 165.0, p.y);
            float angle = sin(uTime * 1.48 + .4) * (.008 + uSing * .016) * uMotion * head;
            vec2 neck = vec2(-65.0, 85.0);
            vec2 local = p - neck;
            p = neck + mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * local;
            if (aBone >= 10.0) {
                float tip = 1.0 - smoothstep(70.0, 430.0, p.y);
                p.x += sin(uTime * 2.0 + p.y * .012 + aBone * .7) * (3.0 + tip * 6.0) * uMotion;
                p.y += cos(uTime * 1.8 + aBone) * tip * 2.0 * uMotion;
            }
            gl_Position = vec4((p.x - 50.0) / 840.0, (p.y + 200.0) / 900.0, 0.0, 1.0);
            vUv = aUv;
        }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `
        precision mediump float; uniform sampler2D uTexture; varying vec2 vUv;
        void main() { gl_FragColor = texture2D(uTexture, vUv); }
    `);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);
    for (const [name, size, offset] of [['aPosition', 2, 0], ['aUv', 2, 8], ['aBone', 1, 16]]) {
        const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 20, offset);
    }
    const indices = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const timeLocation = gl.getUniformLocation(program, 'uTime'), motionLocation = gl.getUniformLocation(program, 'uMotion'), singLocation = gl.getUniformLocation(program, 'uSing');
    let last = '';
    return {
        canvas,
        render(time, motion, sing) {
            const key = `${time}|${motion}|${sing}`;
            if (key === last) return;
            last = key;
            gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(timeLocation, time); gl.uniform1f(motionLocation, motion); gl.uniform1f(singLocation, sing);
            gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
        },
        dispose() {
            gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteBuffer(indices);
            gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        },
    };
}
