export interface Config {
    baseUrl: string;
    apiToken: string;
    apiKey?: string;
    cfAccessClientId?: string;
    cfAccessClientSecret?: string;
    readonly: boolean;
    redact: boolean;
    expectedTitle?: string;
}

export function loadConfig(): Config {
    const baseUrl = process.env.REMNAWAVE_BASE_URL;
    const apiToken = process.env.REMNAWAVE_API_TOKEN;
    const apiKey = process.env.REMNAWAVE_API_KEY;
    const cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
    const cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    const readonly = process.env.REMNAWAVE_READONLY === 'true';
    const redact = process.env.REMNAWAVE_REDACT !== 'false';
    const expectedTitle = process.env.REMNAWAVE_EXPECTED_TITLE?.trim() || undefined;

    if (!baseUrl) {
        throw new Error('REMNAWAVE_BASE_URL environment variable is required');
    }
    if (!apiToken) {
        throw new Error('REMNAWAVE_API_TOKEN environment variable is required');
    }

    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiToken,
        apiKey,
        cfAccessClientId,
        cfAccessClientSecret,
        readonly,
        redact,
        expectedTitle,
    };
}
