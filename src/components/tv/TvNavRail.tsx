'use client';

import { Heart, Home, Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { useTvFocusable } from './TvFocusProvider';

const NAV_ITEMS = [
  { href: '/tv', label: '首页', icon: Home },
  { href: '/tv/search', label: '搜索', icon: Search },
  { href: '/tv/favorites', label: '收藏', icon: Heart },
] as const;

// Nav rail is row 0, content starts at row 1+
const NAV_ROW = 0;

export default function TvNavRail() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className='tv-nav-rail'>
      {NAV_ITEMS.map((item, index) => {
        const isActive =
          item.href === '/tv'
            ? pathname === '/tv'
            : pathname.startsWith(item.href);
        return (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            isActive={isActive}
            col={index}
            onClick={() => router.push(item.href)}
          />
        );
      })}
    </nav>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
  col,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  isActive: boolean;
  col: number;
  onClick: () => void;
}) {
  const ref = useTvFocusable(NAV_ROW, col);

  return (
    <button
      ref={ref}
      className={`tv-nav-item ${isActive ? 'active' : ''}`}
      data-href={href}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClick();
        }
      }}
    >
      <Icon size={24} />
      <span className='tv-nav-label'>{label}</span>
    </button>
  );
}
