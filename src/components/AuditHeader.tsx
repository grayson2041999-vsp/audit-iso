import { formatDateOnly } from '@/lib/utils';
import {
  STANDARD_SHORT, STANDARD_STYLE, STANDARD_DOMAIN, sortStandards,
} from '@/lib/iso';
import { AUDIT_STATUS_LABELS, AUDIT_STATUS_STYLE } from '@/lib/audit-access';

type Audit = {
  organization: string;
  title: string;
  scope: string | null;
  standards: string[];
  leadAuditor: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: string;
};

/**
 * Khối tiêu đề đợt đánh giá, dùng chung cho trang trưởng đoàn và trang công khai.
 *
 * Mỗi thông tin một dòng có nhãn riêng thay vì nối bằng dấu chấm giữa — chuỗi
 * "ngày · trưởng đoàn · ba tiêu chuẩn" trước đây dài quá một dòng và không phân
 * biệt được đâu là nhãn đâu là giá trị.
 *
 * Tiêu chuẩn hiển thị bằng thẻ màu vì đó là thứ auditor cần nhận ra trước nhất
 * khi mở đợt — nó quyết định họ soi những điều khoản nào.
 */
export function AuditHeader({ audit, publicView = false }: { audit: Audit; publicView?: boolean }) {
  const standards = sortStandards(audit.standards);

  const days =
    audit.startDate && audit.endDate
      ? Math.round(
          (new Date(audit.endDate).getTime() - new Date(audit.startDate).getTime()) / 86_400_000,
        ) + 1
      : 0;

  return (
    <div className={publicView ? 'text-center' : ''}>
      {!publicView && (
        <div className="mb-2">
          <span className={`chip ring-transparent ${AUDIT_STATUS_STYLE[audit.status] ?? ''}`}>
            {AUDIT_STATUS_LABELS[audit.status] ?? audit.status}
          </span>
        </div>
      )}

      <p className="text-sm font-medium text-slate-500">{audit.organization}</p>
      <h1 className="mt-0.5 text-2xl font-semibold">{audit.title}</h1>

      <dl className={`mt-4 space-y-2.5 text-sm ${publicView ? 'inline-block text-left' : ''}`}>
        <Row label="Thời gian">
          <span className="font-medium">
            {formatDateOnly(audit.startDate)} → {formatDateOnly(audit.endDate)}
          </span>
          {days > 0 && <span className="ml-2 text-slate-500">({days} ngày)</span>}
        </Row>

        <Row label="Trưởng đoàn">
          {audit.leadAuditor ? (
            // Nền tối đặc — giá trị nổi nhất trong khối, tách hẳn khỏi các thẻ
            // tiêu chuẩn nhiều màu bên dưới nên không bị lẫn.
            <span className="inline-block rounded-md bg-slate-900 px-2.5 py-1 font-semibold text-white">
              {audit.leadAuditor}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </Row>

        <Row label="Tiêu chuẩn">
          {standards.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {standards.map((s) => (
                <span key={s} className={`chip ${STANDARD_STYLE[s]}`}>
                  {STANDARD_SHORT[s]}
                  <span className="ml-1.5 font-normal opacity-70">{STANDARD_DOMAIN[s]}</span>
                </span>
              ))}
            </span>
          )}
        </Row>

        {audit.scope && (
          <Row label="Phạm vi">
            <span className="text-slate-700">{audit.scope}</span>
          </Row>
        )}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-x-3 gap-y-1 sm:flex-row">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
