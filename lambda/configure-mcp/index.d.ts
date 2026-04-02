export declare function validateMcpConfig(config: Record<string, unknown>): string | null;
interface ConfigureMcpRequest {
    mcpConfig: Record<string, unknown>;
}
export declare function handler(event: ConfigureMcpRequest): Promise<{
    statusCode: number;
}>;
export {};
