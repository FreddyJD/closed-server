/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('enterprise_inquiries', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('company_name').notNullable();
    table.string('company_domain').notNullable();
    table.string('contact_name').notNullable();
    table.string('contact_email').notNullable();
    table.string('contact_phone');
    table.integer('estimated_seats').notNullable();
    table.enum('plan', ['basic', 'pro']).defaultTo('basic');
    table.jsonb('features').defaultTo('{}'); // Selected WorkOS features
    table.decimal('pricing_total', 10, 2); // Calculated monthly total
    table.text('notes'); // Additional requirements/notes
    table.enum('status', ['pending_review', 'in_progress', 'quote_sent', 'approved', 'rejected']).defaultTo('pending_review');
    table.uuid('assigned_to_user_id'); // Sales rep assigned
    table.timestamp('quote_sent_at');
    table.timestamp('approved_at');
    table.uuid('organization_id'); // Created organization after approval
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['status']);
    table.index(['company_domain']);
    table.index(['contact_email']);
    table.index(['created_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('enterprise_inquiries');
};
