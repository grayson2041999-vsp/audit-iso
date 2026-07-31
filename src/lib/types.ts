import { z } from 'zod';

export const severitySchema = z.enum(['MAJOR', 'MINOR', 'OBS', 'OFI', 'CONF']);
export const standardCodeSchema = z.enum(['ISO9001', 'ISO14001', 'ISO45001']);

export const clauseRefSchema = z.object({
  standard: z.string(),
  clause: z.string(),
  clauseTitle: z.string(),
  reason: z.string().optional(),
});

/** Kết quả AI trả về sau khi chuẩn hoá finding. */
export const standardizedFindingSchema = z.object({
  title: z.string(),
  severity: severitySchema,
  severityRationale: z.string(),
  clauses: z.array(clauseRefSchema),
  requirement: z.string(),
  nonconformity: z.string(),
  evidence: z.array(z.string()),
  statement: z.string(),
  process: z.string().optional().default(''),
  area: z.string().optional().default(''),
  riskAnalysis: z.string(),
  suggestedAction: z.string(),
  imageNotes: z.array(z.string()).optional().default([]),
  missingInfo: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(100),
});

export type StandardizedFinding = z.infer<typeof standardizedFindingSchema>;
export type ClauseRef = z.infer<typeof clauseRefSchema>;

export const standardizeRequestSchema = z.object({
  rawText: z.string().min(10, 'Nội dung ghi nhận cần tối thiểu 10 ký tự'),
  standards: z.array(standardCodeSchema).min(1, 'Chọn ít nhất một tiêu chuẩn'),
  area: z.string().optional(),
  process: z.string().optional(),
  auditorName: z.string().optional(),
  auditee: z.string().optional(),
  imageKeys: z.array(z.string()).optional().default([]),
});

export const createFindingSchema = standardizeRequestSchema.extend({
  auditId: z.string().uuid().optional().nullable(),
  code: z.string().optional(),
  observedAt: z.string().optional(),
  ai: standardizedFindingSchema.optional(),
  images: z
    .array(
      z.object({
        key: z.string(),
        fileName: z.string().optional(),
        contentType: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const updateFindingSchema = z.object({
  code: z.string().optional(),
  status: z.enum(['DRAFT', 'AI_DRAFTED', 'REVIEWED', 'ISSUED', 'CLOSED']).optional(),
  title: z.string().optional(),
  severity: severitySchema.optional(),
  requirement: z.string().optional(),
  nonconformity: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  statement: z.string().optional(),
  clauses: z.array(clauseRefSchema).optional(),
  riskAnalysis: z.string().optional(),
  suggestedAction: z.string().optional(),
  rawArea: z.string().optional(),
  rawProcess: z.string().optional(),
  editor: z.string().optional(),
  note: z.string().optional(),
});
