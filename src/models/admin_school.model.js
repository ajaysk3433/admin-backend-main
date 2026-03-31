import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export default sequelize.define("AdminSchool", {
    school_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field:"id"  },
    school_name: DataTypes.STRING,
    country: DataTypes.STRING,
    state: DataTypes.STRING,
    city: DataTypes.STRING,
    pincode: DataTypes.STRING,
    timezone: DataTypes.STRING,
    board: DataTypes.STRING,
    language_preference: DataTypes.STRING,
    cost: DataTypes.DECIMAL(10,2),
    student_count: DataTypes.INTEGER,
    teacher_count: DataTypes.INTEGER,
    class_count: DataTypes.INTEGER,
    onboard_date: DataTypes.DATE,
    status: DataTypes.ENUM("Active","Suspended","Trial","Archived"),
    website_enabled: DataTypes.BOOLEAN,
    allowed_domains: DataTypes.TEXT
},{
    tableName: "schools",
    timestamps: false
});
