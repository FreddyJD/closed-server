/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('user_organizations', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.uuid('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
    table.enum('role', ['owner', 'admin', 'member']).defaultTo('member');
    table.boolean('active').defaultTo(true);
    table.timestamp('invited_at');
    table.timestamp('joined_at').defaultTo(knex.fn.now());
    table.string('invited_by_user_id'); // Who invited this user
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Unique constraint: user can only have one role per organization
    table.unique(['user_id', 'organization_id']);
    
    table.index(['user_id']);
    table.index(['organization_id']);
    table.index(['role']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('user_organizations');
};
