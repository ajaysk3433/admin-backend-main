import bcrypt from "bcrypt";
import sequelize from "../config/db.js";
import fs from "fs";

import User from "../models/user.model.js";
import AdminRole from "../models/admin_role.model.js";          // ← was missing, caused runtime crash
import TeacherProfile from "../models/teacher_profile.model.js";
import TeacherClassSectionSubject from "../models/teacher_class_section_subject.model.js";
import TeacherAnalytics from "../models/teacher_analytics.model.js";
import AdminSchool from "../models/admin_school.model.js";

import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { parseExcel } from "../utils/excel.util.js";

/* =====================================================
   CREATE TEACHER
   ===================================================== */
const createTeacher = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;

  const {
    // User fields
    username,
    password,
    phone_number,
    email,
    full_name,

    // Teacher profile fields
    primary_subject_id,
    secondary_subject_ids,
    experience,
    age,
    onboarding_date,
    school_tenure,
    device_type,
    device_access,
    ppt_generation_enabled,
    cost_limit,
  } = req.body;

  if (!username || !password)
    throw new ApiError(400, "Username and password required");

  const transaction = await sequelize.transaction();

  try {
    const role = await AdminRole.findOne({
      where: { role_name: "TEACHER" },
      transaction,
    });

    if (!role) throw new ApiError(400, "Teacher role not found");

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create(
      {
        username,
        full_name:    full_name    || null,
        password:     hashed,
        phone_number: phone_number || null,
        email:        email        || null,
        role_id:      role.role_id,
        school_id,
        status:       "Active",     // capital A per ENUM("Active","Suspended","Blocked")
      },
      { transaction }
    );

    const teacher = await TeacherProfile.create(
      {
        user_id:               user.user_id,
        school_id,
        primary_subject_id:    primary_subject_id    || null,
        secondary_subject_ids: secondary_subject_ids || null,  // JSON field
        experience:            experience            || null,
        age:                   age                   || null,
        onboarding_date:       onboarding_date       || null,
        school_tenure:         school_tenure         || null,
        device_type:           device_type           || null,
        device_access:         device_access         || null,  // JSON field
        ppt_generation_enabled: ppt_generation_enabled ?? false,
        cost_limit:            cost_limit            || null,
        // No status field on TeacherProfile model
      },
      { transaction }
    );

    await AdminSchool.increment("teacher_count", {
      by: 1,
      where: { school_id },
      transaction,
    });

    await transaction.commit();

    return res
      .status(201)
      .json(new ApiResponse(201, teacher, "Teacher created successfully"));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

/* =====================================================
   BULK TEACHER UPLOAD
   ===================================================== */
const bulkTeacherUpload = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;
  const file      = req.file;

  if (!file) throw new ApiError(400, "Excel file required");

  const records = parseExcel(file.path);
  if (!records.length) throw new ApiError(400, "Excel file is empty");

  const transaction = await sequelize.transaction();

  try {
    const role = await AdminRole.findOne({
      where: { role_name: "TEACHER" },
      transaction,
    });

    if (!role) throw new ApiError(400, "Teacher role not found");

    let createdCount = 0;

    for (const [index, row] of records.entries()) {
      if (!row.username || !row.password) {
        throw new ApiError(400, `Row ${index + 2}: Missing username or password`);
      }

      const hashed = await bcrypt.hash(String(row.password), 10);

      const user = await User.create(
        {
          username:     row.username,
          full_name:    row.full_name    || null,
          password:     hashed,
          phone_number: row.phone_number || null,
          email:        row.email        || null,
          role_id:      role.role_id,
          school_id,
          status:       "Active",         // capital A per ENUM("Active","Suspended","Blocked")
        },
        { transaction }
      );

      await TeacherProfile.create(
        {
          user_id:               user.user_id,
          school_id,
          primary_subject_id:    row.primary_subject_id    || null,
          secondary_subject_ids: row.secondary_subject_ids || null,  // JSON field
          experience:            row.experience            || null,
          age:                   row.age                   || null,
          onboarding_date:       row.onboarding_date       || null,
          school_tenure:         row.school_tenure         || null,
          device_type:           row.device_type           || null,
          device_access:         row.device_access         || null,  // JSON field
          ppt_generation_enabled: row.ppt_generation_enabled ?? false,
          cost_limit:            row.cost_limit            || null,
          // No status field on TeacherProfile model
        },
        { transaction }
      );

      createdCount++;
    }

    await AdminSchool.increment("teacher_count", {
      by: createdCount,
      where: { school_id },
      transaction,
    });

    await transaction.commit();
    fs.unlinkSync(file.path);

    return res
      .status(201)
      .json(new ApiResponse(201, { created: createdCount }, "Teachers uploaded successfully"));
  } catch (error) {
    await transaction.rollback();
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);  // ← guard prevents double-throw
    throw error;
  }
});

/* =====================================================
   GET ALL TEACHERS
   ===================================================== */
const getAllTeachers = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;

  const teachers = await TeacherProfile.findAll({
    where: { school_id },
    include: [
      {
        model: User,
        as: "user",
        attributes: ["username", "full_name", "phone_number", "email", "status"],
      },
    ],
  });

  return res
    .status(200)
    .json(new ApiResponse(200, teachers, "Teachers fetched"));
});

/* =====================================================
   GET SINGLE TEACHER
   ===================================================== */
const getTeacherById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const teacher = await TeacherProfile.findByPk(id, {
    include: [
      {
        model: User,
        as: "user",
        attributes: ["username", "full_name", "phone_number", "email", "status"],
      },
    ],
  });

  if (!teacher) throw new ApiError(404, "Teacher not found");

  return res
    .status(200)
    .json(new ApiResponse(200, teacher));
});

/* =====================================================
   UPDATE TEACHER
   ===================================================== */
const updateTeacher = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const teacher = await TeacherProfile.findByPk(id);
  if (!teacher) throw new ApiError(404, "Teacher not found");

  // Strip immutable foreign keys — these must never be reassigned after creation
  const { user_id, school_id, ...allowedUpdates } = req.body;

  await teacher.update(allowedUpdates);

  return res
    .status(200)
    .json(new ApiResponse(200, teacher, "Teacher updated successfully"));
});

/* =====================================================
   DELETE TEACHER
   ===================================================== */
const deleteTeacher = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const transaction = await sequelize.transaction();

  try {
    const teacher = await TeacherProfile.findByPk(id, { transaction });
    if (!teacher) throw new ApiError(404, "Teacher not found");

    const { school_id, user_id } = teacher;

    // Remove all dependent records first
    await TeacherClassSectionSubject.destroy({ where: { teacher_id: id }, transaction });
    await TeacherAnalytics.destroy(          { where: { teacher_id: id }, transaction });

    await teacher.destroy({ transaction });

    await User.destroy({ where: { user_id }, transaction });

    await AdminSchool.increment("teacher_count", {
      by: -1,
      where: { school_id },
      transaction,
    });

    await transaction.commit();

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Teacher deleted successfully"));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

export {
  createTeacher,
  bulkTeacherUpload,
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
};