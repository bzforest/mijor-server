import express, { Request, Response } from "express";
import { connectionPool } from "../utils/db";

const notificationRouter = express.Router();

notificationRouter.get("/", async (req: Request, res: Response) => {
  try {
    // Fetch all currently showing movies (status = now)
    // Use DISTINCT ON (title) to avoid duplicates if the same movie exists multiple times
    const moviesResult = await connectionPool.query(`
      SELECT DISTINCT ON (title)
        id, title, synopsis as description, poster_url as image, created_at, release_date,
        (release_date IS NOT NULL AND release_date >= NOW() - INTERVAL '7 days') AS is_new_this_week,
        (release_date IS NOT NULL AND release_date::date = CURRENT_DATE) AS is_new_today
      FROM movies 
      WHERE LOWER(status) LIKE '%now%'
      ORDER BY title, COALESCE(release_date, created_at) DESC 
      LIMIT 200
    `);

    // Sort the final result again by date because DISTINCT ON requires ORDER BY to start with the same column
    const moviesSorted = moviesResult.rows.sort((a: any, b: any) => 
      new Date(b.release_date || b.created_at).getTime() - new Date(a.release_date || a.created_at).getTime()
    );

    // Fetch active coupons that have not expired yet (valid_until is the correct column name)
    const couponsResult = await connectionPool.query(`
      SELECT id, title, description, image_url as image, created_at, valid_until
      FROM coupons 
      WHERE is_active = true
        AND (valid_until IS NULL OR valid_until >= NOW())
      ORDER BY created_at DESC 
      LIMIT 200
    `);

    const movies = moviesSorted.map((row: any) => ({
      id: row.id,
      type: "movie",
      title: row.title,
      description: row.description,
      image: row.image,
      // Use release_date as time so "new today" badge works correctly
      time: row.release_date || row.created_at,
      is_new_this_week: row.is_new_this_week || false,
      is_new_today: row.is_new_today || false,
    }));

    const coupons = couponsResult.rows.map((row: any) => ({
      id: row.id,
      type: "coupon",
      title: row.title,
      description: row.description,
      image: row.image,
      time: row.created_at,
    }));

    // Combine and sort by time
    const allNotifications = [...movies, ...coupons]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return res.status(200).json({
      success: true,
      data: {
        all: allNotifications,
        movie: movies,
        coupon: coupons
      }
    });
  } catch (error: any) {
    console.error("❌ Notification DB Error:", error);
    return res.status(500).json({
      message: "ดึงข้อมูลการแจ้งเตือนไม่สำเร็จ",
      error: error.message
    });
  }
});

export default notificationRouter;
