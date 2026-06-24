import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SettingsService } from '../settings/settings.service';

export interface ExtractedLineItem {
  materialName: string;
  sku: string | null;
  quantity: number;
  unit: string | null;
  batchNumber: string | null;
}

export interface ExtractionResult {
  poNumber: string | null;
  supplier: string | null;
  deliveryDate: string | null; // ISO yyyy-mm-dd if found
  lineItems: ExtractedLineItem[];
}

export type ExtractionFailureReason = 'no_key' | 'invalid_key' | 'quota' | 'network' | 'parse' | 'unknown';

export class ExtractionError extends Error {
  constructor(
    public readonly reason: ExtractionFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const SUPPORTED_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// JSON Schema for the forced tool call — guarantees structured output.
const EXTRACT_TOOL = {
  name: 'record_purchase_order',
  description: 'Record the structured data extracted from the purchase order document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      poNumber: { type: ['string', 'null'], description: 'Purchase order number' },
      supplier: { type: ['string', 'null'], description: 'Supplier / vendor name' },
      deliveryDate: {
        type: ['string', 'null'],
        description: 'Delivery date in YYYY-MM-DD format if present, else null',
      },
      lineItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            materialName: { type: 'string', description: 'Material / product name' },
            sku: { type: ['string', 'null'], description: 'SKU / item code if present' },
            quantity: { type: 'integer', description: 'Number of physical units (bags/drums/etc.)' },
            unit: { type: ['string', 'null'], description: 'Unit of the packaging (Bag, Drum, KG, LTR, …)' },
            batchNumber: { type: ['string', 'null'], description: 'Batch / lot number if present' },
          },
          required: ['materialName', 'quantity'],
        },
      },
    },
    required: ['lineItems'],
  },
};

const INSTRUCTION = `Extract the purchase order data from this document. For each material line,
report the QUANTITY as the number of physical units that will arrive (e.g. "50 Bags" → quantity 50, unit "Bag").
If a field is not present, use null. Call the record_purchase_order tool with the structured result.`;

@Injectable()
export class AiExtractionService {
  private readonly logger = new Logger(AiExtractionService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  async extract(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
    const apiKey = await this.settings.getDecryptedKey();
    if (!apiKey) {
      throw new ExtractionError('no_key', 'No Claude API key configured in Settings.');
    }

    const client = new Anthropic({ apiKey });
    const model = this.config.get<string>('CLAUDE_MODEL') ?? 'claude-opus-4-8';
    const documentBlock = this.buildDocumentBlock(buffer, mimeType);

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        tools: [EXTRACT_TOOL as unknown as Anthropic.Tool],
        tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
        messages: [
          {
            role: 'user',
            content: [documentBlock, { type: 'text', text: INSTRUCTION }] as Anthropic.MessageParam['content'],
          },
        ],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new ExtractionError('parse', 'Claude did not return structured PO data.');
      }
      return this.normalize(toolUse.input as Record<string, unknown>);
    } catch (err) {
      if (err instanceof ExtractionError) throw err;
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError
      ) {
        throw new ExtractionError('invalid_key', 'Stored Claude API key is invalid or lacks access.');
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ExtractionError('quota', 'Claude API is rate-limited or out of quota.');
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new ExtractionError('network', 'Could not reach the Claude API.');
      }
      this.logger.error(`Extraction failed: ${(err as Error).message}`);
      throw new ExtractionError('unknown', (err as Error).message);
    }
  }

  private buildDocumentBlock(buffer: Buffer, mimeType: string): unknown {
    const data = buffer.toString('base64');
    if (mimeType === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
    }
    if (SUPPORTED_IMAGE.includes(mimeType)) {
      return { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
    }
    // Unknown type — try as PDF (common for scans mislabeled octet-stream).
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }

  private normalize(input: Record<string, unknown>): ExtractionResult {
    const rawItems = Array.isArray(input.lineItems) ? input.lineItems : [];
    const lineItems: ExtractedLineItem[] = rawItems
      .map((it) => {
        const o = it as Record<string, unknown>;
        const quantity = Number(o.quantity);
        return {
          materialName: String(o.materialName ?? '').trim(),
          sku: o.sku ? String(o.sku).trim() : null,
          quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
          unit: o.unit ? String(o.unit).trim() : null,
          batchNumber: o.batchNumber ? String(o.batchNumber).trim() : null,
        };
      })
      .filter((it) => it.materialName.length > 0);

    return {
      poNumber: input.poNumber ? String(input.poNumber).trim() : null,
      supplier: input.supplier ? String(input.supplier).trim() : null,
      deliveryDate: input.deliveryDate ? String(input.deliveryDate).trim() : null,
      lineItems,
    };
  }
}
