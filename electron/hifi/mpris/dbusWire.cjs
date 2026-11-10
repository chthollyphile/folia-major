'use strict';

// D-Bus 线上格式的最小实现（纯函数）：按签名编解码、拼和拆消息、解析总线地址、SASL 的 EXTERNAL 认证行。
// 只做 MPRIS 用得到的部分：不传文件描述符（h 只编成一个下标），不支持 unix 以外的传输。

const MESSAGE_TYPE = Object.freeze({ methodCall: 1, methodReturn: 2, error: 3, signal: 4 });
const FLAG_NO_REPLY_EXPECTED = 0x1;
const PROTOCOL_VERSION = 1;
// 规范给的上限是 128 MiB；超过的就当对端出了错。
const MAX_MESSAGE_BYTES = 128 * 1024 * 1024;

const HEADER_FIELD = Object.freeze({
    path: 1,
    interface: 2,
    member: 3,
    errorName: 4,
    replySerial: 5,
    destination: 6,
    sender: 7,
    signature: 8,
});
const HEADER_FIELD_SIGNATURE = Object.freeze({
    path: 'o',
    interface: 's',
    member: 's',
    errorName: 's',
    replySerial: 'u',
    destination: 's',
    sender: 's',
    signature: 'g',
});
const HEADER_FIELD_NAME = Object.freeze(Object.fromEntries(Object.entries(HEADER_FIELD).map(([name, code]) => [code, name])));

const ALIGNMENT = Object.freeze({
    y: 1, b: 4, n: 2, q: 2, i: 4, u: 4, x: 8, t: 8, d: 8, h: 4, s: 4, o: 4, g: 1, v: 1, a: 4, '(': 8, '{': 8,
});

const align = (offset, boundary) => (offset + boundary - 1) & ~(boundary - 1);

/** 从 index 开始的那个完整类型在签名里结束的位置（不含）。 */
const completeTypeEnd = (signature, index) => {
    const code = signature[index];
    if (code === undefined) throw new TypeError(`D-Bus signature "${signature}" ends early`);
    if (code === 'a') return completeTypeEnd(signature, index + 1);
    if (code === '(' || code === '{') {
        const close = code === '(' ? ')' : '}';
        let cursor = index + 1;
        while (signature[cursor] !== close) {
            if (cursor >= signature.length) throw new TypeError(`D-Bus signature "${signature}" is not closed`);
            cursor = completeTypeEnd(signature, cursor);
        }
        return cursor + 1;
    }
    if (!(code in ALIGNMENT)) throw new TypeError(`D-Bus type "${code}" is not supported`);
    return index + 1;
};

/** 把签名拆成一个个完整类型：'sa{sv}as' → ['s', 'a{sv}', 'as']。 */
const splitSignature = signature => {
    const types = [];
    let index = 0;
    while (index < signature.length) {
        const end = completeTypeEnd(signature, index);
        types.push(signature.slice(index, end));
        index = end;
    }
    return types;
};

/** 一个变体值：签名必须是单个完整类型。 */
const variant = (signature, value) => ({ signature, value });

class Writer {
    constructor() {
        this.buffer = Buffer.alloc(256);
        this.length = 0;
    }

    reserve(bytes) {
        if (this.length + bytes <= this.buffer.length) return;
        let size = this.buffer.length * 2;
        while (size < this.length + bytes) size *= 2;
        const grown = Buffer.alloc(size);
        this.buffer.copy(grown, 0, 0, this.length);
        this.buffer = grown;
    }

    pad(boundary) {
        const target = align(this.length, boundary);
        this.reserve(target - this.length);
        this.buffer.fill(0, this.length, target);
        this.length = target;
    }

    u8(value) {
        this.reserve(1);
        this.buffer.writeUInt8(value, this.length);
        this.length += 1;
    }

    fixed(code, value) {
        this.pad(ALIGNMENT[code]);
        const size = ALIGNMENT[code];
        this.reserve(size);
        const at = this.length;
        switch (code) {
            case 'n': this.buffer.writeInt16LE(value, at); break;
            case 'q': this.buffer.writeUInt16LE(value, at); break;
            case 'i': this.buffer.writeInt32LE(value, at); break;
            case 'b': case 'u': case 'h': this.buffer.writeUInt32LE(value, at); break;
            case 'x': this.buffer.writeBigInt64LE(BigInt(value), at); break;
            case 't': this.buffer.writeBigUInt64LE(BigInt(value), at); break;
            case 'd': this.buffer.writeDoubleLE(value, at); break;
            default: throw new TypeError(`D-Bus type "${code}" is not fixed`);
        }
        this.length += size;
    }

