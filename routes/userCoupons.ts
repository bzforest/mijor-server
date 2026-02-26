import express, { Request, Response } from "express";
import { supabase } from "../utils/supabase";
import { requireAuth } from "../middlewares/auth.middleware";

const userCouponsRoutes = express.Router();

userCouponsRoutes.use(requireAuth);

/* ================= POST /api/user/coupons ================= */

userCouponsRoutes.post("/", async (req: Request, res: Response) => {
  try {
    const { couponId } = req.body;
    const user = (req as any).user;

    // ===== Existence Check =====
    const { data: existing } = await supabase
      .from("profile_coupons")
      .select("*")
      .eq("profile_id", user.id)
      .eq("coupon_id", couponId)
      .single();

    if (existing) {
      return res.status(400).json({ message: "Coupon already saved" });
    }

    // ===== Database Insertion =====
    const { error: insertError } = await supabase
      .from("profile_coupons")
      .insert([{ 
        profile_id: user.id, 
        coupon_id: couponId, 
        collected_at: new Date().toISOString() 
      }]);

    if (insertError) {
      return res.status(500).json({ message: "Failed to save coupon" });
    }

    res.status(200).json({ success: true, message: "Coupon saved successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
});

/* ================= GET /api/user/coupons ================= */
// Responsibility: Retrieve all coupons collected by the user
// Returns: Coupon details with relationship data

userCouponsRoutes.get("/", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    // ===== Data Fetching =====
    // Retrieve user's coupons with related coupon details
    const { data: coupons, error: fetchError } = await supabase
      .from("profile_coupons")
      .select(`
        *,
        coupons (
          id,
          title,
          brand,
          image_url,
          valid_until,
          description
        )
      `)
      .eq('profile_id', user.id);

    if (fetchError) {
      return res.status(500).json({ message: "Failed to fetch coupons" });
    }

    res.status(200).json({ 
      success: true,
      data: coupons,
      count: coupons.length
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
});

export default userCouponsRoutes;