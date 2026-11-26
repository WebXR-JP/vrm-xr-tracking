import type { Quaternion, Vector3 } from 'three'

/** コントローラー（grip）またはハンドトラッキングの手首の位置と回転 */
export interface ControllerTransform {
  position: Vector3
  rotation: Quaternion
  /** true ならハンドトラッキングの wrist の関節、false ならコントローラーの gripSpace */
  isHandTracking: boolean
}

/** 左右のコントローラーと HMD の位置と回転（XROrigin のローカル座標） */
export interface VRTransforms {
  leftController: ControllerTransform | null
  rightController: ControllerTransform | null
  hmd: ControllerTransform | null
}

/** 指の名前 */
export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'little'

/** 指ごとの曲がり具合（0=開く、1=握る） */
export type FingerCurls = Record<FingerName, number>

/** 開きを見る指（中指を基準にするので中指と、別に動く親指は入れない） */
export type SpreadFingerName = 'index' | 'ring' | 'little'

/**
 * 指の開き（度）。手のひらの面で、中指から見て親指の側が +。
 * 自然に開いた手で、人差し指 +5〜10・薬指 -3〜7・小指 -8〜15 くらい
 */
export type FingerSpread = Record<SpreadFingerName, number>

/** 手の指の曲がり具合（0=開く、1=握る） */
export interface FingerCurlData {
  /** 左手の 5 本をまとめた曲がり（コントローラーのグリップなど） */
  left: number
  right: number
  /**
   * 指ごとの曲がり（ハンドトラッキングなど）。あればその指は left / right より優先する。
   * 古い相手は無視して left / right で曲げるので、left / right も入れておく
   */
  fingers?: Partial<Record<'left' | 'right', FingerCurls>>
  /** 指の開き（ハンドトラッキングなど）。無ければ開かない（指をそろえたまま） */
  spread?: Partial<Record<'left' | 'right', FingerSpread>>
}
