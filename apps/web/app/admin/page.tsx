import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Рабочее место" };

export default function AdminPage() {
  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">АН-30 для персонала</p>
          <h1>Рабочая очередь</h1>
        </div>
        <Link className="secondary-action" href="/">Вернуться в магазин</Link>
      </header>
      <section className="empty-workspace" aria-labelledby="workspace-state">
        <h2 id="workspace-state">Данные ещё не подключены</h2>
        <p>Заказы, обращения и чаты появятся здесь после запуска автономного API и серверной проверки роли.</p>
      </section>
    </main>
  );
}
