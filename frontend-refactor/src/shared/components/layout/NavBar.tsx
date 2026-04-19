import { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface NavItem {
  name: string;
  url: string;
  icon: LucideIcon;
}

interface NavBarProps {
  items: NavItem[];
  activeTab: string;
  onTabChange: (name: string) => void;
  className?: string;
}

export function NavBar({ items, activeTab, onTabChange, className }: NavBarProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.name;

        return (
          <button
            key={item.name}
            onClick={() => onTabChange(item.name)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-all duration-200 rounded-full flex items-center gap-1.5 hover:scale-[1.06] active:scale-[0.95]",
              isActive
                ? "text-white bg-[rgba(0,0,0,0.5)] backdrop-blur-md border border-[rgba(255,255,255,0.15)] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_16px_rgba(0,0,0,0.4)]"
                : "text-gray-400 hover:text-gray-200 border border-transparent"
            )}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`Navigate to ${item.name}`}
          >
            {isActive && (
              <>
                <div className="absolute inset-0 rounded-full bg-white/10" />
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-white" />
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-12 h-4 rounded-full bg-white/25 blur-md" />
              </>
            )}

            <span className="relative z-10" aria-hidden="true">
              <Icon size={16} strokeWidth={2} />
            </span>
            <span className="relative z-10 hidden md:inline">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}
