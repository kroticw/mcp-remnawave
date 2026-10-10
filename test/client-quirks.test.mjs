import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, callOnce, setRoutes, resultJson } from './helpers.mjs';

let panel;
let client;

before(async () => {
    panel = startPanel();
    client = await connect(panel);
});

after(async () => {
    await client.close();
    panel.close();
});

for (const status of [200, 204]) {
    test(`an empty body with status ${status} is a success`, async () => {
        setRoutes(panel, { 'PATCH /api/hosts/bulk/update': { status, body: null } });
        const { result, calls } = await callOnce(client, panel, 'hosts_bulk_update', {
            uuids: ['h1'],
            port: 443,
        });
        assert.equal(result.isError, undefined, result.content[0].text);
        assert.deepEqual(resultJson(result), { ok: true });
        assert.equal(calls.length, 1);
    });
}

// RestartNodeCommand and RestartAllNodesCommand in the 3.4 contract require
// a body with a boolean forceRestart; an empty body fails validation.
test('nodes_restart sends forceRestart=false by default', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_restart', { uuid: 'n1' });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/api/nodes/n1/actions/restart');
    assert.deepEqual(calls[0].body, { forceRestart: false });
});

test('nodes_restart can force a restart', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_restart', { uuid: 'n1', forceRestart: true });
    assert.deepEqual(calls[0].body, { forceRestart: true });
});

test('nodes_restart_all sends forceRestart', async () => {
    const { calls } = await callOnce(client, panel, 'nodes_restart_all');
    assert.equal(calls[0].url, '/api/nodes/actions/restart-all');
    assert.deepEqual(calls[0].body, { forceRestart: false });
    const forced = await callOnce(client, panel, 'nodes_restart_all', { forceRestart: true });
    assert.deepEqual(forced.calls[0].body, { forceRestart: true });
});
