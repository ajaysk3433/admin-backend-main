import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import fs from "fs";
import User from "../models/user.model.js";
import AdminSchool from "../models/admin_school.model.js";
import StudentProfile from "../models/student_profile.model.js";
import ParentProfile from "../models/parent_profile.model.js";
import TeacherProfile from "../models/teacher_profile.model.js";
import AdminRole from "../models/admin_role.model.js";
import AdminPermission from "../models/admin_permission.model.js";
import ParentStudentMap from "../models/parent_student_map.model.js";
import StudentClassSection from "../models/student_class_section.model.js";
import AdminClass from "../models/admin_class.model.js";
import AdminSection from "../models/admin_section.model.js";

import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadAvatarToS3 } from "../utils/s3Upload.js";
import { getSignedPdfUrl } from "../utils/signedUrl.js";

import {
  generateAccessToken,
  generateRefreshToken
} from "../utils/jwt.util.js";

import {
  generateOTP,
  createOtpToken,
  verifyOtpToken
} from "../utils/otp.util.js";

// Send OTP to phone number for login
const sendLoginOtp = asyncHandler(async (req, res) => {
    const { phone_number } = req.body;

    if (!phone_number)
      throw new ApiError(400, "Phone number required");

    const user = await User.findOne({ where: { phone_number } });
    if (!user) throw new ApiError(404, "User not found");

    const otp = generateOTP();
    const otpToken = createOtpToken(phone_number, otp);

    console.log("OTP (DEV ONLY):", otp);

    return res.status(200).json(
      new ApiResponse(200, { otpToken }, "OTP sent successfully")
    );
});

// Login controller supporting both password and OTP login
const login = asyncHandler(async (req, res) => {
  const {
    username,
    email,
    password,
    phone_number,
    otp,
    otpToken
  } = req.body;

  let user;

  /* PASSWORD LOGIN */
  if ((username || email) && password) {
    user = await User.findOne({
      where: username ? { username } : { email }
    });

    if (!user) throw new ApiError(404, "User not found");

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new ApiError(401, "Invalid credentials");
  }

  /* OTP LOGIN */
  else if (phone_number && otp && otpToken) {
    verifyOtpToken(phone_number, otp, otpToken);

    user = await User.findOne({ where: { phone_number } });
    if (!user) throw new ApiError(404, "User not found");
  }

  else {
    throw new ApiError(400, "Invalid login payload");
  }

  if (user.status.toLowerCase() !== "active") {
  throw new ApiError(403, "User inactive");
}

  /* LOAD ROLE + PERMISSIONS */
  const userWithRole = await User.findOne({
    where: { user_id: user.user_id },
    attributes: { exclude: ["password"] },
    include: [
      {
        model: AdminRole,
        as: "role",
        include: [
          {
            model: AdminPermission,
            as: "permissions",
            attributes: ["permission_key"]
          }
        ]
      }
    ]
  });

  if (!userWithRole) throw new ApiError(404, "User not found");

  const permissions =
    userWithRole.role.permissions.map(p => p.permission_key);

  /* TOKEN PAYLOAD */
  const payload = {
    user_id: user.user_id,
    role: userWithRole.role.role_name,
    permissions,
    school_id: user.school_id
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        accessToken,
        role: payload.role,
        permissions,
        school_id: user.school_id,
        profile: userWithRole
      },
      "Login successful"
    )
  );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken;
  console.log("Cookies:", req.cookies);

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Refresh token missing");
  }

  console.log("Incoming token:", incomingRefreshToken);

  try {
    console.log("Hello ", incomingRefreshToken);
    
    // 1. Verify refresh token
    const decoded = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    console.log("Decoded token:", decoded.user_id);
    
    // 2. Find user
    const user = await User.findOne({
      where: { user_id: decoded.user_id }
    });

    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }

    // 3. (IMPORTANT) Check token matches DB (if you store it)
    // if (user.refresh_token !== incomingRefreshToken) {
    //   throw new ApiError(401, "Refresh token expired or reused");
    // }

    // 4. Create payload (same as login)
    const payload = {
      user_id: user.user_id,
      role: decoded.role,
      permissions: decoded.permissions,
      school_id: decoded.school_id
    };

    // 5. Generate new tokens (ROTATION 🔥)
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    // 6. Save new refresh token in DB (rotation)
    await User.update(
      { refresh_token: newRefreshToken },
      { where: { user_id: user.user_id } }
    );

    // 7. Set new refresh token cookie
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // 8. Send new access token
    return res.status(200).json(
      new ApiResponse(
        200,
        { accessToken: newAccessToken },
        "Access token refreshed"
      )
    );

  } catch (error) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }
});

