import { connectionPool } from "../utils/db";
import { Server } from "socket.io";

export const startExpireSeatJob = (io: Server) => {
  setInterval(async () => {
    try {
      const result = await connectionPool.query(`
        UPDATE showtime_seats
        SET status = 'available',
            selected_by = NULL,
            expires_at = NULL
        WHERE status = 'selected'
        AND expires_at < now()
        RETURNING id, showtime_id;
      `);

      if (result.rowCount && result.rowCount > 0) {
        console.log(
          `[Job] Found ${result.rowCount} expired seats. Update UI realtime.`,
        );
        const grouped: Record<string, string[]> = {};

        result.rows.forEach((row) => {
          if (!grouped[row.showtime_id]) {
            grouped[row.showtime_id] = [];
          }
          grouped[row.showtime_id].push(row.id);
        });

        for (const showtimeId in grouped) {
          console.log(`📡 Emitting seatExpired to showtime:${showtimeId}`, grouped[showtimeId]); // เพิ่ม
          io.to(`showtime:${showtimeId}`).emit("seatExpired", {
            seatIds: grouped[showtimeId],
          });
        }
      }
    } catch (error) {
      console.error("Expire job error:", error);
    }
  }, 1000);
};

