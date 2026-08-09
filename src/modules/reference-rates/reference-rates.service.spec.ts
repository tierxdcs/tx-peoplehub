import { ReferenceRatesService } from './reference-rates.service';

describe('ReferenceRatesService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('caches valid INR reference rates', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { USD: 0.012, CAD: 0.016, EUR: 0.011 } }),
    }) as jest.Mock;
    const service = new ReferenceRatesService();

    await service.refresh();

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        base: 'INR',
        rates: { USD: 0.012, CAD: 0.016, EUR: 0.011 },
        available: true,
      }),
    );
  });

  it('retains cached rates when a later refresh fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { USD: 0.012, CAD: 0.016, EUR: 0.011 } }),
      })
      .mockRejectedValueOnce(new Error('offline')) as jest.Mock;
    const service = new ReferenceRatesService();
    await service.refresh();

    await service.refresh();

    expect(service.getSnapshot().available).toBe(true);
    expect(service.getSnapshot().rates.USD).toBe(0.012);
  });

  it('falls back to INR-only availability when no rate has ever loaded', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('offline')) as jest.Mock;
    const service = new ReferenceRatesService();

    await service.refresh();

    expect(service.getSnapshot()).toEqual({
      base: 'INR',
      rates: {},
      fetchedAt: null,
      available: false,
    });
  });
});
