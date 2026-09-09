import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';
import { ZaloOaClientService } from './zalo-oa-client.service';
import { ZaloSignatureService } from './zalo-signature.service';
import { ZaloWebhookController } from './zalo-webhook.controller';
import { ZaloWebhookProcessorService } from './zalo-webhook-processor.service';
import { ZaloWebhookService } from './zalo-webhook.service';
@Module({ imports: [PrismaModule, ChatModule], controllers: [ZaloWebhookController], providers: [ZaloSignatureService, ZaloWebhookService, ZaloWebhookProcessorService, ZaloOaClientService] })
export class ZaloModule {}
