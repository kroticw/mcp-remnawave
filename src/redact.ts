// Central redaction of secrets in everything the server hands back to the model.

export const REDACTED = '***redacted***';

/** Keys whose values are credentials, compared after lowercasing and dropping `_`/`-`. */
const SECRET_KEYS = new Set([
    'privatekey',
    'password',
    'mldsa65seed',
    'sspassword',
    'trojanpassword',
    'vlessuuid',
    'psk',
    'secretkey',
    'presharedkey',
]);

/** Suffixes that mark a credential regardless of prefix (botToken, adminPassword, ...). */
const SECRET_SUFFIXES = ['password', 'privatekey', 'secretkey', 'presharedkey'];

const TOKEN_QUERY = /([?&]token=)[^&#\s"'<>]+/gi;

/** `"password":"..."` style pairs inside free text, e.g. JSON echoed in an API error. */
const JSON_SECRET_PAIR =
    /("[A-Za-z0-9_-]*(?:password|privatekey|private_key|secretkey|secret_key|presharedkey|mldsa65seed|psk|vlessuuid)"\s*:\s*")[^"]*(")/gi;

/** `SECRET_KEY=...` / `password: ...` style assignments inside free text. */
const ASSIGNED_SECRET =
    /\b([A-Za-z0-9_-]*(?:password|private_?key|secret_?key|pre_?shared_?key|mldsa65_?seed)\s*[=:]\s*)[^\s"',;&]+/gi;

const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;

const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

let enabled = true;

export function setRedactionEnabled(value: boolean): void {
    enabled = value;
}

export function isRedactionEnabled(): boolean {
    return enabled;
}

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[_-]/g, '');
}

export function isSecretKey(key: string): boolean {
    const normalized = normalizeKey(key);
    return SECRET_KEYS.has(normalized) || SECRET_SUFFIXES.some((s) => normalized.endsWith(s));
}

export function redactString(value: string, extraSecrets: ReadonlySet<string> = new Set()): string {
    let out = value
        .replace(TOKEN_QUERY, `$1${REDACTED}`)
        .replace(PEM_PRIVATE_KEY, REDACTED)
        .replace(JSON_SECRET_PAIR, `$1${REDACTED}$2`)
        .replace(ASSIGNED_SECRET, `$1${REDACTED}`)
        .replace(BEARER, `$1${REDACTED}`);
    for (const secret of extraSecrets) {
        if (secret && out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out;
}

/**
 * Returns a deep copy of `value` with secrets replaced. Client ids inside a
 * `clients` array (Xray user credentials) are redacted as well. Strings equal to
 * or containing one of `extraSecrets` are redacted wherever they appear.
 */
export function redact(
    value: unknown,
    extraSecrets: ReadonlySet<string> = new Set(),
    force = false,
): unknown {
    if (!enabled && !force) return value;
    return walk(value, extraSecrets, undefined);
}

function walk(value: unknown, extra: ReadonlySet<string>, parentKey: string | undefined): unknown {
    if (typeof value === 'string') return redactString(value, extra);
    if (Array.isArray(value)) return value.map((item) => walk(item, extra, parentKey));
    if (value === null || typeof value !== 'object') return value;
    const inClients = parentKey === 'clients';
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const secret = isSecretKey(key) || (inClients && key === 'id');
        if (secret && child !== null && child !== undefined) {
            out[key] = REDACTED;
        } else {
            out[key] = walk(child, extra, key);
        }
    }
    return out;
}

/**
 * Redacts a value that lives at a known location, so a bare leaf such as the
 * value of `...realitySettings.privateKey` is caught by its key name.
 * `keys` are the object keys along the path; `endsWithIndex` is true when the
 * value is an array element of the last key.
 */
export function redactAtPath(
    value: unknown,
    keys: string[],
    endsWithIndex: boolean,
    extraSecrets: ReadonlySet<string> = new Set(),
): unknown {
    if (value === null || value === undefined) return value;
    const last = keys[keys.length - 1];
    if (last === undefined) return walk(value, extraSecrets, undefined);
    if (isSecretKey(last)) return REDACTED;
    if (endsWithIndex) return walk(value, extraSecrets, last);
    const holder = walk({ [last]: value }, extraSecrets, keys[keys.length - 2]) as Record<string, unknown>;
    return holder[last];
}

/** Serializes a value for the model with secrets redacted. */
export function formatJson(value: unknown): string {
    return JSON.stringify(redact(value), null, 2);
}
