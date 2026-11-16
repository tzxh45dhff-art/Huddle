import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, enter, makeRoom, makeUser, next, startServer } from './harness.js'

const current = 'https://www.hotstar.com/in/movies/test/123456/watch'
const previous = 'https://www.hotstar.com/in/movies/previous/654321/watch'
type Resume = { personal: { mediaKey: string; position: number }[]; room: { mediaKey: string; position: number }[] }

test('keeps playback progress private and saves the authoritative room position for the active title', async () => {
  const server = await startServer()
  let client: Awaited<ReturnType<typeof enter>> | undefined
  try {
    const host = await makeUser(server.base, 'CatalogHost')
    const friend = await makeUser(server.base, 'CatalogFriend')
    const room = await makeRoom(server.base, host, friend)
    const path = `/rooms/${room.id}/watch/streaming/resume`
    const put = (url: string, position: number, shared: boolean) => api(server.base, host, path, {
      method: 'PUT', body: { url, title: 'Resume fixture', position, duration: 3600, shared },
    })
    const personal = await put(previous, 240, false)
    assert.equal(personal, null)

    client = await enter(server.base, host, room.id)
    const ready = next(client, 'watch:stream-ready')
    client.emit('watch:open', { roomId: room.id })
    await ready
    const queued = await api<{ item: { id: string } }>(server.base, host, `/rooms/${room.id}/watch/queue`, {
      body: { source: 'external', ref: current, title: 'Room fixture', duration: 3600 },
    })
    const started = await client.timeout(3000).emitWithAck('watch:stream-start', {
      roomId: room.id, itemId: queued.item.id, position: 845.5,
    })
    assert.equal(started.ok, true)

    await put(current, 800, true)
    await put(previous, 1000, true)
    const hostResume = await api<Resume>(server.base, host, path)
    const friendResume = await api<Resume>(server.base, friend, path)
    assert.equal(hostResume.personal.length, 2)
    assert.equal(hostResume.personal.find(item => item.mediaKey === 'hotstar:654321')?.position, 240)
    assert.deepEqual(friendResume.personal, [])
    assert.equal(friendResume.room.length, 1)
    assert.equal(friendResume.room[0].mediaKey, 'hotstar:123456')
    assert.ok(Math.abs(friendResume.room[0].position - 845.5) < 2)
  } finally {
    client?.disconnect()
    await server.stop()
  }
})
