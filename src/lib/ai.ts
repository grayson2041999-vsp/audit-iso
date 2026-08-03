import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { standardizedFindingSchema, type StandardizedFinding } from './types';
import { isValidClause, type StandardCode } from './iso';
import { getObjectBase64, isR2Configured } from './r2';

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const MAX_IMAGES = 6;

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? 'missing' });

type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };
};

async function loadImageBlocks(keys: string[]): Promise<ImageBlock[]> {
  if (!keys.length || !isR2Configured()) return [];
  const picked = keys.slice(0, MAX_IMAGES);
  const blocks = await Promise.all(
    picked.map(async (key) => {
      try {
        const { base64, contentType } = await getObjectBase64(key);
        const mt = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)
          ? contentType
          : 'image/jpeg';
        return {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: mt as ImageBlock['source']['media_type'], data: base64 },
        };
      } catch (e) {
        console.error('[ai] Không tải được ảnh từ R2:', key, e);
        return null;
      }
    }),
  );
  return blocks.filter((b): b is ImageBlock => b !== null);
}

/**
 * Định nghĩa "công cụ" mà model bắt buộc phải gọi.
 * Nhờ cơ chế tool use, Anthropic tự đảm bảo đầu ra là JSON hợp lệ đúng schema —
 * không còn khâu model tự gõ JSON bằng tay (dễ sai dấu ngoặc kép chưa escape).
 */
const FINDING_TOOL: Anthropic.Tool = {
  name: 'ghi_nhan_finding',
  description:
    'Ghi nhận finding đã được chuẩn hoá theo cấu trúc Yêu cầu – Sự không phù hợp – Bằng chứng khách quan của ISO.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tiêu đề ngắn 8–15 từ, nêu đúng bản chất vấn đề' },
      severity: {
        type: 'string',
        enum: ['MAJOR', 'MINOR', 'OBS', 'OFI', 'CONF'],
        description: 'Mức độ phân loại finding',
      },
      severityRationale: { type: 'string', description: '1–2 câu giải thích vì sao xếp mức này' },
      clauses: {
        type: 'array',
        description: 'Điều khoản viện dẫn, đặt điều khoản phù hợp nhất ở đầu',
        items: {
          type: 'object',
          properties: {
            standard: { type: 'string', description: 'VD: ISO 45001:2018' },
            clause: { type: 'string', description: 'Mã điều khoản, VD: 8.2' },
            clauseTitle: { type: 'string', description: 'Tên điều khoản' },
            reason: { type: 'string', description: 'Vì sao viện dẫn điều khoản này' },
          },
          required: ['standard', 'clause', 'clauseTitle'],
        },
      },
      requirement: { type: 'string', description: 'Phát biểu yêu cầu bị vi phạm (2–4 câu)' },
      nonconformity: { type: 'string', description: 'Bản chất sự không phù hợp (2–4 câu)' },
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'Từng mẩu bằng chứng khách quan riêng biệt',
      },
      statement: { type: 'string', description: 'Phát biểu finding hoàn chỉnh dùng trong báo cáo' },
      process: { type: 'string', description: 'Quá trình liên quan' },
      area: { type: 'string', description: 'Khu vực / bộ phận' },
      riskAnalysis: { type: 'string', description: 'Rủi ro tiềm ẩn nếu không khắc phục (2–3 câu)' },
      suggestedAction: { type: 'string', description: 'Định hướng hành động khắc phục' },
      imageNotes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ghi chú về từng ảnh hiện trường, nếu có',
      },
      missingInfo: {
        type: 'array',
        items: { type: 'string' },
        description: 'Thông tin auditor cần bổ sung để finding đủ chặt chẽ',
      },
      confidence: { type: 'number', description: 'Độ tin cậy 0–100' },
    },
    required: [
      'title', 'severity', 'severityRationale', 'clauses', 'requirement',
      'nonconformity', 'evidence', 'statement', 'riskAnalysis', 'suggestedAction', 'confidence',
    ],
  },
};

export async function standardizeFinding(input: {
  rawText: string;
  standards: StandardCode[];
  area?: string;
  process?: string;
  auditee?: string;
  auditorName?: string;
  imageKeys?: string[];
}): Promise<{ result: StandardizedFinding; model: string; warnings: string[] }> {
  if (!isAiConfigured()) {
    throw new Error('Chưa cấu hình ANTHROPIC_API_KEY trong biến môi trường.');
  }

  const imageKeys = input.imageKeys ?? [];
  const images = await loadImageBlocks(imageKeys);

  const userPrompt = buildUserPrompt({ ...input, imageCount: images.length });

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [...images, { type: 'text', text: userPrompt }],
      },
    ],
    tools: [FINDING_TOOL],
    // Ép model bắt buộc gọi công cụ — không được trả lời bằng văn xuôi.
    tool_choice: { type: 'tool', name: FINDING_TOOL.name },
  });

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === FINDING_TOOL.name,
  );

  if (!toolUse) {
    const fallbackText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .slice(0, 300);
    throw new Error(
      'AI không trả về dữ liệu có cấu trúc. Vui lòng thử lại.' +
        (fallbackText ? ` (phản hồi nhận được: ${fallbackText})` : ''),
    );
  }

  const parsed = standardizedFindingSchema.safeParse(toolUse.input);

  if (!parsed.success) {
    throw new Error(
      'AI trả về dữ liệu không đúng cấu trúc: ' +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  // Hậu kiểm: loại bỏ điều khoản không tồn tại trong danh mục.
  const warnings: string[] = [];
  const validClauses = parsed.data.clauses.filter((c) => {
    const ok = isValidClause(c.standard, c.clause);
    if (!ok) warnings.push(`Bỏ qua viện dẫn không hợp lệ: ${c.standard} ${c.clause}`);
    return ok;
  });

  if (validClauses.length === 0 && parsed.data.clauses.length > 0) {
    warnings.push('Không có điều khoản viện dẫn nào hợp lệ — auditor cần kiểm tra lại thủ công.');
  }
  if (imageKeys.length > images.length) {
    warnings.push(`Có ${imageKeys.length - images.length} ảnh không đọc được và đã bị bỏ qua.`);
  }

  return {
    result: { ...parsed.data, clauses: validClauses.length ? validClauses : parsed.data.clauses },
    model: MODEL,
    warnings,
  };
}
