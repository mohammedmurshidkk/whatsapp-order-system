import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function runMigration(sqlFile: string) {
  const filePath = path.join(__dirname, '../migrations', sqlFile);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Migration file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log(`📄 Reading migration file: ${sqlFile}`);
  const sql = fs.readFileSync(filePath, 'utf-8');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL not found in .env file');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();

    console.log('🚀 Running migration...');
    await client.query(sql);

    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Get migration type from command line
const migrationType = process.argv[2];

if (!migrationType) {
  console.log(`
Usage:
  pnpm migrate:fresh   - Drop all tables and recreate (DESTRUCTIVE!)
  pnpm migrate:update  - Safe migration, add/update tables only
  pnpm migrate:business - Create a new business (edit SQL first)
  `);
  process.exit(1);
}

let sqlFile: string;

switch (migrationType) {
  case 'fresh':
    console.log('⚠️  WARNING: This will DROP all existing tables!');
    sqlFile = 'FRESH_INSTALL.sql';
    break;
  case 'update':
    sqlFile = 'UPDATE_EXISTING.sql';
    break;
  case 'business':
    sqlFile = 'CREATE_BUSINESS.sql';
    break;
  default:
    console.error(`❌ Unknown migration type: ${migrationType}`);
    process.exit(1);
}

runMigration(sqlFile);
