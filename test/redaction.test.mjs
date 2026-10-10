import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, callOnce, setRoutes, resultJson } from './helpers.mjs';

// All secret values below are fake and exist only in this test.
const FAKE = {
    vlessUuid: '11111111-2222-3333-4444-555555555555',
    ssPassword: 'fake-ss-password-value',
    trojanPassword: 'fake-trojan-password-value',
    privateKey: 'fake-x25519-private-key-value',
    publicKey: 'fake-x25519-public-key-value',
    mldsa65Seed: 'fake-mldsa65-seed-value',
    password: 'fake-plain-password-value',
    psk: 'fake-psk-value',
    preSharedKey: 'fake-preshared-key-value',
    secretKey: 'fake-node-secret-key-value',
    envSecret: 'fake-env-secret-key-value',
    subToken: 'fake-subscription-token-value',
    clientId: '99999999-8888-7777-6666-555555555555',
    embeddedPassword: 'fake-embedded-password-value',
    envLineSecret: 'fake-env-line-secret-value',
    pemBody: 'ZmFrZS1wZW0tcHJpdmF0ZS1rZXktYm9keQ',
    bearer: 'fake-bearer-token-value',
};

const user = {
    response: {
        id: 42,
        username: 'alice',
        vlessUuid: FAKE.vlessUuid,
        ssPassword: FAKE.ssPassword,
        trojanPassword: FAKE.trojanPassword,
        subscriptionUrl: `https://sub.example.com/api/sub?token=${FAKE.subToken}&format=json`,
    },
};

const profile = {
    response: {
        uuid: 'profile-1',
        name: 'main',
        config: {
            inbounds: [
                {
                    tag: 'reality-in',
                    settings: { clients: [{ id: FAKE.clientId, flow: 'xtls-rprx-vision' }] },
                    streamSettings: {
                        realitySettings: {
                            privateKey: FAKE.privateKey,
                            publicKey: FAKE.publicKey,
                            mldsa65Seed: FAKE.mldsa65Seed,
                            shortIds: ['abcd1234'],
                        },
                    },
                },
                { tag: 'ss-in', settings: { password: FAKE.password } },
                { tag: 'wg-in', settings: { peers: [{ preSharedKey: FAKE.preSharedKey, psk: FAKE.psk }] } },
            ],
            env: { SECRET_KEY: FAKE.envSecret, secret_key: FAKE.envSecret },
        },
    },
};

let panel;
let client;
let plainPanel;
let plainClient;

before(async () => {
    panel = startPanel();
    client = await connect(panel);
    plainPanel = startPanel();
    plainClient = await connect(plainPanel, { REMNAWAVE_REDACT: 'false' });
    const routes = {
        'GET /api/users/by-username/alice': { body: user },
        'GET /api/config-profiles/profile-1': { body: profile },
        'GET /api/keygen/': { body: { response: { secretKey: FAKE.secretKey } } },
        'GET /api/users/by-username/leaky': {
            status: 400,
            body: {
                message: `Validation failed: {"settings":{"password":"${FAKE.embeddedPassword}"}} SECRET_KEY=${FAKE.envLineSecret} Authorization: Bearer ${FAKE.bearer}`,
            },
        },
        'GET /api/users/by-username/pem': {
            body: {
                response: {
                    username: 'pem',
                    description: `node cert -----BEGIN PRIVATE KEY-----\n${FAKE.pemBody}\n-----END PRIVATE KEY----- tail`,
                },
            },
        },
        'GET /api/users/by-username/broken': {
            status: 400,
            body: { message: `Lookup failed for https://sub.example.com/x?token=${FAKE.subToken}` },
        },
    };
    setRoutes(panel, routes);
    setRoutes(plainPanel, routes);
});

after(async () => {
    await client.close();
    await plainClient.close();
    panel.close();
    plainPanel.close();
});

function assertNoSecrets(text, keep = []) {
    for (const [name, value] of Object.entries(FAKE)) {
        if (keep.includes(name)) continue;
        assert.ok(!text.includes(value), `${name} leaked: ${text}`);
    }
}

test('user credentials are redacted', async () => {
    const { result } = await callOnce(client, panel, 'users_get_by_username', { username: 'alice' });
    const text = result.content[0].text;
    assertNoSecrets(text);
    const body = resultJson(result).response;
    assert.equal(body.vlessUuid, '***redacted***');
    assert.equal(body.ssPassword, '***redacted***');
    assert.equal(body.trojanPassword, '***redacted***');
    assert.equal(body.username, 'alice');
});

test('token query values are redacted inside strings', async () => {
    const { result } = await callOnce(client, panel, 'users_get_by_username', { username: 'alice' });
    const url = resultJson(result).response.subscriptionUrl;
    assert.equal(url, 'https://sub.example.com/api/sub?token=***redacted***&format=json');
});

test('config profile secrets are redacted, public values stay', async () => {
    const { result } = await callOnce(client, panel, 'config_profiles_get', { uuid: 'profile-1' });
    const text = result.content[0].text;
    assertNoSecrets(text, ['publicKey']);
    const config = resultJson(result).response.config;
    const reality = config.inbounds[0].streamSettings.realitySettings;
    assert.equal(reality.privateKey, '***redacted***');
    assert.equal(reality.mldsa65Seed, '***redacted***');
    assert.equal(reality.publicKey, FAKE.publicKey);
    assert.deepEqual(reality.shortIds, ['abcd1234']);
    assert.equal(config.inbounds[0].settings.clients[0].id, '***redacted***');
    assert.equal(config.inbounds[0].settings.clients[0].flow, 'xtls-rprx-vision');
    assert.equal(config.env.SECRET_KEY, '***redacted***');
});

test('node secret key from keygen is redacted', async () => {
    const { result } = await callOnce(client, panel, 'keygen_get');
    assert.equal(resultJson(result).response.secretKey, '***redacted***');
});

test('error messages are redacted too', async () => {
    const { result } = await callOnce(client, panel, 'users_get_by_username', { username: 'broken' });
    assert.equal(result.isError, true);
    const text = result.content[0].text;
    assert.ok(!text.includes(FAKE.subToken), text);
    assert.match(text, /token=\*\*\*redacted\*\*\*/);
});

test('REMNAWAVE_REDACT=false turns redaction off', async () => {
    const { result } = await callOnce(plainClient, plainPanel, 'users_get_by_username', { username: 'alice' });
    assert.equal(resultJson(result).response.ssPassword, FAKE.ssPassword);
});

test('secrets embedded in error text are redacted', async () => {
    const { result } = await callOnce(client, panel, 'users_get_by_username', { username: 'leaky' });
    assert.equal(result.isError, true);
    const text = result.content[0].text;
    for (const v of [FAKE.embeddedPassword, FAKE.envLineSecret, FAKE.bearer]) assert.ok(!text.includes(v), text);
});

test('PEM private keys inside string fields are redacted', async () => {
    const { result } = await callOnce(client, panel, 'users_get_by_username', { username: 'pem' });
    const text = result.content[0].text;
    assert.ok(!text.includes(FAKE.pemBody), text);
    assert.match(resultJson(result).response.description, /tail$/);
});
