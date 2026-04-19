import { getConfig } from '../../../config/index.js';

interface TavilySearchArgs {
  query: string;
  search_depth?: 'basic' | 'advanced';
  max_results?: number;
}

interface TavilyResponse {
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
}

export async function tavilySearch(args: TavilySearchArgs): Promise<string> {
  const config = getConfig();
  const apiKey = config.TAVILY_API_KEY;
  
  if (!apiKey) {
    return JSON.stringify({ error: 'TAVILY_API_KEY not configured' });
  }

  const searchDepth = args.search_depth || 'basic';
  const maxResults = args.max_results || 5;

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: args.query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({ 
        error: `Tavily API error: ${response.status}`,
        details: errorText 
      });
    }

    const data = await response.json() as TavilyResponse;
    
    const result = {
      query: args.query,
      search_depth: searchDepth,
      answer: data.answer,
      results: data.results.map(r => ({
        title: r.title,
        url: r.url,
        content: r.content.slice(0, 500) + (r.content.length > 500 ? '...' : ''),
      })),
      sources: data.results.map(r => r.url),
    };

    return JSON.stringify(result, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Tavily search failed: ${errorMessage}` });
  }
}
