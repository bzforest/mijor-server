import express, { Request, Response } from "express";
import { GoogleGenerativeAI , FunctionDeclaration, SchemaType } from "@google/generative-ai";
import movie from "./movies";

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
                const movieName = args.movieName || "ทั้งหมด (ไม่ระบุชื่อ)";

                console.log(`[Function Call] AI กำลังขอข้อมูลรอบฉายของ: ${movieName}`);

                return res.status(200).json ({
                    text: `[ระบบกำลังเชื่อม Database] AI ต้องการรอบฉายของภาพยนต์เรื่อง: ${movieName}`
                })
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