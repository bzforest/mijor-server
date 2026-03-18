## 🤖 Minor AI Assistant (Chatbot Feature)

ฟีเจอร์ผู้ช่วยอัจฉริยะสำหรับตอบคำถามและค้นหารอบฉายภาพยนตร์แบบ Real-time โดยใช้พลังของ Generative AI ร่วมกับ Function Calling เพื่อดึงข้อมูลจาก Database

### ✨ Features
- **Natural Language Understanding:** เข้าใจคำถามและโต้ตอบกับลูกค้าด้วยภาษาที่เป็นธรรมชาติ สุภาพ และเป็นมิตร
- **Context-Aware Memory (ระบบจดจำบริบท):** AI สามารถจดจำประวัติการสนทนาได้ ทำให้ถามคำถามต่อเนื่องได้ไหลลื่น (เช่น "วันนี้มีเรื่องอะไร" -> "แล้วพรุ่งนี้ล่ะ?") พร้อมระบบ `sessionStorage` ฝั่ง Client ที่ทำให้แชทไม่หายแม้จะเปลี่ยนหน้าเว็บ
- **Real-time Showtimes & Date Filtering:** ดึงข้อมูลรอบฉายจากฐานข้อมูลแบบสดๆ พร้อมความสามารถในการคำนวณวันและเวลาจากภาษาพูด (เช่น "พรุ่งนี้", "เสาร์อาทิตย์นี้")
- **Genre Recommendations:** แนะนำภาพยนตร์ตามหมวดหมู่หรือความรู้สึกที่ลูกค้าต้องการได้ (เช่น "อยากดูหนังผี", "มีหนังตลกเข้าโรงไหม")
- **Price & Seat Availability:** ค้นหาราคาตั๋วเริ่มต้นและเช็กจำนวนที่นั่งว่างของแต่ละรอบฉายได้แบบ Real-time
- **Actionable Booking Links:** AI สามารถสร้างลิงก์ให้ลูกค้าคลิกวาร์ปไปหน้าจองตั๋ว (Booking) ของรอบนั้นๆ ได้ทันทีจากในช่องแชท
- **Cross-language Search:** รองรับการค้นหาข้ามภาษา (ลูกค้าพิมพ์ชื่อหนัง/สาขาภาษาไทย AI สามารถแปลงเป็นภาษาอังกฤษเพื่อไป Query ใน Database ได้อัตโนมัติ)
- **Guardrails Protection:** มีระบบป้องกัน (Prompt Engineering) ไม่ให้ AI ตอบคำถามนอกเรื่องที่ไม่เกี่ยวกับโรงภาพยนตร์
- **Dynamic UI Mascot:** ฝั่ง Frontend มีระบบเปลี่ยนหน้าตา Mascot ตามสถานะการทำงาน (Idle, Loading, Error)

### 🛠️ Tech Stack (Chatbot)
- **AI Model:** Google Gemini 2.5 Flash (`@google/generative-ai`)
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL (Supabase)

### ⚙️ Environment Variables (.env)
อย่าลืมเพิ่มค่าเหล่านี้ในไฟล์ `.env` ด้วยนะ:

**ฝั่ง Backend (`mijor-server`):**
\`\`\`env
GEMINI_API_KEY=ใส่_API_KEY_ของ_Google_Gemini_ที่นี่
\`\`\`

**ฝั่ง Frontend (`mijor-client`):**
\`\`\`env
NEXT_PUBLIC_API_URL=http://localhost:4000
\`\`\`

### 🚀 API Endpoint
- POST /chatbot

- Body: ```json
{
"message": "แล้วรอบดึกสุดราคาเท่าไหร่ มีที่นั่งเหลือไหม?",
"history": [
{ "role": "user", "text": "วันนี้อยากดู สรรพลี้หวน สาขาพระราม 3" },
{ "role": "bot", "text": "มีรอบฉาย 22:00 น. ครับ..." }
]
}

- Response: ```json
{
"text": "Sap Pa Lee Huan\n- สาขา: Minor Cineplex Rama 3\n- เวลา: 22:00 (ราคาเริ่มต้น 220 บาท | ว่าง 100 ที่นั่ง)\n👉 คลิกเพื่อจองตั๋วรอบนี้"
}