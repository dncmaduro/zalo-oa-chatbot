import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/primsa.module';
import { MediaStorageModule } from './media-storage/media-storage.module';
import { KnowledgeImportModule } from './modules/knowledge-import/knowledge-import.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [PrismaModule, MediaStorageModule, KnowledgeImportModule, KnowledgeModule, EmbeddingModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
