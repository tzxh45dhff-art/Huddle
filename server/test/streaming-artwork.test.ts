import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { StreamTitle } from '../src/services/streamingCatalog.service.js'

// Exercising the catalog service doesn't require a real provider key or database.
process.env.JWT_SECRET ??= 'streaming-artwork-test'
const { correctedStreamingThumbnail, streamingCatalog, streamingDetails } = await import('../src/services/streamingCatalog.service.js')
const { env } = await import('../src/config/env.js')
const { prisma } = await import('../src/models/prisma.js')

function stubPrisma(t: TestContext, target: object, methods: Record<string, unknown>) {
  // Prisma's proxies expose callable methods without regular method descriptors.
  const previous = Object.fromEntries(Object.keys(methods).map(key => [key, Reflect.get(target, key)]))
  Object.assign(target, methods)
  t.after(() => { Object.assign(target, previous) })
}

const image = (id: string, path = 'poster/vertical/en/360.jpg') => `https://cdn.movieofthenight.com/show/${id}/${path}?Signature=fixture`
const title = (id: string, name: string): StreamTitle => ({
  id, title: name, kind: 'series', year: 2026, runtime: null, overview: '', genres: [],
  poster: image(id), backdrop: image(id, 'backdrop/horizontal/1080.jpg'),
  offers: [{ provider: 'prime', access: 'subscription', url: 'https://www.primevideo.com/detail/FIXTURE' }],
})

test('repairs artwork in cached search, browse, details and saved thumbnails', async (t) => {
  const offCampus = title('24974419', 'Off Campus')
  const carrie = title('25946853', 'Carrie')
  const unrelated = { ...title('123', 'Unrelated'), poster: image('456') }
  const catalog = { titles: [offCampus, carrie, unrelated], next: null }
  stubPrisma(t, prisma.streamingCatalogPage, {
    findMany: async () => [],
    findUnique: async ({ where }: { where: { key: string } }) => ({
      expiresAt: new Date(Date.now() + 60_000),
      payload: JSON.stringify(where.key.startsWith('details:') ? { title: carrie, episodes: [] } : catalog),
    }),
  })

  for (const query of ['', 'off']) {
    const response = await streamingCatalog(query, '')
    const [first, second, third] = response.titles
    assert.equal(response.source, 'cached')
    assert.match(first!.poster!, /^https:\/\/image\.tmdb\.org\//)
    assert.equal(first!.backdrop, offCampus.backdrop)
    assert.equal(first!.offers[0]?.url, offCampus.offers[0]?.url)
    assert.match(second!.poster!, /^https:\/\/image\.tmdb\.org\//)
    assert.match(second!.backdrop!, /^https:\/\/image\.tmdb\.org\//)
    assert.equal(third!.poster, null)
    assert.equal(third!.backdrop, unrelated.backdrop)
    assert.equal(correctedStreamingThumbnail(offCampus.poster), first!.poster)
    assert.equal(correctedStreamingThumbnail(unrelated.backdrop), unrelated.backdrop)
  }
  const details = await streamingDetails(carrie.id)
  assert.equal(details.title?.id, carrie.id)
  assert.equal(details.title?.poster, correctedStreamingThumbnail(carrie.poster))
  assert.notEqual(details.title?.backdrop, carrie.backdrop)
})

test('uses another size when the preferred artwork points to a different title', async (t) => {
  const key = env.streamingAvailabilityKey
  env.streamingAvailabilityKey = 'fixture'
  try {
    stubPrisma(t, prisma.streamingCatalogPage, {
      findMany: async () => [],
      findUnique: async () => null,
      upsert: async () => ({}),
    })
    stubPrisma(t, prisma, { $executeRaw: async () => 1 })
    const valid = image('321', 'poster/vertical/en/480.jpg')
    t.mock.method(globalThis, 'fetch', async () => Response.json([{
      id: '321', title: 'Fixture', showType: 'series',
      imageSet: { verticalPoster: { w360: image('654'), w480: valid } },
      streamingOptions: { in: [{
        service: { id: 'prime' }, type: 'subscription', link: 'https://www.primevideo.com/detail/FIXTURE',
      }] },
    }]))

    const response = await streamingCatalog('fixture', '')
    assert.equal(response.source, 'live')
    assert.equal(response.titles[0]?.poster, valid)
  } finally {
    env.streamingAvailabilityKey = key
  }
})
