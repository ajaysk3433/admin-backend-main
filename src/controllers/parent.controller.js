import bcrypt from "bcrypt";
import sequelize from "../config/db.js";

import User from "../models/user.model.js";
import AdminRole from "../models/admin_role.model.js";
import ParentProfile from "../models/parent_profile.model.js";
import ParentStudentMap from "../models/parent_student_map.model.js";

import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Valid ENUM values aligned with model definitions
const VALID_RELATIONS = ["father", "mother", "guardian"];

/* =====================================================
   CREATE PARENT
   ===================================================== */
const createParent = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;

  const {
    // User fields
    username,
    password,
    phone_number,
    email,
    full_name,

    // Parent profile fields
    parent_name,
    relation,
  } = req.body;

  // Required field validation
  if (!username || !password) {
    throw new ApiError(400, "Required fields missing: username, password");
  }

  // ENUM validation
  if (relation && !VALID_RELATIONS.includes(relation)) {
    throw new ApiError(
      400,
      `Invalid relation. Must be one of: ${VALID_RELATIONS.join(", ")}`
    );
  }

  const transaction = await sequelize.transaction();

  try {
    const parentRole = await AdminRole.findOne({
      where: { role_name: "PARENT" },
      transaction,
    });

    if (!parentRole) throw new ApiError(400, "Parent role not found");

    const hashed = await bcrypt.hash(password, 10);

    const parentUser = await User.create(
      {
        username,
        full_name:    full_name    || null,
        password:     hashed,
        phone_number: phone_number || null,
        email:        email        || null,
        role_id:      parentRole.role_id,
        school_id,
        status:       "Active",     // capital A per ENUM("Active","Suspended","Blocked")
      },
      { transaction }
    );

    const parent = await ParentProfile.create(
      {
        user_id:     parentUser.user_id,
        school_id,
        parent_name: parent_name || null,
        relation:    relation    || null,
        // No status field on ParentProfile model
      },
      { transaction }
    );

    await transaction.commit();

    return res
      .status(201)
      .json(new ApiResponse(201, parent, "Parent created successfully"));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

/* =====================================================
   GET ALL PARENTS
   ===================================================== */
const getAllParents = asyncHandler(async (req, res) => {
  const school_id = req.user.school_id;

  const parents = await ParentProfile.findAll({
    where: { school_id },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, parents));
});

/* =====================================================
   GET SINGLE PARENT
   ===================================================== */
const getParentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const parent = await ParentProfile.findByPk(id);
  if (!parent) throw new ApiError(404, "Parent not found");

  return res
    .status(200)
    .json(new ApiResponse(200, parent));
});

/* =====================================================
   UPDATE PARENT
   ===================================================== */
const updateParent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const parent = await ParentProfile.findByPk(id);
  if (!parent) throw new ApiError(404, "Parent not found");

  // Only allow fields that exist on ParentProfile
  // (user_id, school_id are immutable; status does not exist on this model)
  const { user_id, school_id, ...allowedUpdates } = req.body;

  // ENUM validation if relation is being updated
  if (allowedUpdates.relation && !VALID_RELATIONS.includes(allowedUpdates.relation)) {
    throw new ApiError(
      400,
      `Invalid relation. Must be one of: ${VALID_RELATIONS.join(", ")}`
    );
  }

  await parent.update(allowedUpdates);

  return res
    .status(200)
    .json(new ApiResponse(200, parent, "Parent updated successfully"));
});

/* =====================================================
   DELETE PARENT
   ===================================================== */
const deleteParent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const transaction = await sequelize.transaction();

  try {
    const parent = await ParentProfile.findByPk(id, { transaction });
    if (!parent) throw new ApiError(404, "Parent not found");

    const { user_id } = parent;

    // Remove dependent records first
    await ParentStudentMap.destroy({
      where: { parent_id: id },
      transaction,
    });

    await parent.destroy({ transaction });

    await User.destroy({
      where: { user_id },
      transaction,
    });

    await transaction.commit();

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Parent deleted successfully"));
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

export {
  createParent,
  getAllParents,
  getParentById,
  updateParent,
  deleteParent,
};