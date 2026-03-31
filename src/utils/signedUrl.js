import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

export const getSignedPdfUrl = async (key) => {
    if(key===null) return null;
    const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour

    return url;
};