    bytes(chunk) {
        this.reserve(chunk.length);
        chunk.copy(this.buffer, this.length);
        this.length += chunk.length;
    }

    patchU32(at, value) {
        this.buffer.writeUInt32LE(value, at);
    }

    toBuffer() {
        return Buffer.from(this.buffer.subarray(0, this.length));
    }
}

const toUtf8 = (value, code) => {
    if (typeof value !== 'string') throw new TypeError(`D-Bus ${code} needs a string`);
    const encoded = Buffer.from(value, 'utf8');
    if (encoded.includes(0)) throw new TypeError(`D-Bus ${code} cannot hold NUL`);
    return encoded;
};

// 字典的值可以是 [键, 值] 对的数组、Map 或普通对象。
const dictEntries = value => {
    if (value instanceof Map) return [...value.entries()];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.entries(value);
    throw new TypeError('D-Bus dict needs entries');
};

const writeValue = (writer, type, value) => {
    const code = type[0];
    switch (code) {
        case 'y':
            writer.u8(value);
            return;
        case 'b':
            writer.fixed('b', value ? 1 : 0);
            return;
        case 'n': case 'q': case 'i': case 'u': case 'h': case 'x': case 't': case 'd':
            writer.fixed(code, value);
            return;
        case 's': case 'o': {
            const encoded = toUtf8(value, code);
            writer.fixed('u', encoded.length);
            writer.bytes(encoded);
            writer.u8(0);
            return;
        }
        case 'g': {
            const encoded = toUtf8(value, code);
            if (encoded.length > 255) throw new TypeError('D-Bus signature is longer than 255 bytes');
            writer.u8(encoded.length);
            writer.bytes(encoded);
            writer.u8(0);
            return;
        }
        case 'v': {
            if (!value || typeof value.signature !== 'string') throw new TypeError('D-Bus variant needs a signature');
            if (splitSignature(value.signature).length !== 1) throw new TypeError('D-Bus variant holds one complete type');
            writeValue(writer, 'g', value.signature);
            writeValue(writer, value.signature, value.value);
            return;
        }
        case 'a': {
            const element = type.slice(1);
            writer.fixed('u', 0);
            const lengthAt = writer.length - 4;
            // 长度不算元素前的对齐填充。
            writer.pad(ALIGNMENT[element[0]]);
            const start = writer.length;
            if (element[0] === '{') {
                const [keyType, valueType] = splitSignature(element.slice(1, -1));
                for (const [key, entryValue] of dictEntries(value)) {
                    writer.pad(8);
                    writeValue(writer, keyType, key);
                    writeValue(writer, valueType, entryValue);
                }
            } else {
                if (!Array.isArray(value)) throw new TypeError('D-Bus array needs an array');
                for (const item of value) writeValue(writer, element, item);
            }
            writer.patchU32(lengthAt, writer.length - start);
            return;
        }
        case '(': {
            const fields = splitSignature(type.slice(1, -1));
            if (!Array.isArray(value) || value.length !== fields.length) throw new TypeError('D-Bus struct needs one value per field');
            writer.pad(8);
            fields.forEach((field, index) => writeValue(writer, field, value[index]));
            return;
        }
        default:
            throw new TypeError(`D-Bus type "${code}" is not supported`);
    }
};

/** 按签名把一组值编进一个新缓冲区；对齐从缓冲区开头算（消息体从 8 字节边界开始，和从消息开头算一样）。 */
const marshal = (signature, values) => {
    const types = splitSignature(signature);
    if (!Array.isArray(values) || values.length !== types.length) throw new TypeError('D-Bus body needs one value per type');
    const writer = new Writer();
    types.forEach((type, index) => writeValue(writer, type, values[index]));
    return writer.toBuffer();
};

