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

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,
        total_price,
        status,
        created_at,
        booking_seats(
            showtime_seats(
            seats(
                row_letter,
                seat_number
            ),
            showtimes(
                start_time,
                movies(
                title,
                poster_url
                )
            )
            )
        )
        `)
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("History error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load booking history",
      });
    }

    const formatted = (data || []).map((b: any) => ({
      booking_id: b.id,
      total_price: b.total_price,
      status: b.status,
      created_at: b.created_at,

      title:
        b.booking_seats?.[0]?.showtime_seats?.showtimes?.movies?.title || "",

      poster_url:
        b.booking_seats?.[0]?.showtime_seats?.showtimes?.movies?.poster_url ||
        "",

      start_time:
        b.booking_seats?.[0]?.showtime_seats?.showtimes?.start_time || "",

      seats: (b.booking_seats || [])
        .map((s: any) => {
          const seat = s.showtime_seats?.seats;

          if (!seat) return null;

          return `${seat.row_letter}${seat.seat_number}`;
        })
        .filter(Boolean),
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
