import { Router, Request, Response } from "express";
import { connectionPool } from "../utils/db";

const movieGenres = Router();

/**
 * GET /moviegenres/:movieId
 * ดึง genre ของหนังตาม movie_id
 */
movieGenres.get("/:movieId", async (req: Request, res: Response) => {
  try {
    const { movieId } = req.params;

    const result = await connectionPool.query(
      `
      SELECT g.id, g.name
      FROM movie_genres mg
      JOIN genres g ON mg.genre_id = g.id
      WHERE mg.movie_id = $1
      `,
      [movieId]
    );

    return res.status(200).json({
      data: result.rows
    });

  } catch (error: any) {
    console.error("GET movie_genres error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message
    });
  }
});

export default movieGenres;