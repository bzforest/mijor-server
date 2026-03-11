/* ===== Routes: Payment ===== */
/* Responsibility: Handle Stripe payment processing for credit cards and QR codes */

import Stripe from "stripe";
import express from "express";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const paymentRouter = express.Router();

// Database utilities
import {
  getOriginalPriceFromDB,
  getCouponFromDB,
  calculateDiscount,
} from "../utils/booking";

// Security middleware
import {
  paymentRateLimit,
  validateBookingForPayment,
  validateAmount,
  validateCoupon,
  validateRequestHeaders,
} from "../middlewares/paymentSecurity";

/* ===== Credit Card Payment Intent ===== */
// Responsibility: Create Stripe payment intent for credit card processing
paymentRouter.post(
  "/create-payment-intent",
  validateRequestHeaders,
  paymentRateLimit(20, 60000), // 20 requests per minute
  validateAmount,
  validateCoupon,
  validateBookingForPayment,
  async (req, res) => {
    const { amount, bookingId, paymentIntentId, totalPrice, selectedCouponId } =
      req.body;

    try {
      // Validate amount
      if (amount < 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid amount",
        });
      }

      // Server-side price calculation to prevent client-side manipulation
      let serverCalculatedPrice = amount;

      if (totalPrice && selectedCouponId) {
        const coupon = await getCouponFromDB(selectedCouponId);
        serverCalculatedPrice = calculateDiscount(totalPrice, coupon);

        console.log("Server Price Calculation:", {
          totalPrice,
          selectedCouponId,
          coupon: coupon
            ? {
              discountType: coupon.discount_type,
              discountValue: coupon.discount_value,
            }
            : null,
          clientCalculatedPrice: amount,
          serverCalculatedPrice,
          difference: Math.abs(amount - serverCalculatedPrice),
        });

        // SECURITY: Check if client manipulated price
        if (Math.abs(amount - serverCalculatedPrice) > 0.01) {
          console.warn("Price manipulation detected:", {
            bookingId,
            clientPrice: amount,
            serverPrice: serverCalculatedPrice,
            difference: Math.abs(amount - serverCalculatedPrice),
          });

          // Use server price instead of client price
          serverCalculatedPrice = serverCalculatedPrice;
        }
      }

      // SECURITY: Verify client amount matches server calculation
      if (Math.abs(amount - serverCalculatedPrice) > 1) {
        // Allow small rounding differences
        console.error(" Price manipulation detected:", {
          clientAmount: amount,
          serverPrice: serverCalculatedPrice,
          difference: Math.abs(amount - serverCalculatedPrice),
        });
        return res.status(400).json({
          success: false,
          message: "Price validation failed",
        });
      }

      console.log(" Creating payment intent:", {
        amount: serverCalculatedPrice,
        bookingId,
        paymentIntentId: paymentIntentId || "new",
      });

      let paymentIntent;

      if (paymentIntentId) {
        paymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
          amount: Math.round(serverCalculatedPrice * 100), // Use server price
        });
      } else {
        paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(serverCalculatedPrice * 100), // Use server price
          currency: "thb",
          payment_method_types: ["card", "promptpay"], // Add promptpay for QR codes
          metadata: { bookingId },
          confirm: false, // Important: Don't confirm immediately
        });

        console.log("🔵 Payment Intent Created:", {
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
          clientSecret: paymentIntent.client_secret ? "present" : "missing",
          serverCalculatedPrice: serverCalculatedPrice,
          finalAmount: Math.round(serverCalculatedPrice * 100),
        });
      }

      res.json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error: any) {
      console.error("Payment Intent Error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// QR Code Payment Route
/* ===== QR Code Payment ===== */
// Responsibility: Create QR payment for PromptPay with Thai payment standards
paymentRouter.post(
  "/create-qr-payment",
  validateRequestHeaders,
  paymentRateLimit(10, 60000), // 10 requests per minute for QR
  validateAmount,
  validateCoupon,
  async (req, res) => {
    const { amount, bookingId, totalPrice, selectedCouponId, seatExpiresAt } = req.body;

    try {
      // Validate amount
      if (amount < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid amount",
        });
      }

      // Server-side price calculation
      let serverCalculatedPrice = await getOriginalPriceFromDB(bookingId);

      console.log("🔍 [create-qr-payment] Initial price lookup:", {
        bookingId,
        foundInDB: !!serverCalculatedPrice,
        totalPriceFromRequest: totalPrice,
      });

      // Support for demo bookings (titles/manual ids) if not in DB
      if (!serverCalculatedPrice) {
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            bookingId,
          );

        if (!isUuid && totalPrice !== undefined) {
          console.log(
            `🔍 [create-qr-payment] Treating as demo booking: ${bookingId}`,
          );
          serverCalculatedPrice = parseFloat(totalPrice);
        } else if (isUuid) {
          console.warn(
            `⚠️ [create-qr-payment] UUID booking not found in DB: ${bookingId}`,
          );
        }
      }

      if (
        serverCalculatedPrice === null ||
        serverCalculatedPrice === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "Unable to calculate price. Booking not found or invalid.",
          debug: { bookingId, totalPrice },
        });
      }

      let finalPrice = serverCalculatedPrice;
      if (selectedCouponId) {
        const coupon = await getCouponFromDB(selectedCouponId);
        if (coupon && coupon.is_active) {
          finalPrice = calculateDiscount(serverCalculatedPrice, coupon);

          console.log("🔍 QR Payment Price Calculation:", {
            serverCalculatedPrice,
            selectedCouponId,
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
            finalPrice,
            clientAmount: amount,
            difference: Math.abs(amount - finalPrice),
          });
        }
      }

      // Validate price difference
      if (!finalPrice || Math.abs(amount - finalPrice) > 1) {
        console.error("❌ QR Payment validation failed:", {
          finalPrice,
          amount,
          difference: Math.abs(amount - finalPrice),
          serverCalculatedPrice,
          selectedCouponId,
        });
        return res.status(400).json({
          success: false,
          message: "Price validation failed",
          debug: {
            serverPrice: finalPrice,
            clientPrice: amount,
            difference: Math.abs(amount - finalPrice),
          },
        });
      }
      // คำนวณ expiresIn จาก seatExpiresAt
      const expiresIn = seatExpiresAt
        ? Math.max(0, Math.floor((new Date(seatExpiresAt).getTime() - Date.now()) / 1000))
        : 900;

      // Create Stripe payment intent for QR code
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(finalPrice * 100),
        currency: "thb",
        payment_method_types: ["promptpay"],
        metadata: {
          bookingId,
          paymentType: "qr_code",
        },
        confirm: false, // Don't confirm immediately for QR
      });

      console.log("🔵 QR Payment Created:", {
        paymentIntentId: paymentIntent.id,
        amount: finalPrice,
        status: paymentIntent.status,
      });

      // For QR payments, we need to confirm the payment intent to get QR data
      const confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
        payment_method_data: {
          type: "promptpay",
          billing_details: {
            email: "customer@mijorcinema.com", // Default email for QR payments
          },
        },
        return_url: `${process.env.FRONTEND_URL}/payment-success`,
      });

      // Get QR data from confirmed payment intent
      const qrDataFromStripe = confirmedPaymentIntent.next_action?.promptpay_display_qr_code;

      if (!qrDataFromStripe) {
        // Fallback to demo mode if Stripe doesn't provide QR
        console.log('🔄 Stripe QR not available, using fallback QR data');
        res.json({
          success: true,
          paymentIntentId: paymentIntent.id,
          qrData: {
            paymentIntentId: paymentIntent.id,
            amount: finalPrice,
            currency: "thb",
            merchant: {
              name: "Mijor Cinema",
              id: "MIJOR-CINEMA-TH"
            },
            bookingId,
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            paymentMethod: "promptpay",
            billPayment: {
              ref1: bookingId,
              ref2: paymentIntent.id.slice(-8),
              amount: finalPrice.toFixed(2)
            }
          },
          amount: finalPrice,
          expiresIn: expiresIn,
        });
        return;
      }

      // Use real Stripe QR data
      res.json({
        success: true,
        paymentIntentId: paymentIntent.id,
        qrData: {
          image_url_png: qrDataFromStripe.image_url_png,
          image_url_svg: qrDataFromStripe.image_url_svg,
          data: qrDataFromStripe.data,
          amount: finalPrice,
          merchant: {
            name: "Mijor Cinema",
          },
        },
        amount: finalPrice,
        expiresIn: expiresIn,
      });
    } catch (error: any) {
      console.error("QR Payment Error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// Payment Status Checking Route
paymentRouter.get(
  "/status/:paymentIntentId",
  validateRequestHeaders,
  paymentRateLimit(30, 60000), // 30 requests per minute for status checking
  async (req, res) => {
    const { paymentIntentId } = req.params;

    try {
      if (!paymentIntentId || typeof paymentIntentId !== "string") {
        return res.status(400).json({
          success: false,
          error: "Payment Intent ID is required",
        });
      }

      console.log("🔍 Checking payment status for:", paymentIntentId);

      // Retrieve payment intent from Stripe
      const paymentIntent =
        await stripe.paymentIntents.retrieve(paymentIntentId);

      console.log("📊 Payment Status:", {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        created: new Date(paymentIntent.created * 1000).toISOString(),
        metadata: paymentIntent.metadata,
      });

      // Return payment status and relevant details
      res.json({
        success: true,
        status: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount / 100, // Convert from cents to baht
        currency: paymentIntent.currency,
        created: paymentIntent.created,
        metadata: paymentIntent.metadata,
        // Additional useful information
        payment_method_types: paymentIntent.payment_method_types,
        confirmation_method: paymentIntent.confirmation_method,
        last_payment_error: paymentIntent.last_payment_error,
      });
    } catch (error: any) {
      console.error("❌ Payment Status Check Error:", error);

      if (error.type === "StripeInvalidRequestError") {
        return res.status(404).json({
          success: false,
          error: "Payment Intent not found",
        });
      }

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// ========================================
// POST /payments/test-simulate-success
// DEV ONLY — Simulate QR payment success
// ========================================
if (process.env.NODE_ENV !== 'production') {
  paymentRouter.post('/test-simulate-success', async (req, res) => {
    const { paymentIntentId } = req.body;
    try {
      // Stripe test mode: ใช้ confirm พร้อม expand next_action
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method_data: {
          type: 'promptpay',
        },
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
        expand: ['next_action'],
      } as any);

      console.log('🧪 After confirm status:', paymentIntent.status);

      // ถ้ายัง requires_action อยู่ ให้ใช้ test helper
      if (paymentIntent.status === 'requires_action') {
        // Force succeed ผ่าน Stripe test API
        const succeeded = await stripe.paymentIntents.applyCustomerBalance(
          paymentIntentId
        ).catch(() => null);

        console.log('🧪 After applyCustomerBalance:', succeeded?.status);
      }

      res.json({ success: true, status: paymentIntent.status });
    } catch (error: any) {
      console.error('🧪 Simulate error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

export default paymentRouter;
