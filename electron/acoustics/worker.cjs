const { load, computeRoomIR } = require('./phonon.cjs');

// electron/acoustics/worker.cjs
// The utility process `folia-acoustics` (started by host.cjs): Steam Audio loaded and run here, so a crash in
// the native library or a long simulation never touches the window's process. Plain node, no 'electron'; the
// library's path arrives as argv. One request at a time, in the order they came: the simulator's threads are
// Steam Audio's own, and two rooms at once would only share them.
//
// Messages in: { id, kind: 'available' | 'compute', payload }. Out: { id, result } or { id, error }.

const LIBRARY_FILE = process.argv[2] || null;

const handle = async ({ kind, payload }) => {
    if (kind === 'available') {
        load(LIBRARY_FILE);
        return true;
    }
    if (kind === 'compute') return computeRoomIR(LIBRARY_FILE, payload);
    throw new Error(`unknown request ${kind}`);
};

let queue = Promise.resolve();
process.parentPort.on('message', ({ data }) => {
    const { id } = data;
    queue = queue
        .then(() => handle(data))
        .then(
            result => process.parentPort.postMessage({ id, result }),
            (error) => {
                // Logged here with its stack (the output is forwarded into the main process's log); only the message crosses back.
                console.warn(`[acoustics] ${data.kind} failed`, error);
                process.parentPort.postMessage({ id, error: String(error?.message || error) });
            },
        );
});
