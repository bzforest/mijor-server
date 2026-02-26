import { Router, Request, Response } from "express";
import { connectionPool } from "../utils/db";

const cities = Router();

/**
 * GET /cities
 * ดึงรายชื่อเมืองจากตาราง cities ตรงๆ
 */
cities.get("/", async (req: Request, res: Response) => {
    try {
        const result = await connectionPool.query(
            "SELECT name FROM cities ORDER BY name ASC"
        );

        const cityList = result.rows.map((row: any) => row.name);

        return res.status(200).json({ data: cityList });
    } catch (error: any) {
        console.error("GET cities error:", error);
        return res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
});

export default cities;