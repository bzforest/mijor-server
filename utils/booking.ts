/**
 * Booking Database Utilities
 * ฟังก์ชันสำหรับจัดการข้อมูลการจองใน database
 */

import { connectionPool } from "./db";

/**
 * ดึงข้อมูลการจองจาก database ตาม booking ID
 * @param bookingId - ID ของการจอง
 * @returns Promise<number | null> - ราคาทั้งหมด หรือ null ถ้าไม่พบ
 */
export async function getOriginalPriceFromDB(bookingId: string): Promise<number | null> {
  try {
    console.log('🔍 [getOriginalPriceFromDB] Looking up booking:', bookingId);
    
    // ตรวจสอบว่า bookingId เป็น UUID ที่ถูกต้องหรือไม่
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(bookingId)) {
      console.log('⚠️ [getOriginalPriceFromDB] Invalid bookingId format, treating as non-existent booking:', bookingId);
      return null;
    }

    const result = await connectionPool.query(
      'SELECT total_price, status, created_at, expires_at FROM bookings WHERE id = $1',
      [bookingId]
    );

    if (result.rowCount === 0) {
      console.log('⚠️ [getOriginalPriceFromDB] Booking not found:', bookingId);
      return null;
    }

    const data = result.rows[0];

    // ตรวจสอบว่าการจองยังไม่หมดอายุ
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      console.log('⚠️ [getOriginalPriceFromDB] Booking expired:', bookingId);
      return null;
    }

    // ตรวจสอบสถานะการจอง
    if (data.status === 'cancelled' || data.status === 'completed') {
      console.log('⚠️ [getOriginalPriceFromDB] Booking not available:', { 
        bookingId, 
        status: data.status 
      });
      return null;
    }

    console.log('✅ [getOriginalPriceFromDB] Found booking price:', {
      bookingId,
      totalPrice: data.total_price,
      status: data.status
    });

    return data.total_price;

  } catch (error) {
    console.error('❌ [getOriginalPriceFromDB] Unexpected error:', error);
    return null;
  }
}

/**
 * ดึงข้อมูล coupon จาก database
 * @param couponId - ID ของ coupon
 * @returns Promise<object | null> - ข้อมูล coupon หรือ null ถ้าไม่พบ
 */
export async function getCouponFromDB(couponId: string): Promise<any | null> {
  try {
    console.log('🔍 [getCouponFromDB] Looking up coupon:', couponId);

    if (!couponId || couponId.trim() === '') {
      return null;
    }

    const result = await connectionPool.query(
      'SELECT * FROM coupons WHERE id = $1 AND is_active = true',
      [couponId]
    );

    console.log('🔍 [getCouponFromDB] Query result:', {
      rowCount: result.rowCount,
      rows: result.rows
    });

    if (result.rowCount === 0) {
      console.log('⚠️ [getCouponFromDB] Coupon not found or inactive:', couponId);
      return null;
    }

    const data = result.rows[0];

    // ตรวจสอบว่า coupon ยังไม่หมดอายุ
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      console.log('⚠️ [getCouponFromDB] Coupon expired:', couponId);
      return null;
    }

    console.log('✅ [getCouponFromDB] Found coupon:', {
      couponId,
      discountType: data.discount_type,
      discountValue: data.discount_value
    });

    return data;
  } catch (error) {
    console.error('❌ [getCouponFromDB] Unexpected error:', error);
    return null;
  }
}

/**
 * คำนวณส่วนลดจาก coupon
 * @param originalPrice - ราคาเดิม
 * @param coupon - ข้อมูล coupon
 * @returns number - ราคาหลังหักส่วนลด
 */
export function calculateDiscount(originalPrice: number, coupon: any): number {
  if (!coupon) return originalPrice;

  const discount = coupon.discount_type === 'percentage'
    ? (originalPrice * coupon.discount_value) / 100
    : coupon.discount_value;

  const finalPrice = Math.max(0, originalPrice - discount);
  
  console.log('💰 [calculateDiscount] Discount calculation:', {
    originalPrice,
    discountType: coupon.discount_type,
    discountValue: coupon.discount_value,
    discountAmount: discount,
    finalPrice
  });

  return finalPrice;
}

/**
 * อัปเดตสถานะการจอง
 * @param bookingId - ID ของการจอง
 * @param status - สถานะใหม่
 * @param paymentIntentId - ID ของ Payment Intent (ถ้ามี)
 * @returns Promise<boolean> - สำเร็จหรือไม่
 */
export async function updateBookingStatus(
  bookingId: string, 
  status: string, 
  paymentIntentId?: string
): Promise<boolean> {
  try {
    console.log('🔄 [updateBookingStatus] Updating booking:', {
      bookingId,
      status,
      paymentIntentId
    });

    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (paymentIntentId) {
      updateData.stripe_payment_intent_id = paymentIntentId;
    }

    const result = await connectionPool.query(
      'UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3',
      [status, new Date().toISOString(), bookingId]
    );

    if (result.rowCount === 0) {
      console.error('❌ [updateBookingStatus] Update failed: Booking not found');
      return false;
    }

    console.log('✅ [updateBookingStatus] Booking updated successfully');
    return true;

  } catch (error) {
    console.error('❌ [updateBookingStatus] Unexpected error:', error);
    return false;
  }
}
