import { useFrame, useThree } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'
import React, { useCallback, useRef } from 'react'
import {
  createControllerTransform,
  getControllerSpace,
  updateTransformFromPose,
} from '../core/controllerPose'
import type { ControllerTransform, VRTransforms } from '../core/types'

/**
 * VRコントローラーとHMDの位置・回転を取得するhook
 *
 * @returns 左右のコントローラーとHMDの位置・回転（XROrigin-local座標）
 */
const DEFAULT_TRANSFORMS: VRTransforms = {
  leftController: null,
  rightController: null,
  hmd: null,
}

export function useVRControllerPositions(): React.MutableRefObject<VRTransforms> {
  const { gl, camera } = useThree()
  // コントローラー入力
  const leftController = useXRInputSourceState('controller', 'left')
  const rightController = useXRInputSourceState('controller', 'right')
  // ハンドトラッキング入力（Vision Pro等）
  const leftHand = useXRInputSourceState('hand', 'left')
  const rightHand = useXRInputSourceState('hand', 'right')
  const leftRef = useRef<ControllerTransform | null>(null)
  const rightRef = useRef<ControllerTransform | null>(null)
  const hmdRef = useRef<ControllerTransform | null>(null)

  // 返り値を固定のオブジェクトとして管理（毎フレーム新しいオブジェクトを作らない）
  const transformsRef = useRef<VRTransforms>(DEFAULT_TRANSFORMS)

  /**
   * コントローラーの位置・回転を更新
   */
  const updateController = useCallback(
    (
      inputSource: XRInputSource | undefined,
      frame: XRFrame,
      referenceSpace: XRReferenceSpace,
      transformRef: React.MutableRefObject<ControllerTransform | null>,
    ): void => {
      if (!inputSource) {
        transformRef.current = null
        return
      }

      const space = getControllerSpace(inputSource)
      if (!space) return

      let pose: XRPose | undefined
      try {
        pose = frame.getPose(space, referenceSpace)
      } catch {
        // セッション再入場直後、旧セッションのXRSpaceが残っている間はスキップ
        return
      }
      if (!pose) return

      // ハンドトラッキングかどうかを判定（handプロパティが存在すればハンドトラッキング）
      const isHandTracking = !!inputSource.hand

      if (!transformRef.current) {
        transformRef.current = createControllerTransform(isHandTracking)
      } else {
        // 既存のtransformがある場合もフラグを更新（切り替え対応）
        transformRef.current.isHandTracking = isHandTracking
      }

      updateTransformFromPose(transformRef.current, pose)
    },
    [],
  )

  /**
   * HMD（カメラ）の位置・回転を更新
   */
  const updateHMD = useCallback((): void => {
    if (!hmdRef.current) {
      hmdRef.current = createControllerTransform(false)
    }
    hmdRef.current.position.copy(camera.position)
    hmdRef.current.rotation.copy(camera.quaternion)
  }, [camera])

  useFrame(() => {
    const session = gl.xr.getSession()
    if (!session) {
      leftRef.current = null
      rightRef.current = null
      hmdRef.current = null
      return
    }

    const referenceSpace = gl.xr.getReferenceSpace()
    if (!referenceSpace) return
    const frame = gl.xr.getFrame()
    if (!frame) return

    // 左右の入力ソースを取得（ハンドトラッキング優先、コントローラーフォールバック）
    const leftInputSource = leftHand?.inputSource ?? leftController?.inputSource
    const rightInputSource = rightHand?.inputSource ?? rightController?.inputSource

    // 左右のコントローラー/ハンドとHMDの位置・回転を更新
    updateController(leftInputSource, frame, referenceSpace, leftRef)
    updateController(rightInputSource, frame, referenceSpace, rightRef)
    updateHMD()

    // 固定のオブジェクトを更新（毎フレーム新しいオブジェクトを作らない）
    transformsRef.current.leftController = leftRef.current
    transformsRef.current.rightController = rightRef.current
    transformsRef.current.hmd = hmdRef.current
  })

  // refオブジェクト自体を返すことで、使用側で.currentアクセスが必要になる
  // これにより「ミュータブルなデータである」ことが明示的になる
  return transformsRef
}
