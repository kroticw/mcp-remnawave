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
        'Update an internal squad: rename it and/or change its inbounds. ' +
            '`inbounds` replaces the whole list; `addInbounds`/`removeInbounds` edit the current list. ' +
            'Inbounds are UUIDs, or tags written as "tag:<name>".',
        {
            uuid: z.string().describe('Squad UUID'),
            name: z.string().optional().describe('New squad name'),
            inbounds: z
                .array(z.string())
                .optional()
                .describe('Inbounds of the squad, replacing the current list (UUIDs or "tag:<name>")'),
            addInbounds: z.array(z.string()).optional().describe('Inbounds to add (UUIDs or "tag:<name>")'),
            removeInbounds: z.array(z.string()).optional().describe('Inbounds to remove (UUIDs or "tag:<name>")'),
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

const TAG_PREFIX = 'tag:';

interface InboundRef {
    uuid: string;
    tag: string;
}

/** Resolves "tag:<name>" references against `known`; anything else is taken as an inbound UUID. */
function inboundResolver(known: InboundRef[], scope: string): (ref: string) => string {
    return (ref) => {
        if (!ref.startsWith(TAG_PREFIX)) return ref;
        const tag = ref.slice(TAG_PREFIX.length);
        const matches = known.filter((i) => i.tag === tag);
        if (matches.length !== 1) throw new Error(`Inbound tag "${tag}" matches ${matches.length} inbounds of ${scope}`);
        return matches[0].uuid;
    };
}

function hasTags(...lists: (string[] | undefined)[]): boolean {
    return lists.some((l) => l?.some((r) => r.startsWith(TAG_PREFIX)));
}

function applyEdits(current: string[], add: string[], remove: string[]): string[] {
    const out = [...current];
    for (const id of add) if (!out.includes(id)) out.push(id);
    const drop = new Set(remove);
    return out.filter((id) => !drop.has(id));
}

/** Computes the final inbound UUID list for a squad update; fails on unknown inbound tags. */
async function resolveSquadInbounds(
    client: RemnawaveClient,
    squadUuid: string,
    edits: { inbounds?: string[]; addInbounds?: string[]; removeInbounds?: string[] },
): Promise<string[]> {
    let known: InboundRef[] = [];
    if (hasTags(edits.inbounds, edits.addInbounds, edits.removeInbounds)) {
        const all = (await client.getAllInbounds()) as { response?: { inbounds?: InboundRef[] } };
        known = all.response?.inbounds ?? [];
    }
    const toUuid = inboundResolver(known, 'the panel');
    let base: string[];
    if (edits.inbounds) {
        base = edits.inbounds.map(toUuid);
    } else {
        const squad = (await client.getInternalSquad(squadUuid)) as { response?: { inbounds?: InboundRef[] } };
        base = (squad.response?.inbounds ?? []).map((i) => i.uuid);
    }
    return applyEdits(base, (edits.addInbounds ?? []).map(toUuid), (edits.removeInbounds ?? []).map(toUuid));
}
