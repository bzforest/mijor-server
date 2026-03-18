import { Request, Response, Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { supabase } from "../utils/supabase";

const historyRouter = Router();

// =========================================
// GET /history — Booking History
// =========================================

historyRouter.get("/", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { count } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", user.id);

    const { data, error } = await supabase.rpc("get_booking_history", {
      user_id_input: user.id,
      limit_input: limit,
      offset_input: from
    });

    if (error) {
      console.error("History error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load booking history",
      });
    }

    const formatted = (data || []).map((b: any) => ({
  booking_id: b.booking_id,
  title: b.title,
  poster_url: b.poster_url,
  start_time: b.start_time,
  subtotal: b.subtotal,
  discount: b.discount,
  total_price: b.total_price,
  status: b.status,
  is_cancellable: b.is_cancellable ?? false,
  created_at: b.created_at,
  seats: b.seats || [],
  ticket_count: b.seats?.length || 0,
}));

    return res.json({
      success: true,
      data: formatted,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err) {
    console.error("History server error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default historyRouter;
