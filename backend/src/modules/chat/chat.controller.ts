import { Body, Controller, Post } from '@nestjs/common';

import { ResolveChatDto } from './dto/resolve-chat.dto';
import { ChatResolveService } from './chat-resolve.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { CreateChatMessageDto, normalizeChatMessageInput } from './dto/create-chat-message.dto';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatResolveService: ChatResolveService,
    private readonly chatOrchestratorService: ChatOrchestratorService,
  ) {}

  @Post('resolve')
  resolve(@Body() input: ResolveChatDto) {
    return this.chatResolveService.resolve(input);
  }

  @Post('messages')
  createMessage(@Body() input: CreateChatMessageDto) {
    return this.chatOrchestratorService.handle(normalizeChatMessageInput(input));
  }
}
