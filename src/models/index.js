/* =====================================================
   IMPORT ALL MODELS
   Associations are wired here and re-exported.
   Sync logic lives in src/index.js — never here.
   ===================================================== */
import User                       from "./user.model.js";
import AdminSchool                from "./admin_school.model.js";

import StudentProfile             from "./student_profile.model.js";
import TeacherProfile             from "./teacher_profile.model.js";
import ParentProfile              from "./parent_profile.model.js";

import ParentStudentMap           from "./parent_student_map.model.js";
import StudentClassSection        from "./student_class_section.model.js";
import StudentAnalytics           from "./student_analytics.model.js";

import TeacherAnalytics           from "./teacher_analytics.model.js";
import TeacherClassSectionSubject from "./teacher_class_section_subject.model.js";

import AdminRole                  from "./admin_role.model.js";
import AdminPermission            from "./admin_permission.model.js";
import AdminRolePermission        from "./admin_role_permission.model.js";

import AdminClass                 from "./admin_class.model.js";
import AdminSection               from "./admin_section.model.js";
import AdminCourse                from "./admin_course.model.js";
import AdminClassCourseMap        from "./admin_class_course_map.model.js";

import AdminSubjectMaster         from "./admin_subject_master.model.js";


/* =====================================================
   USER ↔ ROLE  (RBAC)
   Define before User ↔ School so role_id FK is
   registered before other associations reference User.
   ===================================================== */
AdminRole.hasMany(User, { foreignKey: "role_id", as: "users" });
User.belongsTo(AdminRole, { foreignKey: "role_id", as: "role" });


/* =====================================================
   ROLE ↔ PERMISSIONS  (Many-to-Many)
   ===================================================== */
AdminRole.belongsToMany(AdminPermission, {
  through:    AdminRolePermission,
  foreignKey: "role_id",
  otherKey:   "permission_id",
  as:         "permissions",
});
AdminPermission.belongsToMany(AdminRole, {
  through:    AdminRolePermission,
  foreignKey: "permission_id",
  otherKey:   "role_id",
  as:         "roles",
});


/* =====================================================
   SCHOOL ↔ USER
   ===================================================== */
AdminSchool.hasMany(User, { foreignKey: "school_id", as: "users" });
User.belongsTo(AdminSchool, { foreignKey: "school_id", as: "school" });


/* =====================================================
   USER ↔ STUDENT PROFILE
   ===================================================== */
User.hasOne(StudentProfile, { foreignKey: "user_id", as: "student" });
StudentProfile.belongsTo(User, { foreignKey: "user_id", as: "user" });


/* =====================================================
   USER ↔ TEACHER PROFILE
   ===================================================== */
User.hasOne(TeacherProfile, { foreignKey: "user_id", as: "teacher" });
TeacherProfile.belongsTo(User, { foreignKey: "user_id", as: "user" });


/* =====================================================
   USER ↔ PARENT PROFILE
   ===================================================== */
User.hasOne(ParentProfile, { foreignKey: "user_id", as: "parent" });
ParentProfile.belongsTo(User, { foreignKey: "user_id", as: "user" });


/* =====================================================
   PARENT ↔ STUDENT  (Many-to-Many via ParentStudentMap)
   ===================================================== */
ParentProfile.belongsToMany(StudentProfile, {
  through:    ParentStudentMap,
  foreignKey: "parent_id",
  otherKey:   "student_id",
  as:         "students",
});
StudentProfile.belongsToMany(ParentProfile, {
  through:    ParentStudentMap,
  foreignKey: "student_id",
  otherKey:   "parent_id",
  as:         "parents",
});


/* =====================================================
   CLASS ↔ SECTION
   ===================================================== */
AdminClass.hasMany(AdminSection, { foreignKey: "class_id", as: "sections" });
AdminSection.belongsTo(AdminClass, { foreignKey: "class_id", as: "class" });


/* =====================================================
   CLASS ↔ COURSE  (Many-to-Many via AdminClassCourseMap)
   NOTE: AdminClassCourseMap only has class_id + course_id.
   The previous AdminSection ↔ AdminCourse through this
   table was wrong (section_id doesn't exist on the map)
   and has been removed.
   ===================================================== */
