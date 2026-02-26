import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectionPool } from './utils/db';
import routerApiAuth from "./routes/auth.routes";
import couponsRoutes from './routes/coupons';
import userCouponsRoutes from './routes/userCoupons';import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(cors()); // อนุญาตทุกโดเมนไปก่อน (เดี๋ยวค่อยมาแก้ตอนเชื่อมกับ Frontend จริงจัง)
app.use(express.json());

// Supabase Client Setup
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

app.use("/api/auth", routerApiAuth);

app.use('/coupons', couponsRoutes);
app.use('/api/user/coupons', userCouponsRoutes);
// Test Route
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running! 🚀");
});

app.get("/testdb", async (req, res) => {
    try {
      const results = await connectionPool.query('SELECT * FROM movies');
      
      return res.status(200).json({
        data: results.rows
      });
    } catch (error: any) {
      console.log("❌ DB Error: ", error); // 👈 ปริ้น Error จริงๆ ออก Terminal
      
      return res.status(500).json({
        message: "ดึงข้อมูลไม่สำเร็จ",
        error: error.message // 👈 ส่ง Error กลับไปโชว์ใน Postman ด้วย
      });
    }
  });

app.get("/testcinemas", async (req, res) => {
    try {
      const results = await connectionPool.query('SELECT * FROM cinemas');
      
      return res.status(200).json({
        data: results.rows
      });
    } catch (error: any) {
      console.log("❌ DB Error: ", error); // 👈 ปริ้น Error จริงๆ ออก Terminal
      
      return res.status(500).json({
        message: "ดึงข้อมูลไม่สำเร็จ",
        error: error.message // 👈 ส่ง Error กลับไปโชว์ใน Postman ด้วย
      });
    }
  });

app.get("/testshowtime" , async (req,res) => {
    try {
        const results = await connectionPool.query (`SELECT * FROM showtimes`);
        return res.status(200).json ({
            data: results.rows
        })

    }catch (error) {
        return res.status(500).json ({
            message: "โหลดไม่ได้โว้ยยย"
        })
    }
})

// GET /api/cinemas - Fetch all active cinemas
app.get("/api/cinemas", async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('cinemas')
      .select('*, cities(name)')
      .eq('is_active', true);

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cinemas/:id/showtimes - Fetch highly nested showtimes for a specific cinema
app.get("/api/cinemas/:id/showtimes", async (req: Request, res: Response): Promise<void> => {
  const cinemaId = req.params.id;

  try {
    // 0. Fetch Cinema Details
    const { data: cinemaData, error: cinemaError } = await supabase
      .from('cinemas')
      .select('id, name, hearing_assistance, wheelchair_access, image_url, description')
      .eq('id', cinemaId)
      .single();

    if (cinemaError) throw cinemaError;

    // 1. Fetch Halls for this cinema
    const { data: hallsData, error: hallsError } = await supabase
      .from('halls')
      .select('id, name')
      .eq('cinema_id', cinemaId);

    if (hallsError) throw hallsError;
    if (!hallsData || hallsData.length === 0) {
      res.json([]);
      return;
    }

    const hallIds = hallsData.map(h => h.id);

    // 2. Fetch Showtimes for these halls, with nested Movie data
    let showtimesQuery = supabase
      .from('showtimes')
      .select(`
        id,
        hall_id,
        start_time,
        movies (
          id,
          title,
          poster_url,
          language,
          movie_genres (
            genres (
              name
            )
          )
        )
      `)
      .in('hall_id', hallIds);

    const dateQuery = req.query.date as string;
    if (dateQuery) {
      showtimesQuery = showtimesQuery
        .gte('start_time', `${dateQuery}T00:00:00.000Z`)
        .lte('start_time', `${dateQuery}T23:59:59.999Z`);
    }

    const { data: showtimesData, error: showtimesError } = await showtimesQuery;

    if (showtimesError) throw showtimesError;

    // 3. Transform the flat showtimesData into a structured nested object: Movie -> Halls -> Schedules
    const moviesMap = new Map<string, any>();

    showtimesData?.forEach((showtime: any) => {
      const movie = showtime.movies;
      // Safety check in case movie data is missing
      if (!movie) return;

      const movieId = movie.id;
      const hallId = showtime.hall_id;
      const timeMatch = showtime.start_time.match(/T(\d{2}:\d{2})/);
      // Fallback if regex fails to match "HH:mm"
      const timeString = timeMatch ? timeMatch[1] : showtime.start_time;

      // Extract genres strings from deeply nested relation
      const tags = [movie.language];
      if (movie.movie_genres) {
        movie.movie_genres.forEach((mg: any) => {
          if (mg.genres?.name) {
            tags.push(mg.genres.name);
          }
        });
      }

      const scheduleObj = {
        id: showtime.id,
        time: timeString
      };

      // Initialize Movie if not exists
      if (!moviesMap.has(movieId)) {
        moviesMap.set(movieId, {
          id: movieId,
          title: movie.title,
          posterUrl: movie.poster_url,
          tags: tags.filter(Boolean), // Filter out undefined languages
          hallsMap: new Map<string, any>() // Temporary map to group halls by ID
        });
      }

      const currentMovie = moviesMap.get(movieId);

      // Initialize Hall inside this Movie if not exists
      if (!currentMovie.hallsMap.has(hallId)) {
        const hallInfo = hallsData.find(h => h.id === hallId);
        currentMovie.hallsMap.set(hallId, {
          id: hallId,
          name: hallInfo?.name || `Hall ${hallId.substring(0, 4)}`,
          schedules: []
        });
      }

      const currentHall = currentMovie.hallsMap.get(hallId);
      currentHall.schedules.push(scheduleObj);
    });

    // 4. Convert Maps back into pure Arrays for the Frontend JSON response
    const finalResponse = Array.from(moviesMap.values()).map(movie => {
      // Sort schedules by time
      const hallsArray = Array.from((movie.hallsMap as Map<string, any>).values()).map(hall => {
        hall.schedules.sort((a: any, b: any) => a.time.localeCompare(b.time));
        return hall;
      });

      // Sort halls by name
      hallsArray.sort((a, b) => a.name.localeCompare(b.name));

      return {
        id: movie.id,
        title: movie.title,
        posterUrl: movie.posterUrl,
        tags: movie.tags,
        halls: hallsArray
      };
    });

    res.json({
      cinema: cinemaData,
      movies: finalResponse
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server (เฉพาะตอนรันในเครื่อง Local, บน Vercel มันจะจัดการเอง)
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
}

export default app; // สำคัญมาก! ต้อง export เพื่อให้ Vercel เอาไปใช้ต่อได้