/**
 * src/types/express.d.ts
 *
 * Module augmentation: adds `requestId` to Express's Request interface.
 *
 * Why this file exists:
 * Express's built-in Request type has no `requestId` field. Without this
 * augmentation, TypeScript would error whenever route handlers tried to
 * read `req.requestId`. By augmenting the global namespace we keep strict
 * types without casting to `any`.
 *
 * The `requestId` property is written by pinoHttp's genReqId function in
 * src/lib/logger.ts before any route handler runs.
 */

// This empty import turns the file into a module, which is required for
// declaration merging (augmenting an existing module).
export {};

declare global {
  namespace Express {
    interface Request {
      /** UUID generated (or forwarded from x-request-id header) per request */
      requestId: string;
    }
  }
}
