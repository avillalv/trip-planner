import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

// The main flow, end to end: create a trip, track a route (prices come from fixtures, not the
// web) and choose a flight, plan a day and move a plan on the calendar, save a place to stay, and
// present it all.

const backend = path.resolve(import.meta.dirname, '../../backend')

/** A date `days` from today, so the trip is always in the future whenever this runs. */
function inDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function pickAirport(dialog: Locator, inputId: string, code: string) {
  await dialog.locator(`#${inputId}`).fill(code)
  await dialog.getByRole('option', { name: new RegExp(`^${code}\\b`) }).click()
}

/** "11:45 AM – 12:45 PM" out of a calendar block's text. */
function timeRange(text: string): string {
  const found = text.match(/\d{1,2}:\d{2}\s[AP]M\s–\s\d{1,2}:\d{2}\s[AP]M/)
  if (!found) throw new Error(`No time range in "${text}"`)
  return found[0]
}

/** Minutes after midnight for "12:15 PM". */
function minutesOf(time: string): number {
  const [, hours, minutes, half] = time.trim().match(/(\d{1,2}):(\d{2})\s([AP])M/)!
  return (Number(hours) % 12) * 60 + Number(minutes) + (half === 'P' ? 12 * 60 : 0)
}

async function openSection(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).first().click()
}

test('plan a trip, from creating it to presenting it', async ({ page }) => {
  const start = inDays(40)
  const trip = 'Smoke test in Japan'

  await test.step('create a trip', async () => {
    await page.goto('/')
    // The test starts from an empty database, so the page invites the first trip.
    await expect(page.getByRole('heading', { name: 'No trips yet' })).toBeVisible()
    await page.getByRole('button', { name: 'Plan a trip' }).click()
    const dialog = page.getByRole('dialog', { name: 'New trip' })
    await dialog.getByLabel('Trip name').fill(trip)
    await dialog.getByLabel('Start').fill(start)
    await dialog.getByLabel('End').fill(inDays(47))
    await dialog.getByRole('button', { name: 'Create trip' }).click()
    await expect(page.getByRole('heading', { level: 1, name: trip })).toBeVisible()
  })

  await test.step('track a route and see its cheapest fares', async () => {
    await openSection(page, 'Flights')
    await page.getByRole('button', { name: 'Add a route' }).click()
    const dialog = page.getByRole('dialog')
    await pickAirport(dialog, 'route-from', 'LAX')
    await pickAirport(dialog, 'route-to', 'HND')
    await dialog.getByRole('button', { name: 'Track route' }).click()
    await expect(dialog).toBeHidden()

    // Prices as if checked over the past week (no live searches in a test).
    execFileSync('uv', ['run', '--no-sync', 'python', '-m', 'tests.e2e_seed', 'fares'], { cwd: backend })
    await page.reload()
    await expect(page.getByText('$1,248').first()).toBeVisible()
  })

  await test.step('choose a flight, and the trip takes its dates', async () => {
    const before = await page.getByRole('heading', { level: 1, name: trip }).locator('xpath=following-sibling::p[1]').innerText()
    await page.getByRole('row', { name: /\$1,248/ }).getByRole('button', { name: /^Choose/ }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Use this flight for the trip?' })
    await dialog.getByRole('button', { name: 'Use this flight' }).click()
    await expect(page.getByText(/^The trip is now /)).toBeVisible()
    await expect(page.getByText('Your flight', { exact: true }).first()).toBeVisible()
    const after = await page.getByRole('heading', { level: 1, name: trip }).locator('xpath=following-sibling::p[1]').innerText()
    expect(after).not.toBe(before)
  })

  await test.step('plan the first day and move a plan on the calendar', async () => {
    await openSection(page, 'Itinerary')
    await page.getByRole('link', { name: /Day 1(?!\d)/ }).click()
    await page.getByRole('button', { name: 'Add activity' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill('Tsukiji breakfast')
    await dialog.getByLabel('Starts').fill('10:00')
    await dialog.getByLabel('Ends').fill('11:00')
    await dialog.getByRole('button', { name: /^Add to / }).click()
    await expect(dialog).toBeHidden()

    // Calendar blocks are buttons named for what they are and when. The block is an hour tall;
    // drag it down two of its heights.
    const block = page.getByRole('button', { name: /Tsukiji breakfast/ })
    await expect(block).toContainText('10:00 AM')
    await block.scrollIntoViewIfNeeded()
    const box = (await block.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 2 * box.height, { steps: 12 })
    await page.mouse.up()

    // The pointer lands within a slot of noon; what matters is that the move sticks.
    await expect(block).not.toContainText('10:00 AM')
    const moved = timeRange(await block.innerText())
    expect(Math.abs(minutesOf(moved.split('–')[0]) - 12 * 60)).toBeLessThanOrEqual(15)
    await page.reload()
    await expect(page.getByRole('button', { name: /Tsukiji breakfast/ })).toContainText(moved)
  })

  await test.step('save a place to stay from a pasted link', async () => {
    await openSection(page, 'Lodging')
    await page.getByRole('button', { name: 'Add a place' }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Link', { exact: true })
      .fill(`https://www.airbnb.com/rooms/4455?check_in=${inDays(41)}&check_out=${inDays(44)}&adults=2`)
    // The link's own dates replace the trip's.
    await expect(dialog.getByLabel('Check-in')).toHaveValue(inDays(41))
    await dialog.getByLabel('Name', { exact: true }).fill('Machiya with a garden')
    await dialog.getByLabel('Price', { exact: true }).fill('900')
    await dialog.getByRole('button', { name: 'Add to list' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Machiya with a garden' })).toBeVisible()
    await page.getByRole('button', { name: 'Mark as a favorite' }).click()
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  })

  await test.step('present the trip', async () => {
    await page.getByRole('button', { name: 'Present' }).click()
    await expect(page).toHaveURL(/\/present#1$/)
    await expect(page.getByRole('heading', { name: trip })).toBeVisible()
    const said = page.getByText(/^Slide \d+ of \d+/)
    await expect(said).toHaveText(`Slide 1 of 5: ${trip}`)
    await page.keyboard.press('ArrowRight')
    await expect(said).toHaveText('Slide 2 of 5: Flights: LAX → HND')
    await page.keyboard.press('ArrowRight')
    await expect(said).toHaveText('Slide 3 of 5: Places we like')
    await page.keyboard.press('End')
    await expect(said).toHaveText('Slide 5 of 5: Trip at a glance')
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/trips\/\d+\/lodging$/)
  })
})
