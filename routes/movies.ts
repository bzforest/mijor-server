import { Router, Request, Response } from "express";
import { connectionPool } from "../utils/db";

const movie = Router();

interface Movie {
  id: string;
  title: string;
  synopsis: string;
  duration_mins: number;
  poster_url: string | null;
  release_date: string;
  created_at: string;
  language: string;
  genre: string[];
  rating: number;
  status: "now" | "soon" | "out"; // ✅ เพิ่ม out
  trailer_youtube: string | null;
}

// ==============================
// GET /movies
// ==============================
movie.get("/", async (req: Request, res: Response) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT m.*, (
        SELECT COALESCE(json_agg(g.name), '[]'::json)
        FROM movie_genres mg
        JOIN genres g ON mg.genre_id = g.id
        WHERE mg.movie_id = m.id
      ) AS genres
      FROM movies m
    `;
    let values: any[] = [];

    if (status) {
      query += " WHERE LOWER(m.status) LIKE $1 ";
      values.push(`%${String(status).toLowerCase()}%`);
    }

    query += " ORDER BY m.release_date DESC";

    const results = await connectionPool.query(query, values);

    const formattedMovies: Movie[] = results.rows.map((row: any) => {
      const rawStatus = row.status?.toLowerCase().trim() || "";

      let formattedStatus: "now" | "soon" | "out";

      if (rawStatus.includes("soon") || rawStatus.includes("coming")) {
        formattedStatus = "soon";
      } else if (rawStatus.includes("out")) {
        formattedStatus = "out";
      } else {
        formattedStatus = "now";
      }

      return {
        id: row.id,
        title: row.title || "",
        synopsis: row.synopsis || "",
        duration_mins: row.duration_mins || 0,
        poster_url: row.poster_url || null,
        release_date: row.release_date
          ? new Date(row.release_date).toISOString().split("T")[0]
          : "",
        created_at: row.created_at
          ? new Date(row.created_at).toISOString()
          : "",
        language: row.language || "",
        genre: row.genres || [],
        rating: row.rating ? Number(row.rating) : 0,
        status: formattedStatus,
        trailer_youtube: row.trailer_youtube || null,
      };
    });

    return res.status(200).json({
      data: formattedMovies,
    });
  } catch (error: any) {
    console.log("❌ DB Error:", error);

    return res.status(500).json({
      message: "ดึงข้อมูลไม่สำเร็จ",
      error: error.message,
    });
  }
});

// ==============================
// GET /movies/:id
// ==============================
movie.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const results = await connectionPool.query(
      `
      SELECT m.*, (
        SELECT COALESCE(json_agg(g.name), '[]'::json)
        FROM movie_genres mg
        JOIN genres g ON mg.genre_id = g.id
        WHERE mg.movie_id = m.id
      ) AS genres
      FROM movies m
      WHERE m.id = $1
      `,
      [id]
    );

    if (results.rows.length === 0) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const row = results.rows[0];

    const rawStatus = row.status?.toLowerCase().trim() || "";

    let formattedStatus: "now" | "soon" | "out";

    if (rawStatus.includes("soon") || rawStatus.includes("coming")) {
      formattedStatus = "soon";
    } else if (rawStatus.includes("out")) {
      formattedStatus = "out";
    } else {
      formattedStatus = "now";
    }

    const movie: Movie = {
      id: row.id,
      title: row.title || "",
      synopsis: row.synopsis || "",
      duration_mins: row.duration_mins || 0,
      poster_url: row.poster_url || null,
      release_date: row.release_date
        ? new Date(row.release_date).toISOString().split("T")[0]
        : "",
      created_at: row.created_at
        ? new Date(row.created_at).toISOString()
        : "",
      language: row.language || "",
      genre: row.genres || [],
      rating: row.rating ? Number(row.rating) : 0,
      status: formattedStatus,
      trailer_youtube: row.trailer_youtube || null,
    };

    return res.status(200).json({
      data: movie,
    });
  } catch (error: any) {
    console.log("❌ DB Error:", error);

    return res.status(500).json({
      message: "ดึงข้อมูลไม่สำเร็จ",
      error: error.message,
    });
  }
});

export default movie;