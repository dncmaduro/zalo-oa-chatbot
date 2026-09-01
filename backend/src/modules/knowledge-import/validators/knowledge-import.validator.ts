import { Injectable } from '@nestjs/common';
import {
  ParsedKnowledgeImage,
  ParsedKnowledgeItem,
  WorkbookParseResult,
} from '../types/knowledge-import.types';

export interface ImportValidationIssue {
  code: string;
  message: string;

  entityType?:
    | 'KNOWLEDGE_ITEM'
    | 'DOCUMENT_SECTION'
    | 'IMAGE'
    | 'WORKBOOK';

  entityKey?: string;

  sourceSheet?: string;
  sourceRow?: number;
}

export interface ImportValidationResult {
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
}

@Injectable()
export class KnowledgeImportValidator {
  validate(
    parsed: WorkbookParseResult,
  ): ImportValidationResult {
    const errors: ImportValidationIssue[] = [];
    const warnings: ImportValidationIssue[] = [];

    this.validateKnowledgeItems(
      parsed,
      errors,
      warnings,
    );

    this.validateDocumentSections(
      parsed,
      errors,
      warnings,
    );

    this.validateImages(
      parsed,
      errors,
      warnings,
    );

    this.validateImageReferences(
      parsed,
      errors,
      warnings,
    );

    return {
      errors,
      warnings,
    };
  }

  // ====================================================
  // KNOWLEDGE ITEMS
  // ====================================================

  private validateKnowledgeItems(
    parsed: WorkbookParseResult,
    errors: ImportValidationIssue[],
    warnings: ImportValidationIssue[],
  ) {
    const codes = new Set<string>();

    for (const item of parsed.knowledgeItems) {
      const key = item.knowledgeCode;

      if (codes.has(key)) {
        errors.push({
          code: 'DUPLICATE_KNOWLEDGE_CODE',
          message: `Duplicate knowledge_code: ${key}`,
          entityType: 'KNOWLEDGE_ITEM',
          entityKey: key,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        });
      }

      codes.add(key);

      if (!item.title) {
        this.requiredFieldError(
          errors,
          item,
          'title',
        );
      }

      if (!item.category) {
        this.requiredFieldError(
          errors,
          item,
          'category',
        );
      }

      if (!item.knowledgeContent) {
        this.requiredFieldError(
          errors,
          item,
          'knowledge_content',
        );
      }

      if (
        item.resolutionType === 'OPERATOR_TASK' &&
        !item.operatorTaskType
      ) {
        errors.push({
          code: 'OPERATOR_TASK_TYPE_REQUIRED',
          message:
            `${key} has resolution_type=OPERATOR_TASK ` +
            'but operator_task_type is empty',
          entityType: 'KNOWLEDGE_ITEM',
          entityKey: key,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        });
      }

      if (
        item.resolutionType === 'OPERATOR_TASK' &&
        !item.acknowledgementMessage
      ) {
        warnings.push({
          code: 'OPERATOR_ACKNOWLEDGEMENT_MISSING',
          message:
            `${key} is OPERATOR_TASK but ` +
            'acknowledgement_message is empty',
          entityType: 'KNOWLEDGE_ITEM',
          entityKey: key,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        });
      }

      if (
        item.resolutionType === 'HUMAN_CONTACT' &&
        !item.humanContactMessage
      ) {
        errors.push({
          code: 'HUMAN_CONTACT_MESSAGE_REQUIRED',
          message:
            `${key} has resolution_type=HUMAN_CONTACT ` +
            'but human_contact_message is empty',
          entityType: 'KNOWLEDGE_ITEM',
          entityKey: key,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        });
      }

      this.validateHasImages(
        item,
        errors,
      );

      if (
        item.status === 'NEEDS_REVIEW' &&
        !item.reviewNote
      ) {
        warnings.push({
          code: 'REVIEW_NOTE_MISSING',
          message:
            `${key} has status NEEDS_REVIEW ` +
            'but review_note is empty',
          entityType: 'KNOWLEDGE_ITEM',
          entityKey: key,
          sourceSheet: item.sourceSheet,
          sourceRow: item.sourceRow,
        });
      }
    }
  }

