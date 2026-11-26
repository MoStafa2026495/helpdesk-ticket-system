import { resolve } from 'node:path'
import { createApp } from './app.ts'
import { openDb } from './db.ts'

const port = Number(process.env.PORT ?? 3000)
const db = openDb(process.env.DB_FILE ?? resolve('data.sqlite'))
createApp(db, { staticDir: resolve('dist'), trustProxy: process.env.TRUST_PROXY === '1' }).listen(port, () => console.log(`Helpdesk on http://localhost:${port}`))
