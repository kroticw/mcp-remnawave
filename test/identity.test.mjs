import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, connect, toolNames } from './helpers.mjs';

let panel;

before(() => {
    panel = startPanel();
});

after(() => {
    panel.close();
});

test('the server starts when the panel title matches REMNAWAVE_EXPECTED_TITLE', async () => {
    const client = await connect(panel, {
        FAKE_PANEL_TITLE: 'Krotic Secret Hole',
        REMNAWAVE_EXPECTED_TITLE: 'Krotic Secret Hole',
    });
    try {
        assert.ok((await toolNames(client)).includes('users_get'));
    } finally {
        await client.close();
    }
});

test('the server refuses to start against a panel with another title', async () => {
    await assert.rejects(
        connect(panel, {
            FAKE_PANEL_TITLE: 'Company Panel',
            REMNAWAVE_EXPECTED_TITLE: 'Krotic Secret Hole',
        }),
    );
});

test('the server does not look at the title unless one is expected', async () => {
    panel.clear();
    const client = await connect(panel, { FAKE_PANEL_TITLE: 'Whatever' });
    try {
        await toolNames(client);
        assert.deepEqual(
            panel.read().filter((call) => call.url === '/api/auth/status'),
            [],
        );
    } finally {
        await client.close();
    }
});

test('the expected title is part of the server name shown to clients', async () => {
    const client = await connect(panel, {
        FAKE_PANEL_TITLE: 'Krotic Secret Hole',
        REMNAWAVE_EXPECTED_TITLE: 'Krotic Secret Hole',
    });
    try {
        assert.match(client.getServerVersion().name, /Krotic Secret Hole/);
    } finally {
        await client.close();
    }
});
