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
 * - ハンドトラッキング: wrist ジョイントの space（手首の位置・向き）
 * - コントローラー: gripSpace（握りの中心）
 *
 * 手にも gripSpace を出す端末（Quest・Android XR など）があるが、手は必ず wrist を使う。
 * 手の回転オフセット（HAND_TRACKING_ROTATION_OFFSET_*）と、手首の位置へ戻さない扱い（fromGrip）は
 * wrist の座標系を前提にしているため。gripSpace のままだと手首が約 90° 折れ、手も前に出る
 */
export function getControllerSpace(inputSource: XRInputSource): XRSpace | null {
  if (inputSource.hand) {
    return inputSource.hand.get('wrist') ?? null
  }
  return inputSource.gripSpace ?? null
}
