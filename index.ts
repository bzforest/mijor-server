import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectionPool } from "./utils/db";
import searchRouter from "./routes/search";
import movie from "./routes/movies";
import cities from "./routes/cities";
import showtimes from "./routes/Showtimes";
import movieGenres from "./routes/moviegenres";
import routerApiAuth from "./routes/auth.routes";
import couponsRoutes from './routes/coupons';
import userCouponsRoutes from './routes/userCoupons';
import historyRouter from "./routes/history";
import cinemaRoutes from "./routes/cinemaRoutes";
import minigameRoutes from "./routes/minigames";
import { errorHandler } from "./middlewares/errorHandler";
import avatarsRoutes from "./routes/avatars";
import chatbotRouter from "./routes/chatbot";
import bookingRouter from "./routes/booking";
import { startExpireSeatJob } from "./jobs/expireSeats";
import { startMonthlyLeaderboardJob } from "./jobs/rewardLeaderboard";
import { initSocket } from "./utils/socket";
import http from "http";

// Webhook Routes
import webhookRouter from "./routes/webhook";
import paymentRouter from "./routes/payment";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 4000;

const server = http.createServer(app);

// Socket.io
export const io = initSocket(server);

// Webhook Routes
app.use("/webhook", webhookRouter);

// Middleware
app.use(cors()); // อนุญาตทุกโดเมนไปก่อน
app.use(express.json());

app.use('/movies', movie);
app.use('/showtimes', showtimes)
app.use('/cities', cities);
app.use('/movieGenres', movieGenres);
app.use("/search", searchRouter);
app.use("/api/auth", routerApiAuth);
app.use('/api/payments', paymentRouter);
app.use('/coupons', couponsRoutes);
app.use('/api/user/coupons', userCouponsRoutes);
app.use('/chatbot', chatbotRouter)
app.use('/api/auth/reset-password', routerApiAuth);
app.use("/api/avatars", avatarsRoutes);
app.use('/history', historyRouter);
app.use('/minigames', minigameRoutes);

// Booking Routes
app.use("/api/booking", bookingRouter);
app.use("/booking", bookingRouter);
// Test Route
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running on Clean Architecture! 🚀");
});

// API Routes
app.use("/api/cinemas", cinemaRoutes);

// ตรวจสอบ Request ที่หลุดไป 404
app.use((req, res, next) => {
  console.log(`[404 DEBUG] Not Found: ${req.method} ${req.originalUrl}`);
  next();
});

io.on("connection", (socket) => {
  socket.on("joinShowtime", async (showtimeId: string) => {
    socket.join(`showtime:${showtimeId}`);
    console.log(`✅ Socket ${socket.id} joined showtime:${showtimeId}`);

    // Send fresh seat state to the connecting client
    try {
      const result = await connectionPool.query(
        `
        SELECT 
          showtime_seats.id,
          seats.row_letter,
          seats.seat_number,
          showtime_seats.status,
          showtime_seats.selected_by,
          profiles.name AS booked_by_name,
          profiles.avatar_url AS booked_by_avatar
        FROM showtime_seats
        JOIN seats ON seats.id = showtime_seats.seat_id
        LEFT JOIN profiles ON profiles.id = showtime_seats.selected_by
        WHERE showtime_seats.showtime_id = $1
        ORDER BY seats.row_letter DESC, seats.seat_number ASC;
        `,
        [showtimeId],
      );

      const grouped: Record<string, any[]> = {};
      result.rows.forEach((seat) => {
        if (!grouped[seat.row_letter]) {
          grouped[seat.row_letter] = [];
        }
        grouped[seat.row_letter].push({
          id: seat.id,
          seat_number: seat.seat_number,
          status: seat.status,
          selected_by: seat.selected_by,
          booked_by_name: seat.booked_by_name || null,
          booked_by_avatar: seat.booked_by_avatar || null,
        });
      });

      const formatted = Object.keys(grouped)
        .sort()
        .reverse()
        .map((row) => ({
          row_letter: row,
          seats: grouped[row],
        }));

      socket.emit("seatSync", { seats: formatted });
    } catch (error) {
      console.error("❌ Failed to sync seats on join:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

startExpireSeatJob(io);
startMonthlyLeaderboardJob();

// Global Error Handler
app.use(errorHandler);

app.get("/ex", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running! 🚀");
});

// เริ่มต้น Server
server.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});

// ตรวจสอบ Error กรณี Port ซ้ำ
server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${port} is already in use! Please kill the process or use another port.`);
    process.exit(1);
  } else {
    console.error(`❌ Server Error:`, err);
  }
});

export default app; // สำคัญมาก! ต้อง export เพื่อให้ Vercel เอาไปใช้ต่อได้
