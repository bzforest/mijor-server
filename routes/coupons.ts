import express, { Request, Response } from "express";
import { connectionPool } from "../utils/db";

const couponsRoutes = express.Router();

couponsRoutes.get("/", async (req: Request, res: Response) => {
  try {
    const results = await connectionPool.query('SELECT * FROM coupons');
    
    return res.status(200).json({
      data: results.rows
    });
  } catch (error: any) {
    console.log("DB Error: ", error); 
    
    return res.status(500).json({
      message: "ดึงข้อมูลไม่สำเร็จ",
      error: error.message 
    });
  }
});

couponsRoutes.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const results = await connectionPool.query(`SELECT * FROM coupons WHERE id = $1`, [id]);
    
    return res.status(200).json({
      data: results.rows
    });
  } catch (error: any) {
    console.log("DB Error: ", error); 
    
    return res.status(500).json({
      message: "ดึงข้อมูลไม่สำเร็จ",
      error: error.message 
    });
  }
});

export default couponsRoutes;
  
