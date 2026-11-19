import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.CULTIVA_PREVIEW ? '.next-preview' : '.next',
  async headers() { return [{ source: '/reset-password', headers: [{key:'X-Robots-Tag',value:'noindex, nofollow'}] },{ source: '/:path*', headers: [
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}
  ]}]; }
};
export default config;