AdminClass.belongsToMany(AdminCourse, {
  through:    AdminClassCourseMap,
  foreignKey: "class_id",
  otherKey:   "course_id",
  as:         "courses",
});
AdminCourse.belongsToMany(AdminClass, {
  through:    AdminClassCourseMap,
  foreignKey: "course_id",
  otherKey:   "class_id",
  as:         "classes",
});


/* =====================================================
   COURSE ↔ SUBJECT MASTER
   ===================================================== */
AdminCourse.hasMany(AdminSubjectMaster, {
  foreignKey: "course_id",
  as:         "subjects",
});
AdminSubjectMaster.belongsTo(AdminCourse, {
  foreignKey: "course_id",
  as:         "course",
});


/* =====================================================
   STUDENT ↔ CLASS-SECTION
   ===================================================== */
StudentProfile.hasOne(StudentClassSection, {
  foreignKey: "student_id",
  as:         "classSection",
});
StudentClassSection.belongsTo(StudentProfile, {
  foreignKey: "student_id",
  as:         "student",
});
AdminClass.hasMany(StudentClassSection, {
  foreignKey: "class_id",
  as:         "studentAssignments",
});
StudentClassSection.belongsTo(AdminClass, {
  foreignKey: "class_id",
  as:         "class",
});
AdminSection.hasMany(StudentClassSection, {
  foreignKey: "section_id",
  as:         "studentAssignments",
});
StudentClassSection.belongsTo(AdminSection, {
  foreignKey: "section_id",
  as:         "section",
});


/* =====================================================
   STUDENT ANALYTICS
   ===================================================== */
StudentProfile.hasOne(StudentAnalytics, {
  foreignKey: "student_id",
  as:         "analytics",
});
StudentAnalytics.belongsTo(StudentProfile, {
  foreignKey: "student_id",
  as:         "student",
});


/* =====================================================
   TEACHER ↔ CLASS-SECTION-SUBJECT
   ===================================================== */
TeacherProfile.hasMany(TeacherClassSectionSubject, {
  foreignKey: "teacher_id",
  as:         "assignments",
});
TeacherClassSectionSubject.belongsTo(TeacherProfile, {
  foreignKey: "teacher_id",
  as:         "teacher",
});
AdminClass.hasMany(TeacherClassSectionSubject, {
  foreignKey: "class_id",
  as:         "teacherAssignments",
});
TeacherClassSectionSubject.belongsTo(AdminClass, {
  foreignKey: "class_id",
  as:         "class",
});
AdminSection.hasMany(TeacherClassSectionSubject, {
  foreignKey: "section_id",
  as:         "teacherAssignments",
});
TeacherClassSectionSubject.belongsTo(AdminSection, {
  foreignKey: "section_id",
  as:         "section",
});
AdminSubjectMaster.hasMany(TeacherClassSectionSubject, {
  foreignKey: "class_subject_id",
  as:         "teacherAssignments",
});
TeacherClassSectionSubject.belongsTo(AdminSubjectMaster, {
  foreignKey: "class_subject_id",
  as:         "subject",
});


/* =====================================================
   TEACHER ANALYTICS
   ===================================================== */
TeacherProfile.hasOne(TeacherAnalytics, {
  foreignKey: "teacher_id",
  as:         "analytics",
});
TeacherAnalytics.belongsTo(TeacherProfile, {
  foreignKey: "teacher_id",
  as:         "teacher",
});


/* =====================================================
   EXPORT ALL MODELS
   ===================================================== */
export {
  User,
  AdminSchool,

  StudentProfile,
  TeacherProfile,
  ParentProfile,

  ParentStudentMap,
  StudentClassSection,
  StudentAnalytics,

  TeacherAnalytics,
  TeacherClassSectionSubject,

  AdminRole,
  AdminPermission,
  AdminRolePermission,

  AdminClass,
  AdminSection,
  AdminCourse,
  AdminClassCourseMap,

  AdminSubjectMaster,
};