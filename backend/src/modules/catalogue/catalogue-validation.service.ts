import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../../prisma/prisma.service';

export type FlagSeverity = 'error' | 'warning';

export interface RowFlag {
  /** 1-based row number as shown in the preview (matches the spreadsheet). */
  row: number;
  /** Which column the problem is in, or null when it concerns the whole row. */
  field: 'materialName' | 'sku' | 'hsnCode' | 'category' | 'unit' | 'standardPackaging' | null;
  severity: FlagSeverity;
  /** Plain-English explanation the operator can act on. */
  message: string;
  /** Suggested corrected value, when there is an obvious one. */
  suggestion?: string | null;
}

export interface ValidationResult {
  flags: RowFlag[];
  /** Whether the AI pass actually ran. False = deterministic checks only. */
  aiUsed: boolean;
  /** Why AI did not run (no key, timeout, error, skipped, too many rows). */
  aiSkippedReason?: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  ms: number;
}

/** Rows above this are checked deterministically only — see runAi() for the reasoning. */
const AI_ROW_LIMIT = 200;
const AI_TIMEOUT_MS = 25_000;

// Opus 4.8 list pricing, USD per million tokens. Used only to report an estimate back
// to the client so they can see what a validation run costs them.
const USD_PER_MTOK_IN = 5;
const USD_PER_MTOK_OUT = 25;

const VALIDATE_TOOL = {
  name: 'report_catalogue_issues',
  description: 'Report data-quality problems found in the uploaded catalogue rows.',
  input_schema: {
    type: 'object' as const,
    properties: {
      flags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row: { type: 'integer', description: 'The row number exactly as given in the input.' },
            field: {
              type: ['string', 'null'],
              enum: ['materialName', 'sku', 'hsnCode', 'category', 'unit', 'standardPackaging', null],
              description: 'Which column is wrong, or null if the whole row is the problem.',
            },
            severity: {
              type: 'string',
              enum: ['error', 'warning'],
              description:
                'error = importing this row would put clearly wrong data in the catalogue. warning = looks odd and is worth a human glance, but may well be fine.',
            },
            message: {
              type: 'string',
              description:
                'One short sentence a non-technical storekeeper can act on. Say what is wrong and what it should be.',
            },
            suggestion: {
              type: ['string', 'null'],
              description: 'The corrected value if there is an obvious one, else null.',
            },
          },
          required: ['row', 'field', 'severity', 'message'],
        },
      },
    },
    required: ['flags'],
  },
};

const INSTRUCTION = `You are checking rows a paint factory's storekeeper has uploaded into their material catalogue. Report only genuine problems — a false alarm costs them more time than a missed nitpick, because they must review every flag by hand.

Columns:
- materialName: the material's name, e.g. "Titanium Dioxide". REQUIRED.
- sku: the supplier/item code, e.g. "TIO2-001". May be blank.
- hsnCode: an Indian HSN/SAC tax code, 4-8 DIGITS, e.g. "32061110". May be blank.
- category: e.g. Pigment, Binder, Solvent, Filler, Additive. May be blank.
- unit: the measure, usually KG or LTR. May be blank.
- standardPackaging: e.g. "25 KG Bag", "200 LTR Drum". May be blank.

Flag these:
1. A value in the wrong column — a weight or number sitting in sku, a material name in the category column, an HSN code in the sku field (HSN is a 4-8 digit tax number and belongs in hsnCode).
2. Rows that are a header, a section title, a total, or a note rather than a material.
3. Malformed values — an HSN code that is not 4-8 digits, a unit that is not a real measure, a packaging string with no number.
4. Names that look truncated or corrupted ("Titanium Diox", "?????").
5. Inconsistent unit vs packaging — unit "KG" with packaging "200 LTR Drum".
6. Obviously duplicated rows within this same upload.

Do NOT flag:
- A blank optional field. Blank is the correct way to say "not known" and must never be an error.
- An unfamiliar material name. Speciality chemicals have odd names; assume the storekeeper knows their own materials.
- Capitalisation, spacing or ordering preferences.
- A missing SKU. The system assigns a provisional code automatically.

Use severity "error" only when importing the row would clearly put wrong data in the catalogue. Everything else is "warning". If every row looks fine, return an empty flags array.`;

