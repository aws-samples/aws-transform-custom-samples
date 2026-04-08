/**
 * Security tests for Lambda input validation logic.
 * Tests command injection prevention, input sanitization, and env var whitelisting.
 * No AWS services or deployment required — pure unit tests.
 */

// The lambda dir is excluded from tsconfig, so we import the source directly
// and rely on ts-jest to compile it.
import { validateCommand, validateJobRequest, validateMcpConfig, validateEnvironment, getEnvOrThrow, jsonResponse, errorResponse } from '../lambda/utils/index';

// ─── Command Injection Prevention ────────────────────────────────────

describe('validateCommand — injection prevention', () => {
  test('rejects commands that do not start with "atx"', () => {
    expect(() => validateCommand('rm -rf /')).toThrow("Command must start with 'atx'");
    expect(() => validateCommand('curl evil.com')).toThrow("Command must start with 'atx'");
    expect(() => validateCommand('echo hello')).toThrow("Command must start with 'atx'");
    expect(() => validateCommand('')).toThrow("Command must start with 'atx'");
  });

  test('rejects shell metacharacters in otherwise valid commands', () => {
    const injections = [
      'atx custom def exec `whoami`',
      'atx custom def exec $(id)',
      'atx custom def exec ${HOME}',
      'atx custom def exec\nrm -rf /',
      'atx custom def exec\rrm -rf /',
    ];
    for (const cmd of injections) {
      expect(() => validateCommand(cmd)).toThrow();
    }
  });

  test('rejects build commands via -c flag', () => {
    expect(() => validateCommand('atx custom def exec -n td -c "mvn clean test" -x -t')).toThrow(/not allowed/i);
  });

  test('rejects command substitution via curly braces', () => {
    expect(() => validateCommand('atx custom def exec ${HOME}')).toThrow(/dangerous pattern/i);
  });

  test('rejects characters outside the safe charset', () => {
    expect(() => validateCommand('atx custom def exec -n "test" \x00')).toThrow(/invalid characters/i);
    expect(() => validateCommand('atx custom def exec -n "test" \x1b[31m')).toThrow();
    expect(() => validateCommand('atx custom def exec -n "tëst"')).toThrow(/invalid characters/i);
  });

  test('accepts valid atx commands', () => {
    expect(() => validateCommand('atx custom def exec -n my-td -p /source/repo -x -t')).not.toThrow();
    expect(() => validateCommand('atx custom def list --json')).not.toThrow();
    expect(() => validateCommand('atx custom def get -n my-td')).not.toThrow();
    expect(() => validateCommand('atx custom def exec -n my-td --configuration key=value')).not.toThrow();
  });

  test('accepts commands with allowed special characters', () => {
    expect(() => validateCommand('atx custom def exec -n my-td:v1 -p /source/repo')).not.toThrow();
    expect(() => validateCommand('atx custom def exec -n my-td --tags "key=value,k2=v2"')).not.toThrow();
    expect(() => validateCommand('atx custom def exec -n my-td --source git@github.com:org/repo')).not.toThrow();
    expect(() => validateCommand('atx custom def exec -n my-td --env ["a","b"]')).not.toThrow();
  });

  test('trims whitespace before validation', () => {
    expect(() => validateCommand('  atx custom def exec -n my-td  ')).not.toThrow();
  });

  test('rejects disallowed atx subcommands', () => {
    expect(() => validateCommand('atx mcp tools')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx update')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx --resume')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def delete -n my-td')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def publish -n my-td')).toThrow(/not allowed/i);
  });

});

// ─── Job Request Validation ──────────────────────────────────────────

describe('validateJobRequest — input sanitization', () => {
  test('rejects missing jobName', () => {
    expect(validateJobRequest({ command: 'atx transform --td test' })).toBe('Missing required field: jobName');
  });

  test('rejects jobName exceeding 128 characters', () => {
    const longName = 'a'.repeat(129);
    expect(validateJobRequest({ command: 'atx transform --td test', jobName: longName }))
      .toBe('jobName must not exceed 128 characters');
  });

  test('rejects missing command', () => {
    expect(validateJobRequest({ jobName: 'test-job' })).toContain('Missing required field: command');
  });

  test('rejects invalid commands via validateCommand', () => {
    const result = validateJobRequest({ jobName: 'test', command: 'rm -rf /' });
    expect(result).toContain('Invalid command');
  });

  test('rejects unsupported source URL schemes', () => {
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 'file:///etc/passwd' }))
      .toContain('Invalid source format');
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 'ftp://server/file' }))
      .toContain('Invalid source format');
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 'javascript:alert(1)' }))
      .toContain('Invalid source format');
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: '/local/path' }))
      .toContain('Invalid source format');
  });

  test('accepts valid source URL schemes', () => {
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 's3://bucket/key' })).toBeNull();
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 'https://github.com/org/repo' })).toBeNull();
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 'ssh://git@github.com/org/repo' })).toBeNull();
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t', source: 'git@github.com:org/repo.git' })).toBeNull();
  });

  test('accepts valid request with no source', () => {
    expect(validateJobRequest({ jobName: 'test', command: 'atx custom def exec -n t' })).toBeNull();
  });

  test('accepts jobName at exactly 128 characters', () => {
    expect(validateJobRequest({ jobName: 'a'.repeat(128), command: 'atx custom def exec -n t' })).toBeNull();
  });
});

