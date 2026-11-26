import { resolve } from 'node:path'
import { openDb } from './db.ts'
import { DEMO_PASSWORD, seedDemo } from './seedData.ts'

const file = process.env.DB_FILE ?? resolve('data.sqlite')
const db = openDb(file)
if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0) {
  console.log('Database already has users, not seeding.')
} else {
  seedDemo(db)
  console.log(`Seeded fictional demo data into ${file}`)
  console.log(`Logins (password "${DEMO_PASSWORD}"): admin@demo.test, sam@demo.test (agent), maya@customer.test (customer)`)
}
