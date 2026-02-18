import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(cors()); // อนุญาตทุกโดเมนไปก่อน (เดี๋ยวค่อยมาแก้ตอนเชื่อมกับ Frontend จริงจัง)
app.use(express.json());

// Test Route
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server is running! 🚀");
});

// Start Server (เฉพาะตอนรันในเครื่อง Local, บน Vercel มันจะจัดการเอง)
if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });
}

export default app; // สำคัญมาก! ต้อง export เพื่อให้ Vercel เอาไปใช้ต่อได้