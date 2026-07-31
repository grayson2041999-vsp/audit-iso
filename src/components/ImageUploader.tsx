'use client';

import { useRef, useState } from 'react';

export type UploadedImage = {
  key: string;
  fileName: string;
  contentType: string;
  size: number;
  previewUrl: string;
};

export function ImageUploader({
  images,
  onChange,
}: {
  images: UploadedImage[];
  onChange: (imgs: UploadedImage[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    setBusy(true);
    const files = Array.from(fileList);

    try {
      const res = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: files.map((f) => ({ fileName: f.name, contentType: f.type, size: f.size })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không lấy được link tải lên.');

      const uploaded: UploadedImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const u = data.uploads[i];
        const put = await fetch(u.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': f.type },
          body: f,
        });
        if (!put.ok) throw new Error(`Tải ảnh "${f.name}" lên R2 thất bại.`);
        uploaded.push({
          key: u.key,
          fileName: f.name,
          contentType: f.type,
          size: f.size,
          previewUrl: URL.createObjectURL(f),
        });
      }
      onChange([...images, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi tải ảnh.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <label className="label">
        Hình ảnh hiện trường <span className="font-normal text-slate-400">(không bắt buộc)</span>
      </label>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 hover:border-brand-400 hover:bg-brand-50/40"
      >
        {busy ? 'Đang tải ảnh lên Cloudflare R2…' : 'Kéo thả ảnh vào đây hoặc bấm để chọn (JPG/PNG/WebP, ≤ 10 MB)'}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {images.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((img) => (
            <li key={img.key} className="group relative overflow-hidden rounded-lg border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.previewUrl} alt={img.fileName} className="h-24 w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(images.filter((i) => i.key !== img.key))}
                className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
              >
                Xoá
              </button>
              <p className="truncate px-2 py-1 text-[11px] text-slate-500">{img.fileName}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