// ─── Environment Variable Whitelisting ───────────────────────────────
// This tests the ALLOWED_ENV_KEYS logic in trigger-job and trigger-batch-jobs.
// We can't import the handler without mocking AWS SDK, but we can verify
// the whitelist concept by testing the pattern directly.

describe('environment variable whitelisting', () => {
  const ALLOWED_ENV_KEYS = new Set(['JAVA_VERSION', 'PYTHON_VERSION', 'NODE_VERSION']);

  test('only allows version-switching env vars', () => {
    expect(ALLOWED_ENV_KEYS.has('JAVA_VERSION')).toBe(true);
    expect(ALLOWED_ENV_KEYS.has('PYTHON_VERSION')).toBe(true);
    expect(ALLOWED_ENV_KEYS.has('NODE_VERSION')).toBe(true);
  });

  test('blocks dangerous env vars', () => {
    const dangerous = [
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
      'LD_PRELOAD', 'PATH', 'HOME', 'SHELL',
      'AWS_DEFAULT_REGION', 'S3_BUCKET', 'SOURCE_BUCKET',
      'JOB_QUEUE', 'JOB_DEFINITION', 'OUTPUT_BUCKET',
    ];
    for (const key of dangerous) {
      expect(ALLOWED_ENV_KEYS.has(key)).toBe(false);
    }
  });
});

// ─── Utility Function Safety ─────────────────────────────────────────

describe('utility functions', () => {
  test('getEnvOrThrow throws on missing env var', () => {
    expect(() => getEnvOrThrow('NONEXISTENT_VAR_12345')).toThrow('Missing required environment variable');
  });

  test('jsonResponse returns correct structure', () => {
    const resp = jsonResponse(200, { key: 'value' });
    expect(resp.statusCode).toBe(200);
    expect((resp as any).key).toBe('value');
  });

  test('errorResponse returns correct structure', () => {
    const resp = errorResponse(400, 'bad request');
    expect(resp.statusCode).toBe(400);
    expect(resp.error).toBe('bad request');
  });
});

// ─── MCP Config Validation ───────────────────────────────────────────

describe('validateMcpConfig — MCP server command deny list', () => {
  test('accepts valid MCP configs', () => {
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'npx', args: ['-y', '@company/server'] } } })).toBeNull();
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'uvx', args: ['my-server@latest'] } } })).toBeNull();
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'node', args: ['server.js'] } } })).toBeNull();
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'python3', args: ['-m', 'my_server'] } } })).toBeNull();
    expect(validateMcpConfig({ mcpServers: { s1: { command: '/path/to/custom-mcp-server' } } })).toBeNull();
  });

  test('accepts config with multiple valid servers', () => {
    expect(validateMcpConfig({
      mcpServers: {
        docs: { command: 'uvx', args: ['awslabs.aws-documentation-mcp-server@latest'] },
        custom: { command: '/home/atxuser/my-mcp', args: [] },
      },
    })).toBeNull();
  });

  test('rejects shell interpreters', () => {
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'bash', args: ['-c', 'curl evil.com'] } } })).toContain('shell interpreter');
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'sh', args: ['-c', 'id'] } } })).toContain('shell interpreter');
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'zsh' } } })).toContain('shell interpreter');
    expect(validateMcpConfig({ mcpServers: { s1: { command: 'dash' } } })).toContain('shell interpreter');
  });

  test('rejects shell interpreters via absolute path', () => {
    expect(validateMcpConfig({ mcpServers: { s1: { command: '/bin/bash', args: ['-c', 'curl evil.com'] } } })).toContain('shell interpreter');
    expect(validateMcpConfig({ mcpServers: { s1: { command: '/usr/bin/sh' } } })).toContain('shell interpreter');
  });

  test('accepts remote MCP servers with url instead of command', () => {
    expect(validateMcpConfig({ mcpServers: { stripe: { url: 'https://mcp.stripe.com' } } })).toBeNull();
  });

  test('skips non-string command fields', () => {
    expect(validateMcpConfig({ mcpServers: { s1: { command: 123 } } })).toBeNull();
  });

  test('accepts configs without mcpServers key', () => {
    expect(validateMcpConfig({})).toBeNull();
    expect(validateMcpConfig({ other: 'stuff' })).toBeNull();
  });

  test('skips non-object server entries', () => {
    expect(validateMcpConfig({ mcpServers: { s1: 'not-an-object' } })).toBeNull();
    expect(validateMcpConfig({ mcpServers: { s1: null } })).toBeNull();
  });
});

