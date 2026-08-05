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
    'Ghi nhận finding đã được chuẩn hoá theo chuẩn ISO. Điền các trường THEO ĐÚNG THỨ TỰ ' +
    'khai báo: lập luận phân loại trước, chốt mức độ sau. Khuôn phát biểu đổi theo mức độ: ' +
    'MAJOR/MINOR theo cấu trúc R–N–E, OBS theo hướng dấu hiệu suy giảm, ' +
    'OFI theo hướng tiềm năng cải tiến, CONF theo hướng thực hành tốt.',
  input_schema: {
    type: 'object',
    /**
     * THỨ TỰ CÁC TRƯỜNG Ở ĐÂY LÀ CÓ CHỦ ĐÍCH, đừng sắp lại tuỳ tiện.
     *
     * Model sinh các trường đúng theo thứ tự khai báo, nên thứ tự này quyết
     * định hai thứ cùng lúc:
     *
     *  1. CHẤT LƯỢNG PHÂN LOẠI. `severityRationale` đứng TRƯỚC `severity` để
     *     model phải lập luận xong mới chốt mức. Đảo lại thì nó chốt trước rồi
     *     mới đi hợp lý hoá — đúng cái thói quen nống mọi thứ thành NC mà cả
     *     nguyên tắc số 1 trong SYSTEM_PROMPT đang chống.
     *
     *  2. TRẢI NGHIỆM CHỜ. Khi bật stream, những gì auditor mong nhất phải ra
     *     trước: mức độ, tiêu đề, rồi phát biểu. Danh mục viện dẫn và bằng
     *     chứng vừa dài vừa ít cấp bách nên xếp sau. Phần phụ trợ xuống cuối.
     */
    properties: {
      severityRationale: {
        type: 'string',
        description:
          'VIẾT TRƯỜNG NÀY TRƯỚC TIÊN. 1–2 câu lập luận để đi tới mức độ: ghi nhận này có mô tả ' +
          'việc vi phạm một yêu cầu cụ thể nào không, bằng chứng tới đâu, hệ thống có đổ vỡ ở ' +
          'diện rộng không. Nếu không có yêu cầu nào bị vi phạm thì phải kết luận OBS/OFI/CONF, ' +
          'tuyệt đối không nống lên MINOR cho hợp khuôn',
      },
      severity: {
        type: 'string',
        enum: ['MAJOR', 'MINOR', 'OBS', 'OFI', 'CONF'],
        description: 'Mức độ, chốt theo đúng lập luận vừa viết ở severityRationale',
      },
      title: { type: 'string', description: 'Tiêu đề ngắn 8–15 từ, nêu đúng bản chất vấn đề' },
      statement: {
        type: 'string',
        description:
          'Phát biểu finding hoàn chỉnh dùng trực tiếp trong báo cáo, 3–6 câu. Khuôn viết PHẢI ' +
          'khớp với mức độ đã chọn: ' +
          'MAJOR/MINOR = [bằng chứng] → [không phù hợp với yêu cầu nào] → [bản chất sai lệch]. ' +
          'OBS = [bằng chứng] → [dấu hiệu suy giảm] → [nguy cơ trở thành không phù hợp ở điều ' +
          'khoản nào nếu không theo dõi]; KHÔNG viết "không phù hợp với yêu cầu". ' +
          'OFI = [thực hành hiện tại kèm bằng chứng, khẳng định rõ là ĐÃ PHÙ HỢP] → [chỗ còn dư ' +
          'địa nâng cao hiệu lực/hiệu quả]. ' +
          'CONF = [thực hành tốt kèm bằng chứng] → [vì sao đáng nhân rộng]. ' +
          'Với mọi loại: không nêu nguyên nhân gốc, không đề xuất giải pháp cụ thể',
      },
      clauses: {
        type: 'array',
        description:
          'Điều khoản viện dẫn, đặt điều khoản phù hợp nhất ở đầu. Với MAJOR/MINOR là điều ' +
          'khoản BỊ VI PHẠM; với OBS là điều khoản có NGUY CƠ vi phạm nếu không xử lý; ' +
          'với OFI/CONF là điều khoản LIÊN QUAN tới thực hành đang xét, không mang nghĩa vi phạm',
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
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Từng mẩu bằng chứng khách quan riêng biệt, mỗi mẩu kiểm chứng được độc lập ' +
          '(số hiệu tài liệu, mã thiết bị, số lượng mẫu kiểm tra và số sai lỗi, vị trí, ngày tháng)',
      },
      imageNotes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Chỉ điền khi có ảnh đính kèm: những gì quan sát được trên ảnh, hoặc cảnh báo nếu ' +
          'ảnh mâu thuẫn với mô tả văn bản. Không có ảnh thì để mảng rỗng',
      },
      missingInfo: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Dữ kiện auditor cần bổ sung để finding đủ chặt chẽ. Bất cứ thứ gì bạn muốn viết ' +
          'nhưng không có trong ghi nhận (số hiệu tài liệu, ngày tháng, mã thiết bị, số mẫu) ' +
          'thì đưa vào đây thay vì tự bịa',
      },
    },
    required: ['title', 'severity', 'severityRationale', 'clauses', 'evidence', 'statement'],
  },
};