  // ====================================================
  // DOCUMENT SECTIONS
  // ====================================================

  private validateDocumentSections(
    parsed: WorkbookParseResult,
    errors: ImportValidationIssue[],
    warnings: ImportValidationIssue[],
  ) {
    const sectionKeys = new Set<string>();

    /**
     * Các section cùng document_code phải mô tả cùng
     * một document.
     */
    const documents = new Map<
      string,
      {
        title: string;
        category: string;
        audience: string;
      }
    >();

    for (const section of parsed.documentSections) {
      const key =
        `${section.documentCode}:${section.sectionCode}`;

      if (sectionKeys.has(key)) {
        errors.push({
          code: 'DUPLICATE_DOCUMENT_SECTION',
          message:
            `Duplicate document section: ${key}`,
          entityType: 'DOCUMENT_SECTION',
          entityKey: key,
          sourceSheet: section.sourceSheet,
          sourceRow: section.sourceRow,
        });
      }

      sectionKeys.add(key);

      if (!section.documentTitle) {
        errors.push({
          code: 'DOCUMENT_TITLE_REQUIRED',
          message:
            `${key} is missing document_title`,
          entityType: 'DOCUMENT_SECTION',
          entityKey: key,
          sourceSheet: section.sourceSheet,
          sourceRow: section.sourceRow,
        });
      }

      if (!section.sectionTitle) {
        errors.push({
          code: 'SECTION_TITLE_REQUIRED',
          message:
            `${key} is missing section_title`,
          entityType: 'DOCUMENT_SECTION',
          entityKey: key,
          sourceSheet: section.sourceSheet,
          sourceRow: section.sourceRow,
        });
      }

      if (!section.content) {
        errors.push({
          code: 'SECTION_CONTENT_REQUIRED',
          message:
            `${key} is missing content`,
          entityType: 'DOCUMENT_SECTION',
          entityKey: key,
          sourceSheet: section.sourceSheet,
          sourceRow: section.sourceRow,
        });
      }

      const existingDocument =
        documents.get(section.documentCode);

      if (!existingDocument) {
        documents.set(section.documentCode, {
          title: section.documentTitle,
          category: section.category,
          audience: section.audience,
        });
      } else {
        if (
          existingDocument.title !==
          section.documentTitle
        ) {
          errors.push({
            code: 'DOCUMENT_TITLE_INCONSISTENT',
            message:
              `document_code=${section.documentCode} ` +
              'has inconsistent document_title values',
            entityType: 'DOCUMENT_SECTION',
            entityKey: key,
            sourceSheet: section.sourceSheet,
            sourceRow: section.sourceRow,
          });
        }

        if (
          existingDocument.category !==
          section.category
        ) {
          warnings.push({
            code: 'DOCUMENT_CATEGORY_INCONSISTENT',
            message:
              `document_code=${section.documentCode} ` +
              'has inconsistent category values',
            entityType: 'DOCUMENT_SECTION',
            entityKey: key,
            sourceSheet: section.sourceSheet,
            sourceRow: section.sourceRow,
          });
        }

        if (
          existingDocument.audience !==
          section.audience
        ) {
          warnings.push({
            code: 'DOCUMENT_AUDIENCE_INCONSISTENT',
            message:
              `document_code=${section.documentCode} ` +
              'has inconsistent audience values',
            entityType: 'DOCUMENT_SECTION',
            entityKey: key,
            sourceSheet: section.sourceSheet,
            sourceRow: section.sourceRow,
          });
        }
      }

      if (
        section.hasImages &&
        section.imageIds.length === 0
      ) {
        errors.push({
          code: 'HAS_IMAGES_WITHOUT_IMAGE_IDS',
          message:
            `${key} has has_images=TRUE ` +
            'but image_ids is empty',
          entityType: 'DOCUMENT_SECTION',
          entityKey: key,
          sourceSheet: section.sourceSheet,
          sourceRow: section.sourceRow,
        });
      }

      if (
        !section.hasImages &&
        section.imageIds.length > 0
      ) {
        errors.push({
          code: 'IMAGE_IDS_WITH_HAS_IMAGES_FALSE',
          message:
            `${key} has image_ids but ` +
            'has_images is FALSE',
          entityType: 'DOCUMENT_SECTION',
          entityKey: key,
          sourceSheet: section.sourceSheet,
          sourceRow: section.sourceRow,
        });
      }
    }
  }

