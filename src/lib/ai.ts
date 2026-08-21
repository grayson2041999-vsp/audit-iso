import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { CHECKLIST_SYSTEM_PROMPT, buildChecklistPrompt } from './checklist-prompt';
import {
  standardizedFindingSchema, checklistSchema,
  type StandardizedFinding, type Checklist,
} from './types';
import { isValidClause, type StandardCode } from './iso';
import { getObjectBase64, isR2Configured } from './r2';

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const MAX_IMAGES = 6;

/**
 * Trần token cho một lượt gọi.
 *
 * Đây chỉ là TRẦN — tiền API tính theo số token thực sinh ra, không tính theo
 * trần. Để chật không tiết kiệm được gì, mà lại gây hỏng.
 *
 * Trước đây đặt 8192 và đã gây lỗi thật: model chạm trần giữa chừng, JSON của
 * tool bị cắt cụt, những trường sinh sau cùng biến mất, Zod báo
 * "statement: Required" và auditor mất trắng kết quả đã chờ cả chục giây.
 * Ghi nhận có ảnh kèm ca phân loại khó (MAJOR hay MINOR) là lúc dễ chạm nhất.
 */
const MAX_TOKENS = 16384;

/**
 * Chặn sớm trường hợp model bị cắt giữa chừng.
 *
 * Phải gọi TRƯỚC khi đụng tới `toolUse.input`: khi `stop_reason` là
 * `max_tokens`, SDK vẫn vá cho ra một object trông hợp lệ nhưng thiếu các
 * trường ở đuôi. Không kiểm ở đây thì lỗi rơi xuống tận Zod rồi hiện ra dưới
 * dạng "thiếu trường X" — đúng triệu chứng nhưng sai nguyên nhân, người đọc
 * log không thể lần ngược ra được.
 */
function assertNotTruncated(stopReason: string | null) {
  if (stopReason === 'max_tokens') {
    throw new Error(
      'AI viết dài quá mức cho phép nên bị cắt giữa chừng, kết quả không dùng được. ' +
        'Thử rút gọn ghi nhận thô hoặc bớt ảnh đính kèm rồi chuẩn hoá lại.',
    );
  }
}

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
    /**
     * THỨ TỰ Ở ĐÂY PHẢI KHỚP VỚI `properties` BÊN TRÊN.
     *
     * Model bám theo danh sách này (và theo mục "ĐẦU RA" trong SYSTEM_PROMPT)
     * để quyết định viết trường nào trước, chứ không chỉ nhìn thứ tự khai báo
     * `properties`. Bản cũ để `statement` ở cuối danh sách này trong khi
     * `properties` đặt nó thứ tư — hai chỗ nói hai đằng, và trên thực tế model
     * nghe theo chỗ này. Hậu quả: trường quan trọng nhất của cả finding nằm ở
     * mép vực, cứ bị cắt là nó đi đầu tiên.
     *
     * Sửa gì ở `properties` thì sửa luôn ở đây và ở mục "ĐẦU RA" của
     * SYSTEM_PROMPT — ba chỗ phải cùng một thứ tự.
     */
    required: ['severityRationale', 'severity', 'title', 'statement', 'clauses', 'evidence'],
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
    max_tokens: MAX_TOKENS,
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

  assertNotTruncated(message.stop_reason);

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
  const warnings: string[] = [];

  let parsed = standardizedFindingSchema.safeParse(toolInput);

  /**
   * CỨU LẤY PHẦN CÒN LẠI KHI CHỈ THIẾU MỖI `statement`.
   *
   * Auditor vừa ngồi nhìn mức độ, tiêu đề và bằng chứng chảy dần ra màn hình.
   * Ném hết đi vì thiếu một trường — dù trường đó là ô văn bản họ sửa được
   * bằng tay ngay bên dưới — là đổi thứ đáng giá lấy sự sạch sẽ của dữ liệu.
   * Cột `statement` trong DB vốn cho phép để trống, và màn hình kết quả hiện
   * nó dưới dạng textarea sửa được, nên bỏ trống là an toàn.
   *
   * Chỉ cứu đúng trường hợp này. Thiếu `severity` hay `clauses` thì kết quả
   * không còn là một finding nữa — vẫn phải hỏng cho ra hỏng.
   */
  if (!parsed.success) {
    const onlyStatementMissing = parsed.error.issues.every(
      (i) => i.path.length === 1 && i.path[0] === 'statement',
    );

    if (onlyStatementMissing) {
      parsed = standardizedFindingSchema.safeParse({
        ...(toolInput as Record<string, unknown>),
        statement: '',
      });
      warnings.push(
        'AI không trả về phần phát biểu finding. Các trường còn lại vẫn dùng được — ' +
          'mời tự viết phát biểu ở ô bên dưới, hoặc bấm chuẩn hoá lại.',
      );
    }
  }

  if (!parsed.success) {
    // In cả dữ liệu thô ra log: không có nó thì về sau không cách nào biết
    // model đã trả về cái gì, chỉ còn mỗi tên trường bị thiếu để mà đoán.
    console.error('[ai] Tool input không qua được Zod:', JSON.stringify(toolInput));
    throw new Error(
      'AI trả về dữ liệu không đúng cấu trúc: ' +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  // Hậu kiểm: loại bỏ điều khoản không tồn tại trong danh mục.
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
    max_tokens: MAX_TOKENS,
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
  assertNotTruncated(message.stop_reason);

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === FINDING_TOOL.name,
  );
  if (!toolUse) throw new Error('AI không trả về dữ liệu có cấu trúc. Vui lòng thử lại.');

  const { result, model, warnings } = finalize(toolUse.input, imageKeys.length, images.length);
  yield { type: 'done', result, model, warnings };
}