class Reader {
    constructor(buffer, offset, littleEndian) {
        this.buffer = buffer;
        this.offset = offset;
        this.littleEndian = littleEndian;
    }

    need(bytes) {
        if (this.offset + bytes > this.buffer.length) throw new RangeError('D-Bus message is truncated');
    }

    skipTo(boundary) {
        const target = align(this.offset, boundary);
        this.need(target - this.offset);
        this.offset = target;
    }

    u8() {
        this.need(1);
        return this.buffer.readUInt8(this.offset++);
    }

    fixed(code) {
        this.skipTo(ALIGNMENT[code]);
        const size = ALIGNMENT[code];
        this.need(size);
        const at = this.offset;
        const le = this.littleEndian;
        let value;
        switch (code) {
            case 'n': value = le ? this.buffer.readInt16LE(at) : this.buffer.readInt16BE(at); break;
            case 'q': value = le ? this.buffer.readUInt16LE(at) : this.buffer.readUInt16BE(at); break;
            case 'i': value = le ? this.buffer.readInt32LE(at) : this.buffer.readInt32BE(at); break;
            case 'b': case 'u': case 'h': value = le ? this.buffer.readUInt32LE(at) : this.buffer.readUInt32BE(at); break;
            case 'x': value = le ? this.buffer.readBigInt64LE(at) : this.buffer.readBigInt64BE(at); break;
            case 't': value = le ? this.buffer.readBigUInt64LE(at) : this.buffer.readBigUInt64BE(at); break;
            case 'd': value = le ? this.buffer.readDoubleLE(at) : this.buffer.readDoubleBE(at); break;
            default: throw new TypeError(`D-Bus type "${code}" is not fixed`);
        }
        this.offset += size;
        return value;
    }

    text(length) {
        this.need(length + 1);
        const value = this.buffer.toString('utf8', this.offset, this.offset + length);
        this.offset += length + 1;
        return value;
    }
}

const readValue = (reader, type) => {
    const code = type[0];
    switch (code) {
        case 'y':
            return reader.u8();
        case 'b':
            return reader.fixed('b') !== 0;
        case 'n': case 'q': case 'i': case 'u': case 'h': case 'x': case 't': case 'd':
            return reader.fixed(code);
        case 's': case 'o':
            return reader.text(reader.fixed('u'));
        case 'g':
            return reader.text(reader.u8());
        case 'v': {
            const signature = readValue(reader, 'g');
            if (splitSignature(signature).length !== 1) throw new TypeError('D-Bus variant holds one complete type');
            return variant(signature, readValue(reader, signature));
        }
        case 'a': {
            const element = type.slice(1);
            const length = reader.fixed('u');
            if (length > MAX_MESSAGE_BYTES) throw new RangeError('D-Bus array is too long');
            reader.skipTo(ALIGNMENT[element[0]]);
            const end = reader.offset + length;
            reader.need(length);
            const items = [];
            if (element[0] === '{') {
                const [keyType, valueType] = splitSignature(element.slice(1, -1));
                while (reader.offset < end) {
                    reader.skipTo(8);
                    items.push([readValue(reader, keyType), readValue(reader, valueType)]);
                }
            } else {
                while (reader.offset < end) items.push(readValue(reader, element));
            }
            if (reader.offset !== end) throw new RangeError('D-Bus array length does not match its elements');
            return items;
        }
        case '(': {
            reader.skipTo(8);
            return splitSignature(type.slice(1, -1)).map(field => readValue(reader, field));
        }
        default:
            throw new TypeError(`D-Bus type "${code}" is not supported`);
    }
};

/** 拼一条消息。fields 里是 path、interface、member、errorName、replySerial、destination、sender；signature 和 body 是消息体。 */
const encodeMessage = ({ type, flags = 0, serial, signature = '', body = [], ...fields }) => {
    const bodyBytes = signature === '' ? Buffer.alloc(0) : marshal(signature, body);
    const headerFields = [];
    for (const [name, code] of Object.entries(HEADER_FIELD)) {
        const value = name === 'signature' ? (signature === '' ? undefined : signature) : fields[name];
        if (value === undefined || value === null) continue;
        headerFields.push([code, variant(HEADER_FIELD_SIGNATURE[name], value)]);
    }
    const writer = new Writer();
    writer.u8(0x6c); // 'l'：小端
    writer.u8(type);
    writer.u8(flags);
    writer.u8(PROTOCOL_VERSION);
    writer.fixed('u', bodyBytes.length);
    writer.fixed('u', serial);
    writeValue(writer, 'a(yv)', headerFields);
    writer.pad(8);
    writer.bytes(bodyBytes);
    return writer.toBuffer();
};

