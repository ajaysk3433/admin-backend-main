import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export default sequelize.define("StudentProfile", {
    student_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: DataTypes.BIGINT,
    school_id: DataTypes.BIGINT,
    preferred_language: DataTypes.STRING,
    onboarding_date: DataTypes.DATE,
    cost_limit: DataTypes.DECIMAL(10,2),
    dob: DataTypes.DATE,
    gender: DataTypes.ENUM("male","female","other"),
    analytics_enabled: DataTypes.BOOLEAN,
},{
    tableName: "student_profiles",
    underscored: true,
    timestamps: true
});
