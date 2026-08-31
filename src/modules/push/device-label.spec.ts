import { describeDevice } from './device-label';

describe('describeDevice', () => {
  it('names an iPhone running Safari', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Safari');
  });

  it('does not mistake an iPhone for a Mac', () => {
    // An iOS user agent also contains "Mac OS X", so platform order matters.
    expect(
      describeDevice('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)'),
    ).toBe('iPad');
  });

  it('names Chrome on Android', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Android · Chrome');
  });

  it('distinguishes Edge from the Chrome it claims to be', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      ),
    ).toBe('Windows · Edge');
  });

  it('falls back rather than guessing', () => {
    expect(describeDevice(undefined)).toBe('Unknown device');
    expect(describeDevice('   ')).toBe('Unknown device');
    expect(describeDevice('curl/8.4.0')).toBe('Unknown device');
  });
});
