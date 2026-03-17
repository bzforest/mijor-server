import { connectionPool } from "./db";
import Stripe from "stripe";
import { getIO } from "./socket";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const cancelBooking = async (
  bookingId: string,
  userId: string,
  reason?: string,
): Promise<{
  status: "cancelled" | "refunded";
  showtimeId: string;
  releasedSeatIds: string[];
}> => {
  const client = await connectionPool.connect();
  let finalStatus: "cancelled" | "refunded" = "cancelled";
  let booking: any;
  let seatIds: string[] = [];

  try {
    await client.query("BEGIN");

    const bookingResult = await client.query(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [bookingId],
    );

    if (bookingResult.rows.length === 0) {
      throw new Error("BOOKING_NOT_FOUND");
    }

    booking = bookingResult.rows[0];

    if (booking.profile_id !== userId) {
      throw new Error("FORBIDDEN");
    }

    const showtimeResult = await client.query(
      `SELECT start_time FROM showtimes WHERE id = $1`,
      [booking.showtime_id],
    );

    if (showtimeResult.rowCount === 0) {
      throw new Error("SHOWTIME_NOT_FOUND");
    }

    const startTime = new Date(showtimeResult.rows[0].start_time);
    const now = new Date();

    const cancelDeadline = new Date(startTime.getTime() - 30 * 60 * 1000);

    if (now > cancelDeadline) {
      throw new Error("CANNOT_CANCEL_TIME");
    }

    if (booking.status === "cancelled") {
      await client.query("ROLLBACK");
      return {
        status: "cancelled",
        showtimeId: booking.showtime_id,
        releasedSeatIds: [],
      };
    }

    if (booking.status === "refunded") {
      await client.query("ROLLBACK");
      return {
        status: "refunded",
        showtimeId: booking.showtime_id,
        releasedSeatIds: [],
      };
    }

    if (booking.status === "completed") {
      throw new Error("BOOKING_COMPLETED");
    }

    const seatResult = await client.query(
      "SELECT showtime_seat_id FROM booking_seats WHERE booking_id = $1",
      [bookingId],
    );

    seatIds = seatResult.rows.map((row) => row.showtime_seat_id);

    if (seatIds.length > 0) {
      await client.query(
        `UPDATE showtime_seats
         SET status = 'available',
             selected_by = NULL,
             booked_at = NULL,
             expires_at = NULL
         WHERE id = ANY($1)`,
        [seatIds],
      );
    }

    await client.query(
      `UPDATE bookings
       SET status = 'cancelled',
           cancel_reason = $2,
           updated_at = now()
       WHERE id = $1`,
      [bookingId, reason || null],
    );

    await client.query("COMMIT");

    // ✅ Stripe refund แยกต่างหาก หลัง COMMIT เสมอ
    // ไม่อยู่ใน transaction เพราะ Stripe เป็น external API
    // ถ้า refund fail → booking ยัง cancelled อยู่ ไม่ต้อง rollback
    if (booking.stripe_payment_intent_id && Number(booking.total_price) > 0) {
      try {
        await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id,
        });

        await connectionPool.query(
          `UPDATE bookings
           SET status = 'refunded',
               updated_at = now()
           WHERE id = $1`,
          [bookingId],
        );

        finalStatus = "refunded";
      } catch (error) {
        console.error("Failed to create refund:", error);
        // booking ยัง cancelled อยู่ ไม่ต้องทำอะไรเพิ่ม
      }
    }

    // ✅ emit socket หลัง COMMIT เสมอ (ย้ายออกจาก if-stripe block)
    // เดิม: emit เฉพาะตอน Stripe refund สำเร็จ → QR booking ไม่ได้ emit
    if (seatIds.length > 0) {
      getIO().to(`showtime:${booking.showtime_id}`).emit("seatReleased", {
        seatIds,
      });
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    try {
      await connectionPool.query(
        `UPDATE bookings
         SET refund_failed = true,
             refund_error = $2
         WHERE id = $1`,
        [bookingId, String(error)],
      );
    } catch (e) {
      console.error("Failed to mark refund_failed", e);
    }

    throw error;
  } finally {
    client.release();
  }

  return {
    status: finalStatus,
    showtimeId: booking?.showtime_id ?? "",
    releasedSeatIds: seatIds,
  };
};

export default cancelBooking;
