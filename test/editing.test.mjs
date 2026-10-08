import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, callOnce } from './helpers.mjs';

let panel;
let client;

// Contract routes end with a slash (`/api/nodes/`); the panel accepts both.
const path = (call) => call.url.replace(/\/$/, '');

before(async () => {
    panel = await startPanel();
    client = await connect(panel);
});

after(async () => {
    await client.close();
    await panel.close();
});

const config = {
    inbounds: [{ tag: 'vless-tls', port: 443, protocol: 'vless' }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
};

test('config_profiles_update sends the Xray config', async () => {
    const { calls } = await callOnce(client, panel, 'config_profiles_update', {
        uuid: 'p1',
        config,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(path(calls[0]), '/api/config-profiles');
    assert.deepEqual(calls[0].body, { uuid: 'p1', config });
});

test('config_profiles_update still renames without a config', async () => {
    const { calls } = await callOnce(client, panel, 'config_profiles_update', {
        uuid: 'p1',
        name: 'renamed',
    });
    assert.deepEqual(calls[0].body, { uuid: 'p1', name: 'renamed' });
});

test('nodes_update sets the profile and active inbounds', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_update', {
        uuid: 'n1',
        activeConfigProfileUuid: 'p1',
        activeInbounds: ['i1', 'i2'],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(path(calls[0]), '/api/nodes');
    assert.deepEqual(calls[0].body, {
        uuid: 'n1',
        configProfile: { activeConfigProfileUuid: 'p1', activeInbounds: ['i1', 'i2'] },
    });
});

test('nodes_update keeps plain fields outside configProfile', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_update', {
        uuid: 'n1',
        name: 'node',
    });
    assert.deepEqual(calls[0].body, { uuid: 'n1', name: 'node' });
});

test('nodes_update refuses active inbounds without a profile', async () => {
    const { result, calls } = await callOnce(client, panel, 'nodes_update', {
        uuid: 'n1',
        activeInbounds: ['i1'],
    });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
});

test('nodes_update refuses a profile without active inbounds', async () => {
    const { result, calls } = await callOnce(client, panel, 'nodes_update', {
        uuid: 'n1',
        activeConfigProfileUuid: 'p1',
    });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
});

test('squads_update sets the inbounds', async () => {
    const { calls } = await callOnce(client, panel, 'squads_update', {
        uuid: 's1',
        inbounds: ['i1', 'i2'],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(path(calls[0]), '/api/internal-squads');
    assert.deepEqual(calls[0].body, { uuid: 's1', inbounds: ['i1', 'i2'] });
});
