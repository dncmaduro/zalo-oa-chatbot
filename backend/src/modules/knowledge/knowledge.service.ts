import { Injectable } from '@nestjs/common';

import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { HybridKnowledgeRetrievalService } from './retrieval/hybrid-knowledge-retrieval.service';
import { KnowledgeRetrievalService } from './retrieval/knowledge-retrieval.service';
import { SemanticKnowledgeRetrievalService } from './retrieval/semantic-knowledge-retrieval.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly retrievalService: KnowledgeRetrievalService,
    private readonly semanticRetrievalService: SemanticKnowledgeRetrievalService,
    private readonly hybridRetrievalService: HybridKnowledgeRetrievalService,
  ) {}

  search(input: SearchKnowledgeDto) {
    return this.hybridRetrievalService.search(input);
  }

  searchSemantic(input: SearchKnowledgeDto) {
    return this.semanticRetrievalService.search(input);
  }
}
