export const PRICE_STEPS = 5

/** Step 5 (most prominent) holds the cheapest fifth of prices; step 1 the priciest. */
export function priceStep(price: number, sortedPrices: number[]): number {
  if (sortedPrices.length <= 1) return PRICE_STEPS
  const rank = sortedPrices.findIndex((p) => p >= price)
  const fraction = rank / (sortedPrices.length - 1)
  return PRICE_STEPS - Math.min(PRICE_STEPS - 1, Math.floor(fraction * PRICE_STEPS))
}
