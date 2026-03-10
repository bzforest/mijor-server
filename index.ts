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
import cinemaRoutes from "./routes/cinemaRoutes";
import { errorHandler } from "./middlewares/errorHandler";
import avatarsRoutes from "./routes/avatars";
import chatbotRouter from "./routes/chatbot";
import bookingRouter from "./routes/booking";
import { startExpireSeatJob } from "./jobs/expireSeats";
import { Server } from "socket.io";
import http from "http";

// Webhook Routes
import webhookRouter from "./routes/webhook";
import paymentRouter from "./routes/payment";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 4000;

const server = http.createServer(app);

// Socket.io
export const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

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
app.use('/coupons', couponsRoutes);
app.use('/api/user/coupons', userCouponsRoutes);
app.use('/chatbot', chatbotRouter)
app.use('/api/auth/reset-password', routerApiAuth);
app.use("/api/avatars", avatarsRoutes);

// ตรวจสอบ Request ที่หลุดไป 404
app.use((req, res, next) => {
  console.log(`[404 DEBUG] Not Found: ${req.method} ${req.originalUrl}`);
  next();
});


// Payment Routes
app.use('/api/payments', paymentRouter);


// Payment Routes
app.use('/api/payments', paymentRouter);

// Test Route
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running on Clean Architecture! 🚀");
});

// API Routes
app.use("/api/cinemas", cinemaRoutes);

// Booking Routes
app.use("/booking", bookingRouter);

io.on("connection", (socket) => {
  socket.on("joinShowtime", (showtimeId: string) => {
    socket.join(`showtime:${showtimeId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

startExpireSeatJob(io);

// Global Error Handler
app.use(errorHandler);

app.get("/ex", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running! 🚀");
});

if (process.env.NODE_ENV !== "production") {
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
}

export default app; // สำคัญมาก! ต้อง export เพื่อให้ Vercel เอาไปใช้ต่อได้
