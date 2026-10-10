// In-memory patching of an Xray config with a small path language:
//   key.sub            plain object keys
//   list[2]            numeric array index
//   list[tag=value]    the single array element whose field equals value
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

export type PatchOp = 'set' | 'delete' | 'append';

export interface PatchOperation {
    path: string;
    op: PatchOp;
    value?: unknown;
}

type Segment =
    | { kind: 'key'; key: string }
    | { kind: 'index'; index: number }
    | { kind: 'select'; field: string; value: string };

export interface Change {
    op: PatchOp;
    path: string;
    before?: unknown;
    after?: unknown;
}

export interface Generated {
    path: string;
    kind: 'x25519' | 'shortId' | 'uuid' | 'ss2022key' | 'userRef';
    publicKey?: string;
    value?: string;
}

/** Looks up a user's credential field (vlessUuid, ssPassword, trojanPassword). */
export type UserCredentialLookup = (username: string, field: string) => Promise<string>;

export class PatchError extends Error {}

type Container = Record<string, unknown> | unknown[];

export function parsePath(path: string): Segment[] {
    const segments: Segment[] = [];
    let i = 0;
    let expectKey = true;
    while (i < path.length) {
        const ch = path[i];
        if (ch === '[') {
            const end = path.indexOf(']', i);
            if (end === -1) throw new PatchError(`Unclosed "[" in path "${path}"`);
            segments.push(parseBracket(path.slice(i + 1, end), path));
            i = end + 1;
            expectKey = false;
        } else if (ch === '.') {
            if (expectKey) throw new PatchError(`Empty key in path "${path}"`);
            i += 1;
            expectKey = true;
        } else {
            if (!expectKey) throw new PatchError(`Expected "." or "[" at position ${i} in path "${path}"`);
            let end = i;
            while (end < path.length && path[end] !== '.' && path[end] !== '[') end += 1;
            segments.push({ kind: 'key', key: path.slice(i, end) });
            i = end;
            expectKey = false;
        }
    }
    if (segments.length === 0 || expectKey) throw new PatchError(`Invalid path "${path}"`);
    return segments;
}

function parseBracket(inner: string, path: string): Segment {
    if (/^\d+$/.test(inner)) return { kind: 'index', index: Number(inner) };
    const eq = inner.indexOf('=');
    if (eq <= 0) throw new PatchError(`Invalid selector "[${inner}]" in path "${path}"`);
    let value = inner.slice(eq + 1);
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    return { kind: 'select', field: inner.slice(0, eq).trim(), value };
}

/** Object keys along a path and whether it ends on an array element. */
export function pathKeys(path: string): { keys: string[]; endsWithIndex: boolean } {
    const segments = parsePath(path);
    const keys = segments.flatMap((s) => (s.kind === 'key' ? [s.key] : []));
    return { keys, endsWithIndex: segments[segments.length - 1].kind !== 'key' };
}

function formatSegment(seg: Segment, first: boolean): string {
    if (seg.kind === 'key') return first ? seg.key : `.${seg.key}`;
    if (seg.kind === 'index') return `[${seg.index}]`;
    return `[${seg.field}=${seg.value}]`;
}

function formatPath(segments: Segment[]): string {
    return segments.map((s, i) => formatSegment(s, i === 0)).join('');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
}

/** Resolves an array segment (index or selector) to a concrete index. */
function arrayIndex(arr: unknown[], seg: Segment, at: string): number {
    if (seg.kind === 'index') {
        if (seg.index >= arr.length) {
            throw new PatchError(`Index [${seg.index}] at "${at}" is out of range (length ${arr.length})`);
        }
        return seg.index;
    }
    if (seg.kind !== 'select') throw new PatchError(`Unexpected key at "${at}"`);
    const hits: number[] = [];
    arr.forEach((el, idx) => {
        if (isObject(el) && el[seg.field] !== undefined && String(el[seg.field]) === seg.value) hits.push(idx);
    });
    const sel = `[${seg.field}=${seg.value}]`;
    if (hits.length === 0) throw new PatchError(`Selector ${sel} at "${at}" matched no element`);
    if (hits.length > 1) throw new PatchError(`Selector ${sel} at "${at}" matched ${hits.length} elements`);
    return hits[0];
}

/** Walks to the container holding the last segment, creating missing objects if allowed. */
function walkToParent(root: Record<string, unknown>, segments: Segment[], create: boolean): Container {
    let cur: unknown = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const seg = segments[i];
        const at = formatPath(segments.slice(0, i)) || '<root>';
        const here = formatPath(segments.slice(0, i + 1));
        if (seg.kind === 'key') {
            if (!isObject(cur)) throw new PatchError(`"${at}" is not an object`);
            if (cur[seg.key] === undefined) {
                if (!create || segments[i + 1].kind !== 'key') {
                    throw new PatchError(`Path "${here}" does not exist`);
                }
                cur[seg.key] = {};
            }
            cur = cur[seg.key];
        } else {
            if (!Array.isArray(cur)) throw new PatchError(`"${at}" is not an array`);
            cur = cur[arrayIndex(cur, seg, at)];
        }
    }
    if (cur === null || typeof cur !== 'object') {
        throw new PatchError(`Parent of "${formatPath(segments)}" is not an object or array`);
    }
    return cur as Container;
}

