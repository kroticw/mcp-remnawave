import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, callOnce, setRoutes } from './helpers.mjs';

const SQUAD = '11111111-1111-4111-8111-111111111111';
const IN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let panel;
let client;

before(async () => {
    panel = startPanel();
    client = await connect(panel);
    setRoutes(panel, {
        [`GET /api/internal-squads/${SQUAD}`]: {
            body: { response: { uuid: SQUAD, name: 'bridge', inbounds: [{ uuid: IN_A, tag: 'A' }, { uuid: IN_B, tag: 'B' }] } },
        },
        'GET /api/config-profiles/inbounds': {
            body: { response: { total: 3, inbounds: [{ uuid: IN_A, tag: 'A' }, { uuid: IN_B, tag: 'B' }, { uuid: IN_C, tag: 'C' }] } },
        },
        'PATCH /api/internal-squads': { body: { response: { uuid: SQUAD } } },
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

test('inbounds replaces the list', async () => {
    const { calls } = await callOnce(client, panel, 'squads_update', { uuid: SQUAD, inbounds: [IN_C] });
    assert.deepEqual(patchBody(calls), { uuid: SQUAD, inbounds: [IN_C] });
});

test('addInbounds by tag keeps the current inbounds', async () => {
    const { calls } = await callOnce(client, panel, 'squads_update', { uuid: SQUAD, addInbounds: ['tag:C'] });
    assert.deepEqual(patchBody(calls), { uuid: SQUAD, inbounds: [IN_A, IN_B, IN_C] });
});

test('removeInbounds by uuid drops only that inbound', async () => {
    const { calls } = await callOnce(client, panel, 'squads_update', { uuid: SQUAD, removeInbounds: [IN_A] });
    assert.deepEqual(patchBody(calls), { uuid: SQUAD, inbounds: [IN_B] });
});

test('an unknown inbound tag fails without writing', async () => {
    const { result, calls } = await callOnce(client, panel, 'squads_update', { uuid: SQUAD, addInbounds: ['tag:nope'] });
    assert.equal(result.isError, true);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('name-only update still works', async () => {
    const { calls } = await callOnce(client, panel, 'squads_update', { uuid: SQUAD, name: 'renamed' });
    assert.deepEqual(patchBody(calls), { uuid: SQUAD, name: 'renamed' });
});
