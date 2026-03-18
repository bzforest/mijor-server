import express, { Request, Response } from "express";
import { GoogleGenerativeAI , FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { connectionPool } from "../utils/db";

const chatbotRouter = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const today = new Date().toISOString().split('T')[0];

// function หารอบหนัง
const getMovieShowtimesDeclaration: FunctionDeclaration = {
    name: "get_movie_showtimes",
    description: "ใช้ดึงข้อมูลรายชื่อภาพยนตร์ที่กำลังฉาย รอบฉาย ราคาตั๋วเริ่มต้น และจำนวนที่นั่งว่างของโรงภาพยนตร์ Minor Cineplex",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            // สำหรับลูกค้า ที่เจาะจงชื่อหนัง
            movieName: {
                type: SchemaType.STRING,
                description: "ชื่อภาพยนตร์ที่ลูกค้าเจาะจงต้องการดู (หากพิมพ์ไทยให้ทับศัพท์เป็นอังกฤษ เช่น 'สัปเหร่อ' -> 'Sup Pa Ro', 'สรรพลี้หวน' -> 'Sap Pa Lee Huan', 'เจาะเวลาหาจิ๋นซี' -> 'Back to the Past') **[สำคัญมาก] หากลูกค้าไม่ได้เจาะจงชื่อหนัง (เช่น ถามว่าสาขานี้มีอะไรฉายบ้าง) บังคับให้ส่งเป็น string ว่าง ('') เสมอ ห้ามส่งคำว่า 'อะไร', 'หนัง', หรือ 'รอบหนัง' มาเด็ดขาด**"
            },

            cinemaName: {
                type: SchemaType.STRING,
                description: "ชื่อสาขาของโรงภาพยนตร์ที่ต้องการค้นหา **[สำคัญมาก] หากลูกค้าพิมพ์ภาษาไทย ให้แปลหรือทับศัพท์เป็นอังกฤษก่อนเสมอ เช่น 'เชียงใหม่' -> 'Chiangmai', 'ลาดพร้าว' -> 'Ladprao', 'พระราม' -> 'Rama'** ถ้าไม่ได้ระบุ ให้ส่งเป็น string ว่าง ('')"
            },

            targetDate: {
                type: SchemaType.STRING,
                description: `วันที่ลูกค้าต้องการค้นหารอบฉาย (รูปแบบ YYYY-MM-DD) เช่น ถ้าลูกค้าถามหา 'พรุ่งนี้' ให้บวกวันเพิ่มจาก ${today} เป็นต้นไป ถ้าลูกค้าไม่ได้ระบุวัน ให้ส่งเป็น string ว่าง ('')`
            },

            genre: {
                type: SchemaType.STRING,
                description: "หมวดหมู่หรือประเภทของภาพยนตร์ที่ลูกค้าต้องการดู เช่น 'Action', 'Horror', 'Comedy', 'Drama', 'Sci-Fi', 'Animation' **[สำคัญ] หากลูกค้าพิมพ์ภาษาไทย ให้แปลเป็นหมวดหมู่ภาษาอังกฤษที่สอดคล้องกัน เช่น 'ผี/น่ากลัว' -> 'Horror', 'ตลก' -> 'Comedy', 'บู๊' -> 'Action'** ถ้าไม่ได้ระบุ ให้ส่งเป็น string ว่าง ('')"
            }

        },
        required: ["movieName" , "cinemaName" , "targetDate" , "genre"]
    },
};

