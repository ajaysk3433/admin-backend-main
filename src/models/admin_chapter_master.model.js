import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const AdminChapterMaster = sequelize.define("AdminChapterMaster", {
  chapter_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  board_name: {
    type: DataTypes.STRING,
    allowNull: false
  },

  class_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: "admin_classes",
      key: "class_id"
    }
  },
  language: {
    type: DataTypes.STRING,
    allowNull: false
  },

  subject_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: "admin_subjects",
      key: "subject_id"
    }
  },

  chapter_name: {
    type: DataTypes.STRING,
    allowNull: false
  },

  chapter_order: {
    type: DataTypes.INTEGER
  },

  status: {
    type: DataTypes.ENUM("active","inactive"),
    defaultValue: "active"
  }

},{
  tableName: "admin_chapters_master",
  timestamps: false
});

export default AdminChapterMaster;