/**
 * Initial database schema for Closed AI Battlecards
 * Creates tenants and users tables with proper relationships
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create tenants table first (parent table)
  await knex.schema.createTable('tenants', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.string('stripe_customer_id').unique();
    table.string('stripe_subscription_id').unique();
    table.enum('plan', ['basic', 'pro']).notNullable().defaultTo('basic');
    table.integer('seats').defaultTo(1);
    table.enum('status', ['active', 'inactive']).defaultTo('active');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.index(['stripe_customer_id']);
    table.index(['stripe_subscription_id']);
    table.index(['status']);
  });

  // Create users table (child table that references tenants)
  await knex.schema.createTable('users', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').references('id').inTable('tenants').onDelete('CASCADE');
    table.string('email').unique().notNullable();
    table.string('password_hash').notNullable();
    table.string('first_name');
    table.string('last_name');
    table.enum('role', ['admin', 'member']).defaultTo('member');
    table.enum('status', ['active', 'inactive']).defaultTo('active');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.index(['tenant_id']);
    table.index(['email']);
    table.index(['status']);
    table.index(['role']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop in reverse order to respect foreign key constraints
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('tenants');
}; 