/** Applies one already-resolved operation and returns the change plus the concrete path it touched. */
export function applyOperation(
    root: Record<string, unknown>,
    operation: PatchOperation,
): { change: Change; touchedPath: string } {
    const { op, path, value } = operation;
    const segments = parsePath(path);
    const last = segments[segments.length - 1];
    const parent = walkToParent(root, segments, op !== 'delete');
    const lastAt = formatPath(segments.slice(0, -1)) || '<root>';

    if (op === 'append') {
        let target: unknown;
        if (last.kind === 'key') {
            if (!isObject(parent)) throw new PatchError(`"${lastAt}" is not an object`);
            if (parent[last.key] === undefined) parent[last.key] = [];
            target = parent[last.key];
        } else {
            if (!Array.isArray(parent)) throw new PatchError(`"${lastAt}" is not an array`);
            target = parent[arrayIndex(parent, last, lastAt)];
        }
        if (!Array.isArray(target)) throw new PatchError(`"${path}" is not an array, cannot append`);
        target.push(value);
        const touchedPath = `${path}[${target.length - 1}]`;
        return { change: { op, path: touchedPath, after: clone(value) }, touchedPath };
    }

    if (last.kind === 'key') {
        if (!isObject(parent)) throw new PatchError(`"${lastAt}" is not an object`);
        const exists = Object.prototype.hasOwnProperty.call(parent, last.key);
        const before = exists ? clone(parent[last.key]) : undefined;
        if (op === 'delete') {
            if (!exists) throw new PatchError(`Path "${path}" does not exist`);
            delete parent[last.key];
        } else {
            parent[last.key] = value;
        }
        return { change: changeOf(op, path, before, value), touchedPath: path };
    }

    if (!Array.isArray(parent)) throw new PatchError(`"${lastAt}" is not an array`);
    const idx = arrayIndex(parent, last, lastAt);
    const before = clone(parent[idx]);
    if (op === 'delete') parent.splice(idx, 1);
    else parent[idx] = value;
    return { change: changeOf(op, path, before, value), touchedPath: path };
}

function changeOf(op: PatchOp, path: string, before: unknown, value: unknown): Change {
    const change: Change = { op, path };
    if (before !== undefined) change.before = before;
    if (op !== 'delete') change.after = clone(value);
    return change;
}

// Placeholders --------------------------------------------------------------

const USER_REF_FIELDS = new Set(['vlessUuid', 'ssPassword', 'trojanPassword']);

/** X25519 key pair as raw 32-byte keys, base64url without padding (the Xray format). */
export function generateX25519(): { privateKey: string; publicKey: string } {
    const { privateKey, publicKey } = generateKeyPairSync('x25519');
    const priv = privateKey.export({ format: 'jwk' }).d;
    const pub = publicKey.export({ format: 'jwk' }).x;
    if (!priv || !pub) throw new Error('Failed to export X25519 key pair');
    return { privateKey: priv, publicKey: pub };
}

export interface ResolvedValue {
    value: unknown;
    /** Generated items with paths relative to the operation value. */
    generated: Generated[];
    /** Secret strings that must never appear in output. */
    secrets: string[];
}

/**
 * Replaces `$gen:` and `$ref:` placeholders inside a value. Generated private
 * material and referenced credentials are reported as secrets so the caller can
 * scrub them from any output.
 */
export async function resolvePlaceholders(
    value: unknown,
    lookupUser: UserCredentialLookup,
): Promise<ResolvedValue> {
    const generated: Generated[] = [];
    const secrets: string[] = [];

    async function visit(node: unknown, rel: string): Promise<unknown> {
        if (typeof node === 'string') return resolveString(node, rel);
        if (Array.isArray(node)) {
            const out: unknown[] = [];
            for (let i = 0; i < node.length; i += 1) out.push(await visit(node[i], `${rel}[${i}]`));
            return out;
        }
        if (isObject(node)) {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(node)) out[k] = await visit(v, `${rel}.${k}`);
            return out;
        }
        return node;
    }

    async function resolveString(str: string, rel: string): Promise<string> {
        if (!str.startsWith('$gen:') && !str.startsWith('$ref:')) return str;
        if (str === '$gen:x25519.privateKey') {
            const pair = generateX25519();
            secrets.push(pair.privateKey);
            generated.push({ path: rel, kind: 'x25519', publicKey: pair.publicKey });
            return pair.privateKey;
        }
        if (str === '$gen:shortId') {
            const id = randomBytes(4).toString('hex');
            generated.push({ path: rel, kind: 'shortId', value: id });
            return id;
        }
        if (str === '$gen:uuid') {
            const id = randomUUID();
            generated.push({ path: rel, kind: 'uuid', value: id });
            return id;
        }
        const ss = /^\$gen:ss2022key:(\d+)$/.exec(str);
        if (ss) {
            const size = Number(ss[1]);
            if (size < 1 || size > 64) throw new PatchError(`${str}: key size must be 1..64 bytes`);
            const key = randomBytes(size).toString('base64');
            secrets.push(key);
            generated.push({ path: rel, kind: 'ss2022key' });
            return key;
        }
        const ref = /^\$ref:user:(.+)\.([A-Za-z]+)$/.exec(str);
        if (ref) {
            const [, username, field] = ref;
            if (!USER_REF_FIELDS.has(field)) {
                throw new PatchError(`${str}: field must be one of ${[...USER_REF_FIELDS].join(', ')}`);
            }
            const credential = await lookupUser(username, field);
            secrets.push(credential);
            generated.push({ path: rel, kind: 'userRef' });
            return credential;
        }
        throw new PatchError(`Unknown placeholder "${str}"`);
    }

    const resolved = await visit(value, '');
    return { value: resolved, generated, secrets };
}
