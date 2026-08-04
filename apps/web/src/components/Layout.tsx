import { Bell, CalendarDays, ChevronDown, ChevronRight, CircleDollarSign, Landmark, LayoutDashboard, Menu, Package, PawPrint, UserCog, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, dateBR, type Session } from "../lib/api";

const items = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "appointments", label: "Agenda", icon: CalendarDays },
  { key: "customers", label: "Clientes", icon: Users },
  { key: "memberships", label: "Mensalistas", icon: PawPrint },
  { key: "products", label: "Produtos", icon: Package },
  { key: "checkout", label: "Caixa", icon: CircleDollarSign },
  { key: "financial", label: "Financeiro", icon: Landmark },
  { key: "team", label: "Equipe", icon: UserCog }
];

const cashSubmenus = [
  { key: "checkout", label: "Ponto de Venda" },
  { key: "checkout:pending", label: "Pedidos Pendentes" },
  { key: "checkout:reports", label: "Relatório" },
  { key: "checkout:closing-reports", label: "Relatórios de fechamento" },
  { key: "checkout:withdrawal", label: "Sangria" },
  { key: "checkout:supply", label: "Suprimento" },
  { key: "checkout:transfer", label: "Transferência" },
  { key: "checkout:consumption", label: "Consumo" },
  { key: "checkout:close", label: "Fechar Caixa" }
];

const financialSubmenus = [
  { key: "financial", label: "Visão geral" },
  { key: "financial:accounts", label: "Bancos" },
  { key: "financial:cash-registers", label: "Caixas" },
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ items: { id: string; title: string; message: string; readAt?: string | null; createdAt: string }[]; unread: number }>({ items: [], unread: 0 });
  async function loadNotifications() { try { setNotifications(await api("/notifications")); } catch { /* conexão já é tratada pelo aplicativo */ } }
  useEffect(() => { void loadNotifications(); const timer = window.setInterval(loadNotifications, 30000); return () => window.clearInterval(timer); }, [session.company.id]);
  async function readNotification(id: string) { await api(`/notifications/${id}/read`, { method: "PATCH" }); await loadNotifications(); }
  const canAccess = (key: string) => session.user.role === "ADMIN" || Boolean(session.user.permissions?.includes(key) || (!key.includes(":") && session.user.permissions?.some((permission) => permission.startsWith(`${key}:`))));
  const sidebar = (
    <aside className="flex h-full w-[min(88vw,320px)] flex-col border-r border-slate-200 bg-white lg:w-72">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
        <div>
          <p className="text-sm font-semibold text-brand-700">CEO Pet AI</p>
          <p className="text-xs text-slate-500">{session.company.name}</p>
        </div>
        <button className="btn btn-secondary lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={20} /></button>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          if (!canAccess(item.key)) return null;
          const Icon = item.icon;
          const selected = item.key === "checkout" ? active.startsWith("checkout") : item.key === "financial" ? active.startsWith("financial") : active === item.key;
          if (item.key === "checkout") {
            return (
              <div key={item.key}>
                <button className={`btn w-full !justify-start text-left ${selected ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { setCashOpen(!cashOpen); if (!selected) onNavigate("checkout"); }}>
                  <Icon size={18} /> {item.label} <span className="ml-auto">{cashOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                </button>
                {cashOpen && <div className="mt-1 grid gap-1 pl-7">
                  {cashSubmenus.filter((submenu) => canAccess(submenu.key)).map((submenu) => {
                    const submenuActive = active === submenu.key || (submenu.key === "checkout" && active === "checkout");
                    return <button key={submenu.key} className={`rounded-lg px-3 py-2 text-left text-sm ${submenuActive ? "bg-brand-100 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { onNavigate(submenu.key); setOpen(false); }}>{submenu.label}</button>;
                  })}
                </div>}
              </div>
            );
          }
          if (item.key === "financial") {
            return <div key={item.key}>
              <button className={`btn w-full !justify-start text-left ${selected ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { setFinancialOpen(!financialOpen); if (!selected) onNavigate("financial"); }}>
                <Icon size={18} /> {item.label} <span className="ml-auto">{financialOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
              </button>
              {financialOpen && <div className="mt-1 grid gap-1 pl-7">{financialSubmenus.filter((submenu) => canAccess(submenu.key)).map((submenu) => <button key={submenu.key} className={`rounded-lg px-3 py-2 text-left text-sm ${active === submenu.key ? "bg-brand-100 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { onNavigate(submenu.key); setOpen(false); }}>{submenu.label}</button>)}</div>}
            </div>;
          }
          return (
            <button key={item.key} className={`btn w-full !justify-start text-left ${selected ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => { onNavigate(item.key); setOpen(false); }}>
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
    <div className="min-h-screen lg:flex">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>
      {open && <div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)}><div className="h-full shadow-2xl" onClick={(e) => e.stopPropagation()}>{sidebar}</div></div>}
      <main className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-5 md:px-6 md:pt-6 lg:ml-72 lg:p-6">
        <div className="relative mb-3 flex justify-end">
          <button className="btn btn-secondary relative min-h-11" type="button" onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={19} /><span className="hidden sm:inline">Notificações</span>{notifications.unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{notifications.unread}</span>}</button>
          {notificationsOpen && <div className="absolute right-0 top-12 z-30 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"><div className="flex items-center justify-between border-b border-slate-100 p-3"><b>Notificações</b>{notifications.unread > 0 && <button className="text-xs font-semibold text-blue-700" onClick={async () => { await api("/notifications/read-all", { method: "PATCH" }); await loadNotifications(); }}>Marcar todas como lidas</button>}</div><div className="max-h-80 overflow-y-auto">{notifications.items.map((item) => <button className={`block w-full border-b border-slate-100 p-3 text-left ${item.readAt ? "bg-white" : "bg-blue-50"}`} key={item.id} onClick={() => readNotification(item.id)}><b className="text-sm">{item.title}</b><p className="text-sm text-slate-600">{item.message}</p><span className="text-xs text-slate-400">{dateBR(item.createdAt)}</span></button>)}{!notifications.items.length && <p className="p-5 text-center text-sm text-slate-500">Nenhuma notificação.</p>}</div></div>}
        </div>
        {children}
      </main>
      <nav className="mobile-app-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 shadow-[0_-4px_18px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        {[items[0], items[1], items[2], items[5]].filter((item) => canAccess(item.key)).map((item) => { const Icon = item.icon; const selected = item.key === "checkout" ? active.startsWith("checkout") : active === item.key; return <button key={item.key} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium ${selected ? "bg-brand-50 text-brand-700" : "text-slate-500"}`} onClick={() => onNavigate(item.key)}><Icon size={21} /><span>{item.label}</span></button>; })}
        <button className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium text-slate-500" onClick={() => setOpen(true)}><Menu size={21} /><span>Menu</span></button>
      </nav>
    </div>
  );
}
