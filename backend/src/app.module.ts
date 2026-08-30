import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/primsa.module';
import { MediaStorageModule } from './media-storage/media-storage.module';

@Module({
  imports: [PrismaModule, MediaStorageModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
