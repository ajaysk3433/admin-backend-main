import { LLMFactory } from "../interface_imp/factory/LLMFactory.ts";
import type { Message } from "../interface/strategy/LLMStrategy.ts";
import { Op } from "sequelize";

import {
  assessmentRepo,
  questionRepo,
  assignmentRepo,
  attemptRepo,
  answerRepo,
  adminRepo,
  studentRepo,
} from "../repositories/assessment.repository.js";
import { ApiError } from "../utils/ApiError.js";

// ─── Inline types (derived from models, no separate types file) ───────────────

type Difficulty = "easy" | "medium" | "hard";
type AssessmentStatus = "draft" | "published" | "archived";
type QuestionType = "mcq" | "true_false" | "short" | "essay";

interface OptionItem {
  key: string;
  text: string;
}

interface AIQuestionRaw {
  question_text: string;
  question_type: QuestionType;
  options?: OptionItem[] | null;
  correct_answer?: string | null;
  hint?: string | null;
  marks?: number;
}

interface GenerateQuestionsParams {
  subject: string;
  topic: string;
  difficulty: Difficulty;
  count: number;
  types: QuestionType[];
}

interface AnswerInput {
  question_id: bigint;
  answer_text: string;
}

interface EnrichedAttempt {
  attempt_id: bigint;
  student_id: bigint;
  student_name: string;
  roll_number: string;
  class_name: string | null;
  section_name: string | null;
  score: number;
  total_marks: number;
  percentage: number;
  submitted_at: Date | null | undefined;
  status: string | undefined;
}

/* ─────────────────────────────────────────
   Helper: safely extract an array from any
   AI response shape
───────────────────────────────────────── */
function extractArray(raw: unknown): AIQuestionRaw[] {
  if (Array.isArray(raw)) return raw as AIQuestionRaw[];

  if (typeof raw !== "string")
    throw new Error(`AI returned non-string, non-array: ${typeof raw}`);

  const clean = raw.replace(/```json|```/gi, "").trim();

  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val)) return val as AIQuestionRaw[];
      }
    }
  } catch { /* fall through to regex */ }

  const match = clean.match(/\[[\s\S]*\]/);
  if (match) {
    const arr = JSON.parse(match[0]);
    if (Array.isArray(arr)) return arr;
  }

  throw new Error(`Could not extract array from AI response: ${clean.slice(0, 300)}`);
}

/* ─────────────────────────────────────────
   Helper: parse section_ids from DB
───────────────────────────────────────── */
export function parseSectionIds(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as unknown[]).map(Number);
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw).map(Number);
    } catch {
      return [];
    }
  }
  return [];
}

/* ─────────────────────────────────────────
   Helper: normalize options before DB storage
───────────────────────────────────────── */
export function normalizeOptions(raw: unknown): OptionItem[] | null {
  if (raw === null || raw === undefined) return null;

  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw[0] &&
    typeof raw[0] === "object" &&
    (raw[0] as OptionItem).key !== undefined
  ) {
    return raw as OptionItem[];
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && (parsed[0] as OptionItem)?.key !== undefined) return parsed;
      if (typeof parsed === "string") {
        const p2 = JSON.parse(parsed);
        if (Array.isArray(p2)) return p2;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  return raw as OptionItem[];
}

/* ─────────────────────────────────────────
   Helper: normalize options for response
───────────────────────────────────────── */
export function parseOptionsForResponse(raw: unknown): OptionItem[] | null {
  let opts = raw;

  if (typeof opts === "string") {
    try {
      opts = JSON.parse(opts);
    } catch {
      return null;
    }
    if (typeof opts === "string") {
      try {
        opts = JSON.parse(opts as string);
      } catch {
        return null;
      }
    }
  }

  if (
    Array.isArray(opts) &&
    opts.length > 8 &&
    typeof opts[0] === "string" &&
    (opts[0] as string).length <= 2
  ) {
    try {
      const recovered = JSON.parse((opts as string[]).join(""));
      if (Array.isArray(recovered) && (recovered[0] as OptionItem)?.key) return recovered;
      if (typeof recovered === "string") {
        const r2 = JSON.parse(recovered);
        if (Array.isArray(r2)) return r2;
      }
    } catch {
      return null;
    }
  }

  return (opts as OptionItem[]) ?? null;
}

/* ─────────────────────────────────────────
   Helper: get all student user_ids for a
   given class_id + array of section_ids
───────────────────────────────────────── */
export async function getStudentUserIdsForSections(
  classId: number,
  sectionIds: number[]
): Promise<bigint[]> {
  const classSections = await studentRepo.findClassSectionsByClassAndSections(classId, sectionIds);
  const studentIds = classSections.map((cs) => cs.student_id);
  if (!studentIds.length) return [];

  const profiles = await studentRepo.findProfilesByStudentIds(studentIds);
  return profiles
    .map((p) => p.user_id)
    .filter((id) => id !== null && id !== undefined)
    .map((id) => (typeof id === "bigint" ? id : BigInt(id)));
}

