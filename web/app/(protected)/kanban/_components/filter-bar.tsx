'use client';

import { X } from 'lucide-react';
import type {
  CardFilter,
  KanbanBoardMember,
  KanbanSprint,
} from '../../../lib/kanban';
import type { LeadPriority } from '../../../lib/types';
import { Select } from '../../../components/ui/select';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';

/**
 * Board filter bar (spec §3). Emits a CardFilter; the board re-queries the
 * server-side filtered endpoint on change (never filters loaded data), so it
 * stays correct as the board grows. Empty string → field omitted from filter.
 */
export function FilterBar({
  filter,
  onChange,
  sprints,
  members,
}: {
  filter: CardFilter;
  onChange: (next: CardFilter) => void;
  sprints: KanbanSprint[];
  members: KanbanBoardMember[];
}) {
  function set<K extends keyof CardFilter>(key: K, value: string) {
    const next = { ...filter };
    if (value) next[key] = value as CardFilter[K];
    else delete next[key];
    onChange(next);
  }

  const active = Object.keys(filter).length > 0;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Due after
        <Input
          type="date"
          value={filter.dueAfter ?? ''}
          onChange={(e) => set('dueAfter', e.target.value)}
          className="h-8 w-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Due before
        <Input
          type="date"
          value={filter.dueBefore ?? ''}
          onChange={(e) => set('dueBefore', e.target.value)}
          className="h-8 w-40"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Assignee
        <Select
          value={filter.assigneeId ?? ''}
          onChange={(e) => set('assigneeId', e.target.value)}
          className="h-8 w-44"
        >
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName ?? m.employeeEmail ?? m.employeeId}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Created by
        <Select
          value={filter.createdBy ?? ''}
          onChange={(e) => set('createdBy', e.target.value)}
          className="h-8 w-44"
        >
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName ?? m.employeeEmail ?? m.employeeId}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Sprint
        <Select
          value={filter.sprintId ?? ''}
          onChange={(e) => set('sprintId', e.target.value)}
          className="h-8 w-44"
        >
          <option value="">Any sprint</option>
          <option value="none">No sprint</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Priority
        <Select
          value={filter.priority ?? ''}
          onChange={(e) => set('priority', e.target.value as LeadPriority | '')}
          className="h-8 w-32"
        >
          <option value="">Any</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </Select>
      </label>

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({})}
          className="mb-0.5"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      )}
    </div>
  );
}
