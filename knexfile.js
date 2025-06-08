const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    }
  },

  production: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    } : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    },
    pool: {
      min: 2,
      max: 10
    }
  }
}; 