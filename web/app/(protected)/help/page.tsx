import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { BookOpen, FileText } from 'lucide-react';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';

export const dynamic = 'force-static';

async function loadSop(): Promise<string> {
  return readFile(path.resolve(process.cwd(), '..', 'SOP.md'), 'utf8');
}

export default async function HelpPage() {
  const sop = await loadSop();

  return (
    <PageContainer>
      <PageHeader
        title="Help & Standard Operating Procedures"
        description="Employee reference for using Phaze ERP, including workflows, responsibilities and access rules."
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <BookOpen className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">How to use this guide</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the table of contents to jump to a module. This page is
            generated directly from the maintained SOP document.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-8">
          <article className="mx-auto max-w-5xl text-sm leading-7 text-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
              skipHtml
              components={{
                h1: ({ children, ...props }) => (
                  <h1
                    className="mb-5 scroll-mt-20 text-2xl font-bold tracking-tight sm:text-3xl"
                    {...props}
                  >
                    {children}
                  </h1>
                ),
                h2: ({ children, ...props }) => (
                  <h2
                    className="mb-3 mt-10 scroll-mt-20 border-b pb-2 text-xl font-semibold tracking-tight"
                    {...props}
                  >
                    {children}
                  </h2>
                ),
                h3: ({ children, ...props }) => (
                  <h3
                    className="mb-2 mt-7 scroll-mt-20 text-lg font-semibold"
                    {...props}
                  >
                    {children}
                  </h3>
                ),
                h4: ({ children, ...props }) => (
                  <h4
                    className="mb-2 mt-5 scroll-mt-20 font-semibold"
                    {...props}
                  >
                    {children}
                  </h4>
                ),
                p: ({ children, ...props }) => (
                  <p className="my-3 text-foreground/90" {...props}>
                    {children}
                  </p>
                ),
                a: ({ children, href = '', ...props }) => {
                  const external = /^https?:\/\//.test(href);
                  return (
                    <a
                      href={href}
                      className="font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                      target={external ? '_blank' : undefined}
                      rel={external ? 'noreferrer' : undefined}
                      {...props}
                    >
                      {children}
                    </a>
                  );
                },
                ul: ({ children, ...props }) => (
                  <ul
                    className="my-3 list-disc space-y-1 pl-6 marker:text-muted-foreground"
                    {...props}
                  >
                    {children}
                  </ul>
                ),
                ol: ({ children, ...props }) => (
                  <ol
                    className="my-3 list-decimal space-y-1 pl-6 marker:font-medium"
                    {...props}
                  >
                    {children}
                  </ol>
                ),
                blockquote: ({ children, ...props }) => (
                  <blockquote
                    className="my-4 border-l-4 border-primary/30 bg-muted/40 px-4 py-1 text-muted-foreground"
                    {...props}
                  >
                    {children}
                  </blockquote>
                ),
                code: ({ children, className, ...props }) => (
                  <code
                    className={`${className ?? ''} rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]`}
                    {...props}
                  >
                    {children}
                  </code>
                ),
                pre: ({ children, ...props }) => (
                  <pre
                    className="my-4 overflow-x-auto rounded-lg border bg-slate-950 p-4 text-sm text-slate-100"
                    {...props}
                  >
                    {children}
                  </pre>
                ),
                table: ({ children, ...props }) => (
                  <div className="my-5 overflow-x-auto rounded-lg border">
                    <table
                      className="w-full min-w-[40rem] border-collapse text-left text-sm"
                      {...props}
                    >
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children, ...props }) => (
                  <thead className="bg-muted/70" {...props}>
                    {children}
                  </thead>
                ),
                th: ({ children, ...props }) => (
                  <th
                    className="border-b px-3 py-2 font-semibold"
                    {...props}
                  >
                    {children}
                  </th>
                ),
                td: ({ children, ...props }) => (
                  <td className="border-b px-3 py-2 align-top" {...props}>
                    {children}
                  </td>
                ),
                hr: (props) => <hr className="my-8 border-border" {...props} />,
              }}
            >
              {sop}
            </ReactMarkdown>
          </article>
        </CardContent>
      </Card>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5" />
        Source: SOP.md
      </p>
    </PageContainer>
  );
}