/* ------------------------------------------------------------------ */
/* Checklist đánh giá                                                  */
/* ------------------------------------------------------------------ */

const CHECKLIST_TOOL: Anthropic.Tool = {
  name: 'soan_checklist',
  description:
    'Trả về danh mục công việc cần làm khi đánh giá một đơn vị. Mỗi dòng là một việc ' +
    'đánh giá viên thực hiện được ngay (xin hồ sơ, chọn mẫu, đối chiếu, quan sát tại chỗ), ' +
    'KHÔNG phải một câu hỏi có/không.',
  input_schema: {
    type: 'object',
    /**
     * `unitSummary` đứng đầu là có chủ đích, giống cách `severityRationale` đứng
     * trước `severity` ở FINDING_TOOL: model phải phát biểu xong nó hiểu đơn vị
     * này làm gì rồi mới đi soạn việc. Đảo lại thì nó soạn việc chung chung
     * trước, rồi tóm tắt cho khớp với thứ vừa soạn.
     *
     * Kèm lợi ích về trải nghiệm chờ: dòng đầu tiên hiện ra sau một hai giây
     * cho đánh giá viên biết ngay model có hiểu đúng không, thay vì đợi đủ ba
     * mươi dòng mới phát hiện nó hiểu nhầm.
     */
    properties: {
      unitSummary: {
        type: 'string',
        description:
          'VIẾT TRƯỜNG NÀY TRƯỚC TIÊN. 1–2 câu nêu bạn hiểu đơn vị này làm gì, có những quá ' +
          'trình chính nào, và đặc thù nào ảnh hưởng tới việc đánh giá (vận hành thiết bị, ' +
          'dùng hoá chất, có kho, có nhà thầu, có tiếp xúc khách hàng...). Chỉ dựa trên thông ' +
          'tin đầu vào, không suy diễn thêm',
      },
      groups: {
        type: 'array',
        description:
          'Các nhóm chủ đề, đúng thứ tự và đúng tên đã cho trong yêu cầu. Bỏ nhóm nào không ' +
          'có việc gì đáng làm với đơn vị này',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tên nhóm, chép đúng từ danh sách đã cho' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: {
                    type: 'string',
                    description:
                      'Một việc cần làm, mở đầu bằng động từ (xin, yêu cầu xuất trình, chọn ' +
                      'ngẫu nhiên, đối chiếu, quan sát tại chỗ, hỏi người trực tiếp làm). Nêu ' +
                      'rõ xem hồ sơ nào và đối chiếu với yêu cầu nào; có cỡ mẫu cụ thể nếu là ' +
                      'việc đối chiếu hồ sơ. Tối đa khoảng 45 từ. KHÔNG viết dạng câu hỏi ' +
                      'có/không, KHÔNG bịa số hiệu tài liệu hay tên biểu mẫu',
                  },
                  clauses: {
                    type: 'array',
                    description:
                      'Điều khoản liên quan tới việc này. GỘP các tiêu chuẩn có cùng nội dung ' +
                      'vào MỘT dòng thay vì tách thành nhiều dòng gần giống nhau. Tối đa 4 ' +
                      'viện dẫn một dòng',
                    items: {
                      type: 'object',
                      properties: {
                        standard: { type: 'string', description: 'VD: ISO 45001:2018' },
                        clause: { type: 'string', description: 'Mã điều khoản, VD: 7.2' },
                        clauseTitle: { type: 'string', description: 'Tên điều khoản' },
                      },
                      required: ['standard', 'clause', 'clauseTitle'],
                    },
                  },
                },
                required: ['task', 'clauses'],
              },
            },
          },
          required: ['name', 'items'],
        },
      },
    },
    required: ['unitSummary', 'groups'],
  },
};

