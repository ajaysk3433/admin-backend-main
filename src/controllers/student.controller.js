import bcrypt from "bcrypt";
import sequelize from "../config/db.js";
import fs from "fs";

import User from "../models/user.model.js";
import AdminRole from "../models/admin_role.model.js";
import StudentProfile from "../models/student_profile.model.js";
import ParentProfile from "../models/parent_profile.model.js";
import ParentStudentMap from "../models/parent_student_map.model.js";
import StudentClassSection from "../models/student_class_section.model.js";
import StudentAnalytics from "../models/student_analytics.model.js";
import AdminSchool from "../models/admin_school.model.js";

import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { parseExcel } from "../utils/excel.util.js";

// Valid ENUM values aligned with model definitions
const VALID_RELATIONS = ["father", "mother", "guardian"];
const VALID_GENDERS   = ["male", "female", "other"];

/* =====================================================
   CREATE STUDENT
   ===================================================== */
const createStudent = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;

  const {
    // Student user fields
    student_username,
    student_password,
    student_phone,
    student_email,
    student_full_name,

    // Parent user fields
    parent_username,
    parent_password,
    parent_phone,
    parent_email,
    parent_full_name,

    // Parent profile fields
    parent_name,
    relation,

    // Class assignment fields
    class_id,
    section_id,
    roll_number,
    academic_year,

    // Student profile fields
    preferred_language,
    onboarding_date,
    cost_limit,
    dob,
    gender,
    analytics_enabled,
  } = req.body;

  // Required field validation
  if (!student_username || !student_password || !parent_username || !parent_password) {
    throw new ApiError(400, "Required fields missing: student_username, student_password, parent_username, parent_password");
  }

  // ENUM validations
  if (relation && !VALID_RELATIONS.includes(relation)) {
    throw new ApiError(400, `Invalid relation. Must be one of: ${VALID_RELATIONS.join(", ")}`);
  }
  if (gender && !VALID_GENDERS.includes(gender)) {
    throw new ApiError(400, `Invalid gender. Must be one of: ${VALID_GENDERS.join(", ")}`);
  }

  const transaction = await sequelize.transaction();

  try {
    const [studentRole, parentRole] = await Promise.all([
      AdminRole.findOne({ where: { role_name: "STUDENT" }, transaction }),
      AdminRole.findOne({ where: { role_name: "PARENT"  }, transaction }),
    ]);

    console.log(studentRole, parentRole);
    

    if (!studentRole || !parentRole) {
      throw new ApiError(400, "Student or Parent role missing");
    }

    /* ================= Parent User ================= */
    const parentHashed = await bcrypt.hash(parent_password, 10);

    const parentUser = await User.create(
      {
        username:     parent_username,
        full_name:    parent_full_name  || null,
        password:     parentHashed,
        phone_number: parent_phone      || null,
        email:        parent_email      || null,
        role_id:      parentRole.role_id,
        school_id,
        status:       "Active",           // ← capital A per ENUM definition
      },
      { transaction }
    );

    const parent = await ParentProfile.create(
      {
        user_id:     parentUser.user_id,
        school_id,
        parent_name: parent_name || null,
        relation:    relation    || null,
        // status removed – field no longer exists on ParentProfile model
      },
      { transaction }
    );

    /* ================= Student User ================= */
    const studentHashed = await bcrypt.hash(student_password, 10);

    const studentUser = await User.create(
      {
        username:     student_username,
        full_name:    student_full_name  || null,
        password:     studentHashed,
        phone_number: student_phone      || null,
        email:        student_email      || null,
        role_id:      studentRole.role_id,
        school_id,
        status:       "Active",           // ← capital A per ENUM definition
      },
      { transaction }
    );

    const student = await StudentProfile.create(
      {
        user_id:            studentUser.user_id,
        school_id,
        preferred_language: preferred_language || null,
        onboarding_date:    onboarding_date    || null,
        cost_limit:         cost_limit         || null,
        dob:                dob                || null,
        gender:             gender             || null,
        analytics_enabled:  analytics_enabled  ?? false,
        // status removed – field no longer exists on StudentProfile model
      },
      { transaction }
    );

    /* ================= Mapping ================= */
    await ParentStudentMap.create(
      {
        parent_id:  parent.parent_id,
        student_id: student.student_id,
      },
      { transaction }
    );

    await StudentClassSection.create(
      {
        student_id:    student.student_id,
        class_id:      class_id      || null,
        section_id:    section_id    || null,
        roll_number:   roll_number   || null,
        academic_year: academic_year || null,
        status:        "active",
      },
      { transaction }
    );

    /* ================= School Count ================= */
    await AdminSchool.increment("student_count", {
      by: 1,
      where: { school_id },
      transaction,
    });

    await transaction.commit();

    return res
      .status(201)
      .json(new ApiResponse(201, student, "Student created successfully"));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

/* =====================================================
   BULK STUDENT UPLOAD (EXCEL)
   ===================================================== */
const bulkStudentUpload = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;
  const file      = req.file;

  if (!file) throw new ApiError(400, "Excel file required");

  const records = parseExcel(file.path);
  if (!records.length) throw new ApiError(400, "Excel file is empty");

  const transaction = await sequelize.transaction();

  try {
    const [studentRole, parentRole] = await Promise.all([
      AdminRole.findOne({ where: { role_name: "STUDENT" }, transaction }),
      AdminRole.findOne({ where: { role_name: "PARENT"  }, transaction }),
    ]);

    if (!studentRole || !parentRole) {
      throw new ApiError(400, "Student or Parent role missing");
    }

    let createdCount = 0;

    for (const [index, row] of records.entries()) {
      const rowLabel = `Row ${index + 2}`;

      // Required field validation per row
      if (!row.student_username || !row.student_password || !row.parent_username || !row.parent_password) {
        throw new ApiError(400, `${rowLabel}: Missing required fields (student_username, student_password, parent_username, parent_password)`);
      }

      // ENUM validations per row
      if (row.relation && !VALID_RELATIONS.includes(row.relation)) {
        throw new ApiError(400, `${rowLabel}: Invalid relation "${row.relation}". Must be one of: ${VALID_RELATIONS.join(", ")}`);
      }
      if (row.gender && !VALID_GENDERS.includes(row.gender)) {
        throw new ApiError(400, `${rowLabel}: Invalid gender "${row.gender}". Must be one of: ${VALID_GENDERS.join(", ")}`);
      }

      /* ---- Parent ---- */
      const parentHashed = await bcrypt.hash(String(row.parent_password), 10);

      const parentUser = await User.create(
        {
          username:     row.parent_username,
          full_name:    row.parent_full_name   || null,
          password:     parentHashed,
          phone_number: row.parent_phone       || null,
          email:        row.parent_email       || null,
          role_id:      parentRole.role_id,
          school_id,
          status:       "Active",               // ← capital A per ENUM definition
        },
        { transaction }
      );

      const parent = await ParentProfile.create(
        {
          user_id:     parentUser.user_id,
          school_id,
          parent_name: row.parent_name || null,
          relation:    row.relation    || null,
          // status removed – field no longer exists on ParentProfile model
        },
        { transaction }
      );

      /* ---- Student ---- */
      const studentHashed = await bcrypt.hash(String(row.student_password), 10);

      const studentUser = await User.create(
        {
          username:     row.student_username,
          full_name:    row.student_full_name  || null,
          password:     studentHashed,
          phone_number: row.student_phone      || null,
          email:        row.student_email      || null,
          role_id:      studentRole.role_id,
          school_id,
          status:       "Active",               // ← capital A per ENUM definition
        },
        { transaction }
      );

      const student = await StudentProfile.create(
        {
          user_id:            studentUser.user_id,
          school_id,
          preferred_language: row.preferred_language || null,
          onboarding_date:    row.onboarding_date    || null,
          cost_limit:         row.cost_limit         || null,
          dob:                row.dob                || null,
          gender:             row.gender             || null,
          analytics_enabled:  row.analytics_enabled  ?? false,
          // status removed – field no longer exists on StudentProfile model
        },
        { transaction }
      );

      await ParentStudentMap.create(
        {
          parent_id:  parent.parent_id,
          student_id: student.student_id,
        },
        { transaction }
      );

      await StudentClassSection.create(
        {
          student_id:    student.student_id,
          class_id:      row.class_id      || null,
          section_id:    row.section_id    || null,
          roll_number:   row.roll_number   || null,
          academic_year: row.academic_year || null,
          status:        "active",
        },
        { transaction }
      );

      createdCount++;
    }

    await AdminSchool.increment("student_count", {
      by: createdCount,
      where: { school_id },
      transaction,
    });

    await transaction.commit();
    fs.unlinkSync(file.path);

    return res
      .status(201)
      .json(new ApiResponse(201, { created: createdCount }, "Students uploaded successfully"));
  } catch (error) {
    await transaction.rollback();
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    throw error;
  }
});

