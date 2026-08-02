import { CalendarDays, ChevronDown, ChevronRight, CircleDollarSign, Landmark, LayoutDashboard, Menu, Package, PawPrint, Users, X } from "lucide-react";
import { useState } from "react";
import type { Session } from "../lib/api";

const items = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "appointments", label: "Agenda", icon: CalendarDays },
  { key: "customers", label: "Clientes", icon: Users },
  { key: "memberships", label: "Mensalistas", icon: PawPrint },
  { key: "products", label: "Produtos", icon: Package },
  { key: "checkout", label: "Caixa", icon: CircleDollarSign },
  { key: "financial", label: "Financeiro", icon: Landmark }
];

const cashSubmenus = [
  { key: "checkout", label: "Ponto de Venda" },
  { key: "checkout:pending", label: "Pedidos Pendentes" },
  { key: "checkout:reports", label: "Relatório" },
  { key: "checkout:transfer", label: "Transferência" },
  { key: "checkout:consumption", label: "Consumo" },
  { key: "checkout:close", label: "Fechar Caixa" }
];

const financialSubmenus = [
  { key: "financial", label: "Visão geral" },
  { key: "financial:accounts", label: "Contas financeiras" },
  { key: "financial:methods", label: "Formas de recebimento" },
  { key: "financial:receivables", label: "Recebimentos previstos" },
  { key: "financial:payables", label: "Contas a pagar" },
  { key: "financial:movements", label: "Movimentações" },
  { key: "financial:reports", label: "Relatórios" }
];

type Props = {
  session: Session;
  active: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
};

export function Layout({ session, active, onNavigate, onLogout, children }: Props) {
  const [open, setOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(active.startsWith("checkout"));
  const [financialOpen, setFinancialOpen] = useState(active.startsWith("financial"));
  const sidebar = (
    <aside className="flex h-full w-72 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
        <div>
          <p className="text-sm font-semibold text-brand-700">CEO Pet AI</p>
          <p className="text-xs text-slate-500">{session.company.name}</p>
        </div>
        <button className="btn btn-secondary md:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={16} /></button>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          if (item.key === "financial" && session.user.role !== "ADMIN") return null;
          const Icon = item.icon;
          const selected = item.key === "checkout" ? active.startsWith("checkout") : item.key === "financial" ? active.startsWith("financial") : active === item.key;
          if (item.key === "checkout") {
            return (
              <div key={item.key}>
                <button className={`btn w-full justify-start ${selected ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { setCashOpen(!cashOpen); if (!selected) onNavigate("checkout"); }}>
                  <Icon size={18} /> {item.label} <span className="ml-auto">{cashOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                </button>
                {cashOpen && <div className="mt-1 grid gap-1 pl-7">
                  {cashSubmenus.map((submenu) => {
                    const submenuActive = active === submenu.key || (submenu.key === "checkout" && active === "checkout");
                    return <button key={submenu.key} className={`rounded-lg px-3 py-2 text-left text-sm ${submenuActive ? "bg-brand-100 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { onNavigate(submenu.key); setOpen(false); }}>{submenu.label}</button>;
                  })}
                </div>}
              </div>
            );
          }
          if (item.key === "financial") {
            return <div key={item.key}>
              <button className={`btn w-full justify-start ${selected ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { setFinancialOpen(!financialOpen); if (!selected) onNavigate("financial"); }}>
                <Icon size={18} /> {item.label} <span className="ml-auto">{financialOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
              </button>
              {financialOpen && <div className="mt-1 grid gap-1 pl-7">{financialSubmenus.map((submenu) => <button key={submenu.key} className={`rounded-lg px-3 py-2 text-left text-sm ${active === submenu.key ? "bg-brand-100 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { onNavigate(submenu.key); setOpen(false); }}>{submenu.label}</button>)}</div>}
            </div>;
          }
          return (
            <button key={item.key} className={`btn w-full justify-start ${selected ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { onNavigate(item.key); setOpen(false); }}>
              <Icon size={18} /> {item.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <p className="text-sm font-medium">{session.user.name}</p>
        <p className="text-xs text-slate-500">{session.user.role}</p>
        <button className="btn btn-secondary mt-3 w-full" onClick={onLogout}>Sair</button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen md:flex">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <strong>CEO Pet AI</strong>
        <button className="btn btn-secondary" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={18} /></button>
      </header>
      <div className="fixed inset-y-0 left-0 z-30 hidden md:block">{sidebar}</div>
      {open && <div className="fixed inset-0 z-40 bg-slate-950/30 md:hidden" onClick={() => setOpen(false)}><div className="h-full" onClick={(e) => e.stopPropagation()}>{sidebar}</div></div>}
      <main className="flex-1 p-4 md:ml-72 md:p-6">{children}</main>
    </div>
  );
}
