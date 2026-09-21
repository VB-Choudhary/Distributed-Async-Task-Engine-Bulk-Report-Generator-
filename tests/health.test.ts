/**
 * tests/health.test.ts
 *
 * Integration tests for the Express application layer.
 *
 * We use supertest which calls createApp() directly — no TCP port is opened,
 * no OS resource is consumed. Each describe block gets its own app instance
 * (createApp() is cheap) demonstrating the value of the factory pattern.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Router } from 'express';
import { createApp } from '../src/api/app';

/** Shape of JSON error responses returned by the API */
interface ErrorBody {
  status: string;
  message: string;
  stack?: string;
}

let app: express.Application;

beforeEach(() => {
  // Fresh app for every test — no shared state leakage
  app = createApp();
});

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns Content-Type application/json', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('sets x-request-id response header', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toBeDefined();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('honours an upstream x-request-id header', async () => {
    const traceId = 'upstream-trace-id-123';
    const res = await request(app).get('/health').set('x-request-id', traceId);

    // The same ID must be echoed back in the response header
    expect(res.headers['x-request-id']).toBe(traceId);
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns 404 with JSON error body for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ status: 'error', message: 'Not Found' });
  });

  it('returns 404 for unknown POST routes', async () => {
    const res = await request(app).post('/unknown');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).status).toBe('error');
  });
});

// ── Error handler ─────────────────────────────────────────────────────────────

describe('Error handler', () => {
  it('catches errors thrown in route handlers and returns 500', async () => {
    // Build a router with a deliberately broken route and inject it into
    // the app via the extraRouters parameter — this ensures it's registered
    // BEFORE the 404 and error handlers inside createApp().
    const boomRouter = Router();
    boomRouter.get('/boom', () => {
      throw new Error('deliberate test error');
    });

    const faultyApp = createApp([boomRouter]);
    const res = await request(faultyApp).get('/boom');

    expect(res.status).toBe(500);
    // Cast to ErrorBody so TypeScript knows the shape of res.body
    const body = res.body as ErrorBody;
    expect(body.status).toBe('error');
    // Stack must NOT appear in the response body (NODE_ENV=test, not development)
    expect(body.stack).toBeUndefined();
  });
});
