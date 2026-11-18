import { Quaternion, Vector3 } from 'three'
import type { ControllerTransform } from './types'

/**
 * ControllerTransformオブジェクトを生成
 */
export function createControllerTransform(isHandTracking = false): ControllerTransform {
  return {
    position: new Vector3(),
    rotation: new Quaternion(),
    isHandTracking,
  }
}

/**
 * XRPoseからControllerTransformを更新
 */
export function updateTransformFromPose(transform: ControllerTransform, pose: XRPose): void {
  const pos = pose.transform.position
  const ori = pose.transform.orientation
  transform.position.set(pos.x, pos.y, pos.z)
  transform.rotation.set(ori.x, ori.y, ori.z, ori.w)
}

/**
 * InputSourceからXRSpaceを取得
 * - コントローラー: gripSpace（手の位置）
 * - ハンドトラッキング: wrist ジョイントの space
 */
export function getControllerSpace(inputSource: XRInputSource): XRSpace | null {
  // コントローラーの場合は gripSpace を使用
  if (inputSource.gripSpace) {
    return inputSource.gripSpace
  }

  // ハンドトラッキングの場合は wrist ジョイントの space を使用
  if (inputSource.hand) {
    const wristJoint = inputSource.hand.get('wrist')
    if (wristJoint) {
      return wristJoint
    }
  }

  return null
}
