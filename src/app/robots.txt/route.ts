import { NextResponse } from 'next/server';

const BASE_URL = 'https://www.haninmap.com';

export async function GET() {
  const robotsTxt = `User-agent: GPTBot
Allow: /
Disallow: /api/

User-agent: OAI-SearchBot
Allow: /
Disallow: /api/

User-agent: ChatGPT-User
Allow: /
Disallow: /api/

User-agent: ClaudeBot
Allow: /
Disallow: /api/

User-agent: PerplexityBot
Allow: /
Disallow: /api/

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${BASE_URL}/sitemap.xml

# LLM context
# See https://www.haninmap.com/llms.txt for site overview
`;

  return new NextResponse(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
