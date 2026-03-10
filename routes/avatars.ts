import express, { Request, Response } from "express";
import multer from "multer";
import { supabase, supabaseAdmin } from '../utils/supabase';
import { requireAuth } from "../middlewares/auth.middleware";

const avatarsRoutes = express.Router();

avatarsRoutes.use(requireAuth);

/* ================= Multer ================= */

const storage = multer.memoryStorage();

const upload = multer({

  storage,

  limits: {
    fileSize: 2 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {

    if (
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .jpg and .png files are allowed"));
    }

  },

});

/* ================= POST avatar ================= */

avatarsRoutes.post(
  "/",
  upload.single("avatar"),
  async (req: Request, res: Response) => {
    console.log("POST /api/avatars HIT");

    try {

      const user = (req as any).user;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          message: "No file uploaded",
        });
      }

      const fileExt = file.originalname.split(".").pop() || "png";

      const filePath = `${user.id}/avatar.${fileExt}`;

      /* upload (ใช้ supabaseAdmin เพื่อ bypass RLS สำหรับการอัปโหลดไฟล์) */

      const { error: uploadError } = await supabaseAdmin.storage
        .from("avatars")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) {

        return res.status(500).json({
          message: "Upload failed",
          error: uploadError.message,
        });

      }

      /* public url */

      const { data } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;

      /* update profile (ใช้ supabaseAdmin เพื่อ bypass RLS เนื่องจากผ่าน Auth มาแล้ว) */

      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          avatar_url: avatarUrl,
        })
        .eq("id", user.id);

      if (updateError) {

        return res.status(500).json({
          message: "Failed to update profile",
        });

      }

      res.status(200).json({
        success: true,
        avatar_url: avatarUrl,
      });

    } catch (error) {

      res.status(500).json({
        message: "Internal server error",
      });

    }

  }
);

/* ================= GET profile + avatar ================= */

avatarsRoutes.get("/", async (req: Request, res: Response) => {
  console.log("GET /api/avatars HIT");

  try {

    const userAuth = (req as any).user;

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("name, email, avatar_url")
      .eq("id", userAuth.id)
      .single();

    // หากไม่พบข้อมูล หรือมี error (เช่น ยังไม่มี row ใน profiles)
    if (error) {
      // คืนค่าพื้นฐานจาก Auth user แทนการ error เพื่อกัน 404/500
      return res.status(200).json({
        success: true,
        name: userAuth.user_metadata?.name || "",
        email: userAuth.email || "",
        avatar_url: null,
      });
    }

    res.status(200).json({
      success: true,
      name: data.name,
      email: data.email,
      avatar_url: data.avatar_url,
    });

  } catch (error) {

    res.status(500).json({
      message: "Internal server error",
    });

  }

});

/* ================= PUT update name ================= */

avatarsRoutes.put("/", async (req: Request, res: Response) => {
  console.log("PUT /api/avatars HIT", req.body);
  try {
    const userAuth = (req as any).user;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ name })
      .eq("id", userAuth.id);

    if (error) {
      return res.status(500).json({ message: "Failed to update name" });
    }

    res.status(200).json({ success: true, message: "Profile updated" });

  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
});

export default avatarsRoutes;