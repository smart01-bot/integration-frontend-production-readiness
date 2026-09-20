import pgp from 'pg-promise';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const connectionString = process.env.DATABASE_URL;

// Initialize pg-promise
const initOptions = {
  error: (error, e) => {
    console.warn('⚠️ Database query warning:', error.message || error);
  }
};
const pgPromise = pgp(initOptions);

let db;

if (connectionString && connectionString.startsWith('postgres')) {
  // Create database connection
  db = pgPromise({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    },
    max: 20
  });

  db.connect()
    .then(obj => {
      console.log('✅ PostgreSQL connected to Supabase (pg-promise)');
      obj.done();
    })
    .catch(error => {
      console.warn('⚠️ Direct PostgreSQL connection inactive (using Supabase REST client):', error.message || error);
    });
} else {
  throw new Error('[config/database.js] DATABASE_URL is required for direct PostgreSQL access.');
}

export default db;
