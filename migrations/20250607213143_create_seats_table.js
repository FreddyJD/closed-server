/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('seats', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('subscription_id').references('id').inTable('subscriptions').onDelete('CASCADE');
    table.string('user_email'); // Email of the user assigned to this seat
    table.string('license_key').unique(); // Unique license key for desktop app
    table.enum('status', ['active', 'revoked', 'unused']).defaultTo('unused');
    table.timestamp('activated_at');
    table.timestamp('last_used_at');
    table.string('machine_identifier'); // Desktop app machine ID
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['subscription_id']);
    table.index(['license_key']);
    table.index(['user_email']);
    table.index(['status']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('seats');
};
