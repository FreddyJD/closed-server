exports.up = function(knex) {
    return knex.schema.alterTable('team_members', function(table) {
        table.timestamp('suspended_at').nullable();
    });
};

exports.down = function(knex) {
    return knex.schema.alterTable('team_members', function(table) {
        table.dropColumn('suspended_at');
    });
}; 