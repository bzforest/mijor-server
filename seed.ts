import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// โหลดค่า Environment Variables (.env)
dotenv.config();

// ⚠️ ใช้ Service Role Key เพื่อให้มีสิทธิ์ Insert ทะลุ RLS ได้
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// ฟังก์ชันสุ่มภาษาและเรตติ้ง (เพราะใน JSON ไม่มี)
const getRandomLanguage = () => {
  const langs = ['TH', 'EN', 'TH/EN'];
  return langs[Math.floor(Math.random() * langs.length)];
};
const getRandomRating = () => (Math.random() * (5.0 - 3.5) + 3.5).toFixed(1);

async function seedDatabase() {
  console.log('🌱 Starting database seeding...');

  try {
    // 1. อ่านไฟล์ JSON
    const rawData = fs.readFileSync('./major-cineplex.json', 'utf-8');
    const moviesJson = JSON.parse(rawData);

    // 2. คลีนอัพและดึงเฉพาะชื่อหมวดหมู่ (Genres) ที่ไม่ซ้ำกัน
    const uniqueGenres = new Set<string>();
    moviesJson.forEach((m: any) => {
      let genre = m.genre?.trim();
      // ข้ามหมวดหมู่ที่ข้อมูลพัง เช่น "83\n mins"
      if (genre && !genre.includes('mins')) {
        uniqueGenres.add(genre);
      }
    });

    // 3. Insert ข้อมูลลงตาราง genres (ถ้ามีอยู่แล้วให้ข้าม)
    console.log(`Inserting ${uniqueGenres.size} genres...`);
    const genreArray = Array.from(uniqueGenres).map((name) => ({ name }));
    const { data: insertedGenres, error: genreError } = await supabase
      .from('genres')
      .upsert(genreArray, { onConflict: 'name' }) // ถ้าชื่อซ้ำให้อัปเดต/ข้าม
      .select();

    if (genreError) throw genreError;

    // สร้าง Map เก็บ Genre Name -> Genre ID ไว้จับคู่ตอนหลัง
    const genreMap = new Map();
    insertedGenres?.forEach((g) => genreMap.set(g.name, g.id));

    // 4. เตรียมข้อมูล Movies และ Insert
    console.log(`Inserting ${moviesJson.length} movies...`);
    const movieInserts = moviesJson.map((m: any) => {
      let duration = parseInt(m.timeMin);
      if (isNaN(duration) || duration === 0) duration = 120; // Default 120 นาที

      return {
        title: m.display || m.name_en, // ใช้ชื่อ Display เป็นหลัก
        synopsis: 'Mock synopsis description for ' + (m.display || m.name_en),
        duration_mins: duration,
        poster_url: m.theater?.major?.cover || null,
        release_date: m.release ? m.release.split('T')[0] : null, // เอาแค่ YYYY-MM-DD
        language: getRandomLanguage(),
        rating: parseFloat(getRandomRating()),
      };
    });

    // Insert ลงตาราง movies และขอ ID กลับมา
    const { data: insertedMovies, error: movieError } = await supabase
      .from('movies')
      .insert(movieInserts)
      .select();

    if (movieError) throw movieError;

    // 5. นำ ID ของหนัง และ ID ของ Genre มาผูกกันในตาราง movie_genres
    console.log('Mapping movies with genres...');
    const movieGenreInserts: any[] = [];
    
    moviesJson.forEach((m: any, index: number) => {
      const genreName = m.genre?.trim();
      if (genreName && genreMap.has(genreName)) {
        movieGenreInserts.push({
          movie_id: insertedMovies[index].id,
          genre_id: genreMap.get(genreName),
        });
      }
    });

    const { error: mappingError } = await supabase
      .from('movie_genres')
      .insert(movieGenreInserts);

    if (mappingError) throw mappingError;

    console.log('✅ Seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
  }
}

seedDatabase();