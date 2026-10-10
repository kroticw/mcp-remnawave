import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startPanel, connect } from './helpers.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the server reports the package version', async () => {
    const panel = await startPanel();
    const client = await connect(panel);
    try {
        assert.equal(client.getServerVersion()?.version, pkg.version);
    } finally {
        await client.close();
        await panel.close();
    }
});
