import type { VRM } from '@pixiv/three-vrm'
import { Quaternion, Vector3 } from 'three'
import type { ControllerTransform } from './types'
import {
  applyGripRotationToBone,
  getControllerRotationOffset,
  getGripLocalOffset,
  gripToWristPosition,
  HAND_TRACKING_ROTATION_OFFSET_LEFT,
  HAND_TRACKING_ROTATION_OFFSET_RIGHT,
  solveTwoBoneIK,
} from './vrIK'

export type ArmIKOptions = {
  /** XROriginのワールド座標（ローカル→ワールド変換用） */
  xrOriginWorldPos?: Vector3
  /** XROriginのワールド回転（ローカル→ワールド変換用） */
  xrOriginWorldQuat?: Quaternion
  /** XROriginグループのスケール（heightRatio、デフォルト1） */
  xrOriginScale?: number
  /**
   * 位置がコントローラーの握りの中心（gripSpace）のとき true。
   * 手首をそこへ合わせると手が前に出るので、手の向きに沿って手首まで戻した点を目標にする
   * （ハンドトラッキングは wrist の関節そのものなので戻さない）
   */
  fromGrip?: boolean
}

const _handWorldQuat = new Quaternion()
const _gripLocalOffset = new Vector3()
const _worldScale = new Vector3()

/**
 * 手のボーンに当てるワールド回転を求める（ControllerTransformを使用）
 * @param xrOriginWorldQuat XROriginのワールド回転（ローカル→ワールド変換用）
 */
function computeHandWorldRotation(
  transform: ControllerTransform,
  isLeft: boolean,
  xrOriginWorldQuat: Quaternion | undefined,
  out: Quaternion,
): Quaternion {
  out.copy(transform.rotation)

  // ハンドトラッキングの場合、wristジョイントの座標系オフセットを適用（左右で異なる）
  if (transform.isHandTracking) {
    out.multiply(isLeft ? HAND_TRACKING_ROTATION_OFFSET_LEFT : HAND_TRACKING_ROTATION_OFFSET_RIGHT)
  }

  // XROriginの回転を適用してワールド回転に変換
  if (xrOriginWorldQuat) out.premultiply(xrOriginWorldQuat)
  return out
}

/**
 * 腕IKを適用する（ControllerTransformを使用）
 * useVRControllerPositionsの結果を直接使用する
 */
export function applyArmIKFromTransform(
  vrm: VRM,
  leftTransform: ControllerTransform | null,
  rightTransform: ControllerTransform | null,
  sceneWorldQuat: Quaternion,
  { xrOriginWorldPos, xrOriginWorldQuat, xrOriginScale = 1, fromGrip = false }: ArmIKOptions = {},
): void {
  // XROrigin変換がある場合、ローカル座標をワールド座標に変換
  const toWorldPosition = (localPos: Vector3): Vector3 => {
    if (!xrOriginWorldPos || !xrOriginWorldQuat) {
      return localPos.clone()
    }
    // ローカル座標にスケールを適用後、XROriginの回転で回転させ、位置を加算
    return localPos
      .clone()
      .multiplyScalar(xrOriginScale)
      .applyQuaternion(xrOriginWorldQuat)
      .add(xrOriginWorldPos)
  }

  const solveArm = (transform: ControllerTransform | null, isLeft: boolean): void => {
    const humanoid = vrm.humanoid
    const upperArm = humanoid?.getNormalizedBoneNode(isLeft ? 'leftUpperArm' : 'rightUpperArm')
    const lowerArm = humanoid?.getNormalizedBoneNode(isLeft ? 'leftLowerArm' : 'rightLowerArm')
    const hand = humanoid?.getNormalizedBoneNode(isLeft ? 'leftHand' : 'rightHand')
    if (!transform || !upperArm || !lowerArm || !hand) return

    const worldPos = toWorldPosition(transform.position)

    if (fromGrip && !transform.isHandTracking) {
      const middleProximal = humanoid?.getNormalizedBoneNode(
        isLeft ? 'leftMiddleProximal' : 'rightMiddleProximal',
      )
      computeHandWorldRotation(transform, isLeft, xrOriginWorldQuat, _handWorldQuat).multiply(
        getControllerRotationOffset(isLeft),
      )
      getGripLocalOffset(hand, middleProximal, _gripLocalOffset)
      hand.getWorldScale(_worldScale)
      gripToWristPosition(worldPos, _handWorldQuat, _gripLocalOffset, _worldScale.x, worldPos)
    }

    solveTwoBoneIK(upperArm, lowerArm, hand, worldPos, isLeft, sceneWorldQuat)
  }

  solveArm(leftTransform, true)
  solveArm(rightTransform, false)
}

/**
 * 手の回転を適用する（ControllerTransformを使用）
 * useVRControllerPositionsの結果を直接使用する
 * @param xrOriginWorldQuat XROriginのワールド回転（ローカル→ワールド変換用）
 */
export function applyHandRotationFromTransform(
  vrm: VRM,
  leftTransform: ControllerTransform | null,
  rightTransform: ControllerTransform | null,
  xrOriginWorldQuat?: Quaternion,
): void {
  const leftHand = vrm.humanoid?.getNormalizedBoneNode('leftHand')
  const rightHand = vrm.humanoid?.getNormalizedBoneNode('rightHand')

  if (leftTransform && leftHand) {
    computeHandWorldRotation(leftTransform, true, xrOriginWorldQuat, _handWorldQuat)
    applyGripRotationToBone(leftHand, _handWorldQuat, getControllerRotationOffset(true))
    leftHand.updateMatrixWorld(true)
  }

  if (rightTransform && rightHand) {
    computeHandWorldRotation(rightTransform, false, xrOriginWorldQuat, _handWorldQuat)
    applyGripRotationToBone(rightHand, _handWorldQuat, getControllerRotationOffset(false))
    rightHand.updateMatrixWorld(true)
  }
}
