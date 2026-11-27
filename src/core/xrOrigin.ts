import type { VRM } from '@pixiv/three-vrm'
import { Euler, Quaternion, Vector3 } from 'three'

/**
 * カメラのQuaternionからワールドyawを抽出する（VRM非依存）
 * @param cameraRotation カメラのワールド回転
 * @param tempEuler 再利用用Eulerオブジェクト
 * @returns yaw（ラジアン）
 */
export function extractCameraWorldYaw(cameraRotation: Quaternion, tempEuler: Euler): number {
  tempEuler.setFromQuaternion(cameraRotation, 'YXZ')
  return tempEuler.y
}

/**
 * ワールド座標オフセットをローカル座標に変換する（bodyYawの逆回転を適用）
 * @param worldOffset ワールド座標のオフセット
 * @param bodyYaw プレイヤーのbody yaw（ラジアン）
 * @returns ローカル座標のオフセット
 */
export function worldToLocalOffset(
  worldOffset: { x: number; y: number; z: number },
  bodyYaw: number,
): { x: number; y: number; z: number } {
  const cosYaw = Math.cos(-bodyYaw)
  const sinYaw = Math.sin(-bodyYaw)
  return {
    x: worldOffset.x * cosYaw - worldOffset.z * sinYaw,
    y: worldOffset.y,
    z: worldOffset.x * sinYaw + worldOffset.z * cosYaw,
  }
}

/** 目ボーンがない場合の頭から目線までの推定距離（m）。腰の位置合わせ（tracking.ts）でも使う */
export const HEAD_TO_EYE_OFFSET = 0.15

/**
 * アバターの目の位置をワールド座標で取得
 * leftEye/rightEyeボーンがあれば左目の位置、なければheadボーンから推定
 */
export function getAvatarEyeWorldPosition(vrm: VRM): Vector3 {
  const leftEye = vrm.humanoid?.getNormalizedBoneNode('leftEye')
  const rightEye = vrm.humanoid?.getNormalizedBoneNode('rightEye')
  const head = vrm.humanoid?.getNormalizedBoneNode('head')

  const eyeWorldPos = new Vector3()

  if (leftEye && rightEye) {
    // WebXRカメラが左目寄りの位置を報告するため、左目の位置を基準にする
    leftEye.updateWorldMatrix(true, false)
    leftEye.getWorldPosition(eyeWorldPos)
  } else if (head) {
    // 目ボーンがない場合は頭ボーンから推定（フォールバック）
    head.updateWorldMatrix(true, false)
    head.getWorldPosition(eyeWorldPos)
    eyeWorldPos.y += HEAD_TO_EYE_OFFSET
  }

  return eyeWorldPos
}

/**
 * XROriginのオフセットを計算
 * カメラをアバターの目の位置に移動させるためのオフセット
 */
export function calculateXROriginOffset(
  eyeWorldPos: Vector3,
  cameraPosition: Vector3,
): { x: number; y: number; z: number } {
  return {
    x: eyeWorldPos.x - cameraPosition.x,
    y: eyeWorldPos.y - cameraPosition.y,
    z: eyeWorldPos.z - cameraPosition.z,
  }
}

/**
 * HMDトランスフォームからXROriginのワールド座標を逆算
 * @param cameraRotation カメラのワールド回転
 * @param cameraPosition カメラのワールド位置
 * @param hmdTransform HMDのローカルトランスフォーム
 * @param scale XROriginグループのスケール（heightRatio、デフォルト1）
 * @returns XROriginのワールド位置と回転（HMDがなければundefined）
 */
export function calculateXROriginWorld(
  cameraRotation: Quaternion,
  cameraPosition: Vector3,
  hmdTransform: { position: Vector3; rotation: Quaternion } | null,
  scale = 1,
): { position: Vector3 | undefined; rotation: Quaternion | undefined } {
  if (!hmdTransform) {
    return { position: undefined, rotation: undefined }
  }

  // XROriginのワールド回転を計算（カメラワールド回転 * HMDローカル回転の逆）
  const rotation = cameraRotation.clone().multiply(hmdTransform.rotation.clone().invert())

  // XROriginのワールド位置を計算
  // HMDのローカル位置にscaleを適用後、XROriginの回転でワールド空間に変換してから引く
  const position = cameraPosition
    .clone()
    .sub(hmdTransform.position.clone().multiplyScalar(scale).applyQuaternion(rotation))

  return { position, rotation }
}

/**
 * カメラのQuaternionからyaw/pitch/rollを抽出する
 */
export function extractHeadRotationFromCamera(
  vrm: VRM,
  cameraRotation: Quaternion,
): { yaw: number; pitch: number; roll: number } {
  const sceneWorldQuat = new Quaternion()
  vrm.scene.getWorldQuaternion(sceneWorldQuat)
  const sceneInverse = sceneWorldQuat.clone().invert()
  const relativeHeadQuat = cameraRotation.clone().premultiply(sceneInverse)

  const cameraEuler = new Euler().setFromQuaternion(relativeHeadQuat, 'YXZ')
  // VRM 1.0 はアバターが +Z を向く（カメラの前は -Z）ので、yaw に π を足し、pitch の符号を反転
  let yaw = cameraEuler.y + Math.PI
  // yawを-πからπの範囲に正規化（胴体のねじれを防ぐ）
  if (yaw > Math.PI) yaw -= Math.PI * 2
  if (yaw < -Math.PI) yaw += Math.PI * 2
  const pitch = -cameraEuler.x
  // Y軸π回転後のYXZ分解ではX成分と同様にZ成分も符号が反転する（q·Ry(π) = Y(y+π)X(-x)Z(-z)）
  const roll = -cameraEuler.z

  return { yaw, pitch, roll }
}
