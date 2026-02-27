import { Router, Request, Response } from "express";
import { connectionPool } from "../utils/db";

const showtimes = Router();

showtimes.get("/active-today", async (req: Request, res: Response): Promise<any> => {
  try {
    const queryDate = req.query.date || new Date().toISOString().split("T")[0]; 

    // ดึงเฉพาะ ID หนัง ที่มีคิวฉายในวันนี้จริงๆ เท่านั้น
    const query = `
      SELECT DISTINCT movie_id 
      FROM showtimes 
      WHERE start_time::DATE = $1::DATE
    `;
    
    const result = await connectionPool.query(query, [queryDate]);
    const activeIds = result.rows.map(row => row.movie_id);
    
    return res.status(200).json({ data: activeIds });
  } catch (error: any) {
    console.error("❌ Fetch Active Movies Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

showtimes.get("/movie/:movieId", async (req: Request, res: Response): Promise<any> => {
  try {
    const { movieId } = req.params;
    
    // 💡 1. รับค่าวันที่จาก Query String (ถ้าไม่ส่งมา ให้ใช้วันนี้เป็นค่าเริ่มต้น)
    const queryDate = req.query.date || new Date().toISOString().split("T")[0]; 

    const query = `
      SELECT
        showtimes.id AS showtime_id,
        TO_CHAR(showtimes.start_time, 'HH24:MI') AS show_time,
        showtimes.start_time,
        showtimes.end_time,
        showtimes.base_price,

        halls.id AS hall_id,
        halls.name AS hall_name,

        cinemas.id AS cinema_id,
        cinemas.name AS cinema_name,

        cities.name AS city

      FROM showtimes
      JOIN halls   ON showtimes.hall_id = halls.id
      JOIN cinemas ON halls.cinema_id = cinemas.id
      JOIN cities  ON cinemas.city_id = cities.id

      -- 💡 2. เพิ่มเงื่อนไข AND DATE(...) ตรงนี้ เพื่อกรองเอาแค่วันเดียว!
      WHERE showtimes.movie_id = $1 
        -- 💡 เพิ่ม ::DATE ทั้ง 2 ฝั่งเพื่อบังคับให้มันเทียบ วันที่ กับ วันที่ เป๊ะๆ
        AND showtimes.start_time::DATE = $2::DATE
      ORDER BY cinemas.name, halls.name, showtimes.start_time
    `;

    // 💡 3. ส่ง queryDate เข้าไปใน SQL ด้วย
    const result = await connectionPool.query(query, [movieId, queryDate]);

    if (result.rows.length === 0) {
      return res.status(200).json({ data: [] });
    }

    // ===============================
    // Group data → cinema > halls > schedules
    // ===============================
    const grouped: any = {};

    for (const row of result.rows) {
      if (!grouped[row.cinema_id]) {
        grouped[row.cinema_id] = {
          cinema_id: row.cinema_id,
          cinema_name: row.cinema_name,
          city: row.city,
          halls: {},
        };
      }

      if (!grouped[row.cinema_id].halls[row.hall_id]) {
        grouped[row.cinema_id].halls[row.hall_id] = {
          hall_name: row.hall_name,
          schedules: [],
        };
      }

      grouped[row.cinema_id].halls[row.hall_id].schedules.push({
        id: row.showtime_id,
        time: row.show_time,
      });
    }

    const finalData = Object.values(grouped).map((cinema: any) => ({
      cinema_id: cinema.cinema_id,
      cinema_name: cinema.cinema_name,
      city: cinema.city,
      halls: Object.values(cinema.halls),
    }));

    return res.status(200).json({
      data: finalData,
    });

  } catch (error: any) {
    console.error("❌ Showtime Error:", error);
    return res.status(500).json({
      message: "ดึงข้อมูลรอบฉายไม่สำเร็จ",
      error: error.message,
    });
  }
});

export default showtimes;