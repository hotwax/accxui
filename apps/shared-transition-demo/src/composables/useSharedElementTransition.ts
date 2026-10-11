import { type AnimationBuilder, createAnimation, useIonRouter } from "@ionic/vue"
import { nextTick, ref } from "vue"
import type { RouteLocationRaw } from "vue-router"

import { type SharedElementKey, getSharedElement, getSharedElementKey } from "@/directives/sharedElement"

type ViewTransitionLike = {
  ready: Promise<void>
  finished: Promise<void>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => Promise<void> | void) => ViewTransitionLike
}

export type SharedElementNavigation = {
  to: RouteLocationRaw
  direction?: "forward" | "back" | "root" | "none"
  action?: "push" | "pop" | "replace"
  elements: SharedElementKey[]
}

const active = ref(false)
const assignedElements = new Set<HTMLElement>()

const noOpIonicAnimation: AnimationBuilder = (_, opts) => {
  const animation = createAnimation()

  animation.duration(0)

  if(opts.enteringEl) {
    animation.addElement(opts.enteringEl)
  }

  return animation
}

function hasReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function supportsViewTransitions() {
  return typeof (document as ViewTransitionDocument).startViewTransition === "function"
}

function setTransitionName(el: HTMLElement, name: string) {
  el.style.viewTransitionName = name
  assignedElements.add(el)
}

function clearTransitionNames() {
  assignedElements.forEach((el) => {
    el.style.viewTransitionName = ""
  })
  assignedElements.clear()
}

function toViewTransitionName(element: SharedElementKey) {
  return `accx-${getSharedElementKey(element).replace(/[^a-zA-Z0-9_-]+/g, "-")}`
}

async function waitForDestination(element: SharedElementKey) {
  for(let attempt = 0; attempt < 8; attempt += 1) {
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const candidate = getSharedElement(element)
    if(candidate) {
      return candidate
    }
  }

  return undefined
}

function blurActiveElement() {
  const activeElement = document.activeElement
  if(activeElement instanceof HTMLElement) {
    activeElement.blur()
  }
}

function waitForTransitionCleanup(viewTransition: ViewTransitionLike) {
  return Promise.race([
    viewTransition.finished.catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 500))
  ])
}

export function useSharedElementTransition() {
  const ionRouter = useIonRouter()

  async function navigate(options: SharedElementNavigation) {
    if(active.value || !supportsViewTransitions() || hasReducedMotion()) {
      ionRouter.navigate(options.to, options.direction || "forward", options.action || "push")

      return
    }

    active.value = true
    blurActiveElement()

    const sourcePairs = options.elements
      .map((element) => ({
        element,
        el: getSharedElement(element),
        name: toViewTransitionName(element)
      }))
      .filter((pair): pair is { element: SharedElementKey, el: HTMLElement, name: string } => !!pair.el)

    sourcePairs.forEach((pair) => setTransitionName(pair.el, pair.name))

    const viewTransition = (document as ViewTransitionDocument).startViewTransition!(async () => {
      clearTransitionNames()

      ionRouter.navigate(
        options.to,
        options.direction || "forward",
        options.action || "push",
        noOpIonicAnimation
      )

      const destinations = await Promise.all(sourcePairs.map(async (pair) => ({
        ...pair,
        el: await waitForDestination(pair.element)
      })))

      destinations.forEach((pair) => {
        if(pair.el) {
          setTransitionName(pair.el, pair.name)
        }
      })
    })

    try {
      await viewTransition.ready.catch(() => undefined)
      await waitForTransitionCleanup(viewTransition)
    } finally {
      clearTransitionNames()
      active.value = false
    }
  }

  return {
    active,
    navigate
  }
}
