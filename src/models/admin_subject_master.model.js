import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export default sequelize.define("AdminSubject", {
    subject_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },

    class_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },

    board: {
        type: DataTypes.STRING,
        allowNull: false
    },

    language: {
        type: DataTypes.STRING,
        allowNull: false
    },

    subject_name: {
        type: DataTypes.STRING,
        allowNull: false
    }

    },{
    tableName: "admin_subjects",
    timestamps: false,
});
