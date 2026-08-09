'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Edit3,
  LockKeyhole,
  Play,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { useVertical } from '../../lib/use-vertical';
import { useVerticalOptions } from '../../lib/verticals';
import { flowForVertical, VERTICAL_FLOWS } from '../../lib/process-flows';
import {
  createLearningCourse,
  LearningCourse,
  LearningLesson,
  listLearningCourses,
  publishLearningCourse,
  saveLearningProgress,
  updateLearningCourse,
} from '../../lib/learning';
import { ApiError } from '../../lib/api';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select } from '../../components/ui/select';
import { useToast } from '../../components/ui/toaster';
import { cn } from '../../lib/utils';

export default function LearningPage() {
  const { user } = useAuth();
  const { vertical } = useVertical();
  const { verticals } = useVerticalOptions();
  const toast = useToast();
  const [courses, setCourses] = useState<LearningCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<LearningCourse | null>(null);
  const [editing, setEditing] = useState<LearningCourse | 'new' | null>(null);
  const flow =
    flowForVertical(vertical?.code) ??
    (user?.role === 'SUPER_ADMIN' ? VERTICAL_FLOWS[0] : null);
  const canAuthor =
    user?.role === 'SUPER_ADMIN' ||
    (!!vertical?.ownerId && vertical.ownerId === user?.sub);
  const load = useCallback(
    () =>
      listLearningCourses()
        .then(setCourses)
        .catch((error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not load courses',
          ),
        )
        .finally(() => setLoading(false)),
    [toast],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Learning Centre"
        description="Learn your end-to-end process through short lessons, realistic checkpoints and guided practice."
        action={
          canAuthor ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Draft course
            </Button>
          ) : undefined
        }
      />
      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-primary/80 p-6 text-white shadow-xl sm:p-9">
        <div className="absolute -right-20 -top-24 size-72 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">
            <Sparkles className="size-4" /> Your learning journey
          </p>
          <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">
            Understand the whole process—not just your screen.
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
            Follow the handoffs, practise decisions and learn why every approval
            exists.
          </p>
        </div>
      </section>

      {flow && (
        <section>
          <div className="mb-3">
            <h2 className="text-xl font-semibold">Your core process</h2>
            <p className="text-sm text-muted-foreground">
              Assigned automatically from your vertical.
            </p>
          </div>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="grid lg:grid-cols-[0.9fr_1.6fr]">
                <div className="bg-primary/5 p-6">
                  <Compass className="size-8 text-primary" />
                  <h3 className="mt-4 text-2xl font-semibold">{flow.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {flow.summary}
                  </p>
                  <a
                    className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    href={`/help#${flow.codes[0]}`}
                  >
                    Explore process <ChevronRight className="size-4" />
                  </a>
                </div>
                <div className="grid gap-2 p-5 sm:grid-cols-2">
                  {flow.steps.map((step, index) => (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 rounded-xl border p-3"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{step.label}</p>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold">Assigned courses</h2>
            <p className="text-sm text-muted-foreground">
              Short, focused learning created by your process owner.
            </p>
          </div>
          <Badge variant="muted">
            {courses.filter((course) => course.status === 'PUBLISHED').length}{' '}
            available
          </Badge>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading courses…</p>
        ) : courses.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <BookOpen className="size-10 text-muted-foreground" />
              <h3 className="mt-3 font-semibold">No authored courses yet</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Your visual core process is available above. Your process owner
                can add deeper lessons and scenarios here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => {
              const total = course.content.lessons.length;
              const complete = course.progress?.completedLessonKeys.length ?? 0;
              const percent = total ? Math.round((complete / total) * 100) : 0;
              return (
                <Card
                  key={course.id}
                  className="group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="h-1.5 bg-gradient-to-r from-primary to-cyan-400" />
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                        <BookOpen className="size-5" />
                      </div>
                      <div className="flex gap-1">
                        {course.status === 'DRAFT' && (
                          <Badge variant="warning">
                            <LockKeyhole className="mr-1 size-3" /> Draft
                          </Badge>
                        )}
                        {course.canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(course)}
                          >
                            <Edit3 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <h3 className="mt-4 text-lg font-semibold">
                      {course.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {course.summary}
                    </p>
                    <div className="mt-5">
                      <div className="mb-1 flex justify-between text-xs">
                        <span>
                          {complete} of {total} lessons
                        </span>
                        <span className="font-medium">{percent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                    <Button
                      className="mt-5 w-full"
                      variant={percent ? 'outline' : 'default'}
                      onClick={() => setPlaying(course)}
                    >
                      <Play className="size-4" />{' '}
                      {percent ? 'Continue course' : 'Start course'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      {playing && (
        <CoursePlayer
          course={playing}
          onClose={() => setPlaying(null)}
          onProgress={(keys) => {
            setCourses((current) =>
              current.map((course) =>
                course.id === playing.id
                  ? {
                      ...course,
                      progress: {
                        completedLessonKeys: keys,
                        completedAt:
                          keys.length === course.content.lessons.length
                            ? new Date().toISOString()
                            : null,
                      },
                    }
                  : course,
              ),
            );
            void saveLearningProgress(playing.id, keys);
          }}
        />
      )}
      {editing && (
        <CourseEditor
          course={editing === 'new' ? null : editing}
          verticals={
            user?.role === 'SUPER_ADMIN'
              ? verticals
              : vertical
                ? [vertical]
                : []
          }
          defaultVerticalId={vertical?.id ?? ''}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}

function CoursePlayer({
  course,
  onClose,
  onProgress,
}: {
  course: LearningCourse;
  onClose: () => void;
  onProgress: (keys: string[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(
    course.progress?.completedLessonKeys ?? [],
  );
  const [choice, setChoice] = useState<number | null>(null);
  const lesson = course.content.lessons[index];
  const correct =
    lesson.checkpoint && choice === lesson.checkpoint.correctOption;
  function finishLesson() {
    if (lesson.checkpoint && !correct) return;
    const next = [...new Set([...completed, lesson.key])];
    setCompleted(next);
    onProgress(next);
    if (index < course.content.lessons.length - 1) {
      setIndex(index + 1);
      setChoice(null);
    } else {
      onClose();
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0">
        <div className="bg-gradient-to-r from-primary/15 to-cyan-500/10 p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Lesson {index + 1} of {course.content.lessons.length}
          </p>
          <DialogTitle className="mt-2 text-2xl">{lesson.title}</DialogTitle>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-background/70">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${((index + 1) / course.content.lessons.length) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className="p-6">
          <p className="whitespace-pre-wrap text-base leading-7">
            {lesson.body}
          </p>
          {lesson.checkpoint && (
            <div className="mt-6 rounded-2xl border bg-muted/30 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Knowledge checkpoint
              </p>
              <h3 className="mt-2 font-semibold">
                {lesson.checkpoint.question}
              </h3>
              <div className="mt-4 grid gap-2">
                {lesson.checkpoint.options.map((option, optionIndex) => (
                  <button
                    key={option}
                    onClick={() => setChoice(optionIndex)}
                    className={cn(
                      'rounded-xl border p-3 text-left text-sm transition',
                      choice === optionIndex && 'border-primary bg-primary/10',
                      choice !== null &&
                        optionIndex === lesson.checkpoint?.correctOption &&
                        'border-success/50 bg-success/10',
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {choice !== null && (
                <p
                  className={cn(
                    'mt-3 text-sm font-medium',
                    correct ? 'text-success' : 'text-destructive',
                  )}
                >
                  {correct
                    ? 'Correct — you can continue.'
                    : 'Not quite. Review the lesson and try again.'}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="border-t p-5">
          <Button
            variant="outline"
            disabled={index === 0}
            onClick={() => {
              setIndex(index - 1);
              setChoice(null);
            }}
          >
            Previous
          </Button>
          <Button
            disabled={!!lesson.checkpoint && !correct}
            onClick={finishLesson}
          >
            {index === course.content.lessons.length - 1 ? (
              <>
                <Award className="size-4" /> Complete course
              </>
            ) : (
              <>
                Complete & continue <ChevronRight className="size-4" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CourseEditor({
  course,
  verticals,
  defaultVerticalId,
  onClose,
  onSaved,
}: {
  course: LearningCourse | null;
  verticals: { id: string; name: string }[];
  defaultVerticalId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(course?.title ?? '');
  const [summary, setSummary] = useState(course?.summary ?? '');
  const [verticalId, setVerticalId] = useState(
    course?.verticalId ?? defaultVerticalId,
  );
  const [lessons, setLessons] = useState<LearningLesson[]>(
    course?.content.lessons ?? [
      { key: crypto.randomUUID(), title: '', body: '' },
    ],
  );
  const [saving, setSaving] = useState(false);
  function updateLesson(index: number, patch: Partial<LearningLesson>) {
    setLessons((current) =>
      current.map((lesson, i) =>
        i === index ? { ...lesson, ...patch } : lesson,
      ),
    );
  }
  async function save(publish = false) {
    if (
      !title.trim() ||
      !summary.trim() ||
      !verticalId ||
      lessons.some((lesson) => !lesson.title.trim() || !lesson.body.trim())
    ) {
      toast.error('Title, summary, vertical and every lesson are required');
      return;
    }
    setSaving(true);
    try {
      const saved = course
        ? await updateLearningCourse(course.id, {
            title,
            summary,
            content: { lessons },
          })
        : await createLearningCourse({
            title,
            summary,
            verticalId,
            content: { lessons },
          });
      if (publish) await publishLearningCourse(saved.id);
      toast.success(publish ? 'Course published' : 'Draft saved');
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save course',
      );
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{course ? 'Edit course' : 'Draft a course'}</DialogTitle>
          <DialogDescription>
            Create short lessons in plain language and add optional knowledge
            checkpoints.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course title" required>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Vertical" required>
            <Select
              value={verticalId}
              onChange={(event) => setVerticalId(event.target.value)}
              disabled={!!course}
            >
              <option value="">Select vertical</option>
              {verticals.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="What employees will learn"
            required
            className="sm:col-span-2"
          >
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={2}
            />
          </Field>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Lessons</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setLessons((current) => [
                  ...current,
                  { key: crypto.randomUUID(), title: '', body: '' },
                ])
              }
            >
              <Plus className="size-4" /> Add lesson
            </Button>
          </div>
          {lessons.map((lesson, index) => (
            <div key={lesson.key} className="rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <Input
                  placeholder="Lesson title"
                  value={lesson.title}
                  onChange={(event) =>
                    updateLesson(index, { title: event.target.value })
                  }
                />
              </div>
              <Textarea
                className="mt-3"
                rows={4}
                placeholder="Explain what happens, why it matters, who is involved and what comes next…"
                value={lesson.body}
                onChange={(event) =>
                  updateLesson(index, { body: event.target.value })
                }
              />
              <div className="mt-3 border-t pt-3">
                {lesson.checkpoint ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        Knowledge checkpoint
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateLesson(index, { checkpoint: undefined })
                        }
                      >
                        Remove checkpoint
                      </Button>
                    </div>
                    <Input
                      placeholder="Question"
                      value={lesson.checkpoint.question}
                      onChange={(event) =>
                        updateLesson(index, {
                          checkpoint: {
                            ...lesson.checkpoint!,
                            question: event.target.value,
                          },
                        })
                      }
                    />
                    {lesson.checkpoint.options.map((option, optionIndex) => (
                      <div
                        key={optionIndex}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="radio"
                          name={`correct-${lesson.key}`}
                          checked={
                            lesson.checkpoint?.correctOption === optionIndex
                          }
                          onChange={() =>
                            updateLesson(index, {
                              checkpoint: {
                                ...lesson.checkpoint!,
                                correctOption: optionIndex,
                              },
                            })
                          }
                          aria-label={`Mark answer ${optionIndex + 1} correct`}
                        />
                        <Input
                          placeholder={`Answer ${optionIndex + 1}`}
                          value={option}
                          onChange={(event) => {
                            const options = [...lesson.checkpoint!.options];
                            options[optionIndex] = event.target.value;
                            updateLesson(index, {
                              checkpoint: { ...lesson.checkpoint!, options },
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateLesson(index, {
                        checkpoint: {
                          question: '',
                          options: ['', '', ''],
                          correctOption: 0,
                        },
                      })
                    }
                  >
                    + Add checkpoint
                  </Button>
                )}
              </div>
              {lessons.length > 1 && (
                <Button
                  className="mt-2"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLessons((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove lesson
                </Button>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void save(false)}
          >
            Save draft
          </Button>
          <Button disabled={saving} onClick={() => void save(true)}>
            <Check className="size-4" /> Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
