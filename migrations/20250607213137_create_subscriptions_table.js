/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('subscriptions', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('lemon_squeezy_subscription_id').unique();
    table.string('lemon_squeezy_customer_id');
    table.enum('plan', ['basic', 'pro']).notNullable();
    table.decimal('price_per_seat', 10, 2).notNullable();
    table.integer('seats').defaultTo(1);
    table.enum('status', ['active', 'cancelled', 'past_due', 'unpaid', 'incomplete']).defaultTo('active');
    table.timestamp('current_period_start');
    table.timestamp('current_period_end');
    table.timestamp('cancelled_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['user_id']);
    table.index(['lemon_squeezy_subscription_id']);
    table.index(['status']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('subscriptions');
};
