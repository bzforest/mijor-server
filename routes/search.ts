import { Router, Request, Response } from "express";
import { connectionPool } from "../utils/db";

// ===== Types =====

/* --- Database Rows --- */
interface MovieCinemaPair {
  title: string;
  cinema_name: string;
}

interface MovieRow {
  id: number;
  title: string;
  synopsis: string;
  poster_url: string;
  release_date: Date;
  language: string;
  rating: string;
  status: string;
  hall_name?: string;
  start_time?: Date;
  end_time?: Date;
  cinema_name?: string;
  location?: string;
  hearing_assistance?: boolean;
  wheelchair_access?: boolean;
  city?: string;
}

interface GenreRow {
  movie_id: number;
  name: string;
}

interface FilterLanguageRow {
  language: string;
}

interface FilterNameRow {
  name: string;
}

/* --- Aggregated Data Structures --- */
interface Schedule {
  id: string;
  time: string;
  endTime?: Date;
}

interface AggregatedMovie {
  id: number;
  title: string;
  synopsis: string;
  posterUrl: string;
  releaseDate: Date;
  language: string[];
  rating: string;
  status: string;
  genres: string[];
  location: string;
  city?: string;
  hearingAssistance: boolean;
  wheelchairAccess: boolean;
  hallsMap: Record<string, Schedule[]>;
}

// ===== Router Initialization =====
const searchRouter = Router();

// ===== Route Handlers =====

/**
 * GET /movies
 * Responsibility: Fetch paginated movies grouped by Title + Cinema,
 * including dynamic filters, nested halls, and showtimes.
 */
