import 'dotenv/config';
import { Injectable } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  uploadKnowledgeImage(filePath: string, knowledgeCode: string, imageId: string): Promise<UploadApiResponse> {
    const baseFolder = process.env.CLOUDINARY_FOLDER;

    if (!baseFolder) {
      throw new Error('CLOUDINARY_FOLDER is not configured');
    }

    const publicId = `${baseFolder}/knowledge/${knowledgeCode}/${imageId}`;

    return cloudinary.uploader.upload(filePath, {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
    });
  }

  uploadKnowledgeImageBuffer(buffer: Buffer, knowledgeCode: string, imageId: string): Promise<UploadApiResponse> {
    const baseFolder = process.env.CLOUDINARY_FOLDER;

    if (!baseFolder) {
      throw new Error('CLOUDINARY_FOLDER is not configured');
    }

    const publicId = `${baseFolder}/knowledge/${knowledgeCode}/${imageId}`;

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          overwrite: true,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }

          if (!result) {
            reject(new Error('Cloudinary did not return an upload result'));
            return;
          }

          resolve(result);
        },
      );

      stream.end(buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
