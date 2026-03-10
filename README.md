## 🤖 Minor AI Assistant (Chatbot Feature)

ฟีเจอร์ผู้ช่วยอัจฉริยะสำหรับตอบคำถามและค้นหารอบฉายภาพยนตร์แบบ Real-time โดยใช้พลังของ Generative AI ร่วมกับ Function Calling เพื่อดึงข้อมูลจาก Database

### ✨ Features
- **Natural Language Understanding:** เข้าใจคำถามและโต้ตอบกับลูกค้าด้วยภาษาที่เป็นธรรมชาติ สุภาพ และเป็นมิตร
- **Real-time Showtimes (Function Calling):** เมื่อลูกค้าถามหารอบหนัง AI จะทำการเรียกฟังก์ชัน `get_movie_showtimes` เพื่อดึงข้อมูลจากฐานข้อมูล (PostgreSQL) แบบสดๆ
- **Cross-language Search:** รองรับการค้นหาข้ามภาษา (ลูกค้าพิมพ์ชื่อหนังภาษาไทย AI สามารถแปลงเป็นภาษาอังกฤษเพื่อไป Query ใน Database ได้อัตโนมัติ)
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
- \`POST /chatbot\`
  - **Body:** \`{ "message": "วันนี้มีหนังเรื่อง สัปเหร่อ ฉายไหม?" }\`
  - **Response:** \`{ "text": "ภาพยนตร์เรื่อง Sup Pa Ro มีรอบฉายดังนี้ครับ..." }\`