import { Body, Controller, Post } from '@nestjs/common';

import { ResolveChatDto } from './dto/resolve-chat.dto';
import { ChatResolveService } from './chat-resolve.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatResolveService: ChatResolveService) {}

  @Post('resolve')
  resolve(@Body() input: ResolveChatDto) {
    return this.chatResolveService.resolve(input);
  }
}