/* ─────────────────────────────────────────
   AI question generation
───────────────────────────────────────── */
export async function generateQuestionsAI(params: GenerateQuestionsParams): Promise<AIQuestionRaw[]> {
  const { subject, topic, difficulty, count, types } = params;
  const typeList = types.join(", ");

  const prompt = `
You are an exam question generator for school students.

Generate exactly ${count} questions on the topic below.
Return ONLY a valid JSON array — no markdown, no extra text, no wrapper object.

Each element:
{
  "question_text": "...",
  "question_type": "mcq",
  "options": [{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],
  "correct_answer": "A",
  "hint": "...",
  "marks": 1
}

Rules:
- question_type must be one of: ${typeList}
- mcq        → 4 options A-D, correct_answer = key letter
- true_false → options = [{"key":"T","text":"True"},{"key":"F","text":"False"}], correct_answer = "T" or "F"
- short/essay → options = null, correct_answer = brief model answer
- marks      → mcq/true_false = 1, short = 2, essay = 5
- difficulty → ${difficulty}
- subject    → ${subject}
- topic      → ${topic}
`;

  // ✅ Uses the same Factory + Strategy pattern as the chatbot
  const llm = LLMFactory.create("openai");
  const messages: Message[] = [
    {
      role: "system",
      content: "Output only a raw JSON array. No markdown, no wrapper object, no explanation.",
    },
    { role: "user", content: prompt },
  ];
  const raw = await llm.normalResponse(messages);
  console.log("[AI] OpenAI raw (first 300):", raw?.slice(0, 300));
  return extractArray(raw);
}

/* ═══════════════════════════════════════════════════
   createAssessment
═══════════════════════════════════════════════════ */
export const createAssessmentService = async (
  userId: number,
  schoolId: number,
  body: {
    title: string;
    subject_id: number;
    class_id: number;
    topic?: string;
    difficulty?: Difficulty;
    time_limit_minutes?: number;
    question_count?: number;
    question_types?: QuestionType[];
    start_datetime?: string;
    end_datetime?: string;
  }
) => {
  const {
    title,
    subject_id,
    class_id,
    topic,
    difficulty = "medium",
    time_limit_minutes,
    question_count = 10,
    question_types = ["mcq"],
    start_datetime,
    end_datetime,
  } = body;

  if (!title || !subject_id || !class_id)
    throw new ApiError(400, "title, subject_id and class_id are required");

  if (start_datetime && end_datetime) {
    const start = new Date(start_datetime);
    const end = new Date(end_datetime);
    const now = new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      throw new ApiError(400, "Invalid start_datetime or end_datetime format");
    if (start <= now) throw new ApiError(400, "start_datetime must be in the future");
    if (end <= start) throw new ApiError(400, "end_datetime must be after start_datetime");
  }

  const subjectRow = await adminRepo.findSubjectById(subject_id, class_id);
  if (!subjectRow) throw new ApiError(404, "Subject not found");

  const classRow = await adminRepo.findClassById(class_id);
  if (!classRow) throw new ApiError(404, "Class not found");

  const assessment = await assessmentRepo.create({
    school_id: schoolId,
    created_by: userId,
    title,
    subject_id,
    class_id,
    topic,
    difficulty,
    time_limit_minutes: time_limit_minutes ?? null,
    question_types_allowed: question_types,
    status: "draft",
    generated_by: "AI",
    start_datetime: start_datetime ? new Date(start_datetime) : null,
    end_datetime: end_datetime ? new Date(end_datetime) : null,
  });

  let aiQuestions: AIQuestionRaw[] = [];
  let aiFailed = false;

  try {
    aiQuestions = await generateQuestionsAI({
      subject: subjectRow.subject_name,
      topic: topic ?? title,
      difficulty,
      count: question_count,
      types: question_types,
    });
  } catch (err) {
    console.error("[createAssessment] AI failed:", (err as Error).message);
    aiFailed = true;
  }

  if (aiFailed) {
    return { assessment, questions: null, aiFailed: true, classRow };
  }

  const questionsToInsert = aiQuestions.map((q, idx) => ({
    assessment_id: assessment.assessment_id,
    question_text: q.question_text,
    question_type: q.question_type,
    options: normalizeOptions(q.options),
    correct_answer: q.correct_answer ?? null,
    hint: q.hint ?? null,
    marks: q.marks ?? 1,
    status: "pending" as const,
    order: idx + 1,
  }));

  await questionRepo.bulkCreate(questionsToInsert);

  const totalMarks = questionsToInsert.reduce((s, q) => s + q.marks, 0);
  await assessment.update({ total_marks: totalMarks });

  const questions = await questionRepo.findAll(
    { assessment_id: assessment.assessment_id },
    [["order", "ASC"]]
  );

  return { assessment, questions, aiFailed: false, classRow };
};

/* ═══════════════════════════════════════════════════
   deleteAssessment
═══════════════════════════════════════════════════ */
export const deleteAssessmentService = async (
  assessmentId: string,
  userId: bigint
) => {
  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");

  if (Number(assessment.created_by) !== Number(userId))
    throw new ApiError(403, "You can only delete your own assessments");

  const assignments = await assignmentRepo.findAll({ assessment_id: assessmentId });
  const assignmentIds = assignments.map((a) => a.assignment_id);

  if (assignmentIds.length) {
    const attemptCount = await attemptRepo.count({
      assignment_id: { [Op.in]: assignmentIds },
    });

    if (attemptCount > 0) {
      await assessment.update({ status: "archived" });
      return { archived: true, assessment_id: assessmentId };
    }
  }

  await questionRepo.destroy({ assessment_id: assessmentId });
  if (assignmentIds.length) {
    await assignmentRepo.destroy({ assessment_id: assessmentId });
  }
  await assessmentRepo.destroy(assessment);

  return { archived: false, assessment_id: assessmentId };
};