export async function standardizeFinding(input: {
  rawText: string;
  standards: StandardCode[];
  area?: string;
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

  return finalize(toolUse.input, imageKeys.length, images.length);
}

/**
 * Kiểm và làm sạch dữ liệu model trả về.
 *
 * Dùng chung cho cả đường thường lẫn đường stream — bản hiện dần trên màn hình
 * chỉ để xem, còn bản đi qua đây mới là bản được lưu.
 */
function finalize(toolInput: unknown, imageKeysCount: number, imagesLoaded: number) {
  const parsed = standardizedFindingSchema.safeParse(toolInput);

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
  if (imageKeysCount > imagesLoaded) {
    warnings.push(`Có ${imageKeysCount - imagesLoaded} ảnh không đọc được và đã bị bỏ qua.`);
  }

  return {
    result: { ...parsed.data, clauses: validClauses.length ? validClauses : parsed.data.clauses },
    model: MODEL,
    warnings,
  };
}

export type StreamEvent =
  /** Một mẩu chuỗi JSON model vừa sinh ra. Ghép dồn để đọc dần. */
  | { type: 'delta'; text: string }
  /** Bản chính thức, đã qua Zod và hậu kiểm điều khoản. */
  | { type: 'done'; result: StandardizedFinding; model: string; warnings: string[] };

/**
 * Bản chuẩn hoá có stream.
 *
 * Cùng một lời gọi như bản thường, chỉ khác là đẩy từng mẩu JSON về ngay khi
 * model sinh ra thay vì đợi đủ rồi mới trả. Auditor thấy mức độ và tiêu đề sau
 * một hai giây thay vì nhìn màn hình đứng im hơn mười giây.
 *
 * Thứ tự các trường trong FINDING_TOOL được sắp để phục vụ đúng việc này.
 */
export async function* standardizeFindingStream(input: {
  rawText: string;
  standards: StandardCode[];
  area?: string;
  auditee?: string;
  auditorName?: string;
  imageKeys?: string[];
}): AsyncGenerator<StreamEvent> {
  if (!isAiConfigured()) {
    throw new Error('Chưa cấu hình ANTHROPIC_API_KEY trong biến môi trường.');
  }

  const imageKeys = input.imageKeys ?? [];
  const images = await loadImageBlocks(imageKeys);
  const userPrompt = buildUserPrompt({ ...input, imageCount: images.length });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [...images, { type: 'text', text: userPrompt }] }],
    tools: [FINDING_TOOL],
    tool_choice: { type: 'tool', name: FINDING_TOOL.name },
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
      yield { type: 'delta', text: event.delta.partial_json };
    }
  }

  const message = await stream.finalMessage();
  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === FINDING_TOOL.name,
  );
  if (!toolUse) throw new Error('AI không trả về dữ liệu có cấu trúc. Vui lòng thử lại.');

  const { result, model, warnings } = finalize(toolUse.input, imageKeys.length, images.length);
  yield { type: 'done', result, model, warnings };
}
