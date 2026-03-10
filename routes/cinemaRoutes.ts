import { Router } from "express";
import { getAllCinemas, getCinemaShowtimes } from "../controllers/cinemaController";

const router = Router();

// GET /api/cinemas - Fetch all active cinemas
router.get("/", getAllCinemas);

// GET /api/cinemas/:id/showtimes - Fetch highly nested showtimes for a specific cinema
router.get("/:id/showtimes", getCinemaShowtimes);

export default router;