/* ═══════════════════════════════════════════════════
   getTeacherAssessments
═══════════════════════════════════════════════════ */
export const getTeacherAssessmentsService = async (
  userId: bigint,
  filters: { status?: string; class_id?: string; subject_id?: string }
) => {
  const where: Record<string, unknown> = { created_by: userId };
  if (filters.status) where.status = filters.status;
  if (filters.class_id) where.class_id = Number(filters.class_id);
  if (filters.subject_id) where.subject_id = Number(filters.subject_id);

  const assessments = await assessmentRepo.findAll(where);

  return Promise.all(
    assessments.map(async (a) => {
      const [total, pending, approved, assignmentCount, classRow, subjectRow] = await Promise.all([
        questionRepo.count({ assessment_id: a.assessment_id }),
        questionRepo.count({ assessment_id: a.assessment_id, status: "pending" }),
        questionRepo.count({ assessment_id: a.assessment_id, status: "approved" }),
        assignmentRepo.count({ assessment_id: a.assessment_id }),
        adminRepo.findClassById(a.class_id),
        adminRepo.findSubjectById(a.subject_id, a.class_id),
      ]);
      return {
        ...a.toJSON(),
        class_name: classRow?.class_name ?? null,
        subject_name: subjectRow?.subject_name ?? null,
        question_summary: { total, pending, approved },
        assignment_count: assignmentCount,
      };
    })
  );
};

/* ═══════════════════════════════════════════════════
   getAssessmentsByUser
═══════════════════════════════════════════════════ */
export const getAssessmentsByUserService = async (
  userId: bigint,
  role: string,
  filters: { status?: string; class_id?: string; subject_id?: string }
) => {
  const now = new Date();

  if (["TEACHER", "ADMIN", "SUBADMIN"].includes(role)) {
    const where: Record<string, unknown> = { created_by: userId };
    if (filters.status) where.status = filters.status;
    if (filters.class_id) where.class_id = Number(filters.class_id);
    if (filters.subject_id) where.subject_id = Number(filters.subject_id);

    const assessments = await assessmentRepo.findAll(where);

    return Promise.all(
      assessments.map(async (a) => {
        const [total, pending, approved, assignmentCount, classRow] = await Promise.all([
          questionRepo.count({ assessment_id: a.assessment_id }),
          questionRepo.count({ assessment_id: a.assessment_id, status: "pending" }),
          questionRepo.count({ assessment_id: a.assessment_id, status: "approved" }),
          assignmentRepo.count({ assessment_id: a.assessment_id }),
          adminRepo.findClassById(a.class_id),
        ]);
        return {
          ...a.toJSON(),
          class_name: classRow?.class_name ?? null,
          question_summary: { total, pending, approved },
          assignment_count: assignmentCount,
        };
      })
    );
  }

  if (role === "STUDENT") {
    const studentProfile = await studentRepo.findProfileByUserId(userId);
    if (!studentProfile) throw new ApiError(404, "Student profile not found");

    const classSection = await studentRepo.findClassSection({
      student_id: studentProfile.student_id,
    });
    if (!classSection) throw new ApiError(404, "Class not assigned to this student");

    const [classRow, sectionRow] = await Promise.all([
      adminRepo.findClassById(classSection.class_id!),
      adminRepo.findSectionById(classSection.section_id!),
    ]);

    const assignments = await assignmentRepo.findAll(
      { class_id: classSection.class_id },
      [["created_at", "DESC"]]
    );

    const studentSectionId = Number(classSection.section_id);
    const relevant = assignments.filter((a) =>
      parseSectionIds(a.section_ids).includes(studentSectionId)
    );

    return Promise.all(
      relevant.map(async (asgn) => {
        const assessment = await assessmentRepo.findById(asgn.assessment_id);
        if (!assessment) return null;

        const attempt = await attemptRepo.findOne({
          assignment_id: asgn.assignment_id,
          student_id: studentProfile.student_id,
        });

        let window_status = "upcoming";
        if (now >= new Date(asgn.start_datetime) && now <= new Date(asgn.end_datetime)) {
          window_status = "active";
        } else if (now > new Date(asgn.end_datetime)) {
          window_status = "expired";
        }

        let result_summary = null;
        if (attempt?.status === "submitted") {
          result_summary = {
            total_marks_obtained: attempt.total_marks_obtained,
            total_marks_possible: attempt.total_marks_possible,
            percentage: attempt.total_marks_possible
              ? Math.round(
                  ((attempt.total_marks_obtained ?? 0) / attempt.total_marks_possible) * 100
                )
              : 0,
          };
        }

        return {
          assignment_id: asgn.assignment_id,
          assessment_id: assessment.assessment_id,
          title: assessment.title,
          subject_id: assessment.subject_id,
          class_id: assessment.class_id,
          class_name: classRow?.class_name ?? null,
          section_name: sectionRow?.section_name ?? null,
          difficulty: assessment.difficulty,
          time_limit_minutes: assessment.time_limit_minutes,
          total_marks: assessment.total_marks,
          start_datetime: asgn.start_datetime,
          end_datetime: asgn.end_datetime,
          window_status,
          attempted: !!attempt,
          attempt_status: attempt?.status ?? null,
          attempt_id: attempt?.attempt_id ?? null,
          result_summary,
        };
      })
    ).then((list) => list.filter(Boolean));
  }

  throw new ApiError(403, "Role not supported for this endpoint");
};

