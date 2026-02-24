import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectionPool } from './utils/db';
import { supabase } from './utils/supabase';

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

// ==========================================
// เส้น API สำหรับ Register
// ==========================================
app.post("/api/auth/register", async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password, name } = req.body;

    // 1. สั่งให้ Supabase จัดการสมัครสมาชิกในระบบ Auth
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { name: name }, // 👈 จุดที่ 1: แก้เป็น name ให้ตรงกัน (ใช้แบบย่อว่า { name } ก็ได้)
      },
    });

    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    // 2. นำข้อมูลไปบันทึกลงตาราง public.profiles
    if (data.user) {
      const { error: profileError } = await supabase
        .from("profiles")
        .insert([
          {
            id: data.user.id, 
            email: email,
            name: name, // 👈 จุดที่ 2: สำคัญสุด! ต้องแก้ตรงนี้ให้ตรงกับชื่อคอลัมน์ในฐานข้อมูล
          }
        ]);

      if (profileError) {
        console.error("❌ บันทึก Profile ไม่สำเร็จ:", profileError);
      }
    }

    // 3. ถ้าผ่านฉลุย ส่งแจ้งเตือนกลับไปหาหน้าเว็บ
    return res.status(200).json({
      success: true,
      message: "Registration successful",
      user: data.user
    });

  } catch (err: any) {
    console.error("Register Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ==========================================
// เส้น API สำหรับ Login
// ==========================================
app.post("/api/auth/login", async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      const message = error.message === "Invalid login credentials" 
        ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" 
        : error.message;
      return res.status(401).json({ success: false, message: message });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      session: data.session,
      user: data.user
    });

  } catch (err: any) {
    console.error("Login Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Start Server (เฉพาะตอนรันในเครื่อง Local, บน Vercel มันจะจัดการเอง)
if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });
}

export default app; // สำคัญมาก! ต้อง export เพื่อให้ Vercel เอาไปใช้ต่อได้