chatbotRouter.post("/" , async (req: Request , res: Response): Promise<any> => {
    try {
    
        const { message, history = [] } = req.body;

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

        const historyText = history
            .map((msg: any) => `${msg.role === 'user' ? 'ลูกค้า' : 'AI'}: ${msg.text}`)
            .join('\n');
        

        const prompt = `
        คุณคือ "Minor AI Assistant" พนักงานบริการลูกค้าสุดอัจฉริยะของโรงภาพยนตร์ Minor Cineplex
        วันนี้คือวันที่: ${today}
        
        กฏการตอบ (ต้องปฏิบัติตามอย่างเคร่งครัด):
        1. ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง และลงท้ายด้วย "ครับ" เสมอ
        2. ตอบให้สั้น กระชับ ไม่เยิ่นเย้อ
        3. [สำคัญมาก] หน้าที่ของคุณคือตอบคำถามที่เกี่ยวกับ "ภาพยนตร์, โรงภาพยนตร์, ตารางรอบฉาย, และบริการของ Minor Cineplex" เท่านั้น!
        4. [Guardrails] หากลูกค้าถามเรื่องอื่นที่ "ไม่เกี่ยวข้องกันเลย" ให้ตอบปฏิเสธอย่างสุภาพ แล้วดึงกลับมาเรื่องหนัง เช่น "ขออภัยครับ ผมเป็นผู้ช่วยด้านภาพยนตร์ ตอบได้เฉพาะเรื่องที่เกี่ยวกับ Minor Cineplex เท่านั้นครับ วันนี้มีหนังเรื่องไหนที่คุณลูกค้าสนใจเป็นพิเศษไหมครับ?" 
        5. ห้ามให้ข้อมูล นอกเหนือจากบริบทของโรงภาพยนตร์เด็ดขาด!
        6. [การจัดรูปแบบ] สำคัญมาก: หากมีการแจ้ง "รอบฉายภาพยนตร์" ห้ามพิมพ์ติดกันเป็นพรืด บังคับให้จัดรูปแบบตามโครงสร้างนี้เท่านั้น:
        
        **[ชื่อภาพยนตร์]**
        - สาขา: [ชื่อสาขา]
        - เวลา: [รอบฉาย] (ราคาเริ่มต้น [ราคา] บาท | ว่าง [จำนวน] ที่นั่ง)
        <เว้น 1 บรรทัดเสมอ>
        **[ชื่อภาพยนตร์เรื่องถัดไป]**
        
        *หมายเหตุ: หากลูกค้าถามแค่ราคา ให้ตอบแค่ราคา ไม่ต้องบอกจำนวนที่นั่งว่างก็ได้ ให้ปรับตามบริบทของคำถาม

        ---
        ประวัติการสนทนาที่ผ่านมา (ใช้อ้างอิงบริบทเท่านั้น):
        ${historyText}
        ---
        
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
                const args = call.args as {movieName?: string, cinemaName?: string, targetDate?: string, genre?: string};
                const movieName = args.movieName || "";
                const cinemaName = args.cinemaName || "";
                const targetDate = args.targetDate || "";
                const genre = args.genre || "";

                console.log(`[Function Call] AI กำลังขอข้อมูลรอบฉายของ: ${movieName || 'ทั้งหมด'}`);

                try {
                    // SQL ดึงข้อมูลจากทั้ง 4 ตารางเชื่อมกัน
                    let sql = `
                    SELECT 
                        c.name AS cinema, 
                        m.title AS movie, 
                        s.start_time,
                        s.base_price,
                        (
                            SELECT COUNT(*) 
                            FROM showtime_seats ss 
                            WHERE ss.showtime_id = s.id AND ss.status = 'available'
                        ) AS available_seats
                    FROM showtimes s
                    JOIN movies m ON s.movie_id = m.id 
                    JOIN halls h ON s.hall_id = h.id 
                    JOIN cinemas c ON h.cinema_id = c.id 
                    WHERE 1=1
                     `;
                    
                    const values: any[] = [];

                    // ถ้าหากลูกค้าระบุชื่อหนังมา
                    if (movieName) {
                        sql += ` AND m.title ILIKE $1`;
                        values.push(`%${movieName}%`);
                    }

                    // ถ้าหากลูกค้าระบุชื่อโรงหนังมา
                    if (cinemaName) {
                        values.push(`%${cinemaName}%`);
                        sql += ` AND c.name ILIKE $${values.length}`;
                    }

                    if (genre) {
                        values.push(`%${genre}%`);
                        // ใช้ Sub-query วิ่งไปเช็กในตาราง genres ว่าหนังเรื่องนี้ตรงกับหมวดหมู่ที่หาไหม
                        sql += ` AND m.id IN (
                            SELECT mg.movie_id 
                            FROM movie_genres mg 
                            JOIN genres g ON mg.genre_id = g.id 
                            WHERE g.name ILIKE $${values.length}
                        )`;
                    }

                    if (targetDate) {
                        // ถ้ามี targetDate เราต้องเช็กค่าของมัน ไม่ใช่แค่ push อย่างเดียว
                        values.push(targetDate);
                        sql += ` AND DATE(s.start_time) = $${values.length}`;
                    } else {
                        sql += ` AND s.start_time >= NOW()`;
                    }

                    // เรียงตามเวลาฉาย และจำกัดแค่ 10 รอบ เพื่อไม่ให้ AI อ่านข้อมูลเยอะจนเกินไป
                    sql += ` ORDER BY s.start_time ASC LIMIT 15 `;

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