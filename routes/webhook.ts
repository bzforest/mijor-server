import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

// ใช้ Service Role Key เพื่อให้มีสิทธิ์อัปเดต Table แม้ติด RLS
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const router = express.Router();

// สำคัญมาก: Stripe Webhook ต้องใช้ข้อมูลแบบ Raw Body
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`❌ Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 1. เมื่อจ่ายเงินสำเร็จ (Checkout Session หรือ Payment Intent)
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const session = event.data.object as any;
    
    // ดึงข้อมูลจาก Metadata ที่เราใส่ไว้ใน payment.ts
    const bookingId = session.metadata?.bookingId;
    const paymentIntentId = session.id;

    if (bookingId) {
      // 2. อัปเดตตาราง bookings ใน Supabase
      const { error } = await supabaseAdmin
        .from('bookings')
        .update({ 
          status: 'confirmed', 
          stripe_payment_intent_id: paymentIntentId,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) {
        console.error('❌ Supabase Update Error:', error);
      } else {
        console.log(`✅ Booking ${bookingId} confirmed successfully!`);
      }
    }
  }

  // 3. กรณีมีการคืนเงิน (Refund)
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = charge.payment_intent as string;

    const { error } = await supabaseAdmin
      .from('bookings')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('stripe_payment_intent_id', paymentIntentId);
      
    if (!error) console.log(`🔄 Booking refunded for PI: ${paymentIntentId}`);
  }

  res.json({ received: true });
});

export default router;