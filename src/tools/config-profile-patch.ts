import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import {
    applyOperation,
    Change,
    Generated,
    PatchError,
    PatchOperation,
    pathKeys,
    resolvePlaceholders,
} from '../config-patch.js';
import { redact, redactAtPath, redactString } from '../redact.js';
import { toolError } from './helpers.js';

const DESCRIPTION = `Patch the Xray config of a config profile in place without returning the full config.
The server fetches the profile, applies the operations in memory and writes the whole config back (unless dryRun).
The response holds only a redacted before/after diff of the touched paths.

Path syntax: plain keys "log.loglevel", numeric indexes "inbounds[0].port",
selectors "inbounds[tag=my-inbound].streamSettings.realitySettings.minClientVer" (must match exactly one element).
Operations: set (create or replace), delete (remove key or array element), append (push onto an array, created if missing).

Value placeholders, resolved server-side anywhere inside a value:
- "$gen:x25519.privateKey" generates an X25519 key pair, stores the private key, returns the public key
- "$gen:shortId" 8 random hex chars (returned)
- "$gen:uuid" random UUID (returned)
- "$gen:ss2022key:<bytes>" random base64 key (not returned)
- "$ref:user:<username>.vlessUuid|.ssPassword|.trojanPassword" a user's credential (not returned)`;

const operationSchema = z.object({
    path: z.string().min(1).describe('Path into the config, e.g. inbounds[tag=x].port'),
    op: z.enum(['set', 'delete', 'append']).describe('Operation'),
    value: z.any().optional().describe('Value for set/append; may contain $gen:/$ref: placeholders'),
});

export function registerConfigProfilePatchTool(server: McpServer, client: RemnawaveClient) {
    server.tool(
        'config_profiles_patch',
        DESCRIPTION,
        {
            uuid: z.string().describe('Config profile UUID'),
            operations: z.array(operationSchema).min(1).describe('Operations applied in order'),
            dryRun: z.boolean().optional().describe('Compute the diff without saving (default false)'),
        },
        async ({ uuid, operations, dryRun }) => {
            const secrets = new Set<string>();
            try {
                for (const operation of operations) {
                    if (operation.op !== 'delete' && operation.value === undefined) {
                        throw new PatchError(`Operation "${operation.op}" on "${operation.path}" needs a value`);
                    }
                }

                const profile = (await client.getConfigProfileByUuid(uuid)) as {
                    response?: { config?: unknown };
                };
                const config = profile.response?.config;
                if (config === null || typeof config !== 'object' || Array.isArray(config)) {
                    throw new PatchError(`Config profile ${uuid} has no config object`);
                }
                const working = structuredClone(config) as Record<string, unknown>;

                const userCache = new Map<string, Record<string, unknown>>();
                const lookupUser = async (username: string, field: string) => {
                    let user = userCache.get(username);
                    if (!user) {
                        const res = (await client.getUserByUsername(username)) as {
                            response?: Record<string, unknown>;
                        };
                        if (!res.response) throw new PatchError(`User "${username}" not found`);
                        user = res.response;
                        userCache.set(username, user);
                    }
                    const credential = user[field];
                    if (typeof credential !== 'string' || credential === '') {
                        throw new PatchError(`User "${username}" has no ${field}`);
                    }
                    return credential;
                };

                const changes: Change[] = [];
                const generated: Generated[] = [];
                for (const operation of operations) {
                    const resolved =
                        operation.op === 'delete'
                            ? { value: undefined, generated: [], secrets: [] }
                            : await resolvePlaceholders(operation.value, lookupUser);
                    resolved.secrets.forEach((s) => secrets.add(s));
                    const { change, touchedPath } = applyOperation(working, {
                        ...(operation as PatchOperation),
                        value: resolved.value,
                    });
                    changes.push(change);
                    for (const item of resolved.generated) {
                        generated.push({ ...item, path: `${touchedPath}${item.path}` });
                    }
                }

                if (!dryRun) {
                    await client.updateConfigProfile({ uuid, config: working });
                }

                const safeChanges = changes.map((change) => {
                    const { keys, endsWithIndex } = pathKeys(change.path);
                    const safe: Change = { op: change.op, path: change.path };
                    if ('before' in change) safe.before = redactAtPath(change.before, keys, endsWithIndex, secrets);
                    if ('after' in change) safe.after = redactAtPath(change.after, keys, endsWithIndex, secrets);
                    return safe;
                });
                const out: Record<string, unknown> = {
                    ok: true,
                    uuid,
                    dryRun: dryRun === true,
                    changes: safeChanges,
                };
                if (generated.length > 0) out.generated = generated;
                // Always redact here, even with REMNAWAVE_REDACT=false: generated and
                // referenced secrets must never reach the model.
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(redact(out, secrets, true), null, 2),
                        },
                    ],
                };
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                return toolError(new Error(redactString(message, secrets)));
            }
        },
    );
}
