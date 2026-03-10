import { connectionPool } from "./utils/db";

async function inspectDb() {
    try {
        const tables = await connectionPool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

        for (const t of tables.rows) {
            const cols = await connectionPool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [t.table_name]);

            console.log(`\n=== ${t.table_name} ===`);
            cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));
        }

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

inspectDb();
