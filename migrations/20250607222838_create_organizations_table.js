/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('organizations', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.string('slug').unique(); // For custom domains/URLs
    table.string('domain'); // Company domain for SSO
    table.string('workos_organization_id').unique(); // WorkOS org ID for SSO
    table.string('workos_connection_id'); // WorkOS SSO connection ID
    table.enum('plan', ['individual', 'team', 'enterprise']).defaultTo('individual');
    table.boolean('sso_enabled').defaultTo(false);
    table.boolean('sso_required').defaultTo(false); // Force all users to use SSO
    table.integer('max_seats').defaultTo(1);
    table.text('logo_url');
    table.jsonb('settings').defaultTo('{}'); // Custom organization settings
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['slug']);
    table.index(['domain']);
    table.index(['workos_organization_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('organizations');
};
