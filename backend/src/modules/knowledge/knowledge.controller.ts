import { Body, Controller, Post } from '@nestjs/common';

import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('search')
  search(@Body() input: SearchKnowledgeDto) {
    return this.knowledgeService.search(input);
  }
}
