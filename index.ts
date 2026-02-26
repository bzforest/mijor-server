import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
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
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
}

export default app;