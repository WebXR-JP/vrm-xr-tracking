import type { VRM } from '@pixiv/three-vrm'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'

/** どこに寄って見るか */
export type CameraFocusTarget = 'body' | 'left' | 'right'

const BODY_TARGET = new Vector3(0, 1.2, 0)
const BODY_CAMERA = new Vector3(1.2, 1.6, -2.2)
/** 手に寄るときの、手からカメラまで（アバターの前・少し上から） */
const HAND_CAMERA_OFFSET = new Vector3(0, 0.12, -0.38)

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
      controls.target.copy(position)
      camera.position.copy(position).add(HAND_CAMERA_OFFSET)
    }
    controls.update()
  }, [camera, controls, vrm, focus, version])

  return null
}
