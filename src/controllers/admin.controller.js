import User from "../models/user.model.js";
import AdminSchool from "../models/admin_school.model.js";
import AdminRole from "../models/admin_role.model.js";
import AdminPermission from "../models/admin_permission.model.js";
import AdminRolePermission from "../models/admin_role_permission.model.js";
import StudentProfile from "../models/student_profile.model.js";
import ParentProfile from "../models/parent_profile.model.js";
import TeacherProfile from "../models/teacher_profile.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// UPDATE SCHOOL DETAILS
const updateSchool = asyncHandler(async (req, res) => {
    const { school_id } = req.user;
    const updates = req.body;

    const school = await AdminSchool.findOne({
        where: { school_id },
    });

    if (!school) throw new ApiError(404, "School not found");

    await school.update(updates);

    return res
        .status(200)
        .json(new ApiResponse(200, school, "School updated successfully"));
});

// GET ALL ROLES
const getAllRoles = asyncHandler(async (req, res) => {
    const roles = await AdminRole.findAll();

    return res
        .status(200)
        .json(new ApiResponse(200, roles, "Roles fetched successfully"));
});


// CREATE ROLE
const createRole = asyncHandler(async (req, res) => {
    const { role_name, description } = req.body;

    if (!role_name) throw new ApiError(400, "Role name is required");

    const role = await AdminRole.create({
        role_name,
        description,
    });

    return res
        .status(201)
        .json(new ApiResponse(201, role, "Role created successfully"));
});


// GET ALL PERMISSIONS
const getAllPermissions = asyncHandler(async (req, res) => {
    const permissions = await AdminPermission.findAll();

    return res
        .status(200)
        .json(
        new ApiResponse(200, permissions, "Permissions fetched successfully"),
        );
});


// CREATE PERMISSION
const createPermission = asyncHandler(async (req, res) => {
    const { permission_key, description } = req.body;

    if (!permission_key) throw new ApiError(400, "Permission key is required");

    const permission = await AdminPermission.create({
        permission_key,
        description,
    });

    return res
        .status(201)
        .json(new ApiResponse(201, permission, "Permission created successfully"));
});

// ASSIGN PERMISSIONS TO ROLE
const assignPermissionsToRole = asyncHandler(async (req, res) => {
    const { role_id, permission_ids } = req.body;

    if (!role_id || !permission_ids)
        throw new ApiError(400, "Role and permissions required");

    // Remove old permissions
    await AdminRolePermission.destroy({
        where: { role_id },
    });

    // Add new permissions
    const records = permission_ids.map((permission_id) => ({
        role_id,
        permission_id,
    }));

    await AdminRolePermission.bulkCreate(records);

    return res
        .status(200)
        .json(
        new ApiResponse(200, {}, "Permissions assigned to role successfully"),
        );
});

// CHANGE USER ROLE
const changeUserRole = asyncHandler(async (req, res) => {
    const { user_id, role_id } = req.body;

    if (!user_id || !role_id) throw new ApiError(400, "User and role required");

    const user = await User.findOne({
        where: { user_id },
    });

    if (!user) throw new ApiError(404, "User not found");

    user.role_id = role_id;
    await user.save();

    return res
        .status(200)
        .json(new ApiResponse(200, user, "User role updated successfully"));
});

// GET ROLES WITH PERMISSIONS
const getRolesWithPermissions = asyncHandler(async (req, res) => {
    const roles = await AdminRole.findAll({
        include: [
        {
            model: AdminPermission,
            as: "permissions",
            attributes: ["permission_id", "permission_key"]
        }
        ]
    });

    return res.status(200).json(
        new ApiResponse(
        200,
        roles,
        "Roles with permissions fetched successfully"
        )
    );
});

