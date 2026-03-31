import express from "express";
import {
  createSection,
  bulkCreateSections,
  getSectionsByClass,
  updateSection,
  deleteSection
} from "../controllers/course.controller.js";

import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requirePermission } from "../middlewares/permission.middleware.js";

const router = express.Router();

/* =====================================================
   SECTION ROUTES
   ===================================================== */

// Create section
router.post(
  "/section",
  authMiddleware,
  requirePermission("MANAGE_SCHOOL"),
  createSection
);

// Bulk create sections
router.post(
  "/sections/bulk",
  authMiddleware,
  requirePermission("MANAGE_SCHOOL"),
  bulkCreateSections
);

// Get sections by class
router.get(
  "/class/:class_id/sections",
  authMiddleware,
  requirePermission("MANAGE_SCHOOL"),
  getSectionsByClass
);

// Update section
router.put(
  "/section/:id",
  authMiddleware,
  requirePermission("MANAGE_SCHOOL"),
  updateSection
);

// Delete section
router.delete(
  "/section/:id",
  authMiddleware,
  requirePermission("MANAGE_SCHOOL"),
  deleteSection
);

export default router;
