import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MediaStorageModule } from './media-storage/media-storage.module';
import { KnowledgeImportModule } from './modules/knowledge-import/knowledge-import.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { ChatModule } from './modules/chat/chat.module';
import { OperatorTaskModule } from './modules/operator-tasks/operator-task.module';
import { AuthModule } from './modules/auth/auth.module';
import { OperatorModule } from './modules/operators/operator.module';
import { HumanContactModule } from './modules/human-contacts/human-contact.module';
import { LocalAiWarmupModule } from './modules/local-ai-warmup/local-ai-warmup.module';
import { ZaloModule } from './modules/zalo/zalo.module';

@Module({
  imports: [
    PrismaModule,
    MediaStorageModule,
    KnowledgeImportModule,
    KnowledgeModule,
    EmbeddingModule,
    ChatModule,
    OperatorTaskModule,
    AuthModule,
    OperatorModule,
    HumanContactModule,
    LocalAiWarmupModule,
    ZaloModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
