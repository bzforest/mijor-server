/**
 * Payment Security Middleware
 * มิดเดิลแวร์สำหรับตรวจสอบความปลอดภัยของระบบการจ่ายเงิน
 */

import { Request, Response, NextFunction } from "express";
import { getOriginalPriceFromDB } from "../utils/booking";

/**
 * Rate Limiting Store (simple in-memory store)
 * ใน production ควรใช้ Redis หรือ database
 */
const paymentRateLimitStore = new Map<
  string,
  { count: number; resetTime: number }
>();

/**
 * Rate Limiting สำหรับการสร้าง payment intent
 * จำกัดจำนวนครั้งต่อ IP ในช่วงเวลาหนึ่ง
 */
export const paymentRateLimit = (
  maxRequests: number = 5,
  windowMs: number = 60000,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();

    // ดึงข้อมูลการใช้งานของ IP
    const record = paymentRateLimitStore.get(clientIp);

    if (!record || now > record.resetTime) {
      // สร้าง record ใหม่หรือรีเซ็ต
      paymentRateLimitStore.set(clientIp, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (record.count >= maxRequests) {
      console.warn("🚨 [paymentRateLimit] Rate limit exceeded:", {
        ip: clientIp,
        count: record.count,
        maxRequests,
        path: req.path,
      });

      return res.status(429).json({
        success: false,
        message: "Too many payment requests. Please try again later.",
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    // เพิ่มจำนวนครั้ง
    record.count++;
    next();
  };
};

/**
 * ตรวจสอบว่า booking ยังสามารถชำระเงินได้หรือไม่
 */
export const validateBookingForPayment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required",
      });
    }

    // ตรวจสอบ booking จาก database
    const originalPrice = await getOriginalPriceFromDB(bookingId);

    if (originalPrice === null) {
      console.warn(
        "⚠️ [validateBookingForPayment] Booking not found or invalid:",
        bookingId,
      );

      // ตรวจสอบว่าเป็น demo booking หรือไม่
      if (
        bookingId.includes("Born") ||
        bookingId.includes("Wild") ||
        !bookingId.match(/^[0-9a-f-]{36}$/i)
      ) {
        console.log("🔍 [validateBookingForPayment] Allowing demo booking");
        return next();
      }

      return res.status(404).json({
        success: false,
        message: "Booking not found or expired",
      });
    }

    console.log("✅ [validateBookingForPayment] Booking validated:", {
      bookingId,
      originalPrice,
    });

    // เพิ่มข้อมูล booking ลงใน request สำหรับใช้ใน middleware ถัดไป
    (req as any).bookingData = {
      bookingId,
      originalPrice,
    };

    next();
  } catch (error: any) {
    console.error("❌ [validateBookingForPayment] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate booking",
      error: error.message,
    });
  }
};

/**
 * ตรวจสอบจำนวนเงินที่ปลอดภัย
 */
export const validateAmount = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { amount } = req.body;

    if (
      amount === undefined ||
      amount === null ||
      typeof amount !== "number" ||
      isNaN(amount)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid amount is required",
      });
    }

    // ตรวจสอบช่วงราคาที่ปลอดภัย (1 - 50,000 บาท)
    if (amount < 0 || amount > 50000) {
      console.warn("🚨 [validateAmount] Invalid amount:", {
        amount,
        ip: req.ip,
        path: req.path,
      });

      return res.status(400).json({
        success: false,
        message: "Amount must be between 0 and 50,000 THB",
      });
    }

    // ตรวจสอบทศนิยม (ไม่เกิน 2 ตำแหน่ง) — ใช้ Math.round ป้องกัน floating point error
    if (Math.round(amount * 100) !== amount * 100) {
      console.warn("🚨 [validateAmount] Invalid decimal places:", {
        amount,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        message: "Amount can have at most 2 decimal places",
      });
    }

    console.log("✅ [validateAmount] Amount validated:", { amount });
    next();
  } catch (error: any) {
    console.error("❌ [validateAmount] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate amount",
      error: error.message,
    });
  }
};

/**
 * ตรวจสอบความปลอดภัยของ coupon
 */
export const validateCoupon = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { selectedCouponId } = req.body;

    // ถ้าไม่มี coupon ให้ผ่านไปได้
    if (!selectedCouponId || selectedCouponId.trim() === "") {
      return next();
    }

    // ตรวจสอบรูปแบบ coupon ID
    if (typeof selectedCouponId !== "string" || selectedCouponId.length > 50) {
      console.warn("🚨 [validateCoupon] Invalid coupon format:", {
        couponId: selectedCouponId,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        message: "Invalid coupon format",
      });
    }

    // ตรวจสอบ SQL injection patterns
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
      /(--|\/\*|\*\/|;|'|")/,
      /\bOR\b.*\b=\b/i,
      /\bAND\b.*\b=\b/i,
    ];

    for (const pattern of sqlPatterns) {
      if (pattern.test(selectedCouponId)) {
        console.warn("🚨 [validateCoupon] Potential SQL injection:", {
          couponId: selectedCouponId,
          ip: req.ip,
          pattern: pattern.source,
        });

        return res.status(400).json({
          success: false,
          message: "Invalid coupon format",
        });
      }
    }

    console.log("✅ [validateCoupon] Coupon validated:", {
      couponId: selectedCouponId,
    });
    next();
  } catch (error: any) {
    console.error("❌ [validateCoupon] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate coupon",
      error: error.message,
    });
  }
};

/**
 * ตรวจสอบ User-Agent และ Headers พื้นฐาน
 */
export const validateRequestHeaders = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userAgent = req.headers["user-agent"];

    // ตรวจสอบว่ามี User-Agent หรือไม่ (ป้องกัน bot)
    if (!userAgent || userAgent.trim() === "") {
      console.warn("🚨 [validateRequestHeaders] Missing User-Agent:", {
        ip: req.ip,
        path: req.path,
      });

      return res.status(400).json({
        success: false,
        message: "Invalid request headers",
      });
    }

    // ตรวจสอบ suspicious User-Agent patterns
    const suspiciousPatterns = [
      /bot/i,
      /crawler/i,
      /scraper/i,
      /curl/i,
      /wget/i,
      /python/i,
      /node/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(userAgent)) {
        console.warn("🚨 [validateRequestHeaders] Suspicious User-Agent:", {
          userAgent,
          ip: req.ip,
          pattern: pattern.source,
        });

        // ใน production อาจ block ได้เลย แต่ตอนนี้แค่ log ไว้
        break;
      }
    }

    console.log("✅ [validateRequestHeaders] Headers validated");
    next();
  } catch (error: any) {
    console.error("❌ [validateRequestHeaders] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate request",
      error: error.message,
    });
  }
};

/**
 * ทำความสะอาด rate limit store ที่หมดอายุ
 */
export const cleanupRateLimitStore = () => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, record] of paymentRateLimitStore.entries()) {
    if (now > record.resetTime) {
      paymentRateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(
      `🧹 [cleanupRateLimitStore] Cleaned ${cleaned} expired records`,
    );
  }
};

// ทำความสะอาด store ทุก 5 นาที
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
