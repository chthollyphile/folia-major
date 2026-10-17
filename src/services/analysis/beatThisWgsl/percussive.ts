/// <reference types="@webgpu/types" />

// src/services/analysis/beatThisWgsl/percussive.ts
// HPSS (harmonic / percussive separation by median filtering, Fitzgerald 2010) on the Beat This!
// log-mel spectrogram, on the GPU in the same worker and on the same device as the model run, for
// beatAccents.ts' `rhythmic` gate: per frame, how much of the energy is percussive and how much
// there is in all. A bar is the sum of its frames; the gate itself is on the CPU and costs nothing.
//
// One invocation per frame walks the 128 bands: the band's magnitude (the inverse of beatThis'
// log1p(1000 x), the 1000 dropped since only ratios are used), the median of 17 frames around it
// (what holds still is harmonic, ~0.34 s) and of 17 bands around it (what spreads across the bands at
// once is percussive), zero beyond the edges, and the soft (Wiener) mask P^2 / (H^2 + P^2). Same
// kernels as the demo's perc.mjs on a linear spectrum, here on the mel bands. Matches a JS reference to
// 1e-7 per bar; on an M4 Pro a four-minute track takes 15-23 ms in one submit, upload and readback
// included. It is submitted in slices of SLICE_FRAMES instead, each waited for (~55 ms in all), like
// the model's 'auto' slicing: the GPU only switches work between command buffers, and one long
// dispatch could hold a busy visualizer's frame.

const MEL_BINS = 128;
const WORKGROUP = 64;
const SLICE_FRAMES = 1024;

const PERCUSSIVE_WGSL = /* wgsl */ `
struct Params { frames: u32, first: u32, count: u32 }
@group(0) @binding(0) var<storage, read> mel: array<f32>;
@group(0) @binding(1) var<storage, read_write> energy: array<f32>;
@group(0) @binding(2) var<uniform> p: Params;

const BANDS: i32 = ${MEL_BINS};
const HALF: i32 = 8;
const TAPS: i32 = 17;

fn magnitude(frame: i32, band: i32) -> f32 {
  if (frame < 0 || frame >= i32(p.frames) || band < 0 || band >= BANDS) { return 0.0; }
  let v = mel[u32(frame * BANDS + band)];
  // expm1 without its cancellation near 0.
  if (v < 1e-3) { return max(0.0, v + 0.5 * v * v); }
  return exp(v) - 1.0;
}

fn median(values: ptr<function, array<f32, 17>>) -> f32 {
  for (var i = 1; i < TAPS; i++) {
    let value = (*values)[i];
    var j = i - 1;
    while (j >= 0 && (*values)[j] > value) {
      (*values)[j + 1] = (*values)[j];
      j--;
    }
    (*values)[j + 1] = value;
  }
  return (*values)[HALF];
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.count) { return; }
  let at = p.first + id.x;
  let frame = i32(at);
  var percussive = 0.0;
  var total = 0.0;
  var taps: array<f32, 17>;
  for (var band = 0; band < BANDS; band++) {
    for (var k = 0; k < TAPS; k++) { taps[k] = magnitude(frame + k - HALF, band); }
    let harmonic = median(&taps);
    for (var k = 0; k < TAPS; k++) { taps[k] = magnitude(frame, band + k - HALF); }
    let hit = median(&taps);
    let value = magnitude(frame, band);
    let e = value * value;
    let hh = harmonic * harmonic;
    let pp = hit * hit;
    if (hh + pp > 0.0) { percussive += e * pp / (hh + pp); }
    total += e;
  }
  energy[2u * at] = percussive;
  energy[2u * at + 1u] = total;
}
`;

/** Per frame (50 fps, the spectrogram's): percussive and total energy. */
export interface PercussiveEnergyFrames {
    percussive: Float32Array;
    total: Float32Array;
}

const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();

/** The percussive and total energy of every frame of `mel` ([frames, 128], row-major). */
export const runPercussiveEnergy = async (device: GPUDevice, mel: Float32Array, frames: number): Promise<PercussiveEnergyFrames> => {
    if (frames < 1 || mel.length < frames * MEL_BINS) throw new Error(`percussive: ${mel.length} floats for ${frames} frames`);
    let pipeline = pipelines.get(device);
    if (!pipeline) {
        pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module: device.createShaderModule({ code: PERCUSSIVE_WGSL }), entryPoint: 'main' },
        });
        pipelines.set(device, pipeline);
    }
    const input = device.createBuffer({ size: frames * MEL_BINS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const output = device.createBuffer({ size: frames * 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const slices = Math.ceil(frames / SLICE_FRAMES);
    // One uniform slot per slice (256-byte aligned, the dynamic-offset-free way: a bind group each).
    const params = device.createBuffer({ size: slices * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const readback = device.createBuffer({ size: frames * 2 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
        device.queue.writeBuffer(input, 0, mel.buffer, mel.byteOffset, frames * MEL_BINS * 4);
        for (let slice = 0; slice < slices; slice += 1) {
            const first = slice * SLICE_FRAMES;
            const count = Math.min(SLICE_FRAMES, frames - first);
            device.queue.writeBuffer(params, slice * 256, new Uint32Array([frames, first, count, 0]));
            const group = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: input } },
                    { binding: 1, resource: { buffer: output } },
                    { binding: 2, resource: { buffer: params, offset: slice * 256, size: 16 } },
                ],
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP));
            pass.end();
            if (slice === slices - 1) encoder.copyBufferToBuffer(output, 0, readback, 0, frames * 2 * 4);
            device.queue.submit([encoder.finish()]);
            // One slice on the GPU at a time.
            await device.queue.onSubmittedWorkDone();
        }
        await readback.mapAsync(GPUMapMode.READ);
        const interleaved = new Float32Array(readback.getMappedRange().slice(0));
        readback.unmap();
        const percussive = new Float32Array(frames);
        const total = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame += 1) {
            percussive[frame] = interleaved[2 * frame];
            total[frame] = interleaved[2 * frame + 1];
        }
        return { percussive, total };
    } finally {
        input.destroy();
        output.destroy();
        params.destroy();
        readback.destroy();
    }
};
