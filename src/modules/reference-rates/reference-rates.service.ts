import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

const REFERENCE_CURRENCIES = ['USD', 'CAD', 'EUR'] as const;
type ReferenceCurrency = (typeof REFERENCE_CURRENCIES)[number];

export interface ReferenceRatesSnapshot {
  base: 'INR';
  rates: Partial<Record<ReferenceCurrency, number>>;
  fetchedAt: string | null;
  available: boolean;
}

/**
 * Informational exchange rates only. This service deliberately has no
 * dependency on Finance, invoices, journals, orders, or their calculations.
 */
@Injectable()
export class ReferenceRatesService implements OnModuleInit {
  private readonly logger = new Logger(ReferenceRatesService.name);
  private snapshot: ReferenceRatesSnapshot = {
    base: 'INR',
    rates: {},
    fetchedAt: null,
    available: false,
  };

  onModuleInit() {
    // Do not delay or prevent application startup for a display-only feature.
    void this.refresh();
  }

  @Cron('0 0 */4 * * *')
  async scheduledRefresh() {
    await this.refresh();
  }

  getSnapshot(): ReferenceRatesSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<void> {
    try {
      // Use the maintained canonical host (api.frankfurter.dev). The legacy
      // api.frankfurter.app host is deprecated and now 301-redirects through
      // Cloudflare, which is unreliable from datacenter IPs and would leave the
      // snapshot unavailable (empty rates → every screen shows INR only).
      const response = await fetch(
        'https://api.frankfurter.dev/v1/latest?from=INR&to=USD,CAD,EUR',
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!response.ok)
        throw new Error(`Frankfurter returned ${response.status}`);

      const payload = (await response.json()) as {
        rates?: Partial<Record<ReferenceCurrency, number>>;
      };
      const rates = Object.fromEntries(
        REFERENCE_CURRENCIES.flatMap((currency) => {
          const rate = payload.rates?.[currency];
          return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
            ? [[currency, rate]]
            : [];
        }),
      ) as Partial<Record<ReferenceCurrency, number>>;

      if (Object.keys(rates).length !== REFERENCE_CURRENCIES.length) {
        throw new Error(
          'Frankfurter response did not include every requested rate',
        );
      }
      this.snapshot = {
        base: 'INR',
        rates,
        fetchedAt: new Date().toISOString(),
        available: true,
      };
    } catch (error) {
      // Retain a previously successful snapshot. With no snapshot, callers
      // receive available=false and continue rendering authoritative INR.
      this.logger.warn(
        `Reference-rate refresh failed; retaining ${this.snapshot.available ? 'cached rates' : 'INR-only display'}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
