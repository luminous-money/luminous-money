import type { ComponentType } from 'react'
import type { Play } from '../kit'

export type SceneProps = { play?: Play }

/** One feature, told as a scene: the reel shows it beside its copy, and so does the landing page. */
export type Scene = {
  id: string
  /** The headline, short. */
  title: string
  /** One or two sentences under it. */
  line: string
  /** The landing page's details, a few short lines. */
  points: string[]
  Component: ComponentType<SceneProps>
}