/**
 * AI-assisted sanity check for catalogue imports.
 *
 * ASSISTIVE, NEVER A GATE. Every path that can fail — no API key, a timeout, a bad
 * response, an over-large file — returns an empty flag list so the import proceeds on
 * the existing deterministic parsing and preview. The client explicitly required that a
 * clean file must still import when this layer is unavailable.
 */
@Injectable()
export class CatalogueValidationService {
  private readonly logger = new Logger(CatalogueValidationService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async validate(
    rows: {
      row: number;
      materialName: string | null;
      sku: string | null;
      hsnCode: string | null;
      category: string | null;
      unit: string | null;
      standardPackaging: string | null;
    }[],
    opts: { useAi?: boolean } = {},
  ): Promise<ValidationResult> {
    const started = Date.now();

    // Deterministic checks always run: they are instant, free, and catch the things
    // that are objectively true rather than a judgement call.
    const flags = await this.deterministic(rows);

    if (opts.useAi === false) {
      return { flags, aiUsed: false, aiSkippedReason: 'skipped', ms: Date.now() - started };
    }
    if (rows.length === 0) {
      return { flags, aiUsed: false, aiSkippedReason: 'no_rows', ms: Date.now() - started };
    }
    if (rows.length > AI_ROW_LIMIT) {
      // A 600-SKU initial load is a one-off bulk job; sending it would be slow and
      // costly for little gain, and the deterministic checks still apply.
      return {
        flags,
        aiUsed: false,
        aiSkippedReason: `too_many_rows(${rows.length}>${AI_ROW_LIMIT})`,
        ms: Date.now() - started,
      };
    }

    try {
      const ai = await this.runAi(rows);
      return {
        flags: this.merge(flags, ai.flags),
        aiUsed: true,
        usage: ai.usage,
        ms: Date.now() - started,
      };
    } catch (err) {
      // Never propagate: the import must work without this layer.
      const reason = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`Catalogue AI validation unavailable (${reason}) — continuing without it.`);
      return { flags, aiUsed: false, aiSkippedReason: reason, ms: Date.now() - started };
    }
  }

  /** Checks that are objectively decidable — no model needed, no cost, no latency. */
  private async deterministic(
    rows: Parameters<CatalogueValidationService['validate']>[0],
  ): Promise<RowFlag[]> {
    const flags: RowFlag[] = [];

    // 1. Required field.
    for (const r of rows) {
      if (!r.materialName || !r.materialName.trim()) {
        flags.push({
          row: r.row,
          field: 'materialName',
          severity: 'error',
          message: 'Material name is required — this row cannot be imported without it.',
        });
      }
    }

    // 2. Duplicate SKUs WITHIN the uploaded file.
    const seen = new Map<string, number>();
    for (const r of rows) {
      const sku = r.sku?.trim().toUpperCase();
      if (!sku) continue;
      const first = seen.get(sku);
      if (first !== undefined) {
        flags.push({
          row: r.row,
          field: 'sku',
          severity: 'error',
          message: `Duplicate SKU "${r.sku}" — also on row ${first}. Only the last one would be kept.`,
        });
      } else {
        seen.set(sku, r.row);
      }
    }

    // 3. SKUs that already exist in the catalogue. A warning, not an error: re-importing
    //    to UPDATE existing materials is a legitimate and common workflow.
    const skus = [...seen.keys()];
    if (skus.length > 0) {
      const existing = await this.prisma.masterCatalogueItem.findMany({
        where: { sku: { in: skus, mode: 'insensitive' } },
        select: { sku: true, materialName: true },
      });
      const byUpper = new Map(existing.map((e) => [e.sku.toUpperCase(), e.materialName]));
      for (const r of rows) {
        const sku = r.sku?.trim().toUpperCase();
        if (!sku) continue;
        const match = byUpper.get(sku);
        if (match) {
          flags.push({
            row: r.row,
            field: 'sku',
            severity: 'warning',
            message: `SKU "${r.sku}" already exists ("${match}") — importing will UPDATE it, not add a new one.`,
          });
        }
      }
    }

    // 4. HSN must be 4-8 digits when present.
    for (const r of rows) {
      const hsn = r.hsnCode?.trim();
      if (hsn && !/^\d{4,8}$/.test(hsn)) {
        flags.push({
          row: r.row,
          field: 'hsnCode',
          severity: 'warning',
          message: `"${hsn}" does not look like an HSN code (expected 4-8 digits).`,
        });
      }
    }

    // 5. A SKU that is purely a number is usually a weight or quantity in the wrong column.
    for (const r of rows) {
      const sku = r.sku?.trim();
      if (sku && /^\d+(\.\d+)?$/.test(sku)) {
        flags.push({
          row: r.row,
          field: 'sku',
          severity: 'warning',
          message: `SKU "${sku}" is only a number — check this is not a weight or quantity in the wrong column.`,
        });
      }
    }

    return flags;
  }

