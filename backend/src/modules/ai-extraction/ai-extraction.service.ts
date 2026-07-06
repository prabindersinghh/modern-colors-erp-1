import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SettingsService } from '../settings/settings.service';

export interface ExtractedLineItem {
  materialName: string;
  hsnCode: string | null; // HSN/SAC tax code — its OWN field, never merged into sku
  sku: string | null; // supplier item/product code if present; else null
  quantity: number; // number of PHYSICAL packages (one QR each) — NOT bulk Kg/Ltr
  unit: string | null; // package type (Bag/Drum/Can) or measure unit if truly bulk
  weight: number | null; // PO-stated weight of ONE package (kg), if determinable
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
  description: 'Record the structured data extracted from the purchase order / tax invoice.',
  input_schema: {
    type: 'object' as const,
    properties: {
      poNumber: {
        type: ['string', 'null'],
        description: 'Purchase order / invoice number (e.g. "Order No", "PO No", "Invoice No").',
      },
      supplier: {
        type: ['string', 'null'],
        description: 'Supplier / vendor / seller company name (the party issuing the invoice).',
      },
      deliveryDate: {
        type: ['string', 'null'],
        description: 'Delivery / due date in YYYY-MM-DD format if present, else null.',
      },
      lineItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            materialName: {
              type: 'string',
              description: 'Material / product description (the "Description of Goods" cell).',
            },
            hsnCode: {
              type: ['string', 'null'],
              description:
                'The HSN or SAC tax code from the "HSN/SAC" column (a 4-8 digit number, e.g. "39072090"). This is a TAX code, never the item code.',
            },
            sku: {
              type: ['string', 'null'],
              description:
                'The supplier item/product/material CODE if the document has a dedicated code column (e.g. "Item Code", "Product Code", "SKU", "Material Code"). If no such code exists, use null. NEVER put the HSN code, the quantity, or a store/GRN reference here.',
            },
            quantity: {
              type: 'integer',
              description:
                'The number of PHYSICAL PACKAGES that will arrive and each need one QR sticker (bags, drums, cans, cartons, containers). Read it from a package count like "80 BAG" or a packing note like "4 Drums x 25 Kgs" (=4). If the document only gives a bulk weight/volume (e.g. "2300 KG", "200 LTR") with no package count anywhere, set this to 1 (the operator will correct it) — do NOT use the weight/volume number as the count.',
            },
            unit: {
              type: ['string', 'null'],
              description:
                'The physical package type as a singular word: "Bag", "Drum", "Can", "Carton", "Container". Only if the line is truly bulk with no packaging, use the measure unit ("KG", "LTR").',
            },
            weight: {
              type: ['number', 'null'],
              description:
                'The PO-stated weight of ONE package in kilograms, if determinable (e.g. "4 Drums x 25 Kgs" → 25; "Pack Size 25 Kg / Bag" → 25). If only a total is given, use null.',
            },
            batchNumber: {
              type: ['string', 'null'],
              description: 'Batch / lot number if explicitly present, else null.',
            },
          },
          required: ['materialName', 'quantity'],
        },
      },
    },
    required: ['lineItems'],
  },
};

const INSTRUCTION = `You are extracting structured data from a supplier Purchase Order / Tax Invoice for a paint factory's material-inward system. Every physical package that arrives gets ONE QR sticker, so the single most important value is the PHYSICAL PACKAGE COUNT per line.

Map each material line carefully — these are DIFFERENT columns and must not be mixed up:
- materialName = the "Description of Goods" text.
- hsnCode = the "HSN/SAC" code column (a 4-8 digit tax number). Put it HERE, never under sku.
- sku = a supplier item/product code ONLY if a dedicated code column exists; otherwise null.
- quantity = the number of physical packages (bags/drums/cans) that each need a QR label.
- unit = the package word (Bag, Drum, Can, Carton). Bulk measures (KG/LTR) only if no packaging.
- weight = weight of ONE package in kg, if the document states it; else null.

Worked examples from real invoices:
1) Row "TEGO DISPERS 673 (25KGS) | HSN 39072090 | 100.000 Kgs" with a note "Packing: 4 Drums x 25 Kgs" → materialName "TEGO DISPERS 673", hsnCode "39072090", sku null, quantity 4, unit "Drum", weight 25. (The "100 Kgs" is the TOTAL weight, NOT the count.)
2) Row "POLYESTER RESIN (7000NY) 25KG | HSN 39079990 | Pack Size 25 Kg 1 BAG | Qty 80 BAG" → hsnCode "39079990", quantity 80, unit "Bag", weight 25.
3) Row "CHINA CLAY POWDER | HSN 25070029 | Qty 300.000 KG" with no package count → hsnCode "25070029", quantity 1, unit "KG", weight null (operator will set the real bag count).

Use null for anything not present. Call the record_purchase_order tool with the structured result.`;

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
        throw new ExtractionError('parse', 'Claude did not return structured invoice data.');
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
        let sku = this.str(o.sku);
        let hsnCode = this.str(o.hsnCode);
        // Defense against the historical mis-mapping: if hsn is empty but sku is a
        // bare 6-8 digit number, it is almost certainly the HSN code — move it.
        if (!hsnCode && sku && /^\d{6,8}$/.test(sku)) {
          hsnCode = sku;
          sku = null;
        }
        const weight = Number(o.weight);
        return {
          materialName: String(o.materialName ?? '').trim(),
          hsnCode,
          sku,
          quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
          unit: this.str(o.unit),
          weight: Number.isFinite(weight) && weight > 0 ? weight : null,
          batchNumber: this.str(o.batchNumber),
        };
      })
      .filter((it) => it.materialName.length > 0);

    return {
      poNumber: this.str(input.poNumber),
      supplier: this.str(input.supplier),
      deliveryDate: this.str(input.deliveryDate),
      lineItems,
    };
  }

  private str(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }
}
