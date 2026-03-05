import { connectionPool } from "../utils/db";
import { io } from "../index"

export const startExpireSeatJob = () => {
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
        const grouped: Record<string, string[]> = {};

        result.rows.forEach( row => {
          if (!grouped[row.showtime_id]) {
            grouped[row.showtime_id] = [];
          }
          grouped[row.showtime_id].push(row.id);
        });

        for (const showtimeId in grouped) {
          io.to(`showtime:${showtimeId}`).emit("seatExpired", {
            seatIds: grouped[showtimeId],
          });
        }
      }

    } catch (error) {
      console.error("Expire job error:", error);
    }
  }, 2000);
};