// Edit user profile
const editProfile = asyncHandler(async (req, res) => {
    const { role } = req.user;

    // 🔐 Only ADMIN / SUBADMIN allowed
    if (!["ADMIN", "SUBADMIN"].includes(role)) {
        throw new ApiError(403, "Access denied");
    }

    const { user_id, ...updates } = req.body;

    if (!user_id) {
        throw new ApiError(400, "user_id is required");
    }

    // 🔍 Get user
    const user = await User.findOne({ where: { user_id } });
    if (!user) throw new ApiError(404, "User not found");

    // 🔍 Get role from DB (IMPORTANT)
    const roleData = await AdminRole.findOne({
        where: { role_id: user.role_id }
    });

    const userRole = roleData?.role_name;

    let updatedData;

    // ✅ 1. Update USER TABLE (common fields)
    await user.update({
        full_name: updates.full_name ?? user.full_name,
        email: updates.email ?? user.email,
        phone_number: updates.phone_number ?? user.phone_number,
        status: updates.status ?? user.status
    });

    // 🔹 ADMIN / SUBADMIN → only user table
    if (["ADMIN", "SUBADMIN"].includes(userRole)) {
        updatedData = user;
    }

    // 🔹 STUDENT
    else if (userRole === "STUDENT") {
        const student = await StudentProfile.findOne({
        where: { user_id }
        });

        if (!student) throw new ApiError(404, "Student not found");

        await student.update({
            preferred_language: updates.preferred_language ?? student.preferred_language,
            dob: updates.dob ?? student.dob,
            gender: updates.gender ?? student.gender,
            analytics_enabled: updates.analytics_enabled ?? student.analytics_enabled,
            status: updates.profile_status ?? student.status
        });

        updatedData = student;
    }

    // 🔹 TEACHER
    else if (userRole === "TEACHER") {
        const teacher = await TeacherProfile.findOne({
        where: { user_id }
        });

        if (!teacher) throw new ApiError(404, "Teacher not found");

        await teacher.update({
        experience: updates.experience ?? teacher.experience,
        age: updates.age ?? teacher.age,
        device_type: updates.device_type ?? teacher.device_type,
        cost_limit: updates.cost_limit ?? teacher.cost_limit,
        status: updates.profile_status ?? teacher.status
        });

        updatedData = teacher;
    }

    // 🔹 PARENT
    else if (userRole === "PARENT") {
        const parent = await ParentProfile.findOne({
        where: { user_id }
        });

        if (!parent) throw new ApiError(404, "Parent not found");

        await parent.update({
        parent_name: updates.parent_name ?? parent.parent_name,
        relation: updates.relation ?? parent.relation,
        status: updates.profile_status ?? parent.status
        });

        updatedData = parent;
    }

    else {
        throw new ApiError(400, "Unsupported role");
    }

    return res.status(200).json(
        new ApiResponse(200, updatedData, "Profile updated successfully")
    );
});

const changeStatus = asyncHandler(async (req, res) => {
    const { role } = req.user;

    // 🔐 Only admin / subadmin
    if (!["ADMIN"].includes(role)) {
        throw new ApiError(403, "Access denied");
    }

    const { user_id, status } = req.body;

    if (!user_id || !status) {
        throw new ApiError(400, "user_id and status are required");
    }

    // 🔍 Find user
    const user = await User.findOne({ where: { user_id } });
    if (!user) throw new ApiError(404, "User not found");

    // 🔍 Get role from DB (IMPORTANT)
    const roleData = await AdminRole.findOne({
        where: { role_id: user.role_id }
    });

    const userRole = roleData?.role_name;

    // ✅ Update USER table
    await user.update({ status });

    // 🔹 STUDENT
    if (userRole === "STUDENT") {
        const student = await StudentProfile.findOne({ where: { user_id } });

        if (student) {
        await student.update({ status });
        }
    }

    // 🔹 TEACHER
    else if (userRole === "TEACHER") {
        const teacher = await TeacherProfile.findOne({ where: { user_id } });

        if (teacher) {
        await teacher.update({ status });
        }
    }

    // 🔹 PARENT
    else if (userRole === "PARENT") {
        const parent = await ParentProfile.findOne({ where: { user_id } });

        if (parent) {
        await parent.update({ status });
        }
    }

    // 🔹 ADMIN / SUBADMIN → only user table (already updated)

    return res.status(200).json(
        new ApiResponse(200, {}, "User status updated successfully")
    );
});

export {
    updateSchool,
    getAllRoles,
    createRole,
    editProfile,
    getAllPermissions,
    createPermission,
    assignPermissionsToRole,
    changeUserRole,
    getRolesWithPermissions,
    changeStatus
};
