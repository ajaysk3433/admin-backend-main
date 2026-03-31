import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

export const uploadToS3 = async (file, type, language, board, className, subject, topic) => {
    const fileStream = fs.createReadStream(file.path);

    const key = `${type}/${board}/${language}/Class${className}/${subject}/${topic}-${Date.now()}.pdf`;

    const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: "schools2ai/"+key,
        Body: fileStream,
        ContentType: file.mimetype,
    });

    await s3.send(command);

    // Public URL (if bucket is public)


    return { key };
};

export const uploadAvatarToS3 = async (file, userId) => {
    const fileStream = fs.createReadStream(file.path);

    const key = `avatars/${userId}-${Date.now()}.${file.extension}`;

    const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: "schools2ai/"+key,
        Body: fileStream,
        ContentType: file.mimetype,
    });

    await s3.send(command);

    // Public URL (if bucket is public)


    return { key };
};