// ─── Environment Variable Value Validation ───────────────────────────

describe('validateEnvironment — version value validation', () => {
  test('accepts valid Java versions', () => {
    for (const v of ['8', '11', '17', '21', '25']) {
      expect(validateEnvironment({ JAVA_VERSION: v })).toBeNull();
    }
  });

  test('accepts valid Python versions (short and dotted)', () => {
    for (const v of ['8', '9', '10', '11', '12', '13', '14', '3.8', '3.9', '3.10', '3.11', '3.12', '3.13', '3.14']) {
      expect(validateEnvironment({ PYTHON_VERSION: v })).toBeNull();
    }
  });

  test('accepts valid Node versions', () => {
    for (const v of ['16', '18', '20', '22', '24']) {
      expect(validateEnvironment({ NODE_VERSION: v })).toBeNull();
    }
  });

  test('rejects arbitrary strings', () => {
    expect(validateEnvironment({ JAVA_VERSION: '$(whoami)' })).toContain('Invalid JAVA_VERSION');
    expect(validateEnvironment({ PYTHON_VERSION: 'latest' })).toContain('Invalid PYTHON_VERSION');
    expect(validateEnvironment({ NODE_VERSION: '`id`' })).toContain('Invalid NODE_VERSION');
  });

  test('rejects unsupported version formats', () => {
    expect(validateEnvironment({ JAVA_VERSION: '23a' })).toContain('Invalid JAVA_VERSION');
    expect(validateEnvironment({ PYTHON_VERSION: 'three' })).toContain('Invalid PYTHON_VERSION');
    expect(validateEnvironment({ NODE_VERSION: '20.1' })).toContain('Invalid NODE_VERSION');
  });

  test('ignores unknown keys', () => {
    expect(validateEnvironment({ UNKNOWN_KEY: 'anything' })).toBeNull();
  });

  test('validates multiple keys', () => {
    expect(validateEnvironment({ JAVA_VERSION: '21', NODE_VERSION: '20' })).toBeNull();
    expect(validateEnvironment({ JAVA_VERSION: '21', NODE_VERSION: 'evil' })).toContain('Invalid NODE_VERSION');
  });
});

// ─── Build Command Deny List ─────────────────────────────────────────

describe('validateCommand — build command rejection', () => {
  test('rejects all build commands via -c', () => {
    expect(() => validateCommand('atx custom def exec -n td -p /source/repo -c mvn -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c gradle -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c npm -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td --build-command make -x -t')).toThrow(/not allowed/i);
  });

  test('rejects denied commands via -c', () => {
    expect(() => validateCommand('atx custom def exec -n td -c curl -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c wget -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c whoami -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c nc -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c base64 -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c printenv -x -t')).toThrow(/not allowed/i);
  });

  test('rejects denied commands even when quoted', () => {
    expect(() => validateCommand("atx custom def exec -n td -c 'curl' -x -t")).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td -c "wget" -x -t')).toThrow(/not allowed/i);
  });

  test('rejects denied commands via --build-command', () => {
    expect(() => validateCommand('atx custom def exec -n td --build-command curl -x -t')).toThrow(/not allowed/i);
    expect(() => validateCommand('atx custom def exec -n td --build-command wget -x -t')).toThrow(/not allowed/i);
  });

  test('rejects denied commands via --configuration buildCommand=', () => {
    expect(() => validateCommand("atx custom def exec -n td --configuration buildcommand=curl -x -t")).toThrow(/not allowed/i);
    expect(() => validateCommand("atx custom def exec -n td --configuration buildcommand=whoami -x -t")).toThrow(/not allowed/i);
  });

  test('rejects build commands via --configuration buildCommand=', () => {
    expect(() => validateCommand("atx custom def exec -n td --configuration buildcommand=mvn -x -t")).toThrow(/not allowed/i);
  });

  test('allows commands without -c flag', () => {
    expect(() => validateCommand('atx custom def exec -n td -p /source/repo -x -t')).not.toThrow();
  });
});
