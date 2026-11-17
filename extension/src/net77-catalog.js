/** Read NetMirror's title metadata from a signed-in NetMirror page. */
;(() => {
  const idPattern = /^[a-z0-9_-]{1,80}$/i
  const origin = /^https:\/\/(?:www\.)?net77\.cc$/
  if (!origin.test(location.origin)) return

  const metadata = new Map()
  const request = async (path, params = {}) => {
    const url = new URL(path, location.origin)
    url.search = new URLSearchParams(params)
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(6500) })
    if (!response.ok) throw new Error('NetMirror did not return its catalog.')
    return response
  }
  const timestamp = () => String(Math.floor(Date.now() / 1000))
  const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

  async function details(id) {
    if (metadata.has(id)) return metadata.get(id)
    const row = await request('/post.php', { id, t: timestamp() }).then(response => response.json())
    const title = text(row.title, 200)
    if (row.status !== 'y' || !title) return null
    const year = Number(row.year)
    const item = {
      title,
      kind: row.type === 't' ? 'series' : row.type === 'm' ? 'movie' : null,
      year: Number.isInteger(year) && year >= 1888 && year <= 2100 ? year : null,
    }
    if (metadata.size >= 250) metadata.clear()
    metadata.set(id, item)
    return item
  }

  async function search(query) {
    const result = await request('/search.php', { s: query, t: timestamp() }).then(response => response.json())
    if (!Array.isArray(result.searchResult)) throw new Error('NetMirror search is unavailable.')
    return result.searchResult.map(row => ({ id: String(row?.id ?? ''), title: text(row?.t, 200) }))
  }

  async function browse(path, kind) {
    const doc = location.pathname === path ? document : new DOMParser()
      .parseFromString(await request(path).then(response => response.text()), 'text/html')
    return browseCards(doc, kind)
  }

  function browseCards(doc, kind) {
    return Array.from(doc.querySelectorAll('[data-post]'), node => ({
      id: node.getAttribute('data-post')?.trim() ?? '', kind,
    }))
  }

  async function catalog(query, kind) {
    let rows
    if (query) {
      rows = await search(query)
    } else {
      const pages = await Promise.allSettled([
        kind === 'series' ? [] : browse('/movies', 'movie'),
        kind === 'movie' ? [] : browse('/series', 'series'),
      ])
      const [movies, shows] = pages.map(page => page.status === 'fulfilled' ? page.value : [])
      rows = []
      for (let i = 0; i < Math.max(movies.length, shows.length); i++) {
        if (movies[i]) rows.push(movies[i])
        if (shows[i]) rows.push(shows[i])
      }
      if (!rows.length && location.pathname === '/home') rows = browseCards(document, null)
      if (!rows.length) throw new Error('NetMirror browse is unavailable.')
    }
    const unique = [...new Map(rows.filter(row => idPattern.test(row.id)).map(row => [row.id, row])).values()]
    const items = []
    const candidates = unique.slice(0, query && kind === 'all' ? 30 : 12)
    for (let i = 0; i < candidates.length; i += 6) {
      const batch = await Promise.all(candidates.slice(i, i + 6).map(async row => {
        // Search includes a name, but no type. Only load details when required.
        const detail = row.title && kind === 'all' ? null : await details(row.id).catch(() => null)
        const title = detail?.title ?? row.title
        const type = detail?.kind ?? row.kind ?? null
        if (!title || (kind !== 'all' && kind !== type)) return null
        return { id: row.id, title, kind: type, year: detail?.year ?? null }
      }))
      items.push(...batch.filter(Boolean))
    }
    if (candidates.length && !items.length && !query) throw new Error('NetMirror browse is unavailable.')
    return items
  }

  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.kind !== 'net77-catalog') return
    const kind = ['movie', 'series'].includes(message.type) ? message.type : 'all'
    catalog(text(message.query, 100), kind)
      .then(items => reply({ status: 'ok', items }))
      .catch(() => reply({ status: 'unavailable' }))
    return true
  })

  // A Huddle card opens the provider and selects that exact title when its
  // card appears. Keep playback and episode selection in the provider's UI.
  const picked = new URLSearchParams(location.hash.slice(1))
  const key = picked.get('huddle-net77-pick')
  const id = key?.split('.')[0]
  const title = text(picked.get('title'), 200)
  if (!id || !idPattern.test(id) || !title) return
  let searched = false
  let filledSearch = false
  const select = () => {
    const card = Array.from(document.querySelectorAll(`[data-post="${id}"]`))
      .find(node => node.getClientRects().length)
    if (card) {
      card.click()
      return true
    }
    const input = document.querySelector('input[placeholder="Search Movies & Series"]')
    if (!input) {
      if (!searched) {
        const search = document.querySelector('button:has(img[src$="/search.svg"])')
        if (search) {
          searched = true
          search.click()
        }
      }
      return false
    }
    if (!filledSearch) {
      filledSearch = true
      input.value = title
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: title.slice(-1) }))
    }
    return false
  }
  if (select()) return
  const deadline = Date.now() + 6500
  const timer = setInterval(() => {
    if (select() || Date.now() >= deadline) clearInterval(timer)
  }, 250)
})()
