'use strict';

// dev/perf/app/locks.cjs
// The guard's locks on node's own modules: files, child processes, the network. They are apart
// from guard.cjs because a worker thread has its own copies of node's modules, so a lock put on
// the main thread's does not hold in it. guard.cjs puts them on the main thread; guardWorker.cjs
// puts them on every worker thread the app starts.

const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { fileURLToPath } = require('node:url');

/**
 * Puts the locks on this thread's modules. `profile` is the run's folder, `say` writes one note
 * for the runner. Returns the helpers the rest of the guard uses.
 */
const installLocks = ({ profile, say }) => {
    // ---------------------------------------------------------------------------------------------
    // Files: nothing is written outside the run's folder
    // ---------------------------------------------------------------------------------------------

    const samePath = value => path.resolve(String(value)).replace(/^\\\\\?\\/, '').toLowerCase();
    const profileRoot = samePath(profile);
    const isInsideProfile = (value) => {
        const resolved = samePath(value);
        return resolved === profileRoot || resolved.startsWith(profileRoot + path.sep);
    };

    const refusedWrites = new Set();
    const pathOf = (value) => {
        if (typeof value === 'string') {
            return value;
        }
        if (Buffer.isBuffer(value)) {
            return value.toString();
        }
        if (value instanceof URL) {
            return fileURLToPath(value);
        }
        // A file descriptor or a FileHandle: opened through the guarded open().
        return null;
    };
    const writeRefusal = (operation, target) => {
        const key = `${operation} ${target}`;
        if (!refusedWrites.has(key)) {
            refusedWrites.add(key);
            say('write-refused', { operation, path: target });
        }
        return Object.assign(new Error(`EPERM: the perf guard refused ${operation} outside the run's folder: ${target}`), {
            code: 'EPERM', errno: -4048, syscall: operation, path: target,
        });
    };
    /** The first of the checked arguments that names a path outside the run's folder, or null. */
    const outsideTarget = (args, indices) => {
        for (const index of indices) {
            const target = pathOf(args[index]);
            if (target !== null && !isInsideProfile(target)) {
                return target;
            }
        }
        return null;
    };
    const opensForWriting = (flags) => {
        if (flags === undefined || flags === null) {
            return false;
        }
        if (typeof flags === 'number') {
            const { O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND } = fs.constants;
            return (flags & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND)) !== 0;
        }
        return /[wa+]/.test(String(flags));
    };
    /** name -> which arguments are paths that get written. */
    const WRITERS = {
        writeFile: [0], appendFile: [0], mkdir: [0], rm: [0], rmdir: [0], unlink: [0], truncate: [0],
        chmod: [0], chown: [0], lchown: [0], utimes: [0], lutimes: [0], mkdtemp: [0],
        rename: [0, 1], copyFile: [1], cp: [1], symlink: [1], link: [1],
    };
    const guardFunction = (holder, name, indices, style, needsWrite = () => true) => {
        const real = holder[name];
        if (typeof real !== 'function') {
            return;
        }
        holder[name] = function guarded(...args) {
            const target = needsWrite(args) ? outsideTarget(args, indices) : null;
            if (target === null) {
                return real.apply(this, args);
            }
            const error = writeRefusal(name, target);
            if (style === 'promise') {
                return Promise.reject(error);
            }
            const callback = args[args.length - 1];
            if (style === 'callback' && typeof callback === 'function') {
                process.nextTick(callback, error);
                return undefined;
            }
            throw error;
        };
    };
    Object.entries(WRITERS).forEach(([name, indices]) => {
        guardFunction(fs, name, indices, 'callback');
        guardFunction(fs, `${name}Sync`, indices, 'sync');
        guardFunction(fs.promises, name, indices, 'promise');
    });
    guardFunction(fs, 'open', [0], 'callback', args => opensForWriting(typeof args[1] === 'function' ? undefined : args[1]));
    guardFunction(fs, 'openSync', [0], 'sync', args => opensForWriting(args[1]));
    guardFunction(fs.promises, 'open', [0], 'promise', args => opensForWriting(args[1]));
    guardFunction(fs, 'createWriteStream', [0], 'sync');

    // ---------------------------------------------------------------------------------------------
    // Child processes: none
    // ---------------------------------------------------------------------------------------------

    const childProcess = require('node:child_process');
    const spawnRefusal = (operation, file, args) => {
        const shown = [String(file), ...(Array.isArray(args) ? args.slice(0, 6).map(String) : [])].join(' ').slice(0, 300);
        say('spawn-refused', { operation, command: shown });
        return Object.assign(new Error(`EPERM: the perf guard starts no child process: ${shown}`), { code: 'EPERM', errno: -4048, syscall: operation, path: String(file) });
    };
    const deadChild = (error) => {
        const child = new EventEmitter();
        const ended = () => {
            const stream = new Readable({ read() {} });
            stream.push(null);
            return stream;
        };
        Object.assign(child, {
            pid: undefined, stdin: null, stdout: ended(), stderr: ended(), stdio: [null, null, null],
            killed: false, connected: false, exitCode: null, signalCode: null,
            kill: () => false, ref: () => {}, unref: () => {}, send: () => false, disconnect: () => {},
        });
        process.nextTick(() => {
            // As a missing program does. Without a listener an 'error' would be thrown; then only the end is told.
            if (child.listenerCount('error') > 0) {
                child.emit('error', error);
            }
            child.exitCode = 1;
            child.emit('exit', 1, null);
            child.emit('close', 1, null);
        });
        return child;
    };
    ['spawn', 'fork'].forEach((name) => {
        childProcess[name] = (file, args) => deadChild(spawnRefusal(name, file, args));
    });
    ['exec', 'execFile'].forEach((name) => {
        childProcess[name] = (file, ...rest) => {
            const error = spawnRefusal(name, file, Array.isArray(rest[0]) ? rest[0] : []);
            const callback = rest[rest.length - 1];
            if (typeof callback === 'function') {
                process.nextTick(callback, error, '', '');
            }
            return deadChild(error);
        };
    });
    childProcess.spawnSync = (file, args) => {
        const error = spawnRefusal('spawnSync', file, args);
        return { pid: 0, status: 1, signal: null, error, stdout: '', stderr: '', output: [null, '', ''] };
    };
    ['execSync', 'execFileSync'].forEach((name) => {
        childProcess[name] = (file, args) => { throw spawnRefusal(name, file, args); };
    });

    // ---------------------------------------------------------------------------------------------
    // The network: nothing beyond this machine
    // ---------------------------------------------------------------------------------------------

    const isLoopback = (host) => {
        const name = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
        return name === '' || name === 'localhost' || name === '::1' || /^127\.\d+\.\d+\.\d+$/.test(name);
    };
    const refusedConnection = (via, host) => { say('refused', { via, host: String(host) }); };

    const net = require('node:net');
    const realConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function guardedConnect(...args) {
        // net.connect() hands over one array of [options, callback]; the public forms are
        // (options[, cb]), (port[, host][, cb]) and (path[, cb]).
        const first = Array.isArray(args[0]) ? args[0][0] : args[0];
        let target;
        if (first && typeof first === 'object') {
            target = first.path ? { pipe: String(first.path) } : { host: first.host ?? 'localhost', port: first.port };
        } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
            target = { pipe: first };
        } else {
            target = { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
        }
        if (target.pipe === undefined && isLoopback(target.host)) {
            return realConnect.apply(this, args);
        }
        const shown = target.pipe ?? `${target.host}:${target.port}`;
        refusedConnection(target.pipe ? 'pipe' : 'socket', shown);
        const error = Object.assign(new Error(`connect ECONNREFUSED ${shown} (the perf guard lets nothing leave this machine)`), {
            code: 'ECONNREFUSED', errno: -4078, syscall: 'connect', address: target.host ?? target.pipe, port: target.port,
        });
        process.nextTick(() => this.destroy(error));
        return this;
    };

    const dns = require('node:dns');
    const dnsRefusal = (host) => {
        refusedConnection('dns', host);
        return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host} (the perf guard resolves no name beyond this machine)`), { code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname: String(host) });
    };
    const guardResolver = (holder, promised) => {
        Object.keys(holder).filter(name => typeof holder[name] === 'function' && /^(lookup$|resolve|reverse$)/.test(name)).forEach((name) => {
            const real = holder[name];
            holder[name] = function guardedLookup(host, ...rest) {
                if (isLoopback(host)) {
                    return real.call(this, host, ...rest);
                }
                const error = dnsRefusal(host);
                if (promised) {
                    return Promise.reject(error);
                }
                const callback = rest[rest.length - 1];
                if (typeof callback === 'function') {
                    process.nextTick(callback, error);
                }
                return {};
            };
        });
    };
    guardResolver(dns, false);
    guardResolver(dns.promises, true);
    guardResolver(dns.Resolver.prototype, false);
    guardResolver(dns.promises.Resolver.prototype, true);

    const dgram = require('node:dgram');
    const realSend = dgram.Socket.prototype.send;
    dgram.Socket.prototype.send = function guardedSend(...args) {
        const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        const address = args.slice(1, callback ? -1 : undefined).filter(value => typeof value === 'string').pop();
        if (isLoopback(address)) {
            return realSend.apply(this, args);
        }
        refusedConnection('udp', address);
        if (callback) {
            process.nextTick(callback, Object.assign(new Error(`send EACCES ${address} (perf guard)`), { code: 'EACCES' }));
        }
        return undefined;
    };

    // Servers the app starts listen on this machine only. (Its QQ API server asks for every address of
    // the PC, on a free port; here it gets 127.0.0.1, which is where the app's own page reaches it.)
    const realListen = net.Server.prototype.listen;
    net.Server.prototype.listen = function guardedListen(...args) {
        const first = args[0];
        if (first && typeof first === 'object' && !Array.isArray(first)) {
            // listen({ port, host }): a pipe (`path`) or a handle is left alone.
            if (first.port !== undefined && first.path === undefined && first.handle === undefined && first.fd === undefined) {
                const asked = first.host;
                if (asked === undefined || asked === '' || !isLoopback(asked)) {
                    args[0] = { ...first, host: '127.0.0.1' };
                }
                say('listen', { port: first.port, asked: asked ?? '(every address)', bound: args[0].host });
            }
        } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
            // listen(port[, host][, backlog][, callback])
            const asked = typeof args[1] === 'string' ? args[1] : undefined;
            if (asked === undefined) {
                args.splice(1, 0, '127.0.0.1');
            } else if (asked === '' || !isLoopback(asked)) {
                args[1] = '127.0.0.1';
            }
            say('listen', { port: Number(first), asked: asked ?? '(every address)', bound: args[1] });
        }
        return realListen.apply(this, args);
    };

    return { isInsideProfile, writeRefusal, spawnRefusal, deadChild, isLoopback, refusedConnection };
};

module.exports = { installLocks };
