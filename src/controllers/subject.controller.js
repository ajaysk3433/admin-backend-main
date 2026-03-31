import sequelize from "../config/db.js";
import AdminClass from "../models/admin_class.model.js";
import AdminSubject from "../models/admin_subject_master.model.js";
import AdminChapterMaster from "../models/admin_chapter_master.model.js";

/* =====================================================
   ADD SUBJECTS + CHAPTERS (class_id based)
===================================================== */
export const addSubjectsWithChapters = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { class_id, board, language, subjects } = req.body;

    if (!class_id || !board || !language || !subjects?.length) {
      return res.status(400).json({
        success: false,
        message: "class_id, board, language and subjects required"
      });
    }

    const classData = await AdminClass.findByPk(class_id);
    console.log("Class Data:", classData);
    

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: "Class not found"
      });
    }

    for (const subjectData of subjects) {
      const { subject_name, chapters } = subjectData;

      if (!subject_name || !chapters?.length) {
        throw new Error("Each subject must have subject_name and chapters");
      }

      // ✅ create or find subject
      let subject = await AdminSubject.findOne({
        where: { class_id, board, language, subject_name }
      });

      if (!subject) {
        subject = await AdminSubject.create(
          { class_id, board, language, subject_name },
          { transaction }
        );
      }

      // ✅ create chapters
      const chapterPayload = chapters.map((chapterName, index) => ({
        subject_id: subject.subject_id,
        class_id,
        board_name: board,
        language,
        chapter_name: chapterName,
        chapter_order: index + 1,
        status: "active"
      }));

      await AdminChapterMaster.bulkCreate(chapterPayload, { transaction });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Subjects and Chapters added successfully"
    });

  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   GET SUBJECTS (class + board + language)
===================================================== */
export const getSubjects = async (req, res) => {
  try {
    const { class_id, board, language } = req.query;

    const where = {};

    if (class_id) where.class_id = class_id;
    if (board) where.board = board;
    if (language) where.language = language;

    const subjects = await AdminSubject.findAll({ where });

    return res.status(200).json({
      success: true,
      data: subjects
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   GET CHAPTERS (class_id + subject_id)
===================================================== */
export const getChapters = async (req, res) => {
  try {
    const { class_id, subject_id } = req.params;

    const chapters = await AdminChapterMaster.findAll({
      where: {
        class_id,
        subject_id,
        status: "active"
      },
      order: [["chapter_order", "ASC"]]
    });

    return res.status(200).json({
      success: true,
      data: chapters
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   UPDATE SUBJECT
===================================================== */
export const updateSubjectName = async (req, res) => {
  try {
    const { subject_id } = req.params;
    const { subject_name } = req.body;

    if (!subject_name) {
      return res.status(400).json({
        success: false,
        message: "subject_name is required"
      });
    }

    const subject = await AdminSubject.findByPk(subject_id);

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found"
      });
    }

    subject.subject_name = subject_name;
    await subject.save();

    return res.status(200).json({
      success: true,
      message: "Subject updated successfully"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   DELETE SUBJECT
===================================================== */
export const deleteSubject = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { subject_id } = req.params;

    await AdminChapterMaster.destroy({
      where: { subject_id },
      transaction
    });

    await AdminSubject.destroy({
      where: { subject_id },
      transaction
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Subject deleted successfully"
    });

  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   ADD CHAPTERS
===================================================== */
export const addChaptersToSubject = async (req, res) => {
  try {
    const { subject_id } = req.params;
    const { class_id, board, language, chapters } = req.body;

    
    if (!chapters?.length) {
      return res.status(400).json({
        success: false,
        message: "chapters array required"
      });
    }

    const classData = await AdminClass.findByPk(class_id);

    if (!classData) {
      return res.status(404).json({
        success: false,
        message: "Class not found"
      });
    }

    const subject = await AdminSubject.findByPk(subject_id);

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found"
      });
    }

    const existingChapters = await AdminChapterMaster.findAll({
        where: { subject_id }
      });

      const existingNames = existingChapters.map(c => c.chapter_name);

    const payload = chapters
    .filter(name => !existingNames.includes(name))
    .map((name, index) => ({
      subject_id,
      class_id: subject.class_id,
      board_name: subject.board,
      language: subject.language,
      chapter_name: name.trim(),
      chapter_order: index + 1,
      status: "active"
    }));

    await AdminChapterMaster.bulkCreate(payload);

    return res.status(201).json({
      success: true,
      message: "Chapters added successfully"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   UPDATE CHAPTER
===================================================== */
export const updateChapter = async (req, res) => {
  try {
    const { chapter_id } = req.params;
    const { chapter_name } = req.body;

    const chapter = await AdminChapterMaster.findByPk(chapter_id);

    if (!chapter) {
      return res.status(404).json({
        success: false,
        message: "Chapter not found"
      });
    }

    chapter.chapter_name = chapter_name;
    await chapter.save();

    return res.status(200).json({
      success: true,
      message: "Chapter updated successfully"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* =====================================================
   DELETE CHAPTER
===================================================== */
export const deleteChapter = async (req, res) => {
  try {
    const { chapter_id } = req.params;

    const deleted = await AdminChapterMaster.destroy({
      where: { chapter_id }
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Chapter not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Chapter deleted successfully"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};