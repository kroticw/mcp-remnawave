import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { startPanel, connect, callOnce, setRoutes, resultJson, toolNames } from './helpers.mjs';

// All secret values below are fake and exist only in this test.
const FAKE_PRIVATE_KEY = 'fake-existing-private-key-value';
const FAKE_SS_PASSWORD = 'fake-ss-inbound-password-value';
const FAKE_USER_VLESS = '12345678-aaaa-bbbb-cccc-1234567890ab';
const FAKE_USER_SS = 'fake-user-ss-password-value';

const UUID = 'profile-1';
const PROFILE_PATH = `/api/config-profiles/${UUID}`;
const UPDATE_PATH = '/api/config-profiles';

function profileConfig() {
    return {
        log: { loglevel: 'warning' },
        inbounds: [
            {
                tag: 'gtw-1-ru-tcp-apple',
                port: 443,
                streamSettings: {
                    realitySettings: { privateKey: FAKE_PRIVATE_KEY, shortIds: ['aaaa1111'] },
                },
            },
            { tag: 'twin', port: 8443 },
            { tag: 'twin', port: 8444 },
            { tag: 'ss-in', settings: { password: FAKE_SS_PASSWORD } },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    };
}

let panel;
let client;
let readonlyClient;

before(async () => {
    panel = startPanel();
    client = await connect(panel);
    readonlyClient = await connect(panel, { REMNAWAVE_READONLY: 'true' });
});

beforeEach(() => {
    setRoutes(panel, {
        [`GET ${PROFILE_PATH}`]: { body: { response: { uuid: UUID, name: 'main', config: profileConfig() } } },
        [`PATCH ${UPDATE_PATH}/`]: { body: { response: { uuid: UUID } } },
        'GET /api/users/by-username/alice': {
            body: { response: { username: 'alice', vlessUuid: FAKE_USER_VLESS, ssPassword: FAKE_USER_SS } },
        },
    });
});

after(async () => {
    await client.close();
    await readonlyClient.close();
    panel.close();
});

function patchCall(calls) {
    const updates = calls.filter((c) => c.method === 'PATCH');
    assert.equal(updates.length, 1, JSON.stringify(calls));
    assert.equal(updates[0].url.replace(/\/$/, ''), UPDATE_PATH);
    return updates[0].body;
}

function patch(args) {
    return callOnce(client, panel, 'config_profiles_patch', { uuid: UUID, ...args });
}

test('sets a field inside an array element selected by tag', async () => {
    const path = 'inbounds[tag=gtw-1-ru-tcp-apple].streamSettings.realitySettings.minClientVer';
    const { result, calls } = await patch({ operations: [{ op: 'set', path, value: '25.9.11' }] });
    assert.equal(result.isError, undefined, result.content[0].text);

    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, PROFILE_PATH);
    const body = patchCall(calls);
    assert.equal(body.uuid, UUID);
    const expected = profileConfig();
    expected.inbounds[0].streamSettings.realitySettings.minClientVer = '25.9.11';
    assert.deepEqual(body.config, expected);

    const out = resultJson(result);
    assert.equal(out.ok, true);
    assert.equal(out.uuid, UUID);
    assert.deepEqual(out.changes, [{ op: 'set', path, after: '25.9.11' }]);
    const text = result.content[0].text;
    assert.ok(!text.includes('ss-in'), 'the full config must not be returned');
    assert.ok(!text.includes(FAKE_PRIVATE_KEY));
});

test('the diff is redacted', async () => {
    const path = 'inbounds[tag=gtw-1-ru-tcp-apple].streamSettings.realitySettings';
    const { result } = await patch({
        operations: [{ op: 'set', path: `${path}.privateKey`, value: 'fake-new-private-key' }],
    });
    const text = result.content[0].text;
    assert.ok(!text.includes(FAKE_PRIVATE_KEY));
    assert.ok(!text.includes('fake-new-private-key'));
    assert.deepEqual(resultJson(result).changes[0], {
        op: 'set',
        path: `${path}.privateKey`,
        before: '***redacted***',
        after: '***redacted***',
    });
});

test('dryRun does not write', async () => {
    const { result, calls } = await patch({
        dryRun: true,
        operations: [{ op: 'set', path: 'log.loglevel', value: 'debug' }],
    });
    assert.equal(result.isError, undefined, result.content[0].text);
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
    const out = resultJson(result);
    assert.equal(out.dryRun, true);
    assert.deepEqual(out.changes, [{ op: 'set', path: 'log.loglevel', before: 'warning', after: 'debug' }]);
});

