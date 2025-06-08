/**
 * Simple team management for SMB teams
 * - Subscription owners can add team members by email
 * - Team members get access when they login with WorkOS
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('team_members', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('subscription_id').references('id').inTable('subscriptions').onDelete('CASCADE');
    table.string('email').notNullable();
    table.enum('status', ['invited', 'active']).defaultTo('invited');
    table.timestamp('invited_at').defaultTo(knex.fn.now());
    table.timestamp('joined_at');
    table.timestamp('last_used_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Prevent duplicate invites for same subscription
    table.unique(['subscription_id', 'email']);
    table.index(['email']);
    table.index(['subscription_id']);
    table.index(['status']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('team_members');
}; 