/** 缓冲区开头那条完整消息占的字节数；不够 16 字节时为 null。 */
const messageLength = buffer => {
    if (buffer.length < 16) return null;
    const littleEndian = buffer[0] === 0x6c;
    if (!littleEndian && buffer[0] !== 0x42) throw new TypeError('D-Bus message has an unknown byte order');
    const bodyLength = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    const fieldsLength = littleEndian ? buffer.readUInt32LE(12) : buffer.readUInt32BE(12);
    const total = align(16 + fieldsLength, 8) + bodyLength;
    if (total > MAX_MESSAGE_BYTES) throw new RangeError('D-Bus message is too large');
    return total;
};

/** 拆一条完整的消息（缓冲区正好是这条消息）。 */
const decodeMessage = buffer => {
    const littleEndian = buffer[0] === 0x6c;
    const reader = new Reader(buffer, 1, littleEndian);
    const type = reader.u8();
    const flags = reader.u8();
    const version = reader.u8();
    if (version !== PROTOCOL_VERSION) throw new TypeError(`D-Bus protocol version ${version} is not supported`);
    reader.fixed('u');
    const serial = reader.fixed('u');
    const message = { type, flags, serial, signature: '' };
    for (const [code, field] of readValue(reader, 'a(yv)')) {
        const name = HEADER_FIELD_NAME[code];
        if (name) message[name] = field.value;
    }
    reader.skipTo(8);
    message.body = message.signature === '' ? [] : splitSignature(message.signature).map(field => readValue(reader, field));
    return message;
};

const unescapeAddressValue = value => value.replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));

/**
 * 总线地址里能连的 unix 端点，按地址里的顺序：{ path } 是文件系统里的套接字，{ abstract } 是 Linux 的抽象套接字。
 * 别的传输（tcp、launchd、unixexec）和 unix 的 dir / tmpdir（只给服务端用）跳过。
 */
const parseBusAddress = address => {
    if (typeof address !== 'string') return [];
    const endpoints = [];
    for (const entry of address.split(';')) {
        const colon = entry.indexOf(':');
        if (colon < 0 || entry.slice(0, colon) !== 'unix') continue;
        const options = new Map(entry.slice(colon + 1).split(',').filter(Boolean).map(pair => {
            const equals = pair.indexOf('=');
            return equals < 0 ? [pair, ''] : [pair.slice(0, equals), unescapeAddressValue(pair.slice(equals + 1))];
        }));
        if (options.get('path')) endpoints.push({ path: options.get('path') });
        else if (options.get('abstract')) endpoints.push({ abstract: options.get('abstract') });
    }
    return endpoints;
};

/** 会话总线的地址：DBUS_SESSION_BUS_ADDRESS，没有时用 $XDG_RUNTIME_DIR/bus（systemd 的默认位置）。 */
const sessionBusAddress = env => {
    if (typeof env.DBUS_SESSION_BUS_ADDRESS === 'string' && env.DBUS_SESSION_BUS_ADDRESS !== '') return env.DBUS_SESSION_BUS_ADDRESS;
    if (typeof env.XDG_RUNTIME_DIR === 'string' && env.XDG_RUNTIME_DIR !== '') return `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
    return null;
};

/** 连上后先发的那一个空字节和 EXTERNAL 认证行：身份是本进程 uid 的十进制写法再转十六进制。 */
const authExternalLine = uid => `\0AUTH EXTERNAL ${Buffer.from(String(uid), 'ascii').toString('hex')}\r\n`;

module.exports = {
    MESSAGE_TYPE,
    FLAG_NO_REPLY_EXPECTED,
    MAX_MESSAGE_BYTES,
    splitSignature,
    variant,
    marshal,
    encodeMessage,
    messageLength,
    decodeMessage,
    parseBusAddress,
    sessionBusAddress,
    authExternalLine,
};
