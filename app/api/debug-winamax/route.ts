import { NextResponse } from 'next/server'

const WAPI_URLS = [
  'https://wapi.winamax.fr/sports-api/v1/sports',
  'https://wapi.winamax.fr/sports-api/v2/sports',
  'https://wapi.winamax.fr/sports-api/sports',
  'https://wapi.winamax.fr/sports-api/events',
  'https://wapi.winamax.fr/sports-api/v1/events',
  'https://wapi.winamax.fr/sports-api/v1/matches',
  'https://wapi.winamax.fr/sports-api/v1/competitions',
  'https://wapi.winamax.fr/api/sports',
  'https://wapi.winamax.fr/api/v1/sports',
  'https://wapi.winamax.fr/betting/sports',
  'https://wapi.winamax.fr/sports',
  'https://wapi.winamax.fr/',
]

export async function GET() {
  const results: Record<string, unknown> = {}
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, */*',
    'Referer': 'https://www.winamax.fr/',
    'Origin': 'https://www.winamax.fr',
  }
  for (const url of WAPI_URLS) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
      const text = await res.text()
      results[url] = { status: res.status, contentType: res.headers.get('content-type'), preview: text.slice(0, 300) }
    } catch (e) {
      results[url] = { error: String(e) }
    }
  }
  return NextResponse.json(results)
}

export async function POST() {
  // Test JSON-RPC format on wapi.winamax.fr
  try {
    const res = await fetch('https://www.winamax.fr/paris-sportifs/sports', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    })
    const html = await res.text()

    // Extract script src URLs
    const scriptMatches = [...html.matchAll(/src="([^"]*\.js[^"]*)"/g)].map(m => m[1])

    // Look for embedded JSON data (window.__INITIAL_STATE__ or similar)
    const dataMatch = html.match(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]{0,2000})/)

    // Look for API base URLs in the HTML
    const apiMatches = [...html.matchAll(/(https?:\/\/[^"'\s]*apif[^"'\s]*)/g)].map(m => m[1])
    const configMatches = [...html.matchAll(/(https?:\/\/[^"'\s]*api[^"'\s]{0,50})/g)].map(m => m[1]).slice(0, 10)

    return NextResponse.json({
      status: res.status,
      scripts: scriptMatches.slice(0, 5),
      embeddedData: dataMatch ? dataMatch[1].slice(0, 300) : null,
      apiUrls: apiMatches.slice(0, 10),
      configUrls: configMatches,
      htmlSnippet: html.slice(0, 500),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) })
  }
}
