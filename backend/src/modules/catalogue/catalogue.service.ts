import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCatalogueItemDto } from './dto/create-catalogue-item.dto';
import { UpdateCatalogueItemDto } from './dto/update-catalogue-item.dto';
import { CatalogueCandidate, matchMaterial, MatchResult } from './match.util';

// Header variants → canonical field. Import is column-tolerant (case/space-insensitive).
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  'material name': 'materialName',
  material: 'materialName',
  name: 'materialName',
  'item name': 'materialName',
  'description of goods': 'materialName',
  description: 'materialName',
  sku: 'sku',
  code: 'sku',
  'sku code': 'sku',
  'item code': 'sku',
  'product code': 'sku',
  'material code': 'sku',
  'hsn': 'hsnCode',
  'hsn code': 'hsnCode',
  'hsn/sac': 'hsnCode',
  'hsn/sac code': 'hsnCode',
  'hsn sac': 'hsnCode',
  category: 'category',
  type: 'category',
  unit: 'unit',
  uom: 'unit',
  'standard packaging': 'standardPackaging',
  packaging: 'standardPackaging',
  pack: 'standardPackaging',
  'pack size': 'standardPackaging',
};

interface ParsedRow {
  materialName?: string;
  sku?: string;
  hsnCode?: string;
  category?: string;
  unit?: string;
  standardPackaging?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

// A single parsed row surfaced to the operator BEFORE committing an import.
export interface PreviewRow {
  row: number; // 1-based source row number (incl. header offset)
  materialName: string | null;
  sku: string | null;
  hsnCode: string | null;
  category: string | null;
  unit: string | null;
  standardPackaging: string | null;
  valid: boolean;
  error: string | null;
}

export interface ImportPreview {
  rows: PreviewRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  detectedColumns: string[];
}

@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Create a single item (Admin or Operator "new SKU with confirmation") ──
  async create(dto: CreateCatalogueItemDto, actorId?: string, viaNoMatch = false) {
    const sku = dto.sku?.trim() || (await this.generateProvisionalSku());

    const existing = await this.prisma.masterCatalogueItem.findUnique({
      where: { sku },
    });
    if (existing) {
      throw new ConflictException(`SKU "${sku}" already exists in the catalogue`);
    }

    const item = await this.prisma.masterCatalogueItem.create({
      data: {
        materialName: dto.materialName.trim(),
        sku,
        hsnCode: dto.hsnCode?.trim() || null,
        category: dto.category?.trim() || null,
        unit: dto.unit?.trim() || null,
        standardPackaging: dto.standardPackaging?.trim() || null,
        metadata: viaNoMatch
          ? { createdVia: 'operator-no-match', provisional: !dto.sku }
          : Prisma.JsonNull,
      },
    });

    await this.audit.log({
      entityType: 'MasterCatalogueItem',
      entityId: item.id,
      action: viaNoMatch ? 'CATALOGUE_ITEM_ADDED_FROM_NO_MATCH' : 'CATALOGUE_ITEM_CREATED',
      actorId,
      after: { sku: item.sku, materialName: item.materialName },
    });

    return item;
  }

