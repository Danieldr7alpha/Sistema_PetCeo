import { X } from "lucide-react";

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/45 p-0 sm:items-start sm:p-4">
      <div className="panel max-h-[94dvh] w-full max-w-3xl overflow-hidden rounded-b-none rounded-t-2xl shadow-2xl sm:mt-8 sm:max-h-[calc(100dvh-5rem)] sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn btn-secondary !h-11 !w-11 !p-0" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>
        <div className="max-h-[calc(94dvh-68px)] overflow-y-auto p-4 pb-[max(20px,env(safe-area-inset-bottom))] sm:max-h-[calc(100dvh-9rem)] sm:p-5">{children}</div>
      </div>
    </div>
  );
}
