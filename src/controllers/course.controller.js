import AdminClass from "../models/admin_class.model.js";
import AdminSection from "../models/admin_section.model.js";
import AdminSubject from "../models/admin_subject_master.model.js";
import AdminCourse from "../models/admin_course.model.js";
import AdminClassCourseMap from "../models/admin_class_course_map.model.js";
import AdminSchool from "../models/admin_school.model.js";
import sequelize from "../config/db.js";
import { Op } from "sequelize";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";


// CLASS CONTROLLERS

// Create Class
const createClass = asyncHandler(async (req, res) => {
    const { class_name } = req.body;

    if (!class_name)
        throw new ApiError(400, "Class name required");

    const newClass = await AdminClass.create({
        class_name
    });

    return res
        .status(201)
        .json(new ApiResponse(201, newClass, "Class created"));
});

// Create Multiple Classes (Bulk)
const bulkCreateClasses = asyncHandler(async (req, res) => {
  const { classes } = req.body;

  if (!classes || !Array.isArray(classes)) {
    throw new ApiError(400, "Classes array required");
  }

  // Example input: ["1", "2", "3"] OR ["Class 1", "Class 2"]

  const createdClasses = [];

  for (const className of classes) {

    // ❌ Prevent duplicate
    const exists = await AdminClass.findOne({
      where: { class_name: className }
    });

    if (exists) continue; // skip duplicate

    const newClass = await AdminClass.create({
      class_name: className
    });

    createdClasses.push(newClass);
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      createdClasses,
      "Classes created successfully"
    )
  );
});

// Get All Classes
const getAllClasses = asyncHandler(async (req, res) => {
  console.log("Starting the functions");

  const { school_id } = req.user;

  // 1. Get school
  const school = await AdminSchool.findOne({
    where: { school_id }
  });

  if (!school) {
    throw new ApiError(404, "School not found");
  }

  const classCount = school.class_count;
  console.log("class_count:", classCount);

  // 2. Fetch all classes
  const classes = await AdminClass.findAll({
    order: [["class_id", "ASC"]]
  });

  // 3. Filter based on class number (extract from name)
  const filteredClasses = classes.filter(cls => {
    const match = cls.class_name.match(/\d+/); // extract number from "Grade 6"
    if (!match) return false;

    const classNumber = parseInt(match[0]);
    return classNumber <= classCount;
  });

  console.log("Filtered classes:", filteredClasses);

  return res.status(200).json(
    new ApiResponse(200, filteredClasses, "Classes fetched")
  );
});

// Get Single Class
const getClassById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const classData = await AdminClass.findByPk(id);

    if (!classData)
        throw new ApiError(404, "Class not found");

    return res
        .status(200)
        .json(new ApiResponse(200, classData, "Class fetched"));
});

// Update Class
const updateClass = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const classData = await AdminClass.findByPk(id);

    if (!classData)
        throw new ApiError(404, "Class not found");

    await classData.update(req.body);

    return res
        .status(200)
        .json(new ApiResponse(200, classData, "Class updated"));
});

// Delete Class
const deleteClass = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const transaction = await sequelize.transaction();

    try {
        const classData = await AdminClass.findByPk(id, { transaction });

        if (!classData)
        throw new ApiError(404, "Class not found");

        // 1️⃣ Delete sections
        await AdminSection.destroy({
            where: { class_id: id },
            transaction
        });

        // 3️⃣ Delete class-course mappings
        await AdminClassCourseMap.destroy({
            where: { class_id: id },
            transaction
        });

        // 4️⃣ Delete class
        await classData.destroy({ transaction });

        await transaction.commit();

        return res.status(200).json(
        new ApiResponse(200, {}, "Class and related data deleted")
        );

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
});

/* =====================================================
   SECTION CONTROLLERS
   ===================================================== */

// Create Section
const createSection = asyncHandler(async (req, res) => {
  const { class_id, section_name } = req.body;
  const { school_id } = req.user;

  if (!class_id || !section_name)
    throw new ApiError(400, "Class and section name required");

  const section = await AdminSection.create({
    class_id,
    section_name,
    school_id   // ✅ IMPORTANT
  });

  return res
    .status(201)
    .json(new ApiResponse(201, section, "Section created"));
});