/* ═══════════════════════════════════════════════════
   getAssessment (single)
═══════════════════════════════════════════════════ */
export const getAssessmentService = async (assessmentId: string) => {
  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");

  const [questions, classRow] = await Promise.all([
    questionRepo.findAll({ assessment_id: assessmentId }, [["order", "ASC"]]),
    adminRepo.findClassById(assessment.class_id),
  ]);

  return {
    assessment: { ...assessment.toJSON(), class_name: classRow?.class_name ?? null },
    questions,
  };
};

/* ═══════════════════════════════════════════════════
   reviewQuestion
═══════════════════════════════════════════════════ */
export const reviewQuestionService = async (
  questionId: string,
  body: {
    action: "approve" | "edit" | "delete" | "regenerate";
    question_text?: string;
    options?: OptionItem[];
    correct_answer?: string;
    hint?: string;
    marks?: number;
  }
) => {
  const { action, question_text, options, correct_answer, hint, marks } = body;

  const question = await questionRepo.findById(questionId);
  if (!question) throw new ApiError(404, "Question not found");

  if (action === "approve") {
    await question.update({ status: "approved" });
    return { action: "approve", question };
  }

  if (action === "delete") {
    const aid = question.assessment_id;
    await question.destroy();
    const remaining = await questionRepo.findAll({ assessment_id: aid });
    const total = remaining.reduce((s, q) => s + (q.marks ?? 0), 0);
    await assessmentRepo.updateTotalMarks(aid, total);
    return { action: "delete" };
  }

  if (action === "edit") {
    const updates: Record<string, unknown> = { status: "approved" };
    if (question_text !== undefined) updates.question_text = question_text;
    if (options !== undefined) updates.options = options;
    if (correct_answer !== undefined) updates.correct_answer = correct_answer;
    if (hint !== undefined) updates.hint = hint;
    if (marks !== undefined) updates.marks = marks;

    await question.update(updates);

    if (marks !== undefined) {
      const all = await questionRepo.findAll({ assessment_id: question.assessment_id });
      const total = all.reduce((s, q) => s + (q.marks ?? 0), 0);
      await assessmentRepo.updateTotalMarks(question.assessment_id, total);
    }
    return { action: "edit", question };
  }

  if (action === "regenerate") {
    const assessment = await assessmentRepo.findById(question.assessment_id);
    if (!assessment) throw new ApiError(404, "Assessment not found");

    const subjectRow = await adminRepo.findSubjectById(assessment.subject_id, assessment.class_id);
    if (!subjectRow) throw new ApiError(404, "Subject not found");

    const [newQ] = await generateQuestionsAI({
      subject: subjectRow.subject_name,
      topic: assessment.topic ?? assessment.title,
      difficulty: assessment.difficulty ?? "medium",
      count: 1,
      types: [question.question_type],
    });

    await question.update({
      question_text: newQ.question_text,
      options: newQ.options ?? null,
      correct_answer: newQ.correct_answer ?? null,
      hint: newQ.hint ?? null,
      marks: newQ.marks ?? question.marks,
      status: "pending",
    });

    return { action: "regenerate", question };
  }

  throw new ApiError(400, "Invalid action. Use: approve | edit | delete | regenerate");
};

/* ═══════════════════════════════════════════════════
   approveAllQuestions
═══════════════════════════════════════════════════ */
export const approveAllQuestionsService = async (assessmentId: string) => {
  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");

  const [updatedCount] = await questionRepo.bulkApprove(assessmentId);
  return updatedCount;
};

/* ═══════════════════════════════════════════════════
   addQuestion
═══════════════════════════════════════════════════ */
export const addQuestionService = async (
  assessmentId: string,
  body: {
    question_text: string;
    question_type: QuestionType;
    options?: OptionItem[] | null;
    correct_answer?: string | null;
    hint?: string | null;
    marks?: number;
  }
) => {
  const {
    question_text,
    question_type,
    options = null,
    correct_answer = null,
    hint = null,
    marks = 1,
  } = body;

  if (!question_text || !question_type)
    throw new ApiError(400, "question_text and question_type are required");

  const validTypes: QuestionType[] = ["mcq", "true_false", "short", "essay"];
  if (!validTypes.includes(question_type))
    throw new ApiError(400, `question_type must be one of: ${validTypes.join(", ")}`);

  if (["mcq", "true_false"].includes(question_type) && !correct_answer)
    throw new ApiError(400, "correct_answer is required for mcq and true_false");

  if (question_type === "mcq" && (!options || options.length < 2))
    throw new ApiError(400, "mcq requires at least 2 options [{key, text}]");

  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");

  const lastQuestion = await questionRepo.findLastByAssessment(assessmentId);
  const nextOrder = lastQuestion ? (lastQuestion.order ?? 0) + 1 : 1;

  const question = await questionRepo.create({
    assessment_id: assessmentId,
    question_text,
    question_type,
    options,
    correct_answer,
    hint,
    marks,
    status: "approved",
    order: nextOrder,
  });

  await assessmentRepo.incrementTotalMarks(assessmentId, marks);
  return question;
};

