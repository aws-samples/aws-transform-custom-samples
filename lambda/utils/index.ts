export function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return { statusCode, ...body };
}

export function errorResponse(statusCode: number, message: string) {
  return { statusCode, error: message };
}

const DANGEROUS_PATTERNS = ['&&', '||', ';', '|', '`', '$(', '${', '\n', '\r', '>', '<', '>>', '<<', '{', '}'];
const SAFE_CHARS = /^[a-zA-Z0-9\s\-_./=:,"'@[\]~+]+$/;

export function validateCommand(command: string): void {
  const trimmed = command.trim();
  if (!trimmed.startsWith('atx')) throw new Error("Command must start with 'atx'");
  for (const pattern of DANGEROUS_PATTERNS) {
    if (trimmed.includes(pattern)) throw new Error(`Command contains dangerous pattern: ${pattern}`);
  }
  if (!SAFE_CHARS.test(trimmed)) throw new Error('Command contains invalid characters');
}

export function validateJobRequest(body: { command?: string; source?: string; jobName?: string }): string | null {
  if (!body.jobName) return 'Missing required field: jobName';
  if (body.jobName.length > 128) return 'jobName must not exceed 128 characters';
  if (!body.command) return 'Missing required field: command';
  try { validateCommand(body.command); } catch (e) { return `Invalid command: ${(e as Error).message}`; }
  if (body.source && !body.source.startsWith('s3://') && !body.source.startsWith('https://') && !body.source.startsWith('ssh://') && !body.source.startsWith('git@')) {
    return 'Invalid source format. Supported: HTTPS git URLs, SSH git URLs (ssh:// or git@), or S3 paths';
  }
  return null;
}

export function formatTimestamp(timestampMs?: number): string | null {
  return timestampMs ? new Date(timestampMs).toISOString() : null;
}

export function calculateDuration(startMs?: number, endMs?: number): number | null {
  return startMs && endMs ? Math.floor((endMs - startMs) / 1000) : null;
}

export function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const logger = {
  info: (message: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'INFO', message, ...data })),
  error: (message: string, data?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: 'ERROR', message, ...data })),
};
