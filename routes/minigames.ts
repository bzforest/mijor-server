import express, { Request, Response } from "express";
import { supabase } from "../utils/supabase";
import { connectionPool } from "../utils/db";
import { requireAuth } from "../middlewares/auth.middleware";

const minigameRoutes = express.Router();

/* ================= GET /minigames/popcorn/leaderboard ================= */
// Get top 10 scores (PUBLIC)
minigameRoutes.get("/popcorn/leaderboard", async (req: Request, res: Response) => {
    try {
        // Find minigame id
        const { data: minigame } = await supabase
            .from("minigames")
            .select("id")
            .eq("slug", "popcorn")
            .single();

        if (!minigame) return res.status(404).json({ message: "Minigame not found" });

        // Get Top 10 scores with user data
        const result = await connectionPool.query(
            `SELECT p.id as profile_id, p.name, p.avatar_url, MAX(ms.score) as score
             FROM minigame_sessions ms
             JOIN profiles p ON ms.profile_id = p.id
             WHERE ms.minigame_id = $1 AND ms.score > 0
             GROUP BY p.id, p.name, p.avatar_url
             ORDER BY score DESC
             LIMIT 10`,
            [minigame.id]
        );

        return res.status(200).json({
            success: true,
            leaderboard: result.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching leaderboard" });
    }
});

// Private Routes below
minigameRoutes.use(requireAuth);

/* ================= GET /minigames/trivia/status ================= */
// Check if user has played trivia this month
minigameRoutes.get("/trivia/status", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;

        const { data: minigame } = await supabase
            .from("minigames")
            .select("id")
            .eq("slug", "trivia")
            .single();

        if (!minigame) return res.status(404).json({ message: "Minigame not found" });

        // Calculate 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: session } = await supabase
            .from("minigame_sessions")
            .select("created_at")
            .eq("profile_id", user.id)
            .eq("minigame_id", minigame.id)
            .gte("created_at", thirtyDaysAgo.toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (session) {
            const nextPlayDate = new Date(session.created_at);
            nextPlayDate.setDate(nextPlayDate.getDate() + 30);
            return res.status(200).json({ canPlay: false, nextPlayDate });
        }

        return res.status(200).json({ canPlay: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error checking status" });
    }
});

/* ================= GET /minigames/trivia/questions ================= */
// Get a random question for the selected difficulty
minigameRoutes.get("/trivia/questions", async (req: Request, res: Response) => {
    try {
        const { difficulty } = req.query;
        if (!difficulty) return res.status(400).json({ message: "Difficulty required" });

        // Using pg directly for ORDER BY RANDOM() since Supabase JS client doesn't support random natively well without RPC
        const result = await connectionPool.query(
            `SELECT id, question, option_a, option_b, option_c, option_d 
       FROM trivia_questions 
       WHERE difficulty = $1 
       ORDER BY RANDOM() LIMIT 1`,
            [difficulty]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "No questions found for this difficulty" });
        }

        const q = result.rows[0];

        // We send options un-shuffled; frontend will shuffle them so we don't accidentally lose track of a/b/c/d mapping
        const options = [q.option_a, q.option_b, q.option_c, q.option_d];

        return res.status(200).json({
            id: q.id,
            question: q.question,
            options
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error getting question" });
    }
});

/* ================= POST /minigames/trivia/submit ================= */
// Submit answer and claim reward
minigameRoutes.post("/trivia/submit", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { questionId, answer, difficulty } = req.body;

        if (!questionId || !answer || !difficulty) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const { data: minigame } = await supabase
            .from("minigames")
            .select("id")
            .eq("slug", "trivia")
            .single();

        if (!minigame) return res.status(404).json({ message: "Minigame not found" });

        // Double check 30 days rule to prevent race conditions
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { data: session } = await supabase
            .from("minigame_sessions")
            .select("id")
            .eq("profile_id", user.id)
            .eq("minigame_id", minigame.id)
            .gte("created_at", thirtyDaysAgo.toISOString())
            .single();

        if (session) {
            return res.status(403).json({ message: "You have already played this month" });
        }

        // Verify answer
        const qResult = await connectionPool.query(
            `SELECT correct_answer FROM trivia_questions WHERE id = $1`,
            [questionId]
        );

        if (qResult.rows.length === 0) {
            return res.status(404).json({ message: "Question not found" });
        }

        const correctAnswer = qResult.rows[0].correct_answer;
        const isCorrect = answer === correctAnswer;

        // Log to minigame_sessions
        await supabase.from("minigame_sessions").insert([
            { profile_id: user.id, minigame_id: minigame.id, score: isCorrect ? 10 : 0 }
        ]);

        if (isCorrect) {
            // Award coupon based on difficulty
            let expectedDiscount = 5;
            if (difficulty === "medium") expectedDiscount = 10;
            if (difficulty === "hard") expectedDiscount = 15; // the DB has 15% too!
            if (difficulty === "expert") expectedDiscount = 20;

            // Find the coupon ID
            const cResult = await connectionPool.query(
                `SELECT id, title FROM coupons WHERE discount_value = $1 AND discount_type = 'discount_percentage' LIMIT 1`,
                [expectedDiscount]
            );

            if (cResult.rows.length > 0) {
                const coupon = cResult.rows[0];

                // Check if user already owns this coupon to avoid Unique Constraint 500 Error
                const existingResult = await connectionPool.query(
                    `SELECT id FROM profile_coupons WHERE profile_id = $1 AND coupon_id = $2 LIMIT 1`,
                    [user.id, coupon.id]
                );

                if (existingResult.rows.length > 0) {
                    return res.status(200).json({
                        success: true,
                        message: "Correct answer! But you already own this coupon tier.",
                        reward: coupon.title + " (Already Owned)"
                    });
                } else {
                    // Insert to profile_coupons
                    const expiresAt = new Date();
                    expiresAt.setDate(expiresAt.getDate() + 7); // Minigame coupons valid for 7 days

                    await supabase.from("profile_coupons").insert([
                        { profile_id: user.id, coupon_id: coupon.id, collected_at: new Date().toISOString(), expires_at: expiresAt.toISOString(), is_used: false }
                    ]);

                    return res.status(200).json({
                        success: true,
                        message: "Correct! Coupon granted.",
                        reward: coupon.title
                    });
                }
                return res.status(200).json({
                    success: true,
                    message: "Correct answer, but no active coupon found for this reward tier.",
                });
            }
        } else {
            return res.status(200).json({
                success: false,
                message: "Incorrect answer."
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error submitting answer" });
    }
});

/* ================= GET /minigames/wheel/status ================= */
// Get the number of available wheel spins for the user
minigameRoutes.get("/wheel/status", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;

        const result = await connectionPool.query(
            `SELECT SUM(credits) as available_spins 
             FROM wheel_spin_credits 
             WHERE profile_id = $1 AND used = false`,
            [user.id]
        );

        const availableSpins = result.rows[0].available_spins ? parseInt(result.rows[0].available_spins) : 0;

        return res.status(200).json({ availableSpins });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error getting wheel status" });
    }
});

/* ================= POST /minigames/wheel/spin ================= */
// Spin the wheel, consume 1 credit, and grant a reward
minigameRoutes.post("/wheel/spin", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;

        const result = await connectionPool.query(
            `SELECT id 
             FROM wheel_spin_credits 
             WHERE profile_id = $1 AND used = false AND credits > 0
             LIMIT 1`,
            [user.id]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ message: "No wheel spins available" });
        }

        const creditRecordId = result.rows[0].id;

        await connectionPool.query('BEGIN');

        const decrementResult = await connectionPool.query(
            `UPDATE wheel_spin_credits 
             SET credits = credits - 1, 
                 used = CASE WHEN credits - 1 <= 0 THEN true ELSE false END 
             WHERE id = $1 AND credits > 0
             RETURNING id`,
            [creditRecordId]
        );

        if (decrementResult.rowCount === 0) {
            await connectionPool.query('ROLLBACK');
            return res.status(403).json({ message: "Failed to consume credit. " });
        }

        // Determine reward probabilities:
        // MISS: 30%, 5%: 30%, 10%: 15%, 15%: 10%, FREE: 10%, 20%: 4%, 50%: 1%
        const rand = Math.random() * 100;
        let expectedDiscount: number | 'free' | 'miss' = 'miss';
        if (rand < 30) expectedDiscount = 'miss';
        else if (rand < 60) expectedDiscount = 5;
        else if (rand < 75) expectedDiscount = 10;
        else if (rand < 85) expectedDiscount = 15;
        else if (rand < 95) expectedDiscount = 'free';
        else if (rand < 99) expectedDiscount = 20;
        else expectedDiscount = 50;

        let rewardTitle = "Better luck next time!";

        if (expectedDiscount === 'free') {
            rewardTitle = "Free Spin!";
            // Refund the consumed credit
            await connectionPool.query(
                `UPDATE wheel_spin_credits SET credits = credits + 1, used = false WHERE id = $1`,
                [creditRecordId]
            );
        } else if (expectedDiscount !== 'miss') {
            const cResult = await connectionPool.query(
                `SELECT id, title FROM coupons WHERE discount_value = $1 AND discount_type = 'discount_percentage' LIMIT 1`,
                [expectedDiscount]
            );

            if (cResult.rows.length > 0) {
                const coupon = cResult.rows[0];

                // Check if user already owns this coupon to avoid Unique Constraint 500 Error
                const existingResult = await connectionPool.query(
                    `SELECT id FROM profile_coupons WHERE profile_id = $1 AND coupon_id = $2 LIMIT 1`,
                    [user.id, coupon.id]
                );

                if (existingResult.rows.length > 0) {
                    // They already have it! Refund the spin instead.
                    rewardTitle = "Free Spin! (Duplicate)";
                    expectedDiscount = 'free';
                    await connectionPool.query(
                        `UPDATE wheel_spin_credits SET credits = credits + 1, used = false WHERE id = $1`,
                        [creditRecordId]
                    );
                } else {
                    rewardTitle = coupon.title;
                    const expiresAt = new Date();
                    expiresAt.setDate(expiresAt.getDate() + 7); // Minigame coupons valid for 7 days

                    await connectionPool.query(
                        `INSERT INTO profile_coupons (profile_id, coupon_id, collected_at, expires_at, is_used) VALUES ($1, $2, $3, $4, false)`,
                        [user.id, coupon.id, new Date().toISOString(), expiresAt.toISOString()]
                    );
                }
            }
        }

        const { data: minigame } = await supabase
            .from("minigames")
            .select("id")
            .eq("slug", "wheel")
            .single();

        if (minigame) {
            await supabase.from("minigame_sessions").insert([
                { profile_id: user.id, minigame_id: minigame.id, score: typeof expectedDiscount === 'number' ? expectedDiscount : 0 }
            ]);
        }

        const spinsResult = await connectionPool.query(
            `SELECT SUM(credits) as available_spins 
             FROM wheel_spin_credits 
             WHERE profile_id = $1 AND used = false`,
            [user.id]
        );
        const remainingSpins = spinsResult.rows[0].available_spins ? parseInt(spinsResult.rows[0].available_spins) : 0;

        await connectionPool.query('COMMIT');

        return res.status(200).json({
            success: true,
            reward: rewardTitle,
            discount: expectedDiscount,
            remainingSpins: remainingSpins
        });

    } catch (err) {
        await connectionPool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: "Error spinning wheel" });
    }
});

/* ================= POST /minigames/popcorn/submit ================= */
// Submit score for Popcorn Frenzy
minigameRoutes.post("/popcorn/submit", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { score } = req.body;

        if (typeof score !== 'number' || score < 0) {
            return res.status(400).json({ message: "Invalid score" });
        }

        // Anti-cheat: 30 seconds game
        if (score > 300) {
            return res.status(400).json({ message: "Score suspiciously high. Rejected." });
        }

        const { data: minigame } = await supabase
            .from("minigames")
            .select("id")
            .eq("slug", "popcorn")
            .single();

        if (!minigame) return res.status(404).json({ message: "Minigame not found" });

        // Record the score
        await supabase.from("minigame_sessions").insert([
            { profile_id: user.id, minigame_id: minigame.id, score }
        ]);

        return res.status(200).json({
            success: true,
            message: "Score submitted successfully!"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error submitting score" });
    }
});

export default minigameRoutes;