// LOGOUT
const logout = asyncHandler(async (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict"
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Logout successful"));
});

// Get profile of logged in user
const getLoggedInUserProfile = asyncHandler(async (req, res) => {
  const { user_id, role, school_id } = req.user;

  let profileData = null;
  let school = null;

  // Admin and Subadmin
  if (["ADMIN", "SUBADMIN"].includes(role)) {

    const user = await User.findOne({
      where: { user_id },
      attributes: { exclude: ["password"] }
    });

    if (!user) throw new ApiError(404, "User not found");

    if (school_id) {
      school = await AdminSchool.findOne({
        where: { school_id }
      });
    }

    if (user.avatar !== null) {
      const avatarUrl = await getSignedPdfUrl(user?.avatar);

      profileData = {
        user,
        school,
        avatarUrl
      };
    } else {
      profileData = {
        user,
        school
      };
    }
  }

  // Teacher
  else if (role === "TEACHER") {

    const teacher = await TeacherProfile.findOne({
      where: { user_id }
    });

    if (!teacher)
      throw new ApiError(404, "Teacher profile not found");

    school = await AdminSchool.findOne({
      where: { school_id: teacher.school_id }
    });

    profileData = {
      teacher,
      school
    };
  }

  // STUDENT
  else if (role === "STUDENT") {

    const student = await StudentProfile.findOne({
      where: { user_id }
    });

    if (!student)
      throw new ApiError(404, "Student profile not found");


    const user = await User.findOne({
      where: { user_id },
      attributes: ["full_name", "email", "phone_number", "role_id"]
    });


    const roleData = await AdminRole.findOne({
      where: { role_id: user.role_id }
    });


    school = await AdminSchool.findOne({
      where: { school_id: student.school_id }
    });


    const classSection = await StudentClassSection.findOne({
      where: { student_id: student.student_id }
    });

    if (!classSection)
      throw new ApiError(404, "Student class mapping not found");


    const classData = await AdminClass.findOne({
      where: { class_id: classSection.class_id }
    });


    const sectionData = await AdminSection.findOne({
      where: { section_id: classSection.section_id }
    });

    const avatarUrl = await getSignedPdfUrl(user?.avatar);

    profileData = {
      school_name: school?.school_name,
      board: school?.board,

      address: `${school?.city}, ${school?.state}, ${school?.country}, ${school?.pincode}`,

      class: classData?.class_name,
      div: sectionData?.section_name,

      roll_number: classSection?.roll_number,

      Student_name: user?.full_name,
      number: user?.phone_number,
      email: user?.email,

      gender: student?.gender,
      dob: student?.dob,
      language: student?.preferred_language,
      joining_date: student?.onboarding_date,

      role: roleData?.role_name,
      avatar: avatarUrl
    };
  }

  // Parent
  else if (role === "PARENT") {

    const parent = await ParentProfile.findOne({
      where: { user_id }
    });

    if (!parent)
      throw new ApiError(404, "Parent profile not found");


    const mappings = await ParentStudentMap.findAll({
      where: { parent_id: parent.parent_id }
    });

    if (!mappings.length)
      throw new ApiError(404, "Student mapping not found");


    const studentIds = mappings.map(m => m.student_id);


    const students = await StudentProfile.findAll({
      where: { student_id: studentIds }
    });

    if (!students.length)
      throw new ApiError(404, "Linked students not found");


    school = await AdminSchool.findOne({
      where: { school_id: students[0].school_id }
    });


    profileData = {
      parent,
      students,
      school
    };
  }

  else {
    throw new ApiError(400, "Unsupported role");
  }


  return res.status(200).json(
    new ApiResponse(
      200,
      profileData,
      "Profile fetched successfully"
    )
  );
});

const updateAvatar = asyncHandler(async (req, res) => {
  const { user_id } = req.user;

  // 1. Check file
  if (!req.file) {
    throw new ApiError(400, "Avatar file is required");
  }

  // 2. Validate file type (IMPORTANT 🔥)
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(req.file.mimetype)) {
    throw new ApiError(400, "Only JPG, PNG, WEBP allowed");
  }

  // 3. Upload to S3
  const { key } = await uploadAvatarToS3(req.file, user_id);
  

  // 4. Save key in DB
  await User.update(
    { avatar: key },
    { where: { user_id } }
  );

  fs.unlinkSync(req.file.path);
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        avatar: key,
      },
      "Avatar updated successfully"
    )
  );
});

export {
  sendLoginOtp,
  login,
  refreshAccessToken,
  logout,
  getLoggedInUserProfile,
  updateAvatar
};

