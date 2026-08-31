import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [
      {
        // The service worker must never be served from a stale cache: the copy
        // the browser holds is the copy that receives every push, so a cached
        // old worker outlives a deploy. `no-cache` forces revalidation on each
        // update check, and Service-Worker-Allowed keeps its scope the whole
        // origin even if it is ever moved out of /public.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
