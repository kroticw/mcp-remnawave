import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, toolNames, callOnce } from './helpers.mjs';

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

const SQUAD = '5d3a8a3c-53e0-4c4a-8a2c-0f6f3b5d7c11';
const NODE = '9a7c3c1e-2b8d-4f47-9a53-1d6a8f0e4b22';

// [tool, args, method, url, body]
const cases = [
    ['subscriptions_get_by_id', { userId: 42 }, 'GET', '/api/subscriptions/by-id/42', undefined],
    ['subscriptions_get_connection_keys', { userId: 42 }, 'GET', '/api/subscriptions/connection-keys/42', undefined],
    ['hwid_devices_list', { userId: 42 }, 'GET', '/api/hwid/devices/42', undefined],
    ['hwid_devices_list_all', { start: 0, size: 25 }, 'GET', '/api/hwid/devices?start=0&size=25', undefined],
    [
        'hwid_device_create',
        { userId: 42, hwid: 'abc', platform: 'ios' },
        'POST',
        '/api/hwid/devices',
        { userId: 42, hwid: 'abc', platform: 'ios' },
    ],
    ['hwid_device_delete', { userId: 42, hwid: 'abc' }, 'POST', '/api/hwid/devices/delete', { userId: 42, hwid: 'abc' }],
    ['hwid_devices_delete_all', { userId: 42 }, 'POST', '/api/hwid/devices/delete-all', { userId: 42 }],
    ['metadata_user_get', { userId: 42 }, 'GET', '/api/metadata/user/42', undefined],
    ['metadata_user_upsert', { userId: 42, metadata: { a: 1 } }, 'PUT', '/api/metadata/user/42', { metadata: { a: 1 } }],
    ['metadata_node_upsert', { uuid: NODE, metadata: { a: 1 } }, 'PUT', `/api/metadata/node/${NODE}`, { metadata: { a: 1 } }],
    ['connections_by_user', { userId: 42 }, 'POST', '/api/connections/by-user/42', undefined],
    ['connections_by_user_result', { jobId: 'job-1' }, 'GET', '/api/connections/by-user/job-1', undefined],
    ['connections_by_node', { nodeUuid: NODE }, 'POST', `/api/connections/by-node/${NODE}`, undefined],
    ['connections_by_node_result', { jobId: 'job-2' }, 'GET', '/api/connections/by-node/job-2', undefined],
    [
        'connections_drop',
        {
            dropBy: { by: 'userIds', userIds: [42] },
            targetNodes: { target: 'allNodes' },
        },
        'POST',
        '/api/connections/drop',
        { dropBy: { by: 'userIds', userIds: [42] }, targetNodes: { target: 'allNodes' } },
    ],
    [
        'squads_add_users',
        { squadUuid: SQUAD, userIds: [1, 2] },
        'POST',
        `/api/internal-squads/${SQUAD}/bulk-actions/add-many-users`,
        { userIds: [1, 2] },
    ],
    [
        'squads_remove_users',
        { squadUuid: SQUAD, userIds: [1, 2] },
        'DELETE',
        `/api/internal-squads/${SQUAD}/bulk-actions/remove-many-users`,
        { userIds: [1, 2] },
    ],
    [
        'external_squads_add_all_users',
        { squadUuid: SQUAD, confirmAllUsers: true },
        'POST',
        `/api/external-squads/${SQUAD}/bulk-actions/add-users`,
        undefined,
    ],
    [
        'external_squads_remove_all_users',
        { squadUuid: SQUAD, confirmAllUsers: true },
        'DELETE',
        `/api/external-squads/${SQUAD}/bulk-actions/remove-users`,
        undefined,
    ],
    [
        'hosts_bulk_update',
        { uuids: [SQUAD], port: 8443, isDisabled: false },
        'PATCH',
        '/api/hosts/bulk/update',
        { uuids: [SQUAD], port: 8443, isDisabled: false },
    ],
    ['hosts_clone', { cloneFromUuid: SQUAD }, 'POST', '/api/hosts/actions/clone', { cloneFromUuid: SQUAD }],
    ['node_plugins_torrent_truncate', {}, 'DELETE', '/api/node-plugins/torrent-blocker/truncate', undefined],
];

for (const [tool, args, method, url, body] of cases) {
    test(`${tool} talks to the 3.x API`, async () => {
        const { result, calls } = await callOnce(client, panel, tool, args);
        assert.notEqual(result.isError, true, JSON.stringify(result.content));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, method);
        assert.equal(calls[0].url, url);
        assert.deepEqual(calls[0].body, body);
    });
}

test('squad membership tools cannot be turned into "all users" by omitting the ids', async () => {
    for (const [tool, args] of [
        ['squads_add_users', { squadUuid: SQUAD }],
        ['squads_remove_users', { squadUuid: SQUAD }],
        ['squads_add_users', { squadUuid: SQUAD, userIds: [] }],
    ]) {
        const { result, calls } = await callOnce(client, panel, tool, args);
        assert.equal(result.isError, true, tool);
        assert.equal(calls.length, 0, tool);
    }
});

test('affecting all users of an external squad needs an explicit confirmation', async () => {
    for (const tool of ['external_squads_add_all_users', 'external_squads_remove_all_users']) {
        for (const args of [{ squadUuid: SQUAD }, { squadUuid: SQUAD, confirmAllUsers: false }]) {
            const { result, calls } = await callOnce(client, panel, tool, args);
            assert.equal(result.isError, true, tool);
            assert.equal(calls.length, 0, tool);
        }
    }
});

test('tools whose 3.x endpoints are gone or renamed are not registered', async () => {
    const names = await toolNames(client);
    for (const gone of [
        'subscriptions_list',
        'subscriptions_get_by_uuid',
        'hosts_bulk_set_inbound',
        'hosts_bulk_set_port',
        'external_squads_add_users',
        'external_squads_remove_users',
        'ip_control_fetch_ips',
        'ip_control_get_fetch_ips_result',
        'ip_control_fetch_users_ips',
        'ip_control_get_fetch_users_ips_result',
        'ip_control_drop_connections',
        // Token management is forbidden for API tokens in 3.x (admin JWT only), so these could never work.
        'api_tokens_list',
        'api_tokens_create',
        'api_tokens_delete',
    ]) {
        assert.ok(!names.includes(gone), `${gone} must be gone`);
    }
});
