import { Router, Request, Response } from "express";
import { connectionPool } from "../utils/db";
import { io } from "../index";
import { requireAuth } from "../middlewares/auth.middleware";

const bookingRouter = Router();

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
        date: startTime.toLocaleDateString(),
        time: startTime.toLocaleTimeString(),
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
          showtime_seats.status
        FROM showtime_seats
        JOIN seats 
        ON seats.id = showtime_seats.seat_id
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

bookingRouter.get("/showtimeSeat/:showtimeId/my-seats", requireAuth, async (req: Request, res: Response) => {
  const client = await connectionPool.connect();

  try {

    const { showtimeId } = req.params;
    const userId = (req as any).user.id;

    if (!showtimeId) {
      return res.status(400).json({
        message: "Invalid showtimeId"
      })
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
      [showtimeId, userId]
    )

    return res.status(200).json({
      seatIds: result.rows.map((seat) => seat.id),
      expires_at: result.rows[0]?.expires_at || null
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to fetch my seats",
      error: error.message,
    });
  } finally {
    client.release();
  }
})

bookingRouter.post(
  "/showtimeSeat/select", 
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { seatIds, showtimeId } = req.body;

      const userId = (req as any).user.id;

      if (
        !showtimeId ||
        !Array.isArray(seatIds) ||
        seatIds.length === 0
      ) {
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

      io.to(`showtime:${showtimeId}`).emit("seatSelected", {
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

bookingRouter.post(
  "/showtimeSeat/confirm",
  requireAuth,
  async (req: Request, res: Response) => {
    const client = await connectionPool.connect();

    try {
      const { showtimeId, seatIds } = req.body;

      const userId = (req as any).user.id;

      if (
        !showtimeId ||
        !Array.isArray(seatIds) ||
        seatIds.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "Invalid payload", data: req.body });
      }

      await client.query("BEGIN");

      const updateSeat = await client.query(
        `
        UPDATE showtime_seats
        SET status = 'booked',
            booked_at = now(),
            expires_at = NULL
        WHERE id = ANY($1)
        AND selected_by = $2
        AND status = 'selected'
        AND showtime_id = $3
        RETURNING id;
      `,
        [seatIds, userId, showtimeId],
      );

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
      const discount = 0;
      const total = subtotal - discount;

      const bookingResult = await client.query(
        `
          INSERT INTO bookings 
          (profile_id, showtime_id, subtotal, discount_amount, total_price, status)
          VALUES ($1, $2, $3, $4, $5, 'confirmed')
          RETURNING *;
        `,
        [userId, showtimeId, subtotal, discount, total],
      );

      const booking = bookingResult.rows[0];

      for (const seatId of seatIds) {
        await client.query(
          `
          INSERT INTO booking_seats (booking_id, showtime_seat_id, price_at_booking)
          VALUES ($1, $2, $3)
        `,
          [booking.id, seatId, basePrice],
        );
      }

      await client.query("COMMIT");

      io.to(`showtime:${showtimeId}`).emit("seatBooked", {
        seatIds,
      });

      return res.status(200).json({
        message: "Booking confirmed successfully",
        bookingId: booking.id,
      });
    } catch (error: any) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },
);

export default bookingRouter;