  // ====================================================
  // IMAGE RECORDS
  // ====================================================

  private validateImages(
    parsed: WorkbookParseResult,
    errors: ImportValidationIssue[],
    warnings: ImportValidationIssue[],
  ) {
    const ids = new Set<string>();

    for (const image of parsed.images) {
      if (ids.has(image.imageId)) {
        errors.push({
          code: 'DUPLICATE_IMAGE_ID',
          message:
            `Duplicate image_id: ${image.imageId}`,
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }

      ids.add(image.imageId);

      /**
       * READY nghĩa là ảnh phải thực sự tồn tại trong
       * workbook, không chỉ có metadata.
       */
      if (
        image.status === 'READY' &&
        !image.buffer
      ) {
        errors.push({
          code: 'EMBEDDED_IMAGE_MISSING',
          message:
            `${image.imageId} is READY but ` +
            'embedded image data could not be found',
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }

      if (
        !image.knowledgeCode &&
        !image.documentCode &&
        !image.sectionCode
      ) {
        const issue: ImportValidationIssue = {
          code: 'IMAGE_WITHOUT_TARGET',
          message:
            `${image.imageId} is not mapped to any ` +
            'knowledge item or document',
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        };

        if (image.status === 'READY') {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }

      if (
        image.sectionCode &&
        !image.documentCode
      ) {
        errors.push({
          code: 'SECTION_IMAGE_WITHOUT_DOCUMENT',
          message:
            `${image.imageId} has section_code ` +
            'but document_code is empty',
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }

      if (image.imageOrder < 0) {
        errors.push({
          code: 'INVALID_IMAGE_ORDER',
          message:
            `${image.imageId} has invalid image_order`,
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }

      if (
        image.status === 'NEEDS_REVIEW' &&
        !image.reviewNote
      ) {
        warnings.push({
          code: 'IMAGE_REVIEW_NOTE_MISSING',
          message:
            `${image.imageId} requires review but ` +
            'review_note is empty',
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }
    }
  }

  // ====================================================
  // CROSS REFERENCES
  // ====================================================

  private validateImageReferences(
    parsed: WorkbookParseResult,
    errors: ImportValidationIssue[],
    warnings: ImportValidationIssue[],
  ) {
    const imageMap = new Map<
      string,
      ParsedKnowledgeImage
    >(
      parsed.images.map((image) => [
        image.imageId,
        image,
      ]),
    );

    const knowledgeCodes = new Set(
      parsed.knowledgeItems.map(
        (item) => item.knowledgeCode,
      ),
    );

    const sectionKeys = new Set(
      parsed.documentSections.map(
        (section) =>
          `${section.documentCode}:${section.sectionCode}`,
      ),
    );

    const documentCodes = new Set(
      parsed.documentSections.map(
        (section) => section.documentCode,
      ),
    );

    // --------------------------------------------
    // KNOWLEDGE ITEM -> IMAGE
    // --------------------------------------------

    for (const item of parsed.knowledgeItems) {
      for (const imageId of item.imageIds) {
        const image = imageMap.get(imageId);

        if (!image) {
          errors.push({
            code: 'KNOWLEDGE_IMAGE_NOT_FOUND',
            message:
              `${item.knowledgeCode} references ` +
              `unknown image_id ${imageId}`,
            entityType: 'KNOWLEDGE_ITEM',
            entityKey: item.knowledgeCode,
            sourceSheet: item.sourceSheet,
            sourceRow: item.sourceRow,
          });

          continue;
        }

        /**
         * Không block import vì về sau một media có thể
         * được reuse, nhưng báo warning nếu metadata Excel
         * không khớp.
         */
        if (
          image.knowledgeCode &&
          image.knowledgeCode !==
            item.knowledgeCode
        ) {
          warnings.push({
            code: 'IMAGE_KNOWLEDGE_MAPPING_MISMATCH',
            message:
              `${imageId} is referenced by ` +
              `${item.knowledgeCode}, but KNOWLEDGE_IMAGES ` +
              `maps it to ${image.knowledgeCode}`,
            entityType: 'KNOWLEDGE_ITEM',
            entityKey: item.knowledgeCode,
            sourceSheet: item.sourceSheet,
            sourceRow: item.sourceRow,
          });
        }
      }
    }

    // --------------------------------------------
    // DOCUMENT SECTION -> IMAGE
    // --------------------------------------------

    for (const section of parsed.documentSections) {
      for (const imageId of section.imageIds) {
        const image = imageMap.get(imageId);

        if (!image) {
          errors.push({
            code: 'SECTION_IMAGE_NOT_FOUND',
            message:
              `${section.documentCode}:${section.sectionCode} ` +
              `references unknown image_id ${imageId}`,
            entityType: 'DOCUMENT_SECTION',
            entityKey:
              `${section.documentCode}:${section.sectionCode}`,
            sourceSheet: section.sourceSheet,
            sourceRow: section.sourceRow,
          });
        }
      }
    }

    // --------------------------------------------
    // IMAGE -> TARGET
    // --------------------------------------------

    for (const image of parsed.images) {
      if (
        image.knowledgeCode &&
        !knowledgeCodes.has(image.knowledgeCode)
      ) {
        errors.push({
          code: 'IMAGE_TARGET_KNOWLEDGE_NOT_FOUND',
          message:
            `${image.imageId} references unknown ` +
            `knowledge_code ${image.knowledgeCode}`,
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }

      if (
        image.documentCode &&
        !documentCodes.has(image.documentCode)
      ) {
        errors.push({
          code: 'IMAGE_TARGET_DOCUMENT_NOT_FOUND',
          message:
            `${image.imageId} references unknown ` +
            `document_code ${image.documentCode}`,
          entityType: 'IMAGE',
          entityKey: image.imageId,
          sourceSheet: image.sourceSheet,
          sourceRow: image.sourceRow,
        });
      }

      if (
        image.documentCode &&
        image.sectionCode
      ) {
        const sectionKey =
          `${image.documentCode}:${image.sectionCode}`;

        if (!sectionKeys.has(sectionKey)) {
          errors.push({
            code: 'IMAGE_TARGET_SECTION_NOT_FOUND',
            message:
              `${image.imageId} references unknown ` +
              `section ${sectionKey}`,
            entityType: 'IMAGE',
            entityKey: image.imageId,
            sourceSheet: image.sourceSheet,
            sourceRow: image.sourceRow,
          });
        }
      }
    }
  }

  // ====================================================
  // HELPERS
  // ====================================================

  private validateHasImages(
    item: ParsedKnowledgeItem,
    errors: ImportValidationIssue[],
  ) {
    if (
      item.hasImages &&
      item.imageIds.length === 0
    ) {
      errors.push({
        code: 'HAS_IMAGES_WITHOUT_IMAGE_IDS',
        message:
          `${item.knowledgeCode} has has_images=TRUE ` +
          'but image_ids is empty',
        entityType: 'KNOWLEDGE_ITEM',
        entityKey: item.knowledgeCode,
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
      });
    }

    if (
      !item.hasImages &&
      item.imageIds.length > 0
    ) {
      errors.push({
        code: 'IMAGE_IDS_WITH_HAS_IMAGES_FALSE',
        message:
          `${item.knowledgeCode} has image_ids ` +
          'but has_images is FALSE',
        entityType: 'KNOWLEDGE_ITEM',
        entityKey: item.knowledgeCode,
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
      });
    }
  }

  private requiredFieldError(
    errors: ImportValidationIssue[],
    item: ParsedKnowledgeItem,
    field: string,
  ) {
    errors.push({
      code: 'REQUIRED_FIELD_MISSING',
      message:
        `${item.knowledgeCode} is missing ${field}`,
      entityType: 'KNOWLEDGE_ITEM',
      entityKey: item.knowledgeCode,
      sourceSheet: item.sourceSheet,
      sourceRow: item.sourceRow,
    });
  }
}