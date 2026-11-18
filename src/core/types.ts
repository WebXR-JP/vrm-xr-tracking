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

/** 手の指の曲がり具合（0=開く、1=握る） */
export interface FingerCurlData {
  left: number
  right: number
}
