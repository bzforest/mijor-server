import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import movie from "./routes/movies";
import cities from "./routes/cities";
import showtimes from "./routes/Showtimes";
import movieGenres from "./routes/moviegenres";
import routerApiAuth from "./routes/auth.routes";
import couponsRoutes from './routes/coupons';
import userCouponsRoutes from './routes/userCoupons';
import cinemaRoutes from "./routes/cinemaRoutes";
import { errorHandler } from "./middlewares/errorHandler";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(cors()); // อนุญาตทุกโดเมนไปก่อน
app.use(express.json());

app.use('/movies', movie);
app.use('/showtimes',showtimes )
app.use('/cities', cities);
app.use('/movieGenres', movieGenres);
app.use("/api/auth", routerApiAuth);

app.use('/coupons', couponsRoutes);
app.use('/api/user/coupons', userCouponsRoutes);
// Test Route
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running on Clean Architecture! 🚀");
});

// API Routes
app.use("/api/cinemas", cinemaRoutes);

// Global Error Handler
app.use(errorHandler);


// Start Server (เฉพาะตอนรันในเครื่อง Local, บน Vercel มันจะจัดการเอง)
  res.send("Express + TypeScript Server is running! 🚀");
});

app.get("/ex", (req: Request, res: Response) => {
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

app.get("/testshowtime", async (req, res) => {
  try {
    const results = await connectionPool.query(`SELECT * FROM showtimes`);
    return res.status(200).json({
      data: results.rows
    })

  } catch (error) {
    return res.status(500).json({
      message: "โหลดไม่ได้โว้ยยย"
    })
  }
})


if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
}

export default app;