  async findAll(params: { search?: string; page?: number; pageSize?: number; provisional?: boolean }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.MasterCatalogueItemWhereInput = {
      ...(params.search
        ? {
            OR: [
              { materialName: { contains: params.search, mode: 'insensitive' } },
              { sku: { contains: params.search, mode: 'insensitive' } },
              { category: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // "Awaiting a real SKU" view — provisional codes are TMP-prefixed.
      ...(params.provisional ? { sku: { startsWith: 'TMP-' } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.masterCatalogueItem.findMany({
        where,
        orderBy: { materialName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.masterCatalogueItem.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string) {
    const item = await this.prisma.masterCatalogueItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalogue item not found');
    return item;
  }

  async update(id: string, dto: UpdateCatalogueItemDto, actorId?: string) {
    const before = await this.findOne(id);
    // Snapshot the pre-update values (by value) so audit + provisional logic can't be
    // affected by later mutation of the record.
    const prev = {
      sku: before.sku,
      materialName: before.materialName,
      active: before.active,
      metadata: (before.metadata ?? null) as Record<string, unknown> | null,
    };

    // A new SKU must not collide with another item's SKU.
    const newSku = dto.sku?.trim();
    if (newSku && newSku !== prev.sku) {
      const clash = await this.prisma.masterCatalogueItem.findUnique({ where: { sku: newSku } });
      if (clash && clash.id !== id) {
        throw new ConflictException(`SKU "${newSku}" already exists in the catalogue`);
      }
    }

    const item = await this.prisma.masterCatalogueItem.update({
      where: { id },
      data: {
        materialName: dto.materialName?.trim(),
        sku: newSku,
        hsnCode: dto.hsnCode?.trim(),
        category: dto.category?.trim(),
        unit: dto.unit?.trim(),
        standardPackaging: dto.standardPackaging?.trim(),
        active: dto.active,
      },
    });

    // If a provisional (TMP-) code was replaced with a real one, clear the provisional
    // metadata flag so the "awaiting SKU" list/count updates.
    const wasProvisional = prev.sku.startsWith('TMP-');
    const nowReal = Boolean(newSku && !newSku.startsWith('TMP-'));
    if (wasProvisional && nowReal && prev.metadata && 'provisional' in prev.metadata) {
      const { provisional, ...rest } = prev.metadata;
      void provisional;
      await this.prisma.masterCatalogueItem.update({
        where: { id },
        data: { metadata: Object.keys(rest).length ? (rest as Prisma.InputJsonValue) : Prisma.JsonNull },
      });
    }

    await this.audit.log({
      entityType: 'MasterCatalogueItem',
      entityId: id,
      // A SKU change is the audited "provisional → real" event you can trace later.
      action: newSku && newSku !== prev.sku ? 'CATALOGUE_ITEM_SKU_CHANGED' : 'CATALOGUE_ITEM_UPDATED',
      actorId,
      before: { sku: prev.sku, materialName: prev.materialName, active: prev.active },
      after: { sku: item.sku, materialName: item.materialName, active: item.active },
    });
    return item;
  }

  /** Count of provisional (TMP-) SKUs still awaiting a real code (active items only). */
  async provisionalCount(): Promise<{ count: number }> {
    const count = await this.prisma.masterCatalogueItem.count({
      where: { active: true, sku: { startsWith: 'TMP-' } },
    });
    return { count };
  }

  // Soft-delete (deactivate) so historical references stay intact.
  async remove(id: string, actorId?: string) {
    await this.findOne(id);
    const item = await this.prisma.masterCatalogueItem.update({
      where: { id },
      data: { active: false },
    });
    await this.audit.log({
      entityType: 'MasterCatalogueItem',
      entityId: id,
      action: 'CATALOGUE_ITEM_DEACTIVATED',
      actorId,
    });
    return item;
  }

  // ── Match (used by AI-extraction validation; informational only, I6) ──
  async match(query: { materialName: string; sku?: string | null }): Promise<MatchResult> {
    const items = await this.prisma.masterCatalogueItem.findMany({
      where: { active: true },
      select: { id: true, materialName: true, sku: true },
    });
    return matchMaterial(query, items as CatalogueCandidate[]);
  }

  // ── Bulk import (Admin) from Excel/CSV. Upsert by SKU. ──
  async importFile(buffer: Buffer, actorId?: string): Promise<ImportResult> {
    const { rows } = this.parseWorkbook(buffer);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +1 header, +1 to 1-index
      if (!row.materialName) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: 'Missing material name' });
        continue;
      }
      const sku = row.sku?.trim() || (await this.generateProvisionalSku());
      try {
        const existing = await this.prisma.masterCatalogueItem.findUnique({
          where: { sku },
        });
        await this.prisma.masterCatalogueItem.upsert({
          where: { sku },
          create: {
            materialName: row.materialName.trim(),
            sku,
            hsnCode: row.hsnCode?.trim() || null,
            category: row.category?.trim() || null,
            unit: row.unit?.trim() || null,
            standardPackaging: row.standardPackaging?.trim() || null,
            metadata: row.metadata ? (row.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
            active: true,
          },
          update: {
            materialName: row.materialName.trim(),
            hsnCode: row.hsnCode?.trim() || null,
            category: row.category?.trim() || null,
            unit: row.unit?.trim() || null,
            standardPackaging: row.standardPackaging?.trim() || null,
            active: true,
          },
        });
        if (existing) result.updated++;
        else result.created++;
      } catch (e) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: (e as Error).message });
      }
    }

    await this.audit.log({
      entityType: 'MasterCatalogueItem',
      entityId: 'bulk-import',
      action: 'CATALOGUE_IMPORTED',
      actorId,
      after: { created: result.created, updated: result.updated, skipped: result.skipped },
    });

    return result;
  }

  /**
   * Parse a CSV/XLSX buffer WITHOUT committing — the operator reviews this before
   * importing. Flags each row valid/invalid with a reason so nothing silently drops.
   */
  previewImport(buffer: Buffer): ImportPreview {
    const { rows, detectedColumns } = this.parseWorkbook(buffer);
    const preview: PreviewRow[] = rows.map((r, i) => {
      const materialName = r.materialName?.trim() || null;
      const error = !materialName ? 'Missing material name' : null;
      return {
        row: i + 2, // +1 header, +1 to 1-index
        materialName,
        sku: r.sku?.trim() || null,
        hsnCode: r.hsnCode?.trim() || null,
        category: r.category?.trim() || null,
        unit: r.unit?.trim() || null,
        standardPackaging: r.standardPackaging?.trim() || null,
        valid: error === null,
        error,
      };
    });
    const validRows = preview.filter((p) => p.valid).length;
    return {
      rows: preview,
      totalRows: preview.length,
      validRows,
      invalidRows: preview.length - validRows,
      detectedColumns,
    };
  }

  // ── helpers ──
  private parseWorkbook(buffer: Buffer): { rows: ParsedRow[]; detectedColumns: string[] } {
    // `raw: false` renders formatted cell text (dates/numbers) consistently; CSV and
    // XLSX are both handled by XLSX.read. Blank rows are dropped.
    const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { rows: [], detectedColumns: [] };
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    const detected = new Set<string>();
    const rows = raw
      .map((r) => {
        const parsed: ParsedRow = {};
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(r)) {
          const header = key.trim().toLowerCase();
          const canonical = HEADER_MAP[header];
          const v = value == null ? '' : String(value).trim();
          if (canonical) {
            if (v !== '') detected.add(canonical);
            parsed[canonical] = v as never;
          } else if (v !== '') {
            extra[key.trim()] = v;
          }
        }
        if (Object.keys(extra).length > 0) parsed.metadata = extra;
        return parsed;
      })
      // Drop entirely-empty rows (no mapped field and no extra data).
      .filter(
        (p) =>
          p.materialName ||
          p.sku ||
          p.hsnCode ||
          p.category ||
          p.unit ||
          p.standardPackaging ||
          p.metadata,
      );

    return { rows, detectedColumns: [...detected] };
  }

  private async generateProvisionalSku(): Promise<string> {
    // TMP-XXXXXX provisional code for new SKUs lacking an official code.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `TMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const clash = await this.prisma.masterCatalogueItem.findUnique({
        where: { sku: candidate },
      });
      if (!clash) return candidate;
    }
    return `TMP-${Date.now().toString(36).toUpperCase()}`;
  }
}
