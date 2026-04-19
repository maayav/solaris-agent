import { Outlet } from 'react-router-dom';

export function DashboardLayout() {
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      <aside className="w-64 bg-card border-r border-border">
        <div className="p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Sidebar</h3>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
