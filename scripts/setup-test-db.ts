/**
 * scripts/setup-test-db.ts
 *
 * Idempotently provisions the dedicated test database (reports_test) and applies all migrations.
 *
 * Usage:
 *   npx tsx scripts/setup-test-db.ts
 */
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { env } from '../src/config/env';
import { getTestDatabaseUrl } from '../src/lib/db';
import { logger } from '../src/lib/logger';

async function setupTestDatabase(): Promise<void> {
  const mainUrl = new URL(env.DATABASE_URL);
  // Connect to the default 'postgres' maintenance database to execute CREATE DATABASE
  mainUrl.pathname = '/postgres';
  const maintenanceUrl = mainUrl.toString();

  const testDbName = 'reports_test';
  const testDbUrl = getTestDatabaseUrl();

  logger.info({ maintenanceUrl, testDbName }, 'Checking if test database exists...');

  const client = new Client({ connectionString: maintenanceUrl });

  try {
    await client.connect();

    const checkRes = await client.query('SELECT 1 FROM pg_database WHERE datname = $1;', [
      testDbName,
    ]);

    if (checkRes.rowCount === 0) {
      logger.info({ testDbName }, 'Creating test database...');
      // Database names cannot be parameterized in CREATE DATABASE; testDbName is hardcoded and safe
      await client.query(`CREATE DATABASE ${testDbName};`);
      logger.info({ testDbName }, 'Test database created successfully.');
    } else {
      logger.info({ testDbName }, 'Test database already exists.');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to connect to PostgreSQL maintenance database.');
    throw err;
  } finally {
    await client.end();
  }

  // Run migrations on the test database
  logger.info({ testDbUrl }, 'Running migrations on test database...');
  await runner({
    databaseUrl: testDbUrl,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    verbose: true,
  });

  logger.info('Test database setup and migrations complete.');
}

setupTestDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Error setting up test database.');
    process.exit(1);
  });
