/**
 * src/config/env.ts
 *
 * Single source of truth for all environment configuration.
 *
 * Design decisions:
 * - We use Zod to declare and validate the shape of process.env at startup.
 * - z.object().parse() throws a ZodError immediately on failure, which means
 *   the process dies before any server socket is opened — fail-fast.
 * - We catch that ZodError here, format it into a human-readable message,
 *   then re-throw a plain Error so the stacktrace stays clean.
 * - All env vars have defaults appropriate for local development so developers
 *   don't need a .env file to run `npm run dev` the first time.
 * - The exported `env` object is fully typed: callers see `env.PORT: number`,
 *   not `string | undefined`.
 * - `envSchema` and `parseConfig` are also exported so tests can validate
 *   arbitrary inputs without needing to re-import the module with a fresh
 *   process.env state.
 *
 * Note on PORT validation: we use z.coerce.number().int().min(1).max(65535)
 * rather than z.string().transform() + throw. In Zod 4, throwing inside a
 * transform wraps the error differently than a Zod refinement failure, making
 * it harder to format all issues together. z.coerce keeps the error as a
 * standard Zod issue that safeParse collects properly.
 */
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  PORT: z.coerce
    .number()
    .int({ message: 'PORT must be an integer' })
    .min(1, { message: 'PORT must be at least 1' })
    .max(65535, { message: 'PORT must be at most 65535' })
    .default(3000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

// Export the inferred type so other modules can annotate function parameters
export type Env = z.infer<typeof envSchema>;

/**
 * Validate an arbitrary plain object against the env schema and return typed
 * config, or throw a formatted error listing every invalid field.
 *
 * Exported so tests can call it directly with controlled input rather than
 * manipulating process.env and re-importing the module.
 */
export function parseConfig(input: Record<string, string | undefined> | NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    // Format every Zod issue into "  FIELD: message" lines
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // Throw a plain Error — ZodError's own message is noisy for operators
    throw new Error(`[Config] Invalid environment variables — fix these and restart:\n${issues}`);
  }

  return result.data;
}

// Parse once at module load time. Any import of env.ts triggers validation.
// process.env is NodeJS.ProcessEnv which is already compatible with the
// Record<string, string | undefined> that parseConfig expects.
export const env = parseConfig(process.env);