// bulk create sections for a class
const bulkCreateSections = asyncHandler(async (req, res) => {
  const { classes } = req.body;
  const { school_id } = req.user;

  if (!classes || !Array.isArray(classes)) {
    throw new ApiError(400, "Classes array required");
  }

  const transaction = await sequelize.transaction();

  try {
    const createdData = [];

    for (const classItem of classes) {
      const { class_id, sections } = classItem;

      if (!class_id || !sections) {
        throw new ApiError(400, "class_id and sections required");
      }

      // 🔍 Check class exists
      const classExists = await AdminClass.findByPk(class_id);
      if (!classExists) {
        throw new ApiError(404, `Class ${class_id} not found`);
      }

      const sectionRecords = [];

      for (const sectionName of sections) {

        // ❌ Prevent duplicate
        const exists = await AdminSection.findOne({
          where: { class_id, school_id, section_name: sectionName }
        });

        if (exists) continue; // skip duplicate

        const section = await AdminSection.create(
          {
            class_id,
            school_id,
            section_name: sectionName
          },
          { transaction }
        );

        sectionRecords.push(section);
      }

      createdData.push({
        class_id,
        sections: sectionRecords
      });
    }

    await transaction.commit();

    return res.status(201).json(
      new ApiResponse(
        201,
        createdData,
        "Sections created successfully"
      )
    );

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

// Get Sections by Class
const getSectionsByClass = asyncHandler(async (req, res) => {
  const { class_id } = req.params;
  const { school_id } = req.user;

  const sections = await AdminSection.findAll({
    where: { class_id, school_id }   // ✅ FILTER BY SCHOOL
  });

  return res
    .status(200)
    .json(new ApiResponse(200, sections, "Sections fetched"));
});

// Update Section
const updateSection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { school_id } = req.user;

  const section = await AdminSection.findOne({
    where: { section_id: id, school_id }   // ✅ prevent cross-school update
  });

  if (!section)
    throw new ApiError(404, "Section not found");

  await section.update(req.body);

  return res
    .status(200)
    .json(new ApiResponse(200, section, "Section updated"));
});

// Delete Section
const deleteSection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { school_id } = req.user;

  const section = await AdminSection.findOne({
    where: { section_id: id, school_id }   // ✅ secure delete
  });

  if (!section)
    throw new ApiError(404, "Section not found");

  await section.destroy();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Section deleted"));
});

/* =====================================================
   SUBJECT CONTROLLERS
   ===================================================== */

// Create Subject
const createSubject = asyncHandler(async (req, res) => {
  const { class_id, board, language, subject_name } = req.body;

  if (!class_id || !board || !language || !subject_name) {
    throw new ApiError(400, "All fields required");
  }

  // ❌ prevent duplicate
  const exists = await AdminSubject.findOne({
    where: { class_id, board, language, subject_name }
  });

  if (exists) {
    throw new ApiError(400, "Subject already exists");
  }

  const subject = await AdminSubject.create({
    class_id,
    board,
    language,
    subject_name
  });

  return res.status(201).json(
    new ApiResponse(201, subject, "Subject created")
  );
});

// Get All Subjects
const getAllSubjects = asyncHandler(async (req, res) => {
  const { class_id, board, language } = req.body;

  const where = {};

  if (class_id) where.class_id = class_id;
  if (board) where.board = board;
  if (language) where.language = language;

  const subjects = await AdminSubject.findAll({ where });

  return res.status(200).json(
    new ApiResponse(200, subjects, "Subjects fetched")
  );
});

// Update Subject
const updateSubject = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const subject = await AdminSubject.findByPk(id);

  if (!subject)
    throw new ApiError(404, "Subject not found");

  await subject.update(req.body);

  return res.status(200).json(
    new ApiResponse(200, subject, "Subject updated")
  );
});

// Delete Subject
const deleteSubject = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const subject = await AdminSubject.findByPk(id);

  if (!subject)
    throw new ApiError(404, "Subject not found");

  await subject.destroy();

  return res.status(200).json(
    new ApiResponse(200, {}, "Subject deleted")
  );
});

/* =====================================================
   COURSE CONTROLLERS
   ===================================================== */

// Create Course
const createCourse = asyncHandler(async (req, res) => {
  const { school_id } = req.user;
  const { course_name, course_type, language, ai_features } = req.body;

  if (!course_name)
    throw new ApiError(400, "Course name required");

  const course = await AdminCourse.create({
    school_id,
    course_name,
    course_type,
    language,
    ai_features,
    status: "active"
  });

  return res
    .status(201)
    .json(new ApiResponse(201, course, "Course created"));
});

// Get All Courses
const getAllCourses = asyncHandler(async (req, res) => {
  const { school_id } = req.user;

  const courses = await AdminCourse.findAll({
    where: { school_id }
  });

  return res
    .status(200)
    .json(new ApiResponse(200, courses, "Courses fetched"));
});

// Get Single Course
const getCourseById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const course = await AdminCourse.findByPk(id);

  if (!course)
    throw new ApiError(404, "Course not found");

  return res
    .status(200)
    .json(new ApiResponse(200, course, "Course fetched"));
});

// Update Course
const updateCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const course = await AdminCourse.findByPk(id);

  if (!course)
    throw new ApiError(404, "Course not found");

  await course.update(req.body);

  return res
    .status(200)
    .json(new ApiResponse(200, course, "Course updated"));
});

// Delete Course
const deleteCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const course = await AdminCourse.findByPk(id);

  if (!course)
    throw new ApiError(404, "Course not found");

  await course.destroy();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Course deleted"));
});

export {
  // class
    createClass,
    bulkCreateClasses,
    getAllClasses,
    getClassById,
    updateClass,
    deleteClass,

  // section
    createSection,
    bulkCreateSections,
    getSectionsByClass,
    updateSection,
    deleteSection,

  // subject
    createSubject,
    getAllSubjects,
    updateSubject,
    deleteSubject,

  // course
    createCourse,
    getAllCourses,
    getCourseById,
    updateCourse,
    deleteCourse
};
