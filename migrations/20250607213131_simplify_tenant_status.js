/**
 * Simplify tenant status to just active/inactive
 * Let Stripe manage trials and billing states
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, update any existing tenants to use the new simple status
  await knex.raw(`
    UPDATE tenants SET status = CASE 
      WHEN status IN ('active', 'trialing') THEN 'active'
      ELSE 'inactive'
    END
  `);
  
  // Drop the old enum and create new one
  await knex.raw('ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check');
  await knex.schema.alterTable('tenants', function(table) {
    table.dropColumn('status');
    table.dropColumn('trial_ends_at');
  });
  
  await knex.schema.alterTable('tenants', function(table) {
    table.enum('status', ['active', 'inactive']).defaultTo('active').notNullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Revert back to complex status system
  await knex.schema.alterTable('tenants', function(table) {
    table.dropColumn('status');
    table.timestamp('trial_ends_at');
  });
  
  await knex.schema.alterTable('tenants', function(table) {
    table.enum('status', ['active', 'cancelled', 'past_due', 'unpaid', 'trialing']).defaultTo('trialing');
  });
}; 