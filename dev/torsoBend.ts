import { DEFAULT_TORSO_BEND, type TorsoBendConfig } from '../src'

/**
 * 確認ページで動かす背中の曲げの量（スライダーが 1 刻みなので、角度は度、長さは cm、割合は % で持つ）
 */
export interface TorsoBendDegrees {
  startPitch: number
  fullPitch: number
  maxSpine: number
  maxChest: number
  maxUpperChest: number
  /** 首が受け持つ割合（%） */
  neckShare: number
  /** 体を後ろへ引く量（cm。vrm.scene のローカルの長さ） */
  pullBack: number
  /** 屈伸で腰を落とす量（cm。vrm.scene のローカルの長さ） */
  kneeDrop: number
}

export type TorsoBendKey = keyof TorsoBendDegrees

const toDegrees = (rad: number) => Math.round((rad * 180) / Math.PI)
const toRadians = (deg: number) => (deg * Math.PI) / 180
const toCentimeters = (m: number) => Math.round(m * 100)
const toMeters = (cm: number) => cm / 100
const toPercent = (ratio: number) => Math.round(ratio * 100)
const toRatio = (percent: number) => percent / 100

/** パッケージの既定値（DEFAULT_TORSO_BEND）をスライダーの単位（度・cm・%）にしたもの */
export const DEFAULT_TORSO_BEND_DEGREES: TorsoBendDegrees = {
  startPitch: toDegrees(DEFAULT_TORSO_BEND.startPitch),
  fullPitch: toDegrees(DEFAULT_TORSO_BEND.fullPitch),
  maxSpine: toDegrees(DEFAULT_TORSO_BEND.maxSpine),
  maxChest: toDegrees(DEFAULT_TORSO_BEND.maxChest),
  maxUpperChest: toDegrees(DEFAULT_TORSO_BEND.maxUpperChest),
  neckShare: toPercent(DEFAULT_TORSO_BEND.neckShare),
  pullBack: toCentimeters(DEFAULT_TORSO_BEND.pullBack),
  kneeDrop: toCentimeters(DEFAULT_TORSO_BEND.kneeDrop),
}

/** applyUpperBodyRotation・updateHipsFromHeadTracking に渡す形（rad・m）にする */
export function toTorsoBendConfig(degrees: TorsoBendDegrees): TorsoBendConfig {
  return {
    startPitch: toRadians(degrees.startPitch),
    fullPitch: toRadians(degrees.fullPitch),
    maxSpine: toRadians(degrees.maxSpine),
    maxChest: toRadians(degrees.maxChest),
    maxUpperChest: toRadians(degrees.maxUpperChest),
    neckShare: toRatio(degrees.neckShare),
    pullBack: toMeters(degrees.pullBack),
    kneeDrop: toMeters(degrees.kneeDrop),
  }
}

/** 決めた値をそのままコードへ写せる 1 行 */
export function formatTorsoBend(degrees: TorsoBendDegrees): string {
  return `start ${degrees.startPitch}° / full ${degrees.fullPitch}° / spine ${degrees.maxSpine}° / chest ${degrees.maxChest}° / upperChest ${degrees.maxUpperChest}° / neck ${degrees.neckShare}% / pullBack ${degrees.pullBack}cm / kneeDrop ${degrees.kneeDrop}cm`
}