/* ═══════════════════════════════════════════════════
   publishAssessment
═══════════════════════════════════════════════════ */
export const publishAssessmentService = async (assessmentId: string) => {
  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");

  const [pendingCount, totalCount] = await Promise.all([
    questionRepo.count({ assessment_id: assessmentId, status: "pending" }),
    questionRepo.count({ assessment_id: assessmentId }),
  ]);

  if (totalCount === 0)
    throw new ApiError(400, "Cannot publish — assessment has no questions");
  if (pendingCount > 0)
    throw new ApiError(
      400,
      `${pendingCount} question(s) still pending. Approve or delete them first.`
    );

  await assessment.update({ status: "published" });
  return assessment;
};

/* ═══════════════════════════════════════════════════
   assignAssessment
═══════════════════════════════════════════════════ */
export const assignAssessmentService = async (
  userId: bigint,
  assessmentId: string,
  body: {
    class_id: number;
    section_ids: number[];
    start_datetime: string;
    end_datetime: string;
    shuffle_questions?: boolean;
    shuffle_options?: boolean;
    show_result_immediately?: boolean;
  }
) => {
  const {
    class_id,
    section_ids,
    start_datetime,
    end_datetime,
    shuffle_questions = false,
    shuffle_options = false,
    show_result_immediately = false,
  } = body;

  if (!class_id || !section_ids?.length || !start_datetime || !end_datetime)
    throw new ApiError(400, "class_id, section_ids, start_datetime and end_datetime are required");

  const start = new Date(start_datetime);
  const end = new Date(end_datetime);
  const now = new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime()))
    throw new ApiError(400, "Invalid start_datetime or end_datetime format");
  if (start <= now) throw new ApiError(400, "start_datetime must be in the future");
  if (end <= start) throw new ApiError(400, "end_datetime must be after start_datetime");

  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");
  if (assessment.status !== "published")
    throw new ApiError(400, "Publish the assessment before assigning");

  const normalizedSectionIds = section_ids.map(Number);

  const [classRow, sectionRows] = await Promise.all([
    adminRepo.findClassById(class_id),
    adminRepo.findSectionsByIds(normalizedSectionIds),
  ]);

  const assignment = await assignmentRepo.create({
    assessment_id: assessmentId,
    class_id,
    section_ids: normalizedSectionIds,
    start_datetime,
    end_datetime,
    shuffle_questions,
    shuffle_options,
    show_result_immediately,
    assigned_by: userId,
  });

  return {
    assignment,
    class_name: classRow?.class_name ?? null,
    section_names: sectionRows.map((s) => ({
      section_id: s.id,
      section_name: s.section_name,
    })),
  };
};

/* ═══════════════════════════════════════════════════
   getStudentAssignedTests
═══════════════════════════════════════════════════ */
export const getStudentAssignedTestsService = async (userId: bigint) => {
  const now = new Date();

  const studentProfile = await studentRepo.findProfileByUserId(userId);
  if (!studentProfile) throw new ApiError(404, "Student profile not found");

  const classSection = await studentRepo.findClassSection({
    student_id: studentProfile.student_id,
  });
  if (!classSection) throw new ApiError(404, "Class not assigned to this student");

  const [classRow, sectionRow] = await Promise.all([
    adminRepo.findClassById(classSection.class_id!),
    adminRepo.findSectionById(classSection.section_id!),
  ]);

  console.log(
    "[getStudentAssignedTests] student:",
    studentProfile.student_id,
    "class_id:",
    classSection.class_id,
    "section_id:",
    classSection.section_id
  );

  const assignments = await assignmentRepo.findAll(
    { class_id: classSection.class_id },
    [["start_datetime", "DESC"]]
  );

  console.log("[getStudentAssignedTests] raw assignments found:", assignments.length);

  const studentSectionId = Number(classSection.section_id);

  const relevant = assignments.filter((a) => {
    const ids = parseSectionIds(a.section_ids);
    console.log(
      "[getStudentAssignedTests] assignment",
      a.assignment_id,
      "section_ids:",
      ids,
      "| student section:",
      studentSectionId,
      "| match:",
      ids.includes(studentSectionId)
    );
    return ids.includes(studentSectionId);
  });

  const data = await Promise.all(
    relevant.map(async (asgn) => {
      const assessment = await assessmentRepo.findById(asgn.assessment_id);
      if (!assessment) return null;

      const attempt = await attemptRepo.findOne({
        assignment_id: asgn.assignment_id,
        student_id: studentProfile.student_id,
      });

      let window_status = "upcoming";
      if (now >= new Date(asgn.start_datetime) && now <= new Date(asgn.end_datetime)) {
        window_status = "active";
      } else if (now > new Date(asgn.end_datetime)) {
        window_status = "expired";
      }

      let result_summary = null;
      if (
        attempt?.status === "submitted" &&
        (window_status === "expired" || asgn.show_result_immediately)
      ) {
        result_summary = {
          total_marks_obtained: attempt.total_marks_obtained,
          total_marks_possible: attempt.total_marks_possible,
          percentage: attempt.total_marks_possible
            ? Math.round(
                ((attempt.total_marks_obtained ?? 0) / attempt.total_marks_possible) * 100
              )
            : 0,
          submitted_at: attempt.submitted_at,
        };
      }

      return {
        assignment_id: asgn.assignment_id,
        assessment_id: assessment.assessment_id,
        title: assessment.title,
        class_id: classSection.class_id,
        class_name: classRow?.class_name ?? null,
        section_name: sectionRow?.section_name ?? null,
        time_limit_minutes: assessment.time_limit_minutes,
        total_marks: assessment.total_marks,
        start_datetime: asgn.start_datetime,
        end_datetime: asgn.end_datetime,
        window_status,
        attempted: !!attempt,
        attempt_status: attempt?.status ?? null,
        attempt_id: attempt?.attempt_id ?? null,
        result_summary,
      };
    })
  );

  return data.filter(Boolean);
};