test('a selector that matches nothing fails without writing', async () => {
    const { result, calls } = await patch({
        operations: [{ op: 'set', path: 'inbounds[tag=missing].port', value: 1 }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /tag=missing.*matched no element/);
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('a selector that matches several elements fails without writing', async () => {
    const { result, calls } = await patch({
        operations: [{ op: 'set', path: 'inbounds[tag=twin].port', value: 1 }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /tag=twin.*matched 2 elements/);
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('numeric indexes, delete and append work together', async () => {
    const { result, calls } = await patch({
        operations: [
            { op: 'set', path: 'inbounds[1].port', value: 9443 },
            { op: 'delete', path: 'inbounds[tag=gtw-1-ru-tcp-apple].streamSettings.realitySettings.shortIds' },
            { op: 'append', path: 'outbounds', value: { tag: 'block', protocol: 'blackhole' } },
            { op: 'delete', path: 'inbounds[2]' },
        ],
    });
    assert.equal(result.isError, undefined, result.content[0].text);
    const expected = profileConfig();
    expected.inbounds[1].port = 9443;
    delete expected.inbounds[0].streamSettings.realitySettings.shortIds;
    expected.outbounds.push({ tag: 'block', protocol: 'blackhole' });
    expected.inbounds.splice(2, 1);
    assert.deepEqual(patchCall(calls).config, expected);

    const changes = resultJson(result).changes;
    assert.deepEqual(changes[0], { op: 'set', path: 'inbounds[1].port', before: 8443, after: 9443 });
    assert.deepEqual(changes[1].before, ['aaaa1111']);
    assert.equal('after' in changes[1], false);
    assert.deepEqual(changes[2], {
        op: 'append',
        path: 'outbounds[1]',
        after: { tag: 'block', protocol: 'blackhole' },
    });
    assert.deepEqual(changes[3].before, { tag: 'twin', port: 8444 });
});

test('deleting a path that does not exist fails', async () => {
    const { result, calls } = await patch({ operations: [{ op: 'delete', path: 'log.nothing' }] });
    assert.equal(result.isError, true);
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('set and append require a value', async () => {
    const { result } = await patch({ operations: [{ op: 'set', path: 'log.loglevel' }] });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /value/);
});

function publicKeyOf(privateKeyB64url) {
    const raw = Buffer.from(privateKeyB64url, 'base64url');
    const der = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]);
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return createPublicKey(key).export({ format: 'jwk' }).x;
}

test('generated secrets are stored but never returned', async () => {
    const inbound = {
        tag: 'new-reality',
        settings: { clients: [{ id: '$ref:user:alice.vlessUuid' }] },
        streamSettings: {
            realitySettings: {
                privateKey: '$gen:x25519.privateKey',
                shortIds: ['$gen:shortId'],
            },
        },
    };
    const ss = { tag: 'new-ss', settings: { password: '$gen:ss2022key:32', fallback: '$ref:user:alice.ssPassword' } };
    const { result, calls } = await patch({
        operations: [
            { op: 'append', path: 'inbounds', value: inbound },
            { op: 'append', path: 'inbounds', value: ss },
            { op: 'set', path: 'inbounds[tag=new-ss].settings.marker', value: '$gen:uuid' },
        ],
    });
    assert.equal(result.isError, undefined, result.content[0].text);
    const stored = patchCall(calls).config.inbounds;
    const reality = stored[4].streamSettings.realitySettings;
    assert.match(reality.privateKey, /^[A-Za-z0-9_-]{43}$/);
    assert.match(reality.shortIds[0], /^[0-9a-f]{8}$/);
    assert.equal(stored[4].settings.clients[0].id, FAKE_USER_VLESS);
    const ssKey = stored[5].settings.password;
    assert.equal(Buffer.from(ssKey, 'base64').length, 32);
    assert.equal(stored[5].settings.fallback, FAKE_USER_SS);
    assert.match(stored[5].settings.marker, /^[0-9a-f-]{36}$/);

    const text = result.content[0].text;
    for (const secret of [reality.privateKey, ssKey, FAKE_USER_VLESS, FAKE_USER_SS]) {
        assert.ok(!text.includes(secret), `secret leaked: ${text}`);
    }
    const generated = resultJson(result).generated;
    const byKind = Object.fromEntries(generated.map((g) => [g.kind, g]));
    assert.equal(byKind.x25519.publicKey, publicKeyOf(reality.privateKey));
    assert.equal(
        byKind.x25519.path,
        'inbounds[4].streamSettings.realitySettings.privateKey',
    );
    assert.equal(byKind.shortId.value, reality.shortIds[0]);
    assert.equal(byKind.uuid.value, stored[5].settings.marker);
    assert.equal(byKind.ss2022key.value, undefined);
});

test('an unknown user reference fails without writing', async () => {
    setRoutes(panel, {
        [`GET ${PROFILE_PATH}`]: { body: { response: { uuid: UUID, config: profileConfig() } } },
        'GET /api/users/by-username/ghost': { status: 404, body: { message: 'User not found' } },
    });
    const { result, calls } = await patch({
        operations: [{ op: 'set', path: 'log.x', value: '$ref:user:ghost.vlessUuid' }],
    });
    assert.equal(result.isError, true);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('readonly mode does not register config_profiles_patch', async () => {
    assert.ok((await toolNames(client)).includes('config_profiles_patch'));
    assert.ok(!(await toolNames(readonlyClient)).includes('config_profiles_patch'));
});
