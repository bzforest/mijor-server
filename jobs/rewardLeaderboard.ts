import cron from "node-cron";
import { connectionPool } from "../utils/db";
import { supabase } from "../utils/supabase";

export const startMonthlyLeaderboardJob = () => {
    // ทำงานทุกๆ วันที่ 1 ของเดือน เวลา 00:00 (เที่ยงคืน)
    cron.schedule("0 0 1 * *", async () => {
        console.log("🏆 [Cron Job] เริ่มต้นแจกรางวัล Leaderboard ประจำเดือน...");
        try {
            // 1. หา ID ของมินิเกม Popcorn Frenzy
            const { data: minigame } = await supabase
                .from("minigames")
                .select("id")
                .eq("slug", "popcorn")
                .single();

            if (!minigame) return;

            // 2. ดึง 3 อันดับแรกที่มีคะแนนสูงสุดของเดือนที่ผ่านมา
            const result = await connectionPool.query(
                `SELECT p.id as profile_id, MAX(ms.score) as score
                 FROM minigame_sessions ms
                 JOIN profiles p ON ms.profile_id = p.id
                 WHERE ms.minigame_id = $1 AND ms.score > 0
                 GROUP BY p.id
                 ORDER BY score DESC
                 LIMIT 3`,
                [minigame.id]
            );

            const topPlayers = result.rows;

            if (topPlayers.length === 0) {
                console.log("🏆 [Cron Job] ไม่มีผู้เล่นที่ได้คะแนนในเดือนที่ผ่านมา");
                return;
            }

            // คูปองโค้ดที่แอดมินสร้างไว้ (แจกตามอันดับ 1, 2, 3)
            const rewardCodes = [
                "LEADERBOARD_RANK1",
                "LEADERBOARD_RANK2",
                "LEADERBOARD_RANK3"
            ];

            // 3. แจกคูปองตามอันดับ
            for (let i = 0; i < topPlayers.length; i++) {
                const player = topPlayers[i];
                const code = rewardCodes[i];

                // หา ID ของคูปองจากฐานข้อมูล
                const couponResult = await connectionPool.query(
                    `SELECT id FROM coupons WHERE code = $1 LIMIT 1`,
                    [code]
                );

                if (couponResult.rows.length > 0) {
                    const couponId = couponResult.rows[0].id;

                    const expiresAt = new Date();
                    expiresAt.setDate(expiresAt.getDate() + 28); // คูปองมีอายุ 28 วัน

                    // แทรกคูปองลงกระเป๋าผู้เล่น
                    await supabase.from("profile_coupons").insert([
                        {
                            profile_id: player.profile_id,
                            coupon_id: couponId,
                            collected_at: new Date().toISOString(),
                            expires_at: expiresAt.toISOString(),
                            is_used: false
                        }
                    ]);
                    console.log(`🏆 [Cron Job] แจกคูปอง ${code} ให้กับ User ID: ${player.profile_id}`);
                }
            }

            // 4. ล้างคะแนนในกระดานเดิม (รีเซ็ต Leaderboard ประจำเดือน)
            await connectionPool.query(
                `DELETE FROM minigame_sessions WHERE minigame_id = $1`,
                [minigame.id]
            );

            console.log("🏆 [Cron Job] แจกรางวัลและรีเซ็ต Leaderboard ประจำเดือนนี้เรียบร้อยแล้ว!");

        } catch (error) {
            console.error("🏆 [Cron Job] เกิดข้อผิดพลาด:", error);
        }
    });
};
