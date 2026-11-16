import type { Request, Response } from 'express'
import { z } from 'zod'

import { prisma } from '../models/prisma.js'
import { assertMembership } from '../services/room.service.js'
import { streamingCatalog, streamingDetails, streamingIdentity } from '../services/streamingCatalog.service.js'
import { snapshot } from '../services/watch.service.js'
import { HttpError } from '../utils/HttpError.js'

const catalogQuery = z.object({
  q: z.string().trim().max(100).default(''),
  cursor: z.string().max(1800).default(''),
})
const progressBody = z.object({
  url: z.string().url().max(1000),
  title: z.string().trim().min(1).max(200),
  thumbnail: z.string().url().max(600).refine(value => value.startsWith('https://')).nullish(),
  position: z.number().finite().min(0).max(86400),
  duration: z.number().finite().positive().max(86400).nullable(),
  shared: z.boolean(),
  ended: z.boolean().default(false),
})

async function gate(req: Request) {
  const roomId = req.params.id!
  await assertMembership(req.userId!, roomId)
  return roomId
}

export async function catalog(req: Request, res: Response) {
  await gate(req)
  const input = catalogQuery.safeParse(req.query)
  if (!input.success) throw HttpError.badRequest('Choose a shorter search or reopen the Streaming tab.')
  res.json(await streamingCatalog(input.data.q, input.data.cursor))
}

export async function details(req: Request, res: Response) {
  await gate(req)
  const id = req.params.catalogId!
  if (!/^[a-z0-9_-]{1,64}$/i.test(id)) throw HttpError.badRequest('That title ID is invalid.')
  res.json(await streamingDetails(id))
}

export async function progress(req: Request, res: Response) {
  const roomId = await gate(req)
  const parsed = progressBody.safeParse(req.body)
  if (!parsed.success) throw HttpError.badRequest('This playback position could not be saved.')
  const input = parsed.data
  const media = streamingIdentity(input.url)
  if (!media) throw HttpError.badRequest('This streaming title is unsupported.')

  const room = input.shared ? snapshot(roomId) : null
  const shared = room?.item?.source === 'external' ? streamingIdentity(room.item.ref) : null
  const roomMatch = shared?.provider === media.provider && shared.key === media.key
  // A delayed report from the previous room video cannot become its checkpoint.
  if (input.shared && !roomMatch) return void res.status(204).end()

  const finish = input.ended || (input.duration !== null && input.position >= input.duration - 8)
  const mediaKey = `${media.provider}:${media.key}`
  const ref = media.url.href
  const title = roomMatch ? room?.item?.title ?? input.title : input.title
  const thumbnail = (roomMatch ? room?.item?.thumbnail : input.thumbnail) ?? null
  const save = (scope: string, ownerId: string, position: number, finished: boolean, duration = input.duration) => {
    const key = { scope, ownerId, mediaKey }
    const data = { title, ref, thumbnail, position, duration, finished }
    return prisma.streamingCheckpoint.upsert({
      where: { scope_ownerId_mediaKey: key },
      create: { ...key, ...data },
      update: { ...data, thumbnail: thumbnail ?? undefined },
    })
  }
  if (input.position >= 5 || finish) {
    const writes = [save('viewer', req.userId!, input.position, finish)]
    if (roomMatch && room) {
      const duration = room.item?.duration ?? input.duration
      const position = Math.max(0, Math.min(duration ?? 86400, room.position))
      const finished = duration !== null && position >= duration - 8
      if (position >= 5 || finished) writes.push(save('room', roomId, position, finished, duration))
    }
    await prisma.$transaction(writes)
  }
  res.status(204).end()
}

export async function resume(req: Request, res: Response) {
  const roomId = await gate(req)
  const recent = (scope: string, ownerId: string) => prisma.streamingCheckpoint.findMany({
    where: { scope, ownerId, finished: false, position: { gte: 5 } },
    orderBy: { updatedAt: 'desc' },
    take: 8,
    select: { mediaKey: true, title: true, ref: true, thumbnail: true, position: true, duration: true, updatedAt: true },
  })
  const [personal, room] = await Promise.all([recent('viewer', req.userId!), recent('room', roomId)])
  res.json({ personal, room })
}