/* ═══════════════════════════════════════════════════
   startAttempt
═══════════════════════════════════════════════════ */
export const startAttemptService = async (
  userId: bigint,
  assignmentId: bigint | string
): Promise<{ attempt: any; questions: any[] }> => {
  const studentProfile = await studentRepo.findProfileByUserId(userId);
  if (!studentProfile) throw new ApiError(404, "Student profile not found");

  const assignment = await assignmentRepo.findById(assignmentId);
  if (!assignment) throw new ApiError(404, "Assignment not found");

  const now = new Date();
  if (now < new Date(assignment.start_datetime))
    throw new ApiError(403, "Test has not started yet");
  if (now > new Date(assignment.end_datetime))
    throw new ApiError(403, "Test deadline has passed");

  let attempt = await attemptRepo.findOne({
    assignment_id: assignmentId,
    student_id: studentProfile.student_id,
    status: "in_progress",
  });

  if (!attempt) {
    const submitted = await attemptRepo.findOne({
      assignment_id: assignmentId,
      student_id: studentProfile.student_id,
      status: "submitted",
    });
    if (submitted) throw new ApiError(409, "You have already submitted this test");

    const assessment = await assessmentRepo.findById(assignment.assessment_id);
    if (!assessment) throw new ApiError(404, "Assessment not found");

    attempt = await attemptRepo.create({
      assignment_id: assignmentId,
      student_id: studentProfile.student_id,
      total_marks_possible: assessment.total_marks,
      status: "in_progress",
    });
  }

  let questions = await questionRepo.findAllExcludeAnswer({
    assessment_id: assignment.assessment_id,
    status: "approved",
  });

  if (assignment.shuffle_questions) questions = questions.sort(() => Math.random() - 0.5);

  const normalizedQuestions = questions.map((q) => {
    const json = q.toJSON ? q.toJSON() : { ...q };
    json.options = parseOptionsForResponse(json.options);
    if (assignment.shuffle_options && Array.isArray(json.options)) {
      json.options = [...json.options].sort(() => Math.random() - 0.5);
    }
    return json;
  });

  return { attempt, questions: normalizedQuestions };
};

/* ═══════════════════════════════════════════════════
   submitAttempt
═══════════════════════════════════════════════════ */
export const submitAttemptService = async (
  userId: bigint,
  body: {
    attempt_id: bigint | string;
    answers?: AnswerInput[];
    is_auto_submit?: boolean;
  }
) => {
  const { attempt_id, answers = [], is_auto_submit = false } = body;

  const studentProfile = await studentRepo.findProfileByUserId(userId);
  if (!studentProfile) throw new ApiError(404, "Student profile not found");

  const attempt = await attemptRepo.findById(attempt_id);
  if (!attempt) throw new ApiError(404, "Attempt not found");
  if (Number(attempt.student_id) !== Number(studentProfile.student_id))
    throw new ApiError(403, "Not your attempt");
  if (attempt.status === "submitted") throw new ApiError(409, "Already submitted");

  const questions = await questionRepo.findAll({
    question_id: answers.map((a) => a.question_id),
  });
  const qMap = Object.fromEntries(questions.map((q) => [String(q.question_id), q]));

  let totalObtained = 0;
  const answerRows = answers
    .map((a) => {
      const q = qMap[String(a.question_id)];
      if (!q) return null;

      let is_correct: boolean | null = null;
      let marks_obtained = 0;

      if (["mcq", "true_false"].includes(q.question_type)) {
        is_correct =
          a.answer_text?.trim().toUpperCase() === q.correct_answer?.trim().toUpperCase();
        marks_obtained = is_correct ? (q.marks ?? 0) : 0;
      } else if (q.question_type === "short") {
        is_correct =
          a.answer_text?.trim().toLowerCase() === q.correct_answer?.trim().toLowerCase();
        marks_obtained = is_correct ? (q.marks ?? 0) : 0;
      }

      totalObtained += marks_obtained;
      return {
        attempt_id,
        question_id: a.question_id,
        answer_text: a.answer_text,
        is_correct,
        marks_obtained,
      };
    })
    .filter(Boolean) as Array<{
    attempt_id: bigint | string;
    question_id: bigint;
    answer_text: string;
    is_correct: boolean | null;
    marks_obtained: number;
  }>;

  await answerRepo.bulkCreate(answerRows);
  await attempt.update({
    submitted_at: new Date(),
    is_auto_submitted: is_auto_submit,
    total_marks_obtained: totalObtained,
    status: "submitted",
  });

  const assignment = await assignmentRepo.findById(attempt.assignment_id);

  return { attempt, assignment, answerRows, totalObtained };
};

