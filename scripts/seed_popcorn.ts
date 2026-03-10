import { Client } from 'pg';
const client = new Client({ connectionString: 'postgresql://postgres.gqisktdvbtzjwedogtdh:Teamfinalmijor3@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres' });

async function seed() {
    await client.connect();
    try {
        const res = await client.query("SELECT * FROM minigames WHERE slug='popcorn'");
        if (res.rows.length === 0) {
            await client.query("INSERT INTO minigames (name, slug, is_active) VALUES ('Popcorn Frenzy', 'popcorn', true)");
            console.log('Successfully seeded Popcorn Frenzy');
        } else {
            console.log('Already seeded');
        }
    } catch (e) {
        console.error(e);
    }
    await client.end();
}
seed();
