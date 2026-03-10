import { Request, Response , Router} from "express";
import { supabase } from '../utils/supabase';
import { supabaseAdmin } from "../utils/supabaseAdmin";
import { validateRegisterInput , validateLoginInput } from "../middlewares/auth.middleware";

const routerApiAuth = Router();

// ==========================================
// เส้น API สำหรับ Register
// ==========================================
routerApiAuth.post("/register", validateRegisterInput , async (req: Request, res: Response): Promise<any> => {
    try {
      const { email, password, name } = req.body;
  
      // 1. สั่งให้ Supabase จัดการสมัครสมาชิกในระบบ Auth
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { name: name },
        },
      });
  
      if (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
  
      // 2. นำข้อมูลไปบันทึกลงตาราง public.profiles
      if (data.user) {
        const { error: profileError } = await supabase
          .from("profiles")
          .insert([
            {
              id: data.user.id, 
              email: email,
              name: name,
            }
          ]);
  
        if (profileError) {
          console.error("❌ บันทึก Profile ไม่สำเร็จ:", profileError);
        }
  
        const { data: couponData } = await supabase
          .from("coupons")
          .select("id")
          .eq("code", "NEWUSER100")
          .single();
  
        // 2. ถ้าเจอคูปอง ก็จับยัดใส่กระเป๋า (profile_coupons) ให้ User คนนี้เลย
        if (couponData) {
          await supabase.from("profile_coupons").insert([{
            profile_id: data.user.id,
            coupon_id: couponData.id,
            is_used: false
          }]);
          console.log("🎁 แจกคูปองต้อนรับสำเร็จ!");
        }
      }
  
      return res.status(200).json({
        success: true,
        message: "Registration successful",
        user: data.user
      });
  
    } catch (err: any) {
      console.error("Register Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });
  
  // ==========================================
  // เส้น API สำหรับ Login
  // ==========================================
routerApiAuth.post("/login", validateLoginInput , async (req: Request, res: Response): Promise<any> => {
    try {
      const { email, password } = req.body;
  
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });
  
      if (error) {
        const message = error.message === "Invalid login credentials" 
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" 
          : error.message;
        return res.status(401).json({ success: false, message: message });
      }
  
      return res.status(200).json({
        success: true,
        message: "Login successful",
        session: data.session,
        user: data.user
      });
  
    } catch (err: any) {
      console.error("Login Error:", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // ==========================================
  // Reset Password
  // ==========================================
  routerApiAuth.post("/reset-password", async (req: Request, res: Response): Promise<any> => {

    try {
  
      const { email, currentPassword, newPassword } = req.body;
  
      if (!email || !currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }
  
      // 1. ตรวจสอบ password เดิมก่อน
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword
      });
  
      if (loginError || !loginData?.user) {
        return res.status(200).json({
          success: false,
          message: "Current password is incorrect"
        });
      }
  
      // 2. สั่งเปลี่ยน password (ทางฝั่ง Admin)
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        loginData.user.id,
        { password: newPassword }
      );
  
      if (updateError) {
        return res.status(400).json({
          success: false,
          message: updateError.message
        });
      }

      // 3. หลังจากเปลี่ยนรหัสผ่านแล้ว ให้สั่ง Login ใหม่ด้วยรหัสผ่านใหม่ทันที
      // เพื่อรับ Session/Token ชุดใหม่ที่ถูกต้องกลับไปให้ Client
      const { data: newSessionData, error: newSessionError } = await supabase.auth.signInWithPassword({
        email,
        password: newPassword
      });

      if (newSessionError) {
        return res.status(500).json({
          success: false,
          message: "Password updated, but failed to refresh session. Please login again."
        });
      }
  
      return res.status(200).json({
        success: true,
        message: "Password updated",
        session: newSessionData.session,
        user: newSessionData.user
      });
  
    } catch (err: any) {
  
      console.error("Reset Password Error:", err);
  
      return res.status(500).json({
        success: false,
        message: err.message
      });
  
    }
  
  });

export default routerApiAuth