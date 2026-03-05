import express, { Request, Response } from "express";
import { GoogleGenerativeAI , FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { connectionPool } from "../utils/db";

const chatbotRouter = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// function หารอบหนัง
const getMovieShowtimesDeclaration: FunctionDeclaration = {
    name: "get_movie_showtimes",
    description: "ใช้ดึงข้อมูลรายชื่อภาพยนต์ที่กำลังฉาย และรอบฉายของโรงภาพยนต์ Minor Cineplex",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            // สำหรับลูกค้า ที่เจาะจงชื่อหนัง
            movieName: {
                type: SchemaType.STRING,
                description: "ชื่อภาพยนต์ที่ลูกค้าต้องการรอบฉาย (ถ้าไม่ได้ระบุ จะถูกส่งเป็นค่าว่าง)"
            },
        },
        required: ["movieName"]
    },
};

chatbotRouter.post("/" , async (req: Request , res: Response): Promise<any> => {
    try {
    
        const {message } = req.body;

        if (!message) {
            return res.status(400).json ({ error: "กรุณาส่งข้อความมาด้วยครับ" });
        }

        const model = genAI.getGenerativeModel ({
            model: "gemini-2.5-flash",
            tools: [
                {
                    functionDeclarations: [getMovieShowtimesDeclaration],
                },
            ],
        });

        const prompt = `
        คุณคือ " Minor AI Assistant " พนักงานบริการลูกค้าสุดอัจฉริยะของโรงภาพยนต์ Minor Cineplex
        กฏการตอบ:
        1. ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง และลงท้ายด้วย "ครับ" เสมอ
        2. ตอบให้สั้น กระชับ ไม่เยิ่นเย้อ

        คำถามจากลูกค้า: "${message}"
        `;

        // ส่งคำถามไปให้ gemini
        const result = await model.generateContent(prompt);
        const aiResponseData = result.response;

        const functionCalls = aiResponseData.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];

            //  ถ้า AI เรียกหาฟังก์ชัน "หารอบหนัง"
            if (call.name === "get_movie_showtimes") {
                const args = call.args as {movieName?: string};
                const movieName = args.movieName || "";

                console.log(`[Function Call] AI กำลังขอข้อมูลรอบฉายของ: ${movieName || 'ทั้งหมด'}`);

                try {
                    // SQL ดึงข้อมูลจากทั้ง 4 ตารางเชื่อมกัน
                    let sql = `
                        SELECT c.name AS cinema, m.title AS movie, s.start_time 
                        FROM showtimes s
                        JOIN movies m ON s.movie_id = m.id 
                        JOIN halls h ON s.hall_id = h.id
                        JOIN cinemas c ON h.cinema_id = c.id 
                        WHERE s.start_time >= NOW()
                    `;
                    const values: any[] = [];

                    // ถ้าหากลูกค้าระบุชื่อหนังมา
                    if (movieName) {
                        sql += ` AND m.title ILIKE $1`;
                        values.push(`%${movieName}%`);
                    }

                    // เรียงตามเวลาฉาย และจำกัดแค่ 10 รอบ เพื่อไม่ให้ AI อ่านข้อมูลเยอะจนเกินไป
                    sql += ` ORDER BY s.start_time ASC LIMIT 10 `;

                    const dbResult = await connectionPool.query(sql , values);
                    const showtimesData = dbResult.rows;

                    console.log("ได้ข้อมูลจาก Database แล้วจำนวน:", showtimesData.length, "รอบ");

                    // ส่งกลับไปให้ AI สุรปคำพูด
                    const finalResult = await model.generateContent ({
                        contents: [
                            { role: "user", parts: [{ text: prompt}] },
                            { role: "model", parts: functionCalls.map((c: any) => ({ functionCall: c})) },
                            {
                                role: "function",
                                parts: [{
                                    functionResponse: {
                                        name: "get_movie_showtimes",
                                        response: {
                                             // ถ้าไม่มีรอบฉาย ส่งข้อมูลว่างไปบอก AI เดี๋ยว AI จะบอกลูกค้าเองว่า "ไม่มีรอบฉาย"
                                            showtimes: showtimesData.length > 0 ? showtimesData : "ไม่พบรอบฉายในขณะนี้"
                                        }
                                    }
                                }]
                            }
                        ]
                    });

                    // เอาคำตอบสุดท้ายที่ AI เรียบเรียงแล้ว ส่งให้หน้าเว็บ
                    const finalAiText = finalResult.response.text();
                    return res.status(200).json({ text: finalAiText });

                } catch (dbError) {
                    console.error("DB Query Error:", dbError);
                    return res.status(500).json({
                        error: "ระบบฐานข้อมูลขัดข้องชั่วคราวครับ"
                    });
                }
            }
        }
        //  ถ้าไม่มีการเรียกใช้ function หารอบหนัง แปลว่าเป็นแชทปกติ
        const aiResponseText = aiResponseData.text();

        // ส่งคำตอบไปให้หน้าเว็บ
        return res.status(200).json({ text: aiResponseText });

    } catch (error: any) {
        console.error("Gemini API Error" , error);
        return res.status(500).json({ error: "ขออภัยครับ ระบบ AI ขัดข้องชั่วคราว"})
    }
})

export default chatbotRouter