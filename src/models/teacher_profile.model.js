import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export default sequelize.define("TeacherProfile", {
    teacher_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: DataTypes.BIGINT,
    school_id: DataTypes.BIGINT,
    primary_subject_id: DataTypes.INTEGER,
    secondary_subject_ids: DataTypes.JSON,
    experience: DataTypes.INTEGER,
    age: DataTypes.INTEGER,
    onboarding_date: DataTypes.DATE,
    school_tenure: DataTypes.INTEGER,
    device_type: DataTypes.STRING,
    device_access: DataTypes.JSON,
    ppt_generation_enabled: DataTypes.BOOLEAN,
    cost_limit: DataTypes.DECIMAL(10,2)
},{
    tableName: "teacher_profiles",
    underscored: true,
    timestamps: true
});
