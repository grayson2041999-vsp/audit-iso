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

/** Bóc JSON ra khỏi phản hồi (phòng trường hợp model bọc trong ```json). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Phản hồi AI không chứa JSON hợp lệ.');
  return JSON.parse(candidate.slice(start, end + 1));
}

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
    max_tokens: 4096,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [...images, { type: 'text', text: userPrompt }],
      },
      // Prefill để ép model trả JSON thuần.
      { role: 'assistant', content: '{' },
    ],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsedJson = extractJson('{' + raw);
  const parsed = standardizedFindingSchema.safeParse(parsedJson);

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
