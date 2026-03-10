import { connectionPool } from "./utils/db";

async function checkSchema() {
    try {
        const res = await connectionPool.query("SELECT * FROM movies LIMIT 1");
        console.log("Columns:", Object.keys(res.rows[0] || {}));
        console.log("Sample row:", res.rows[0]);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