searchRouter.get("/movies", async (req: Request, res: Response) => {
  try {
    /* ================= 1. Request Parsing ================= */
    const {
      title,
      language,
      genre,
      city,
      releaseDate,
      page,
      hearingAssistance,
      wheelchairAccess,
    } = req.query;

    const LIMIT = 3;
    const currentPage = Math.max(1, parseInt(page as string, 10) || 1);
    const offset = (currentPage - 1) * LIMIT;

    /* ================= 2. Dynamic Query Builder ================= */
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    let joinGenres = false;
    let joinCinemas = false;
    let joinCities = false;

    if (title) {
      conditions.push(`movies.title ILIKE $${paramIndex}`);
      values.push(`%${title}%`);
      paramIndex++;
    }

    if (language) {
      conditions.push(`movies.language = $${paramIndex}`);
      values.push(language);
      paramIndex++;
    }

    if (releaseDate) {
      conditions.push(`movies.release_date = $${paramIndex}`);
      values.push(releaseDate);
      paramIndex++;
    }

    if (genre) {
      joinGenres = true;
      conditions.push(`genres.name = $${paramIndex}`);
      values.push(genre);
      paramIndex++;
    }

    if (city) {
      joinCinemas = true;
      joinCities = true;
      conditions.push(`cities.name = $${paramIndex}`);
      values.push(city);
      paramIndex++;
    }

    if (hearingAssistance === "true") {
      joinCinemas = true;
      conditions.push(`cinemas.hearing_assistance = TRUE`);
    }

    if (wheelchairAccess === "true") {
      joinCinemas = true;
      conditions.push(`cinemas.wheelchair_access = TRUE`);
    }

    // --- Query Assembly ---
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    let fromClause = `
      FROM movies
      LEFT JOIN showtimes ON showtimes.movie_id = movies.id
      LEFT JOIN halls ON halls.id = showtimes.hall_id
      LEFT JOIN cinemas ON cinemas.id = halls.cinema_id
    `;

    if (joinCities) {
      fromClause += `LEFT JOIN cities ON cities.id = cinemas.city_id\n    `;
    }

    if (joinGenres) {
      fromClause += `
      JOIN movie_genres ON movie_genres.movie_id = movies.id
      JOIN genres ON genres.id = movie_genres.genre_id
    `;
    }

    /* ================= 3. Pagination & Data Fetching ================= */
    // Guarantee pagination consistency by grouping uniqueness via Title + Cinema pairs

    // --- Step 3.1: Count Total Pairs ---
    const countQuery = `
      SELECT COUNT(*) 
      FROM (
        SELECT DISTINCT movies.title, COALESCE(cinemas.name, '') AS cinema_name
        ${fromClause} 
        ${whereClause}
      ) AS pairs
    `;

    const countResult = await connectionPool.query(countQuery, values);
    const totalCount = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalCount / LIMIT);

    // --- Step 3.2: Fetch Paginated Pairs ---
    const pairsQuery = `
      SELECT
        movies.title,
        COALESCE(cinemas.name, '') AS cinema_name,
        MAX(movies.release_date) AS latest_release,
        MAX(movies.status) AS status
      ${fromClause}
      ${whereClause}
      GROUP BY movies.title, COALESCE(cinemas.name, '')
      ORDER BY
        CASE MAX(movies.status)
          WHEN 'Now Showing'    THEN 1
          WHEN 'Coming Soon'    THEN 2
          WHEN 'Out of Theater' THEN 3
          ELSE 4
        END ASC,
        MAX(movies.release_date) DESC,
        COALESCE(cinemas.name, '') ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const pairsValues = [...values, LIMIT, offset];
    const pairsResult = await connectionPool.query(pairsQuery, pairsValues);

    const identifiers: MovieCinemaPair[] = pairsResult.rows.map((row: MovieCinemaPair) => ({
      title: row.title,
      cinema_name: row.cinema_name,
    }));

    if (identifiers.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: { totalCount, totalPages, currentPage, limit: LIMIT },
      });
    }

    /* ================= 4. Detail Enrichment ================= */

    // --- Step 4.1: Fetch Full Data for Specific Pairs ---
    const pairPlaceholders = identifiers
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      .join(", ");
    const pairValues = identifiers.flatMap((p) => [p.title, p.cinema_name]);

    const dataQuery = `
      SELECT
        movies.id,
        movies.title,
        movies.synopsis,
        movies.poster_url,
        movies.release_date,
        movies.language,
        movies.rating,
        movies.status,
        halls.name AS hall_name,
        showtimes.start_time,
        showtimes.end_time,
        cinemas.name AS cinema_name,
        cinemas.location,
        cinemas.hearing_assistance,
        cinemas.wheelchair_access,
        cinemas.id AS cinema_id,
        cities.name AS city
      FROM movies
      LEFT JOIN showtimes ON showtimes.movie_id = movies.id
      LEFT JOIN halls ON halls.id = showtimes.hall_id
      LEFT JOIN cinemas ON cinemas.id = halls.cinema_id
      LEFT JOIN cities ON cities.id = cinemas.city_id
      WHERE (movies.title, COALESCE(cinemas.name, '')) IN (${pairPlaceholders}) 
      ORDER BY movies.release_date DESC, showtimes.start_time ASC
    `;

    const moviesResult = await connectionPool.query(dataQuery, pairValues);

    // --- Step 4.2: Map Genres to Movies ---
    const movieIds = [...new Set(moviesResult.rows.map((m: MovieRow) => m.id))];
    const genresMap: Record<number, string[]> = {};

    if (movieIds.length > 0) {
      const genresQuery = `
        SELECT movie_genres.movie_id, genres.name
        FROM movie_genres
        JOIN genres ON genres.id = movie_genres.genre_id
        WHERE movie_genres.movie_id = ANY($1)
      `;

      const genresResult = await connectionPool.query(genresQuery, [movieIds]);

      genresResult.rows.forEach((row: GenreRow) => {
        if (!genresMap[row.movie_id]) {
          genresMap[row.movie_id] = [];
        }
        genresMap[row.movie_id].push(row.name);
      });
    }

    /* ================= 5. Data Aggregation ================= */
    // Responsibility: Transform flat SQL rows into a nested JSON structure (Movie -> Halls -> Schedules)

    const moviesMap: Record<string, AggregatedMovie> = {};

    moviesResult.rows.forEach((row: MovieRow) => {
      const cinemaName = row.cinema_name || "Unknown Cinema";

      // Use composite key (title + cinema) to strictly match the pagination grouping limit applied in Step 3
      const compositeKey = `${row.title}-${cinemaName}`;

      // --- 5.1 Initialize Movie Entity ---
      if (!moviesMap[compositeKey]) {
        moviesMap[compositeKey] = {
          id: row.id,
          title: row.title,
          synopsis: row.synopsis,
          posterUrl: row.poster_url,
          releaseDate: row.release_date,
          language: row.language ? [row.language] : [],
          rating: row.rating,
          status: row.status,
          genres: genresMap[row.id] || [],
          location: cinemaName,
          city: row.city,
          hearingAssistance: row.hearing_assistance ?? false,
          wheelchairAccess: row.wheelchair_access ?? false,
          hallsMap: {},
        };
      }

      // --- 5.2 Process Halls ---
      const hallName = row.hall_name || "Unknown";
      if (!moviesMap[compositeKey].hallsMap[hallName]) {
        moviesMap[compositeKey].hallsMap[hallName] = [];
      }

      // --- 5.3 Process Schedules ---
      if (row.start_time) {
        const dateObj = new Date(row.start_time);
        const hours = String(dateObj.getUTCHours()).padStart(2, "0");
        const minutes = String(dateObj.getUTCMinutes()).padStart(2, "0");
        const timeStr = `${hours}:${minutes}`;

        const currentHallSchedules = moviesMap[compositeKey].hallsMap[hallName];
        const isDuplicate = currentHallSchedules.some((s: Schedule) => s.time === timeStr);

        if (!isDuplicate) {
          currentHallSchedules.push({
            id: `${compositeKey}-${hallName}-${timeStr}`,
            time: timeStr,
            endTime: row.end_time,
          });
        }
      }
    });

    // --- 5.4 Finalize Transformation (Map to Array & Sort) ---
    const aggregatedData = Object.values(moviesMap).map((movie) => {
      const halls = Object.entries(movie.hallsMap)
        // Ensure halls are sorted in ascending order (e.g., HALL01, HALL02, HALL03)
        .sort(([hallNameA], [hallNameB]) => {
          const numA = parseInt(hallNameA.replace(/\D/g, ""), 10);
          const numB = parseInt(hallNameB.replace(/\D/g, ""), 10);

          if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
            return numA - numB;
          }

          return hallNameA.localeCompare(hallNameB);
        })
        .map(([hallName, schedules]) => ({
          id: hallName,
          name: hallName,
          schedules: schedules.sort((a, b) => a.time.localeCompare(b.time)),
        }));

      const { hallsMap, ...finalMovieData } = movie;

      return {
        ...finalMovieData,
        halls,
      };
    });

    /* ================= 6. Response ================= */
    return res.status(200).json({
      data: aggregatedData,
      pagination: {
        totalCount,
        totalPages,
        currentPage,
        limit: LIMIT,
      },
    });

  } catch (error: any) {
    console.error("[SearchRouter] Fetch movies failed:", error);
    return res.status(500).json({
      message: "ค้นหาไม่สำเร็จ",
      error: error.message,
    });
  }
});

/**
 * GET /suggest
 * Responsibility: Provide autocomplete suggestions for movie titles based on user input.
 */
searchRouter.get("/suggest", async (req: Request, res: Response) => {
  const { title } = req.query;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return res.status(200).json({ suggestions: [] });
  }

  try {
    const result = await connectionPool.query(
      `SELECT DISTINCT title FROM movies WHERE title ILIKE $1 ORDER BY title LIMIT 8`,
      [`%${title.trim()}%`]
    );

    return res.status(200).json({
      suggestions: result.rows.map((r: { title: string }) => r.title),
    });
  } catch (error: any) {
    console.error("[SearchRouter] Fetch suggestions failed:", error);
    return res.status(500).json({
      message: "ดึง suggestion ไม่สำเร็จ",
      error: error.message
    });
  }
});

/**
 * GET /filter
 * Responsibility: Return available distinct reference values for dropdown filters.
 */
searchRouter.get("/filter", async (_req: Request, res: Response) => {
  try {
    const [langResult, genreResult, cityResult] = await Promise.all([
      connectionPool.query(`
        SELECT DISTINCT language 
        FROM movies 
        WHERE language IS NOT NULL 
        ORDER BY language
      `),
      connectionPool.query(`
        SELECT DISTINCT name 
        FROM genres 
        ORDER BY name
      `),
      connectionPool.query(`
        SELECT DISTINCT name 
        FROM cities 
        WHERE name IS NOT NULL 
        ORDER BY name
      `),
    ]);

    return res.status(200).json({
      languages: langResult.rows.map((row: FilterLanguageRow) => row.language),
      genres: genreResult.rows.map((row: FilterNameRow) => row.name),
      cities: cityResult.rows.map((row: FilterNameRow) => row.name),
    });
  } catch (error: any) {
    console.error("[SearchRouter] Fetch filter options failed:", error);
    return res.status(500).json({
      message: "ดึงตัวเลือกไม่สำเร็จ",
      error: error.message,
    });
  }
});

export default searchRouter;