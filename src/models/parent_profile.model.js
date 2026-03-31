import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export default sequelize.define("ParentProfile", {
    parent_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: DataTypes.BIGINT,
    school_id: DataTypes.BIGINT,
    parent_name: DataTypes.STRING,
    relation: DataTypes.ENUM("father","mother","guardian"),
},{
    tableName: "parent_profiles",
    timestamps: false
});
