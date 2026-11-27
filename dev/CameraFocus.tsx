import type { VRM } from '@pixiv/three-vrm'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'

/** どこに寄って見るか */
export type CameraFocusTarget = 'body' | 'side' | 'eye' | 'left' | 'right'

/** 一人称で見るときのユーザーの目（見本のポーズのときだけ） */
export interface EyeView {
  position: Vector3
  /** 下を向く角度（rad、下向きが正） */
  pitch: number
}

const BODY_TARGET = new Vector3(0, 1.2, 0)
const BODY_CAMERA = new Vector3(1.2, 1.6, -2.2)
/** 真横から全身を見る（下を向いたときの背中の曲がりと腰の下がり方が分かる） */
const SIDE_TARGET = new Vector3(0, 1.0, 0)
const SIDE_CAMERA = new Vector3(2.6, 1.1, 0)
/** 一人称のとき、OrbitControls の注視点を目からどれだけ先に置くか（m） */
const EYE_TARGET_DISTANCE = 0.3
/**
 * 「目から」の縦の視野角（度）。ヘッドセットの縦の視野角に近づける。
 * 狭いと実機より体が見えにくく判定してしまう
 */
const EYE_VIEW_FOV = 96
/**
 * 「目から」のニアクリップ（m）。既定の 0.1 だと、下を向いたときに目のすぐ下の首や胸の上が
 * 切れて、見えるはずの体が見えない
 */
const EYE_VIEW_NEAR = 0.01
/** 手に寄るときの、手からカメラまでの距離（m）。手のひらの側から、少し指先寄りに見る */
const HAND_CAMERA_DISTANCE = 0.32
const HAND_CAMERA_TOWARD_FINGERS = 0.1

/** OrbitControls のうち使うところ */
interface Controls {
  target: Vector3
  update: () => void
}

type Props = {
  vrm: VRM | null
  focus: CameraFocusTarget
  /** 押すたびに増やす（同じ手をもう一度押したときも寄り直す） */
  version: number
  /** focus が 'eye' のときの目の位置と向き。頭の向きを変えたら追従する */
  eyeView: EyeView | null
}

/** 全身・横・目・左手・右手のどれかへカメラを寄せる（OrbitControls は makeDefault で置く） */
export function CameraFocus({ vrm, focus, version, eyeView }: Props) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as Controls | null
  const isEyeView = focus === 'eye' && !!eyeView

  // 「目から」の間だけ視野角とニアクリップをヘッドセットに寄せ、ほかの視点へ戻したら元に戻す
  useEffect(() => {
    if (!isEyeView || !(camera instanceof PerspectiveCamera)) return
    const { fov, near } = camera
    camera.fov = EYE_VIEW_FOV
    camera.near = EYE_VIEW_NEAR
    camera.updateProjectionMatrix()
    return () => {
      camera.fov = fov
      camera.near = near
      camera.updateProjectionMatrix()
    }
  }, [camera, isEyeView])

  useEffect(() => {
    if (!controls) return
    void version
    if (focus === 'side') {
      controls.target.copy(SIDE_TARGET)
      camera.position.copy(SIDE_CAMERA)
    } else if (focus === 'eye' && eyeView) {
      // ユーザーは -Z を向いているので、-Z を pitch だけ下へ倒した向きを見る
      const forward = new Vector3(0, -Math.sin(eyeView.pitch), -Math.cos(eyeView.pitch))
      camera.position.copy(eyeView.position)
      controls.target.copy(eyeView.position).addScaledVector(forward, EYE_TARGET_DISTANCE)
    } else if (focus === 'body' || focus === 'eye' || !vrm) {
      controls.target.copy(BODY_TARGET)
      camera.position.copy(BODY_CAMERA)
    } else {
      const hand = vrm.humanoid.getRawBoneNode(focus === 'left' ? 'leftHand' : 'rightHand')
      if (!hand) return
      const position = hand.getWorldPosition(new Vector3())
      // 手のひら（正規化ボーンの -Y）の側から見る。指の曲がりと親指の回り込みが見える
      const normalized = vrm.humanoid.getNormalizedBoneNode(
        focus === 'left' ? 'leftHand' : 'rightHand',
      )
      const quat = (normalized ?? hand).getWorldQuaternion(new Quaternion())
      const palm = new Vector3(0, -1, 0).applyQuaternion(quat)
      const fingers = new Vector3(focus === 'left' ? 1 : -1, 0, 0).applyQuaternion(quat)
      controls.target.copy(position).addScaledVector(fingers, 0.06)
      camera.position
        .copy(position)
        .addScaledVector(palm, HAND_CAMERA_DISTANCE)
        .addScaledVector(fingers, HAND_CAMERA_TOWARD_FINGERS)
    }
    controls.update()
  }, [camera, controls, vrm, focus, version, eyeView])

  return null
}
