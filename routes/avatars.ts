import express, { Request, Response } from "express";
import multer from "multer";
import { supabase } from "../utils/supabase";
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

      /* upload */

      const { error: uploadError } = await supabase.storage
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

      /* update profile */

      const { error: updateError } = await supabase
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

/* ================= GET avatar ================= */

avatarsRoutes.get("/", async (req: Request, res: Response) => {

  try {

    const user = (req as any).user;

    const { data, error } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single();

    if (error) {

      return res.status(500).json({
        message: "Failed to fetch avatar",
      });

    }

    res.status(200).json({
      success: true,
      avatar_url: data.avatar_url,
    });

  } catch (error) {

    res.status(500).json({
      message: "Internal server error",
    });

  }

});

export default avatarsRoutes;