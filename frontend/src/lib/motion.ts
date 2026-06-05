/**
 * Shared Framer Motion presets.
 *
 * Imitates the "GSAP-grade" feel via:
 *  - cubic-bezier(0.16, 1, 0.3, 1) ease-out (smooth landing)
 *  - spring physics for nav/layout transitions
 *  - staggered children reveals
 */
import { Variants, Transition } from 'framer-motion'

export const ease: Transition = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1],
}

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: ease },
  exit: { opacity: 0, y: -4, transition: { duration: 0.2 } },
}

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: ease },
  exit: { opacity: 0 },
}

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: ease },
}

export const stagger = (delay = 0.06): Variants => ({
  initial: {},
  animate: {
    transition: { staggerChildren: delay, delayChildren: 0.05 },
  },
})

export const slideInLeft: Variants = {
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0, transition: ease },
}
