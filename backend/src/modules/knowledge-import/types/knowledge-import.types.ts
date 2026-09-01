import { KnowledgeAudience, ResolutionType } from '../../../generated/prisma/client';
import type { ImportValidationIssue } from '../validators/knowledge-import.validator';

export type KnowledgeRowStatus = 'READY' | 'NEEDS_REVIEW' | 'DUPLICATE' | 'ARCHIVED';

export interface ParsedKnowledgeItem {
  knowledgeCode: string;
  title: string;
  category: string;
  subCategory?: string;

  audience: KnowledgeAudience;
  resolutionType: ResolutionType;

  userScenarios: string[];
  exampleQuestions: string[];
  keywords: string[];

  knowledgeContent: string;
  initialResponse?: string;

  requiredFields: string[];

  operatorTaskType?: string;
  operatorInstruction?: string;

  successResponseTemplate?: string;
  failureResponseTemplate?: string;
  acknowledgementMessage?: string;
  humanContactMessage?: string;

  sourceUrls: string[];

  imageIds: string[];
  hasImages: boolean;

  sourceSheet?: string;
  sourceRow?: number;

  status: KnowledgeRowStatus;
  reviewNote?: string;
}

export interface ParsedKnowledgeDocumentSection {
  documentCode: string;
  documentTitle: string;

  category: string;

  sectionCode: string;
  sectionTitle: string;

  audience: KnowledgeAudience;

  content: string;
  keywords: string[];

  sourceUrls: string[];

  imageIds: string[];
  hasImages: boolean;

  sourceSheet?: string;
  sourceRow?: number;

  status: KnowledgeRowStatus;
  reviewNote?: string;
}

export interface ParsedKnowledgeImage {
  imageId: string;

  knowledgeCode?: string;
  documentCode?: string;
  sectionCode?: string;

  imageOrder: number;

  description?: string;

  sourceSheet?: string;
  sourceAnchor?: string;
  sourceRow?: number;

  status: 'READY' | 'NEEDS_REVIEW';
  reviewNote?: string;

  extension?: string;
  mimeType?: string;

  /**
   * Không bao giờ trả field này thẳng qua HTTP.
   * Sau này dùng để upload Cloudinary.
   */
  buffer?: Buffer;
}

export interface ParsedReviewIssue {
  issueId: string;

  sourceSheet?: string;
  sourceRow?: number;

  knowledgeCode?: string;

  issueType: string;

  originalContent?: string;
  detectedProblem: string;
  suggestedAction?: string;

  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reviewStatus: string;
}

export interface WorkbookParseResult {
  knowledgeItems: ParsedKnowledgeItem[];
  documentSections: ParsedKnowledgeDocumentSection[];
  images: ParsedKnowledgeImage[];
  reviewIssues: ParsedReviewIssue[];

  warnings: string[];
}

export interface KnowledgeImportPreview {
  summary: {
    knowledgeItems: number;
    documents: number;
    documentSections: number;
    images: number;
    reviewIssues: number;
  };

  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];

  knowledgeItems: ParsedKnowledgeItem[];

  documentSections: ParsedKnowledgeDocumentSection[];

  images: Array<Omit<ParsedKnowledgeImage, 'buffer'>>;

  reviewIssues: ParsedReviewIssue[];
}