/* =====================================================
   GET ALL STUDENTS
   ===================================================== */

const getAllStudents = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;

  const students = await StudentProfile.findAll({
    where: { school_id },
    include: [
      {
        model: User,
        as:         "user",
        attributes: [
          "user_id",
          "username",
          "full_name",
          "email",
          "phone_number",
          "status",
          "avatar",
        ],
      },
    ],
  });

  return res
    .status(200)
    .json(new ApiResponse(200, students));
});

/* =====================================================
   GET SINGLE STUDENT
   ===================================================== */
const getStudentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const student = await StudentProfile.findByPk(id, {
    include: [
      {
        model:      User,
        as:         "user",
        attributes: [
          "user_id",
          "username",
          "full_name",
          "email",
          "phone_number",
          "status",
          "avatar",
        ],
      },
      {
        model: StudentClassSection,
        as:    "classSection",
      },
    ],
  });

  if (!student) throw new ApiError(404, "Student not found");

  return res
    .status(200)
    .json(new ApiResponse(200, student));
});

/* =====================================================
   UPDATE STUDENT
   ===================================================== */
const updateStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const student = await StudentProfile.findByPk(id);
  if (!student) throw new ApiError(404, "Student not found");

  // Guard against updating fields that don't exist on StudentProfile
  const { status, ...allowedUpdates } = req.body;

  // Validate ENUM fields if provided
  if (allowedUpdates.gender && !VALID_GENDERS.includes(allowedUpdates.gender)) {
    throw new ApiError(400, `Invalid gender. Must be one of: ${VALID_GENDERS.join(", ")}`);
  }

  await student.update(allowedUpdates);

  return res
    .status(200)
    .json(new ApiResponse(200, student, "Student updated successfully"));
});

/* =====================================================
   DELETE STUDENT
   ===================================================== */
const deleteStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const transaction = await sequelize.transaction();

  try {
    const student = await StudentProfile.findByPk(id, { transaction });
    if (!student) throw new ApiError(404, "Student not found");

    const { school_id, user_id } = student;

    // Remove all dependent records first
    await StudentClassSection.destroy({ where: { student_id: id }, transaction });
    await ParentStudentMap.destroy(   { where: { student_id: id }, transaction });
    await StudentAnalytics.destroy(   { where: { student_id: id }, transaction });

    await student.destroy({ transaction });

    await User.destroy({ where: { user_id }, transaction });

    await AdminSchool.increment("student_count", {
      by: -1,
      where: { school_id },
      transaction,
    });

    await transaction.commit();

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Student deleted successfully"));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

export {
  createStudent,
  bulkStudentUpload,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
};