import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, enter, makeRoom, makeUser, next, startServer } from './harness.js'

test('loading a shared title preserves its position for host and friend', async () => {
  const server = await startServer()
  const clients = []
  try {
    const host = await makeUser(server.base, 'ResumeHost')
    const friend = await makeUser(server.base, 'ResumeFriend')
    const room = await makeRoom(server.base, host, friend)
    for (const user of [host, friend]) {
      const client = await enter(server.base, user, room.id)
      clients.push(client)
      const opened = next(client, 'watch:state')
      client.emit('watch:open', { roomId: room.id })
      await opened
    }
    const added = await api<{ item: { id: string } }>(server.base, host, `/rooms/${room.id}/watch/queue`, {
      body: { source: 'external', ref: 'https://www.hotstar.com/in/movies/test/123456/watch', title: 'Resume fixture' },
    })
    for (const position of [1234.5, undefined, -20, 'invalid']) {
      const received = clients.map(client => next<{ position: number }>(client, 'watch:state'))
      clients[0].emit('watch:load', { roomId: room.id, itemId: added.item.id, position })
      const states = await Promise.all(received)
      const expected = position === 1234.5 ? 1234.5 : 0
      for (const state of states) assert.ok(Math.abs(state.position - expected) < 1, `${state.position} should resume at ${expected}`)
    }
  } finally {
    clients.forEach(client => client.disconnect())
    await server.stop()
  }
})
