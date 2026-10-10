import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { toolResult, toolError } from './helpers.js';

export function registerSquadTools(
    server: McpServer,
    client: RemnawaveClient,
    readonly: boolean,
) {
    server.tool(
        'squads_list',
        'List all internal squads',
        {},
        async () => {
            try {
                const result = await client.getInternalSquads();
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'squads_accessible_nodes',
        'Get nodes accessible to a specific squad',
        {
            uuid: z.string().describe('Squad UUID'),
        },
        async ({ uuid }) => {
            try {
                const result = await client.getSquadAccessibleNodes(uuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    if (readonly) return;

    server.tool(
        'squads_create',
        'Create a new internal squad',
        {
            name: z.string().describe('Squad name'),
            inbounds: z.array(z.string()).describe('Array of inbound UUIDs'),
        },
        async (params) => {
            try {
                const result = await client.createInternalSquad(params);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'squads_update',
        'Update an internal squad: rename it and/or change its inbounds. Inbounds may be given as UUIDs or tags. ' +
            '`inbounds` replaces the whole list; `addInbounds`/`removeInbounds` edit the current list.',
        {
            uuid: z.string().describe('Squad UUID'),
            name: z.string().optional().describe('New squad name'),
            inbounds: z.array(z.string()).optional().describe('Replace the inbound list (UUIDs or tags)'),
            addInbounds: z.array(z.string()).optional().describe('Inbounds to add (UUIDs or tags)'),
            removeInbounds: z.array(z.string()).optional().describe('Inbounds to remove (UUIDs or tags)'),
        },
        async ({ uuid, name, inbounds, addInbounds, removeInbounds }) => {
            try {
                const body: Record<string, unknown> = { uuid };
                if (name !== undefined) body.name = name;
                if (inbounds || addInbounds || removeInbounds) {
                    body.inbounds = await resolveSquadInbounds(client, uuid, {
                        inbounds,
                        addInbounds,
                        removeInbounds,
                    });
                }
                const result = await client.updateInternalSquad(body);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'squads_delete',
        'Delete an internal squad',
        {
            uuid: z.string().describe('Squad UUID to delete'),
        },
        async ({ uuid }) => {
            try {
                await client.deleteInternalSquad(uuid);
                return toolResult({
                    success: true,
                    message: `Squad ${uuid} deleted`,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'squads_add_users',
        'Add the given users to an internal squad',
        {
            squadUuid: z.string().describe('Squad UUID'),
            userIds: z
                .array(z.number().int())
                .min(1)
                .describe('Array of numeric user IDs to add'),
        },
        async ({ squadUuid, userIds }) => {
            try {
                const result = await client.addUsersToSquad(
                    squadUuid,
                    userIds,
                );
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'squads_remove_users',
        'Remove the given users from an internal squad',
        {
            squadUuid: z.string().describe('Squad UUID'),
            userIds: z
                .array(z.number().int())
                .min(1)
                .describe('Array of numeric user IDs to remove'),
        },
        async ({ squadUuid, userIds }) => {
            try {
                const result = await client.removeUsersFromSquad(
                    squadUuid,
                    userIds,
                );
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InboundRef {
    uuid: string;
    tag: string;
}

/** Computes the final inbound UUID list for a squad update; fails on unknown references. */
async function resolveSquadInbounds(
    client: RemnawaveClient,
    squadUuid: string,
    edits: { inbounds?: string[]; addInbounds?: string[]; removeInbounds?: string[] },
): Promise<string[]> {
    const refs = [...(edits.inbounds ?? []), ...(edits.addInbounds ?? []), ...(edits.removeInbounds ?? [])];
    let known: InboundRef[] = [];
    if (refs.some((r) => !UUID_RE.test(r))) {
        const all = (await client.getAllInbounds()) as { response?: { inbounds?: InboundRef[] } };
        known = all.response?.inbounds ?? [];
    }
    const toUuid = (ref: string): string => {
        if (UUID_RE.test(ref)) return ref;
        const matches = known.filter((i) => i.tag === ref);
        if (matches.length !== 1) {
            throw new Error(`Inbound "${ref}" matches ${matches.length} inbounds; use its UUID`);
        }
        return matches[0].uuid;
    };

    let current: string[];
    if (edits.inbounds) {
        current = edits.inbounds.map(toUuid);
    } else {
        const squad = (await client.getInternalSquad(squadUuid)) as { response?: { inbounds?: InboundRef[] } };
        current = (squad.response?.inbounds ?? []).map((i) => i.uuid);
    }
    for (const ref of edits.addInbounds ?? []) {
        const id = toUuid(ref);
        if (!current.includes(id)) current.push(id);
    }
    const drop = new Set((edits.removeInbounds ?? []).map(toUuid));
    return current.filter((id) => !drop.has(id));
}
