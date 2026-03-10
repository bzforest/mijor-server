import fs from "fs";
import { connectionPool } from "./utils/db.js"; // ปรับ path ให้ตรงกับไฟล์ db ของคุณ

async function updateSynopses() {
  try {
    console.log("กำลังเริ่มอ่านไฟล์และอัปเดตข้อมูล...");

    // 1. อ่านไฟล์ JSON ตัวใหม่ที่มีเรื่องย่อ
    const rawData = fs.readFileSync("./major-cineplex-with-synopsis.json", "utf-8");
    const movies = JSON.parse(rawData);

    let successCount = 0;

    // 2. วนลูปเพื่อทำการ UPDATE ทีละเรื่อง
    for (const movie of movies) {
      // ดึงชื่อหนังและเรื่องย่อออกมา
      const title = movie.display; 
      const synopsisText = movie.synopsis_th;

      // ถ้าเรื่องไหนขึ้นว่า "ยังไม่มีการเปิดเผยเนื้อหา..." หรือไม่มีค่า ให้ข้ามไปก่อน ไม่ต้องอัปเดต
      if (!synopsisText || synopsisText === "ยังไม่มีการเปิดเผยเนื้อหาของภาพยนตร์เรื่องนี้") {
        continue;
      }

      // 3. ยิงคำสั่ง SQL UPDATE เข้า Database
      // 🚨 แก้ไขคอลัมน์เป็น synopsis ตามโครงสร้างตารางจริงแล้วครับ!
      const result = await connectionPool.query(
        `UPDATE movies SET synopsis = $1 WHERE title = $2 RETURNING id`,
        [synopsisText, title]
      );

      // เช็กว่าอัปเดตสำเร็จไหม (เผื่อชื่อไม่ตรง)
      if (result.rowCount != null && result.rowCount > 0) {
        console.log(`✅ อัปเดตสำเร็จ: ${title}`);
        successCount++;
      }
    }

    console.log(`\n🎉 เสร็จสิ้น! อัปเดตเรื่องย่อสำเร็จทั้งหมด ${successCount} เรื่อง`);
    process.exit(0); // ปิดการทำงาน script

  } catch (error) {
    console.error("❌ เกิดข้อผิดพลาด:", error);
    process.exit(1);
  }
}

// สั่งรันฟังก์ชัน
updateSynopses();