  /** The model pass. Throws on any failure; the caller degrades to deterministic-only. */
  private async runAi(
    rows: Parameters<CatalogueValidationService['validate']>[0],
  ): Promise<{ flags: RowFlag[]; usage: ValidationResult['usage'] }> {
    const apiKey = await this.settings.getDecryptedKey();
    if (!apiKey) throw new Error('no_key');

    const client = new Anthropic({ apiKey });
    const model = this.config.get<string>('CLAUDE_MODEL') ?? 'claude-opus-4-8';

    // Compact TSV rather than JSON — same information, far fewer tokens per row.
    const table = [
      'row\tmaterialName\tsku\thsnCode\tcategory\tunit\tstandardPackaging',
      ...rows.map((r) =>
        [r.row, r.materialName, r.sku, r.hsnCode, r.category, r.unit, r.standardPackaging]
          .map((v) => (v == null ? '' : String(v).replace(/\t/g, ' ')))
          .join('\t'),
      ),
    ].join('\n');

    const response = await client.messages.create(
      {
        model,
        max_tokens: 2048,
        tools: [VALIDATE_TOOL as unknown as Anthropic.Tool],
        tool_choice: { type: 'tool', name: VALIDATE_TOOL.name },
        messages: [{ role: 'user', content: `${INSTRUCTION}\n\nRows:\n${table}` }],
      },
      { timeout: AI_TIMEOUT_MS },
    );

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no_tool_use');

    const input = toolUse.input as { flags?: unknown[] };
    const valid = new Set(rows.map((r) => r.row));
    const flags: RowFlag[] = (Array.isArray(input.flags) ? input.flags : [])
      .map((f) => f as Record<string, unknown>)
      .filter((f) => valid.has(Number(f.row))) // ignore hallucinated row numbers
      .map((f) => ({
        row: Number(f.row),
        field: (f.field ?? null) as RowFlag['field'],
        severity: (f.severity === 'error' ? 'error' : 'warning') as FlagSeverity,
        message: String(f.message ?? '').trim(),
        suggestion: f.suggestion == null ? null : String(f.suggestion),
      }))
      .filter((f) => f.message.length > 0);

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      flags,
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostUsd:
          Number(
            (
              (inputTokens / 1_000_000) * USD_PER_MTOK_IN +
              (outputTokens / 1_000_000) * USD_PER_MTOK_OUT
            ).toFixed(6),
          ),
      },
    };
  }

  /** Deterministic flags win — they are certain, so drop any AI duplicate for the same cell. */
  private merge(deterministic: RowFlag[], ai: RowFlag[]): RowFlag[] {
    const taken = new Set(deterministic.map((f) => `${f.row}:${f.field}`));
    return [
      ...deterministic,
      ...ai.filter((f) => !taken.has(`${f.row}:${f.field}`)),
    ].sort((a, b) => a.row - b.row || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  }
}
