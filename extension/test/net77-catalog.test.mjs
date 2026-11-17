import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const script = readFileSync(new URL('../src/net77-catalog.js', import.meta.url), 'utf8')

test('search reads NetMirror metadata in its own tab and preserves the matching title ID', async () => {
  const location = new URL('https://net77.cc/home')
  const requests = []
  let listener
  runInNewContext(script, {
    location, URL, URLSearchParams, AbortSignal,
    fetch: async (url) => {
      requests.push(url)
      return Response.json(url.pathname === '/search.php' ? { searchResult: [
        { id: '80237957', t: 'Avatar The Last Airbender' },
        { id: '82131939', t: 'Mahavatar Narsimha' },
        { id: '../player', t: 'Invalid catalog ID' },
      ] } : url.searchParams.get('id') === '80237957'
        ? { status: 'y', title: 'Avatar The Last Airbender', type: 't', year: '2024' }
        : { status: 'y', title: 'Mahavatar Narsimha', type: 'm', year: '2025' })
    },
    chrome: { runtime: { onMessage: { addListener(handler) { listener = handler } } } },
  })

  const result = await new Promise(resolve => {
    assert.equal(listener({ kind: 'net77-catalog', query: 'Avatar', type: 'series' }, {}, resolve), true)
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(structuredClone(result.items), [{
    id: '80237957', title: 'Avatar The Last Airbender', kind: 'series', year: 2024,
  }])
  assert.equal(requests[0].searchParams.get('s'), 'Avatar')
  assert.deepEqual(requests.map(url => url.pathname), ['/search.php', '/post.php', '/post.php'])
  assert.ok(requests.every(url => url.origin === location.origin))
})
