import { Request, Response, NextFunction } from "express";

// (Register)
export const validateRegisterInput = (req: Request, res: Response, next: NextFunction): void => {
  const { email, password, name } = req.body;

  if (!email) {
    res.status(400).json({ error: "กรุณากรอก Email" });
    return;
  }

  if (!password) {
    res.status(400).json({ error: "กรุณากรอก Password" });
    return;
  }

  if (!name) {
    res.status(400).json({ error: "กรุณากรอก Name" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "รูปแบบ Email ไม่ถูกต้อง" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
    return;
  }

  next();
};

// (Login)
export const validateLoginInput = (req: Request, res: Response, next: NextFunction): void => {
  const { email, password } = req.body;

  if (!email) {
    res.status(400).json({ error: "กรุณากรอก Email" });
    return;
  }

  if (!password) {
    res.status(400).json({ error: "กรุณากรอก Password"});
    return;
  }

  next();
};