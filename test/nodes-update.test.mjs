import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, callOnce, setRoutes } from './helpers.mjs';

const NODE = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const IN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let panel;
let client;

before(async () => {
    panel = startPanel();
    client = await connect(panel);
    setRoutes(panel, {
        [`GET /api/nodes/${NODE}`]: {
            body: {
                response: {
                    uuid: NODE,
                    configProfile: {
                        activeConfigProfileUuid: PROFILE,
                        activeInbounds: [{ uuid: IN_A, tag: 'A' }, { uuid: IN_B, tag: 'B' }],
                    },
                },
            },
        },
        [`GET /api/config-profiles/${PROFILE}/inbounds`]: {
            body: { response: { total: 3, inbounds: [{ uuid: IN_A, tag: 'A' }, { uuid: IN_B, tag: 'B' }, { uuid: IN_C, tag: 'C' }] } },
        },
        [`GET /api/config-profiles/${OTHER}/inbounds`]: {
            body: { response: { total: 1, inbounds: [{ uuid: IN_C, tag: 'C' }] } },
        },
        'PATCH /api/nodes': { body: { response: { uuid: NODE } } },
    });
});

after(async () => {
    await client.close();
    panel.close();
});

function patchBody(calls) {
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.ok(patch, 'no PATCH sent');
    return patch.body;
}

test('addActiveInbounds by tag keeps the profile and current inbounds', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_update', { uuid: NODE, addActiveInbounds: ['C'] });
    assert.deepEqual(patchBody(calls).configProfile, {
        activeConfigProfileUuid: PROFILE,
        activeInbounds: [IN_A, IN_B, IN_C],
    });
});

test('removeActiveInbounds drops only that inbound', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_update', { uuid: NODE, removeActiveInbounds: ['A'] });
    assert.deepEqual(patchBody(calls).configProfile.activeInbounds, [IN_B]);
});

test('switching the profile resolves tags in the new profile', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_update', {
        uuid: NODE,
        configProfileUuid: OTHER,
        activeInbounds: ['C'],
    });
    assert.deepEqual(patchBody(calls).configProfile, { activeConfigProfileUuid: OTHER, activeInbounds: [IN_C] });
});

test('an unknown inbound tag fails without writing', async () => {
    const { result, calls } = await callOnce(client, panel, 'nodes_update', { uuid: NODE, addActiveInbounds: ['nope'] });
    assert.equal(result.isError, true);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('plain field updates send no configProfile', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_update', { uuid: NODE, name: 'lat-1' });
    assert.deepEqual(patchBody(calls), { uuid: NODE, name: 'lat-1' });
});
