/**
 * Sidebar icon resolution, split out of sidebar.tsx so that file can stay about
 * navigation behaviour (accordion, search, pins) rather than a 90-line icon
 * lookup. Logic is unchanged.
 */

import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  CalendarRange,
  CheckSquare2,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  ContactRound,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  GraduationCap,
  IndianRupee,
  LayoutDashboard,
  Package,
  PackageCheck,
  ReceiptText,
  Rocket,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Target,
  Truck,
  UserPlus,
  Users,
  UsersRound,
  Warehouse,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Route-aware icon selection keeps the nav model serializable and guarantees
 * every current/future menu entry receives an icon. More-specific routes must
 * be checked before their broader module prefixes.
 */
export function iconForHref(href: string): LucideIcon {
  if (href === '/dashboard') return LayoutDashboard;
  if (href === '/help') return BookOpen;
  if (href === '/learning') return GraduationCap;
  if (href === '/vault' || href.includes('/documents')) return FolderOpen;
  if (href === '/kanban') return Columns3;
  if (href.includes('/sprints')) return CalendarRange;
  if (href === '/project-kickoff') return Rocket;
  if (href === '/plm') return Workflow;

  if (href.includes('pending-approval') || href.includes('leave-approvals'))
    return BadgeCheck;
  if (href.includes('attendance')) return CalendarDays;
  if (href.includes('employees') || href.includes('/roster')) return Users;
  if (href.includes('onboard') || href.includes('pending-access'))
    return UserPlus;
  if (href.includes('verticals')) return Building2;
  if (href.includes('auditor')) return ShieldCheck;
  if (
    href.includes('payroll') ||
    href.includes('salary') ||
    href.includes('payslip')
  )
    return IndianRupee;
  if (href.includes('statutory')) return ScrollText;

  if (href.includes('/leads')) return ContactRound;
  if (href.includes('/opportunities')) return Target;
  if (href.includes('/bids') || href.includes('confirmation-sheets'))
    return FileText;
  if (href.includes('/orders') || href.includes('purchase-orders'))
    return ShoppingCart;
  if (href.includes('/customers')) return Building2;
  if (href.includes('/products') || href.includes('/items')) return Package;

  if (href.includes('/vendors') || href.includes('/suppliers'))
    return UsersRound;
  if (href.includes('/rfqs')) return FileCheck2;
  if (href.includes('/bom')) return Boxes;
  if (href.includes('/inventory')) return Warehouse;
  if (href.includes('/grn')) return PackageCheck;
  if (href.includes('material-issue')) return Warehouse;
  if (href.includes('/dispatch')) return Truck;
  if (href.includes('/otd')) return Gauge;

  if (href.includes('expense-claim') || href.includes('expense-categories'))
    return ReceiptText;
  if (href.includes('/daybook')) return ScrollText;
  if (href.includes('/contra')) return ArrowLeftRight;
  if (href.includes('/invoices') || href.includes('/adjustments'))
    return ReceiptText;
  if (href.includes('/payments') || href.includes('/receipts')) return Banknote;
  if (href.includes('calendar')) return CalendarDays;
  if (href.includes('/accounts') || href.includes('/journals'))
    return ScrollText;
  if (
    href.includes('/reports') ||
    href.includes('/analytics') ||
    href.includes('/summary')
  )
    return BarChart3;
  if (
    href.includes('compliance') ||
    href.includes('filings') ||
    href.includes('period-close')
  )
    return ShieldCheck;

  if (href.includes('/inspections') || href.includes('/audits'))
    return ClipboardCheck;
  if (href.includes('/plans') || href.includes('/templates'))
    return ClipboardList;
  if (
    href.includes('/ncr') ||
    href.includes('/capas') ||
    href.includes('/complaints')
  )
    return Wrench;
  if (href.includes('/calibration')) return Gauge;
  if (href.includes('/design')) return Settings2;

  return CheckSquare2;
}