export type ChecklistStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; result: Checklist; model: string; warnings: string[] };

/**
 * Kiểm và làm sạch checklist model trả về.
 *
 * Khác `finalize` của finding ở một chỗ quan trọng: viện dẫn sai thì BỎ VIỆN
 * DẪN, giữ lại dòng công việc. Với finding, mất hết điều khoản là mất luôn ý
 * nghĩa nên phải cảnh báo gắt; với checklist, phần có giá trị là câu chữ trong
 * cột "Công việc cần làm" — mã điều khoản chỉ là chú thích trong ngoặc. Vứt cả
 * dòng đi vì một mã sai là đổi thứ đáng giá lấy thứ không đáng.
 */
function finalizeChecklist(toolInput: unknown) {
  const parsed = checklistSchema.safeParse(toolInput);
  if (!parsed.success) {
    console.error('[ai] Checklist tool input không qua được Zod:', JSON.stringify(toolInput));
    throw new Error(
      'AI trả về dữ liệu không đúng cấu trúc: ' +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  const warnings: string[] = [];
  let dropped = 0;

  const groups = parsed.data.groups
    .map((g) => ({
      name: g.name,
      items: g.items
        .filter((it) => it.task.trim().length > 0)
        .map((it) => {
          const clauses = it.clauses.filter((c) => {
            const ok = isValidClause(c.standard, c.clause);
            if (!ok) dropped++;
            return ok;
          });
          return { ...it, clauses };
        }),
    }))
    .filter((g) => g.items.length > 0);

  if (dropped > 0) {
    warnings.push(
      `Đã bỏ ${dropped} viện dẫn điều khoản không có trong danh mục. Nội dung công việc giữ nguyên.`,
    );
  }
  if (groups.length === 0) {
    throw new Error('AI không soạn được dòng công việc nào. Thử mô tả đơn vị chi tiết hơn.');
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total < 8) {
    warnings.push(
      `Chỉ soạn được ${total} dòng — thường là do mô tả đơn vị còn sơ sài. Bổ sung các quá trình ` +
        'chính, thiết bị và hồ sơ đơn vị đang dùng rồi sinh lại sẽ khá hơn nhiều.',
    );
  }

  return { result: { ...parsed.data, groups }, model: MODEL, warnings };
}

/**
 * Sinh checklist, trả kết quả chảy dần.
 *
 * Không có bản không-stream đi kèm như `standardizeFinding`, vì đường dùng duy
 * nhất là màn hình soạn checklist và đầu ra dài hơn một finding nhiều lần —
 * ngồi nhìn màn hình đứng im ba mươi giây là quá lâu.
 */
export async function* generateChecklistStream(
  input: Parameters<typeof buildChecklistPrompt>[0],
): AsyncGenerator<ChecklistStreamEvent> {
  if (!isAiConfigured()) {
    throw new Error('Chưa cấu hình ANTHROPIC_API_KEY trong biến môi trường.');
  }

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: CHECKLIST_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildChecklistPrompt(input) }],
    tools: [CHECKLIST_TOOL],
    tool_choice: { type: 'tool', name: CHECKLIST_TOOL.name },
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
      yield { type: 'delta', text: event.delta.partial_json };
    }
  }

  const message = await stream.finalMessage();
  assertNotTruncated(message.stop_reason);

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === CHECKLIST_TOOL.name,
  );
  if (!toolUse) throw new Error('AI không trả về dữ liệu có cấu trúc. Vui lòng thử lại.');

  const { result, model, warnings } = finalizeChecklist(toolUse.input);
  yield { type: 'done', result, model, warnings };
}