/* ═══════════════════════════════════════════════════
   getAttemptResult
═══════════════════════════════════════════════════ */
export const getAttemptResultService = async (
  attemptId: string,
  userId: bigint,
  role: string
) => {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) throw new ApiError(404, "Attempt not found");

  if (role === "STUDENT") {
    const studentProfile = await studentRepo.findProfileByUserId(userId);
    if (!studentProfile) throw new ApiError(404, "Student profile not found");
    if (Number(attempt.student_id) !== Number(studentProfile.student_id))
      throw new ApiError(403, "Access denied");

    const assignment = await assignmentRepo.findById(attempt.assignment_id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    if (!assignment.show_result_immediately && new Date() < new Date(assignment.end_datetime))
      throw new ApiError(403, "Results are not available until the test deadline");
  }

  const studentProfile = await studentRepo.findProfileByStudentId(attempt.student_id);
  const classSection = studentProfile
    ? await studentRepo.findClassSection({ student_id: attempt.student_id })
    : null;

  const [classRow, sectionRow] = await Promise.all([
    classSection ? adminRepo.findClassById(classSection.class_id!) : null,
    classSection ? adminRepo.findSectionById(classSection.section_id!) : null,
  ]);

  const answers = await answerRepo.findAll({ attempt_id: attemptId });

  const qIds = answers.map((a) => a.question_id).filter(Boolean);
  const questions = qIds.length
    ? await questionRepo.findAll({ question_id: qIds })
    : [];
  const qMap = Object.fromEntries(questions.map((q) => [String(q.question_id), q]));

  const enrichedAnswers = answers.map((a) => {
    const q = qMap[String(a.question_id)];
    const opts = parseOptionsForResponse(q?.options ?? null);
    return {
      ...a.toJSON(),
      question_text: q?.question_text ?? "",
      question_type: q?.question_type ?? "mcq",
      correct_answer: q?.correct_answer ?? "",
      options: opts,
    };
  });

  return {
    attempt: {
      ...attempt.toJSON(),
      percentage: attempt.total_marks_possible
        ? Math.round(
            ((attempt.total_marks_obtained ?? 0) / attempt.total_marks_possible) * 100
          )
        : 0,
    },
    student_info: {
      student_id: attempt.student_id,
      class_name: classRow?.class_name ?? null,
      section_name: sectionRow?.section_name ?? null,
    },
    answers: enrichedAnswers,
  };
};

/* ═══════════════════════════════════════════════════
   getAssignmentResults
═══════════════════════════════════════════════════ */
export const getAssignmentResultsService = async (assignmentId: string) => {
  const assignment = await assignmentRepo.findById(assignmentId);
  if (!assignment) throw new ApiError(404, "Assignment not found");

  const [attempts, classRow, assessment, sectionRows] = await Promise.all([
    attemptRepo.findAll(
      { assignment_id: assignmentId, status: "submitted" },
      [["submitted_at", "ASC"]]
    ),
    adminRepo.findClassById(assignment.class_id),
    assessmentRepo.findById(assignment.assessment_id),
    adminRepo.findSectionsByIds(parseSectionIds(assignment.section_ids)),
  ]);

  if (!assessment) throw new ApiError(404, "Assessment not found");

  const scores = attempts.map((a) => Number(a.total_marks_obtained ?? 0));
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;

  const enrichedAttempts = await Promise.all(
    attempts.map(async (a) => {
      const classSection = await studentRepo.findClassSection({ student_id: a.student_id });
      const [attemptClassRow, attemptSectionRow] = await Promise.all([
        classSection ? adminRepo.findClassById(classSection.class_id!) : null,
        classSection ? adminRepo.findSectionById(classSection.section_id!) : null,
      ]);
      return {
        ...a.toJSON(),
        percentage: assessment.total_marks
          ? Math.round((Number(a.total_marks_obtained ?? 0) / assessment.total_marks) * 100)
          : 0,
        class_name: attemptClassRow?.class_name ?? null,
        section_name: attemptSectionRow?.section_name ?? null,
      };
    })
  );

  return {
    assessment_title: assessment.title,
    class_name: classRow?.class_name ?? null,
    sections: sectionRows.map((s) => ({
      section_id: s.id,
      section_name: s.section_name,
    })),
    total_marks: assessment.total_marks,
    total_students: attempts.length,
    avg_score: Math.round(avg * 100) / 100,
    max_score: scores.length ? Math.max(...scores) : 0,
    min_score: scores.length ? Math.min(...scores) : 0,
    attempts: enrichedAttempts,
  };
};

