import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export default sequelize.define("TeacherClassSectionSubject", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    teacher_id: DataTypes.BIGINT,
    class_id: DataTypes.INTEGER,
    section_id: DataTypes.INTEGER,
    class_subject_id: DataTypes.INTEGER,
    academic_year: DataTypes.STRING
},{
    tableName: "teacher_class_section_subject",
    timestamps: false
});
