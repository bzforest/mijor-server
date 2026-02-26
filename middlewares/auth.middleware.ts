import { Request, Response, NextFunction } from "express";
import { supabase } from "../utils/supabase";

// (Register)
export const validateRegisterInput = (req: Request, res: Response, next: NextFunction): void => {
  const { email, password, name } = req.body;

  if (!email) {
    res.status(400).json({ success: false, message: "กรุณากรอก Email" });
    return;
  }

  if (!password) {
    res.status(400).json({ success: false, message: "กรุณากรอก Password" });
    return;
  }

  if (!name) {
    res.status(400).json({ success: false, message: "กรุณากรอก Name" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ success: false, message: "รูปแบบ Email ไม่ถูกต้อง" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ success: false, message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
    return;
  }

  next();
};

// (Login)
export const validateLoginInput = (req: Request, res: Response, next: NextFunction): void => {
  const { email, password } = req.body;

  if (!email) {
    res.status(400).json({ success: false, message: "กรุณากรอก Email" });
    return;
  }

  if (!password) {
    res.status(400).json({ success: false, message: "กรุณากรอก Password"});
    return;
  }

  next();
};

// (Protected Routes)
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // ===== Token Extraction =====
  // Extract Bearer token from Authorization header
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    res.status(401).json({ success: false, message: "No token provided" });
    return;
  }

  // ===== Token Validation =====
  // Verify token with Supabase and retrieve user information
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ success: false, message: "Invalid token" });
    return;
  }

  // ===== User Attachment =====
  // Attach authenticated user to request for downstream use
  (req as any).user = user;
  next();
};