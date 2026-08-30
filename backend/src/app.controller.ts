import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { CloudinaryService } from './media-storage/cloudinary.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Post('dev/cloudinary-test')
  async testCloudinary() {
    const result =
      await this.cloudinaryService.uploadKnowledgeImage(
        'tmp/test.png',
        'TEST_KNOWLEDGE',
        'IMG_0001',
      );

    return {
      publicId: result.public_id,
      secureUrl: result.secure_url,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    };
  }
}