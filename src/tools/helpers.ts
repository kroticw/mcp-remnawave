import { formatJson, redactString, isRedactionEnabled } from '../redact.js';

/** Every tool returns through here, so secrets are redacted in one place. */
export function toolResult(data: unknown) {
    return {
        content: [
            {
                type: 'text' as const,
                text: formatJson(data),
            },
        ],
    };
}

export function toolError(error: unknown) {
    const message =
        error instanceof Error ? error.message : String(error);
    return {
        content: [
            {
                type: 'text' as const,
                text: `Error: ${isRedactionEnabled() ? redactString(message) : message}`,
            },
        ],
        isError: true,
    };
}
