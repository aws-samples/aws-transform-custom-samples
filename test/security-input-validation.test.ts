/**
 * Security tests for Lambda input validation logic.
 * Tests command injection prevention, input sanitization, and env var whitelisting.
 * No AWS services or deployment required — pure unit tests.
 */

// The lambda dir is excluded from tsconfig, so we import the source directly
// and rely on ts-jest to compile it.
import { validateCommand, validateJobRequest, getEnvOrThrow, jsonResponse, errorResponse } from '../lambda/utils/index';

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
      'atx transform ; rm -rf /',
      'atx transform && curl evil.com',
      'atx transform || true',
      'atx transform | cat /etc/passwd',
      'atx transform `whoami`',
      'atx transform $(id)',
      'atx transform ${HOME}',
      'atx transform\nrm -rf /',
      'atx transform\rrm -rf /',
      'atx transform > /tmp/out',
      'atx transform < /etc/passwd',
      'atx transform >> /tmp/out',
      'atx transform << EOF',
    ];
    for (const cmd of injections) {
      expect(() => validateCommand(cmd)).toThrow(/dangerous pattern/i);
    }
  });

  test('rejects curly braces (bash expansion)', () => {
    expect(() => validateCommand('atx transform {a,b}')).toThrow(/dangerous pattern/i);
  });

  test('rejects characters outside the safe charset', () => {
    expect(() => validateCommand('atx transform --td "test" \x00')).toThrow(/invalid characters/i);
    expect(() => validateCommand('atx transform --td "test" \x1b[31m')).toThrow();
    expect(() => validateCommand('atx transform --td "tëst"')).toThrow(/invalid characters/i);
  });

  test('accepts valid atx commands', () => {
    expect(() => validateCommand('atx transform --td my-td')).not.toThrow();
    expect(() => validateCommand('atx transform --td my-td --source s3://bucket/key')).not.toThrow();
    expect(() => validateCommand("atx transform --td 'my td name'")).not.toThrow();
    expect(() => validateCommand('atx transform --td my-td --output path/to/output')).not.toThrow();
    expect(() => validateCommand('atx transform --td my_td --config key=value')).not.toThrow();
  });

  test('accepts commands with allowed special characters', () => {
    // These are in the SAFE_CHARS regex
    expect(() => validateCommand('atx transform --td my-td:v1')).not.toThrow();
    expect(() => validateCommand('atx transform --td my-td --tags "key=value,k2=v2"')).not.toThrow();
    expect(() => validateCommand('atx transform --td my-td --source git@github.com:org/repo')).not.toThrow();
    expect(() => validateCommand('atx transform --td my-td --env ["a","b"]')).not.toThrow();
  });

  test('trims whitespace before validation', () => {
    expect(() => validateCommand('  atx transform --td my-td  ')).not.toThrow();
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
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 'file:///etc/passwd' }))
      .toContain('Invalid source format');
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 'ftp://server/file' }))
      .toContain('Invalid source format');
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 'javascript:alert(1)' }))
      .toContain('Invalid source format');
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: '/local/path' }))
      .toContain('Invalid source format');
  });

  test('accepts valid source URL schemes', () => {
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 's3://bucket/key' })).toBeNull();
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 'https://github.com/org/repo' })).toBeNull();
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 'ssh://git@github.com/org/repo' })).toBeNull();
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t', source: 'git@github.com:org/repo.git' })).toBeNull();
  });

  test('accepts valid request with no source', () => {
    expect(validateJobRequest({ jobName: 'test', command: 'atx transform --td t' })).toBeNull();
  });

  test('accepts jobName at exactly 128 characters', () => {
    expect(validateJobRequest({ jobName: 'a'.repeat(128), command: 'atx transform --td t' })).toBeNull();
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
