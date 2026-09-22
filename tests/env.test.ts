/**
 * tests/env.test.ts
 *
 * Unit tests for src/config/env.ts.
 *
 * Strategy: rather than manipulating process.env and re-importing the module
 * (which requires cache-busting tricks prone to timeouts), we import and test
 * the exported `parseConfig()` function directly. It accepts a plain object
 * and returns validated config — or throws — making it a pure, fast unit.
 *
 * This approach:
 * - Is zero-timeout-risk (no dynamic imports, no module registry tricks)
 * - Covers exactly the same validation logic that runs at startup
 * - Requires no special vitest configuration (no isolate:true, no resetModules)
 */
import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config/env';

// ── Valid configurations ───────────────────────────────────────────────────────

describe('parseConfig — valid configurations', () => {
  it('returns defaults when given an empty object', () => {
    const config = parseConfig({});

    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/reports');
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('accepts custom DATABASE_URL and REDIS_URL', () => {
    const config = parseConfig({
      DATABASE_URL: 'postgres://custom_user:secret@custom_host:5433/custom_db',
      REDIS_URL: 'redis://custom_host:6380',
    });

    expect(config.DATABASE_URL).toBe('postgres://custom_user:secret@custom_host:5433/custom_db');
    expect(config.REDIS_URL).toBe('redis://custom_host:6380');
  });

  it('parses PORT string as a number', () => {
    const config = parseConfig({ PORT: '8080' });

    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('accepts all valid LOG_LEVEL values', () => {
    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

    for (const level of validLevels) {
      const config = parseConfig({ LOG_LEVEL: level });
      expect(config.LOG_LEVEL).toBe(level);
    }
  });

  it('accepts NODE_ENV = "production"', () => {
    const config = parseConfig({ NODE_ENV: 'production' });
    expect(config.NODE_ENV).toBe('production');
  });

  it('accepts NODE_ENV = "test"', () => {
    const config = parseConfig({ NODE_ENV: 'test' });
    expect(config.NODE_ENV).toBe('test');
  });

  it('accepts the minimum valid PORT (1)', () => {
    const config = parseConfig({ PORT: '1' });
    expect(config.PORT).toBe(1);
  });

  it('accepts the maximum valid PORT (65535)', () => {
    const config = parseConfig({ PORT: '65535' });
    expect(config.PORT).toBe(65535);
  });
});

// ── Invalid configurations ────────────────────────────────────────────────────

describe('parseConfig — invalid configurations', () => {
  it('throws when PORT is not numeric', () => {
    expect(() => parseConfig({ PORT: 'not-a-number' })).toThrow(/PORT/);
  });

  it('throws when PORT is above 65535', () => {
    expect(() => parseConfig({ PORT: '99999' })).toThrow(/PORT/);
  });

  it('throws when PORT is zero', () => {
    expect(() => parseConfig({ PORT: '0' })).toThrow(/PORT/);
  });

  it('throws when PORT is negative', () => {
    expect(() => parseConfig({ PORT: '-1' })).toThrow(/PORT/);
  });

  it('throws when LOG_LEVEL is invalid', () => {
    expect(() => parseConfig({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('throws when NODE_ENV is invalid', () => {
    expect(() => parseConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('error message contains [Config] prefix for easy log grepping', () => {
    expect(() => parseConfig({ LOG_LEVEL: 'INVALID' })).toThrow(/\[Config\]/);
  });

  it('throws when DATABASE_URL is not a valid postgres connection string', () => {
    expect(() => parseConfig({ DATABASE_URL: 'http://localhost:5432/reports' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => parseConfig({ DATABASE_URL: 'not-a-valid-url' })).toThrow(/DATABASE_URL/);
  });

  it('throws when REDIS_URL is not a valid redis connection string', () => {
    expect(() => parseConfig({ REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
    expect(() => parseConfig({ REDIS_URL: 'not-a-valid-url' })).toThrow(/REDIS_URL/);
  });

  it('error message lists bad field names and [Config] prefix', () => {
    // Zod 4 transforms short-circuit on first failure in a field, so each
    // invalid field produces at least one issue. We test that the error message
    // is well-formed and identifies the offending field.
    let error: Error | undefined;
    try {
      parseConfig({ PORT: '99999' });
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/\[Config\]/);
    expect(error?.message).toMatch(/PORT/);
  });
});
