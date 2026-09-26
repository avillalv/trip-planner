import { createContext, useContext } from 'react'

/**
 * `live` is the slide on screen: it gets a real map and its entrance animations. Hidden slides
 * (kept for printing) and grid thumbnails draw the static route plot instead.
 */
export const SlideContext = createContext<{ live: boolean }>({ live: false })

export const useSlide = () => useContext(SlideContext)
