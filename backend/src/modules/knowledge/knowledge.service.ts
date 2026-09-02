import { Injectable } from '@nestjs/common';

import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { KnowledgeRetrievalService } from './retrieval/knowledge-retrieval.service';

@Injectable()
export class KnowledgeService {
  constructor(private readonly retrievalService: KnowledgeRetrievalService) {}

  search(input: SearchKnowledgeDto) {
    return this.retrievalService.search(input);
  }
}
