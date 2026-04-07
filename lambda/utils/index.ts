export function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return { statusCode, ...body };
}

export function errorResponse(statusCode: number, message: string) {
  return { statusCode, error: message };
}

const DANGEROUS_PATTERNS = ['`', '$(', '${'];
const SAFE_CHARS = /^[a-zA-Z0-9 \t\-_./=:,"'@[\]~+&><;|]+$/;
const ALLOWED_COMMAND_PREFIXES = ['atx custom def exec', 'atx custom def list', 'atx custom def get'];
const DENIED_BUILD_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'ncat', 'dig', 'nslookup',
  'whoami', 'id', 'printenv', 'base64',
  'dd', 'mount', 'ss', 'netstat', 'ifconfig',
]);

function extractBuildCommands(command: string): string[] {
  const results: string[] = [];
  // Match -c <value> or --build-command <value>
  const flagPattern = /(?:^|\s)(?:-c|--build-command)\s+(\S+)/g;
  let match;
  while ((match = flagPattern.exec(command)) !== null) {
    results.push(match[1]);
  }
  // Match buildCommand=<value> inside --configuration
  const configPattern = /buildcommand=(\S+)/gi;
  while ((match = configPattern.exec(command)) !== null) {
    results.push(match[1]);
  }
  return results;
}

export function validateCommand(command: string): void {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed.startsWith('atx')) throw new Error("Command must start with 'atx'");
  if (!ALLOWED_COMMAND_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    throw new Error(`Command not allowed. Permitted: ${ALLOWED_COMMAND_PREFIXES.join(', ')}`);
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (trimmed.includes(pattern)) throw new Error(`Command contains dangerous pattern: ${pattern}`);
  }
  if (!SAFE_CHARS.test(trimmed)) throw new Error('Command contains invalid characters');

  for (const buildCmd of extractBuildCommands(trimmed)) {
    const executable = buildCmd.replace(/^['"]|['"]$/g, '').split(/[\s/]/)[0];
    if (DENIED_BUILD_COMMANDS.has(executable)) {
      throw new Error(`Build command "${executable}" is not allowed`);
    }
  }
}

export function validateJobRequest(body: { command?: string; source?: string; jobName?: string }): string | null {
  if (!body.jobName) return 'Missing required field: jobName';
  if (body.jobName.length > 128) return 'jobName must not exceed 128 characters';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(body.jobName)) return 'jobName must start with a letter or number and contain only letters, numbers, hyphens, and underscores';
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

const DENIED_MCP_COMMANDS = new Set(['bash', 'sh', 'zsh', 'dash', 'csh', 'ksh', 'fish', 'env']);

export function validateMcpConfig(config: Record<string, unknown>): string | null {
  const entries = Object.entries(config.mcpServers as Record<string, any> ?? {});
  for (const [name, server] of entries) {
    if (!server || typeof server !== 'object') continue;
    if (server.command && typeof server.command === 'string') {
      const executable = server.command.split('/').pop()!;
      if (DENIED_MCP_COMMANDS.has(executable)) {
        return `Server "${name}": shell interpreter "${executable}" not allowed as MCP command`;
      }
    }
  }
  return null;
}

const ALLOWED_ENV_VALUES: Record<string, RegExp> = {
  JAVA_VERSION: /^\d{1,2}$/,
  PYTHON_VERSION: /^(3\.)?\d{1,2}$/,
  NODE_VERSION: /^\d{1,2}$/,
};

export function validateEnvironment(env: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(env)) {
    if (!ALLOWED_ENV_VALUES[key]) continue;
    if (!ALLOWED_ENV_VALUES[key].test(value)) {
      return `Invalid ${key} value: "${value}"`;
    }
  }
  return null;
}
