import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const FAKE_PANEL = fileURLToPath(new URL('./fake-panel.mjs', import.meta.url));
const PANEL_URL = 'http://panel.test';

/** Request log of the fake panel; each connected client gets its own one. */
export function startPanel() {
    const dir = mkdtempSync(join(tmpdir(), 'remnawave-mcp-test-'));
    const log = join(dir, 'requests.jsonl');
    const routes = join(dir, 'routes.json');
    writeFileSync(log, '');
    return {
        url: PANEL_URL,
        log,
        routes,
        read() {
            if (!existsSync(log)) return [];
            return readFileSync(log, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                    const call = JSON.parse(line);
                    return { ...call, url: call.url.replace(PANEL_URL, '') };
                });
        },
        clear() {
            writeFileSync(log, '');
        },
        close() {
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

/** Starts the built MCP server with a fake panel behind fetch and returns a connected client. */
export async function connect(panel, env = {}) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', FAKE_PANEL, ENTRY],
        env: {
            REMNAWAVE_BASE_URL: panel.url,
            REMNAWAVE_API_TOKEN: 'test-token',
            FAKE_PANEL_LOG: panel.log,
            FAKE_PANEL_ROUTES: panel.routes,
            ...env,
        },
        stderr: 'pipe',
    });
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(transport);
    return client;
}

export async function toolNames(client) {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
}

/** Calls a tool and returns its result plus the requests it made to the fake panel. */
export async function callOnce(client, panel, name, args = {}) {
    panel.clear();
    const result = await client.callTool({ name, arguments: args });
    return { result, calls: panel.read() };
}

/** Writes canned panel replies ("METHOD /path" -> { status, body }) for a fake panel. */
export function setRoutes(panel, routes) {
    writeFileSync(panel.routes, JSON.stringify(routes));
}

/** Parses the JSON text of a tool result. */
export function resultJson(result) {
    return JSON.parse(result.content[0].text);
}
