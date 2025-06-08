/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('subscriptions', function(table) {
    table.uuid('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
    table.enum('billing_type', ['individual', 'organization']).defaultTo('individual');
  
    // Add index for organization queries
    table.index(['organization_id']);
    table.index(['billing_type']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('subscriptions', function(table) {
    table.dropColumn('organization_id');
    table.dropColumn('billing_type');
  });
};
