import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionPool = new Pool({
  connectionString: process.env.CONNECTION_STRING,
});

export { connectionPool };