import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The `gotenberg` namespace from src/core/config/configuration.ts. */
export interface GotenbergConfig {
  url?: string;
  timeoutMs: number;
}

/** Page geometry, in inches — the unit Gotenberg's form fields take. */
export interface PdfPageGeometry {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

/** A4 with the same 16/14/18 mm margins the browser-print path uses. */
export const A4_PORTRAIT: PdfPageGeometry = {
  width: 8.27,
  height: 11.69,
  marginTop: 0.63, // 16mm
  marginBottom: 0.71, // 18mm — a little deeper, to seat the page number
  marginLeft: 0.55, // 14mm
  marginRight: 0.55,
};

export interface HtmlToPdfOptions {
  /**
   * PDF metadata title. A viewer shows it in the tab/title bar, so it is what a
   * recipient sees before reading a single line of the document.
   */
  title?: string;
  /**
   * Extra files the HTML references by relative name (e.g. a logo
   * `<img src="letterhead-logo.png">`). Gotenberg resolves them out of the same
   * multipart upload.
   */
  assets?: { filename: string; content: Buffer; contentType: string }[];
  /**
   * Chromium footer template, rendered into the bottom margin on every page.
   * Use the `pageNumber` / `totalPages` classes for counters. Any content needs
   * an explicit font-size — Chromium's default inside these templates is
   * unreadably small.
   */
  footerHtml?: string;
  /** Chromium header template; same rules as footerHtml. */
  headerHtml?: string;
  geometry?: PdfPageGeometry;
}

/**
 * HTML → PDF rendering for outward-facing documents, via the Gotenberg
 * (Chromium) service already provisioned for Vault's office-document previews.
 *
 * Why a headless browser and not pdfkit — which this repo already uses for the
 * RFQ quote record (rfq-quote-pdf.ts): the documents that go to customers and
 * suppliers exist as React print components with a shared branded letterhead,
 * table-based running headers/footers and CSS pagination. Chromium renders that
 * markup directly; pdfkit would mean re-drawing each one by hand in absolute
 * coordinates. pdfkit stays the right tool for the RFQ quote, which is a plain
 * internal record with no print-component twin.
 *
 * Configuration is optional exactly as it is for email, R2 and Vault previews:
 * with no GOTENBERG_URL the app boots normally and only an actual render fails,
 * with a message naming the missing var.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly cfg: GotenbergConfig;

  constructor(config: ConfigService) {
    this.cfg = config.get<GotenbergConfig>('gotenberg') ?? {
      timeoutMs: 60_000,
    };
    if (!this.cfg.url) {
      this.logger.warn(
        'PDF rendering is disabled — set GOTENBERG_URL to enable it.',
      );
    }
  }

  /** True when a render will be attempted rather than rejected. */
  isConfigured(): boolean {
    return Boolean(this.cfg.url);
  }

  /**
   * Renders a complete HTML document to PDF bytes.
   *
   * Page size and margins are passed explicitly rather than left to the
   * document's `@page` rule: Gotenberg's own geometry fields are what reserve
   * the header/footer bands, so the two have to agree, and stating them here
   * keeps the result independent of which Gotenberg version answers.
   * `printBackground` is on because the letterhead's navy table header and zebra
   * rows are backgrounds, which Chromium drops by default.
   */
  async htmlToPdf(html: string, opts: HtmlToPdfOptions = {}): Promise<Buffer> {
    if (!this.cfg.url) {
      throw new ServiceUnavailableException(
        'PDF rendering is not configured (set GOTENBERG_URL)',
      );
    }
    const geometry = opts.geometry ?? A4_PORTRAIT;
    const endpoint = `${this.cfg.url.replace(/\/$/, '')}/forms/chromium/convert/html`;
    const form = new FormData();
    // Gotenberg requires the entry point to be named exactly index.html, and
    // takes the header/footer templates as files with these reserved names.
    this.appendFile(form, 'index.html', html, 'text/html');
    if (opts.headerHtml) {
      this.appendFile(form, 'header.html', opts.headerHtml, 'text/html');
    }
    if (opts.footerHtml) {
      this.appendFile(form, 'footer.html', opts.footerHtml, 'text/html');
    }
    for (const asset of opts.assets ?? []) {
      form.append(
        'files',
        new Blob([new Uint8Array(asset.content)], { type: asset.contentType }),
        asset.filename,
      );
    }
    form.append('paperWidth', String(geometry.width));
    form.append('paperHeight', String(geometry.height));
    form.append('marginTop', String(geometry.marginTop));
    form.append('marginBottom', String(geometry.marginBottom));
    form.append('marginLeft', String(geometry.marginLeft));
    form.append('marginRight', String(geometry.marginRight));
    form.append('printBackground', 'true');
    if (opts.title) {
      form.append('metadata', JSON.stringify({ Title: opts.title }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Gotenberg returned ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`HTML → PDF render failed: ${detail}`);
      throw new ServiceUnavailableException(
        `Could not render the PDF: ${detail}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private appendFile(
    form: FormData,
    filename: string,
    content: string,
    contentType: string,
  ): void {
    form.append('files', new Blob([content], { type: contentType }), filename);
  }
}
