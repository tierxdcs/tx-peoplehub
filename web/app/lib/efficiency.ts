import { apiFetch } from './api';

export type EfficiencyComponent = {
  percentage: number | null;
  onTime: number;
  total: number;
};

export type EfficiencyScore = {
  score: number | null;
  windowDays: number;
  windowStart: string;
  ping: EfficiencyComponent;
  task: EfficiencyComponent;
};

export function getMyEfficiencyScore(): Promise<EfficiencyScore> {
  return apiFetch<EfficiencyScore>('/dashboard/efficiency');
}
