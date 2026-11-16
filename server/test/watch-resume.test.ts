import assert from 'node:assert/strict'
import { test } from 'node:test'
import { io } from 'socket.io-client'
import { api, enter, makeRoom, makeUser, next, startServer } from './harness.js'

test('loading a shared title preserves its position for host and friend', async () => {
  const server = await startServer()
  const clients = []
  try {
    const host = await makeUser(server.base, 'ResumeHost')
    const friend = await makeUser(server.base, 'ResumeFriend')
    const room = await makeRoom(server.base, host, friend)
    const hostSocket = await enter(server.base, host, room.id)
    const friendSocket = io(server.base, { transports: ['websocket'], auth: { token: friend.token } })
    clients.push(hostSocket, friendSocket)
    await next(friendSocket, 'connect')
    for (const client of clients) {
      const ready = next(client, 'watch:stream-ready')
      const opened = next(client, 'watch:state')
      client.emit('watch:open', { roomId: room.id })
      await Promise.all([opened, ready])
    }
    const added = await api<{ item: { id: string } }>(server.base, host, `/rooms/${room.id}/watch/queue`, {
      body: { source: 'external', ref: 'https://www.hotstar.com/in/movies/test/123456/watch', title: 'Resume fixture' },
    })
    const announced = clients.map(client => next<{ position: number }>(client, 'watch:state'))
    const reply = await clients[0].timeout(3000).emitWithAck('watch:stream-start', {
      roomId: room.id, itemId: added.item.id, position: 1800.5,
    })
    assert.equal(reply.ok, true)
    for (const state of await Promise.all(announced)) {
      assert.ok(Math.abs(state.position - 1800.5) < 1)
    }
    const invalid = await clients[0].timeout(3000).emitWithAck('watch:stream-start', {
      roomId: room.id, itemId: added.item.id,
    })
    assert.equal(invalid.ok, false)
    const reaction = next<{ reaction: string }>(clients[1], 'fun:react')
    clients[0].emit('fun:react', { roomId: room.id, reaction: 'laugh' })
    assert.equal((await reaction).reaction, 'laugh')
    for (const position of [1234.5, undefined, -20, 'invalid']) {
      const received = clients.map(client => next<{ position: number }>(client, 'watch:state'))
      clients[0].emit('watch:load', { roomId: room.id, itemId: added.item.id, position })
      const states = await Promise.all(received)
      const expected = position === 1234.5 || position === undefined ? 1234.5 : 0
      for (const state of states) assert.ok(Math.abs(state.position - expected) < 1, `${state.position} should resume at ${expected}`)
    }
  } finally {
    clients.forEach(client => client.disconnect())
    await server.stop()
  }
})