/* ═══════════════════════════════════════════════════
   getAttemptQuestions
═══════════════════════════════════════════════════ */
export const getAttemptQuestionsService = async (
  attemptId: string,
  userId: bigint
): Promise<{ attempt_id: bigint | string; questions: Array<Record<string, unknown>> }> => {
  const studentProfile = await studentRepo.findProfileByUserId(userId);
  if (!studentProfile) throw new ApiError(404, "Student profile not found");

  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) throw new ApiError(404, "Attempt not found");
  if (Number(attempt.student_id) !== Number(studentProfile.student_id))
    throw new ApiError(403, "Access denied");

  const assignment = await assignmentRepo.findById(attempt.assignment_id);
  if (!assignment) throw new ApiError(404, "Assignment not found");

  const now = new Date();
  if (attempt.status !== "in_progress") throw new ApiError(403, "Attempt is not in progress");
  if (now > new Date(assignment.end_datetime))
    throw new ApiError(403, "Test deadline has passed");

  let questions = await questionRepo.findAllExcludeAnswer({
    assessment_id: assignment.assessment_id,
    status: "approved",
  });

  if (assignment.shuffle_questions) questions = questions.sort(() => Math.random() - 0.5);

  const normalizedQuestions: Array<Record<string, unknown>> = questions.map((q) => {
    const source = q.toJSON ? q.toJSON() : q;
    const json: Record<string, unknown> = { ...(source as object) };
    json.options = parseOptionsForResponse(json.options);
    if (assignment.shuffle_options && Array.isArray(json.options)) {
      json.options = [...json.options].sort(() => Math.random() - 0.5);
    }
    return json;
  });

  return { attempt_id: attempt.attempt_id, questions: normalizedQuestions };
};

/* ═══════════════════════════════════════════════════
   getAssessmentResults (all assignments)
═══════════════════════════════════════════════════ */
export const getAssessmentResultsService = async (assessmentId: string) => {
  const assessment = await assessmentRepo.findById(assessmentId);
  if (!assessment) throw new ApiError(404, "Assessment not found");

  const assignments = await assignmentRepo.findAll({ assessment_id: assessmentId });
  if (!assignments.length) {
    return {
      assessment_title: assessment.title,
      total_marks: assessment.total_marks,
      total_students: 0,
      avg_score: 0,
      max_score: 0,
      min_score: 0,
      attempts: [],
    };
  }

  const assignmentIds = assignments.map((a) => a.assignment_id);
  const attempts = await attemptRepo.findAll(
    { assignment_id: { [Op.in]: assignmentIds }, status: "submitted" },
    [["submitted_at", "ASC"]]
  );

  if (!attempts.length) {
    return {
      assessment_title: assessment.title,
      total_marks: assessment.total_marks,
      total_students: 0,
      avg_score: 0,
      max_score: 0,
      min_score: 0,
      attempts: [],
    };
  }

  const studentIds = [...new Set(attempts.map((a) => a.student_id))];

  const [profiles, classSections] = await Promise.all([
    studentRepo.findProfilesByStudentIds(studentIds),
    studentRepo.findClassSectionsByStudentIds(studentIds),
  ]);

  const profileByStudentId = Object.fromEntries(
    profiles.map((p) => [Number(p.student_id), p])
  );
  const classSectionByStudentId = Object.fromEntries(
    classSections.map((cs) => [Number(cs.student_id), cs])
  );

  const userIds = [...new Set(profiles.map((p) => p.user_id).filter(Boolean))];
  const classIds = [...new Set(classSections.map((cs) => cs.class_id).filter((id): id is number => id !== undefined))];
  const sectionIds = [...new Set(classSections.map((cs) => cs.section_id).filter((id): id is number => id !== undefined))];

  const [users, classRows, sectionRows] = await Promise.all([
    studentRepo.findUsersByIds(userIds),
    adminRepo.findClassesByIds(classIds),
    adminRepo.findSectionsByIdsMany(sectionIds),
  ]);

  const userByUserId = Object.fromEntries(users.map((u) => [Number(u.user_id), u]));
  const classById   = Object.fromEntries(classRows.map(  (c) => [Number(c.id), c]));
  const sectionById  = Object.fromEntries(sectionRows.map((s) => [Number(s.id), s]));

  const enrichedAttempts: EnrichedAttempt[] = attempts.map((a) => {
    const profile = profileByStudentId[Number(a.student_id)];
    const cs = classSectionByStudentId[Number(a.student_id)];
    const user = profile ? userByUserId[Number(profile.user_id)] : null;
    const classRow = cs ? classById[Number(cs.class_id)] : null;
    const sectionRow = cs ? sectionById[Number(cs.section_id)] : null;

    const score = Number(a.total_marks_obtained ?? 0);
    const totalMarks = Number(a.total_marks_possible ?? assessment.total_marks ?? 0);

    return {
      attempt_id: a.attempt_id,
      student_id: a.student_id,
      student_name: user?.full_name ?? `Student #${a.student_id}`,
      roll_number: (profile as { roll_number?: string | null } | undefined)?.roll_number ?? "—",
      class_name: classRow?.class_name ?? null,
      section_name: sectionRow?.section_name ?? null,
      score,
      total_marks: totalMarks,
      percentage: totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0,
      submitted_at: a.submitted_at,
      status: a.status,
    };
  });

  const scores = enrichedAttempts.map((a) => a.score);
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;

  return {
    assessment_title: assessment.title,
    total_marks: assessment.total_marks,
    total_students: enrichedAttempts.length,
    avg_score: Math.round(avg * 100) / 100,
    max_score: Math.max(...scores),
    min_score: Math.min(...scores),
    attempts: enrichedAttempts,
  };
};