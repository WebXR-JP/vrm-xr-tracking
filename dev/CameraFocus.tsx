import type { VRM } from '@pixiv/three-vrm'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Quaternion, Vector3 } from 'three'

/** どこに寄って見るか */
export type CameraFocusTarget = 'body' | 'left' | 'right'

const BODY_TARGET = new Vector3(0, 1.2, 0)
const BODY_CAMERA = new Vector3(1.2, 1.6, -2.2)
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
}

/** 全身・左手・右手のどれかへカメラを寄せる（OrbitControls は makeDefault で置く） */
export function CameraFocus({ vrm, focus, version }: Props) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as Controls | null

  useEffect(() => {
    if (!controls) return
    void version
    if (focus === 'body' || !vrm) {
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
  }, [camera, controls, vrm, focus, version])

  return null
}
