import express from "express";
import {
    login,
    sendLoginOtp,
    getLoggedInUserProfile,
    logout,
    refreshAccessToken,
    updateAvatar
} from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = express.Router();

router.post("/login", login);
router.post("/login/send-otp", sendLoginOtp);
router.route("/refresh-token").post(refreshAccessToken);
router.post("/update-avatar", upload.single("file"), authMiddleware, updateAvatar);

router.get(
    "/profile",
    authMiddleware,
    getLoggedInUserProfile
);

router.post(
    "/logout",
    authMiddleware,
    logout
);

export default router;
