import { apiFetch } from './api';

export interface LearningLesson {
  key: string;
  title: string;
  body: string;
  checkpoint?: { question: string; options: string[]; correctOption: number };
}
export interface LearningCourse {
  id: string;
  title: string;
  summary: string;
  verticalId: string;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  content: { lessons: LearningLesson[] };
  vertical: { id: string; name: string; code: string; ownerId: string | null };
  canEdit: boolean;
  progress: {
    completedLessonKeys: string[];
    completedAt: string | null;
  } | null;
}

export const listLearningCourses = () =>
  apiFetch<LearningCourse[]>('/learning/courses');
export const createLearningCourse = (input: {
  title: string;
  summary: string;
  verticalId: string;
  content: { lessons: LearningLesson[] };
}) =>
  apiFetch<LearningCourse>('/learning/courses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const updateLearningCourse = (
  id: string,
  input: Partial<{
    title: string;
    summary: string;
    content: { lessons: LearningLesson[] };
  }>,
) =>
  apiFetch<LearningCourse>(`/learning/courses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
export const publishLearningCourse = (id: string) =>
  apiFetch<LearningCourse>(`/learning/courses/${id}/publish`, {
    method: 'POST',
  });
export const saveLearningProgress = (
  id: string,
  completedLessonKeys: string[],
) =>
  apiFetch(`/learning/courses/${id}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ completedLessonKeys }),
  });
