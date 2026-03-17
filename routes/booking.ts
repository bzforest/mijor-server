import { Router, Request, Response } from "express";
import crypto from "crypto";
import { connectionPool } from "../utils/db";
import { getIO } from "../utils/socket";
import { requireAuth } from "../middlewares/auth.middleware";
import { getCouponFromDB, calculateDiscount } from "../utils/booking";
import { cancelBooking } from "../utils/bookingCancel";
import Stripe from "stripe";

const bookingRouter = Router();

// ===========================================================
// GET /booking/showtime/:showtimeId/info — Get Showtime Info
// ===========================================================
bookingRouter.get(
  "/showtime/:showtimeId/info",
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { showtimeId } = req.params;

      if (!showtimeId) {
        return res.status(400).json({
          message: "Invalid showtimeId",
        });
      }

      const result = await client.query(
        `
        SELECT
          movies.id,
          movies.title,
          movies.poster_url,
          movies.language,
          showtimes.start_time,
          showtimes.base_price,
          halls.name AS hall_name,
          cinemas.name AS cinema_name,
          ARRAY_AGG(genres.name) AS genres
        FROM showtimes
        JOIN movies ON movies.id = showtimes.movie_id
        JOIN halls ON halls.id = showtimes.hall_id
        JOIN cinemas ON cinemas.id = halls.cinema_id
        LEFT JOIN movie_genres ON movie_genres.movie_id = movies.id
        LEFT JOIN genres ON genres.id = movie_genres.genre_id
        WHERE showtimes.id = $1
        GROUP BY 
          movies.id,
          movies.title,
          movies.poster_url,
          movies.rating,
          movies.language,
          showtimes.start_time,
          showtimes.base_price,
          halls.name,
          cinemas.name
      `,
        [showtimeId],
      );

      if (result.rowCount === 0) {
        return res.status(401).json({
          message: "Showtime not found",
        });
      }

      const data = result.rows[0];

      const startTime = new Date(data.start_time);

      return res.status(200).json({
        id: data.id,
        title: data.title,
        posterUrl: data.poster_url,
        date: startTime.toISOString().split("T")[0],
        time: startTime.toISOString().split("T")[1].slice(0, 5),
        cinema: data.cinema_name,
        hall: data.hall_name,
        language: data.language,
        genres: data.genres,
        price: data.base_price,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch showtime info",
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// ====================================================
// GET /booking/showtime/:showtimeId/seats — Get Seats
// ====================================================
bookingRouter.get(
  "/showtime/:showtimeId/seats",
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { showtimeId } = req.params;

      if (!showtimeId) {
        return res.status(400).json({
          message: "Invalid showtimeId",
        });
      }

      const result = await client.query(
        `
        SELECT 
          showtime_seats.id,
          seats.row_letter,
          seats.seat_number,
          showtime_seats.status,
          showtime_seats.selected_by,
          profiles.name AS booked_by_name,
          profiles.avatar_url AS booked_by_avatar
        FROM showtime_seats
        JOIN seats 
        ON seats.id = showtime_seats.seat_id
        LEFT JOIN profiles
        ON profiles.id = showtime_seats.selected_by
        WHERE showtime_seats.showtime_id = $1
        ORDER BY seats.row_letter DESC, seats.seat_number ASC;
      `,
        [showtimeId],
      );
      const grouped: Record<string, any[]> = {};

      result.rows.forEach((seat) => {
        if (!grouped[seat.row_letter]) {
          grouped[seat.row_letter] = [];
        }

        grouped[seat.row_letter].push({
          id: seat.id,
          seat_number: seat.seat_number,
          status: seat.status,
          selected_by: seat.selected_by,
          booked_by_name: seat.booked_by_name || null,
          booked_by_avatar: seat.booked_by_avatar || null,
        });
      });

      const formatted = Object.keys(grouped)
        .sort()
        .reverse()
        .map((row) => ({
          row_letter: row,
          seats: grouped[row],
        }));

      return res.status(200).json(formatted);
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch seats",
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// ==============================================================
// GET /booking/showtimeSeat/:showtimeId/my-seats — Get My Seats
// ==============================================================
bookingRouter.get(
  "/showtimeSeat/:showtimeId/my-seats",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { showtimeId } = req.params;
      const userId = (req as any).user.id;

      if (!showtimeId) {
        return res.status(400).json({
          message: "Invalid showtimeId",
        });
      }

      const result = await client.query(
        `
        SELECT id, expires_at
        FROM showtime_seats
        WHERE showtime_id = $1
        AND selected_by = $2
        AND status = 'selected'
        AND expires_at > now()
      `,
        [showtimeId, userId],
      );

      return res.status(200).json({
        seatIds: result.rows.map((seat) => seat.id),
        expires_at: result.rows[0]?.expires_at || null,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch my seats",
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// ====================================================
// POST /booking/showtimeSeat/select — Select Seats
// ====================================================
bookingRouter.post(
  "/showtimeSeat/select",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { seatIds, showtimeId } = req.body;

      const userId = (req as any).user.id;

      if (!showtimeId || !Array.isArray(seatIds) || seatIds.length === 0) {
        return res.status(400).json({
          message: "Invalid payload",
        });
      }

      await client.query("BEGIN");

      const result = await client.query(
        `
        UPDATE showtime_seats
        SET status = 'selected',
            selected_by = $1,
            expires_at = now() + interval '5 minutes'
        WHERE id = ANY($2)
        AND status = 'available'
        AND showtime_id = $3
        RETURNING *;
      `,
        [userId, seatIds, showtimeId],
      );

      if (result.rowCount !== seatIds.length) {
        throw new Error("One or more seats are not available");
      }

      await client.query("COMMIT");

      getIO().to(`showtime:${showtimeId}`).emit("seatSelected", {
        seatIds,
        userId,
      });

      return res.status(200).json({
        message: "Seat selected successfully",
        data: result.rows,
      });
    } catch (error: any) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// =====================================================
// POST /booking/showtimeSeat/release — Release Seats
// =====================================================
bookingRouter.post(
  "/showtimeSeat/release",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { seatIds, showtimeId } = req.body;
      const userId = (req as any).user.id;

      if (!showtimeId || !Array.isArray(seatIds) || seatIds.length === 0) {
        return res.status(400).json({
          message: "Invalid payload",
        });
      }

      const result = await client.query(
        `
        UPDATE showtime_seats
        SET status = 'available',
            selected_by = NULL,
            expires_at = NULL
        WHERE id = ANY($1)
        AND selected_by = $2
        AND status = 'selected'
        AND showtime_id = $3
        RETURNING id;
      `,
        [seatIds, userId, showtimeId],
      );

      if (result.rowCount && result.rowCount > 0) {
        getIO().to(`showtime:${showtimeId}`).emit("seatExpired", {
          seatIds: result.rows.map((r) => r.id),
        });
      }

      return res.status(200).json({
        message: "Seats released successfully",
        releasedCount: result.rowCount,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to release seats",
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// =====================================================
// POST /booking/showtimeSeat/confirm — Confirm Booking
// =====================================================
bookingRouter.post(
  "/showtimeSeat/confirm",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { showtimeId, seatIds, selectedCouponId, paymentIntentId } = req.body;

      const userId = (req as any).user.id;

      if (!showtimeId || !Array.isArray(seatIds) || seatIds.length === 0) {
        return res
          .status(400)
          .json({ message: "Invalid payload", data: req.body });
      }

      await client.query("BEGIN");

      console.log("🔍 [Booking Confirm] Seat validation:", {
        seatIds,
        userId,
        showtimeId,
        checking: "selected_by field",
      });

      const updateSeat = await client.query(
        `
        UPDATE showtime_seats
        SET status = 'booked',
            booked_at = now(),
            expires_at = NULL
        WHERE id = ANY($1)
        AND status = 'selected'
        AND selected_by = $2
        AND showtime_id = $3
        RETURNING id;
      `,
        [seatIds, userId, showtimeId],
      );

      console.log("🔍 [Booking Confirm] Seat update result:", {
        expectedCount: seatIds.length,
        actualCount: updateSeat.rowCount,
        updatedIds: updateSeat.rows.map((r) => r.id),
      });

      if (updateSeat.rowCount !== seatIds.length) {
        throw new Error("One or more seats are invalid or expired");
      }

      const showtimeResult = await client.query(
        `
          SELECT base_price
          FROM showtimes
          WHERE id = $1;
        `,
        [showtimeId],
      );

      if (showtimeResult.rowCount === 0) {
        throw new Error("Showtime not found");
      }

      const basePrice = Number(showtimeResult.rows[0].base_price);

      const subtotal = basePrice * seatIds.length;
      let discount = 0;

      console.log("🧮 [Booking Confirm] Coupon calculation:", {
        showtimeId,
        seatIds,
        selectedCouponId,
        subtotal,
        basePrice,
      });

      let couponIdToInsert = selectedCouponId;

      if (selectedCouponId && selectedCouponId.trim() !== "") {
        const coupon = await getCouponFromDB(selectedCouponId);
        if (coupon && coupon.is_active) {
          const discountedTotal = calculateDiscount(subtotal, coupon);
          discount = subtotal - discountedTotal;
        } else {
          // ถ้าไม่พบ coupon ให้ไม่ใช้คูปองและไม่ส่ง coupon_id ไป
          console.log(
            "⚠️ [Booking Confirm] Coupon not found, proceeding without discount",
          );
          couponIdToInsert = ""; // Reset เพื่อไม่ส่ง coupon_id ที่ไม่มีอยู่
        }
      }

      const total = subtotal - discount;

      const bookingResult = await client.query(
        `
          INSERT INTO bookings 
          (profile_id, showtime_id, subtotal, discount_amount, total_price, coupon_id, status, payment_method, stripe_payment_intent_id)
          VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8)
          RETURNING *;
        `,
        [userId, showtimeId, subtotal, discount, total, couponIdToInsert || null, 'credit_card', paymentIntentId || null],
      );

      const booking = bookingResult.rows[0];

      // อัปเดตสถานะคูปองว่าถูกใช้แล้ว
      if (couponIdToInsert && couponIdToInsert.trim() !== "") {
        await client.query(
          "UPDATE profile_coupons SET is_used = true, used_at = now() WHERE coupon_id = $1 AND profile_id = $2",
          [couponIdToInsert, userId],
        );
      }

      for (const seatId of seatIds) {
        await client.query(
          `
          INSERT INTO booking_seats (booking_id, showtime_seat_id, price_at_booking)
          VALUES ($1, $2, $3)
          ON CONFLICT (booking_id, showtime_seat_id)
          DO NOTHING
        `,
          [booking.id, seatId, basePrice],
        );
      }

      // 🎁 Award Wheel Spin Credits: 1 Spin per 500 THB spent
      const earnedCredits = Math.floor(Number(total) / 500);
      if (earnedCredits > 0) {
        await client.query(
          `
          INSERT INTO wheel_spin_credits (profile_id, booking_id, credits, used)
          VALUES ($1, $2, $3, false)
          `,
          [userId, booking.id, earnedCredits],
        );
      }

      await client.query("COMMIT");

      getIO().to(`showtime:${showtimeId}`).emit("seatBooked", {
        seatIds,
      });

      return res.status(200).json({
        message: "Booking confirmed successfully",
        bookingId: booking.id,
        couponId: booking.coupon_id,
        discountAmount: discount,
        finalPrice: total,
      });
    } catch (error: any) {
      await client.query("ROLLBACK");

      console.error("❌ [Booking Confirm] Error:", {
        error: error.message,
        stack: error.stack,
        body: req.body,
        userId: (req as any).user.id,
      });

      return res.status(400).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// =========================================
// POST /booking/confirm-qr — Confirm QR Payment
// =========================================

// POST /booking/showtimeSeat/confirm-qr
bookingRouter.post(
  "/showtimeSeat/confirm-qr", requireAuth,
  async (req: Request, res: Response) => {
    console.log("QR confirm payload:", req.body)
    const client = await connectionPool.connect();

    try {
      const {
        showtimeId,
        seatIds,
        selectedCouponId,
        paymentIntentId,
        forceSuccess,
      } = req.body;

      if (
        !showtimeId ||
        !Array.isArray(seatIds) ||
        seatIds.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid payload",
        });
      }

      // ✅ Verify Stripe — ข้ามถ้าเป็น dev + forceSuccess
      if (paymentIntentId && (!forceSuccess && process.env.NODE_ENV === "production")) {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        const paymentIntent =
          await stripe.paymentIntents.retrieve(paymentIntentId);
        if (paymentIntent.status !== "succeeded") {
          return res.status(400).json({
            success: false,
            message: `Payment not succeeded: ${paymentIntent.status}`,
          });
        }
      }

      const userId = (req as any).user.id;

      await client.query("BEGIN");

      const updateSeat = await client.query(
        `UPDATE showtime_seats
         SET status = 'booked', booked_at = now(), expires_at = NULL
         WHERE id = ANY($1) AND selected_by = $2 AND status = 'selected' AND showtime_id = $3
         RETURNING id`,
        [seatIds, userId, showtimeId],
      );

      if (updateSeat.rowCount !== seatIds.length) {
        throw new Error("One or more seats are invalid or expired");
      }

      const showtimeResult = await client.query(
        `SELECT base_price FROM showtimes WHERE id = $1`,
        [showtimeId],
      );

      const basePrice = Number(showtimeResult.rows[0].base_price);
      const subtotal = basePrice * seatIds.length;
      let discount = 0;
      let couponIdToInsert = selectedCouponId;

      if (selectedCouponId && selectedCouponId.trim() !== "") {
        const coupon = await getCouponFromDB(selectedCouponId);
        if (coupon && coupon.is_active) {
          const discountedTotal = calculateDiscount(subtotal, coupon);
          discount = subtotal - discountedTotal;
        } else {
          couponIdToInsert = "";
        }
      }

      const total = subtotal - discount;

      const bookingResult = await client.query(
        `INSERT INTO bookings 
         (profile_id, showtime_id, subtotal, discount_amount, total_price, coupon_id, status, payment_method, stripe_payment_intent_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8)
         RETURNING *`,
        [userId, showtimeId, subtotal, discount, total, couponIdToInsert || null, 'promptpay', paymentIntentId || null]
      );

      const booking = bookingResult.rows[0];

      if (couponIdToInsert && couponIdToInsert.trim() !== "") {
        await client.query(
          "UPDATE profile_coupons SET is_used = true, used_at = now() WHERE coupon_id = $1 AND profile_id = $2",
          [couponIdToInsert, userId],
        );
      }

      for (const seatId of seatIds) {
        await client.query(
          `INSERT INTO booking_seats (booking_id, showtime_seat_id, price_at_booking)
          VALUES ($1, $2, $3)
          ON CONFLICT (booking_id, showtime_seat_id) DO NOTHING`,
          [booking.id, seatId, basePrice]
        );
      }

      await client.query("COMMIT");
      getIO().to(`showtime:${showtimeId}`).emit("seatBooked", { seatIds });

      return res.status(200).json({
        success: true,
        message: "Booking confirmed successfully",
        bookingId: booking.id,
        finalPrice: total,
      });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("❌ [QR Confirm] Error:", error.message);
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    } finally {
      client.release();
    }
  }
);

// =========================================
// POST /booking/cancel — Cancel Booking
// =========================================
bookingRouter.post(
  "/:bookingId/cancel",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { bookingId } = req.params;
      const userId = (req as any).user.id;
      const { reason } = req.body;

      if (!bookingId || Array.isArray(bookingId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid bookingId",
        });
      }

      const result = await cancelBooking(bookingId, userId, reason);

      // 🔥 realtime seat release
      if (result.releasedSeatIds.length > 0) {
        getIO().to(`showtime:${result.showtimeId}`).emit("seatReleased", {
          seatIds: result.releasedSeatIds,
        });
      }

      return res.status(200).json({
        success: true,
        status: result.status,
        message:
          result.status === "refunded"
            ? "Booking cancelled and refunded"
            : "Booking cancelled",
      });
    } catch (err: any) {
      console.error("Cancel booking error:", err.message);

      if (err.message === "BOOKING_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      if (err.message === "FORBIDDEN") {
        return res.status(403).json({
          success: false,
          message: "You cannot cancel this booking",
        });
      }

      if (err.message === "BOOKING_COMPLETED") {
        return res.status(400).json({
          success: false,
          message: "This booking is already completed",
        });
      }

      if (err.message === "CANNOT_CANCEL_TIME") {
        return res.status(400).json({
          success: false,
          message: "Cannot cancel less than 30 minutes before showtime",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to cancel booking",
      });
    }
  }
);

// =========================================
// GET /booking/:bookingId — Booking Detail
// =========================================
bookingRouter.get(
  "/:bookingId",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { bookingId } = req.params;
      const userId = (req as any).user.id;

      const result = await client.query(
        `
        SELECT
          b.id,
          b.status,
          b.subtotal,
          b.discount_amount,
          b.total_price,
          b.payment_method,
          b.created_at,
          s.start_time,
          m.title,
          m.poster_url,
          COALESCE(
            ARRAY_AGG(se.row_letter || se.seat_number)
            FILTER (WHERE se.id IS NOT NULL),
            '{}'
          ) AS seats
        FROM bookings b
        JOIN showtimes s ON s.id = b.showtime_id
        JOIN movies m ON m.id = s.movie_id
        LEFT JOIN booking_seats bs ON bs.booking_id = b.id
        LEFT JOIN showtime_seats ss ON ss.id = bs.showtime_seat_id
        LEFT JOIN seats se ON se.id = ss.seat_id
        WHERE b.id = $1
        AND b.profile_id = $2
        GROUP BY b.id, s.start_time, m.title, m.poster_url
        `,
        [bookingId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          message: "Booking not found",
        });
      }

      return res.json(result.rows[0]);

    } catch (err: any) {
      return res.status(500).json({
        message: "Failed to load booking",
      });
    } finally {
      client.release();
    }
  }
);

// =========================================
// POST /booking/share — Create Share Token
// =========================================
bookingRouter.post(
  "/share",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { bookingId } = req.body;
      const userId = (req as any).user.id;

      if (!bookingId) {
        return res.status(400).json({
          message: "Invalid bookingId",
        });
      }

      // ตรวจสอบว่า Booking เป็นของผู้ใช้คนนี้ และ status เป็น confirmed
      const bookingResult = await client.query(
        `
          SELECT id, share_token, showtime_id
          FROM bookings
          WHERE id = $1
          AND profile_id = $2
          AND status = 'confirmed'
        `,
        [bookingId, userId],
      );

      if (bookingResult.rowCount === 0) {
        return res.status(404).json({
          message: "Booking not found or not confirmed",
        });
      }

      const booking = bookingResult.rows[0];

      // ถ้ามี share_token อยู่แล้ว ส่งกลับ Token เดิม (ไม่สร้างใหม่)
      if (booking.share_token) {
        return res.status(200).json({
          shareToken: booking.share_token,
          shareUrl: `${process.env.FRONTEND_URL || "https://your-frontend.com"}/shared/${booking.share_token}`,
        });
      }

      // สร้าง Token ใหม่ด้วย crypto.randomBytes (ขนาด 32 bytes = 64 ตัวอักษร hex)
      const shareToken = crypto.randomBytes(32).toString("hex");

      // บันทึก Token ลงตาราง bookings
      await client.query(
        `
          UPDATE bookings
          SET share_token = $1
          WHERE id = $2
        `,
        [shareToken, bookingId],
      );

      return res.status(200).json({
        shareToken: shareToken,
        shareUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/shared/${shareToken}`,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to generate share link",
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
);

// =====================================================
// GET /booking/share/:shareToken — Get Share Link Data
// (Public Route — No Authentication Required)
// =====================================================
bookingRouter.get("/share/:shareToken", async (req: Request, res: Response) => {
  const client = await connectionPool.connect();

  try {
    const { shareToken } = req.params;

    if (!shareToken) {
      return res.status(400).json({ message: "Invalid share token" });
    }

    // ── 1. Fetch booking + movie + showtime + hall + cinema + profile ──
    const bookingResult = await client.query(
      `
        SELECT
          bookings.id                  AS booking_id,
          bookings.showtime_id,
          bookings.profile_id,
 
          profiles.name                AS shared_by_name,
          profiles.avatar_url          AS shared_by_avatar,
 
          movies.title                 AS movie_title,
          movies.poster_url,
          movies.language,
          movies.synopsis,
 
          showtimes.start_time,
 
          halls.name                   AS hall_name,
          cinemas.name                 AS cinema_name,
 
          ARRAY_AGG(DISTINCT genres.name) FILTER (WHERE genres.name IS NOT NULL) AS genres
        FROM bookings
        JOIN profiles    ON profiles.id    = bookings.profile_id
        JOIN showtimes   ON showtimes.id   = bookings.showtime_id
        JOIN movies      ON movies.id      = showtimes.movie_id
        JOIN halls       ON halls.id       = showtimes.hall_id
        JOIN cinemas     ON cinemas.id     = halls.cinema_id
        LEFT JOIN movie_genres ON movie_genres.movie_id = movies.id
        LEFT JOIN genres       ON genres.id = movie_genres.genre_id
        WHERE bookings.share_token = $1
          AND bookings.status      = 'confirmed'
        GROUP BY
          bookings.id,
          bookings.showtime_id,
          bookings.profile_id,
          profiles.name,
          profiles.avatar_url,
          movies.title,
          movies.poster_url,
          movies.language,
          movies.synopsis,
          showtimes.start_time,
          halls.name,
          cinemas.name
        `,
      [shareToken],
    );

    if (bookingResult.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "Share link not found or booking is not confirmed" });
    }

    const booking = bookingResult.rows[0];

    // ── 2. Fetch booked seats ──
    const seatsResult = await client.query(
      `
        SELECT
          seats.row_letter,
          seats.seat_number
        FROM booking_seats
        JOIN showtime_seats ON showtime_seats.id = booking_seats.showtime_seat_id
        JOIN seats          ON seats.id           = showtime_seats.seat_id
        WHERE booking_seats.booking_id = $1
        ORDER BY seats.row_letter ASC, seats.seat_number ASC
        `,
      [booking.booking_id],
    );

    // Format seat labels e.g. ["C9", "C10"]
    const seatLabels: string[] = seatsResult.rows.map(
      (s) => `${s.row_letter}${s.seat_number}`,
    );

    // ── 3. Format date / time (ISO-safe, locale-independent) ──
    const startTime = new Date(booking.start_time);

    // "2026-03-14"
    const date = startTime.toISOString().split("T")[0];

    // "14:00"
    const time = startTime.toISOString().split("T")[1].slice(0, 5);

    // ── 4. Build response ──
    return res.status(200).json({
      // Movie info
      posterUrl: booking.poster_url,
      title: booking.movie_title,
      genres: booking.genres ?? [],
      language: booking.language,
      synopsis: booking.synopsis,

      // Showtime info
      cinema: booking.cinema_name,
      date,
      time,
      hall: booking.hall_name,

      // Ticket info
      ticketCount: seatLabels.length,
      seats: seatLabels,

      // Owner of the booking (the friend who shared)
      sharedBy: {
        name: booking.shared_by_name,
        avatarUrl: booking.shared_by_avatar ?? null,
      },

      // Expose showtimeId so frontend can redirect to seat-picker
      showtimeId: booking.showtime_id,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to fetch booking detail",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

export default bookingRouter;
