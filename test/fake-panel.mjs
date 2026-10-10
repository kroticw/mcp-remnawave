// Preloaded into the MCP server process (`node --import`): replaces fetch with a fake
// Remnawave panel that records every request as one JSON line in FAKE_PANEL_LOG.
//
// FAKE_PANEL_ROUTES may point to a JSON file mapping "METHOD /path" to a canned
// reply `{ "status": 200, "body": <json> }`. A `null` body is sent as an empty body.
// The file is re-read on every request, so a test can change replies between calls.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

function cannedReply(method, path) {
    const file = process.env.FAKE_PANEL_ROUTES;
    if (!file || !existsSync(file)) return undefined;
    const routes = JSON.parse(readFileSync(file, 'utf8'));
    return routes[`${method} ${path}`];
}

globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    appendFileSync(
        process.env.FAKE_PANEL_LOG,
        JSON.stringify({
            method,
            url: String(url),
            headers: options.headers ?? {},
            body: options.body ? JSON.parse(options.body) : undefined,
        }) + '\n',
    );
    const path = new URL(String(url)).pathname;
    const canned = cannedReply(method, path);
    if (canned) {
        const status = canned.status ?? 200;
        const body = canned.body === null || status === 204 ? null : JSON.stringify(canned.body);
        return new Response(body, {
            status,
            headers: body === null ? {} : { 'content-type': 'application/json' },
        });
    }
    const isAuthStatus = String(url).endsWith('/api/auth/status');
    const payload = isAuthStatus
        ? { response: { branding: { title: process.env.FAKE_PANEL_TITLE ?? 'Fake Panel' } } }
        : { response: {} };
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
};
