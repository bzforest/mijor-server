import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectionPool } from './utils/db';

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

// Start Server (เฉพาะตอนรันในเครื่อง Local, บน Vercel มันจะจัดการเอง)
if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });
}

export default app; // สำคัญมาก! ต้อง export เพื่อให้ Vercel เอาไปใช้ต่อได้