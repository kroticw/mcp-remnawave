import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, toolNames, callOnce } from './helpers.mjs';

let panel;
let client;
let readonlyClient;

before(async () => {
    panel = await startPanel();
    client = await connect(panel);
    readonlyClient = await connect(panel, { REMNAWAVE_READONLY: 'true' });
});

after(async () => {
    await client.close();
    await readonlyClient.close();
    await panel.close();
});

// Remnawave 3.x addresses users by numeric id, not by uuid.
const byId = [
    ['users_get', 'GET', '/api/users/42', undefined],
    ['users_delete', 'DELETE', '/api/users/42', undefined],
    ['users_enable', 'POST', '/api/users/42/actions/enable', undefined],
    ['users_disable', 'POST', '/api/users/42/actions/disable', undefined],
    ['users_reset_traffic', 'POST', '/api/users/42/actions/reset-traffic', undefined],
    ['users_revoke_subscription', 'POST', '/api/users/42/actions/revoke', undefined],
];

for (const [tool, method, url, body] of byId) {
    test(`${tool} takes a numeric userId`, async () => {
        const { calls } = await callOnce(client, panel, tool, { userId: 42 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, method);
        assert.equal(calls[0].url, url);
        assert.deepEqual(calls[0].body, body);
    });
}

test('users_revoke_subscription can revoke only passwords', async () => {
    const { calls } = await callOnce(client, panel, 'users_revoke_subscription', {
        userId: 42,
        revokeOnlyPasswords: true,
    });
    assert.equal(calls[0].url, '/api/users/42/actions/revoke');
    assert.deepEqual(calls[0].body, { revokeOnlyPasswords: true });
});

test('users_extend_expiration extends by days', async () => {
    const { calls } = await callOnce(client, panel, 'users_extend_expiration', {
        userId: 42,
        days: 30,
    });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/api/users/42/actions/extend');
    assert.deepEqual(calls[0].body, { days: 30 });
});

test('users_update identifies the user by id', async () => {
    const { calls } = await callOnce(client, panel, 'users_update', {
        id: 42,
        status: 'DISABLED',
    });
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, '/api/users/');
    assert.deepEqual(calls[0].body, { id: 42, status: 'DISABLED' });
});

test('users_update refuses to guess which user to change', async () => {
    for (const args of [{ status: 'DISABLED' }, { id: 42, username: 'bob', status: 'DISABLED' }]) {
        const { result, calls } = await callOnce(client, panel, 'users_update', args);
        assert.equal(result.isError, true);
        assert.equal(calls.length, 0);
    }
});

test('users_resolve accepts id, shortUuid or username only', async () => {
    const { calls } = await callOnce(client, panel, 'users_resolve', { id: 42 });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/api/users/resolve');
    assert.deepEqual(calls[0].body, { id: 42 });

    const { inputSchema } = (await client.listTools()).tools.find((t) => t.name === 'users_resolve');
    assert.deepEqual(Object.keys(inputSchema.properties).sort(), ['id', 'shortUuid', 'username']);
});

test('users_stream filters by tag, email and telegram id', async () => {
    const { calls } = await callOnce(client, panel, 'users_stream', {
        size: 10,
        tag: 'STAFF',
        email: 'a@b.c',
        telegramId: 123,
    });
    assert.equal(calls[0].method, 'GET');
    const url = new URL(calls[0].url, 'http://x');
    assert.equal(url.pathname, '/api/users/stream');
    assert.equal(url.searchParams.get('size'), '10');
    assert.equal(url.searchParams.get('tag'), 'STAFF');
    assert.equal(url.searchParams.get('email'), 'a@b.c');
    assert.equal(url.searchParams.get('telegramId'), '123');
});

test('bulk user tools send userIds', async () => {
    const bulk = [
        ['users_bulk_delete', '/api/users/bulk/delete', { userIds: [1, 2] }, { userIds: [1, 2] }],
        ['users_bulk_reset_traffic', '/api/users/bulk/reset-traffic', { userIds: [1, 2] }, { userIds: [1, 2] }],
        ['users_bulk_revoke_subscription', '/api/users/bulk/revoke-subscription', { userIds: [1, 2] }, { userIds: [1, 2] }],
        [
            'users_bulk_extend_expiration',
            '/api/users/bulk/extend-expiration-date',
            { userIds: [1, 2], extendDays: 7 },
            { userIds: [1, 2], extendDays: 7 },
        ],
        [
            'users_bulk_update_squads',
            '/api/users/bulk/update-squads',
            { userIds: [1, 2], activeInternalSquads: ['5d3a8a3c-53e0-4c4a-8a2c-0f6f3b5d7c11'] },
            { userIds: [1, 2], activeInternalSquads: ['5d3a8a3c-53e0-4c4a-8a2c-0f6f3b5d7c11'] },
        ],
        [
            'users_bulk_update',
            '/api/users/bulk/update',
            { userIds: [1, 2], status: 'DISABLED', tag: 'X' },
            { userIds: [1, 2], fields: { status: 'DISABLED', tag: 'X' } },
        ],
    ];
    for (const [tool, url, args, body] of bulk) {
        const { calls } = await callOnce(client, panel, tool, args);
        assert.equal(calls.length, 1, tool);
        assert.equal(calls[0].method, 'POST', tool);
        assert.equal(calls[0].url, url, tool);
        assert.deepEqual(calls[0].body, body, tool);
    }
});

test('lookups that 3.x removed are not registered', async () => {
    const names = await toolNames(client);
    for (const gone of [
        'users_get_by_telegram_id',
        'users_get_by_email',
        'users_get_by_tag',
        'users_get_by_subscription_uuid',
    ]) {
        assert.ok(!names.includes(gone), `${gone} must be gone`);
    }
});

test('readonly mode registers no user write tools', async () => {
    const names = await toolNames(readonlyClient);
    for (const name of names) {
        assert.doesNotMatch(
            name,
            /^users_(create|update|delete|enable|disable|revoke_subscription|reset_traffic|extend_expiration|bulk_.*)$/,
            `${name} must not exist in readonly mode`,
        );
    }
    assert.ok(names.includes('users_get'));
    assert.ok(names.includes('users_stream'));
});
