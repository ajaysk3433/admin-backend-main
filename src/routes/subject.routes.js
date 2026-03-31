import express from "express";

import {
  addSubjectsWithChapters,
  getSubjects,
  getChapters,
  updateSubjectName,
  deleteSubject,
  addChaptersToSubject,
  updateChapter,
  deleteChapter
} from "../controllers/subject.controller.js";

import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requirePermission } from "../middlewares/permission.middleware.js";

const router = express.Router();

/* =====================================================
   ADD MULTIPLE SUBJECTS + CHAPTERS
   ===================================================== */
router.post(
  "/subjects",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  addSubjectsWithChapters
);

/* =====================================================
   GET SUBJECTS
   Example:
   /subjects?class_id=1&board=CBSE&language=EN
   ===================================================== */
router.get(
  "/subjects",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  getSubjects
);

/* =====================================================
   GET CHAPTERS BY CLASS + SUBJECT
   Example:
   /subjects/1/chapters/3
   ===================================================== */
router.get(
  "/subjects/:class_id/chapters/:subject_id",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  getChapters
);

/* =====================================================
   UPDATE SUBJECT NAME
   Example:
   PUT /subjects/3
   ===================================================== */
router.put(
  "/subjects/:subject_id",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  updateSubjectName
);

/* =====================================================
   DELETE SUBJECT
   Example:
   DELETE /subjects/3
   ===================================================== */
router.delete(
  "/subjects/:subject_id",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  deleteSubject
);

/* =====================================================
   ADD CHAPTERS TO SUBJECT
   Example:
   POST /subjects/3/chapters
   ===================================================== */
router.post(
  "/subjects/:subject_id/chapters",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  addChaptersToSubject
);

/* =====================================================
   UPDATE CHAPTER
   Example:
   PUT /chapters/10
   ===================================================== */
router.put(
  "/chapters/:chapter_id",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  updateChapter
);

/* =====================================================
   DELETE CHAPTER
   Example:
   DELETE /chapters/10
   ===================================================== */
router.delete(
  "/chapters/:chapter_id",
  // authMiddleware,
  // requirePermission("MANAGE_SCHOOL"),
  deleteChapter
);

export default router;