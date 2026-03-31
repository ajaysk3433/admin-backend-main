import express from "express";
import {
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
} from "../controllers/admin.controller.js";

import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requirePermission } from "../middlewares/permission.middleware.js";

const router = express.Router();

/* SCHOOL */
router.put(
    "/school",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    updateSchool
);

/* PROFILE EDITING */
router.put(
    "/edit-profile",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    editProfile
);

/* ROLE MANAGEMENT */
router.get(
    "/roles",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    getAllRoles
);

router.post(
    "/roles",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    createRole
);

/* PERMISSIONS */
router.get(
    "/permissions",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    getAllPermissions
);

router.post(
    "/permissions",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    createPermission
);

/* ASSIGN PERMISSIONS */
router.post(
    "/roles/assign-permissions",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    assignPermissionsToRole
);

/* CHANGE USER ROLE */
router.put(
    "/users/change-role",
    authMiddleware,
    requirePermission("ASSIGN_ROLES"),
    changeUserRole
);

/* GET ROLES WITH PERMISSIONS */
router.get(
    "/roles-with-permissions",
    authMiddleware,
    requirePermission("MANAGE_ROLES"),
    getRolesWithPermissions
);

/* CHANGE USER STATUS */
router.put(
    "/users/change-status",
    authMiddleware,
    requirePermission("MANAGE_SCHOOL"),
    changeStatus
);

export default router;
