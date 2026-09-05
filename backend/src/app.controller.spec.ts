import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CloudinaryService } from './media-storage/cloudinary.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { role: { findMany: jest.fn().mockResolvedValue([]) } } },
        { provide: CloudinaryService, useValue: { uploadKnowledgeImage: jest.fn() } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('returns the database status payload', async () => {
      await expect(appController.getHello()).resolves.toEqual({ message: 'DB connected', roles: [] });
    });
  });
});
