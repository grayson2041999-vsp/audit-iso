import { z } from 'zod';
import type { CapaAction } from '@/lib/schema';

const dayRe = /^\d{4}-\d{2}-\d{2}$/;

/** Các trường sửa được của một mục khắc phục. */
export const capaFields = {
  content: z.string().trim().min(1, 'Nhập nội dung công việc cần thực hiện').max(4000),
  owner: z.string().trim().max(200).nullable().optional(),
  dueDate: z.string().regex(dayRe, 'Thời hạn không hợp lệ').nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'DONE']).optional(),
  completedDate: z.string().regex(dayRe, 'Ngày hoàn thành không hợp lệ').nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
};

/** Dạng gửi về trình duyệt. */
export function toRow(a: CapaAction) {
  return {
    id: a.id,
    findingId: a.findingId,
    content: a.content,
    owner: a.owner,
    dueDate: a.dueDate,
    status: a.status,
    completedDate: a.completedDate,
    note: a.note,
    updatedAt: a.updatedAt.toISOString(),
  };
}
