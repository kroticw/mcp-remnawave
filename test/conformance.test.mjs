import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPanel, connect } from './helpers.mjs';

const contract = createRequire(import.meta.url)('@remnawave/backend-contract');

/** Every command of the installed contract: method, path pattern and token scope kind. */
const commands = Object.entries(contract)
    .filter(([name, cmd]) => name.endsWith('Command') && cmd?.endpointDetails)
    .map(([name, cmd]) => {
        const path = normalize(typeof cmd.url === 'string' ? cmd.url : cmd.TSQ_url);
        return {
            name,
            method: cmd.endpointDetails.REQUEST_METHOD.toUpperCase(),
            path,
            kind: cmd.endpointDetails.SCOPE_KIND,
            isStatic: !path.includes(':'),
            regex: new RegExp(`^${path.replace(/:[A-Za-z]+/g, '[^/]+')}$`),
        };
    });

function normalize(url) {
    const path = url.split('?')[0].replace(/\/+$/, '');
    return path || '/';
}

function matching(method, url) {
    const path = normalize(url);
    const hits = commands.filter((c) => c.method === method && c.regex.test(path));
    const exact = hits.filter((c) => c.isStatic);
    return exact.length > 0 ? exact : hits;
}

/** Builds arguments that satisfy a tool's JSON input schema (required properties only). */
function synthesize(schema) {
    if (!schema) return {};
    if (schema.const !== undefined) return schema.const;
    if (schema.enum) return schema.enum[0];
    if (schema.anyOf) return synthesize(schema.anyOf[0]);
    if (schema.oneOf) return synthesize(schema.oneOf[0]);
    switch (schema.type) {
        case 'string':
            return 'x';
        case 'number':
        case 'integer':
            return 1;
        case 'boolean':
            return true;
        case 'array':
            return Array.from({ length: schema.minItems ?? 1 }, () => synthesize(schema.items));
        case 'object': {
            const out = {};
            for (const key of schema.required ?? []) out[key] = synthesize(schema.properties?.[key]);
            return out;
        }
        default:
            return {};
    }
}

let panel;
let full;
let readonly;

before(async () => {
    panel = startPanel();
    full = await connect(panel);
    readonly = await connect(panel, { REMNAWAVE_READONLY: 'true' });
});

after(async () => {
    await full.close();
    await readonly.close();
    panel.close();
});

async function requestsOf(client) {
    const { tools } = await client.listTools();
    const seen = [];
    for (const tool of tools) {
        panel.clear();
        const result = await client.callTool({ name: tool.name, arguments: synthesize(tool.inputSchema) });
        seen.push({ tool: tool.name, isError: result.isError === true, calls: panel.read() });
    }
    return seen;
}

test('every request a tool makes is an endpoint of the installed contract', async () => {
    const problems = [];
    for (const { tool, calls } of await requestsOf(full)) {
        for (const call of calls) {
            if (matching(call.method, call.url).length === 0) {
                problems.push(`${tool}: ${call.method} ${call.url} is not in the contract`);
            }
        }
    }
    assert.deepEqual(problems, []);
});

test('readonly mode only ever reaches read endpoints', async () => {
    const problems = [];
    for (const { tool, calls } of await requestsOf(readonly)) {
        for (const call of calls) {
            const hits = matching(call.method, call.url);
            if (hits.length === 0 || hits.some((c) => c.kind !== 'read')) {
                const kinds = hits.map((c) => `${c.name}:${c.kind}`).join(', ') || 'no such endpoint';
                problems.push(`${tool}: ${call.method} ${call.url} -> ${kinds}`);
            }
        }
    }
    assert.deepEqual(problems, []);
});

test('every readonly tool can be exercised against the fake panel', async () => {
    const problems = [];
    for (const { tool, calls } of await requestsOf(readonly)) {
        if (calls.length === 0) problems.push(`${tool}: made no request (fix the synthetic arguments or drop the tool)`);
    }
    assert.deepEqual(problems, []);
});
